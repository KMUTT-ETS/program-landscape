import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import IORedis from 'ioredis';

// ─────────────────────────────────────────────────────────────────────────
// CacheService — thin JSON wrapper over Redis for caching expensive
// aggregation queries (cockpit rollups, gap-analysis forecasts).
//
// Usage:
//   const key = CacheService.keyOf('cockpit:overall', { scope, scopeId });
//   const cached = await cache.get<ResultShape>(key);
//   if (cached) return cached;
//   const result = await expensiveCompute();
//   await cache.set(key, result, 60 * 5); // 5 minutes
//
// Invalidation: ingestion.service invokes cache.purge('cockpit:*') after
// a successful IngestionRun completes; modules should otherwise rely on
// short TTLs (60-300s) rather than per-mutation invalidation because the
// consistency requirements are "eventual enough for Council-prep".
//
// Fails open: a Redis outage returns undefined from get() + discards
// set() — callers fall through to the direct compute path and the app
// stays up.
// ─────────────────────────────────────────────────────────────────────────

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly client: IORedis | null;
  private readonly keyPrefix: string;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('REDIS_URL');
    this.keyPrefix = this.config.get<string>('CACHE_KEY_PREFIX') ?? 'kku:cache:';
    if (!url) {
      this.logger.warn('REDIS_URL not set — cache service is a no-op');
      this.client = null;
    } else {
      this.client = new IORedis(url, {
        maxRetriesPerRequest: 2,
        lazyConnect: true,
      });
      this.client.on('error', (err) => {
        this.logger.warn(
          `Redis error — cache degraded: ${err.message ?? String(err)}`,
        );
      });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit().catch(() => null);
  }

  async get<T>(key: string): Promise<T | undefined> {
    if (!this.client) return undefined;
    try {
      const raw = await this.client.get(this.keyPrefix + key);
      if (!raw) return undefined;
      return JSON.parse(raw) as T;
    } catch (err) {
      this.logger.debug(`cache.get(${key}) failed: ${msg(err)}`);
      return undefined;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.set(
        this.keyPrefix + key,
        JSON.stringify(value),
        'EX',
        Math.max(1, Math.floor(ttlSeconds)),
      );
    } catch (err) {
      this.logger.debug(`cache.set(${key}) failed: ${msg(err)}`);
    }
  }

  async purge(pattern: string): Promise<number> {
    if (!this.client) return 0;
    try {
      const prefixed = this.keyPrefix + pattern;
      // SCAN is preferable over KEYS in prod. We iterate cursors + DEL in
      // batches of 100.
      let cursor = '0';
      let total = 0;
      do {
        const [next, keys] = await this.client.scan(
          cursor,
          'MATCH',
          prefixed,
          'COUNT',
          100,
        );
        cursor = next;
        if (keys.length) {
          const deleted = await this.client.del(...keys);
          total += deleted;
        }
      } while (cursor !== '0');
      return total;
    } catch (err) {
      this.logger.debug(`cache.purge(${pattern}) failed: ${msg(err)}`);
      return 0;
    }
  }

  // Deterministic cache-key builder — sort-keyed to keep the same
  // arguments in any order producing the same key.
  static keyOf(namespace: string, args: Record<string, unknown>): string {
    const parts = Object.keys(args)
      .sort()
      .map((k) => `${k}=${stringify(args[k])}`);
    return `${namespace}:${parts.join(';')}`;
  }
}

function stringify(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

function msg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
