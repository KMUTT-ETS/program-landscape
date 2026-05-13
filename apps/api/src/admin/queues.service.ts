import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type JobType } from 'bullmq';
import { prisma } from '@kku/db';
import { ApiError } from '@kku/shared';

// Read + manage all four BullMQ queues from a single place.
// apps/api connects as a producer-and-monitor; apps/ingestion remains
// the only consumer. Pause/resume/retry/remove operate on the shared
// Redis state, so changes here are reflected by every connected worker
// as soon as they re-poll.
//
// Known queue names — tracked in code rather than discovered from
// Redis so a typo'd queue name from a stray test or dead service can't
// silently appear in the admin UI.

export const KNOWN_QUEUES = [
  {
    name: 'ai-jobs',
    label: 'AI jobs',
    description:
      'Per-program AI work — digest, faculty extraction, skills, full pipeline runs, embeddings.',
  },
  {
    name: 'ingestion',
    label: 'Ingestion connectors',
    description:
      'External-source connectors (KKU registry / HR / finance / research, LinkedIn labour-market data via MHESI, …) that pull data into the local DB.',
  },
  {
    name: 'pdf-intake',
    label: 'PDF intake',
    description:
      'Curriculum PDF parse pipeline — text extract, classify, route to per-template extractor.',
  },
  {
    name: 'trend-monitors',
    label: 'Trend monitors',
    description:
      'Scheduled monitors that scan for new policy / job-market / research / patent signals.',
  },
  {
    name: 'external-ai-sources',
    label: 'External AI sources',
    description:
      'Cron-fired fetch+summarise runs for the Phase-5 catalog of external feeds (WEF / IMD / BOI / World Bank / MHESI / OECD / ASEAN / Google News).',
  },
] as const;

export type QueueName = (typeof KNOWN_QUEUES)[number]['name'];

export const QUEUE_JOB_STATES: JobType[] = [
  'waiting',
  'active',
  'delayed',
  'completed',
  'failed',
  'paused',
];

export interface QueueSummary {
  name: QueueName;
  label: string;
  description: string;
  paused: boolean;
  counts: Record<JobType, number>;
}

export interface QueueJob {
  id: string;
  name: string;
  state: JobType | 'unknown';
  /** ms epoch — when BullMQ accepted the job. */
  createdAt: number | null;
  /** ms epoch — when the worker picked it up. */
  processedAt: number | null;
  /** ms epoch — when it succeeded / failed. */
  finishedAt: number | null;
  /** Attempts so far / configured maxAttempts. */
  attempts: { made: number; max: number };
  /** Job payload — usually small JSON; we cap size in serialisation. */
  data: unknown;
  /** Worker return value (success path) or null. */
  returnvalue: unknown;
  /** failureReason on failure path, else null. */
  failedReason: string | null;
  /** Last 4 lines of stacktrace if any. */
  stacktraceTail: string | null;
}

