import { Module } from '@nestjs/common';
import { EducationController } from './education.controller';
import { EducationService } from './education.service';
import { EducationRefreshService } from './education-refresh.service';

@Module({
  controllers: [EducationController],
  providers: [EducationService, EducationRefreshService],
})
export class EducationModule {}
