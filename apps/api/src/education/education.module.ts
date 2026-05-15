import { Module } from '@nestjs/common';
import { EducationController } from './education.controller';
import { EducationService } from './education.service';
import { EducationRefreshService } from './education-refresh.service';
import { RecruitmentService } from './recruitment.service';
import { ClassOfferingsService } from './class-offerings.service';
import { DataSourcesModule } from '../data-sources/data-sources.module';

@Module({
  imports: [DataSourcesModule],
  controllers: [EducationController],
  providers: [
    EducationService,
    EducationRefreshService,
    RecruitmentService,
    ClassOfferingsService,
  ],
})
export class EducationModule {}
