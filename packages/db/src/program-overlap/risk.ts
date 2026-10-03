// program-overlap.v1 → risk-scoring.v1.14: the overlap signal behind the
// `curriculum_overlap_max` and `market_confusion_max` KRIs (spec §7).
//
// Two deliberate readings:
//  - Each value is the max over STORED pairs. Unstored pairs sit below the
//    storage floors (index < storeIndex 30, market < marketConfusionWarn 60),
//    and both floors are at or below the KRIs' WARN values, so the severity is
//    never wrong — only the exact value of an OK reading may be unknown.
//  - mergeCandidate (and the containment / actions reported to the AI) come
//    from the max-overlap pair only: the merge rule reviews the closest
//    sibling, not any sibling that happens to carry the action.
//  - Limited evidence (evidence.coverage.limitedEvidence: PLO-only or no
//    course comparison) on the max-overlap pair caps the curriculum KRI at
//    WARN and clears mergeCandidate — strong actions need course evidence.
//    Evidence that cannot be read counts as limited: the conservative choice
//    for a Council-facing CRITICAL.
import type { OverlapAction, ProgramLevel } from '@prisma/client';
import { byCodeUnits } from './load';
import {
  latestOverlapPairs,
  overlapSelectionCovers,
  type OverlapPairRef,
  type OverlapRunRef,
  type OverlapRunSelection,
} from './merge';

export interface OverlapRiskSignal {
  /** Highest overlap index against a same-level sibling (language variants
   *  excluded). Null when the programme has no stored pair with an index —
   *  every pair is then below the storage floor, so there is no breach row. */
  curriculumOverlapMax: number | null;
  curriculumSiblingId: string | null;
  curriculumPairId: string | null;
  curriculumRunId: string | null;
  /** max(containmentAInB, containmentBInA) of the max-overlap pair. */
  curriculumContainmentMax: number | null;
  /** The max-overlap pair's actions. */
  curriculumActions: OverlapAction[];
  /** The max-overlap pair rests on limited evidence (or its evidence could
   *  not be read): the KRI is capped at WARN. */
  curriculumLimitedEvidence: boolean;
  /** The max-overlap pair's actions include CONSIDER_MERGE_OR_TRACK and its
   *  evidence is not limited. */
  mergeCandidate: boolean;
  /** Highest market similarity against a same-level sibling (language
   *  variants excluded), over stored pairs only. */
  marketConfusionMax: number | null;
  marketSiblingId: string | null;
  marketPairId: string | null;
  marketRunId: string | null;
  /** The newest run this programme's answer rests on: its latest covering
   *  scoped run, else the full run. */
  runId: string;
}

export interface OverlapRiskPair extends OverlapPairRef {
  id: string;
  overlapIndex: number | null;
  marketSimilarity: number | null;
  containmentAInB: number | null;
  containmentBInA: number | null;
  languageVariant: boolean;
  actions: readonly OverlapAction[];
  /** The stored evidenceJson; only coverage.limitedEvidence is read. */
  evidenceJson: unknown;
}

/** Pure: does a stored pair's evidence mark it limited? Anything other than
 *  an explicit `coverage.limitedEvidence === false` counts as limited. */
export function pairHasLimitedEvidence(evidenceJson: unknown): boolean {
  if (typeof evidenceJson !== 'object' || evidenceJson === null) return true;
  const coverage = (evidenceJson as { coverage?: unknown }).coverage;
  if (typeof coverage !== 'object' || coverage === null) return true;
  return (coverage as { limitedEvidence?: unknown }).limitedEvidence !== false;
}

function containmentMax(p: OverlapRiskPair): number | null {
  const xs = [p.containmentAInB, p.containmentBInA].filter((x): x is number => x !== null);
  return xs.length > 0 ? Math.max(...xs) : null;
}

interface Best { value: number; siblingId: string; pair: OverlapRiskPair }

function better(cur: Best | null, value: number, siblingId: string): boolean {
  if (cur === null) return true;
  return value > cur.value || (value === cur.value && byCodeUnits(siblingId, cur.siblingId) < 0);
}

/**
 * Pure: the signal for one programme from the MERGED current pairs (see
 * mergeOverlapRuns). Null when the selection does not cover the programme —
 * "no overlap analysis yet", never 0.
 */
