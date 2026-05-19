import { Module } from '@nestjs/common';
import { EducationController } from './education.controller';
import { EducationService } from './education.service';
import { EducationRefreshService } from './education-refresh.service';
import { RecruitmentService } from './recruitment.service';
import { ClassOfferingsService } from './class-offerings.service';
import { EvaluationsService } from './evaluations.service';
import { DataSourcesModule } from '../data-sources/data-sources.module';
import { AiJobsModule } from '../ai-jobs/ai-jobs.module';

@Module({
  imports: [DataSourcesModule, AiJobsModule],
  controllers: [EducationController],
  providers: [
    EducationService,
    EducationRefreshService,
    RecruitmentService,
    ClassOfferingsService,
    EvaluationsService,
  ],
  // Exported so AnalystModule (and any future dashboard-driven consumer)
  // can inject these services without re-providing them. The dashboard
  // chatbot's tool executor calls EducationService directly so the
  // dashboards stay the single source of truth.
  exports: [
    EducationService,
    EducationRefreshService,
    RecruitmentService,
    ClassOfferingsService,
    EvaluationsService,
  ],
})
export class EducationModule {}
