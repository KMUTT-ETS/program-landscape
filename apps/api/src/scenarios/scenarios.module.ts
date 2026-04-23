import { Module } from '@nestjs/common';
import { ScenariosController } from './scenarios.controller';
import { ScenariosService } from './scenarios.service';
import { ScenarioInsightsService } from './scenario-insights.service';

@Module({
  controllers: [ScenariosController],
  providers: [ScenariosService, ScenarioInsightsService],
})
export class ScenariosModule {}
