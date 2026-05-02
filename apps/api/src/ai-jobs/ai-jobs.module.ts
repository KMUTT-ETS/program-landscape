import { Module } from '@nestjs/common';
import { AiJobsQueueService } from './ai-jobs-queue.service';

// Producer-only module for the ai-jobs BullMQ queue. The worker lives in
// apps/ingestion. Imported by ProgramsModule to drive RUN_PROGRAM_DIGEST.

@Module({
  providers: [AiJobsQueueService],
  exports: [AiJobsQueueService],
})
export class AiJobsModule {}
