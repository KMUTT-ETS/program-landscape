import { Module } from '@nestjs/common';
import { AnalystController } from './analyst.controller';
import { AnalystService } from './analyst.service';
import { AnalystToolExecutor } from './tool-executor.service';

@Module({
  controllers: [AnalystController],
  providers: [AnalystService, AnalystToolExecutor],
  exports: [AnalystService],
})
export class AnalystModule {}
