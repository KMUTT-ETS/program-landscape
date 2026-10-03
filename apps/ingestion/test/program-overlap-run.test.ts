import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plain object-literal mock of @kku/db — nothing here can reach the dev
// database. The pure scoring core is imported straight from its source file.
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  programFindMany: vi.fn(),
  runCreate: vi.fn(),
  runUpdate: vi.fn(),
  pairCreateMany: vi.fn(),
}));

vi.mock('@kku/db', async () => {
  const score = await import('../../../packages/db/src/program-overlap/score');
  return {
    ...score,
    byCodeUnits: (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0),
    loadOverlapProgrammes: mocks.load,
    prisma: {
      program: { findMany: mocks.programFindMany },
      programOverlapRun: { create: mocks.runCreate, update: mocks.runUpdate },
      programOverlapPair: { createMany: mocks.pairCreateMany },
    },
  };
});

import type { OverlapProgramme } from '../../../packages/db/src/program-overlap/score';
import { planRunPairs, runProgramOverlap, summarise } from '../src/program-overlap/run';

const v = (deg: number): number[] => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];
const course = (code: string, credits: number, deg: number): OverlapProgramme['courses'][number] => ({
  id: `${code}-id`, code, credits, category: 'MAJOR_REQUIRED', described: true, vector: v(deg), nameTh: code, nameEn: null,
});
const prog = (id: string, over: Partial<OverlapProgramme> = {}): OverlapProgramme => ({
  id, code: id, level: 'BACHELOR', facultyId: 'f1', nameTh: id, nameEn: id, degreeNameTh: null, language: 'TH',
  courses: [], plos: [], marketVector: null, staffIds: [], ...over,
});
const plo = (deg: number) => [{ ordinal: 1, text: `plo-${deg}`, vector: v(deg) }];

// p1 and p2 share three 3-credit major courses (9 credits). p3..p8 each teach
// courses nobody else teaches. PLOs sit 45° apart (cosine 0.71, under the
// 0.80 match threshold), so no pair overlaps on outcomes. Eight programmes, because a code used by more
// than 25 % of the level is a service course: two of eight is exactly 25 %, so
// S1–S3 still count as major.
const shared = [course('S1', 3, 0), course('S2', 3, 0), course('S3', 3, 0)];
const progs: OverlapProgramme[] = [
  prog('p3', { courses: [course('X3', 3, 90)], plos: plo(90) }),
  prog('p2', { courses: [...shared, course('B1', 3, 170)], plos: plo(45) }),
  prog('p1', { courses: [...shared, course('A1', 3, 10)], plos: plo(0) }),
  ...['p4', 'p5', 'p6', 'p7', 'p8'].map((id, k) => prog(id, { courses: [course(`X${id}`, 3, 135 + k * 45)], plos: plo(135 + k * 45) })),
];

describe('planRunPairs', () => {
  it('scores every same-level pair and stores only the overlapping one', () => {
    const plan = planRunPairs(progs, { scopeProgramIds: [] });
    expect(plan.scored).toBe(28);
    expect(plan.stored.map((s) => [s.programAId, s.programBId])).toEqual([['p1', 'p2']]);
    expect(plan.stored[0]!.sharedCredits).toBe(9);
    expect(plan.all).toBeNull();
  });

  it('scores only the pairs touching the scoped programmes', () => {
    const plan = planRunPairs(progs, { scopeProgramIds: ['p3'] });
    expect(plan.scored).toBe(7);
    expect(plan.stored).toEqual([]);
  });

  it('orders every pair A < B by id whatever the input order', () => {
    const plan = planRunPairs([...progs].reverse(), { scopeProgramIds: [], keepAll: true });
    expect(plan.all).toHaveLength(28);
    for (const s of plan.all!) expect(s.programAId < s.programBId).toBe(true);
  });

  it('judges service courses against the whole level in a scoped run', () => {
    const scoped = planRunPairs(progs, { scopeProgramIds: ['p1'] });
    expect(scoped.stored.map((s) => s.sharedCredits)).toEqual([9]);
  });

  it("records every pair's best course and PLO cosine in the calibration histogram", () => {
    const plan = planRunPairs(progs, { scopeProgramIds: [] });
    expect(plan.histogram.bestCourse).toHaveLength(28);
    expect(plan.histogram.bestPlo).toHaveLength(28);
    expect(plan.histogram.containment).toHaveLength(56);
    // p1~p2: shared codes are excluded, so its best course pair is A1 (10°) vs
    // B1 (170°) — not S1 vs S1 (cosine 1).
    const cos160 = Math.cos((160 * Math.PI) / 180);
    expect(plan.histogram.bestCourse.some((x) => Math.abs(x - cos160) < 1e-10)).toBe(true);
    expect(Math.max(...plan.histogram.bestCourse)).toBeLessThan(0.99);
  });
});

describe('summarise', () => {
  it('is null for no data and gives nearest-rank quantiles otherwise', () => {
    expect(summarise([])).toBeNull();
    expect(summarise([5, 1, 3, 2, 4])).toEqual({ n: 5, p10: 1, p25: 2, p50: 3, p75: 4, p90: 4, max: 5 });
  });
});

describe('runProgramOverlap', () => {
  const coverage = { level: 'BACHELOR', programmes: 8 };
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset();
    mocks.load.mockResolvedValue({ programmes: progs, coverage });
    mocks.runCreate.mockResolvedValue({ id: 'run1' });
  });

  it('dry run computes and writes nothing', async () => {
    const r = await runProgramOverlap({ level: 'BACHELOR', apply: false });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ runId: null, scored: 28, stored: 1, scopeProgramIds: [] });
    expect(r[0]!.distributions.index?.n).toBeGreaterThan(0);
    expect(mocks.runCreate).not.toHaveBeenCalled();
    expect(mocks.pairCreateMany).not.toHaveBeenCalled();
  });

  it('apply writes the run, its pairs and marks it SUCCEEDED', async () => {
    const r = await runProgramOverlap({ level: 'BACHELOR', apply: true });
    expect(r[0]!.runId).toBe('run1');
    expect(mocks.runCreate.mock.calls[0]![0].data).toMatchObject({ level: 'BACHELOR', scopeProgramIds: [], methodologyVersion: 'program-overlap.v1' });
    const rows = mocks.pairCreateMany.mock.calls[0]![0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runId: 'run1', programAId: 'p1', programBId: 'p2', sharedCredits: 9 });
    expect(mocks.runUpdate.mock.calls[0]![0].data).toMatchObject({ status: 'SUCCEEDED', pairsScored: 28, pairsStored: 1 });
  });

  it('marks the run FAILED and rethrows when a write fails', async () => {
    mocks.pairCreateMany.mockRejectedValue(new Error('boom'));
    await expect(runProgramOverlap({ level: 'BACHELOR', apply: true })).rejects.toThrow('boom');
    expect(mocks.runUpdate.mock.calls[0]![0].data).toMatchObject({ status: 'FAILED', errorText: 'boom' });
  });

  it('a scoped run resolves its level and skips a programme not canonical there', async () => {
    mocks.programFindMany.mockResolvedValue([{ level: 'BACHELOR' }]);
    const r = await runProgramOverlap({ programIds: ['p3'], apply: false });
    expect(mocks.load).toHaveBeenCalledWith('BACHELOR');
    expect(r[0]).toMatchObject({ scopeProgramIds: ['p3'], scored: 7 });

    mocks.load.mockClear();
    const none = await runProgramOverlap({ programIds: ['nope'], level: 'BACHELOR', apply: true });
    expect(none).toEqual([]);
    expect(mocks.runCreate).not.toHaveBeenCalled();
  });
});
