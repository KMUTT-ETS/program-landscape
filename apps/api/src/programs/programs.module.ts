import { Module } from '@nestjs/common';
import { ProgramsController } from './programs.controller';
import { ProgramsAdminController } from './programs-admin.controller';
import { ProgramsService } from './programs.service';
import { DeepDiveController } from './deep-dive.controller';
import { CockpitModule } from '../cockpit/cockpit.module';

@Module({
  imports: [CockpitModule],
  controllers: [ProgramsController, ProgramsAdminController, DeepDiveController],
  providers: [ProgramsService],
  exports: [ProgramsService],
})
export class ProgramsModule {}
