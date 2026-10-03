// ─────────────────────────────────────────────────────────────────────────────
// program-overlap.v1 — scoring runner (spec §5, §8).
//
// Loads every canonical programme at one level, scores each same-level pair in
// memory with the pure core in @kku/db, and (with apply) writes one
// ProgramOverlapRun plus its ProgramOverlapPair rows. A scoped run (programIds)
// scores only the pairs touching those programmes; readers merge it over the
// latest full run.
//
// A dry run computes everything and writes nothing.
// ─────────────────────────────────────────────────────────────────────────────
import {
  prisma,
  byCodeUnits,
  dot,
  loadOverlapProgrammes,
  majorCourses,
  scorePair,
  serviceCourseCodes,
  shouldStorePair,
  OVERLAP_THRESHOLDS,
  PROGRAM_OVERLAP_VERSION,
  type OverlapCourse,
  type OverlapLoadCoverage,
  type OverlapProgramme,
  type PairScore,
  type Prisma,
  type ProgramLevel,
} from '@kku/db';
import type { AiService } from '@kku/shared';

/** Per-pair figures for the calibration distributions (spec §9). One entry per
 *  scored pair where the figure exists; containment pools both directions. */
export interface RunHistogram {
  structure: number[];
  content: number[];
  outcome: number[];
  index: number[];
  containment: number[];
  /** Rescaled 0–100 market similarity. */
  market: number[];
  /** Raw market-profile cosine (before the floor/ceiling rescale) — what the
   *  floor and ceiling are calibrated against. */
  marketCosine: number[];
  /** Highest course cosine between the two programmes' embedded major courses
   *  that are not shared by code (the content layer's candidates). */
  bestCourse: number[];
  /** Highest PLO-to-PLO cosine between the two programmes. */
  bestPlo: number[];
}

export interface PlannedRun {
  scored: number;
  stored: PairScore[];
  /** Every scored pair — only when `keepAll` was asked (calibration). */
  all: PairScore[] | null;
  histogram: RunHistogram;
}

/** Highest cosine over the cross product. Uses `dot`, so it ASSUMES unit
 *  vectors: true for every stored embedding (writeVector L2-normalises on
 *  write and the readers return the stored values unchanged). Anything else
 *  must go through `cosine`. */
function bestCross(left: ReadonlyArray<readonly number[]>, right: ReadonlyArray<readonly number[]>): number | null {
  if (left.length === 0 || right.length === 0) return null;
  let best = -Infinity;
  for (const l of left) for (const r of right) {
    const s = dot(l, r);
    if (s > best) best = s;
  }
  return best;
}

/** Pure: score same-level pairs (optionally only those touching scopeProgramIds).
 *  Pairs are always (A, B) with A.id < B.id in code-unit order. */
export function planRunPairs(
  progs: readonly OverlapProgramme[],
  opts: { scopeProgramIds: readonly string[]; keepAll?: boolean },
): PlannedRun {
  const sorted = [...progs].sort((x, y) => byCodeUnits(x.id, y.id));
  // Service courses are judged against the WHOLE level, scoped run or not.
  const serviceCodes = serviceCourseCodes(sorted, OVERLAP_THRESHOLDS.serviceCourseShare);
  const embeddedMajors = new Map<string, OverlapCourse[]>(
    sorted.map((p) => [p.id, majorCourses(p, serviceCodes).filter((c) => c.vector !== null)]),
  );
  const scope = new Set(opts.scopeProgramIds);
  const histogram: RunHistogram = {
    structure: [], content: [], outcome: [], index: [], containment: [], market: [], marketCosine: [], bestCourse: [], bestPlo: [],
  };
  const stored: PairScore[] = [];
  const all: PairScore[] | null = opts.keepAll ? [] : null;
  let scored = 0;
  const push = (xs: number[], x: number | null): void => {
    if (x !== null) xs.push(x);
  };
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i]!;
      const b = sorted[j]!;
      if (scope.size && !scope.has(a.id) && !scope.has(b.id)) continue;
      const s = scorePair(a, b, { serviceCodes, thresholds: OVERLAP_THRESHOLDS });
      scored++;
      push(histogram.structure, s.structure);
      push(histogram.content, s.content);
      push(histogram.outcome, s.outcome);
      push(histogram.index, s.overlapIndex);
      push(histogram.containment, s.containmentAInB);
      push(histogram.containment, s.containmentBInA);
      push(histogram.market, s.marketSimilarity);
      // Unit vectors (see bestCross), so dot = cosine.
      if (a.marketVector && b.marketVector) histogram.marketCosine.push(dot(a.marketVector, b.marketVector));
      const sharedCodes = new Set(s.evidence.sharedCourses.map((c) => c.code));
      const candA = embeddedMajors.get(a.id)!.filter((c) => !sharedCodes.has(c.code)).map((c) => c.vector!);
      const candB = embeddedMajors.get(b.id)!.filter((c) => !sharedCodes.has(c.code)).map((c) => c.vector!);
      push(histogram.bestCourse, bestCross(candA, candB));
      push(histogram.bestPlo, bestCross(a.plos.map((p) => p.vector), b.plos.map((p) => p.vector)));
      if (shouldStorePair(s)) stored.push(s);
      all?.push(s);
    }
  }
  return { scored, stored, all, histogram };
}

