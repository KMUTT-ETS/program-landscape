import { Module } from '@nestjs/common';
import { AiJobsModule } from '../ai-jobs/ai-jobs.module';
import { ScholarController } from './scholar.controller';
import { ScholarService } from './scholar.service';

@Module({
  imports: [AiJobsModule],
  controllers: [ScholarController],
  providers: [ScholarService],
  exports: [ScholarService],
})
export class ScholarModule {}
