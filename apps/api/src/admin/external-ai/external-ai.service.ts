import { BadRequestException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  Prisma,
  getAiModelOverrideStore,
  prisma,
  PrismaAiInferenceRecorder,
  type ExternalAiSourceKind,
  type ExternalAiSourceStatus,
  type SignalType,
} from '@kku/db';
import {
  buildExternalFeedSummaryMessages,
  createAiService,
  ExternalFeedSummarySchema,
  EXTERNAL_FEED_SUMMARY_VERSION,
  type AiProviderId,
  type AiService,
  type ExternalFeedSummary,
} from '@kku/shared';

// ─────────────────────────────────────────────────────────────────────────
// External AI search & synthesis (Phase 5).
//
// Owns the ExternalAiSource catalog (CRUD) and the fetch+summarise
// pipeline triggered by the admin "Run now" button.
//
// For Phase 5b the run-now path is synchronous on the API (caller
// awaits the result so the admin UI gets immediate feedback). Cron
// scheduling and async BullMQ wiring are deferred — there's already
// a `trend-monitors` queue from Prompt 07 we'd plumb into when ready.
// ─────────────────────────────────────────────────────────────────────────

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
  recentSignalCount: number; // last 30 days
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class ExternalAiService implements OnModuleInit {
  private readonly logger = new Logger(ExternalAiService.name);
  private ai!: AiService;

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
  }

  async list(): Promise<ExternalAiSourceRow[]> {
    const rows = await prisma.externalAiSource.findMany({
      orderBy: [{ status: 'asc' }, { name: 'asc' }],
    });
    // Per-source signal count over the last 30 days (admin dashboard).
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
    return prisma.externalAiSource.update({
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
  }

  async setStatus(id: string, status: ExternalAiSourceStatus) {
    return prisma.externalAiSource.update({
      where: { id },
      data: { status },
    });
  }

  async remove(id: string) {
    await prisma.externalAiSource.delete({ where: { id } });
    return { deleted: true };
  }

  // ── Run now: fetch + summarise + write TrendSignal rows ────────────────
  async runNow(id: string, actingUserId: string): Promise<{
    fetched: number;
    summarised: number;
    skipped: number;
    failures: number;
    signals: Array<{ id: string; title: string; impactScore: number }>;
  }> {
    const source = await prisma.externalAiSource.findUnique({ where: { id } });
    if (!source) throw new NotFoundException('Source not found.');

    const startedAt = new Date();
    let fetchedCount = 0;
    let summarisedCount = 0;
    let skippedCount = 0;
    let failureCount = 0;
    const createdSignals: Array<{ id: string; title: string; impactScore: number }> = [];
    let runError: string | null = null;

    try {
      const items = await this.fetchItems(source);
      fetchedCount = items.length;

      for (const item of items) {
        // Dedup: skip if we already have a TrendSignal with this sourceUrl
        // for this externalAiSourceId from the last 30 days.
        const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
        const dup = await prisma.trendSignal.findFirst({
          where: {
            externalAiSourceId: id,
            sourceUrl: item.url,
            createdAt: { gte: cutoff },
          },
          select: { id: true },
        });
        if (dup) {
          skippedCount += 1;
          continue;
        }

        try {
          const summary = await this.summarise({
            sourceName: source.name,
            sourceDefaultSignalType: source.signalType,
            sourceDefaultImpact: source.defaultImpact,
            fetchedUrl: item.url,
            rawContent: item.text,
            userId: actingUserId,
          });
          if (summary == null) {
            skippedCount += 1;
            continue;
          }
          // Filter low-confidence / off-topic items early.
          if (summary.confidence < 0.35) {
            skippedCount += 1;
            continue;
          }
          const created = await prisma.trendSignal.create({
            data: {
              signalType: (summary.signalType as SignalType | undefined) ?? source.signalType,
              title: summary.title.slice(0, 500),
              summaryTh: summary.summaryTh,
              summaryEn: summary.summaryEn,
              sourceUrl: item.url,
              detectedDate: new Date(),
              impactScore: summary.impactScore,
              affectedProgramIds: [],
              affectedSkillIds: [],
              externalAiSourceId: id,
            },
          });
          createdSignals.push({ id: created.id, title: created.title, impactScore: created.impactScore });
          summarisedCount += 1;
        } catch (err) {
          failureCount += 1;
          this.logger.warn(`external-feed summarise failed for ${item.url}: ${(err as Error).message}`);
        }
      }
    } catch (err) {
      runError = (err as Error).message;
      this.logger.error(`external-feed runNow failed for source ${source.slug}: ${runError}`);
    }

    await prisma.externalAiSource.update({
      where: { id },
      data: {
        lastFetchedAt: startedAt,
        lastFetchStatus: runError
          ? 'FAILED'
          : failureCount > 0
            ? 'PARTIAL'
            : fetchedCount === 0
              ? 'EMPTY'
              : 'OK',
        lastFetchError: runError,
        lastSignalCount: summarisedCount,
      },
    });

    if (runError) {
      throw new BadRequestException(runError);
    }
    return {
      fetched: fetchedCount,
      summarised: summarisedCount,
      skipped: skippedCount,
      failures: failureCount,
      signals: createdSignals,
    };
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

  // ── Fetching ───────────────────────────────────────────────────────────
  // Returns array of { url, text } where text is HTML-stripped plain text.
  // URL_LIST: enumerate configJson.urls, GET each. WEB_SEARCH: queries
  // the configured search provider (Google CSE today; env-keyed). When
  // no search key is set we throw — the operator sees a clear error
  // rather than silently doing nothing.
  private async fetchItems(source: {
    kind: ExternalAiSourceKind;
    configJson: Prisma.JsonValue;
    slug: string;
  }): Promise<Array<{ url: string; text: string }>> {
    if (source.kind === 'URL_LIST') {
      const urls = readStringArray(source.configJson, 'urls');
      if (urls.length === 0) {
        throw new Error('URL_LIST source has empty `urls` config.');
      }
      const results: Array<{ url: string; text: string }> = [];
      for (const url of urls) {
        try {
          const text = await fetchAndStrip(url);
          if (text.length > 0) results.push({ url, text });
        } catch (err) {
          this.logger.warn(`URL fetch failed for ${url}: ${(err as Error).message}`);
        }
      }
      return results;
    }

    // WEB_SEARCH
    const queries = readStringArray(source.configJson, 'queries');
    if (queries.length === 0) {
      throw new Error('WEB_SEARCH source has empty `queries` config.');
    }
    const maxResultsPerQuery = readOptionalNumber(source.configJson, 'maxResultsPerQuery') ?? 5;
    const apiKey = this.config.get<string>('GOOGLE_CSE_API_KEY');
    const cx = this.config.get<string>('GOOGLE_CSE_CX');
    if (!apiKey || !cx) {
      throw new Error(
        'WEB_SEARCH requires GOOGLE_CSE_API_KEY + GOOGLE_CSE_CX env vars. Provider not configured.',
      );
    }
    const results: Array<{ url: string; text: string }> = [];
    for (const q of queries) {
      try {
        const items = await googleCseSearch(apiKey, cx, q, maxResultsPerQuery);
        for (const it of items) {
          try {
            const text = await fetchAndStrip(it.link);
            if (text.length > 0) results.push({ url: it.link, text });
          } catch (err) {
            this.logger.warn(`Search-result fetch failed for ${it.link}: ${(err as Error).message}`);
          }
        }
      } catch (err) {
        this.logger.warn(`Search failed for query "${q}": ${(err as Error).message}`);
      }
    }
    return results;
  }

  // ── Summarise one item ────────────────────────────────────────────────
  // Uses extractStructured so the AI method-catalog prefix lookup +
  // admin AI-settings override (Phase 3) both apply — the operator
  // can shift this prompt between Pro and Flash from /admin/app/ai-settings.
  private async summarise(input: {
    sourceName: string;
    sourceDefaultSignalType: SignalType;
    sourceDefaultImpact: number;
    fetchedUrl: string;
    rawContent: string;
    userId: string;
  }): Promise<ExternalFeedSummary | null> {
    if (!this.hasProvider()) return null;
    const messages = buildExternalFeedSummaryMessages({
      sourceName: input.sourceName,
      sourceDefaultSignalType: input.sourceDefaultSignalType,
      sourceDefaultImpact: input.sourceDefaultImpact,
      fetchedUrl: input.fetchedUrl,
      fetchedAt: new Date().toISOString(),
      rawContent: input.rawContent,
    });
    try {
      const resp = await this.ai.extractStructured(
        {
          ctx: {
            module: 'external-ai',
            kind: 'external-feed-summary',
            userId: input.userId,
          },
          messages,
          methodVersion: EXTERNAL_FEED_SUMMARY_VERSION,
          maxOutputTokens: 1800,
        },
        ExternalFeedSummarySchema,
      );
      return resp.parsed;
    } catch (err) {
      this.logger.warn(`external-feed-summary parse failed: ${(err as Error).message}`);
      return null;
    }
  }

  private hasProvider(): boolean {
    return Boolean(
      this.config.get<string>('GOOGLE_AI_API_KEY') || this.config.get<string>('ANTHROPIC_API_KEY'),
    );
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function readStringArray(json: Prisma.JsonValue, key: string): string[] {
  if (typeof json !== 'object' || json == null || Array.isArray(json)) return [];
  const v = (json as Record<string, unknown>)[key];
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is string => typeof x === 'string' && x.length > 0);
}

function readOptionalNumber(json: Prisma.JsonValue, key: string): number | undefined {
  if (typeof json !== 'object' || json == null || Array.isArray(json)) return undefined;
  const v = (json as Record<string, unknown>)[key];
  return typeof v === 'number' ? v : undefined;
}

async function fetchAndStrip(url: string): Promise<string> {
  // 8s timeout; modest UA so a few sites don't refuse the request.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'user-agent': 'KKU-CurriculumLandscape/1.0 (+https://program-landscape.kku.ac.th)',
        accept: 'text/html, application/xhtml+xml, application/xml, application/rss+xml',
      },
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.text();
    return stripHtml(raw).slice(0, 50_000);
  } finally {
    clearTimeout(timer);
  }
}

// Very plain HTML → text. Doesn't try to be smart about main-content
// detection (Readability) — Phase 5 v1 accepts the noise; the LLM
// summary instructions tell it to ignore boilerplate.
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

async function googleCseSearch(
  apiKey: string,
  cx: string,
  query: string,
  num: number,
): Promise<Array<{ title: string; link: string; snippet: string }>> {
  const params = new URLSearchParams({ key: apiKey, cx, q: query, num: String(Math.min(num, 10)) });
  const res = await fetch(`https://customsearch.googleapis.com/customsearch/v1?${params.toString()}`);
  if (!res.ok) throw new Error(`Google CSE HTTP ${res.status}`);
  const json = (await res.json()) as { items?: Array<{ title: string; link: string; snippet: string }> };
  return json.items ?? [];
}
