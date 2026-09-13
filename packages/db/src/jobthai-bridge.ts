import { JOBTHAI_ANY_FIELD } from '@kku/shared/src/jobthai';

// ─────────────────────────────────────────────────────────────────────────────
// Programme ↔ JobThai-occupation bridge — `jobthai-bridge.v1`.
//
// Two independent paths, so they can corroborate or disagree:
//
//   field-of-study — the posting literally states which graduates it wants
//                    ("วุฒิปริญญาตรี สาขาบัญชี"). Direct and defensible, and
//                    something kmitl-skill-mapping cannot provide at all.
//   skill-overlap  — ProgramSkill intersected with JobThaiOccupationSkill.
//                    Indirect, and the analogue of the existing KMITL signal.
//
// The skill path only became trustworthy on 2026-09-13. Before the taxonomy
// de-duplication, a programme could point at one "Data Science" row while the
// demand set pointed at another, so the intersection silently missed and a
// well-aligned programme read as misaligned.
// ─────────────────────────────────────────────────────────────────────────────

export const JOBTHAI_BRIDGE_VERSION = 'jobthai-bridge.v1';

/**
 * Minimum postings behind a programme's links before its JobThai signal is
 * trusted.
 *
 * 20 is the observed 25th percentile of the per-programme distribution: over
 * 246 matched programmes, min 3, p25 20, median 136, p75 433, max 3,534. The
 * design guessed 30, which discarded 18 more programmes for no measured reason.
 * Below 20 a programme's signal rests on a handful of adverts.
 */
export const JOBTHAI_MIN_POSTINGS_FOR_SIGNAL = 20;

/**
 * Shortest field-of-study string we will match against a programme name.
 *
 * Thai has no inter-word spaces, so a two- or three-character field matches
 * inside unrelated words constantly — the same problem that made "สติ" match
 * พลาสติก during skill extraction.
 */
export const MIN_FIELD_LENGTH = 4;

/**
 * A field of study that matches more than this many KKU programmes carries no
 * discriminating power and is rejected.
 *
 * MEASURED over 166 fields that match at least one programme: the median field
 * matches 2 programmes, p90 is 11, p95 is 20. The tail is pure generic
 * vocabulary — "Science" matches **135 of 297 programmes**, "International" 58,
 * "วิทยาศาสตร์" 45, "เทคโนโลยี" 22, "บริหาร" 21, "วิศวกรรม" 20. Those produced
 * links like Geotechnology → Food Science, on the strength of the word
 * "technology" appearing in both.
 *
 * 15 keeps 154 of 166 fields (93%). It removes every single-word generic while
 * keeping named disciplines that legitimately span many KKU programmes —
 * เคมี (11), พยาบาล (11), บริหารธุรกิจ (13, and 1,839 postings behind it).
 * Note it keeps the compound "บริหารธุรกิจ" while rejecting the bare "ธุรกิจ"
 * (16) and "Business" (18), which is the right discrimination.
 */
export const MAX_PROGRAMMES_PER_FIELD = 15;

/**
 * Minimum share of a programme's TAUGHT skills an occupation must demand.
 *
 * MEASURED: with the correct denominator the share distribution is p25 0.125,
 * p50 0.200, p75 0.286, p90 0.417, p95 0.500, max 1.000 over 44,779 non-zero
 * pairs. 0.5 with a floor of 3 shared skills keeps 1,525 pairs — about five
 * occupations per programme, which is a sensible count of "potential jobs".
 *
 * Programmes teach a median of 9 skills, so 0.5 means at least five of nine
 * taught skills are demanded: a strong, interpretable claim.
 */
export const MIN_SKILL_OVERLAP_SHARE = 0.5;
export const MIN_SHARED_SKILLS = 3;

/**
 * Minimum postings behind a single link. A link supported by one advert is
 * noise, and it is how 185 of 195 postgraduate programmes acquired links
 * through the skill path before this floor existed.
 */
export const MIN_POSTINGS_PER_LINK = 3;

export type ProgramLevelLike = string;

