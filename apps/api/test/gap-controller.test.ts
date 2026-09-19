import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, type ApiMeta } from '@kku/shared';
import { AI_CALL_META, AUDIT_LOG_META, PERMISSION_META, PROVENANCE_META } from '../src/common/decorators';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe';
import type { CacheService } from '../src/common/cache.service';

// clampScopeForUser reads UserScope rows for anyone below admin grade; these
// are unit tests, so the clamp is stubbed and its own behaviour is asserted
// in scope-guards' tests. The default is a pass-through.
const mocks = vi.hoisted(() => ({
  clampScopeForUser: vi.fn(),
}));

vi.mock('../src/common/scope-guards', async () => {
  const actual = await vi.importActual<typeof import('../src/common/scope-guards')>('../src/common/scope-guards');
  return { ...actual, clampScopeForUser: mocks.clampScopeForUser };
});

const { BriefBody, GapController, MapQuery, mapMeta } = await import('../src/gap/gap.controller');
const { GapService } = await import('../src/gap/gap.service');
type GapService = InstanceType<typeof GapService>;
type GapBriefService = import('../src/gap/gap-brief.service').GapBriefService;

beforeEach(() => {
  mocks.clampScopeForUser.mockReset();
  mocks.clampScopeForUser.mockImplementation(async (scope: string, scopeId: string | null) => ({ scope, scopeId }));
});

// The map is an expensive multi-query compute behind a five-minute cache:
// the key has to carry BOTH thresholds, or a Council member who widens
// "under" sees the previous reader's verdicts. The brief must see exactly
// the rows on screen — a brief written over the unfiltered map would cite
// fields the reader cannot find.

const user = {
  userId: 'u1',
  role: 'ADMIN',
  facultyId: null,
  departmentId: null,
  programId: null,
  email: 'x@kku.ac.th',
  name: null,
} as never;

const mapQuery = (q: Record<string, unknown>) => new ZodValidationPipe(MapQuery).transform(q, {} as never);

describe('MapQuery', () => {
  it('defaults thresholds and rejects under >= over, non-positive, and program scope', () => {
    expect(mapQuery({})).toMatchObject({ scope: 'university', under: 0.5, over: 2 });
    expect(mapQuery({ under: '0.7', over: '3' })).toMatchObject({ under: 0.7, over: 3 });
    expect(() => mapQuery({ under: '2', over: '1' })).toThrow();
    expect(() => mapQuery({ under: '1', over: '1' })).toThrow();
    expect(() => mapQuery({ under: '0' })).toThrow();
    expect(() => mapQuery({ under: '-1' })).toThrow();
    expect(() => mapQuery({ scope: 'program', scopeId: 'p1' })).toThrow();
  });
});

describe('verdict vocabulary', () => {
  it("the prompt's verdict list is exactly the map's", async () => {
    // @kku/shared cannot import @kku/db (cycle), so gap-brief.ts restates the
    // six verdicts. This is the only place both sides are in scope — without
    // it a seventh verdict in the rules module would reach the table and the
    // brief would silently be unable to name it.
    const { GAP_VERDICTS } = await import('@kku/db');
    const { GAP_BRIEF_VERDICTS } = await import('@kku/shared');
    expect([...GAP_BRIEF_VERDICTS]).toEqual([...GAP_VERDICTS]);
  });
});

describe('BriefBody', () => {
  it('accepts every gap-map verdict plus "all", and rejects an unknown one', () => {
    const parse = (verdict: string) =>
      new ZodValidationPipe(BriefBody).transform({ scope: 'university', verdict }, {} as never);
    for (const v of ['all', 'white-space', 'under-served', 'served', 'over-served', 'supply-unknown', 'too-few-postings']) {
      expect(parse(v)).toMatchObject({ verdict: v });
    }
    expect(() => parse('oversupplied')).toThrow();
  });
});

describe('GapService.map cache key', () => {
  it('includes scope, scopeId and both thresholds', async () => {
    const get = vi.fn(async () => undefined);
    const set = vi.fn(async () => undefined);
    const compute = vi.fn(async () => ({ rows: [] }));
    const s = new GapService({ get, set } as unknown as CacheService, compute as never);
    await s.map({ scope: 'faculty', scopeId: 'f1', thresholds: { under: 0.7, over: 3 } });
    const key = (get.mock.calls[0] as unknown as [string])[0];
    expect(key).toContain('gap:map');
    expect(key).toContain('faculty');
    expect(key).toContain('f1');
    expect(key).toContain('0.7');
    expect(key).toContain('3');
    expect(set).toHaveBeenCalledWith(key, { rows: [] }, 300);
  });

  it('gives two threshold pairs two different keys', async () => {
    const get = vi.fn(async () => undefined);
    const compute = vi.fn(async () => ({ rows: [] }));
    const s = new GapService({ get, set: vi.fn() } as unknown as CacheService, compute as never);
    await s.map({ scope: 'university', scopeId: null, thresholds: { under: 0.5, over: 2 } });
    await s.map({ scope: 'university', scopeId: null, thresholds: { under: 0.8, over: 2 } });
    const keys = get.mock.calls.map((c) => (c as unknown as [string])[0]);
    expect(keys[0]).not.toBe(keys[1]);
  });

  it('serves a hit without computing', async () => {
    const get = vi.fn(async () => ({ rows: ['cached'] }));
    const compute = vi.fn();
    const s = new GapService({ get, set: vi.fn() } as unknown as CacheService, compute as never);
    expect(await s.map({ scope: 'university', scopeId: null, thresholds: { under: 0.5, over: 2 } })).toEqual({
      rows: ['cached'],
    });
    expect(compute).not.toHaveBeenCalled();
  });

  it('field() picks the row by slug, carries the map freshness and reconciliation, and is null when absent', async () => {
    const freshness = { postingsAsOf: '2026-09-01T00:00:00.000Z', taxonomyAsOf: null };
    const reconciliation = { scoredWithSupply: 83, supplyFromProxy: 13 };
    const compute = vi.fn(async () => ({ rows: [{ slug: 'logistics' }, { slug: 'nursing' }], freshness, reconciliation }));
    const s = new GapService({ get: vi.fn(async () => undefined), set: vi.fn() } as unknown as CacheService, compute as never);
    const args = { scope: 'university' as const, scopeId: null, thresholds: { under: 0.5, over: 2 } };
    // The reconciliation rides along because the panel's provenance drawer
    // states how much of the supply total rests on the enrolment proxy, and a
    // single row carries neither that count nor a timestamp.
    expect(await s.field({ ...args, slug: 'nursing' })).toEqual({ row: { slug: 'nursing' }, freshness, reconciliation });
    expect(await s.field({ ...args, slug: 'nope' })).toEqual({ row: null, freshness, reconciliation });
  });
});