export function overlapRiskSignalFromPairs(
  programId: string,
  selection: OverlapRunSelection<OverlapRunRef>,
  pairs: readonly OverlapRiskPair[],
): OverlapRiskSignal | null {
  if (!overlapSelectionCovers(selection, programId)) return null;
  const covering = selection.scopedRuns.filter((r) => r.scopeProgramIds.includes(programId));
  const runId = covering.length > 0 ? covering[covering.length - 1]!.id : selection.fullRun!.id;

  let curriculum: Best | null = null;
  let market: Best | null = null;
  for (const p of pairs) {
    if (p.languageVariant) continue;
    const siblingId = p.programAId === programId ? p.programBId : p.programBId === programId ? p.programAId : null;
    if (siblingId === null) continue;
    if (p.overlapIndex !== null && better(curriculum, p.overlapIndex, siblingId)) {
      curriculum = { value: p.overlapIndex, siblingId, pair: p };
    }
    if (p.marketSimilarity !== null && better(market, p.marketSimilarity, siblingId)) {
      market = { value: p.marketSimilarity, siblingId, pair: p };
    }
  }
  const curriculumLimited = curriculum ? pairHasLimitedEvidence(curriculum.pair.evidenceJson) : false;
  return {
    curriculumOverlapMax: curriculum?.value ?? null,
    curriculumSiblingId: curriculum?.siblingId ?? null,
    curriculumPairId: curriculum?.pair.id ?? null,
    curriculumRunId: curriculum?.pair.runId ?? null,
    curriculumContainmentMax: curriculum ? containmentMax(curriculum.pair) : null,
    curriculumActions: curriculum ? [...curriculum.pair.actions] : [],
    curriculumLimitedEvidence: curriculumLimited,
    mergeCandidate: !curriculumLimited && (curriculum?.pair.actions.includes('CONSIDER_MERGE_OR_TRACK') ?? false),
    marketConfusionMax: market?.value ?? null,
    marketSiblingId: market?.siblingId ?? null,
    marketPairId: market?.pair.id ?? null,
    marketRunId: market?.pair.runId ?? null,
    runId,
  };
}

/** The overlap signal of one programme at its level, from the latest
 *  SUCCEEDED full run with newer SUCCEEDED scoped runs overlaid. */
export async function loadOverlapRiskSignal(programId: string, level: ProgramLevel): Promise<OverlapRiskSignal | null> {
  const { selection, pairs } = await latestOverlapPairs(level, { programIds: [programId] });
  return overlapRiskSignalFromPairs(programId, selection, pairs);
}

/** Flags a breach of `indicatorSlug` carries into deriveRuleMeasures: a
 *  curriculum_overlap_max breach whose max-overlap pair is a merge candidate
 *  gets 'merge-candidate' (fires the PROGRAM_MERGE rule). */
export function overlapBreachFlags(indicatorSlug: string, overlap: OverlapRiskSignal | null | undefined): string[] {
  return indicatorSlug === 'curriculum_overlap_max' && overlap?.mergeCandidate ? ['merge-candidate'] : [];
}

export interface OverlapMeasureEvidence {
  siblingProgramId: string | null;
  overlapRunId: string | null;
  overlapPairId: string | null;
}

/** Evidence fields for a measure triggered by one of the two overlap KRIs —
 *  the sibling, the run and the pair the breach value came from. Null for any
 *  other indicator, or when there is no overlap signal. */
export function overlapMeasureEvidence(
  indicatorSlug: string | null | undefined,
  overlap: OverlapRiskSignal | null | undefined,
): OverlapMeasureEvidence | null {
  if (!overlap) return null;
  if (indicatorSlug === 'curriculum_overlap_max') {
    return { siblingProgramId: overlap.curriculumSiblingId, overlapRunId: overlap.curriculumRunId, overlapPairId: overlap.curriculumPairId };
  }
  if (indicatorSlug === 'market_confusion_max') {
    return { siblingProgramId: overlap.marketSiblingId, overlapRunId: overlap.marketRunId, overlapPairId: overlap.marketPairId };
  }
  return null;
}
