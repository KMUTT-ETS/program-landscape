import { describe, expect, it, vi, beforeEach } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────
// Regression coverage for the "OpenRouter refresh evicts curated models"
// bug: refreshAiModelCatalog() did `deleteMany({ source: 'openrouter' })`
// then inserted only what fetchOpenRouterGeminiModels() returned (2 flash +
// 2 pro, newest-first). The static AVAILABLE_AI_MODELS list — including
// gemini-3.5-flash, the defaultModel for 27 of 29 AI_METHOD_CATALOG
// entries and DEFAULT_COMPLETION_MODEL in google-ai.ts — was seeded with
// source='openrouter' ("placeholder the first refresh replaces"), so the
// first successful refresh could permanently delete it if it fell outside
// OpenRouter's newest-2-per-tier window.
//
// These tests exercise the real ensureModelCatalogSeeded /
// refreshAiModelCatalog / findCatalogModel functions against a tiny
// in-memory fake of the `ai_model_catalog` table (same call-mocking
// convention as gap-analysis.test.ts / sign-in-lockout.test.ts, but with a
// real backing Map since this bug is specifically about data surviving
// across two function calls).
// ─────────────────────────────────────────────────────────────────────────

interface FakeRow {
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
  isSelectable: boolean;
  fetchedAt: Date;
}

let table: Map<string, FakeRow>;

function resetTable(rows: FakeRow[] = []): void {
  table = new Map(rows.map((r) => [r.id, r]));
}

function matches(row: FakeRow, where?: Record<string, unknown>): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => (row as Record<string, unknown>)[k] === v);
}

const mocks = vi.hoisted(() => ({
  fetchOpenRouterGeminiModels: vi.fn(),
}));

vi.mock('../src/index', async () => {
  const actual = await vi.importActual<typeof import('../src/index')>('../src/index');
  const fakeDelegate = {
    count: vi.fn(async (args?: { where?: Record<string, unknown> }) =>
      [...table.values()].filter((r) => matches(r, args?.where)).length,
    ),
    createMany: vi.fn(
      async (args: { data: Partial<FakeRow>[]; skipDuplicates?: boolean }) => {
        let count = 0;
        for (const d of args.data) {
          if (!d.id) continue;
          if (table.has(d.id)) {
            if (args.skipDuplicates) continue;
            throw new Error(`Unique constraint failed on the fields: (id) — ${d.id}`);
          }
          table.set(d.id, {
            provider: '',
            tier: '',
            label: '',
            description: '',
            costInputPer1m: 0,
            costOutputPer1m: 0,
            legacy: false,
            source: '',
            openrouterId: null,
            sourceCreatedAt: null,
            contextLength: null,
            isSelectable: true, // schema default
            fetchedAt: new Date(),
            ...d,
          } as FakeRow);
          count++;
        }
        return { count };
      },
    ),
    deleteMany: vi.fn(async (args: { where?: Record<string, unknown> }) => {
      let count = 0;
      for (const [id, row] of table) {
        if (matches(row, args?.where)) {
          table.delete(id);
          count++;
        }
      }
      return { count };
    }),
    findMany: vi.fn(async (args?: { where?: Record<string, unknown> }) =>
      [...table.values()].filter((r) => matches(r, args?.where)),
    ),
    findUnique: vi.fn(async (args: { where: { id: string } }) => table.get(args.where.id) ?? null),
    upsert: vi.fn(
      async (args: { where: { id: string }; create: Partial<FakeRow>; update: Partial<FakeRow> }) => {
        const existing = table.get(args.where.id);
        if (existing) {
          const merged = { ...existing, ...args.update };
          table.set(args.where.id, merged);
          return merged;
        }
        const row = {
          provider: '',
          tier: '',
          label: '',
          description: '',
          costInputPer1m: 0,
          costOutputPer1m: 0,
          legacy: false,
          source: '',
          openrouterId: null,
          sourceCreatedAt: null,
          contextLength: null,
          isSelectable: true, // schema default
          fetchedAt: new Date(),
          ...args.create,
        } as FakeRow;
        table.set(args.where.id, row);
        return row;
      },
    ),
  };
  return {
    ...actual,
    prisma: {
      aiModelCatalog: fakeDelegate,
      // Array form only — production code never uses the callback form
      // here. Operations are already-invoked promises by the time this
      // runs (JS evaluates call arguments eagerly), so Promise.all
      // preserves call order for our purposes.
      $transaction: vi.fn(async (ops: unknown) =>
        Array.isArray(ops) ? Promise.all(ops) : (ops as (tx: unknown) => unknown)(fakeDelegate),
      ),
    },
  };
});

