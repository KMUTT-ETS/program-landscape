import { Module } from '@nestjs/common';
import { AiCostController } from './ai-cost.controller';
import { AiJobsModule } from '../ai-jobs/ai-jobs.module';
import { BackupVerificationService } from './backup-verification.service';
import { DataQualityController } from './data-quality.controller';
import { ImdController } from './imd.controller';
import { QueuesController } from './queues.controller';
import { QueuesService } from './queues.service';
import { RegistryMappingController } from './registry-mapping.controller';
import { SystemStatusController } from './system-status.controller';

@Module({
  imports: [AiJobsModule],
  controllers: [
    SystemStatusController,
    DataQualityController,
    AiCostController,
    ImdController,
    QueuesController,
    RegistryMappingController,
  ],
  providers: [QueuesService, BackupVerificationService],
  exports: [QueuesService],
})
export class AdminModule {}
