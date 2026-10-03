// program-overlap.v1 — read models for the API (spec §8, §10).
//
// Every reader goes through latestOverlapPairs (merge.ts): SUCCEEDED runs
// only, the latest full run per level, newer scoped runs overriding every
// pair that touches their scope. Nothing here queries ProgramOverlapPair by
// run id on its own.
//
// Plain Prisma throughout (no Prisma.sql fragments): these modules are read
// by Next.js server components via the @kku/db barrel.
import type {
  OverlapAction,
  OverlapBand,
  ProgramLevel,
  ProgramOverlapPair,
  ProgramOverlapRecommendation,
  RiskIndicatorSeverity,
  RiskMeasureKind,
} from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../index';
import { IS_CANONICAL_PROGRAM } from '../canonical-programs';
import { academicYearContextSync } from '../academic-year';
import { programFunnelRoundRows } from '../program-funnel';
import { byCodeUnits } from './load';
import { overlapGroups, type OverlapGroup } from './cluster';
import {
  coveringOverlapRun,
  latestOverlapPairs,
  overlapSelectionMeasures,
  type OverlapRunRow,
  type OverlapRunSelection,
} from './merge';
import { parsePairEvidence } from './evidence';
import { overlapRiskSignalFromPairs } from './risk';
import { OVERLAP_THRESHOLDS, PROGRAM_OVERLAP_VERSION, type PairEvidence } from './score';

// ─── Shared shapes ──────────────────────────────────────────────────────

/** The per-cell measures. The web ranks and filters by them client-side;
 *  the API returns every measure on every cell and takes no layer. */
export const OVERLAP_MATRIX_LAYERS = ['index', 'structure', 'content', 'outcome', 'market'] as const;
export type OverlapMatrixLayer = (typeof OVERLAP_MATRIX_LAYERS)[number];

/** The two KRIs this feature raises (risk-scoring.v1.14). */
export const OVERLAP_KRI_SLUGS = ['curriculum_overlap_max', 'market_confusion_max'] as const;
export type OverlapKriSlug = (typeof OVERLAP_KRI_SLUGS)[number];

export interface OverlapProgrammeRef {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string | null;
  facultyId: string;
  facultyCode: string | null;
  facultyNameEn: string | null;
}

export interface OverlapRecommendationView {
  rationale: string;
  distinctiveA: string;
  distinctiveB: string;
  nextSteps: string[];
  confidence: number;
  disagreesWithAction: boolean;
  disagreementReason: string | null;
  promptVersion: string;
  aiInferenceId: string | null;
  /** The pair's evidence changed after the recommendation was written. */
  stale: boolean;
  createdAt: string;
}

// ─── Matrix ─────────────────────────────────────────────────────────────

export interface OverlapMatrixCell {
  a: string;
  b: string;
  pairId: string;
  overlapIndex: number | null;
  structure: number | null;
  content: number | null;
  outcome: number | null;
  marketSimilarity: number | null;
  /** Share (0–100) of A's major credits found in B, and the reverse. */
  containmentAInB: number | null;
  containmentBInA: number | null;
  band: OverlapBand;
  primaryAction: OverlapAction | null;
  languageVariant: boolean;
  /** Non-null course layers (structure, content): 0–2. 0 = not scored —
   *  no course comparison (D9). Read from the stored layer columns, so it
   *  never depends on the evidence parsing. */
  courseLayers: number;
}

export interface OverlapMatrixKpis {
  /** Pairs in band HIGH, language variants included. */
  highPairs: number;
  /** Of `highPairs`, how many are Thai/international language variants. */
  highLanguageVariantPairs: number;
  /** Programmes that belong to an outlined group (index ≥ bandModerate). */
  programmesInGroups: number;
  /** Pairs carrying CONSIDER_MERGE_OR_TRACK. */
  mergeCandidates: number;
  /** Σ equivCredits over pairs carrying CONSOLIDATE_EQUIVALENT_COURSES. */
  consolidatableCredits: number;
}

