// apps/api/src/landscape/landscape.service.ts
import { Inject, Injectable, Optional } from '@nestjs/common';
import {
  LANDSCAPE_ATLAS_VERSION,
  readCapability,
  readFuture,
  readPosition,
  readShape,
  type AtlasScope,
  type CapabilityChapter,
  type FutureChapter,
  type PositionChapter,
  type ShapeChapter,
} from '@kku/db';
import { CacheService } from '../common/cache.service';

// Each chapter is several aggregate queries (Future also computes AI readiness
// per programme), and a Council session opens the same page within minutes,
// so chapters are cached for five minutes per chapter + scope. The version is
// in the key so a methodology bump never serves a stale shape.
export const LANDSCAPE_CACHE_NS = 'landscape:atlas';
export const LANDSCAPE_TTL_SECONDS = 300;
export const LANDSCAPE_READERS = Symbol('LANDSCAPE_READERS');

export interface LandscapeReaders {
  shape(scope: AtlasScope): Promise<ShapeChapter>;
  position(scope: AtlasScope): Promise<PositionChapter>;
  capability(scope: AtlasScope): Promise<CapabilityChapter>;
  future(scope: AtlasScope): Promise<FutureChapter>;
}

type Chapter = keyof LandscapeReaders;

@Injectable()
export class LandscapeService {
  private readonly readers: LandscapeReaders;

  constructor(
    private readonly cache: CacheService,
    @Optional() @Inject(LANDSCAPE_READERS) readers?: LandscapeReaders,
  ) {
    this.readers = readers ?? { shape: readShape, position: readPosition, capability: readCapability, future: readFuture };
  }

  private async cached<T>(chapter: Chapter, scope: AtlasScope, read: () => Promise<T>): Promise<T> {
    const key = CacheService.keyOf(LANDSCAPE_CACHE_NS, {
      chapter,
      level: scope.level,
      id: scope.id,
      version: LANDSCAPE_ATLAS_VERSION,
    });
    const hit = await this.cache.get<T>(key);
    if (hit !== undefined) return hit;
    const value = await read();
    await this.cache.set(key, value, LANDSCAPE_TTL_SECONDS);
    return value;
  }

  shape(scope: AtlasScope): Promise<ShapeChapter> {
    return this.cached('shape', scope, () => this.readers.shape(scope));
  }
  position(scope: AtlasScope): Promise<PositionChapter> {
    return this.cached('position', scope, () => this.readers.position(scope));
  }
  capability(scope: AtlasScope): Promise<CapabilityChapter> {
    return this.cached('capability', scope, () => this.readers.capability(scope));
  }
  future(scope: AtlasScope): Promise<FutureChapter> {
    return this.cached('future', scope, () => this.readers.future(scope));
  }
}
