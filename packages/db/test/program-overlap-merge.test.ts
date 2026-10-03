import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OverlapAction, OverlapRunStatus } from '@prisma/client';

const mocks = vi.hoisted(() => ({ runFindFirst: vi.fn(), runFindMany: vi.fn(), pairFindMany: vi.fn(), programFindMany: vi.fn() }));

// No real client: nothing here can reach the dev database.
vi.mock('../src/index', () => ({
  prisma: {
    programOverlapRun: { findFirst: mocks.runFindFirst, findMany: mocks.runFindMany },
    programOverlapPair: { findMany: mocks.pairFindMany },
    program: { findMany: mocks.programFindMany },
  },
}));

import { latestOverlapPairs, mergeOverlapRuns, overlapSelectionCovers, selectOverlapRuns } from '../src/program-overlap/merge';
import { loadOverlapRiskSignal, overlapRiskSignalFromPairs } from '../src/program-overlap/risk';

const run = (id: string, minute: number | null, scope: string[] = [], status: OverlapRunStatus = 'SUCCEEDED') => ({
  id, status, scopeProgramIds: scope,
  completedAt: minute === null ? null : new Date(Date.UTC(2026, 9, 3, 0, minute)),
});
let n = 0;
const pair = (
  runId: string, a: string, b: string,
  o: {
    overlapIndex?: number | null; marketSimilarity?: number | null; languageVariant?: boolean; actions?: OverlapAction[];
    containmentAInB?: number | null; containmentBInA?: number | null;
  } = {},
) => ({
  id: `pair${++n}`, runId, programAId: a, programBId: b,
  overlapIndex: o.overlapIndex ?? null, marketSimilarity: o.marketSimilarity ?? null,
  containmentAInB: o.containmentAInB ?? null, containmentBInA: o.containmentBInA ?? null,
  languageVariant: o.languageVariant ?? false, actions: o.actions ?? [],
});

describe('selectOverlapRuns', () => {
  it('takes the latest SUCCEEDED full run and newer SUCCEEDED scoped runs, oldest first', () => {
    const sel = selectOverlapRuns([
      run('full-old', 1), run('full', 10), run('full-failed', 20, [], 'FAILED'), run('full-running', 30, [], 'RUNNING'),
      run('scoped-before', 5, ['a']), run('scoped-2', 40, ['b']), run('scoped-1', 15, ['a']),
      run('scoped-failed', 50, ['a'], 'FAILED'), run('scoped-running', 60, ['a'], 'RUNNING'), run('no-completion', null, ['a']),
    ]);
    expect(sel.fullRun?.id).toBe('full');
    expect(sel.scopedRuns.map((r) => r.id)).toEqual(['scoped-1', 'scoped-2']);
  });
  it('tie rule: a scoped run completed at the same instant as the full run is applied over it', () => {
    const sel = selectOverlapRuns([run('zz-full', 10), run('aa-scoped', 10, ['a'])]);
    expect(sel.fullRun?.id).toBe('zz-full');
    expect(sel.scopedRuns.map((r) => r.id)).toEqual(['aa-scoped']);
    const merged = mergeOverlapRuns(sel, [pair('zz-full', 'a', 'b', { overlapIndex: 90 })]);
    expect(merged).toEqual([]);
  });
  it('tie rule: equal-time full runs resolve on id; equal-time scoped runs apply in id order', () => {
    const sel = selectOverlapRuns([run('f-b', 10), run('f-a', 10), run('s-b', 20, ['a']), run('s-a', 20, ['a'])]);
    expect(sel.fullRun?.id).toBe('f-b');
    expect(sel.scopedRuns.map((r) => r.id)).toEqual(['s-a', 's-b']);
  });
  it('without a full run every SUCCEEDED scoped run applies', () => {
    const sel = selectOverlapRuns([run('s2', 20, ['b']), run('s1', 10, ['a'])]);
    expect(sel.fullRun).toBeNull();
    expect(sel.scopedRuns.map((r) => r.id)).toEqual(['s1', 's2']);
  });
  it('covers a programme via a full run or a scoped run that lists it', () => {
    expect(overlapSelectionCovers(selectOverlapRuns([run('f', 1)]), 'x')).toBe(true);
    const scopedOnly = selectOverlapRuns([run('s', 1, ['a'])]);
    expect(overlapSelectionCovers(scopedOnly, 'a')).toBe(true);
    expect(overlapSelectionCovers(scopedOnly, 'b')).toBe(false);
    expect(overlapSelectionCovers(selectOverlapRuns([run('f', 1, [], 'FAILED')]), 'a')).toBe(false);
  });
});

