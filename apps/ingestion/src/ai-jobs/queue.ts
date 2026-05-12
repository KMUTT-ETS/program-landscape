import { Queue, Worker, QueueEvents, type ConnectionOptions } from 'bullmq';
import { Logger } from '@nestjs/common';
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
  | 'RUN_PROGRAM_DIGEST'
  | 'RUN_PROGRAM_PIPELINE'
  | 'RUN_IMD_RANKINGS_EXTRACT';

// Pipeline phases. Mirrors the API-side definition in
// apps/api/src/ai-jobs/ai-jobs-queue.service.ts and the runtime in
// apps/ingestion/src/scripts/programs-pipeline.ts.
// Phases 7 + 8 added 2026-05-12 (Phase 2a admin redesign).
export type ProgramPipelinePhase =
  | 'phase1'
  | 'phase2'
  | 'phase3'
  | 'phase4'
  | 'phase5'
  | 'phase6'
  | 'phase7'
  | 'phase8';

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
      const { kind, entityId, trigger, triggeredByUserId, pipelinePhases, pipelineForce } = job.data;
      const handler = handlers[kind];
      if (!handler) throw new Error(`No handler registered for ${kind}`);
      logger.log(`Handling ${kind} entityId=${entityId} trigger=${trigger}`);
      const outcome = await handler({
        entityId,
        trigger,
        triggeredByUserId: triggeredByUserId ?? null,
        pipelinePhases,
        pipelineForce,
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
