import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OverlapAction, OverlapBand } from '@prisma/client';

const mocks = vi.hoisted(() => ({
  runFindFirst: vi.fn(),
  runFindMany: vi.fn(),
  pairFindMany: vi.fn(),
  pairFindUnique: vi.fn(),
  programFindMany: vi.fn(),
  programFindUnique: vi.fn(),
  recFindMany: vi.fn(),
  breachFindMany: vi.fn(),
  assessmentFindMany: vi.fn(),
  measureFindMany: vi.fn(),
  programFunnelRoundRows: vi.fn(),
}));

// No real client: nothing here can reach the dev database.
vi.mock('../src/index', () => ({
  prisma: {
    programOverlapRun: { findFirst: mocks.runFindFirst, findMany: mocks.runFindMany },
    programOverlapPair: { findMany: mocks.pairFindMany, findUnique: mocks.pairFindUnique },
    program: { findMany: mocks.programFindMany, findUnique: mocks.programFindUnique },
    programOverlapRecommendation: { findMany: mocks.recFindMany },
    riskIndicatorBreach: { findMany: mocks.breachFindMany },
    riskAssessment: { findMany: mocks.assessmentFindMany },
    riskMeasure: { findMany: mocks.measureFindMany },
  },
}));
vi.mock('../src/program-funnel', () => ({ programFunnelRoundRows: mocks.programFunnelRoundRows }));
vi.mock('../src/academic-year', () => ({
  academicYearContextSync: () => ({ latestCompleteEntryYearBE: 2568 }),
}));

import {
  overlapMatrix,
  overlapMatrixKpis,
  overlapPairDetail,
  parsePairEvidence,
  programOverlapSection,
  selfCompetitionRows,
} from '../src/program-overlap/read';
import { PROGRAM_OVERLAP_VERSION } from '../src/program-overlap/score';

const evidence = {
  sharedCourses: [{ code: 'AA100', credits: 3, nameTh: 'ก' }],
  equivalentCourses: [],
  matchedPlos: [],
  unmatchedPlosA: [],
  unmatchedPlosB: [],
  coverage: {
    majorCoursesA: 10, majorCoursesB: 10, embeddedA: 10, embeddedB: 10, describedA: 10, describedB: 10,
    descriptionMatches: 0, plosA: 5, plosB: 5, defaultedCredits: 0,
    courseLayers: 2,
  },
};

const run = (id: string, day: number, scope: string[] = []) => ({
  id, status: 'SUCCEEDED' as const, scopeProgramIds: scope, completedAt: new Date(Date.UTC(2026, 9, day)),
  level: 'BACHELOR' as const, methodologyVersion: PROGRAM_OVERLAP_VERSION, startedAt: new Date(Date.UTC(2026, 9, day)),
});

interface PairOpts {
  index?: number | null;
  market?: number | null;
  band?: OverlapBand;
  actions?: OverlapAction[];
  equiv?: number;
  lv?: boolean;
  ev?: unknown;
}
const pair = (runId: string, a: string, b: string, o: PairOpts = {}) => ({
  id: `${runId}:${a}-${b}`, runId, level: 'BACHELOR' as const, programAId: a, programBId: b,
  structure: 40, content: 50, outcome: 60, overlapIndex: o.index === undefined ? 55 : o.index,
  containmentAInB: 70, containmentBInA: 30, band: o.band ?? 'MODERATE',
  sharedCredits: 6, equivCredits: o.equiv ?? 0, sharedStaff: 1, marketSimilarity: o.market ?? null,
  languageVariant: o.lv ?? false, actions: o.actions ?? [], primaryAction: o.actions?.at(-1) ?? null,
  evidenceJson: o.ev === undefined ? evidence : o.ev, evidenceHash: 'h', methodologyVersion: PROGRAM_OVERLAP_VERSION, createdAt: new Date(),
});
const prog = (id: string, facultyId = 'f1') => ({
  id, code: `C-${id}`, nameTh: `th-${id}`, nameEn: `en-${id}`, facultyId, faculty: { code: facultyId.toUpperCase(), nameEn: facultyId },
});

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();
  mocks.recFindMany.mockResolvedValue([]);
});