describe('mergeOverlapRuns', () => {
  it('a scoped pair overrides the full-run row for the same pair', () => {
    const sel = selectOverlapRuns([run('f', 1), run('s', 2, ['a'])]);
    const merged = mergeOverlapRuns(sel, [pair('f', 'a', 'b', { overlapIndex: 40 }), pair('s', 'a', 'b', { overlapIndex: 60 })]);
    expect(merged.map((p) => [p.runId, p.overlapIndex])).toEqual([['s', 60]]);
  });
  it('a pair absent from the scoped run removes the full-run row', () => {
    const sel = selectOverlapRuns([run('f', 1), run('s', 2, ['a'])]);
    const merged = mergeOverlapRuns(sel, [pair('f', 'a', 'b'), pair('f', 'c', 'a'), pair('f', 'b', 'c')]);
    expect(merged.map((p) => `${p.programAId}${p.programBId}`)).toEqual(['bc']);
  });
  it('a newer scoped run supersedes an older one for the same programme', () => {
    const sel = selectOverlapRuns([run('f', 1), run('s-new', 3, ['a']), run('s-old', 2, ['a'])]);
    const merged = mergeOverlapRuns(sel, [
      pair('s-old', 'a', 'b', { overlapIndex: 90 }), pair('s-old', 'a', 'c', { overlapIndex: 80 }),
      pair('s-new', 'a', 'b', { overlapIndex: 35 }),
    ]);
    expect(merged.map((p) => [p.runId, p.programBId, p.overlapIndex])).toEqual([['s-new', 'b', 35]]);
  });
  it('a newer scoped run of the OTHER programme replaces the pair too', () => {
    const sel = selectOverlapRuns([run('f', 1), run('s-a', 2, ['a']), run('s-b', 3, ['b'])]);
    const merged = mergeOverlapRuns(sel, [pair('s-a', 'a', 'b', { overlapIndex: 90 }), pair('s-b', 'b', 'a', { overlapIndex: 20 })]);
    expect(merged.map((p) => [p.runId, p.overlapIndex])).toEqual([['s-b', 20]]);
  });
  it('ignores rows of FAILED, RUNNING, superseded and older-than-base runs', () => {
    const sel = selectOverlapRuns([
      run('f-old', 1), run('f', 5), run('s-before', 3, ['a']), run('s-failed', 9, ['a'], 'FAILED'), run('s-running', 9, ['a'], 'RUNNING'),
    ]);
    const merged = mergeOverlapRuns(sel, [
      pair('f-old', 'a', 'c'), pair('f', 'a', 'b'), pair('s-before', 'a', 'd'),
      pair('s-failed', 'a', 'e'), pair('s-running', 'a', 'g'),
    ]);
    expect(merged.map((p) => p.runId + p.programBId)).toEqual(['fb']);
  });
  it('a scoped run does not touch pairs outside its scope', () => {
    const sel = selectOverlapRuns([run('f', 1), run('s', 2, ['a'])]);
    const merged = mergeOverlapRuns(sel, [pair('f', 'b', 'c'), pair('s', 'a', 'd')]);
    expect(merged.map((p) => p.runId + p.programAId + p.programBId)).toEqual(['sad', 'fbc']);
  });
  it('nothing without a usable run', () => {
    expect(mergeOverlapRuns(selectOverlapRuns([run('f', 1, [], 'FAILED')]), [pair('f', 'a', 'b')])).toEqual([]);
  });
});

