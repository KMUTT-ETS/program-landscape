import { Queue, Worker, QueueEvents, type ConnectionOptions } from 'bullmq';
import { Logger } from '@nestjs/common';
import type { ProgramPipelinePhase, Role, ScholarTrigger } from '@kku/shared';
import type { AiJobHandler } from './handlers';

// Dedicated BullMQ queue for AI work.
//   EMBED_SKILL          — generate + write embedding for a single skill
//   EXTRACT_COURSE_SKILLS — course → CourseSkill proposals
//   EXTRACT_JOB_POSTING_SKILLS — job → JobPostingSkill proposals
//   ANALYZE_POLICY_DOC   — policy PDF → PolicyDocument + tags + trend signal
//   RUN_PROGRAM_DIGEST   — program-digest.v1 against the program's CURRENT
//                          curriculum PDF. Triggered by the admin pipeline
//                          UI in apps/web; fires entityId=programId.
//
// Separate from `ingestion` and `pdf-intake` so AI concurrency (usually
// lower than the connector queue's — vendor rate limits) + retry policy
// can be tuned independently. Apps/api produces manual-run jobs via
// the extraction-review admin UI; apps/ingestion consumes.

export const AI_JOBS_QUEUE_NAME = 'ai-jobs';

export type AiJobKind =
  | 'EMBED_SKILL'
  | 'EXTRACT_COURSE_SKILLS'
  | 'EXTRACT_JOB_POSTING_SKILLS'
  | 'ANALYZE_POLICY_DOC'
  // ANALYZE_TREND_DOCUMENT — uploaded PDF / pasted URL → published TrendSignal
  // (entityId = TrendDocument id). Drafts the signal then runs analysis.
  | 'ANALYZE_TREND_DOCUMENT'
  | 'RUN_PROGRAM_DIGEST'
  | 'RUN_PROGRAM_PIPELINE'
  | 'RUN_IMD_RANKINGS_EXTRACT'
  // Full delete-and-replace of class_offerings + class_offering_teachers
  // from POWERBI.VIEW_CLASS_OPEN_GROUP_OFFICER — includes the
  // grade-distribution columns + precomputed class_gpa. Spawns the
  // bundled link-class-offerings script with --apply. `entityId` is an
  // unused sentinel (the refresh is portfolio-wide, not per-program).
  | 'RUN_CLASS_OFFERINGS_LINK'
  // Re-fetch the Google Gemini model catalog from OpenRouter (model
  // name + description + pricing only — discovery, not routing).
  // Registered as a daily repeatable; `entityId` is an unused sentinel.
  | 'REFRESH_MODEL_CATALOG'
  // Daily aiModelHealth() sweep → Notification rows for SUPER_ADMINs
  // when a pinned method is off-catalog / deprecated / failing (see
  // packages/db/src/ai-model-health.ts). Registered as a daily
  // repeatable; `entityId` is an unused sentinel.
  | 'NOTIFY_MODEL_HEALTH'
  // One person's Google Scholar publication record, pulled through
  // ScrapingBee and merged into ResearchOutput. `entityId` is the TARGET
  // user's id, `triggeredByUserId` the actor (equal for a self-fetch).
  // Queued because a profile is 1-2 pages at 3-8s each — too long to hold
  // an HTTP request open. Every page costs real credits, so the handler
  // returns FAILED rather than throwing: a BullMQ retry would re-walk the
  // profile and spend again.
  | 'SCHOLAR_FETCH';

// Pipeline phases. Mirrors the API-side definition in
// apps/api/src/ai-jobs/ai-jobs-queue.service.ts and the runtime in
// apps/ingestion/src/scripts/programs-pipeline.ts.
// Phases 7 + 8 added 2026-05-12 (Phase 2a admin redesign).
// phase2b added 2026-05-25 (focused course-code extractor that runs
// parallel with phase1 — was missing here so the admin UI couldn't
// select it via Custom or AI-only presets).
// phaseRE (research expertise) + phaseCR (curriculum revision) added
// 2026-09-03. phaseRE had existed in the runtime since it shipped but was
// never added here, so `--only=` lists built from this union silently
// dropped it — the same drift phase2b hit. phaseCR reads phaseRE's row,
// so both must stay selectable together.
// Re-exported (not re-declared) from @kku/shared so this queue's contract and
// the pipeline script can never disagree about which phases exist.
export type { ProgramPipelinePhase };

