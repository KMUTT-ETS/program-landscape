import { Module } from '@nestjs/common';
import { AnalystController } from './analyst.controller';
import { AnalystService } from './analyst.service';
import { AnalystToolExecutor } from './tool-executor.service';
import { DashboardToolExecutor } from './dashboard-tool-executor.service';
import { EducationModule } from '../education/education.module';
import { StaffDashboardModule } from '../staff-dashboard/staff.module';

@Module({
  // EducationModule + StaffDashboardModule are imported (and re-export
  // their services) so the dashboard-scoped tool executor can call
  // EducationService / StaffService / TeachingWorkloadService /
  // RecruitmentService / ClassOfferingsService directly — no
  // re-implementation, no second source of truth.
  imports: [EducationModule, StaffDashboardModule],
  controllers: [AnalystController],
  providers: [AnalystService, AnalystToolExecutor, DashboardToolExecutor],
  exports: [AnalystService],
})
export class AnalystModule {}