export const LEVELS: readonly ProgramLevel[] = ['BACHELOR', 'MASTER', 'DOCTORAL', 'HIGHER_GRAD_DIPLOMA'];

export interface Distribution {
  n: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
  max: number;
}

/** n and p10/p25/p50/p75/p90/max of a list (nearest-rank, lower); null when empty. */
export function summarise(xs: readonly number[]): Distribution | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const q = (p: number): number => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))]!;
  return { n: s.length, p10: q(0.1), p25: q(0.25), p50: q(0.5), p75: q(0.75), p90: q(0.9), max: s[s.length - 1]! };
}

export type RunDistributions = { [K in keyof RunHistogram]: Distribution | null };

export function summariseHistogram(h: RunHistogram): RunDistributions {
  return {
    structure: summarise(h.structure),
    content: summarise(h.content),
    outcome: summarise(h.outcome),
    index: summarise(h.index),
    containment: summarise(h.containment),
    market: summarise(h.market),
    marketCosine: summarise(h.marketCosine),
    bestCourse: summarise(h.bestCourse),
    bestPlo: summarise(h.bestPlo),
  };
}

export interface LevelRunResult {
  level: ProgramLevel;
  runId: string | null;
  scopeProgramIds: string[];
  scored: number;
  stored: number;
  coverage: OverlapLoadCoverage;
  distributions: RunDistributions;
}

/** Levels to run: the one asked for, the levels of the scoped programmes, or all. */
export async function levelsFor(opts: { level?: ProgramLevel; programIds?: string[] }): Promise<ProgramLevel[]> {
  if (opts.level) return [opts.level];
  if (!opts.programIds?.length) return [...LEVELS];
  const rows = await prisma.program.findMany({ where: { id: { in: opts.programIds } }, select: { level: true } });
  const present = new Set(rows.map((r) => r.level));
  return LEVELS.filter((l) => present.has(l));
}

const PAIR_BATCH = 500;

export function pairRow(runId: string, level: ProgramLevel, s: PairScore): Prisma.ProgramOverlapPairCreateManyInput {
  return {
    runId, level, programAId: s.programAId, programBId: s.programBId,
    structure: s.structure, content: s.content, outcome: s.outcome, overlapIndex: s.overlapIndex,
    containmentAInB: s.containmentAInB, containmentBInA: s.containmentBInA, band: s.band,
    sharedCredits: s.sharedCredits, equivCredits: s.equivCredits, sharedStaff: s.sharedStaff,
    marketSimilarity: s.marketSimilarity, languageVariant: s.languageVariant,
    actions: s.actions, primaryAction: s.primaryAction,
    evidenceJson: s.evidence as unknown as Prisma.InputJsonValue,
    evidenceHash: s.evidenceHash,
    methodologyVersion: PROGRAM_OVERLAP_VERSION,
  };
}