describe('overlapRiskSignalFromPairs', () => {
  it('null when the programme is not covered by any run', () => {
    expect(overlapRiskSignalFromPairs('a', selectOverlapRuns([]), [])).toBeNull();
    expect(overlapRiskSignalFromPairs('a', selectOverlapRuns([run('s', 1, ['b'])]), [])).toBeNull();
  });
  it('covered with no stored pair → signal with null values', () => {
    const s = overlapRiskSignalFromPairs('a', selectOverlapRuns([run('f', 1)]), []);
    expect(s).toMatchObject({ curriculumOverlapMax: null, marketConfusionMax: null, mergeCandidate: false, runId: 'f' });
  });
  it('max overlap and max market from different siblings; language variants and foreign pairs excluded', () => {
    const sel = selectOverlapRuns([run('f', 1), run('s', 2, ['a'])]);
    const pairs = [
      pair('s', 'a', 'b', { overlapIndex: 72, marketSimilarity: 40, actions: ['CONSIDER_MERGE_OR_TRACK'], containmentAInB: 85, containmentBInA: 40 }),
      pair('s', 'c', 'a', { overlapIndex: 55, marketSimilarity: 88 }),
      pair('s', 'a', 'v', { overlapIndex: 99, marketSimilarity: 99, languageVariant: true }),
      pair('f', 'x', 'y', { overlapIndex: 100, marketSimilarity: 100 }),
    ];
    const s = overlapRiskSignalFromPairs('a', sel, pairs)!;
    expect(s).toMatchObject({
      curriculumOverlapMax: 72, curriculumSiblingId: 'b', curriculumRunId: 's', mergeCandidate: true,
      curriculumContainmentMax: 85, curriculumActions: ['CONSIDER_MERGE_OR_TRACK'],
      marketConfusionMax: 88, marketSiblingId: 'c', marketRunId: 's', runId: 's',
    });
    expect(s.curriculumPairId).toBe(pairs[0]!.id);
    expect(s.marketPairId).toBe(pairs[1]!.id);
  });
  it('mergeCandidate follows the max-overlap pair only; ties break on sibling id', () => {
    const sel = selectOverlapRuns([run('f', 1)]);
    const s = overlapRiskSignalFromPairs('a', sel, [
      pair('f', 'a', 'z', { overlapIndex: 70, actions: ['CONSIDER_MERGE_OR_TRACK'] }),
      pair('f', 'a', 'm', { overlapIndex: 70 }),
    ])!;
    expect(s.curriculumSiblingId).toBe('m');
    expect(s.mergeCandidate).toBe(false);
  });
});

describe('course-based index (D9)', () => {
  it('a max pair carrying the merge action is a merge candidate; no evidence is read', () => {
    const sel = selectOverlapRuns([run('f', 1)]);
    const s = overlapRiskSignalFromPairs('a', sel, [
      pair('f', 'a', 'b', { overlapIndex: 100, actions: ['CONSIDER_MERGE_OR_TRACK'], containmentAInB: 95 }),
    ])!;
    expect(s).toMatchObject({ curriculumOverlapMax: 100, mergeCandidate: true });
    expect(s).not.toHaveProperty('curriculumLimitedEvidence');
  });
  it('a pair with no index (no course layer) never sets the curriculum signal', () => {
    const sel = selectOverlapRuns([run('f', 1)]);
    const s = overlapRiskSignalFromPairs('a', sel, [pair('f', 'a', 'b', { overlapIndex: null, marketSimilarity: 20 })])!;
    expect(s.curriculumOverlapMax).toBeNull();
    expect(s.mergeCandidate).toBe(false);
  });
});

