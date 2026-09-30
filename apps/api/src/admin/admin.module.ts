import { Module } from '@nestjs/common';
import { AcademicYearController } from './academic-year.controller';
import { AcademicYearService } from './academic-year.service';
import { AiCostController } from './ai-cost.controller';
import { AiJobsModule } from '../ai-jobs/ai-jobs.module';
import { AiSettingsController } from './ai-settings.controller';
import { AiSettingsService } from './ai-settings.service';
import { ApiClientsController } from './api-clients/api-clients.controller';
import { BackupVerificationService } from './backup-verification.service';
import { DataQualityController } from './data-quality.controller';
import { ExternalAiController } from './external-ai/external-ai.controller';
import { ExternalAiService } from './external-ai/external-ai.service';
import { Job108SettingsController } from './external-ai/job108-settings.controller';
import { ImdController } from './imd.controller';
import { QueuesController } from './queues.controller';
import { QueuesService } from './queues.service';
import { RegistryMappingController } from './registry-mapping.controller';
import { SystemStatusController } from './system-status.controller';

@Module({
  imports: [AiJobsModule],
  controllers: [
    AcademicYearController,
    SystemStatusController,
    DataQualityController,
    AiCostController,
    AiSettingsController,
    ApiClientsController,
    ExternalAiController,
    Job108SettingsController,
    ImdController,
    QueuesController,
    RegistryMappingController,
  ],
  providers: [
    AcademicYearService,
    QueuesService,
    BackupVerificationService,
    AiSettingsService,
    ExternalAiService,
  ],
  exports: [QueuesService],
})
export class AdminModule {}