@Injectable()
export class QueuesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueuesService.name);
  private queues = new Map<QueueName, Queue>();

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const redisUrl = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    const parsed = new URL(redisUrl);
    const connection = {
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
      password: parsed.password || undefined,
    };
    for (const q of KNOWN_QUEUES) {
      this.queues.set(q.name, new Queue(q.name, { connection }));
    }
    this.logger.log(
      `monitoring ${this.queues.size} queues at ${parsed.hostname}:${parsed.port || 6379}`,
    );
  }

  async onModuleDestroy(): Promise<void> {
    for (const q of this.queues.values()) await q.close();
  }

  private resolve(name: string): Queue {
    const q = this.queues.get(name as QueueName);
    if (!q) throw new ApiError('NOT_FOUND', `unknown queue: ${name}`);
    return q;
  }

  async listSummaries(): Promise<QueueSummary[]> {
    return Promise.all(
      KNOWN_QUEUES.map(async (entry): Promise<QueueSummary> => {
        const q = this.queues.get(entry.name)!;
        const counts = await q.getJobCounts(...QUEUE_JOB_STATES);
        const paused = await q.isPaused();
        // Fill missing keys with 0 so the UI doesn't have to guard.
        const filled: Record<JobType, number> = {} as Record<JobType, number>;
        for (const s of QUEUE_JOB_STATES) {
          filled[s] = (counts as Record<string, number>)[s] ?? 0;
        }
        return {
          name: entry.name,
          label: entry.label,
          description: entry.description,
          paused,
          counts: filled,
        };
      }),
    );
  }

  async listJobs(
    name: string,
    state: JobType,
    opts: { offset?: number; limit?: number } = {},
  ): Promise<{ items: QueueJob[]; total: number }> {
    const q = this.resolve(name);
    const limit = Math.min(Math.max(opts.limit ?? 25, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    // Sort order:
    //   - waiting/active/delayed → ascending (oldest about-to-run first;
    //     that's the order they'll actually be processed in)
    //   - completed/failed/paused → descending (most recent first; the
    //     job the operator just triggered should be at the top)
    const asc = state === 'waiting' || state === 'active' || state === 'delayed';
    const jobs = await q.getJobs([state], offset, offset + limit - 1, asc);
    const counts = await q.getJobCounts(state);
    const total = (counts as Record<string, number>)[state] ?? jobs.length;
    const items: QueueJob[] = await Promise.all(jobs.map((j) => serialiseJob(j, state)));
    return { items, total };
  }

  async getJob(name: string, jobId: string): Promise<QueueJob> {
    const q = this.resolve(name);
    const job = await q.getJob(jobId);
    if (!job) throw new ApiError('NOT_FOUND', `job ${jobId} not found in ${name}`);
    const state = ((await job.getState()) as JobType) ?? 'unknown';
    return serialiseJob(job, state);
  }

  async retry(name: string, jobId: string): Promise<{ ok: true }> {
    const q = this.resolve(name);
    const job = await q.getJob(jobId);
    if (!job) throw new ApiError('NOT_FOUND', `job ${jobId} not found in ${name}`);
    // BullMQ throws if you try to retry a non-failed job; we surface the
    // message verbatim because it's already operator-readable.
    try {
      await job.retry();
    } catch (err) {
      throw new ApiError('VALIDATION_FAILED', (err as Error).message);
    }
    return { ok: true };
  }

  async remove(name: string, jobId: string): Promise<{ ok: true }> {
    const q = this.resolve(name);
    const job = await q.getJob(jobId);
    if (!job) throw new ApiError('NOT_FOUND', `job ${jobId} not found in ${name}`);
    // BullMQ repeatable-schedule pending firings have ids of the form
    // `repeat:<hashKey>:<msEpoch>`. You can't remove just one firing —
    // BullMQ throws, AND even if it didn't, the schedule would respawn
    // it at the next worker boot. Refuse with an actionable message
    // pointing the operator at the right surface.
    if (typeof job.id === 'string' && job.id.startsWith('repeat:')) {
      throw new ApiError(
        'VALIDATION_FAILED',
        `Job ${jobId} is the next firing of a recurring schedule (${job.name}). ` +
          `Remove the schedule itself via /admin/data-sources (toggle the ` +
          `source's cadence) or call removeRepeatableSchedule. Removing one ` +
          `instance has no effect — the scheduler will recreate it on next boot.`,
      );
    }
    try {
      await job.remove();
    } catch (err) {
      // BullMQ surfaces operator-readable messages (e.g. "Job is locked"
      // when something is mid-process). Forward as 400 not 500.
      throw new ApiError('VALIDATION_FAILED', (err as Error).message);
    }
    return { ok: true };
  }

  /**
   * Remove a recurring repeatable schedule (and its pending next firing).
   * Use this when the operator legitimately wants to stop a schedule from
   * the queues UI rather than the data-sources page. The IngestionScheduler
   * will re-create it on next worker boot if `DataSource.scheduleEnabled`
   * stays true — this is for one-off pruning of orphan schedules whose
   * source has been deprecated.
   */
  async removeRepeatableSchedule(
    name: string,
    repeatJobKey: string,
  ): Promise<{ ok: true }> {
    const q = this.resolve(name);
    const ok = await q.removeRepeatableByKey(repeatJobKey);
    if (!ok) {
      throw new ApiError('NOT_FOUND', `repeatable schedule ${repeatJobKey} not found in ${name}`);
    }
    return { ok: true };
  }

  async clean(
    name: string,
    state: 'completed' | 'failed' | 'wait' | 'active' | 'delayed' | 'paused',
    opts: { graceMs?: number; limit?: number } = {},
  ): Promise<{ removed: number }> {
    const q = this.resolve(name);
    // Default grace: 24h for completed, 7d for failed (gives operators
    // time to inspect failures before they age out). For waiting/active
    // we never clean unless explicitly asked with grace=0.
    const defaultGrace =
      state === 'completed'
        ? 24 * 60 * 60 * 1000
        : state === 'failed'
          ? 7 * 24 * 60 * 60 * 1000
          : 0;
    const grace = opts.graceMs ?? defaultGrace;
    const limit = Math.max(opts.limit ?? 1000, 1);
    const ids = await q.clean(grace, limit, state);
    return { removed: ids.length };
  }

  async pause(name: string): Promise<{ paused: true }> {
    await this.resolve(name).pause();
    return { paused: true };
  }

  async resume(name: string): Promise<{ paused: false }> {
    await this.resolve(name).resume();
    return { paused: false };
  }

  // ── Phase 6: realtime enhancements ───────────────────────────────────

  // AI-extraction + PDF-extraction PENDING_REVIEW counts. The user can
  // reach the actual review UIs at /admin/extraction-review and
  // /admin/pdf-review?lifecycle=ACTIVE&status=PENDING_REVIEW; this
  // method just surfaces the awaiting-attention counts on the queues
  // dashboard so the operator doesn't have to navigate to find them.
  async reviewCounts(): Promise<{ aiExtractions: number; pdfExtractions: number }> {
    const [ai, pdf] = await Promise.all([
      prisma.aiExtraction.count({ where: { reviewStatus: 'PENDING_REVIEW' } }),
      prisma.pdfExtraction.count({ where: { reviewStatus: 'PENDING_REVIEW' } }),
    ]);
    return { aiExtractions: ai, pdfExtractions: pdf };
  }

  // Last N completed + failed jobs across every queue, merged by
  // finishedAt desc. Drives the "recent activity" stream in the UI.
  // Each queue's history is capped at `limit` and the merge keeps the
  // overall result trimmed too — small constant memory, no scan.
  // Combined "all queues" view — every job across every queue, every
  // state, ordered by job start time desc. Pulls per-queue caps so
  // memory stays bounded; the merge gives operators a single chronological
  // feed instead of forcing them to drill into one queue at a time.
  async allQueuesJobs(opts: { limit?: number; states?: JobType[] } = {}): Promise<
    AllQueuesEntry[]
  > {
    const states = opts.states ?? (['active', 'waiting', 'delayed', 'completed', 'failed'] as JobType[]);
    const limit = Math.max(10, Math.min(opts.limit ?? 100, 500));
    const perQueue = Math.max(20, Math.ceil(limit / KNOWN_QUEUES.length) * 3);
    const merged: AllQueuesEntry[] = [];
    for (const entry of KNOWN_QUEUES) {
      const q = this.queues.get(entry.name)!;
      const jobs = await q.getJobs(states, 0, perQueue - 1, false);
      for (const j of jobs) {
        const jobState = ((await j.getState()) as JobType | 'unknown') ?? 'unknown';
        const verdict =
          jobState === 'completed' ? extractVerdict(j.returnvalue) :
          jobState === 'failed' ? 'FAILED' : null;
        merged.push({
          queueName: entry.name,
          queueLabel: entry.label,
          id: String(j.id ?? ''),
          jobName: j.name,
          state: jobState,
          verdict,
          verdictReason: jobState === 'completed' ? extractVerdictReason(j.returnvalue) : null,
          // Started = when the worker picked up the job. For jobs still
          // waiting/delayed there's no start time yet, so we fall back
          // to the enqueue timestamp so the ordering is still useful.
          startedAt: j.processedOn ?? j.timestamp ?? null,
          finishedAt: j.finishedOn ?? null,
          durationMs:
            j.processedOn && j.finishedOn ? j.finishedOn - j.processedOn : null,
          failedReason: j.failedReason ?? null,
          attempts: { made: j.attemptsMade ?? 0, max: j.opts?.attempts ?? 1 },
          target: extractJobTargetShallow(entry.name, j.name, j.data),
        });
      }
    }
    merged.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    const sliced = merged.slice(0, limit);
    await this.enrichProgramTargets(sliced);
    return sliced;
  }

  /**
   * Recent pipeline + AI-job history for ONE program. Walks the
   * `ai-jobs` queue (the only queue program-pipeline runs land in) and
   * filters by `data.entityId === programId`. Used by the per-program
   * admin page's Pipeline history tab so operators can see this
   * program's recent runs without scanning the global queue.
   */
  async programJobHistory(
    programId: string,
    opts: { limit?: number; states?: JobType[] } = {},
  ): Promise<AllQueuesEntry[]> {
    const states = opts.states ?? (['active', 'waiting', 'delayed', 'completed', 'failed'] as JobType[]);
    const limit = Math.max(5, Math.min(opts.limit ?? 50, 200));
    // Pull a generous superset and filter — BullMQ doesn't support
    // server-side data filtering. 500 per state is plenty for the
    // per-program view (a program rarely accumulates that many runs
    // before old jobs age out under the default 24h/7d clean policies).
    const q = this.resolve('ai-jobs');
    const collected: AllQueuesEntry[] = [];
    for (const state of states) {
      const jobs = await q.getJobs([state], 0, 499, false);
      for (const j of jobs) {
        const d = j.data as Record<string, unknown> | null;
        if (!d || d.entityId !== programId) continue;
        const jobState = ((await j.getState()) as JobType | 'unknown') ?? 'unknown';
        const verdict =
          jobState === 'completed' ? extractVerdict(j.returnvalue) :
          jobState === 'failed' ? 'FAILED' : null;
        collected.push({
          queueName: 'ai-jobs',
          queueLabel: 'AI jobs',
          id: String(j.id ?? ''),
          jobName: j.name,
          state: jobState,
          verdict,
          verdictReason: jobState === 'completed' ? extractVerdictReason(j.returnvalue) : null,
          startedAt: j.processedOn ?? j.timestamp ?? null,
          finishedAt: j.finishedOn ?? null,
          durationMs:
            j.processedOn && j.finishedOn ? j.finishedOn - j.processedOn : null,
          failedReason: j.failedReason ?? null,
          attempts: { made: j.attemptsMade ?? 0, max: j.opts?.attempts ?? 1 },
          target: extractJobTargetShallow('ai-jobs', j.name, j.data),
        });
      }
    }
    collected.sort((a, b) => (b.startedAt ?? 0) - (a.startedAt ?? 0));
    const sliced = collected.slice(0, limit);
    await this.enrichProgramTargets(sliced);
    return sliced;
  }

  /** Fill program code/name for any target whose id we resolved
   *  shallowly. Single Prisma round-trip for the whole batch. */
  private async enrichProgramTargets(entries: AllQueuesEntry[]): Promise<void> {
    const ids = [
      ...new Set(
        entries
          .map((e) => (e.target?.kind === 'program' ? e.target.id : null))
          .filter((x): x is string => Boolean(x)),
      ),
    ];
    if (ids.length === 0) return;
    const programs = await prisma.program.findMany({
      where: { id: { in: ids } },
      select: { id: true, code: true, nameEn: true },
    });
    const byId = new Map(programs.map((p) => [p.id, p]));
    for (const e of entries) {
      if (e.target?.kind === 'program') {
        const p = byId.get(e.target.id);
        if (p) {
          e.target.label = p.code;
          e.target.description = p.nameEn;
        }
      }
    }
  }

  async recentActivity(limit = 30): Promise<ActivityEntry[]> {
    const perQueue = Math.max(5, Math.min(limit, 50));
    const merged: ActivityEntry[] = [];
    for (const entry of KNOWN_QUEUES) {
      const q = this.queues.get(entry.name)!;
      const [completed, failed] = await Promise.all([
        q.getJobs(['completed'], 0, perQueue - 1, false),
        q.getJobs(['failed'], 0, perQueue - 1, false),
      ]);
      for (const j of completed) {
        const verdict = extractVerdict(j.returnvalue);
        merged.push({
          queueName: entry.name,
          queueLabel: entry.label,
          id: String(j.id ?? ''),
          jobName: j.name,
          // state from BullMQ's perspective is `completed` — but the
          // domain verdict from the handler return value is what the
          // operator actually wants to see. `completed-skipped` is the
          // "ran without error but produced nothing useful" bucket.
          state:
            verdict === 'SKIPPED' ? 'completed-skipped' : 'completed',
          verdict,
          verdictReason: extractVerdictReason(j.returnvalue),
          finishedAt: j.finishedOn ?? null,
          durationMs:
            j.processedOn && j.finishedOn ? j.finishedOn - j.processedOn : null,
          failedReason: null,
        });
      }
      for (const j of failed) {
        merged.push({
          queueName: entry.name,
          queueLabel: entry.label,
          id: String(j.id ?? ''),
          jobName: j.name,
          state: 'failed',
          verdict: 'FAILED',
          verdictReason: null,
          finishedAt: j.finishedOn ?? null,
          durationMs:
            j.processedOn && j.finishedOn ? j.finishedOn - j.processedOn : null,
          failedReason: j.failedReason ?? null,
        });
      }
    }
    merged.sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0));
    return merged.slice(0, limit);
  }

  // Per-queue throughput in 5 / 15 / 60-minute windows. Counts only
  // completed jobs (failures aren't throughput, they're toil). Reads
  // up to 500 most-recent completed jobs per queue and bucket-counts
  // by finishedOn — cheap and accurate for any realistic workload.
  async throughput(): Promise<
    Record<
      QueueName,
      { last5min: number; last15min: number; last60min: number; avgDurationMs: number | null }
    >
  > {
    const now = Date.now();
    const cut5 = now - 5 * 60_000;
    const cut15 = now - 15 * 60_000;
    const cut60 = now - 60 * 60_000;
    const result = {} as Record<
      QueueName,
      { last5min: number; last15min: number; last60min: number; avgDurationMs: number | null }
    >;
    for (const entry of KNOWN_QUEUES) {
      const q = this.queues.get(entry.name)!;
      const jobs = await q.getJobs(['completed'], 0, 499, false);
      let n5 = 0;
      let n15 = 0;
      let n60 = 0;
      let durTotal = 0;
      let durCount = 0;
      for (const j of jobs) {
        const finished = j.finishedOn ?? 0;
        if (finished < cut60) continue;
        n60 += 1;
        if (finished >= cut15) n15 += 1;
        if (finished >= cut5) n5 += 1;
        if (j.processedOn && j.finishedOn) {
          durTotal += j.finishedOn - j.processedOn;
          durCount += 1;
        }
      }
      result[entry.name] = {
        last5min: n5,
        last15min: n15,
        last60min: n60,
        avgDurationMs: durCount > 0 ? Math.round(durTotal / durCount) : null,
      };
    }
    return result;
  }
}

