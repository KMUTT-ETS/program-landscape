// Every programme scored once, memoised: feeds the Deep-Dive radar's
// university / faculty averages, the gap map, and the scope scorers'
// rolled-up drivers (rolledUpDriver).

import { prisma } from '../index';
import { computeHealthScores } from './compute';
import { HEALTH_DIMENSIONS, type HealthDimension } from './drivers';
import type { HealthScore, HealthScoreRow } from './schema';
import { HEALTH_SCORE_VERSION } from './version';
import { clamp } from './curves';

// ──────────────────────────────────────────────────────────────────────────
// Program-level dimension averages (radar benchmarks)
//
// The deep-dive Health radar overlays a University average and a Faculty
// average against the program's own scores. These are the MEAN of the
// PROGRAM-LEVEL dimension scores (not the faculty/university rollup
// composite) — i.e. score every program at program scope, then average
// each dimension. Null dimensions are EXCLUDED from the mean (null = "no
// data", never 0 — same rule the scorers use).
//
// The values are identical regardless of which program is open, so the
// whole computation is memoised per-process with a 5-minute TTL. Cold
// computation fans out computeHealthScores('program', id) over every
// program in bounded-concurrency chunks (mirrors the cockpit heatmap's
// per-program fan-out; the expensive KMITL alignment scan inside is
// already memoised so it runs once, not once-per-program).
// ──────────────────────────────────────────────────────────────────────────

export interface ProgramDimensionMeans {
  attractiveness: number | null;
  financial: number | null;
  capability: number | null;
  outcomes: number | null;
  relevance: number | null;
  /** Programs that contributed ≥1 non-null dimension to these means. */
  sampleSize: number;
}

export interface ProgramDimensionAverages {
  methodologyVersion: string;
  programCount: number;
  university: ProgramDimensionMeans;
  /** Keyed by facultyId. */
  byFaculty: Record<string, ProgramDimensionMeans>;
}

interface DimAcc {
  attractiveness: { sum: number; n: number };
  financial: { sum: number; n: number };
  capability: { sum: number; n: number };
  outcomes: { sum: number; n: number };
  relevance: { sum: number; n: number };
  programs: number;
}

const PROGRAM_AVG_CONCURRENCY = 12;
// 30-minute TTL: the portfolio-wide dimension means shift only when the
// underlying health data refreshes (weekly-ish), so a long window keeps
// the cold-miss fan-out (one score per program) rare — only the first
// deep-dive view per window pays it; the rest are a map lookup.
const PROGRAM_AVG_TTL_MS = 30 * 60_000;
let _programAvgCache: { at: number; data: ProgramDimensionAverages } | null = null;

export async function computeProgramDimensionAverages(): Promise<ProgramDimensionAverages> {
  const now = Date.now();
  if (_programAvgCache && now - _programAvgCache.at < PROGRAM_AVG_TTL_MS) {
    return _programAvgCache.data;
  }
  const data = await _computeProgramDimensionAveragesImpl();
  _programAvgCache = { at: now, data };
  return data;
}

function freshAcc(): DimAcc {
  return {
    attractiveness: { sum: 0, n: 0 },
    financial: { sum: 0, n: 0 },
    capability: { sum: 0, n: 0 },
    outcomes: { sum: 0, n: 0 },
    relevance: { sum: 0, n: 0 },
    programs: 0,
  };
}

function accAdd(acc: DimAcc, dims: HealthScoreRow['dimensions']): boolean {
  let contributed = false;
  for (const d of HEALTH_DIMENSIONS) {
    const s = dims[d].score;
    if (s === null) continue;
    acc[d].sum += s;
    acc[d].n += 1;
    contributed = true;
  }
  if (contributed) acc.programs += 1;
  return contributed;
}