export interface OverlapMatrixResponse {
  methodologyVersion: string;
  /** The base full run, or the latest scoped run when no full run exists. */
  runId: string | null;
  /** completedAt of the newest run the answer rests on (ISO). */
  completedAt: string | null;
  level: ProgramLevel;
  /** The faculty filter in force, or null for the whole level. */
  facultyId: string | null;
  programmes: OverlapProgrammeRef[];
  cells: OverlapMatrixCell[];
  /** Connected components at overlapIndex ≥ bandModerate. */
  groups: OverlapGroup[];
  kpis: OverlapMatrixKpis;
}

// ─── Pair detail ────────────────────────────────────────────────────────

export interface OverlapPairDetail {
  pairId: string;
  runId: string;
  level: ProgramLevel;
  methodologyVersion: string;
  /** False when a newer run has superseded this pair row. */
  isCurrent: boolean;
  /** completedAt of the run that produced this row (ISO). */
  completedAt: string | null;
  programA: OverlapProgrammeRef;
  programB: OverlapProgrammeRef;
  structure: number | null;
  content: number | null;
  outcome: number | null;
  overlapIndex: number | null;
  containmentAInB: number | null;
  containmentBInA: number | null;
  band: OverlapBand;
  sharedCredits: number;
  equivCredits: number;
  sharedStaff: number;
  marketSimilarity: number | null;
  languageVariant: boolean;
  actions: OverlapAction[];
  primaryAction: OverlapAction | null;
  /** Null when the stored JSON does not parse as PairEvidence. */
  evidence: PairEvidence | null;
  recommendation: OverlapRecommendationView | null;
}

// ─── Deep-Dive section ──────────────────────────────────────────────────

export interface OverlapSibling {
  pairId: string;
  sibling: OverlapProgrammeRef;
  /** True when the section's programme is the pair's programme A; the
   *  evidence and recommendation A/B fields are oriented by this. */
  programIsA: boolean;
  structure: number | null;
  content: number | null;
  outcome: number | null;
  overlapIndex: number;
  band: OverlapBand;
  /** Share of this programme contained in the sibling (0–100). */
  containmentInSibling: number | null;
  /** Share of the sibling contained in this programme (0–100). */
  siblingContainmentInProgramme: number | null;
  sharedCredits: number;
  equivCredits: number;
  sharedStaff: number;
  marketSimilarity: number | null;
  actions: OverlapAction[];
  primaryAction: OverlapAction | null;
  languageVariant: boolean;
  evidence: PairEvidence | null;
  recommendation: OverlapRecommendationView | null;
}

export interface ProgramOverlapSection {
  programId: string;
  methodologyVersion: string;
  /** completedAt of the newest run covering this programme (ISO). */
  completedAt: string | null;
  /** Siblings with overlapIndex ≥ bandLow, sorted by index desc. Market-only
   *  pairs (index null or < bandLow) are not siblings. */
  siblings: OverlapSibling[];
}

// ─── Self-competition (Risk) ────────────────────────────────────────────

export interface SelfCompetitionKri {
  programId: string;
  indicatorSlug: OverlapKriSlug;
  severity: Extract<RiskIndicatorSeverity, 'WARN' | 'CRITICAL'>;
  value: number | null;
  observedAt: string;
}

export interface SelfCompetitionRow {
  pairId: string;
  level: ProgramLevel;
  programA: OverlapProgrammeRef;
  programB: OverlapProgrammeRef;
  overlapIndex: number | null;
  marketSimilarity: number | null;
  languageVariant: boolean;
  primaryAction: OverlapAction | null;
  /** Reported intake of the latest complete entry year; null when no data. */
  intakeA: number | null;
  intakeB: number | null;
  intakeEntryYearA: number | null;
  intakeEntryYearB: number | null;
  /** The WARN / CRITICAL breaches that put this pair on the list. */
  breaches: SelfCompetitionKri[];
  /** Kinds of the overlap-triggered measures in either side's latest
   *  assessment that name this pair or its sibling. */
  measureKinds: RiskMeasureKind[];
}

// ─── Evidence parsing ───────────────────────────────────────────────────

// The schema lives in ./evidence (pure, no Prisma) so the ingestion runner
// can share it; re-exported here for the read-model callers.
export { parsePairEvidence } from './evidence';

