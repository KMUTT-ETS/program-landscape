import { Module } from '@nestjs/common';
import { AiCostController } from './ai-cost.controller';
import { DataQualityController } from './data-quality.controller';
import { SystemStatusController } from './system-status.controller';

@Module({
  controllers: [SystemStatusController, DataQualityController, AiCostController],
})
export class AdminModule {}