async function serialiseJob(
  job: import('bullmq').Job,
  state: JobType | 'unknown',
): Promise<QueueJob> {
  const stack = job.stacktrace ?? [];
  return {
    id: String(job.id ?? ''),
    name: job.name,
    state,
    createdAt: job.timestamp ?? null,
    processedAt: job.processedOn ?? null,
    finishedAt: job.finishedOn ?? null,
    attempts: { made: job.attemptsMade ?? 0, max: job.opts?.attempts ?? 1 },
    data: job.data ?? null,
    returnvalue: job.returnvalue ?? null,
    failedReason: job.failedReason ?? null,
    stacktraceTail: stack.length > 0 ? stack.slice(-4).join('\n') : null,
  };
}

// ──────────────────────────────────────────────────────────────────────
// Domain-level verdict surfacing
//
// BullMQ marks a job `completed` whenever the handler doesn't throw.
// That elides the difference between "produced useful output" and
// "ran successfully but did nothing" (low-confidence skip, no extractor
// matched, dedup hit, source paused). Every handler in apps/ingestion
// already returns a `status` or `verdict` field in its return value;
// we read that here so the admin UI can show OK / SKIPPED / FAILED
// instead of pretending everything succeeded.
//
// The PDF intake worker returns `{ verdict: 'OK' | 'SKIPPED' }`; the
// AI-jobs handlers return `{ status: 'SUCCEEDED' | 'SKIPPED' | 'FAILED' }`.
// We normalise both into the same enum.
// ──────────────────────────────────────────────────────────────────────

