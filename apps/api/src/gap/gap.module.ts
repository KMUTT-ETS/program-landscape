import { Module } from '@nestjs/common';
import { GapController } from './gap.controller';
import { GapInsightsService } from './gap-insights.service';

@Module({
  controllers: [GapController],
  providers: [GapInsightsService],
})
export class GapModule {}
