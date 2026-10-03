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
  parsePairEvidence,
  scorePair,
  serviceCourseCodes,
  shouldStorePair,
  OVERLAP_THRESHOLDS,
  PROGRAM_OVERLAP_VERSION,
  type OverlapCourse,
  type OverlapLoadCoverage,
  type OverlapProgramme,
  type PairScore,
  realDataWhere,
  ACTION_STRENGTH,
  type OverlapAction,
  type Prisma,
  type ProgramLevel,
} from '@kku/db';
import {
  PROGRAM_OVERLAP_RECOMMENDATION_VERSION,
  ProgramOverlapRecommendationSchema,
  buildProgramOverlapRecommendationMessages,
  overlapRecommendationConfidenceCeiling,
  OVERLAP_EVIDENCE_LIST_CAP,
  type AiService,
  type OverlapCappedList,
  type ProgramOverlapRecommendationInput,
} from '@kku/shared';

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
  /** Programmes this run MEASURED on courses (at least one major course, so
   *  the structure layer is computable against any partner that has one),
   *  sorted. A scoped run lists only its scoped programmes. Stored in the
   *  run's coverageJson; a reader treats a programme its covering run did
   *  not measure as uncovered for the curriculum KRI — "covered" is not
   *  "measured". */
  scoredProgramIds: string[];
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
  const scoredProgramIds = sorted
    .filter((p) => (scope.size === 0 || scope.has(p.id)) && majorCourses(p, serviceCodes).length > 0)
    .map((p) => p.id);
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
  return { scored, stored, all, histogram, scoredProgramIds };
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
            coverageJson: {
              ...coverage,
              distributions,
              scoredProgramIds: plan.scoredProgramIds,
            } as unknown as Prisma.InputJsonValue,
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

type RecPair = Prisma.ProgramOverlapPairGetPayload<{
  include: {
    programA: { select: { code: true; nameTh: true; nameEn: true; faculty: { select: { nameEn: true } } } };
    programB: { select: { code: true; nameTh: true; nameEn: true; faculty: { select: { nameEn: true } } } };
  };
}>;

/** Pure: does this stored pair qualify for an AI recommendation (spec §6.2)?
 *  Mirrors the where clause runOverlapRecommendations pushes into its query. */
export function needsRecommendation(p: Pick<RecPair, 'actions' | 'overlapIndex'>): boolean {
  return p.actions.length > 0 && p.overlapIndex !== null && p.overlapIndex >= OVERLAP_THRESHOLDS.actionIndex;
}

const round2 = (x: number): number => Math.round(x * 100) / 100;
const roundOrNull = (x: number | null): number | null => (x === null ? null : Math.round(x));

function cap<T>(xs: readonly T[], order?: (a: T, b: T) => number): OverlapCappedList<T> {
  const sorted = order ? [...xs].sort(order) : [...xs];
  return { items: sorted.slice(0, OVERLAP_EVIDENCE_LIST_CAP), omitted: Math.max(0, sorted.length - OVERLAP_EVIDENCE_LIST_CAP) };
}

/** Pure: actions strongest first, by ACTION_STRENGTH (score.ts stores them weakest first). */
export function actionsStrongestFirst(actions: readonly OverlapAction[]): OverlapAction[] {
  const rank = (a: OverlapAction): number => ACTION_STRENGTH.indexOf(a);
  return [...actions].sort((x, y) => rank(y) - rank(x));
}

/** Pure: build the prompt input from a stored pair. Scores are rounded to
 *  integers, similarities to 2 dp, and every evidence list is capped. Null
 *  when the stored evidenceJson does not parse (e.g. written before D9):
 *  the pair is skipped rather than worded from a guessed shape. */
