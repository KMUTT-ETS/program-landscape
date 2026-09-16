import { Module } from '@nestjs/common';
import { computeGapMap } from '@kku/db';
import { CacheService } from '../common/cache.service';
import { GapController } from './gap.controller';
import { GapBriefService } from './gap-brief.service';
import { COMPUTE_GAP_MAP, GapService } from './gap.service';

// CacheService is re-provided here rather than imported: AppModule provides
// it but importing AppModule from a feature module is circular. Same shape
// as UsageModule / JobFieldsModule. ConfigService, its only dependency, is
// global.
@Module({
  controllers: [GapController],
  providers: [GapService, GapBriefService, CacheService, { provide: COMPUTE_GAP_MAP, useValue: computeGapMap }],
})
export class GapModule {}