vi.mock('@kku/shared', async () => {
  const actual = await vi.importActual<typeof import('@kku/shared')>('@kku/shared');
  return {
    ...actual,
    fetchOpenRouterGeminiModels: mocks.fetchOpenRouterGeminiModels,
  };
});

import {
  ensureModelCatalogSeeded,
  refreshAiModelCatalog,
  findCatalogModel,
  listSelectableModels,
} from '../src/ai-model-catalog';
import { AVAILABLE_AI_MODELS } from '@kku/shared';

function discovered(id: string, tier: 'flash' | 'pro', createdAt: Date) {
  return {
    id,
    openrouterId: `google/${id}`,
    label: id,
    tier,
    description: 'discovered',
    costInputPer1m: 0.5,
    costOutputPer1m: 1.5,
    sourceCreatedAt: createdAt,
    contextLength: 1_000_000,
  };
}

beforeEach(() => {
  resetTable();
  mocks.fetchOpenRouterGeminiModels.mockReset();
});

describe('the curated AVAILABLE_AI_MODELS set', () => {
  it('sanity: gemini-3.5-flash is in the curated list this bug is about', () => {
    expect(AVAILABLE_AI_MODELS.some((m) => m.id === 'gemini-3.5-flash')).toBe(true);
  });
});

describe('refreshAiModelCatalog — regression guard', () => {
  it('does not evict a curated model that OpenRouter did not return this time', async () => {
    // Simulate an install where the curated Google rows were already
    // present (as the buggy code left them: source='openrouter').
    resetTable(
      AVAILABLE_AI_MODELS.map((m) => ({
        id: m.id,
        provider: m.provider,
        tier: m.tier,
        label: m.label,
        description: m.description,
        costInputPer1m: m.costInputPer1m,
        costOutputPer1m: m.costOutputPer1m,
        legacy: m.legacy ?? false,
        source: m.provider === 'google' ? 'openrouter' : 'static',
        openrouterId: m.provider === 'google' ? `google/${m.id}` : null,
        sourceCreatedAt: null,
        contextLength: null,
        isSelectable: true,
        fetchedAt: new Date('2026-01-01'),
      })),
    );

    // OpenRouter's live feed only ever returns 2 flash + 2 pro, and none of
    // them is gemini-3.5-flash this time.
    mocks.fetchOpenRouterGeminiModels.mockResolvedValue([
      discovered('gemini-4.0-flash', 'flash', new Date('2026-09-01')),
      discovered('gemini-3.9-flash', 'flash', new Date('2026-08-01')),
      discovered('gemini-4.0-pro', 'pro', new Date('2026-09-01')),
      discovered('gemini-3.9-pro', 'pro', new Date('2026-08-01')),
    ]);

    const result = await refreshAiModelCatalog();
    expect(result.ok).toBe(true);

    const survivor = await findCatalogModel('gemini-3.5-flash');
    expect(survivor).not.toBeNull();

    // ModelCatalogEntry doesn't carry isSelectable, so check it the way the
    // admin picker actually would — via listSelectableModels(), which
    // filters `where: { isSelectable: true }` at the query level.
    const selectable = await listSelectableModels();
    expect(selectable.some((m) => m.id === 'gemini-3.5-flash')).toBe(true);
  });
});

