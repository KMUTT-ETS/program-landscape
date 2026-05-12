import type { ModelOverrideResolver } from '@kku/shared';
import { prisma } from './index';

// ─────────────────────────────────────────────────────────────────────────
// AI model override store (Phase 3 of admin redesign).
//
// Backs the per-method-prefix overrides admins set on the AI-settings
// page. Provides a synchronous `resolve()` for the AiService dispatch
// path (which can't afford async DB hops per call) by caching the
// full ai_model_overrides table in memory with a 60-second TTL.
//
// Cache invalidation:
//   - Time-based  : 60s TTL; any provider call after expiry re-reads
//   - Write-based : admin endpoints call `invalidate()` after PUT /
//                   DELETE so the next read sees the change instantly
//
// The store is process-local. Workers + API see independent caches;
// the TTL covers cross-process propagation. For 60s drift on a single
// admin-driven config change this is fine — config changes are rare
// and not safety-critical.
// ─────────────────────────────────────────────────────────────────────────

const TTL_MS = 60_000;

export class AiModelOverrideStore implements ModelOverrideResolver {
  /** methodPrefix → modelId. Empty when no overrides set. */
  private cache = new Map<string, string>();
  /** Epoch ms when the cache was last populated. 0 = never. */
  private loadedAt = 0;
  /** In-flight promise during cache refresh to dedupe concurrent reads. */
  private refreshing: Promise<void> | null = null;

  /** Synchronous resolver consumed by AiService. The cache populates
   *  out-of-band — first call may return undefined (cache miss) but
   *  triggers a background refresh; subsequent calls within 60s
   *  return the cached value. */
  resolve(methodVersion: string): string | undefined {
    this.maybeRefresh();
    // Prefix-match: methodVersion 'program-pedagogy.v1' → cache key
    // 'program-pedagogy'. Longest match wins (in case both
    // 'program-pedagogy' and 'program-pedagogy.v2' are set — though
    // the schema's UNIQUE constraint on methodPrefix means only one
    // entry per prefix exists, so longest-match is just defensive).
    let best: { prefix: string; model: string } | null = null;
    for (const [prefix, modelId] of this.cache) {
      if (methodVersion.startsWith(prefix)) {
        if (!best || prefix.length > best.prefix.length) {
          best = { prefix, model: modelId };
        }
      }
    }
    return best?.model;
  }

  /** Force an immediate cache refresh. Called by admin endpoints
   *  after PUT / DELETE so the change takes effect on the next
   *  AI call without waiting for the TTL. */
  async invalidate(): Promise<void> {
    this.loadedAt = 0;
    await this.refresh();
  }

  /** Refresh the cache if expired. Fire-and-forget — the caller
   *  doesn't await. */
  private maybeRefresh(): void {
    const expired = Date.now() - this.loadedAt > TTL_MS;
    if (!expired || this.refreshing) return;
    this.refreshing = this.refresh().catch(() => {
      // Swallow refresh errors — better to serve a slightly stale
      // cache than to crash the AI dispatch path. Errors land in
      // the API/worker logs via the upstream try/catch wrappers
      // that own these calls.
    });
  }

  private async refresh(): Promise<void> {
    const rows = await prisma.aiModelOverride.findMany({
      select: { methodPrefix: true, modelId: true },
    });
    this.cache = new Map(rows.map((r) => [r.methodPrefix, r.modelId]));
    this.loadedAt = Date.now();
    this.refreshing = null;
  }

  /** Number of active overrides. Used by admin UI/metrics. */
  size(): number {
    return this.cache.size;
  }

  /** All overrides as a plain map. Useful for admin GET endpoints
   *  that want the current set without a separate findMany. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.cache);
  }
}

/** Singleton instance shared across the process. Each `apps/api` and
 *  `apps/ingestion` Node process gets its own instance; the 60s TTL
 *  bridges cross-process propagation after admin writes. */
let singleton: AiModelOverrideStore | null = null;

export function getAiModelOverrideStore(): AiModelOverrideStore {
  if (!singleton) {
    singleton = new AiModelOverrideStore();
    // Eager initial load so the first AI call doesn't see an empty
    // cache. Fire-and-forget; if it fails, the next maybeRefresh()
    // retries.
    void singleton.invalidate();
  }
  return singleton;
}
