import { Module } from '@nestjs/common';
import { AiJobsModule } from '../ai-jobs/ai-jobs.module';
import { TrendDocumentsController } from './trend-documents.controller';
import { TrendDocumentsService } from './trend-documents.service';

@Module({
  imports: [AiJobsModule],
  controllers: [TrendDocumentsController],
  providers: [TrendDocumentsService],
  exports: [TrendDocumentsService],
})
export class TrendDocumentsModule {}