/**
 * Which posting education levels a programme's graduates can answer.
 *
 * **THIS IS THE HONEST-SIGNAL GATE, and it is the whole reason this module has
 * a level argument at all.**
 *
 * The field-of-study path matches a Master's in Accounting to BACHELOR-level
 * postings for สาขาบัญชี. Measured over the corpus, 79% of master's and 82% of
 * doctoral programmes match at least one field — almost the bachelor's rate of
 * 86% — while only 41 postings in all 47,631 state a postgraduate minimum.
 *
 * Without this gate a doctoral programme receives a demand signal built from
 * undergraduate job adverts, and it looks entirely healthy: high coverage,
 * plausible skills, no nulls. Confident and wrong is the worst outcome
 * available here, so postgraduate programmes are restricted to postgraduate
 * postings and consequently fall below the signal floor and score null.
 *
 * UNSPECIFIED is never eligible: a posting that states no level states no
 * demand for a level, and counting it would quietly re-admit the 30% of
 * postings that say nothing.
 */
export function eligiblePostingLevels(programLevel: ProgramLevelLike): string[] {
  if (programLevel === 'MASTER' || programLevel === 'DOCTORAL' || programLevel === 'HIGHER_GRAD_DIPLOMA') {
    return ['MASTER', 'DOCTORATE'];
  }
  // A posting whose FLOOR is vocational is open to a bachelor's graduate.
  return ['VOCATIONAL_CERT', 'HIGHER_VOCATIONAL_CERT', 'BACHELOR'];
}

function norm(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Does a posting's stated field of study name this programme's discipline?
 *
 * Substring containment against the programme name. Crude, but the alternative
 * is a curated discipline vocabulary we do not have, and the failure mode is
 * visible: an implausible link shows up in the hand-inspection step.
 *
 * The any-field sentinel is explicitly NOT a match. Treating it as one would
 * link every programme to every occupation that ever said ทุกสาขา — 2,566
 * postings — and drown the real signal.
 */
export function matchFieldToProgramme(field: string, programmeName: string): boolean {
  const f = norm(field);
  if (f === '' || f === norm(JOBTHAI_ANY_FIELD) || field === JOBTHAI_ANY_FIELD) return false;
  if (f.length < MIN_FIELD_LENGTH) return false;
  return norm(programmeName).includes(f);
}

/** Share of an occupation's stated fields that name this programme. */
export function scoreFieldOfStudyLink(input: {
  matchedFields: number;
  totalFieldsForOccupation: number;
}): number {
  if (input.totalFieldsForOccupation <= 0) return 0;
  return input.matchedFields / input.totalFieldsForOccupation;
}

/**
 * Share of the programme's TAUGHT skills that this occupation demands.
 *
 * The denominator is the programme, not the occupation — a correction made
 * after measurement. Dividing by the occupation's demand set (100-350 skills)
 * against a programme teaching a median of 9 capped the score at roughly 0.03
 * regardless of how well aligned the pair was: the number measured programme
 * size, not alignment. It also matches the denominator the relevance driver
 * uses, so link strength and driver value mean the same thing.
 *
 * Returns 0 below MIN_SKILL_OVERLAP_SHARE or MIN_SHARED_SKILLS, so a noise
 * overlap produces no link at all. Before these floors the path emitted
 * International Relations → housekeeping staff (1 shared skill of 28) and
 * Public Administration → sales engineer (1 of 124).
 */
export function scoreSkillOverlapLink(input: { sharedSkills: number; taughtSkills: number }): number {
  if (input.taughtSkills <= 0) return 0;
  const share = input.sharedSkills / input.taughtSkills;
  if (share < MIN_SKILL_OVERLAP_SHARE) return 0;
  if (input.sharedSkills < MIN_SHARED_SKILLS) return 0;
  return share;
}

export interface CombinedLink {
  linkSource: 'field-of-study' | 'skill-overlap' | 'both';
  score: number;
}

/**
 * Combines the two paths.
 *
 * `both` uses a noisy-OR — 1 - (1-a)(1-b) — so corroboration raises confidence
 * above either path alone without ever exceeding 1. Averaging would have made
 * two agreeing weak signals look weaker than one strong one, which is backwards.
 *
 * Returns null when neither path found anything: no link is written at all,
 * rather than a zero-strength link that later reads as "we checked and the
 * answer is no demand".
 */
export function combineLinkSources(input: { fieldScore: number; skillScore: number }): CombinedLink | null {
  const f = input.fieldScore > 0;
  const s = input.skillScore > 0;
  if (!f && !s) return null;
  if (f && s) {
    return {
      linkSource: 'both',
      score: 1 - (1 - input.fieldScore) * (1 - input.skillScore),
    };
  }
  return f
    ? { linkSource: 'field-of-study', score: input.fieldScore }
    : { linkSource: 'skill-overlap', score: input.skillScore };
}
