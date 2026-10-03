import { beforeEach, describe, expect, it, vi } from 'vitest';

// Plain object-literal mock of @kku/db — nothing here can reach the dev
// database. The pure scoring core is imported straight from its source file.
const mocks = vi.hoisted(() => ({
  load: vi.fn(),
  programFindMany: vi.fn(),
  runCreate: vi.fn(),
  runUpdate: vi.fn(),
  pairCreateMany: vi.fn(),
  transaction: vi.fn(),
  pairFindMany: vi.fn(),
  enrollFindMany: vi.fn(),
  marketFindMany: vi.fn(),
  recUpsert: vi.fn(),
  recFindMany: vi.fn(),
}));

vi.mock('@kku/db', async () => {
  const score = await import('../../../packages/db/src/program-overlap/score');
  return {
    ...score,
    byCodeUnits: (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0),
    loadOverlapProgrammes: mocks.load,
    realDataWhere: () => ({ ingestionRun: { dataSource: { mocked: false } } }),
    prisma: {
      program: { findMany: mocks.programFindMany },
      programOverlapRun: { create: mocks.runCreate, update: mocks.runUpdate },
      programOverlapPair: { createMany: mocks.pairCreateMany, findMany: mocks.pairFindMany },
      enrollmentMetric: { findMany: mocks.enrollFindMany },
      programMarketProfile: { findMany: mocks.marketFindMany },
      programOverlapRecommendation: { upsert: mocks.recUpsert, findMany: mocks.recFindMany },
      $transaction: mocks.transaction,
    },
  };
});