describe('loaders', () => {
  beforeEach(() => {
    mocks.runFindFirst.mockReset();
    mocks.runFindMany.mockReset();
    mocks.pairFindMany.mockReset();
    mocks.programFindMany.mockReset();
  });
  it('activeOnly drops pairs with a side that is no longer ACTIVE (D5), after the merge', async () => {
    mocks.runFindFirst.mockResolvedValue({ completedAt: run('f', 1).completedAt });
    mocks.runFindMany.mockResolvedValue([run('f', 1)]);
    mocks.pairFindMany.mockResolvedValue([pair('f', 'a', 'b'), pair('f', 'a', 'c')]);
    mocks.programFindMany.mockResolvedValue([{ id: 'a' }, { id: 'c' }]);
    const out = await latestOverlapPairs('BACHELOR', { programIds: ['a'], activeOnly: true });
    expect(mocks.programFindMany.mock.calls[0]![0]).toEqual({
      where: { id: { in: ['a', 'b', 'c'] }, status: 'ACTIVE' },
      select: { id: true },
    });
    expect(out.pairs.map((p) => p.programBId)).toEqual(['c']);
  });
  it('without activeOnly no status query is made', async () => {
    mocks.runFindFirst.mockResolvedValue({ completedAt: run('f', 1).completedAt });
    mocks.runFindMany.mockResolvedValue([run('f', 1)]);
    mocks.pairFindMany.mockResolvedValue([pair('f', 'a', 'b')]);
    const out = await latestOverlapPairs('BACHELOR');
    expect(out.pairs).toHaveLength(1);
    expect(mocks.programFindMany).not.toHaveBeenCalled();
  });
  it('the KRI signal ignores a sibling that is no longer ACTIVE', async () => {
    mocks.runFindFirst.mockResolvedValue({ completedAt: run('f', 1).completedAt });
    mocks.runFindMany.mockResolvedValue([run('f', 1)]);
    mocks.pairFindMany.mockResolvedValue([
      pair('f', 'a', 'b', { overlapIndex: 90, marketSimilarity: 90 }),
      pair('f', 'a', 'c', { overlapIndex: 55, marketSimilarity: 65 }),
    ]);
    mocks.programFindMany.mockResolvedValue([{ id: 'a' }, { id: 'c' }]);
    const s = await loadOverlapRiskSignal('a', 'BACHELOR');
    expect(s).toMatchObject({ curriculumOverlapMax: 55, curriculumSiblingId: 'c', marketConfusionMax: 65, marketSiblingId: 'c' });
  });
  it('latestOverlapPairs fetches runs from the latest full run on, and only the selected runs\' pairs', async () => {
    mocks.runFindFirst.mockResolvedValue({ completedAt: run('f', 1).completedAt });
    mocks.runFindMany.mockResolvedValue([run('f', 1), run('s', 2, ['a'])]);
    mocks.pairFindMany.mockResolvedValue([pair('f', 'a', 'b'), pair('f', 'b', 'c'), pair('s', 'a', 'd')]);
    const out = await latestOverlapPairs('BACHELOR', { programIds: ['a'] });
    expect(mocks.runFindFirst.mock.calls[0]![0].where).toEqual({
      level: 'BACHELOR', status: 'SUCCEEDED', scopeProgramIds: { isEmpty: true }, completedAt: { not: null },
    });
    expect(mocks.runFindMany.mock.calls[0]![0].where).toEqual({
      level: 'BACHELOR', status: 'SUCCEEDED', completedAt: { gte: run('f', 1).completedAt },
    });
    expect(mocks.pairFindMany.mock.calls[0]![0].where).toEqual({
      runId: { in: ['f', 's'] },
      OR: [{ programAId: { in: ['a'] } }, { programBId: { in: ['a'] } }],
    });
    expect(out.pairs.map((p) => p.runId + p.programAId + p.programBId)).toEqual(['sad', 'fbc']);
  });
  it('without a full run every SUCCEEDED run of the level is fetched', async () => {
    mocks.runFindFirst.mockResolvedValue(null);
    mocks.runFindMany.mockResolvedValue([run('s', 2, ['a'])]);
    mocks.pairFindMany.mockResolvedValue([pair('s', 'a', 'd')]);
    const out = await latestOverlapPairs('BACHELOR');
    expect(mocks.runFindMany.mock.calls[0]![0].where).toEqual({ level: 'BACHELOR', status: 'SUCCEEDED' });
    expect(mocks.pairFindMany.mock.calls[0]![0].where).toEqual({ runId: { in: ['s'] } });
    expect(out.pairs).toHaveLength(1);
  });
  it('no pair query when there is no run', async () => {
    mocks.runFindFirst.mockResolvedValue(null);
    mocks.runFindMany.mockResolvedValue([]);
    const out = await latestOverlapPairs('MASTER');
    expect(out.pairs).toEqual([]);
    expect(mocks.pairFindMany).not.toHaveBeenCalled();
    expect(await loadOverlapRiskSignal('a', 'MASTER')).toBeNull();
  });
});