export type JobVerdict = 'OK' | 'SKIPPED' | 'FAILED';

export interface AllQueuesEntry {
  queueName: QueueName;
  queueLabel: string;
  id: string;
  jobName: string;
  state: JobType | 'unknown';
  verdict: JobVerdict | null;
  verdictReason: string | null;
  startedAt: number | null;
  finishedAt: number | null;
  durationMs: number | null;
  failedReason: string | null;
  attempts: { made: number; max: number };
  /** Resolved target entity — currently only Program is resolved (other
   *  entity kinds carry an opaque id in `data.entityId` that's not
   *  user-facing). Surfaces in the queues UI so operators see
   *  "RUN_PROGRAM_PIPELINE · ENG-CE" instead of an opaque job name. */
  target: QueueJobTarget | null;
}

export interface QueueJobTarget {
  /** Discriminator — drives the link target in the UI. */
  kind: 'program';
  id: string;
  /** Short identifier (e.g. Program.code). */
  label: string;
  /** Human-readable longer label (e.g. Program.nameEn). */
  description: string | null;
  /** Optional pipeline-specific metadata — phases requested, force flag. */
  pipelinePhases?: string[];
  pipelineForce?: boolean;
}

export interface ActivityEntry {
  queueName: QueueName;
  queueLabel: string;
  id: string;
  jobName: string;
  /** BullMQ's lifecycle state, with one extra flavour: `completed-skipped`
   *  for jobs that BullMQ thinks completed but the handler returned a
   *  SKIPPED verdict. Operators read this column to see real outcomes. */
  state: 'completed' | 'completed-skipped' | 'failed';
  verdict: JobVerdict;
  verdictReason: string | null;
  finishedAt: number | null;
  durationMs: number | null;
  failedReason: string | null;
}