describe('overlapMatrix', () => {
  it('reads the latest full run with newer scoped runs overlaid per pair', async () => {
    mocks.runFindFirst.mockResolvedValue({ completedAt: run('f', 1).completedAt });
    mocks.runFindMany.mockResolvedValue([run('f', 1), run('s', 2, ['a'])]);
    // The scoped run drops f:a-b (a is in its scope) and adds s:a-c.
    mocks.pairFindMany.mockResolvedValue([pair('f', 'a', 'b'), pair('f', 'b', 'c'), pair('s', 'a', 'c', { index: 80, band: 'HIGH' })]);
    mocks.programFindMany.mockResolvedValue([prog('a'), prog('b'), prog('c')]);
    const m = await overlapMatrix({ level: 'BACHELOR' });
    expect(m.runId).toBe('f');
    expect(m.completedAt).toBe(run('s', 2).completedAt.toISOString());
    expect(m.cells.map((c) => c.pairId).sort()).toEqual(['f:b-c', 's:a-c']);
    expect(m.methodologyVersion).toBe(PROGRAM_OVERLAP_VERSION);
    expect([...m.order].sort()).toEqual(['a', 'b', 'c']);
    // Only canonical ACTIVE programmes are compared (D5).
    expect(mocks.programFindMany.mock.calls[0]![0].where).toMatchObject({ status: 'ACTIVE', level: 'BACHELOR' });
  });

  it('carries the number of course layers from the stored layer columns (D9)', async () => {
    mocks.runFindFirst.mockResolvedValue({ completedAt: run('f', 1).completedAt });
    mocks.runFindMany.mockResolvedValue([run('f', 1)]);
    const base = pair('f', 'a', 'b');
    mocks.pairFindMany.mockResolvedValue([
      base,
      { ...pair('f', 'a', 'c', { index: null, band: 'NONE' }), structure: null, content: null, outcome: 100 },
      { ...pair('f', 'b', 'c', { ev: { not: 'evidence' } }), content: null },
    ]);
    mocks.programFindMany.mockResolvedValue([prog('a'), prog('b'), prog('c')]);
    const m = await overlapMatrix({ level: 'BACHELOR' });
    expect(Object.fromEntries(m.cells.map((c) => [c.pairId, c.courseLayers]))).toEqual({
      'f:a-b': 2,
      'f:a-c': 0,
      // Unparseable evidence does not matter: the layer columns decide.
      'f:b-c': 1,
    });
  });

  it('returns an empty matrix when no run exists', async () => {
    mocks.runFindFirst.mockResolvedValue(null);
    mocks.runFindMany.mockResolvedValue([]);
    const m = await overlapMatrix({ level: 'MASTER' });
    expect(m).toMatchObject({ runId: null, completedAt: null, programmes: [], cells: [], level: 'MASTER' });
    expect(mocks.programFindMany).not.toHaveBeenCalled();
  });

  it('faculty scope keeps outside programmes only when they pair with an in-scope one', async () => {
    mocks.runFindFirst.mockResolvedValue({ completedAt: run('f', 1).completedAt });
    mocks.runFindMany.mockResolvedValue([run('f', 1)]);
    mocks.pairFindMany.mockResolvedValue([
      pair('f', 'a', 'x'), // a in scope, x outside → x shown
      pair('f', 'x', 'y'), // both outside → dropped; y not shown
    ]);
    mocks.programFindMany.mockResolvedValue([prog('a', 'f1'), prog('b', 'f1'), prog('x', 'f2'), prog('y', 'f2')]);
    const m = await overlapMatrix({ level: 'BACHELOR', facultyId: 'f1' });
    expect(m.programmes.map((p) => p.id).sort()).toEqual(['a', 'b', 'x']);
    expect(m.cells.map((c) => c.pairId)).toEqual(['f:a-x']);
    expect(m.programmes.find((p) => p.id === 'x')).toMatchObject({ facultyCode: 'F2', facultyNameEn: 'f2' });
  });

  it('orders by the selected layer', async () => {
    mocks.runFindFirst.mockResolvedValue({ completedAt: run('f', 1).completedAt });
    mocks.runFindMany.mockResolvedValue([run('f', 1)]);
    // Market puts a next to d; the index puts a next to b.
    mocks.pairFindMany.mockResolvedValue([
      pair('f', 'a', 'b', { index: 90, market: 0 }),
      pair('f', 'a', 'd', { index: 0, market: 95 }),
      pair('f', 'b', 'c', { index: 80, market: 0 }),
    ]);
    mocks.programFindMany.mockResolvedValue([prog('a'), prog('b'), prog('c'), prog('d')]);
    const byIndex = await overlapMatrix({ level: 'BACHELOR', layer: 'index' });
    const byMarket = await overlapMatrix({ level: 'BACHELOR', layer: 'market' });
    const adj = (o: string[], x: string, y: string) => Math.abs(o.indexOf(x) - o.indexOf(y)) === 1;
    expect(adj(byIndex.order, 'a', 'b')).toBe(true);
    expect(adj(byMarket.order, 'a', 'd')).toBe(true);
    expect(byMarket.layer).toBe('market');
  });

  it('computes the KPIs', () => {
    const pairs = [
      { band: 'HIGH' as const, languageVariant: true, actions: [] as OverlapAction[], equivCredits: 9 },
      { band: 'HIGH' as const, languageVariant: false, actions: ['CONSIDER_MERGE_OR_TRACK', 'CONSOLIDATE_EQUIVALENT_COURSES'] as OverlapAction[], equivCredits: 6 },
      { band: 'MODERATE' as const, languageVariant: false, actions: ['CONSOLIDATE_EQUIVALENT_COURSES'] as OverlapAction[], equivCredits: 4.5 },
      { band: 'LOW' as const, languageVariant: false, actions: [] as OverlapAction[], equivCredits: 3 },
    ];
    const k = overlapMatrixKpis(pairs, [{ members: ['a', 'b', 'c'], peakIndex: 80 }, { members: ['d', 'e'], peakIndex: 55 }]);
    expect(k).toEqual({
      highPairs: 2, highLanguageVariantPairs: 1, programmesInGroups: 5, mergeCandidates: 1, consolidatableCredits: 10.5,
    });
  });
});

