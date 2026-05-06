import { Module } from '@nestjs/common';
import { CockpitController } from './cockpit.controller';
import { CockpitService } from './cockpit.service';
import { PdfModule } from '../pdf/pdf.module';
import { RecruitmentService } from '../education/recruitment.service';

@Module({
  imports: [PdfModule],
  controllers: [CockpitController],
  providers: [CockpitService, RecruitmentService],
  exports: [CockpitService],
})
export class CockpitModule {}