export function recommendationInput(
  p: RecPair,
  enrolled: ReadonlyMap<string, number>,
  market: ReadonlyMap<string, string>,
): ProgramOverlapRecommendationInput | null {
  const ev = parsePairEvidence(p.evidenceJson);
  if (ev === null) return null;
  const actions = actionsStrongestFirst(p.actions);
  return {
    programA: {
      code: p.programA.code, nameTh: p.programA.nameTh, nameEn: p.programA.nameEn,
      faculty: p.programA.faculty.nameEn, latestEnrolled: enrolled.get(p.programAId) ?? null,
    },
    programB: {
      code: p.programB.code, nameTh: p.programB.nameTh, nameEn: p.programB.nameEn,
      faculty: p.programB.faculty.nameEn, latestEnrolled: enrolled.get(p.programBId) ?? null,
    },
    level: p.level,
    scores: {
      structure: roundOrNull(p.structure), content: roundOrNull(p.content), outcome: roundOrNull(p.outcome),
      overlapIndex: Math.round(p.overlapIndex ?? 0),
      containmentAInB: roundOrNull(p.containmentAInB), containmentBInA: roundOrNull(p.containmentBInA),
      marketSimilarity: roundOrNull(p.marketSimilarity),
    },
    sharedCredits: p.sharedCredits,
    equivCredits: p.equivCredits,
    sharedStaff: p.sharedStaff,
    languageVariant: p.languageVariant,
    actions,
    primaryAction: actions[0] ?? null,
    evidence: {
      sharedCourses: cap(ev.sharedCourses, (a, b) => b.credits - a.credits),
      equivalentCourses: cap(
        ev.equivalentCourses.map((e) => ({
          codeA: e.codeA, codeB: e.codeB, nameA: e.nameA, nameB: e.nameB,
          credits: e.credits, similarity: round2(e.similarity), basis: e.basis,
        })),
        (a, b) => b.similarity - a.similarity,
      ),
      matchedPlos: cap(
        ev.matchedPlos.map((m) => ({ textA: m.textA, textB: m.textB, similarity: round2(m.similarity) })),
        (a, b) => b.similarity - a.similarity,
      ),
      unmatchedPlosA: cap(ev.unmatchedPlosA),
      unmatchedPlosB: cap(ev.unmatchedPlosB),
      coverage: {
        majorCoursesA: ev.coverage.majorCoursesA, majorCoursesB: ev.coverage.majorCoursesB,
        describedA: ev.coverage.describedA, describedB: ev.coverage.describedB,
        descriptionMatches: ev.coverage.descriptionMatches,
        plosA: ev.coverage.plosA, plosB: ev.coverage.plosB,
      },
    },
    marketTextA: market.get(p.programAId) ?? null,
    marketTextB: market.get(p.programBId) ?? null,
  };
}

/** Newest real EnrollmentMetric.enrolled (total headcount) per programme. */
async function latestEnrolled(programIds: readonly string[]): Promise<Map<string, number>> {
  const rows = await prisma.enrollmentMetric.findMany({
    where: { programId: { in: [...programIds] }, ...realDataWhere() },
    select: { programId: true, academicYear: true, enrolled: true },
    orderBy: { academicYear: 'desc' },
  });
  const out = new Map<string, number>();
  for (const r of rows) if (!out.has(r.programId)) out.set(r.programId, r.enrolled);
  return out;
}

const reuseKey = (level: string, a: string, b: string, hash: string): string => `${level}|${a}|${b}|${hash}`;

/**
 * AI wording for flagged pairs (spec §6.2). Only pairs with at least one action
 * and overlapIndex >= actionIndex are read. Every run writes NEW pair rows, so
 * reuse is found across runs: a recommendation with the same prompt version
 * for the same (level, programAId, programBId, evidenceHash) is copied onto the
 * new pair (content and aiInferenceId unchanged) and counted as skipped; no AI
 * call. A failure on one pair is logged and counted; the loop continues. The
 * AI never changes the action.
 */
