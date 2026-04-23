import { Module } from '@nestjs/common';
import { DecisionsController } from './decisions.controller';
import { DecisionsService } from './decisions.service';
import { DecisionReviewService } from './decision-review.service';

@Module({
  controllers: [DecisionsController],
  providers: [DecisionsService, DecisionReviewService],
})
export class DecisionsModule {}