function accMeans(acc: DimAcc): ProgramDimensionMeans {
  const m = (x: { sum: number; n: number }) => (x.n > 0 ? x.sum / x.n : null);
  return {
    attractiveness: m(acc.attractiveness),
    financial: m(acc.financial),
    capability: m(acc.capability),
    outcomes: m(acc.outcomes),
    relevance: m(acc.relevance),
    sampleSize: acc.programs,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Program-score index (v5.0)
//
// One fan-out, two consumers: the deep-dive radar's dimension averages
// and the scope scorers' driver rollups. Built over canonical+ACTIVE
// programs only — the same population resolveChildren lists under a
// faculty, so a faculty score rolls up exactly the programs shown
// beneath it.
//
// MUST NOT be called from the program branch of computeHealthScores —
// the index is built BY that branch, and calling it from there would
// recurse forever.
export interface ProgramScoreIndexEntry {
  programId: string;
  facultyId: string | null;
  dimensions: HealthScoreRow['dimensions'];
  /** Overall composite, null when every dimension was null. */
  overall: number | null;
}
export type ProgramScoreIndex = Map<string, ProgramScoreIndexEntry>;

let _programIndexCache: { at: number; index: ProgramScoreIndex } | null = null;

/** Every ACTIVE programme's health, memoised for PROGRAM_AVG_TTL_MS. Exported
 *  for the gap map, which needs one number per programme without 297 calls. */
export async function getProgramScoreIndex(): Promise<ProgramScoreIndex> {
  const now = Date.now();
  if (_programIndexCache && now - _programIndexCache.at < PROGRAM_AVG_TTL_MS) {
    return _programIndexCache.index;
  }
  const programs = await prisma.program.findMany({
    where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
    select: { id: true, facultyId: true },
  });
  const index: ProgramScoreIndex = new Map();
  for (let i = 0; i < programs.length; i += PROGRAM_AVG_CONCURRENCY) {
    const slice = programs.slice(i, i + PROGRAM_AVG_CONCURRENCY);
    const scored = await Promise.all(
      slice.map((p) =>
        computeHealthScores('program', p.id)
          .then((rows) => ({ p, row: rows[0] ?? null }))
          .catch(() => ({ p, row: null as HealthScoreRow | null })),
      ),
    );
    for (const { p, row } of scored) {
      if (!row) continue;
      index.set(p.id, { programId: p.id, facultyId: p.facultyId, dimensions: row.dimensions, overall: row.overall.score });
    }
  }
  _programIndexCache = { at: now, index };
  return index;
}

/**
 * Drop the memoised index. MUST be called in test `beforeEach` — the memo
 * is per-process, so without this a later test reads the program set a
 * previous test mocked, and the failure looks like a scorer bug.
 */
export function invalidateProgramScoreIndexCache(): void {
  _programIndexCache = null;
  _programAvgCache = null;
}

// Mean of the non-null program-level values of one driver across a
// program set. Null (never 0) when no program carries it — a data gap is
// not a bad score, the same rule every scorer uses.
export function rolledUpDriver(
  index: ProgramScoreIndex,
  programIds: readonly string[],
  dimension: HealthDimension,
  label: string,
): HealthScore['drivers'][number] {
  const values: number[] = [];
  for (const id of programIds) {
    const entry = index.get(id);
    if (!entry) continue;
    const v = entry.dimensions[dimension].drivers.find((d) => d.label === label)?.value;
    if (v !== null && v !== undefined) values.push(v);
  }
  const value = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : null;
  return {
    label,
    value: value === null ? null : clamp(value),
    raw: { rolledUp: true, fromPrograms: values.length, ofPrograms: programIds.length },
  };
}

/** Test-only seam. */
export const rolledUpDriverForTest = rolledUpDriver;

async function _computeProgramDimensionAveragesImpl(): Promise<ProgramDimensionAverages> {
  const index = await getProgramScoreIndex();
  const uni = freshAcc();
  const byFaculty = new Map<string, DimAcc>();
  for (const entry of index.values()) {
    accAdd(uni, entry.dimensions);
    if (entry.facultyId) {
      const facAcc = byFaculty.get(entry.facultyId) ?? freshAcc();
      accAdd(facAcc, entry.dimensions);
      byFaculty.set(entry.facultyId, facAcc);
    }
  }
  return {
    methodologyVersion: HEALTH_SCORE_VERSION,
    programCount: index.size,
    university: accMeans(uni),
    byFaculty: Object.fromEntries(
      [...byFaculty.entries()].map(([fid, acc]) => [fid, accMeans(acc)]),
    ),
  };
}