function extractVerdict(returnValue: unknown): JobVerdict {
  if (!returnValue || typeof returnValue !== 'object') return 'OK';
  const r = returnValue as Record<string, unknown>;
  // PDF intake worker shape.
  if (r.verdict === 'OK' || r.verdict === 'SKIPPED' || r.verdict === 'FAILED') {
    return r.verdict as JobVerdict;
  }
  // AI-jobs handler shape: { status: 'SUCCEEDED' | 'SKIPPED' | 'FAILED' }.
  if (r.status === 'SKIPPED') return 'SKIPPED';
  if (r.status === 'FAILED') return 'FAILED';
  if (r.status === 'SUCCEEDED') return 'OK';
  return 'OK';
}

function extractVerdictReason(returnValue: unknown): string | null {
  if (!returnValue || typeof returnValue !== 'object') return null;
  const r = returnValue as Record<string, unknown>;
  if (typeof r.verdictReason === 'string') return r.verdictReason;
  if (typeof r.message === 'string') return r.message;
  return null;
}

// AI-jobs that operate on a single Program. We resolve `data.entityId`
// for these so the queue UI can render the program code + name inline
// (vs. an opaque cuid in the job payload).
const PROGRAM_TARGETED_AI_JOBS = new Set([
  'RUN_PROGRAM_PIPELINE',
  'RUN_PROGRAM_DIGEST',
]);

/**
 * Build a placeholder `QueueJobTarget` from the job payload without
 * touching Prisma. Caller fills in `label` + `description` via a
 * batched program lookup. Returns null for jobs we don't know how to
 * resolve (most non-program job kinds).
 */
function extractJobTargetShallow(
  queueName: string,
  jobName: string,
  data: unknown,
): QueueJobTarget | null {
  if (queueName !== 'ai-jobs') return null;
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  const entityId = typeof d.entityId === 'string' ? d.entityId : null;
  if (!entityId) return null;
  if (!PROGRAM_TARGETED_AI_JOBS.has(jobName)) return null;
  const phases = Array.isArray(d.pipelinePhases)
    ? (d.pipelinePhases as unknown[]).filter(
        (x): x is string => typeof x === 'string',
      )
    : undefined;
  return {
    kind: 'program',
    id: entityId,
    // Placeholders — overwritten by enrichProgramTargets when the
    // program exists in DB. Left as the id so the UI never shows blank
    // when a program got deleted between enqueue and now.
    label: entityId.slice(0, 8),
    description: null,
    pipelinePhases: phases,
    pipelineForce: typeof d.pipelineForce === 'boolean' ? d.pipelineForce : undefined,
  };
}