function recommendationView(
  rec: ProgramOverlapRecommendation | null | undefined,
  pairEvidenceHash: string,
): OverlapRecommendationView | null {
  if (!rec) return null;
  return {
    rationale: rec.rationale,
    distinctiveA: rec.distinctiveA,
    distinctiveB: rec.distinctiveB,
    nextSteps: rec.nextSteps,
    confidence: rec.confidence,
    disagreesWithAction: rec.disagreesWithAction,
    disagreementReason: rec.disagreementReason,
    promptVersion: rec.promptVersion,
    aiInferenceId: rec.aiInferenceId,
    stale: rec.evidenceHash !== pairEvidenceHash,
    createdAt: rec.createdAt.toISOString(),
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────

const PROGRAMME_SELECT = {
  id: true,
  code: true,
  nameTh: true,
  nameEn: true,
  facultyId: true,
  faculty: { select: { code: true, nameEn: true } },
} as const;

interface ProgrammeRow {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string | null;
  facultyId: string;
  faculty: { code: string; nameEn: string | null } | null;
}

function programmeRef(p: ProgrammeRow): OverlapProgrammeRef {
  return {
    id: p.id,
    code: p.code,
    nameTh: p.nameTh,
    nameEn: p.nameEn,
    facultyId: p.facultyId,
    facultyCode: p.faculty?.code ?? null,
    facultyNameEn: p.faculty?.nameEn ?? null,
  };
}

function byCode(a: OverlapProgrammeRef, b: OverlapProgrammeRef): number {
  return byCodeUnits(a.code, b.code) || byCodeUnits(a.id, b.id);
}

/** completedAt (ISO) of the newest run in the selection. */
function newestCompletedAt(selection: OverlapRunSelection<OverlapRunRow>): string | null {
  const times = [selection.fullRun, ...selection.scopedRuns]
    .map((r) => r?.completedAt?.getTime())
    .filter((t): t is number => t !== undefined);
  return times.length > 0 ? new Date(Math.max(...times)).toISOString() : null;
}

/** completedAt (ISO) of the newest run covering `programId`: its latest
 *  covering scoped run, else the full run. */
function coveringCompletedAt(selection: OverlapRunSelection<OverlapRunRow>, programId: string): string | null {
  return coveringOverlapRun(selection, programId)?.completedAt?.toISOString() ?? null;
}

/** Pure: KPIs over the displayed pairs and groups. */
export function overlapMatrixKpis(
  pairs: ReadonlyArray<Pick<ProgramOverlapPair, 'band' | 'languageVariant' | 'actions' | 'equivCredits'>>,
  groups: readonly OverlapGroup[],
): OverlapMatrixKpis {
  let highPairs = 0, highLanguageVariantPairs = 0, mergeCandidates = 0, consolidatableCredits = 0;
  for (const p of pairs) {
    if (p.band === 'HIGH') {
      highPairs += 1;
      if (p.languageVariant) highLanguageVariantPairs += 1;
    }
    if (p.actions.includes('CONSIDER_MERGE_OR_TRACK')) mergeCandidates += 1;
    if (p.actions.includes('CONSOLIDATE_EQUIVALENT_COURSES')) consolidatableCredits += p.equivCredits;
  }
  const programmesInGroups = new Set(groups.flatMap((g) => g.members)).size;
  return { highPairs, highLanguageVariantPairs, programmesInGroups, mergeCandidates, consolidatableCredits };
}

// ─── Matrix ─────────────────────────────────────────────────────────────

/**
 * The programme-by-programme matrix for one level. With `facultyId`, shows
 * that faculty's programmes plus any outside programme holding a stored pair
 * with one of them; cells are the pairs touching the faculty. Without it,
 * every canonical ACTIVE programme of the level that a stored pair names.
 * Only ACTIVE programmes are compared (D5): a pair whose side has since left
 * ACTIVE is dropped from every read model.
 */
export async function overlapMatrix(opts: {
  level: ProgramLevel;
  facultyId?: string | null;
}): Promise<OverlapMatrixResponse> {
  const facultyId = opts.facultyId ?? null;
  const base = {
    methodologyVersion: PROGRAM_OVERLAP_VERSION,
    level: opts.level,
    facultyId,
  };

  const { selection, pairs: allPairs } = await latestOverlapPairs(opts.level);
  const runId = selection.fullRun?.id ?? selection.scopedRuns[selection.scopedRuns.length - 1]?.id ?? null;
  if (runId === null) {
    return {
      ...base, runId: null, completedAt: null, programmes: [], cells: [], groups: [],
      kpis: overlapMatrixKpis([], []),
    };
  }

  const levelProgrammes: ProgrammeRow[] = await prisma.program.findMany({
    where: { ...IS_CANONICAL_PROGRAM, status: 'ACTIVE', level: opts.level },
    select: PROGRAMME_SELECT,
  });
  const byId = new Map(levelProgrammes.map((p) => [p.id, p]));
  const inScope = (id: string): boolean => {
    const p = byId.get(id);
    return p !== undefined && (facultyId === null || p.facultyId === facultyId);
  };

  // Pairs touching the scope, with both ends known canonical programmes.
  const pairs = allPairs.filter(
    (p) => byId.has(p.programAId) && byId.has(p.programBId) && (inScope(p.programAId) || inScope(p.programBId)),
  );
  const shown = new Set<string>();
  for (const p of levelProgrammes) if (facultyId !== null && p.facultyId === facultyId) shown.add(p.id);
  for (const p of pairs) {
    shown.add(p.programAId);
    shown.add(p.programBId);
  }
  const programmes = [...shown].map((id) => programmeRef(byId.get(id)!)).sort(byCode);
  const ids = programmes.map((p) => p.id);

  const groups = overlapGroups(
    ids,
    pairs.map((p) => ({ a: p.programAId, b: p.programBId, index: p.overlapIndex })),
    OVERLAP_THRESHOLDS.bandModerate,
  );

  const cells: OverlapMatrixCell[] = pairs.map((p) => {
    return {
      a: p.programAId,
      b: p.programBId,
      pairId: p.id,
      overlapIndex: p.overlapIndex,
      structure: p.structure,
      content: p.content,
      outcome: p.outcome,
      marketSimilarity: p.marketSimilarity,
      containmentAInB: p.containmentAInB,
      containmentBInA: p.containmentBInA,
      band: p.band,
      primaryAction: p.primaryAction,
      languageVariant: p.languageVariant,
      courseLayers: [p.structure, p.content].filter((x) => x !== null).length,
    };
  });

  return {
    ...base,
    runId,
    completedAt: newestCompletedAt(selection),
    programmes,
    cells,
    groups,
    kpis: overlapMatrixKpis(pairs, groups),
  };
}

// ─── Pair detail ────────────────────────────────────────────────────────

/** One stored pair with its evidence, recommendation and both programmes.
 *  Null when the pair id is unknown. */
export async function overlapPairDetail(pairId: string): Promise<OverlapPairDetail | null> {
  const pair = await prisma.programOverlapPair.findUnique({
    where: { id: pairId },
    include: {
      recommendation: true,
      run: { select: { completedAt: true } },
      programA: { select: PROGRAMME_SELECT },
      programB: { select: PROGRAMME_SELECT },
    },
  });
  if (!pair) return null;
  const { pairs } = await latestOverlapPairs(pair.level, { programIds: [pair.programAId, pair.programBId] });
  return {
    pairId: pair.id,
    runId: pair.runId,
    level: pair.level,
    methodologyVersion: pair.methodologyVersion,
    isCurrent: pairs.some((p) => p.id === pair.id),
    completedAt: pair.run.completedAt?.toISOString() ?? null,
    programA: programmeRef(pair.programA),
    programB: programmeRef(pair.programB),
    structure: pair.structure,
    content: pair.content,
    outcome: pair.outcome,
    overlapIndex: pair.overlapIndex,
    containmentAInB: pair.containmentAInB,
    containmentBInA: pair.containmentBInA,
    band: pair.band,
    sharedCredits: pair.sharedCredits,
    equivCredits: pair.equivCredits,
    sharedStaff: pair.sharedStaff,
    marketSimilarity: pair.marketSimilarity,
    languageVariant: pair.languageVariant,
    actions: pair.actions,
    primaryAction: pair.primaryAction,
    evidence: parsePairEvidence(pair.evidenceJson),
    recommendation: recommendationView(pair.recommendation, pair.evidenceHash),
  };
}

/** completedAt (ISO) of the newest SUCCEEDED overlap run, of one level or
 *  of any; null when there is none. The freshness of an empty overlap-derived
 *  answer. */
export async function latestOverlapRunCompletedAt(level?: ProgramLevel): Promise<string | null> {
  const run = await prisma.programOverlapRun.findFirst({
    where: { status: 'SUCCEEDED', completedAt: { not: null }, ...(level ? { level } : {}) },
    orderBy: { completedAt: 'desc' },
    select: { completedAt: true },
  });
  return run?.completedAt?.toISOString() ?? null;
}

// ─── Deep-Dive section ──────────────────────────────────────────────────

/**
 * The Deep-Dive "Overlap" section. Null when no run covers the programme, or
 * the covering run did not measure it on courses (the section is hidden, D6); `siblings: []` when none reaches bandLow
 * (also hidden by the page, but the API says why).
 */
export async function programOverlapSection(programId: string): Promise<ProgramOverlapSection | null> {
  const program = await prisma.program.findUnique({ where: { id: programId }, select: { level: true } });
  if (!program) return null;
  const { selection, pairs } = await latestOverlapPairs(program.level, { programIds: [programId] });
  if (!overlapSelectionMeasures(selection, programId)) return null;

  const siblingPairs = pairs.filter(
    (p) =>
      (p.programAId === programId || p.programBId === programId) &&
      p.overlapIndex !== null &&
      p.overlapIndex >= OVERLAP_THRESHOLDS.bandLow,
  );
  const siblingIds = siblingPairs.map((p) => (p.programAId === programId ? p.programBId : p.programAId));
  const [siblingRows, recs] =
    siblingPairs.length === 0
      ? [[] as ProgrammeRow[], [] as ProgramOverlapRecommendation[]]
      : await Promise.all([
          prisma.program.findMany({ where: { id: { in: siblingIds }, status: 'ACTIVE' }, select: PROGRAMME_SELECT }),
          prisma.programOverlapRecommendation.findMany({ where: { pairId: { in: siblingPairs.map((p) => p.id) } } }),
        ]);
  const siblingById = new Map(siblingRows.map((p) => [p.id, p]));
  const recByPair = new Map(recs.map((r) => [r.pairId, r]));

  const siblings: OverlapSibling[] = [];
  for (const p of siblingPairs) {
    const programIsA = p.programAId === programId;
    const row = siblingById.get(programIsA ? p.programBId : p.programAId);
    if (!row) continue;
    siblings.push({
      pairId: p.id,
      sibling: programmeRef(row),
      programIsA,
      structure: p.structure,
      content: p.content,
      outcome: p.outcome,
      overlapIndex: p.overlapIndex!,
      band: p.band,
      containmentInSibling: programIsA ? p.containmentAInB : p.containmentBInA,
      siblingContainmentInProgramme: programIsA ? p.containmentBInA : p.containmentAInB,
      sharedCredits: p.sharedCredits,
      equivCredits: p.equivCredits,
      sharedStaff: p.sharedStaff,
      marketSimilarity: p.marketSimilarity,
      actions: p.actions,
      primaryAction: p.primaryAction,
      languageVariant: p.languageVariant,
      evidence: parsePairEvidence(p.evidenceJson),
      recommendation: recommendationView(recByPair.get(p.id), p.evidenceHash),
    });
  }
  siblings.sort((x, y) => y.overlapIndex - x.overlapIndex || byCode(x.sibling, y.sibling));

  return {
    programId,
    methodologyVersion: PROGRAM_OVERLAP_VERSION,
    completedAt: coveringCompletedAt(selection, programId),
    siblings,
  };
}

// ─── Self-competition (Risk) ────────────────────────────────────────────

const MeasureEvidenceSchema = z
  .object({
    siblingProgramId: z.string().nullable().optional(),
    overlapPairId: z.string().nullable().optional(),
  })
  .passthrough();

const isOverlapSlug = (s: string): s is OverlapKriSlug => (OVERLAP_KRI_SLUGS as readonly string[]).includes(s);

/** Reported intake of the latest complete entry year, from the TCAS funnel
 *  (the same reading as the bachelor_intake_floor KRI). */
async function latestIntake(programId: string, completeThroughBE: number): Promise<{ intake: number | null; yearBE: number | null }> {
  const rows = (await programFunnelRoundRows(programId)).filter((r) => r.entryYearBE <= completeThroughBE);
  if (rows.length === 0) return { intake: null, yearBE: null };
  const yearBE = Math.max(...rows.map((r) => r.entryYearBE));
  const intake = rows.filter((r) => r.entryYearBE === yearBE).reduce((s, r) => s + (r.regReported ?? 0), 0);
  return { intake, yearBE };
}

/**
 * The pairs behind a WARN or CRITICAL reading of either overlap KRI, from
 * the latest breach row per programme × indicator. Each breaching programme
 * contributes its max-overlap pair (curriculum KRI) and/or its max-market
 * pair (market KRI) from the CURRENT merged pairs; rows are deduplicated by
 * pair. Scope: `facultyIds` / `programIds` narrow the breaching programmes
 * (a pair's in-scope side always breaches at least as severely as the
 * outside side does on that pair, so nothing in scope is lost).
 */
export async function selfCompetitionRows(opts: {
  level?: ProgramLevel;
  facultyIds?: string[];
  programIds?: string[];
} = {}): Promise<SelfCompetitionRow[]> {
  const scoped = opts.facultyIds !== undefined || opts.programIds !== undefined;
  const scopeOr = [
    ...((opts.facultyIds?.length ?? 0) > 0 ? [{ facultyId: { in: opts.facultyIds! } }] : []),
    ...((opts.programIds?.length ?? 0) > 0 ? [{ id: { in: opts.programIds! } }] : []),
  ];
  if (scoped && scopeOr.length === 0) return [];

  const breachRows = await prisma.riskIndicatorBreach.findMany({
    where: {
      indicatorSlug: { in: [...OVERLAP_KRI_SLUGS] },
      program: {
        status: 'ACTIVE',
        ...(opts.level ? { level: opts.level } : {}),
        ...(scopeOr.length > 0 ? { OR: scopeOr } : {}),
      },
    },
    orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
    select: {
      programId: true, indicatorSlug: true, severity: true, value: true, observedAt: true,
      program: { select: { level: true } },
    },
  });
  // Latest per programme × indicator (rows arrive newest first).
  const latest = new Map<string, (typeof breachRows)[number]>();
  for (const b of breachRows) {
    const key = `${b.programId}|${b.indicatorSlug}`;
    if (!latest.has(key)) latest.set(key, b);
  }
  const alarms: Array<SelfCompetitionKri & { level: ProgramLevel }> = [];
  for (const b of latest.values()) {
    if ((b.severity === 'WARN' || b.severity === 'CRITICAL') && isOverlapSlug(b.indicatorSlug)) {
      alarms.push({
        programId: b.programId,
        indicatorSlug: b.indicatorSlug,
        severity: b.severity,
        value: b.value,
        observedAt: b.observedAt.toISOString(),
        level: b.program.level,
      });
    }
  }
  if (alarms.length === 0) return [];

  // Resolve each alarm to its pair in the current merged set, per level.
  const byLevel = new Map<ProgramLevel, string[]>();
  for (const a of alarms) byLevel.set(a.level, [...new Set([...(byLevel.get(a.level) ?? []), a.programId])]);
  const rowsByPair = new Map<string, { pair: ProgramOverlapPair; breaches: SelfCompetitionKri[] }>();
  for (const [level, programIds] of byLevel) {
    // activeOnly, exactly as loadOverlapRiskSignal reads it, so each breach
    // resolves to the same pair the KRI was computed from.
    const { selection, pairs } = await latestOverlapPairs(level, { programIds, activeOnly: true });
    const pairById = new Map(pairs.map((p) => [p.id, p]));
    for (const a of alarms.filter((x) => x.level === level)) {
      const signal = overlapRiskSignalFromPairs(a.programId, selection, pairs);
      if (!signal) continue;
      const pairId = a.indicatorSlug === 'curriculum_overlap_max' ? signal.curriculumPairId : signal.marketPairId;
      const pair = pairId ? pairById.get(pairId) : undefined;
      if (!pair) continue;
      const { level: _level, ...kri } = a;
      const entry = rowsByPair.get(pair.id) ?? { pair, breaches: [] };
      entry.breaches.push(kri);
      rowsByPair.set(pair.id, entry);
    }
  }
  if (rowsByPair.size === 0) return [];

  const entries = [...rowsByPair.values()];
  const programIds = [...new Set(entries.flatMap((e) => [e.pair.programAId, e.pair.programBId]))];
  const [programmeRows, assessments] = await Promise.all([
    prisma.program.findMany({ where: { id: { in: programIds }, status: 'ACTIVE' }, select: PROGRAMME_SELECT }),
    prisma.riskAssessment.findMany({
      where: { programId: { in: programIds } },
      orderBy: [{ assessedAt: 'desc' }, { id: 'desc' }],
      select: { id: true, programId: true },
    }),
  ]);
  const latestAssessment = new Map<string, string>();
  for (const a of assessments) if (!latestAssessment.has(a.programId)) latestAssessment.set(a.programId, a.id);
  const assessmentProgramme = new Map([...latestAssessment.entries()].map(([pid, aid]) => [aid, pid]));
  const measures =
    latestAssessment.size === 0
      ? []
      : await prisma.riskMeasure.findMany({
          where: { assessmentId: { in: [...latestAssessment.values()] }, triggerIndicatorSlug: { in: [...OVERLAP_KRI_SLUGS] } },
          select: { assessmentId: true, kind: true, evidenceJson: true },
        });

  const completeThroughBE = academicYearContextSync(new Date()).latestCompleteEntryYearBE;
  const intakes = new Map(
    await Promise.all(programIds.map(async (id) => [id, await latestIntake(id, completeThroughBE)] as const)),
  );
  const programmeById = new Map(programmeRows.map((p) => [p.id, p]));

  const out: SelfCompetitionRow[] = [];
  for (const { pair, breaches } of entries) {
    const a = programmeById.get(pair.programAId);
    const b = programmeById.get(pair.programBId);
    if (!a || !b) continue;
    const kinds = new Set<RiskMeasureKind>();
    for (const m of measures) {
      const owner = assessmentProgramme.get(m.assessmentId);
      if (owner !== pair.programAId && owner !== pair.programBId) continue;
      const other = owner === pair.programAId ? pair.programBId : pair.programAId;
      const ev = MeasureEvidenceSchema.safeParse(m.evidenceJson);
      if (!ev.success) continue;
      if (ev.data.overlapPairId === pair.id || ev.data.siblingProgramId === other) kinds.add(m.kind);
    }
    const ia = intakes.get(pair.programAId);
    const ib = intakes.get(pair.programBId);
    out.push({
      pairId: pair.id,
      level: pair.level,
      programA: programmeRef(a),
      programB: programmeRef(b),
      overlapIndex: pair.overlapIndex,
      marketSimilarity: pair.marketSimilarity,
      languageVariant: pair.languageVariant,
      primaryAction: pair.primaryAction,
      intakeA: ia?.intake ?? null,
      intakeB: ib?.intake ?? null,
      intakeEntryYearA: ia?.yearBE ?? null,
      intakeEntryYearB: ib?.yearBE ?? null,
      breaches: breaches.sort((x, y) => byCodeUnits(x.programId, y.programId) || byCodeUnits(x.indicatorSlug, y.indicatorSlug)),
      measureKinds: [...kinds].sort(),
    });
  }
  const severityRank = (r: SelfCompetitionRow): number => (r.breaches.some((k) => k.severity === 'CRITICAL') ? 1 : 0);
  return out.sort(
    (x, y) =>
      severityRank(y) - severityRank(x) ||
      (y.overlapIndex ?? -1) - (x.overlapIndex ?? -1) ||
      (y.marketSimilarity ?? -1) - (x.marketSimilarity ?? -1) ||
      byCodeUnits(x.pairId, y.pairId),
  );
}