/**
 * Scores one level at a time and, with `apply`, writes one ProgramOverlapRun per
 * level. A level with fewer than two canonical programmes gets no run.
 *
 * Contract for readers of ProgramOverlapRun / ProgramOverlapPair:
 *  - Readers MUST filter `status = 'SUCCEEDED'`. A RUNNING or FAILED run has no
 *    pairs (they are written in one transaction with the SUCCEEDED flip), but
 *    it still exists as provenance.
 *  - A full run has `scopeProgramIds = []`. A scoped run covers EVERY pair that
 *    touches any of its scopeProgramIds. When merging a scoped run over the
 *    latest full run, drop the full run's rows for every pair touching those
 *    programmes — even a pair ABSENT from the scoped run, which means it no
 *    longer meets the storage rule — then add the scoped run's rows.
 */
export async function runProgramOverlap(opts: {
  level?: ProgramLevel;
  programIds?: string[];
  apply: boolean;
}): Promise<LevelRunResult[]> {
  const results: LevelRunResult[] = [];
  for (const level of await levelsFor(opts)) {
    const { programmes, coverage } = await loadOverlapProgrammes(level);
    // Nothing to compare at this level.
    if (programmes.length < 2) continue;
    const present = new Set(programmes.map((p) => p.id));
    const scopeIds = (opts.programIds ?? []).filter((id) => present.has(id)).sort(byCodeUnits);
    // Scoped, but none of the scoped programmes is canonical at this level.
    if (opts.programIds?.length && scopeIds.length === 0) continue;
    const plan = planRunPairs(programmes, { scopeProgramIds: scopeIds });
    const distributions = summariseHistogram(plan.histogram);
    const base = { level, scopeProgramIds: scopeIds, scored: plan.scored, stored: plan.stored.length, coverage, distributions };
    if (!opts.apply) {
      results.push({ ...base, runId: null });
      continue;
    }
    const run = await prisma.programOverlapRun.create({
      data: {
        methodologyVersion: PROGRAM_OVERLAP_VERSION,
        level,
        scopeProgramIds: scopeIds,
        thresholdsJson: { ...OVERLAP_THRESHOLDS },
      },
    });
    try {
      // All pairs and the SUCCEEDED flip land together or not at all.
      const writes: Prisma.PrismaPromise<unknown>[] = [];
      for (let k = 0; k < plan.stored.length; k += PAIR_BATCH) {
        writes.push(
          prisma.programOverlapPair.createMany({
            data: plan.stored.slice(k, k + PAIR_BATCH).map((s) => pairRow(run.id, level, s)),
          }),
        );
      }
      writes.push(
        prisma.programOverlapRun.update({
          where: { id: run.id },
          data: {
            status: 'SUCCEEDED',
            completedAt: new Date(),
            pairsScored: plan.scored,
            pairsStored: plan.stored.length,
            coverageJson: { ...coverage, distributions } as unknown as Prisma.InputJsonValue,
          },
        }),
      );
      await prisma.$transaction(writes);
    } catch (e) {
      try {
        await prisma.programOverlapRun.update({
          where: { id: run.id },
          data: { status: 'FAILED', completedAt: new Date(), errorText: e instanceof Error ? e.message : String(e) },
        });
      } catch (markErr) {
        // Never mask the original failure; the run stays RUNNING, which readers ignore.
        console.error(`[program-overlap] could not mark run ${run.id} FAILED:`, markErr);
      }
      throw e;
    }
    results.push({ ...base, runId: run.id });
  }
  return results;
}

export interface OverlapRecommendationResult {
  written: number;
  skipped: number;
  failed: number;
  costUsd: number;
}

/** AI wording for flagged pairs (spec §6.2). Task 12 replaces this stub. */
export async function runOverlapRecommendations(_: { ai: AiService; runIds: string[] }): Promise<OverlapRecommendationResult> {
  // Task 12 replaces this
  return { written: 0, skipped: 0, failed: 0, costUsd: 0 };
}
