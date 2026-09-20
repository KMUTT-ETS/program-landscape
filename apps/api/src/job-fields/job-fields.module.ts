import { Module } from '@nestjs/common';

import { CacheService } from '../common/cache.service';
import { AiJobsModule } from '../ai-jobs/ai-jobs.module';
import { JobFieldsController } from './job-fields.controller';

// CacheService is re-provided here rather than imported: AppModule provides
// it but importing AppModule from a feature module is circular. Same shape
// as UsageModule / StaffDashboardModule. ConfigService, its only dependency,
// is global. AiJobsModule (producer-only) is imported for the derived-layer
// rebuild triggers — see the "Derived-layer rebuild triggers" section of
// JobFieldsController.
@Module({
  imports: [AiJobsModule],
  controllers: [JobFieldsController],
  providers: [CacheService],
})
export class JobFieldsModule {}
