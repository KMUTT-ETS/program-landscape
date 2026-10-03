// Pure labels, formatters and orientation helpers for programme overlap
// (program-overlap.v1), shared by the Education dashboard, the Deep-Dive
// "Overlap" section and the Risk self-competition panel.
//
// Type-only imports from @kku/db: a runtime import of that barrel would drag
// Prisma into the client bundle. This module is safe in client components and
// in node-environment tests.
import type { OverlapPairDetail, OverlapRecommendationView, PairEvidence } from '@kku/db';

export type OverlapActionKey = NonNullable<OverlapPairDetail['primaryAction']>;

/** Weakest → strongest, the order the rules rank them (spec §6.1). */
export const OVERLAP_ACTION_ORDER: readonly OverlapActionKey[] = [
  'COORDINATE_SHARED_COURSES',
  'CONSOLIDATE_EQUIVALENT_COURSES',
  'SHARE_STAFF_RESOURCES',
  'DIFFERENTIATE',
  'CONSIDER_MERGE_OR_TRACK',
];

export const OVERLAP_ACTION_LABEL: Record<OverlapActionKey, string> = {
  COORDINATE_SHARED_COURSES: 'Coordinate shared courses',
  CONSOLIDATE_EQUIVALENT_COURSES: 'Consolidate equivalent courses',
  SHARE_STAFF_RESOURCES: 'Share staff & resources',
  DIFFERENTIATE: 'Differentiate',
  CONSIDER_MERGE_OR_TRACK: 'Consider merge or track',
};

/** Every action is a suggestion for a human to weigh, never a verdict. */
export function actionBadgeLabel(action: OverlapActionKey): string {
  return `${OVERLAP_ACTION_LABEL[action]} — for review`;
}

/** Strongest first — the order a reader should meet them in. */
export function sortActionsStrongestFirst(actions: readonly OverlapActionKey[]): OverlapActionKey[] {
  return [...actions].sort((x, y) => OVERLAP_ACTION_ORDER.indexOf(y) - OVERLAP_ACTION_ORDER.indexOf(x));
}

export const LANGUAGE_VARIANT_LABEL = 'Thai / international versions';

export const LIMITED_EVIDENCE_LABEL = 'Limited evidence — PLO-only or no course comparison';
export const LIMITED_EVIDENCE_DETAIL =
  'Fewer than two curriculum layers could be measured, or none of them compares courses. Such a pair is scored only when shared staff or market similarity corroborates it; when it is, the band is capped at moderate and neither a merge nor differentiation is suggested.';

/** D8: a limited-evidence pair with no corroborating signal is not scored. */
export const UNCORROBORATED_LABEL = 'Not scored — PLO match only, no corroborating signal';
export const UNCORROBORATED_DETAIL =
  'PLO wording matched, but no shared staff and low market similarity; treated as no overlap.';

/**
 * True when the stored evidence marks the pair as limited (spec §12.4).
 * Evidence written before calibration lacks the flag and parses as null, so
 * null evidence is "unknown", not "limited".
 */
export function isLimitedEvidence(evidence: PairEvidence | null | undefined): boolean {
  return evidence?.coverage.limitedEvidence === true;
}

/**
 * True when the stored evidence marks the pair as an uncorroborated
 * limited-evidence match (D8): overlap index null, band NONE, no actions.
 */
export function isUncorroborated(evidence: PairEvidence | null | undefined): boolean {
  return evidence?.coverage.uncorroborated === true;
}

/** The same test for a matrix cell, which carries the flag itself. */
export function isUncorroboratedCell(cell: { uncorroborated: boolean }): boolean {
  return cell.uncorroborated;
}

/** "72" / "—" for a nullable 0–100 figure. */
export function pct(v: number | null): string {
  return v === null ? '—' : String(Math.round(v));
}

/** Short programme label: Thai name (data labels stay Thai), code as fallback. */
export function programmeLabel(p: { code: string; nameTh: string; nameEn: string | null }): string {
  return p.nameTh || p.nameEn || p.code;
}

/**
 * Re-orient pair evidence so side A is the given programme. Stored evidence
 * is oriented by the pair's own A/B; the Deep-Dive reads it from one
 * programme's point of view, where "A" must always mean "this programme".
 */
export function orientEvidence(evidence: PairEvidence, programIsA: boolean): PairEvidence {
  if (programIsA) return evidence;
  const c = evidence.coverage;
  return {
    sharedCourses: evidence.sharedCourses,
    equivalentCourses: evidence.equivalentCourses.map((e) => ({
      codeA: e.codeB,
      codeB: e.codeA,
      nameA: e.nameB,
      nameB: e.nameA,
      credits: e.credits,
      similarity: e.similarity,
      basis: e.basis,
    })),
    matchedPlos: evidence.matchedPlos.map((m) => ({
      ordinalA: m.ordinalB,
      ordinalB: m.ordinalA,
      textA: m.textB,
      textB: m.textA,
      similarity: m.similarity,
    })),
    unmatchedPlosA: evidence.unmatchedPlosB,
    unmatchedPlosB: evidence.unmatchedPlosA,
    coverage: {
      ...c,
      majorCoursesA: c.majorCoursesB,
      majorCoursesB: c.majorCoursesA,
      embeddedA: c.embeddedB,
      embeddedB: c.embeddedA,
      describedA: c.describedB,
      describedB: c.describedA,
      plosA: c.plosB,
      plosB: c.plosA,
    },
  };
}

/** Same re-orientation for the AI recommendation's per-side text. */
export function orientRecommendation(
  rec: OverlapRecommendationView,
  programIsA: boolean,
): OverlapRecommendationView {
  if (programIsA) return rec;
  return { ...rec, distinctiveA: rec.distinctiveB, distinctiveB: rec.distinctiveA };
}
