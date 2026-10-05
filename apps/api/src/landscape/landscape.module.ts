// apps/api/src/landscape/landscape.module.ts
import { Module } from '@nestjs/common';
import { CacheService } from '../common/cache.service';
import { LandscapeController } from './landscape.controller';
import { LandscapeService } from './landscape.service';

// CacheService is re-provided rather than imported from AppModule (circular);
// same shape as GapModule.
@Module({
  controllers: [LandscapeController],
  providers: [LandscapeService, CacheService],
})
export class LandscapeModule {}
