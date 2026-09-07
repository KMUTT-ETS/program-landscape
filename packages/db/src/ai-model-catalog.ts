import {
  AVAILABLE_AI_MODELS,
  fetchOpenRouterGeminiModels,
  type DiscoveredAiModel,
} from '@kku/shared';
import { prisma } from './index';

// ─────────────────────────────────────────────────────────────────────────
// AI model catalog — the set of models selectable on the admin AI-settings
// page, plus the pricing used for cost auditing.
//
// Every id in the static @kku/shared AVAILABLE_AI_MODELS list — the models
// the code actually defaults to (see AI_METHOD_CATALOG.defaultModel and
// DEFAULT_COMPLETION_MODEL in providers/google-ai.ts) — is seeded AND
// reasserted as source='static' on every call to
// `ensureModelCatalogSeeded()`. This used to run only when the table was
// empty and marked the curated Google rows as source='openrouter'
// ("placeholders the first refresh replaces"); `refreshAiModelCatalog()`'s
// `deleteMany({ source: 'openrouter' })` + insert-only-what-OpenRouter-
// returned (2 latest flash + 2 latest pro) then permanently evicted any
// curated model OpenRouter didn't happen to return that day — including
// gemini-3.5-flash, the default for nearly every AI method. Reasserting as
// an upsert (not seed-once) means an install that already has the bug's
// damage (rows missing entirely, or stuck at source='openrouter') self-
// heals the next time either function runs — no migration, no manual
// intervention.
//
// OpenRouter-discovered rows (source='openrouter') are the ADDITIONAL,
// non-curated Gemini models refreshed daily from the OpenRouter model
// list. OpenRouter is a DISCOVERY source only; AI calls still route
// through the Google provider directly. `refreshAiModelCatalog()` deletes
// and replaces only the openrouter-sourced rows; curated static rows are
// never touched by the delete, and the insert tolerates an id collision
// with a curated row (the curated row wins — see comment there). A
// network/parse failure leaves the table intact (last known good).
// ─────────────────────────────────────────────────────────────────────────

export interface ModelCatalogEntry {
  id: string;
  provider: string;
  tier: string;
  label: string;
  description: string;
  costInputPer1m: number;
  costOutputPer1m: number;
  legacy: boolean;
  source: string;
  openrouterId: string | null;
  sourceCreatedAt: Date | null;
  contextLength: number | null;
  fetchedAt: Date;
}

export interface RefreshResult {
  ok: boolean;
  count: number;
  /** Present when ok=false — the table was left untouched. */
  error?: string;
  models: { id: string; tier: string; label: string }[];
}

/** Reassert every curated model from the static @kku/shared list as
 *  source='static'. An upsert, not a seed-once-when-empty — this is what
 *  makes it self-healing on an install where a row is missing entirely, or
 *  still carries the pre-fix source='openrouter' placeholder value. Always
 *  writes isSelectable=true explicitly (rather than relying on the schema
 *  default) so a row a prior buggy pass ever flipped to non-selectable is
 *  corrected too. Runs on every call — it's a handful of small upserts,
 *  cheap next to the DB round-trip callers already pay. */
export async function ensureModelCatalogSeeded(): Promise<void> {
  await prisma.$transaction(
    AVAILABLE_AI_MODELS.map((m) =>
      prisma.aiModelCatalog.upsert({
        where: { id: m.id },
        create: {
          id: m.id,
          provider: m.provider,
          tier: m.tier,
          label: m.label,
          description: m.description,
          costInputPer1m: m.costInputPer1m,
          costOutputPer1m: m.costOutputPer1m,
          legacy: m.legacy ?? false,
          source: 'static',
          openrouterId: null,
          isSelectable: true,
        },
        update: {
          provider: m.provider,
          tier: m.tier,
          label: m.label,
          description: m.description,
          costInputPer1m: m.costInputPer1m,
          costOutputPer1m: m.costOutputPer1m,
          legacy: m.legacy ?? false,
          source: 'static',
          isSelectable: true,
        },
      }),
    ),
  );
}

/** Refresh the Google Gemini rows from OpenRouter. Delete-and-replace of
 *  source='openrouter' rows only. On fetch/parse failure the table is
 *  left intact and the error is returned. */
export async function refreshAiModelCatalog(): Promise<RefreshResult> {
  await ensureModelCatalogSeeded();

  let fetched: DiscoveredAiModel[];
  try {
    fetched = await fetchOpenRouterGeminiModels();
  } catch (err) {
    return {
      ok: false,
      count: 0,
      error: err instanceof Error ? err.message : String(err),
      models: [],
    };
  }
  if (fetched.length === 0) {
    return { ok: false, count: 0, error: 'OpenRouter returned no Gemini models', models: [] };
  }

  // The freshest model of each tier is the non-legacy pick; older ones
  // carry the legacy badge in the picker.
  const seenTier = new Set<string>();
  const rows = fetched.map((m) => {
    const isFirstOfTier = !seenTier.has(m.tier);
    seenTier.add(m.tier);
    return {
      id: m.id,
      provider: 'google',
      tier: m.tier,
      label: m.label,
      description: m.description,
      costInputPer1m: m.costInputPer1m,
      costOutputPer1m: m.costOutputPer1m,
      legacy: !isFirstOfTier,
      source: 'openrouter',
      openrouterId: m.openrouterId,
      sourceCreatedAt: m.sourceCreatedAt,
      contextLength: m.contextLength,
      isSelectable: true,
      fetchedAt: new Date(),
    };
  });

  // skipDuplicates guards a collision between a discovered id and a
  // curated one (e.g. OpenRouter's newest flash happens to be
  // 'gemini-3.5-flash', which ensureModelCatalogSeeded() already asserted
  // above as source='static'). The delete above only removes
  // source='openrouter' rows, so the curated row is never touched by it —
  // skipDuplicates just stops the insert from throwing on the id it
  // already owns. Curated wins: it keeps our own tier/pricing opinion
  // rather than being overwritten by whatever OpenRouter reports that day.
  const [, created] = await prisma.$transaction([
    prisma.aiModelCatalog.deleteMany({ where: { source: 'openrouter' } }),
    prisma.aiModelCatalog.createMany({ data: rows, skipDuplicates: true }),
  ]);

  getAiModelPricingStore().invalidate().catch(() => undefined);

  return {
    ok: true,
    count: created.count,
    models: rows.map((r) => ({ id: r.id, tier: r.tier, label: r.label })),
  };
}

