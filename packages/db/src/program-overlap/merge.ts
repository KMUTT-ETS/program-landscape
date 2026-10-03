// program-overlap.v1 — the reader contract for ProgramOverlapRun /
// ProgramOverlapPair (spec §8; see runProgramOverlap's doc comment in
// apps/ingestion/src/program-overlap/run.ts).
//
//  - Only SUCCEEDED runs count. RUNNING and FAILED runs carry no pairs but
//    still exist as provenance.
//  - The base is the latest SUCCEEDED full run of the level
//    (scopeProgramIds = []).
//  - SUCCEEDED scoped runs completed at or after that base are applied
//    oldest first. Tie rule: a scoped run completed at the same instant as the
//    base IS applied (its rows are no older than the base's); equal-time full
//    runs resolve to the larger id, equal-time scoped runs apply in id order. A scoped run covers EVERY pair touching its scopeProgramIds: the
//    rows held so far for those pairs are dropped — even when the scoped run
//    has no row for the pair, which means the pair no longer meets the storage
//    rule — and the scoped run's own rows are added.
//
// The selection and merge are pure so the contract is unit-tested; the
// loader below only fetches.
import type { OverlapRunStatus, ProgramLevel, ProgramOverlapPair } from '@prisma/client';
import { prisma } from '../index';
import { byCodeUnits } from './load';

/** The run fields the merge needs. */
export interface OverlapRunRef {
  id: string;
  status: OverlapRunStatus;
  scopeProgramIds: readonly string[];
  completedAt: Date | null;
}

/** The pair fields the merge needs. */
export interface OverlapPairRef {
  runId: string;
  programAId: string;
  programBId: string;
}

export interface OverlapRunSelection<R extends OverlapRunRef> {
  /** Latest SUCCEEDED full run, or null when none exists. */
  fullRun: R | null;
  /** SUCCEEDED scoped runs completed at or after `fullRun` (all of them when
   *  there is no full run), oldest first — the order they are applied in. */
  scopedRuns: R[];
}

const completedMs = (r: OverlapRunRef): number => r.completedAt?.getTime() ?? 0;

function byCompletion(a: OverlapRunRef, b: OverlapRunRef): number {
  return completedMs(a) - completedMs(b) || byCodeUnits(a.id, b.id);
}

/** Pure: pick the base full run and the scoped runs to overlay on it. Runs
 *  must all be of one level. A SUCCEEDED run without completedAt cannot be
 *  ordered and is ignored. */
export function selectOverlapRuns<R extends OverlapRunRef>(runs: readonly R[]): OverlapRunSelection<R> {
  const usable = runs.filter((r) => r.status === 'SUCCEEDED' && r.completedAt !== null).sort(byCompletion);
  const fulls = usable.filter((r) => r.scopeProgramIds.length === 0);
  const fullRun = fulls.length > 0 ? fulls[fulls.length - 1]! : null;
  const scopedRuns = usable.filter(
    (r) => r.scopeProgramIds.length > 0 && (fullRun === null || completedMs(r) >= completedMs(fullRun)),
  );
  return { fullRun, scopedRuns };
}

/** Pure: true when the selection holds a complete answer for this
 *  programme's pairs — a full run exists, or a selected scoped run lists the
 *  programme. */
export function overlapSelectionCovers(selection: OverlapRunSelection<OverlapRunRef>, programId: string): boolean {
  return selection.fullRun !== null || selection.scopedRuns.some((r) => r.scopeProgramIds.includes(programId));
}

const pairKey = (p: OverlapPairRef): string =>
  byCodeUnits(p.programAId, p.programBId) <= 0 ? `${p.programAId}|${p.programBId}` : `${p.programBId}|${p.programAId}`;

/**
 * Pure: merge the pair rows of the selected runs into one current set.
 * `pairs` may hold rows of any run; rows of runs outside the selection are
 * ignored. Result is sorted by (programAId, programBId) for determinism.
 */
