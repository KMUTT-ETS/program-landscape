import { Module } from '@nestjs/common';

import { CacheService } from '../common/cache.service';
import { UsageController } from './usage.controller';
import { UsageService } from './usage.service';

// CacheService is re-provided here rather than imported: AppModule provides
// it but importing AppModule from a feature module is circular. Same shape
// as StaffDashboardModule. ConfigService, its only dependency, is global.
@Module({
  controllers: [UsageController],
  providers: [UsageService, CacheService],
})
export class UsageModule {}
