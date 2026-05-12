import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue } from 'bullmq';

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
  | 'RUN_PROGRAM_DIGEST'
  | 'RUN_PROGRAM_PIPELINE'
  | 'RUN_IMD_RANKINGS_EXTRACT';

/**
 * Pipeline phases. Mirrors apps/ingestion/src/scripts/programs-pipeline.ts:
 *   phase1  PDF extraction (digest + faculty + skills + pedagogy)
 *   phase2  approve + materialise
 *   phase3  career mapping + demand match
 *   phase4  Oracle/MSSQL data linkage (cohorts, alumni, financials)
 *   phase5  peer select + peer review
 *   phase6  AI readiness
 *   phase7  strategic narrative
 *   phase8  risk analysis
 *
 * Phases 7 + 8 added 2026-05-12 (pipeline expansion commit 44b6bee).
 * The enum was stale until 2026-05-12 (Phase 2a admin redesign).
 */
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
  entityId: string;
  triggeredByUserId?: string | null;
  trigger: 'MANUAL' | 'SCHEDULED' | 'CHAINED';
  /** RUN_PROGRAM_PIPELINE only — restrict to this subset of phases. */
  pipelinePhases?: ProgramPipelinePhase[];
  /** RUN_PROGRAM_PIPELINE only — pass --force to overwrite prior results. */
  pipelineForce?: boolean;
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
      { attempts: data.trigger === 'MANUAL' ? 1 : 2 },
    );
    return job.id ?? '';
  }
}
