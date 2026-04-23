import { Module } from '@nestjs/common';
import { ProgramsController } from './programs.controller';
import { DeepDiveController } from './deep-dive.controller';
import { CockpitModule } from '../cockpit/cockpit.module';

@Module({
  imports: [CockpitModule],
  controllers: [ProgramsController, DeepDiveController],
})
export class ProgramsModule {}
