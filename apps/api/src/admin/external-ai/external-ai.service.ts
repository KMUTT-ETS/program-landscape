import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';
import {
  Prisma,
  getAiModelOverrideStore,
  prisma,
  PrismaAiInferenceRecorder,
  runExternalAiSource,
  type ExternalAiSource,
  type ExternalAiSourceKind,
  type ExternalAiSourceStatus,
  type SignalType,
} from '@kku/db';
import {
  createAiService,
  type AiProviderId,
  type AiService,
} from '@kku/shared';

// ─────────────────────────────────────────────────────────────────────────
// External AI search & synthesis admin (Phase 5).
//
// Owns the ExternalAiSource catalog (CRUD) + the synchronous run-now path
// + hot-flipping BullMQ repeatables on status/cadence/config changes so
// activation feels instant from the admin UI. The actual cron-fired
// fetch+summarise loop runs inside apps/ingestion (see
// apps/ingestion/src/external-ai/), which also runs a 5-min reconciler
// as a safety net.
// ─────────────────────────────────────────────────────────────────────────

export const EXTERNAL_AI_SOURCES_QUEUE_NAME = 'external-ai-sources';

export interface ExternalAiSourceRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  kind: ExternalAiSourceKind;
  status: ExternalAiSourceStatus;
  configJson: unknown;
  cadenceCron: string | null;
  signalType: SignalType;
  defaultImpact: number;
  lastFetchedAt: Date | null;
  lastFetchStatus: string | null;
  lastFetchError: string | null;
  lastSignalCount: number | null;
  recentSignalCount: number;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ExternalAiService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ExternalAiService.name);
  private ai!: AiService;
  private queue!: Queue;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const recorder = new PrismaAiInferenceRecorder();
    const providerId = (this.config.get<string>('AI_PROVIDER') ?? 'google') as AiProviderId;
    this.ai = createAiService({
      recorder,
      providerId,
      apiKeys: {
        google: this.config.get<string>('GOOGLE_AI_API_KEY'),
        anthropic: this.config.get<string>('ANTHROPIC_API_KEY'),
        openrouter: this.config.get<string>('OPENROUTER_API_KEY'),
      },
      modelOverrideResolver: getAiModelOverrideStore(),
    });

    // Producer-only handle. Worker + reconciler live in apps/ingestion.
    const redisUrl = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    const parsed = new URL(redisUrl);
    this.queue = new Queue(EXTERNAL_AI_SOURCES_QUEUE_NAME, {
      connection: {
        host: parsed.hostname,
        port: Number(parsed.port || 6379),
        password: parsed.password || undefined,
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  async list(): Promise<ExternalAiSourceRow[]> {
    const rows = await prisma.externalAiSource.findMany({
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const counts = await prisma.trendSignal.groupBy({
      by: ['externalAiSourceId'],
      where: { externalAiSourceId: { in: rows.map((r) => r.id) }, createdAt: { gte: since } },
      _count: { _all: true },
    });
    const countMap = new Map(counts.map((c) => [c.externalAiSourceId, c._count._all]));
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      description: r.description,
      kind: r.kind,
      status: r.status,
      configJson: r.configJson,
      cadenceCron: r.cadenceCron,
      signalType: r.signalType,
      defaultImpact: r.defaultImpact,
      lastFetchedAt: r.lastFetchedAt,
      lastFetchStatus: r.lastFetchStatus,
      lastFetchError: r.lastFetchError,
      lastSignalCount: r.lastSignalCount,
      recentSignalCount: countMap.get(r.id) ?? 0,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  async create(input: {
    slug: string;
    name: string;
    description?: string;
    kind: ExternalAiSourceKind;
    configJson: Prisma.InputJsonValue;
    cadenceCron?: string;
    signalType?: SignalType;
    defaultImpact?: number;
    createdById?: string;
  }) {
    const existing = await prisma.externalAiSource.findUnique({ where: { slug: input.slug } });
    if (existing) throw new BadRequestException(`A source with slug "${input.slug}" already exists.`);
    return prisma.externalAiSource.create({
      data: {
        slug: input.slug,
        name: input.name,
        description: input.description,
        kind: input.kind,
        configJson: input.configJson,
        cadenceCron: input.cadenceCron,
        signalType: input.signalType ?? 'NEWS',
        defaultImpact: input.defaultImpact ?? 0.5,
        createdById: input.createdById,
      },
    });
  }

  async update(id: string, input: {
    name?: string;
    description?: string;
    configJson?: Prisma.InputJsonValue;
    cadenceCron?: string | null;
    signalType?: SignalType;
    defaultImpact?: number;
  }) {
    const before = await prisma.externalAiSource.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Source not found.');
    const after = await prisma.externalAiSource.update({
      where: { id },
      data: {
        ...(input.name !== undefined && { name: input.name }),
        ...(input.description !== undefined && { description: input.description }),
        ...(input.configJson !== undefined && { configJson: input.configJson }),
        ...(input.cadenceCron !== undefined && { cadenceCron: input.cadenceCron }),
        ...(input.signalType !== undefined && { signalType: input.signalType }),
        ...(input.defaultImpact !== undefined && { defaultImpact: input.defaultImpact }),
      },
    });
    // Hot-flip the repeatable when cadence or config changed and source
    // is ACTIVE. The worker's 5-min reconciler picks this up too, but
    // doing it inline keeps the admin UI feeling instant.
    if (after.status === 'ACTIVE' && (input.cadenceCron !== undefined || input.configJson !== undefined)) {
      await this.syncRepeatable(after).catch((err) => {
        this.logger.warn(`Failed to sync repeatable for ${after.slug}: ${(err as Error).message}`);
      });
    }
    return after;
  }

  async setStatus(id: string, status: ExternalAiSourceStatus) {
    const before = await prisma.externalAiSource.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Source not found.');
    const after = await prisma.externalAiSource.update({
      where: { id },
      data: { status },
    });
    // Add/remove repeatable to match new status.
    await this.syncRepeatable(after).catch((err) => {
      this.logger.warn(`Failed to sync repeatable for ${after.slug}: ${(err as Error).message}`);
    });
    return after;
  }

  async remove(id: string) {
    const before = await prisma.externalAiSource.findUnique({ where: { id } });
    if (before) {
      await this.removeRepeatableForSource(before).catch((err) => {
        this.logger.warn(
          `Failed to remove repeatable for ${before.slug}: ${(err as Error).message}`,
        );
      });
    }
    await prisma.externalAiSource.delete({ where: { id } });
    return { deleted: true };
  }

  // Sync run-now. Calls the shared runner directly so the admin UI gets
  // immediate feedback (vs. enqueueing onto the cron worker queue and
  // waiting for a completion event).
  async runNow(id: string, actingUserId: string) {
    try {
      return await runExternalAiSource({
        sourceId: id,
        ai: this.ai,
        userId: actingUserId,
        googleCseApiKey: this.config.get<string>('GOOGLE_CSE_API_KEY') || undefined,
        googleCseCx: this.config.get<string>('GOOGLE_CSE_CX') || undefined,
        logger: this.logger,
      });
    } catch (err) {
      throw new BadRequestException((err as Error).message);
    }
  }

  async recentSignals(id: string, limit = 20) {
    return prisma.trendSignal.findMany({
      where: { externalAiSourceId: id },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        title: true,
        summaryTh: true,
        summaryEn: true,
        signalType: true,
        impactScore: true,
        sourceUrl: true,
        detectedDate: true,
        createdAt: true,
      },
    });
  }

  // ── BullMQ repeatable wiring ────────────────────────────────────────
  // Repeatable jobKey carries the source id so the worker knows what to
  // run; cron pattern is the source's cadenceCron. Status != ACTIVE or
  // missing cadenceCron means: remove any existing repeatable.

  private repeatableJobName(slug: string): string {
    return `external-ai:${slug}`;
  }

  private async syncRepeatable(source: ExternalAiSource): Promise<void> {
    // Always remove any prior repeatable for this source — keeps state
    // simple. Adding back only if ACTIVE + has cadenceCron.
    await this.removeRepeatableForSource(source);
    if (source.status !== 'ACTIVE' || !source.cadenceCron) return;
    await this.queue.add(
      this.repeatableJobName(source.slug),
      { sourceId: source.id },
      { repeat: { pattern: source.cadenceCron } },
    );
  }

  private async removeRepeatableForSource(source: ExternalAiSource): Promise<void> {
    const name = this.repeatableJobName(source.slug);
    const repeatables = await this.queue.getRepeatableJobs();
    for (const r of repeatables) {
      if (r.name === name) {
        await this.queue.removeRepeatableByKey(r.key);
      }
    }
  }
}