export async function runOverlapRecommendations(opts: { ai: AiService; runIds: string[] }): Promise<OverlapRecommendationResult> {
  const result: OverlapRecommendationResult = { written: 0, skipped: 0, failed: 0, costUsd: 0 };
  if (opts.runIds.length === 0) return result;
  const programmeSelect = { code: true, nameTh: true, nameEn: true, faculty: { select: { nameEn: true } } } as const;
  const pairs: RecPair[] = await prisma.programOverlapPair.findMany({
    where: {
      runId: { in: opts.runIds },
      actions: { isEmpty: false },
      overlapIndex: { gte: OVERLAP_THRESHOLDS.actionIndex },
    },
    include: { programA: { select: programmeSelect }, programB: { select: programmeSelect } },
    orderBy: [{ overlapIndex: 'desc' }, { id: 'asc' }],
  });
  const flagged = pairs.filter(needsRecommendation);
  if (flagged.length === 0) return result;

  // One query for every reusable recommendation, newest first so the first
  // match per key wins.
  const prior = await prisma.programOverlapRecommendation.findMany({
    where: {
      evidenceHash: { in: [...new Set(flagged.map((p) => p.evidenceHash))] },
      promptVersion: PROGRAM_OVERLAP_RECOMMENDATION_VERSION,
    },
    include: { pair: { select: { programAId: true, programBId: true, level: true } } },
    orderBy: { createdAt: 'desc' },
  });
  const reusable = new Map<string, (typeof prior)[number]>();
  for (const r of prior) {
    const k = reuseKey(r.pair.level, r.pair.programAId, r.pair.programBId, r.evidenceHash);
    if (!reusable.has(k)) reusable.set(k, r);
  }

  const todo: RecPair[] = [];
  for (const p of flagged) {
    const match = reusable.get(reuseKey(p.level, p.programAId, p.programBId, p.evidenceHash));
    if (!match) {
      todo.push(p);
      continue;
    }
    result.skipped++;
    if (match.pairId === p.id) continue; // this pair already carries it
    try {
      const copy = {
        rationale: match.rationale,
        distinctiveA: match.distinctiveA,
        distinctiveB: match.distinctiveB,
        nextSteps: match.nextSteps,
        confidence: match.confidence,
        disagreesWithAction: match.disagreesWithAction,
        disagreementReason: match.disagreementReason,
        promptVersion: match.promptVersion,
        aiInferenceId: match.aiInferenceId,
        evidenceHash: match.evidenceHash,
      };
      await prisma.programOverlapRecommendation.upsert({
        where: { pairId: p.id },
        create: { pairId: p.id, ...copy },
        update: copy,
      });
    } catch (e) {
      result.skipped--;
      result.failed++;
      console.error(
        `[program-overlap] could not copy recommendation ${match.id} to pair ${p.id}:`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  if (todo.length === 0) return result;

  const ids = [...new Set(todo.flatMap((p) => [p.programAId, p.programBId]))];
  const enrolled = await latestEnrolled(ids);
  const profiles = await prisma.programMarketProfile.findMany({
    where: { programId: { in: ids } },
    select: { programId: true, text: true },
  });
  const market = new Map(profiles.map((m) => [m.programId, m.text]));

  for (const p of todo) {
    try {
      const input = recommendationInput(p, enrolled, market);
      if (input === null) {
        result.failed++;
        console.error(`[program-overlap] pair ${p.id}: stored evidence does not parse — re-run program-overlap; skipped`);
        continue;
      }
      const res = await opts.ai.extractStructured(
        {
          ctx: { module: 'program-overlap', kind: 'recommendation', traceId: `program-overlap-${p.id}` },
          messages: buildProgramOverlapRecommendationMessages(input),
          methodVersion: PROGRAM_OVERLAP_RECOMMENDATION_VERSION,
          maxOutputTokens: 4000,
        },
        ProgramOverlapRecommendationSchema,
      );
      result.costUsd += res.cost.usd;
      const out = res.parsed;
      // The self-report is never trusted above the input-derived ceiling.
      const confidence = Math.min(out.confidence, overlapRecommendationConfidenceCeiling(input));
      const data = {
        rationale: out.rationale,
        distinctiveA: out.distinctiveA,
        distinctiveB: out.distinctiveB,
        nextSteps: out.nextSteps,
        confidence,
        disagreesWithAction: out.disagreesWithAction,
        disagreementReason: out.disagreesWithAction ? out.disagreementReason : null,
        promptVersion: PROGRAM_OVERLAP_RECOMMENDATION_VERSION,
        aiInferenceId: res.aiInferenceId,
        evidenceHash: p.evidenceHash,
      };
      await prisma.programOverlapRecommendation.upsert({
        where: { pairId: p.id },
        create: { pairId: p.id, ...data },
        update: data,
      });
      result.written++;
    } catch (e) {
      result.failed++;
      console.error(
        `[program-overlap] recommendation failed for pair ${p.id} (${p.programA.code} × ${p.programB.code}):`,
        e instanceof Error ? e.message : e,
      );
    }
  }
  return result;
}