export function mergeOverlapRuns<P extends OverlapPairRef>(
  selection: OverlapRunSelection<OverlapRunRef>,
  pairs: readonly P[],
): P[] {
  const byRun = new Map<string, P[]>();
  for (const p of pairs) {
    const list = byRun.get(p.runId);
    if (list) list.push(p);
    else byRun.set(p.runId, [p]);
  }
  const current = new Map<string, P>();
  if (selection.fullRun) {
    for (const p of byRun.get(selection.fullRun.id) ?? []) current.set(pairKey(p), p);
  }
  for (const run of selection.scopedRuns) {
    const scope = new Set(run.scopeProgramIds);
    for (const [key, p] of current) {
      if (scope.has(p.programAId) || scope.has(p.programBId)) current.delete(key);
    }
    for (const p of byRun.get(run.id) ?? []) current.set(pairKey(p), p);
  }
  return [...current.entries()].sort(([a], [b]) => byCodeUnits(a, b)).map(([, p]) => p);
}

export type OverlapRunRow = OverlapRunRef & {
  level: ProgramLevel | null;
  methodologyVersion: string;
  startedAt: Date;
  completedAt: Date | null;
};

export interface LatestOverlapPairs {
  selection: OverlapRunSelection<OverlapRunRow>;
  pairs: ProgramOverlapPair[];
}

/**
 * The current overlap pairs of one level: the latest SUCCEEDED full run with
 * newer SUCCEEDED scoped runs overlaid. With `programIds`, only pairs touching
 * one of those programmes are returned (the merge is unaffected: dropping
 * works per pair). With `activeOnly`, pairs with a side no longer ACTIVE are
 * dropped AFTER the merge (D5) — the risk path uses it so a KRI never points
 * at a closed or suspended sibling; the read models filter ACTIVE themselves
 * and the pair detail must still find a pair whose sibling has left ACTIVE.
 * Plain Prisma.
 */
export async function latestOverlapPairs(
  level: ProgramLevel,
  opts: { programIds?: readonly string[]; activeOnly?: boolean } = {},
): Promise<LatestOverlapPairs> {
  // Older runs can never be selected: fetch from the latest full run on.
  const latestFull = await prisma.programOverlapRun.findFirst({
    where: { level, status: 'SUCCEEDED', scopeProgramIds: { isEmpty: true }, completedAt: { not: null } },
    orderBy: { completedAt: 'desc' },
    select: { completedAt: true },
  });
  const runs = await prisma.programOverlapRun.findMany({
    where: {
      level,
      status: 'SUCCEEDED',
      ...(latestFull?.completedAt ? { completedAt: { gte: latestFull.completedAt } } : {}),
    },
    select: {
      id: true, status: true, scopeProgramIds: true, completedAt: true,
      level: true, methodologyVersion: true, startedAt: true,
    },
  });
  const selection = selectOverlapRuns(runs);
  const runIds = [
    ...(selection.fullRun ? [selection.fullRun.id] : []),
    ...selection.scopedRuns.map((r) => r.id),
  ];
  if (runIds.length === 0) return { selection, pairs: [] };
  const ids = opts.programIds ? [...opts.programIds] : null;
  const pairs = await prisma.programOverlapPair.findMany({
    where: {
      runId: { in: runIds },
      ...(ids ? { OR: [{ programAId: { in: ids } }, { programBId: { in: ids } }] } : {}),
    },
  });
  const merged = mergeOverlapRuns(selection, pairs);
  if (!opts.activeOnly || merged.length === 0) return { selection, pairs: merged };
  const programIds = [...new Set(merged.flatMap((p) => [p.programAId, p.programBId]))].sort(byCodeUnits);
  const active = new Set(
    (await prisma.program.findMany({ where: { id: { in: programIds }, status: 'ACTIVE' }, select: { id: true } })).map(
      (p) => p.id,
    ),
  );
  return { selection, pairs: merged.filter((p) => active.has(p.programAId) && active.has(p.programBId)) };
}
