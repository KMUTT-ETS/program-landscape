// apps/api/test/landscape-controller.test.ts
import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROVENANCE_META } from '../src/common/decorators';
import { ZodValidationPipe } from '../src/common/zod-validation.pipe';
import type { CacheService } from '../src/common/cache.service';

const mocks = vi.hoisted(() => ({ clampScopeForUser: vi.fn() }));
vi.mock('../src/common/scope-guards', async () => {
  const actual = await vi.importActual<typeof import('../src/common/scope-guards')>('../src/common/scope-guards');
  return { ...actual, clampScopeForUser: mocks.clampScopeForUser };
});

const { LandscapeController, ScopeQuery } = await import('../src/landscape/landscape.controller');
const { LandscapeService } = await import('../src/landscape/landscape.service');
const { LANDSCAPE_ATLAS_VERSION } = await import('@kku/db');

const user = { userId: 'u1', role: 'FACULTY_USER', facultyId: 'f1', departmentId: null, programId: null, email: 'x@kku.ac.th', name: null } as never;
const chapter = (name: string) => ({ version: LANDSCAPE_ATLAS_VERSION, computedAt: '2026-10-05T00:00:00.000Z', name });

function fakeCache() {
  const store = new Map<string, unknown>();
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k)),
    set: vi.fn(async (k: string, v: unknown) => void store.set(k, v)),
  };
}

beforeEach(() => {
  mocks.clampScopeForUser.mockReset();
});

describe('ScopeQuery', () => {
  it('defaults to university and accepts program scope', () => {
    const pipe = new ZodValidationPipe(ScopeQuery);
    expect(pipe.transform({}, {} as never)).toEqual({ scope: 'university' });
    expect(pipe.transform({ scope: 'program', scopeId: 'p1' }, {} as never)).toEqual({ scope: 'program', scopeId: 'p1' });
    expect(() => pipe.transform({ scope: 'campus' }, {} as never)).toThrow();
  });
});

describe('LandscapeController', () => {
  it('clamps the requested scope and passes the clamped one to the service', async () => {
    mocks.clampScopeForUser.mockResolvedValue({ scope: 'program', scopeId: 'p9' });
    const readers = {
      shape: vi.fn(async () => chapter('shape')),
      position: vi.fn(async () => chapter('position')),
      capability: vi.fn(async () => chapter('capability')),
      future: vi.fn(async () => chapter('future')),
    };
    const svc = new LandscapeService(fakeCache() as unknown as CacheService, readers as never);
    const ctl = new LandscapeController(svc);
    const res = await ctl.shape(user, { scope: 'university' });
    expect(mocks.clampScopeForUser).toHaveBeenCalledWith('university', null, user);
    expect(readers.shape).toHaveBeenCalledWith({ level: 'program', id: 'p9', programIds: ['p9'] });
    expect(res.meta).toEqual({ freshnessDate: '2026-10-05T00:00:00.000Z', scope: { level: 'program', id: 'p9' } });
  });

  it('stamps every chapter route with the atlas methodology version', () => {
    for (const m of ['shape', 'position', 'capability', 'future'] as const) {
      const meta = Reflect.getMetadata(PROVENANCE_META, LandscapeController.prototype[m]) as { methodologyVersion: string };
      expect(meta.methodologyVersion).toBe(LANDSCAPE_ATLAS_VERSION);
    }
  });
});

describe('LandscapeService cache', () => {
  it('caches per chapter and scope, and never serves one scope to another', async () => {
    const cache = fakeCache();
    const readers = {
      shape: vi.fn(async () => chapter('shape')),
      position: vi.fn(async () => chapter('position')),
      capability: vi.fn(async () => chapter('capability')),
      future: vi.fn(async () => chapter('future')),
    };
    const svc = new LandscapeService(cache as unknown as CacheService, readers as never);
    const a = { level: 'program' as const, id: 'a', programIds: ['a'] };
    const b = { level: 'program' as const, id: 'b', programIds: ['b'] };
    await svc.shape(a);
    await svc.shape(a);
    await svc.shape(b);
    await svc.position(a);
    expect(readers.shape).toHaveBeenCalledTimes(2);
    expect(readers.position).toHaveBeenCalledTimes(1);
    expect(cache.store.size).toBe(3);
  });
});