import type { OverlapProgramme } from '../../../packages/db/src/program-overlap/score';
import { levelsFor, pairRow, planRunPairs, runOverlapRecommendations, runProgramOverlap, summarise } from '../src/program-overlap/run';
import type { AiService } from '@kku/shared';
import { PROGRAM_OVERLAP_RECOMMENDATION_VERSION } from '@kku/shared';
import { parseOverlapArgs } from '../src/program-overlap/cli-args';

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
  // Writes are modelled as Prisma does them: createMany / update build an
  // operation, and only $transaction (or awaiting a standalone call) commits.
  type Op = { op: string; args: { data: unknown } };
  let committed: Op[];
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset();
    committed = [];
    mocks.load.mockResolvedValue({ programmes: progs, coverage });
    mocks.runCreate.mockResolvedValue({ id: 'run1' });
    mocks.pairCreateMany.mockImplementation((args) => ({ op: 'pairs', args }));
    mocks.runUpdate.mockImplementation((args) => ({ op: 'runUpdate', args }));
    mocks.transaction.mockImplementation(async (ops: Op[]) => {
      committed.push(...ops);
      return ops;
    });
  });
  const committedStatuses = () =>
    committed.filter((o) => o.op === 'runUpdate').map((o) => (o.args.data as { status: string }).status);

  it('dry run computes and writes nothing', async () => {
    const r = await runProgramOverlap({ level: 'BACHELOR', apply: false });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ runId: null, scored: 28, stored: 1, scopeProgramIds: [] });
    expect(r[0]!.distributions.index?.n).toBeGreaterThan(0);
    expect(mocks.runCreate).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it('apply writes the pairs and the SUCCEEDED flip in one transaction', async () => {
    const r = await runProgramOverlap({ level: 'BACHELOR', apply: true });
    expect(r[0]!.runId).toBe('run1');
    expect(mocks.runCreate.mock.calls[0]![0].data).toMatchObject({ level: 'BACHELOR', scopeProgramIds: [], methodologyVersion: 'program-overlap.v1' });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(committed.map((o) => o.op)).toEqual(['pairs', 'runUpdate']);
    const rows = committed[0]!.args.data as Array<Record<string, unknown>>;
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ runId: 'run1', programAId: 'p1', programBId: 'p2', sharedCredits: 9 });
    expect(committed[1]!.args.data).toMatchObject({ status: 'SUCCEEDED', pairsScored: 28, pairsStored: 1 });
  });

  it('splits more than 500 stored pairs into batches inside the same transaction', async () => {
    // Forty programmes with one staff member in common: every one of the 780
    // pairs is stored (shared staff), with no courses needed.
    const many = Array.from({ length: 40 }, (_, i) =>
      prog(`q${String(i).padStart(2, '0')}`, { staffIds: ['shared-staff'] }),
    );
    mocks.load.mockResolvedValue({ programmes: many, coverage });
    const r = await runProgramOverlap({ level: 'BACHELOR', apply: true });
    expect(r[0]!.stored).toBe(780); // 40·39/2, every pair shares a staff member
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    const batches = committed.filter((o) => o.op === 'pairs').map((o) => (o.args.data as unknown[]).length);
    expect(batches).toEqual([500, 280]);
    expect(committed.at(-1)!.op).toBe('runUpdate');
    expect(committedStatuses()).toEqual(['SUCCEEDED']);
  });

  it('on failure marks the run FAILED, never commits SUCCEEDED, and rethrows', async () => {
    mocks.transaction.mockRejectedValue(new Error('boom'));
    await expect(runProgramOverlap({ level: 'BACHELOR', apply: true })).rejects.toThrow('boom');
    expect(committedStatuses()).toEqual([]);
    const last = mocks.runUpdate.mock.calls.at(-1)![0];
    expect(last.data).toMatchObject({ status: 'FAILED', errorText: 'boom' });
  });

  it('a failure to mark FAILED never masks the original error', async () => {
    mocks.transaction.mockRejectedValue(new Error('boom'));
    mocks.runUpdate.mockImplementation((args: { data: { status: string } }) => {
      if (args.data.status === 'FAILED') throw new Error('db down');
      return { op: 'runUpdate', args };
    });
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(runProgramOverlap({ level: 'BACHELOR', apply: true })).rejects.toThrow('boom');
    err.mockRestore();
  });

  it('writes no run for a level with fewer than two programmes', async () => {
    mocks.load.mockResolvedValue({ programmes: [progs[0]!], coverage });
    expect(await runProgramOverlap({ level: 'BACHELOR', apply: true })).toEqual([]);
    expect(mocks.runCreate).not.toHaveBeenCalled();
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

describe('levelsFor', () => {
  beforeEach(() => mocks.programFindMany.mockReset());
  it('runs all four levels with no level and no programmes', async () => {
    expect(await levelsFor({})).toEqual(['BACHELOR', 'MASTER', 'DOCTORAL', 'HIGHER_GRAD_DIPLOMA']);
    expect(mocks.programFindMany).not.toHaveBeenCalled();
  });
  it('uses the given level, or the levels of the scoped programmes in canonical order', async () => {
    expect(await levelsFor({ level: 'MASTER', programIds: ['x'] })).toEqual(['MASTER']);
    mocks.programFindMany.mockResolvedValue([{ level: 'DOCTORAL' }, { level: 'BACHELOR' }, { level: 'DOCTORAL' }]);
    expect(await levelsFor({ programIds: ['a', 'b', 'c'] })).toEqual(['BACHELOR', 'DOCTORAL']);
  });
});

describe('pairRow', () => {
  it('maps every stored field, including hash, actions and the language flag', () => {
    const same = [course('C1', 3, 0), course('C2', 3, 0), course('C3', 3, 0)];
    const ploSame = plo(0);
    const s = planRunPairs(
      [
        prog('a', { courses: same, plos: ploSame, nameTh: 'X', language: 'TH' }),
        prog('b', { courses: same, plos: ploSame, nameTh: 'X (หลักสูตรนานาชาติ)', language: 'EN' }),
        ...['f1', 'f2', 'f3', 'f4', 'f5', 'f6'].map((id) => prog(id)),
      ],
      { scopeProgramIds: ['a'] },
    ).stored.find((x) => x.programBId === 'b')!;
    const row = pairRow('run9', 'BACHELOR', s);
    expect(row).toMatchObject({
      runId: 'run9', level: 'BACHELOR', programAId: 'a', programBId: 'b',
      structure: s.structure, content: s.content, outcome: s.outcome, overlapIndex: s.overlapIndex,
      containmentAInB: s.containmentAInB, containmentBInA: s.containmentBInA, band: s.band,
      sharedCredits: 9, equivCredits: s.equivCredits, sharedStaff: 0, marketSimilarity: null,
      languageVariant: true, actions: s.actions, primaryAction: s.primaryAction,
      evidenceHash: s.evidenceHash, methodologyVersion: 'program-overlap.v1',
    });
    expect(s.actions.length).toBeGreaterThan(0);
    expect(s.actions).not.toContain('CONSIDER_MERGE_OR_TRACK');
    expect(row.evidenceJson).toEqual(s.evidence);
  });
});

describe('market cosine histogram', () => {
  it('records the raw cosine beside the rescaled similarity', () => {
    const plan = planRunPairs(
      [prog('m1', { marketVector: v(0) }), prog('m2', { marketVector: v(60) }), prog('m3')],
      { scopeProgramIds: [] },
    );
    expect(plan.histogram.marketCosine).toHaveLength(1);
    expect(plan.histogram.marketCosine[0]).toBeCloseTo(0.5, 10);
    expect(plan.histogram.market).toEqual([0]); // 0.5 is under the 0.80 floor
  });
});

describe('parseOverlapArgs', () => {
  it('accepts --level=X and --level X, case-insensitively', () => {
    expect(parseOverlapArgs(['--level=master', '--apply'])).toEqual({ level: 'MASTER', apply: true, noAi: false, calibrate: false });
    expect(parseOverlapArgs(['--level', 'DOCTORAL', '--calibrate', '--no-ai'])).toEqual({
      level: 'DOCTORAL', apply: false, noAi: true, calibrate: true,
    });
    expect(parseOverlapArgs([])).toEqual({ level: undefined, apply: false, noAi: false, calibrate: false });
  });
  it('rejects unknown flags, unknown levels and a missing value', () => {
    expect(() => parseOverlapArgs(['--aply'])).toThrow(/unknown argument "--aply"/);
    expect(() => parseOverlapArgs(['BACHELOR'])).toThrow(/unknown argument/);
    expect(() => parseOverlapArgs(['--level=PHD'])).toThrow(/unknown --level=PHD/);
    expect(() => parseOverlapArgs(['--level'])).toThrow(/--level needs a value/);
    expect(() => parseOverlapArgs(['--level', '--apply'])).toThrow(/--level needs a value/);
    expect(() => parseOverlapArgs(['--apply=yes'])).toThrow(/unknown argument/);
  });
});

describe('runOverlapRecommendations', () => {
  const evidence = {
    sharedCourses: [{ code: 'S1', credits: 3, nameTh: 'วิชา' }],
    equivalentCourses: [{ codeA: 'A1', codeB: 'B1', nameA: 'a', nameB: 'b', credits: 3, similarity: 0.923456, basis: 'name' }],
    matchedPlos: [{ ordinalA: 1, ordinalB: 1, textA: 'x', textB: 'y', similarity: 0.85 }],
    unmatchedPlosA: [], unmatchedPlosB: ['z'],
    coverage: {
      majorCoursesA: 5, majorCoursesB: 5, embeddedA: 5, embeddedB: 5, describedA: 5, describedB: 5,
      descriptionMatches: 0, plosA: 3, plosB: 4, defaultedCredits: 0,
    },
  };
  const pp = (code: string) => ({ code, nameTh: code, nameEn: null, faculty: { nameEn: 'Science' } });
  const pair = (id: string, over: Record<string, unknown> = {}) => ({
    id, runId: 'r1', level: 'BACHELOR', programAId: `${id}-a`, programBId: `${id}-b`,
    programA: pp(`${id}-A`), programB: pp(`${id}-B`),
    structure: 50.4, content: 60.6, outcome: 55, overlapIndex: 60.2, containmentAInB: 40, containmentBInA: 40,
    band: 'MODERATE', sharedCredits: 3, equivCredits: 3, sharedStaff: 1, marketSimilarity: 80,
    languageVariant: false,
    // Stored weakest-first, as score.ts pushes them.
    actions: ['COORDINATE_SHARED_COURSES', 'DIFFERENTIATE'], primaryAction: 'DIFFERENTIATE',
    evidenceJson: evidence, evidenceHash: `h-${id}`, methodologyVersion: 'program-overlap.v1',
    createdAt: new Date(), ...over,
  });
  const parsed = {
    rationale: 'r'.repeat(100), distinctiveA: 'distinct A text', distinctiveB: 'distinct B text',
    nextSteps: ['step one here', 'step two here'], confidence: 0.95,
    disagreesWithAction: false, disagreementReason: 'ignored',
  };
  const okResponse = { parsed, confidence: 1, rawText: '', tokens: {}, model: 'm', latencyMs: 1, cost: { usd: 0.02 }, aiInferenceId: 'inf-1' };
  type Req = { ctx: { module: string; kind: string }; methodVersion: string; maxOutputTokens: number; messages: Array<{ content: string }> };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.enrollFindMany.mockResolvedValue([
      { programId: 'p1-a', academicYear: 2025, enrolled: 80 },
      { programId: 'p1-a', academicYear: 2024, enrolled: 70 },
    ]);
    mocks.marketFindMany.mockResolvedValue([{ programId: 'p1-a', text: 'market A' }]);
    mocks.recUpsert.mockResolvedValue({});
    mocks.recFindMany.mockResolvedValue([]);
  });

  it('filters flagged pairs in the query, upserts with the inference id, and survives a failure', async () => {
    mocks.pairFindMany.mockResolvedValue([pair('p1'), pair('boom')]);
    const extract = vi.fn(async (req: Req) => {
      if (req.messages[1]!.content.includes('boom-A')) throw new Error('model down');
      return okResponse;
    });
    const ai = { extractStructured: extract } as unknown as AiService;
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const res = await runOverlapRecommendations({ ai, runIds: ['r1'] });

    expect(mocks.pairFindMany.mock.calls[0]![0].where).toEqual({
      runId: { in: ['r1'] }, actions: { isEmpty: false }, overlapIndex: { gte: 50 },
    });
    expect(extract).toHaveBeenCalledTimes(2);
    expect(res).toEqual({ written: 1, skipped: 0, failed: 1, costUsd: 0.02 });
    expect(errSpy).toHaveBeenCalledOnce();
    const req = extract.mock.calls[0]![0];
    expect(req.ctx).toMatchObject({ module: 'program-overlap', kind: 'recommendation' });
    expect(req.methodVersion).toBe(PROGRAM_OVERLAP_RECOMMENDATION_VERSION);
    expect(req.maxOutputTokens).toBe(4000);
    const user = JSON.parse(req.messages[1]!.content);
    expect(user.actions).toEqual(['DIFFERENTIATE', 'COORDINATE_SHARED_COURSES']);
    expect(user.primaryAction).toBe('DIFFERENTIATE');
    expect(user.scores).toMatchObject({ structure: 50, content: 61, overlapIndex: 60 });
    expect(user.programA.latestEnrolled).toBe(80);
    expect(user.programB.latestEnrolled).toBeNull();
    expect(user.marketTextA).toBe('market A');
    expect(user.marketTextB).toBeNull();
    expect(user.evidence.equivalentCourses).toEqual({
      items: [{ codeA: 'A1', codeB: 'B1', nameA: 'a', nameB: 'b', credits: 3, similarity: 0.92, basis: 'name' }],
      omitted: 0,
    });

    const call = mocks.recUpsert.mock.calls[0]![0];
    expect(call.where).toEqual({ pairId: 'p1' });
    expect(call.create).toMatchObject({
      pairId: 'p1', aiInferenceId: 'inf-1', evidenceHash: 'h-p1', promptVersion: PROGRAM_OVERLAP_RECOMMENDATION_VERSION,
      disagreementReason: null,
    });
    // name-only equivalence and a missing market text cap the self-reported 0.95
    expect(call.create.confidence).toBeLessThan(0.95);
    errSpy.mockRestore();
  });

  it('copies a matching recommendation from an older run instead of calling the AI', async () => {
    mocks.pairFindMany.mockResolvedValue([pair('p1', { id: 'new-pair' }), pair('p2')]);
    mocks.recFindMany.mockResolvedValue([
      {
        id: 'rec-old', pairId: 'old-pair', rationale: 'old rationale', distinctiveA: 'dA', distinctiveB: 'dB',
        nextSteps: ['s1', 's2'], confidence: 0.6, disagreesWithAction: false, disagreementReason: null,
        promptVersion: PROGRAM_OVERLAP_RECOMMENDATION_VERSION, aiInferenceId: 'inf-old', evidenceHash: 'h-p1',
        createdAt: new Date(), pair: { programAId: 'p1-a', programBId: 'p1-b', level: 'BACHELOR' },
      },
      // Same hash, but a different programme pair: must not be copied.
      {
        id: 'rec-x', pairId: 'x', rationale: 'x', distinctiveA: 'x', distinctiveB: 'x', nextSteps: [], confidence: 0.5,
        disagreesWithAction: false, disagreementReason: null, promptVersion: PROGRAM_OVERLAP_RECOMMENDATION_VERSION,
        aiInferenceId: 'inf-x', evidenceHash: 'h-p2', createdAt: new Date(),
        pair: { programAId: 'other-a', programBId: 'p2-b', level: 'BACHELOR' },
      },
    ]);
    const extract = vi.fn(async () => okResponse);
    const ai = { extractStructured: extract } as unknown as AiService;

    const res = await runOverlapRecommendations({ ai, runIds: ['r2'] });

    expect(mocks.recFindMany.mock.calls[0]![0].where).toEqual({
      evidenceHash: { in: ['h-p1', 'h-p2'] }, promptVersion: PROGRAM_OVERLAP_RECOMMENDATION_VERSION,
    });
    expect(extract).toHaveBeenCalledTimes(1); // only p2
    expect(res).toEqual({ written: 1, skipped: 1, failed: 0, costUsd: 0.02 });
    const copy = mocks.recUpsert.mock.calls.find((c) => c[0].where.pairId === 'new-pair')![0];
    expect(copy.create).toMatchObject({
      pairId: 'new-pair', rationale: 'old rationale', aiInferenceId: 'inf-old', evidenceHash: 'h-p1', confidence: 0.6,
    });
  });

  it('skips without writing when the pair already carries a matching recommendation', async () => {
    mocks.pairFindMany.mockResolvedValue([pair('p1')]);
    mocks.recFindMany.mockResolvedValue([
      {
        id: 'rec', pairId: 'p1', rationale: 'r', distinctiveA: 'a', distinctiveB: 'b', nextSteps: ['s', 't'],
        confidence: 0.6, disagreesWithAction: false, disagreementReason: null,
        promptVersion: PROGRAM_OVERLAP_RECOMMENDATION_VERSION, aiInferenceId: 'inf', evidenceHash: 'h-p1',
        createdAt: new Date(), pair: { programAId: 'p1-a', programBId: 'p1-b', level: 'BACHELOR' },
      },
    ]);
    const extract = vi.fn();
    const res = await runOverlapRecommendations({ ai: { extractStructured: extract } as unknown as AiService, runIds: ['r1'] });
    expect(extract).not.toHaveBeenCalled();
    expect(mocks.recUpsert).not.toHaveBeenCalled();
    expect(res).toEqual({ written: 0, skipped: 1, failed: 0, costUsd: 0 });
  });

  it('caps each evidence list at 25, strongest first, with an omitted count', async () => {
    const many = {
      ...evidence,
      sharedCourses: Array.from({ length: 30 }, (_, k) => ({ code: `S${k}`, credits: k, nameTh: null })),
      unmatchedPlosB: Array.from({ length: 27 }, (_, k) => `plo ${k}`),
    };
    mocks.pairFindMany.mockResolvedValue([pair('p1', { evidenceJson: many })]);
    const extract = vi.fn(async (_req: Req) => okResponse);
    await runOverlapRecommendations({ ai: { extractStructured: extract } as unknown as AiService, runIds: ['r1'] });
    const user = JSON.parse(extract.mock.calls[0]![0].messages[1]!.content);
    expect(user.evidence.sharedCourses.items).toHaveLength(25);
    expect(user.evidence.sharedCourses.items[0].credits).toBe(29);
    expect(user.evidence.sharedCourses.omitted).toBe(5);
    expect(user.evidence.unmatchedPlosB.items[0]).toBe('plo 0');
    expect(user.evidence.unmatchedPlosB.omitted).toBe(2);
  });

  it('does nothing without run ids', async () => {
    const ai = { extractStructured: vi.fn() } as unknown as AiService;
    expect(await runOverlapRecommendations({ ai, runIds: [] })).toEqual({ written: 0, skipped: 0, failed: 0, costUsd: 0 });
    expect(mocks.pairFindMany).not.toHaveBeenCalled();
  });
});