describe('GapController decorators', () => {
  it('map and fieldDetail are read-gated and carry gap-map provenance', () => {
    for (const name of ['map', 'fieldDetail'] as const) {
      const m = GapController.prototype[name] as (...a: never[]) => unknown;
      expect(Reflect.getMetadata(PERMISSION_META, m)).toBe('programs:read:all');
      const prov = Reflect.getMetadata(PROVENANCE_META, m) as { methodologyVersion: string; caveats: string[] };
      expect(prov.methodologyVersion).toBe('gap-map.v1');
      expect(prov.caveats.length).toBeGreaterThan(0);
    }
  });

  it('brief is an AI call in the gap-analysis module', () => {
    expect(Reflect.getMetadata(AI_CALL_META, GapController.prototype.brief)).toEqual({ module: 'gap-analysis' });
  });

  it('the disagreement is audit-logged', () => {
    expect(Reflect.getMetadata(AUDIT_LOG_META, GapController.prototype.disagree)).toEqual({
      action: 'gap_brief.disagreement',
      entityType: 'Annotation',
    });
  });

  it('map returns the envelope shape so the freshness badge has a real timestamp', async () => {
    const result = {
      rows: [],
      thresholds: { under: 0.5, over: 2 },
      reconciliation: { scoredWithSupply: 83, supplyFromProxy: 13 },
      freshness: { postingsAsOf: '2026-09-01T00:00:00.000Z', taxonomyAsOf: null },
    };
    const c = new GapController({ map: vi.fn(async () => result) } as unknown as GapService, {} as GapBriefService);
    const env = (await c.map(user, mapQuery({}))) as { data: unknown; meta: ApiMeta };
    expect(env.data).toBe(result);
    expect(env.meta.freshnessDate).toBe('2026-09-01T00:00:00.000Z');
  });

  it('the map meta carries the thresholds in force and the proxy weight of THIS response', () => {
    // @Provenance is static: it cannot say which thresholds produced the
    // verdicts on screen, and a shared link that moved them would otherwise
    // look like the default. Council-readiness rule 1 puts the calculation
    // method in the drawer, and a URL threshold is part of that method.
    const meta = mapMeta({
      thresholds: { under: 0.7, over: 3 },
      reconciliation: { scoredWithSupply: 83, supplyFromProxy: 13 },
      freshnessDate: null,
    });
    expect(meta.methodologyParameters).toEqual([
      { label: 'Under-served below a ratio of', value: '0.70' },
      { label: 'Over-served above a ratio of', value: '3.00' },
      { label: 'Too few adverts to read, below', value: '20 adverts' },
    ]);
    // Both caveats the methodology's §13 promises but the decorator cannot
    // hold: the cache race, and the proxy's weight with live counts.
    expect(meta.caveats?.some((c) => c.includes('cached for five minutes'))).toBe(true);
    expect(meta.caveats?.some((c) => c.includes('13 of the 83 scored programmes'))).toBe(true);
  });

  it('brief passes only the current view to the service', async () => {
    const generate = vi.fn(async () => ({ output: null }));
    const c = new GapController({} as GapService, { generate } as unknown as GapBriefService);
    const body = new ZodValidationPipe(BriefBody).transform(
      { scope: 'university', verdict: 'white-space', under: '0.5', over: '2' },
      {} as never,
    );
    await c.brief(user, body);
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({
        verdict: 'white-space',
        facultyId: null,
        thresholds: { under: 0.5, over: 2 },
        userId: 'u1',
      }),
    );
  });

  it('refuses programme scope even when the clamp produces it', async () => {
    mocks.clampScopeForUser.mockResolvedValue({ scope: 'program', scopeId: 'p1' });
    const map = vi.fn();
    const c = new GapController({ map } as unknown as GapService, {} as GapBriefService);
    await expect(c.map(user, mapQuery({}))).rejects.toBeInstanceOf(ApiError);
    expect(map).not.toHaveBeenCalled();
  });
});