describe('ensureModelCatalogSeeded — self-heal', () => {
  it('restores a curated row missing from an already-populated table', async () => {
    // Dev's actual reported state: 7 rows, gemini-3.5-flash absent.
    resetTable(
      AVAILABLE_AI_MODELS.filter((m) => m.id !== 'gemini-3.5-flash').map((m) => ({
        id: m.id,
        provider: m.provider,
        tier: m.tier,
        label: m.label,
        description: m.description,
        costInputPer1m: m.costInputPer1m,
        costOutputPer1m: m.costOutputPer1m,
        legacy: m.legacy ?? false,
        source: m.provider === 'google' ? 'openrouter' : 'static',
        openrouterId: m.provider === 'google' ? `google/${m.id}` : null,
        sourceCreatedAt: null,
        contextLength: null,
        isSelectable: true,
        fetchedAt: new Date('2026-01-01'),
      })),
    );

    expect(await findCatalogModel('gemini-3.5-flash')).toBeNull();

    await ensureModelCatalogSeeded();

    const healed = await findCatalogModel('gemini-3.5-flash');
    expect(healed).not.toBeNull();
    expect(healed?.source).toBe('static');

    const selectable = await listSelectableModels();
    expect(selectable.some((m) => m.id === 'gemini-3.5-flash')).toBe(true);
  });

  it('flips a curated row previously seeded as source=openrouter to source=static', async () => {
    resetTable([
      {
        id: 'gemini-3.5-flash',
        provider: 'google',
        tier: 'flash',
        label: 'stale label',
        description: 'stale',
        costInputPer1m: 1.5,
        costOutputPer1m: 9,
        legacy: false,
        source: 'openrouter',
        openrouterId: 'google/gemini-3.5-flash',
        sourceCreatedAt: null,
        contextLength: null,
        isSelectable: true,
        fetchedAt: new Date('2026-01-01'),
      },
    ]);

    await ensureModelCatalogSeeded();

    const row = await findCatalogModel('gemini-3.5-flash');
    expect(row?.source).toBe('static');
  });
});

describe('refreshAiModelCatalog — fetch failure', () => {
  it('leaves the table untouched on a network/parse error', async () => {
    resetTable(
      AVAILABLE_AI_MODELS.map((m) => ({
        id: m.id,
        provider: m.provider,
        tier: m.tier,
        label: m.label,
        description: m.description,
        costInputPer1m: m.costInputPer1m,
        costOutputPer1m: m.costOutputPer1m,
        legacy: m.legacy ?? false,
        source: m.provider === 'google' ? 'static' : 'static',
        openrouterId: null,
        sourceCreatedAt: null,
        contextLength: null,
        isSelectable: true,
        fetchedAt: new Date('2026-01-01'),
      })),
    );
    const before = new Map(table);

    mocks.fetchOpenRouterGeminiModels.mockRejectedValue(new Error('network unreachable'));

    const result = await refreshAiModelCatalog();
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/network unreachable/);

    expect(table.size).toBe(before.size);
    for (const [id, row] of before) {
      expect(table.get(id)).toEqual(row);
    }
  });
});

describe('refreshAiModelCatalog — id collision between OpenRouter and curated', () => {
  it('does not throw when OpenRouter returns an id already in the curated set', async () => {
    resetTable(); // fresh install — ensureModelCatalogSeeded() will seed curated rows first

    mocks.fetchOpenRouterGeminiModels.mockResolvedValue([
      // Same id as the curated gemini-3.5-flash entry.
      discovered('gemini-3.5-flash', 'flash', new Date('2026-09-01')),
      discovered('gemini-3.9-flash', 'flash', new Date('2026-08-01')),
      discovered('gemini-4.0-pro', 'pro', new Date('2026-09-01')),
      discovered('gemini-3.9-pro', 'pro', new Date('2026-08-01')),
    ]);

    await expect(refreshAiModelCatalog()).resolves.toMatchObject({ ok: true });

    // Curated row wins: still present, still source='static' (our own
    // tier/pricing opinion, not overwritten by the discovery feed).
    const row = await findCatalogModel('gemini-3.5-flash');
    expect(row).not.toBeNull();
    expect(row?.source).toBe('static');
  });
});
