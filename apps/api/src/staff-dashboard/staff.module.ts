import { Module } from '@nestjs/common';
import { StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { TeachingWorkloadService } from './teaching-workload.service';
import { StaffEvaluationsController } from './staff-evaluations.controller';
import { StaffEvaluationsService } from './staff-evaluations.service';
import { TeachingTalentController } from './teaching-talent.controller';
import { TeachingTalentService } from './teaching-talent.service';
import { GrantsService } from './grants.service';
import { CacheService } from '../common/cache.service';
import { DataSourcesModule } from '../data-sources/data-sources.module';

@Module({
  imports: [DataSourcesModule],
  controllers: [StaffController, StaffEvaluationsController, TeachingTalentController],
  providers: [
    StaffService,
    TeachingWorkloadService,
    StaffEvaluationsService,
    TeachingTalentService,
    GrantsService,
    CacheService,
  ],
  // Exported so AnalystModule can inject these services for the
  // dashboard chatbot's tool executor without re-providing them.
  exports: [StaffService, TeachingWorkloadService, StaffEvaluationsService],
})
export class StaffDashboardModule {}
