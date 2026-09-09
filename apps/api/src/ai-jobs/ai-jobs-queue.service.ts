import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, type JobsOptions } from 'bullmq';
import type { ProgramPipelinePhase, Role, ScholarTrigger } from '@kku/shared';

// BullMQ producer for `ai-jobs`. Matches the queue name + connection in
// apps/ingestion/src/ai-jobs/queue.ts. Mirrors PdfIntakeQueueService.
//
// apps/api enqueues from:
//   - admin extraction-review "Re-run" buttons
//   - admin programs/pipeline "Run digest" button (RUN_PROGRAM_DIGEST)
//   - admin programs/pipeline "Run digest on all eligible" bulk action
//
// apps/api does NOT consume — apps/ingestion's worker does that.

export const AI_JOBS_QUEUE_NAME = 'ai-jobs';

export type AiJobKind =
  | 'EMBED_SKILL'
  | 'EXTRACT_COURSE_SKILLS'
  | 'EXTRACT_JOB_POSTING_SKILLS'
  | 'ANALYZE_POLICY_DOC'
  | 'ANALYZE_TREND_DOCUMENT'
  | 'RUN_PROGRAM_DIGEST'
  | 'RUN_PROGRAM_PIPELINE'
  | 'RUN_IMD_RANKINGS_EXTRACT'
  | 'RUN_CLASS_OFFERINGS_LINK'
  | 'REFRESH_MODEL_CATALOG'
  // SCHOLAR_FETCH — pull one person's Google Scholar publication record
  // through ScrapingBee and merge it into ResearchOutput. `entityId` is the
  // TARGET user's id; `triggeredByUserId` is whoever asked for it (equal for
  // a self-fetch). Queued rather than served inline because a profile is 1-2
  // pages at 3-8s each, which is too long to hold an HTTP request open; the
  // UI polls GET /scholar/status/me. Binding a profile is NOT queued — see
  // apps/api/src/scholar/scholar.controller.ts.
  | 'SCHOLAR_FETCH';

/**
 * Pipeline phases. Mirrors apps/ingestion/src/scripts/programs-pipeline.ts:
 *   phase1  PDF extraction (digest + faculty + skills + pedagogy)
 *   phase2  approve + materialise
 *   phase3  career mapping + demand match
 *   phase4  Oracle/MSSQL data linkage (cohorts, alumni, financials)
 *   phase5  peer select + peer review
 *   phase6  AI readiness
 *   phaseRE research expertise (themes from staff publications)
 *   phaseCR curriculum revision (course-level advice; reads phaseRE)
 *   phase7  strategic narrative
 *   phase8  risk analysis
 *
 * Phases 7 + 8 added 2026-05-12 (pipeline expansion commit 44b6bee).
 * The enum was stale until 2026-05-12 (Phase 2a admin redesign).
 * phase2b added 2026-05-25 (focused course-code extractor that runs
 * parallel with phase1 — was missing here so the admin UI couldn't
 * select it via Custom or the AI-only preset).
 * phaseRE + phaseCR added 2026-09-03. phaseRE had shipped in the runtime
 * long before but was never added here, so any explicit `--only=` list the
 * admin UI sent silently dropped it — identical drift to phase2b's. phaseCR
 * reads the row phaseRE writes, so the two must be selectable together.
 */
// Re-exported (not re-declared) from @kku/shared. This used to be a hand-kept
// duplicate of the ingestion-side union — see the header comment in
// packages/shared/src/pipeline/program-phases.ts for how that ended.
export type { ProgramPipelinePhase };

export interface AiJobData {
  kind: AiJobKind;
  entityId: string;
  triggeredByUserId?: string | null;
  trigger: 'MANUAL' | 'SCHEDULED' | 'CHAINED';
  /** RUN_PROGRAM_PIPELINE only — restrict to this subset of phases. */
  pipelinePhases?: ProgramPipelinePhase[];
  /** RUN_PROGRAM_PIPELINE only — pass --force to overwrite prior results. */
  pipelineForce?: boolean;
  /**
   * SCHOLAR_FETCH only — which Scholar allowance this run draws on.
   *
   * This is NOT the `trigger` field above and must never be folded into it.
   * `trigger` says how the JOB was created (a human clicked, cron fired,
   * another job chained it); `scholarTrigger` says whose 30-day quota is
   * being spent, and SELF and ADMIN are two independent counters by design
   * (see decideScholarQuota) so that an admin bulk refresh cannot lock
   * people out of refreshing their own record. A bulk run is MANUAL and
   * ADMIN_BULK at the same time.
   */
  scholarTrigger?: ScholarTrigger;
  /**
   * SCHOLAR_FETCH only — the triggering actor's role, which the quota unit
   * reads for the SUPER_ADMIN exemption. Carried on the job because the
   * worker has no session: resolving it consumer-side would mean a second
   * lookup that could disagree with the role the request was authorised
   * under.
   */
  scholarActorRole?: Role;
}

