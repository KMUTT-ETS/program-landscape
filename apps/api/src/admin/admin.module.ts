import { Module } from '@nestjs/common';
import { AiCostController } from './ai-cost.controller';
import { DataQualityController } from './data-quality.controller';
import { QueuesController } from './queues.controller';
import { QueuesService } from './queues.service';
import { SystemStatusController } from './system-status.controller';

@Module({
  controllers: [
    SystemStatusController,
    DataQualityController,
    AiCostController,
    QueuesController,
  ],
  providers: [QueuesService],
  exports: [QueuesService],
})
export class AdminModule {}
