import { Module } from '@nestjs/common';
import { CockpitController } from './cockpit.controller';
import { CockpitService } from './cockpit.service';
import { PdfModule } from '../pdf/pdf.module';
import { RecruitmentService } from '../education/recruitment.service';
import { AdmissionCampaignsService } from '../education/admission-campaigns.service';

@Module({
  imports: [PdfModule],
  controllers: [CockpitController],
  // RecruitmentService now delegates to AdmissionCampaignsService — both
  // are provided here so the cockpit injector can resolve the chain.
  providers: [CockpitService, RecruitmentService, AdmissionCampaignsService],
  exports: [CockpitService],
})
export class CockpitModule {}