@Injectable()
export class AiJobsQueueService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AiJobsQueueService.name);
  private queue?: Queue<AiJobData>;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const redisUrl = this.config.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
    const parsed = new URL(redisUrl);
    this.queue = new Queue<AiJobData>(AI_JOBS_QUEUE_NAME, {
      connection: {
        host: parsed.hostname,
        port: Number(parsed.port || 6379),
        password: parsed.password || undefined,
      },
    });
    this.logger.log(`ai-jobs queue producer ready at ${parsed.hostname}:${parsed.port || 6379}`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue?.close();
  }

  async enqueue(data: AiJobData): Promise<string> {
    if (!this.queue) throw new Error('AiJobsQueueService not initialised');
    const job = await this.queue.add(
      `${data.kind.toLowerCase()}:${data.entityId}`,
      data,
      buildJobOptions(data),
    );
    return job.id ?? '';
  }

  /**
   * Count not-yet-finished jobs (waiting / active / delayed) of a given kind,
   * optionally narrowed to one entity. Used by status endpoints to tell the
   * UI whether a refresh is already in flight so the trigger button can
   * disable itself — and, for Scholar, so a user who has just clicked sees
   * "queued" instead of last month's run and clicks again.
   */
  async countRunning(kind: AiJobKind, entityId?: string): Promise<number> {
    if (!this.queue) return 0;
    const jobs = await this.queue.getJobs(['waiting', 'active', 'delayed']);
    return jobs.filter(
      (j) => j.data?.kind === kind && (entityId === undefined || j.data?.entityId === entityId),
    ).length;
  }
}

/**
 * Per-kind BullMQ options. Keyed on `kind`, deliberately: the retry count used
 * to read `data.trigger === 'MANUAL' ? 1 : 2`, which is the wrong axis. It
 * only ever produced the right answer because every Scholar route hardcodes
 * MANUAL today — the obvious next feature, a nightly refresh of stale
 * profiles, would enqueue SCHEDULED and silently get two attempts with nothing
 * to flag it.
 */
export function buildJobOptions(data: AiJobData): JobsOptions {
  const attempts = SINGLE_ATTEMPT_KINDS.has(data.kind) || data.trigger === 'MANUAL' ? 1 : 2;

  if (data.kind !== 'SCHOLAR_FETCH') return { attempts };

  return {
    attempts,
    // Deterministic id: BullMQ silently drops an add() whose id matches a job
    // already waiting or active, which is the whole point here. Two admins
    // bulk-fetching overlapping cohorts (or a user's own fetch racing a queued
    // ADMIN one) otherwise produce two jobs for one person; with
    // AI_JOBS_CONCURRENCY defaulting to 2 they run at once, neither sees the
    // other's run row because neither has created one yet, and BOTH walk the
    // profile. That is double the credits, and whichever finishes second is a
    // *successful* duplicate, so it also burns that person's 30-day allowance
    // — and for SELF-vs-ADMIN the two triggers are independent quota counters
    // by design, so quota is guaranteed not to catch it.
    //
    // This closes the ENQUEUE-side collision only. Two jobs already dequeued
    // and running cannot be collapsed by an id; the runner's check-then-act
    // in-flight guard narrows that to the ~milliseconds between its read and
    // its run-row insert, and only a database-level exclusion (a partial
    // unique index on unfinished runs per user, or a per-user advisory lock
    // held across the walk) would close it outright. Both were considered and
    // rejected in the runner for a stated reason: with no sweeper for
    // unfinished rows, a process dying mid-fetch would wedge that person out
    // of Scholar permanently.
    // NO COLON. BullMQ rejects a custom job id containing ':' outright
    // (`Job.validateOptions`: "Custom Id cannot contain :") — it namespaces its
    // own Redis keys with colons, so one in a user-supplied id would collide
    // with that scheme. The first version of this line used
    // `scholar-fetch:<user>` and every enqueue threw a 500; the queue is mocked
    // in tests, so nothing caught it until a human pressed the button.
    jobId: `scholar-fetch-${data.entityId}`,
    // The id is only reserved while the job exists, so it MUST NOT outlive the
    // run. This producer's Queue sets no defaultJobOptions, so without these a
    // completed job is retained forever and holds `scholar-fetch-<user>` for
    // good — the second fetch a month later would be dropped as a duplicate,
    // silently. The ScholarFetchRun ledger is the durable record of what
    // happened; the queue entry is not, and does not need to be.
    removeOnComplete: true,
    removeOnFail: true,
  };
}

/**
 * Kinds that must never be retried automatically, whatever the trigger.
 *
 * SCHOLAR_FETCH walks a Google Scholar profile through ScrapingBee at
 * ~15 credits per page. Its handler already returns FAILED rather than
 * throwing for the same reason; this is the second wall, for a genuine throw.
 *
 * NOTE this does not make redelivery impossible. BullMQ's *stalled*-job
 * recovery is governed by the worker's `maxStalledCount` (default 1), not by
 * `attempts`: verified against the pinned bullmq 5.76.0, where
 * moveStalledJobsToWait-8.lua increments a separate `stc` field on the job
 * hash and compares it to that setting. A worker killed mid-walk therefore
 * gets its job moved back to wait and run again regardless of `attempts: 1`.
 * What protects the credits in that case is the runner's 15-minute stuck-run
 * window, which refuses a second walk while an unfinished run row is recent.
 */
const SINGLE_ATTEMPT_KINDS = new Set<AiJobKind>(['SCHOLAR_FETCH']);