export interface AiJobData {
  kind: AiJobKind;
  // Entity whose processing this job represents (skill id, course id,
  // posting id, policy document id, etc.). Handlers look it up.
  entityId: string;
  triggeredByUserId?: string | null;
  // MANUAL (admin clicked "run now"), SCHEDULED (cron), CHAINED (queued
  // by the completion of another job, e.g. PDF intake finishing a
  // curriculum PDF enqueues extract-course-skills jobs for each Course).
  trigger: 'MANUAL' | 'SCHEDULED' | 'CHAINED';
  /** RUN_PROGRAM_PIPELINE only — restrict to this subset of phases. */
  pipelinePhases?: ProgramPipelinePhase[];
  /** RUN_PROGRAM_PIPELINE only — pass --force to overwrite prior results. */
  pipelineForce?: boolean;
  /**
   * SCHOLAR_FETCH only — which Scholar allowance the run draws on.
   *
   * Distinct from `trigger` above and NOT interchangeable with it:
   * `trigger` describes how the job was created, `scholarTrigger` says
   * whose 30-day quota is spent. SELF and ADMIN are independent counters
   * (see decideScholarQuota), so an admin bulk refresh must not consume the
   * allowance a person needs to refresh their own record.
   */
  scholarTrigger?: ScholarTrigger;
  /** SCHOLAR_FETCH only — the actor's role, read by the quota unit for the
   *  SUPER_ADMIN exemption. Carried on the job so the worker uses the same
   *  role the request was authorised under. */
  scholarActorRole?: Role;
}

export interface AiJobsConfig {
  redisUrl: string;
  maxAttempts: number;
  backoffBaseMs: number;
  concurrency: number;
}

function redisConnection(redisUrl: string): ConnectionOptions {
  const parsed = new URL(redisUrl);
  return {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    password: parsed.password || undefined,
  };
}

export function createAiJobsQueue(config: AiJobsConfig): Queue<AiJobData> {
  return new Queue<AiJobData>(AI_JOBS_QUEUE_NAME, {
    connection: redisConnection(config.redisUrl),
    defaultJobOptions: {
      attempts: config.maxAttempts,
      backoff: { type: 'exponential', delay: config.backoffBaseMs },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 500 },
    },
  });
}

export function createAiJobsWorker(
  config: AiJobsConfig,
  handlers: Record<AiJobKind, AiJobHandler>,
): Worker<AiJobData> {
  const logger = new Logger('AiJobsWorker');
  return new Worker<AiJobData>(
    AI_JOBS_QUEUE_NAME,
    async (job) => {
      const {
        kind,
        entityId,
        trigger,
        triggeredByUserId,
        pipelinePhases,
        pipelineForce,
        scholarTrigger,
        scholarActorRole,
      } = job.data;
      const handler = handlers[kind];
      if (!handler) throw new Error(`No handler registered for ${kind}`);
      logger.log(`Handling ${kind} entityId=${entityId} trigger=${trigger}`);
      const outcome = await handler({
        entityId,
        trigger,
        triggeredByUserId: triggeredByUserId ?? null,
        pipelinePhases,
        pipelineForce,
        scholarTrigger,
        scholarActorRole,
      });
      return outcome;
    },
    {
      connection: redisConnection(config.redisUrl),
      concurrency: config.concurrency,
    },
  );
}

export function createAiJobsEvents(config: AiJobsConfig): QueueEvents {
  const logger = new Logger('AiJobsQueueEvents');
  const events = new QueueEvents(AI_JOBS_QUEUE_NAME, {
    connection: redisConnection(config.redisUrl),
  });
  events.on('failed', ({ jobId, failedReason }) => {
    logger.error(`ai-jobs job ${jobId} failed: ${failedReason}`);
  });
  return events;
}
