import { Module } from '@nestjs/common';
import { BenchmarkingController } from './benchmarking.controller';
import { BenchmarkingInsightsService } from './benchmarking-insights.service';

@Module({
  controllers: [BenchmarkingController],
  providers: [BenchmarkingInsightsService],
})
export class BenchmarkingModule {}