describe('programOverlapSection', () => {
  it('returns null when no run covers the programme', async () => {
    mocks.programFindUnique.mockResolvedValue({ level: 'BACHELOR' });
    mocks.runFindFirst.mockResolvedValue(null);
    mocks.runFindMany.mockResolvedValue([run('s', 2, ['other'])]);
    mocks.pairFindMany.mockResolvedValue([]);
    expect(await programOverlapSection('a')).toBeNull();
  });

  it('returns siblings: [] when no sibling reaches 30 (market-only pairs are not siblings)', async () => {
    mocks.programFindUnique.mockResolvedValue({ level: 'BACHELOR' });
    mocks.runFindFirst.mockResolvedValue({ completedAt: run('f', 1).completedAt });
    mocks.runFindMany.mockResolvedValue([run('f', 1)]);
    mocks.pairFindMany.mockResolvedValue([pair('f', 'a', 'b', { index: 20, market: 80 }), pair('f', 'a', 'c', { index: null, market: 70 })]);
    const s = await programOverlapSection('a');
    expect(s).toEqual({ programId: 'a', methodologyVersion: PROGRAM_OVERLAP_VERSION, completedAt: run('f', 1).completedAt.toISOString(), siblings: [] });
  });

  it('orients siblings to the programme and sorts by index desc', async () => {
    mocks.programFindUnique.mockResolvedValue({ level: 'BACHELOR' });
    mocks.runFindFirst.mockResolvedValue({ completedAt: run('f', 1).completedAt });
    mocks.runFindMany.mockResolvedValue([run('f', 1)]);
    mocks.pairFindMany.mockResolvedValue([pair('f', 'a', 'b', { index: 40 }), pair('f', 'c', 'a', { index: 75, band: 'HIGH' })]);
    mocks.programFindMany.mockResolvedValue([prog('b'), prog('c')]);
    mocks.recFindMany.mockResolvedValue([{
      id: 'r', pairId: 'f:c-a', rationale: 'x', distinctiveA: 'da', distinctiveB: 'db', nextSteps: ['n'], confidence: 0.8,
      disagreesWithAction: false, disagreementReason: null, promptVersion: 'p.v1', aiInferenceId: 'ai', evidenceHash: 'old',
      createdAt: new Date(0),
    }]);
    const s = await programOverlapSection('a');
    expect(s!.siblings.map((x) => x.sibling.id)).toEqual(['c', 'b']);
    const c = s!.siblings[0]!;
    expect(c.programIsA).toBe(false);
    expect(c.containmentInSibling).toBe(30); // a is B: containmentBInA
    expect(c.siblingContainmentInProgramme).toBe(70);
    expect(c.recommendation).toMatchObject({ rationale: 'x', stale: true });
    expect(c.evidence?.sharedCourses[0]?.code).toBe('AA100');
    expect(s!.siblings[1]!.recommendation).toBeNull();
  });
});

