import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { TeachingWorkloadService } from './teaching-workload.service';
import { CacheService } from '../common/cache.service';
import { DataSourcesModule } from '../data-sources/data-sources.module';

@Module({
  imports: [DataSourcesModule],
  controllers: [StaffController],
  providers: [StaffService, TeachingWorkloadService, CacheService],
  // Exported so AnalystModule can inject these services for the
  // dashboard chatbot's tool executor without re-providing them.
  exports: [StaffService, TeachingWorkloadService],
})
export class StaffDashboardModule {}