/** Models shown in the admin picker (isSelectable), ordered provider →
 *  tier → newest-first. */
export async function listSelectableModels(): Promise<ModelCatalogEntry[]> {
  await ensureModelCatalogSeeded();
  const rows = await prisma.aiModelCatalog.findMany({
    where: { isSelectable: true },
    // Google first (the default-tier provider), then Anthropic; within a
    // provider, non-legacy before legacy, newest first.
    orderBy: [{ provider: 'desc' }, { legacy: 'asc' }, { sourceCreatedAt: 'desc' }],
  });
  return rows.map(toEntry);
}

/** Look up one catalog model by id — used to validate override targets. */
export async function findCatalogModel(id: string): Promise<ModelCatalogEntry | null> {
  const row = await prisma.aiModelCatalog.findUnique({ where: { id } });
  return row ? toEntry(row) : null;
}

/** Catalog freshness for the admin UI. */
export async function getModelCatalogStatus(): Promise<{
  lastFetchedAt: Date | null;
  openrouterCount: number;
  staticCount: number;
}> {
  const [openrouter, staticRows] = await Promise.all([
    prisma.aiModelCatalog.findMany({
      where: { source: 'openrouter' },
      select: { fetchedAt: true },
      orderBy: { fetchedAt: 'desc' },
    }),
    prisma.aiModelCatalog.count({ where: { source: 'static' } }),
  ]);
  return {
    lastFetchedAt: openrouter[0]?.fetchedAt ?? null,
    openrouterCount: openrouter.length,
    staticCount: staticRows,
  };
}

function toEntry(row: {
  id: string;
  provider: string;
  tier: string;
  label: string;
  description: string;
  costInputPer1m: number;
  costOutputPer1m: number;
  legacy: boolean;
  source: string;
  openrouterId: string | null;
  sourceCreatedAt: Date | null;
  contextLength: number | null;
  fetchedAt: Date;
}): ModelCatalogEntry {
  return {
    id: row.id,
    provider: row.provider,
    tier: row.tier,
    label: row.label,
    description: row.description,
    costInputPer1m: row.costInputPer1m,
    costOutputPer1m: row.costOutputPer1m,
    legacy: row.legacy,
    source: row.source,
    openrouterId: row.openrouterId,
    sourceCreatedAt: row.sourceCreatedAt,
    contextLength: row.contextLength,
    fetchedAt: row.fetchedAt,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Pricing store — the single source of truth for AiInference cost.
//
// PrismaAiInferenceRecorder consults this on every write to compute
// costEstimateUsd from the catalog's per-1M pricing, falling back to the
// provider-supplied estimate only when a model is absent from the
// catalog. Caches the full table in memory with a 5-minute TTL so the
// recorder stays a single fast DB insert. Mirrors AiModelOverrideStore.
// ─────────────────────────────────────────────────────────────────────────

const PRICING_TTL_MS = 5 * 60_000;

export class AiModelPricingStore {
  /** modelId → per-1M pricing. */
  private cache = new Map<string, { inputPer1m: number; outputPer1m: number }>();
  private loadedAt = 0;
  private refreshing: Promise<void> | null = null;

  /** USD cost for a call, or undefined when the model is not catalogued
   *  (caller falls back to the provider estimate). Synchronous — the
   *  cache populates out-of-band. */
  estimateUsd(modelId: string, tokensInput: number, tokensOutput: number): number | undefined {
    this.maybeRefresh();
    const p = this.cache.get(modelId);
    if (!p) return undefined;
    return (tokensInput / 1_000_000) * p.inputPer1m + (tokensOutput / 1_000_000) * p.outputPer1m;
  }

  async invalidate(): Promise<void> {
    this.loadedAt = 0;
    await this.refresh();
  }

  private maybeRefresh(): void {
    const expired = Date.now() - this.loadedAt > PRICING_TTL_MS;
    if (!expired || this.refreshing) return;
    this.refreshing = this.refresh().catch(() => {
      // Swallow — a stale price is better than crashing the audit write.
    });
  }

  private async refresh(): Promise<void> {
    const rows = await prisma.aiModelCatalog.findMany({
      select: { id: true, costInputPer1m: true, costOutputPer1m: true },
    });
    this.cache = new Map(
      rows.map((r) => [r.id, { inputPer1m: r.costInputPer1m, outputPer1m: r.costOutputPer1m }]),
    );
    this.loadedAt = Date.now();
    this.refreshing = null;
  }
}

let pricingSingleton: AiModelPricingStore | null = null;

export function getAiModelPricingStore(): AiModelPricingStore {
  if (!pricingSingleton) {
    pricingSingleton = new AiModelPricingStore();
    void pricingSingleton.invalidate().catch(() => undefined);
  }
  return pricingSingleton;
}
