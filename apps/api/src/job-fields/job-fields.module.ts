import { Module } from '@nestjs/common';

import { CacheService } from '../common/cache.service';
import { JobFieldsController } from './job-fields.controller';

// CacheService is re-provided here rather than imported: AppModule provides
// it but importing AppModule from a feature module is circular. Same shape
// as UsageModule / StaffDashboardModule. ConfigService, its only dependency,
// is global.
@Module({
  controllers: [JobFieldsController],
  providers: [CacheService],
})
export class JobFieldsModule {}