describe('parsePairEvidence / overlapPairDetail', () => {
  it('returns null for malformed evidence rather than casting', () => {
    expect(parsePairEvidence({ sharedCourses: 'nope' })).toBeNull();
    expect(parsePairEvidence(evidence)).toEqual(evidence);
  });

  it('flags a superseded pair row as not current', async () => {
    const p = pair('f', 'a', 'b');
    mocks.pairFindUnique.mockResolvedValue({
      ...p, recommendation: null, run: { completedAt: run('f', 1).completedAt }, programA: prog('a'), programB: prog('b'),
    });
    mocks.runFindFirst.mockResolvedValue({ completedAt: run('f', 1).completedAt });
    mocks.runFindMany.mockResolvedValue([run('f', 1), run('s', 2, ['a'])]);
    mocks.pairFindMany.mockResolvedValue([p]);
    const d = await overlapPairDetail(p.id);
    expect(d).toMatchObject({ pairId: p.id, isCurrent: false, programA: { id: 'a' }, programB: { id: 'b' }, recommendation: null });
  });

  it('returns null for an unknown pair', async () => {
    mocks.pairFindUnique.mockResolvedValue(null);
    expect(await overlapPairDetail('nope')).toBeNull();
  });
});

describe('selfCompetitionRows', () => {
  it('lists the pairs behind the latest WARN/CRITICAL breach, with intake and triggered measures', async () => {
    mocks.breachFindMany.mockResolvedValue([
      // newest first: a's latest curriculum reading is CRITICAL; the older OK is ignored.
      { programId: 'a', indicatorSlug: 'curriculum_overlap_max', severity: 'CRITICAL', value: 80, observedAt: new Date(2), program: { level: 'BACHELOR' } },
      { programId: 'b', indicatorSlug: 'curriculum_overlap_max', severity: 'CRITICAL', value: 80, observedAt: new Date(2), program: { level: 'BACHELOR' } },
      { programId: 'c', indicatorSlug: 'market_confusion_max', severity: 'OK', value: 10, observedAt: new Date(2), program: { level: 'BACHELOR' } },
      { programId: 'a', indicatorSlug: 'curriculum_overlap_max', severity: 'OK', value: 10, observedAt: new Date(1), program: { level: 'BACHELOR' } },
    ]);
    mocks.runFindFirst.mockResolvedValue({ completedAt: run('f', 1).completedAt });
    mocks.runFindMany.mockResolvedValue([run('f', 1)]);
    mocks.pairFindMany.mockResolvedValue([pair('f', 'a', 'b', { index: 80, band: 'HIGH', actions: ['CONSIDER_MERGE_OR_TRACK'] }), pair('f', 'a', 'c', { index: 40 })]);
    mocks.programFindMany.mockResolvedValue([prog('a'), prog('b')]);
    mocks.assessmentFindMany.mockResolvedValue([{ id: 'as-a2', programId: 'a' }, { id: 'as-a1', programId: 'a' }, { id: 'as-b', programId: 'b' }]);
    mocks.measureFindMany.mockResolvedValue([
      { assessmentId: 'as-a2', kind: 'PROGRAM_MERGE', evidenceJson: { siblingProgramId: 'b', overlapPairId: 'old' } },
      { assessmentId: 'as-b', kind: 'CURRICULUM_DIFFERENTIATE', evidenceJson: { overlapPairId: 'f:a-b' } },
      { assessmentId: 'as-b', kind: 'RECRUITMENT_CHANNEL', evidenceJson: { siblingProgramId: 'zzz' } },
    ]);
    mocks.programFunnelRoundRows.mockImplementation(async (id: string) =>
      id === 'a'
        ? [
            { entryYearBE: 2569, regReported: 99 }, // in progress, excluded
            { entryYearBE: 2568, regReported: 20 },
            { entryYearBE: 2568, regReported: 5 },
          ]
        : [],
    );
    const rows = await selfCompetitionRows({ level: 'BACHELOR' });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      pairId: 'f:a-b', overlapIndex: 80, intakeA: 25, intakeEntryYearA: 2568, intakeB: null,
      measureKinds: ['CURRICULUM_DIFFERENTIATE', 'PROGRAM_MERGE'],
    });
    expect(rows[0]!.breaches.map((b) => b.programId)).toEqual(['a', 'b']);
    // only the latest assessment's measures are read
    expect(mocks.measureFindMany.mock.calls[0]![0].where.assessmentId.in.sort()).toEqual(['as-a2', 'as-b']);
  });

  it('returns nothing for a scoped caller with no grants, without querying', async () => {
    expect(await selfCompetitionRows({ facultyIds: [], programIds: [] })).toEqual([]);
    expect(mocks.breachFindMany).not.toHaveBeenCalled();
  });
});
