import { Module } from '@nestjs/common';
import { ProgramsController } from './programs.controller';
import { ProgramsAdminController } from './programs-admin.controller';
import { ProgramsService } from './programs.service';
import { DeepDiveController } from './deep-dive.controller';
import { CurriculumRevisionService } from './curriculum-revision.service';
import { CockpitModule } from '../cockpit/cockpit.module';
import { AiJobsModule } from '../ai-jobs/ai-jobs.module';
import { PdfModule } from '../pdf/pdf.module';

@Module({
  imports: [CockpitModule, AiJobsModule, PdfModule],
  controllers: [ProgramsController, ProgramsAdminController, DeepDiveController],
  providers: [ProgramsService, CurriculumRevisionService],
  exports: [ProgramsService],
})
export class ProgramsModule {}
