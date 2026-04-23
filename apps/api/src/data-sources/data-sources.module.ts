import { Module } from '@nestjs/common';
import { DataSourcesController } from './data-sources.controller';
import { IngestionQueueService } from './ingestion-queue.service';

@Module({
  controllers: [DataSourcesController],
  providers: [IngestionQueueService],
  exports: [IngestionQueueService],
})
export class DataSourcesModule {}
