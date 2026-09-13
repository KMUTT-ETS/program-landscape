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
//
// v2 (2026-09-13): the skill path intersected taught skills with every skill
// ONE posting mentioned, and transferable skills carried it. Doctor of Medicine
// linked to Sales/AE on Communication, Critical thinking, Teamwork and
// Professional ethics; overlap-only links carried 120,251 of the 132,902
// postings behind all links. An occupation now demands a skill only at
// OCCUPATION_SKILL_DEMAND_FLOOR, and skills most occupations demand are
// excluded from the overlap (GENERIC_SKILL_OCCUPATION_SHARE).
// ─────────────────────────────────────────────────────────────────────────────

export const JOBTHAI_BRIDGE_VERSION = 'jobthai-bridge.v2';

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

/**
 * Share of an occupation's ELIGIBLE postings that ask for this programme's field.
 *
 * v2. v1 divided matched fields by the occupation's distinct fields, which
 * measured how many ways an occupation phrases its requirements rather than how
 * strongly it wants these graduates: Mechanical Engineering -> mechanical
 * engineer scored 0.04 while 57% of those postings named เครื่องกล, and
 * Accounting -> general accounting 0.02 against a posting share of 0.48.
 */
export function scoreFieldOfStudyLink(input: { matchedPostings: number; eligiblePostings: number }): number {
  if (input.eligiblePostings <= 0) return 0;
  return Math.min(1, input.matchedPostings / input.eligiblePostings);
}

/**
 * Distinct postings in one occupation that a programme's graduates can answer
 * (education floor) and that name one of its fields. Counting per posting, not
 * per field, is the point: a posting listing บัญชี and บัญชีบัณฑิต is one advert.
 */
export function matchedPostingCounts(input: {
  postings: ReadonlyArray<{ level: string; fields: ReadonlyArray<string> }>;
  levels: ReadonlySet<string>;
  matchesField: (field: string) => boolean;
}): { matchedPostings: number; eligiblePostings: number; matchedFields: string[] } {
  let eligiblePostings = 0;
  let matchedPostings = 0;
  const matchedFields = new Set<string>();
  for (const p of input.postings) {
    if (!input.levels.has(p.level)) continue;
    eligiblePostings += 1;
    let hit = false;
    for (const f of p.fields) {
      if (input.matchesField(f)) {
        hit = true;
        matchedFields.add(f);
      }
    }
    if (hit) matchedPostings += 1;
  }
  return { matchedPostings, eligiblePostings, matchedFields: [...matchedFields] };
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

/**
 * Minimum share of an occupation's postings that must name a skill before the
 * occupation counts as DEMANDING it.
 *
 * `jobthai_occupation_skills` keeps a row for any skill a single posting
 * mentioned, so an occupation's raw skill set runs to 100-350 entries. Under v1
 * the overlap path intersected taught skills with that raw set, and Doctor of
 * Medicine linked to Sales/AE, QC/QA and electrical engineering. MEASURED share
 * distribution over all rows: p50 0.013, p75 0.037, p90 0.10.
 */
export const OCCUPATION_SKILL_DEMAND_FLOOR = 0.05;

/**
 * A skill demanded (at the floor above) by MORE than this fraction of all
 * occupations says nothing about which occupation a programme feeds.
 *
 * MEASURED 2026-09-13 over 240 occupations at the 5% floor: median skill 2
 * occupations, p90 16, p95 32. Communication 227, Management 195, Coordination
 * 174, Marketing 113, Finance 78, Teamwork 70, Data analysis 66, Renovation 54
 * (its Thai name การปรับปรุง simply means "improvement"), Accounting 52 — all
 * above 48. Discipline skills sit below: Mechanical engineering 27, Electrical
 * engineering 26, Programming 24, Medicine 5. The v1 Medicine → Sales/AE link
 * rested on exactly such skills: Communication, Critical thinking, Teamwork and
 * Leadership, Professional ethics.
 */
export const GENERIC_SKILL_OCCUPATION_SHARE = 0.2;

export interface OccupationSkillShare {
  occupationId: string;
  skillId: string;
  share: number;
}

/** Per-occupation demanded skills (at the floor) plus the set of generic skills. */
export function distinctiveDemand(
  rows: ReadonlyArray<OccupationSkillShare>,
  occupationCount: number,
): { demandedByOccupation: Map<string, Set<string>>; generic: Set<string> } {
  const demandedByOccupation = new Map<string, Set<string>>();
  const occupationsPerSkill = new Map<string, number>();
  for (const r of rows) {
    if (!demandedByOccupation.has(r.occupationId)) demandedByOccupation.set(r.occupationId, new Set());
    if (r.share < OCCUPATION_SKILL_DEMAND_FLOOR) continue;
    const set = demandedByOccupation.get(r.occupationId)!;
    if (set.has(r.skillId)) continue;
    set.add(r.skillId);
    occupationsPerSkill.set(r.skillId, (occupationsPerSkill.get(r.skillId) ?? 0) + 1);
  }
  const generic = new Set<string>();
  if (occupationCount > 0) {
    for (const [skillId, n] of occupationsPerSkill) {
      if (n / occupationCount > GENERIC_SKILL_OCCUPATION_SHARE) generic.add(skillId);
    }
  }
  return { demandedByOccupation, generic };
}

/**
 * The inputs to `scoreSkillOverlapLink`, with generic skills removed from BOTH
 * sides. Removing them only from the shared count would punish a programme for
 * teaching communication; removing them only from the taught set would leave
 * them free to manufacture a link.
 */
export function skillOverlapCounts(input: {
  taught: ReadonlySet<string>;
  demanded: ReadonlySet<string>;
  generic: ReadonlySet<string>;
}): { sharedSkills: number; taughtSkills: number } {
  let taughtSkills = 0;
  let sharedSkills = 0;
  for (const s of input.taught) {
    if (input.generic.has(s)) continue;
    taughtSkills += 1;
    if (input.demanded.has(s)) sharedSkills += 1;
  }
  return { sharedSkills, taughtSkills };
}

/**
 * Minimum link score for an occupation to count towards a programme's demand.
 *
 * Moved here from health-score.ts (v5.2) so the health driver and the Deep-Dive
 * Skills coverage section apply one rule. Under v2 the field-of-study score is
 * a POSTING share, so 0.1 means at least one in ten of the occupation's
 * eligible postings asks for this programme's field. MEASURED over v2 links:
 * p25 0.024, median 0.073, p75 0.17, p90 0.32. At 0.1, 54 programmes keep a
 * link and 42 clear the posting floor; Mechanical Engineering keeps maintenance
 * technician (0.20) and loses electrical technician (0.08).
 */
export const JOBTHAI_MIN_LINK_SCORE = 0.1;

/**
 * Minimum relevant demanded skills the AI must have checked before a JobThai
 * match score is shown or scored.
 *
 * MEASURED 2026-09-13: two identical AI runs over the same five programmes gave
 * BBA Marketing 33 then 67 and Accountancy 100 on three skills, while the
 * programmes resting on 9-19 skills moved 7-11 points. A ratio of three flips a
 * third on one changed decision. Below 5 the figure is null with its count shown.
 */
export const JOBTHAI_MIN_RELEVANT_SKILLS = 5;

export interface ProgramJobThaiLinkInput {
  occupationId: string;
  linkSource: string;
  score: number;
  postingCount: number;
}

/** Links that may speak for a programme's demand: strong enough, and not self-vouching. */
export function isEligibleJobThaiLink(l: Pick<ProgramJobThaiLinkInput, 'score' | 'linkSource'>): boolean {
  return l.score >= JOBTHAI_MIN_LINK_SCORE && l.linkSource !== 'skill-overlap';
}

export interface ProgramJobThaiDemandSkill {
  skillId: string;
  /** 0..1 — estimated share of the linked postings that name this skill. */
  share: number;
  /** Linked occupations where the skill is at or above the demand floor. */
  occupations: number;
  /** Demanded by most occupations, so it says nothing about THIS programme. */
  generic: boolean;
}

export interface ProgramJobThaiDemand {
  /** 'no-links' and 'below-floor' are data gaps — render null, never 0. */
  status: 'ok' | 'no-links' | 'below-floor';
  postings: number;
  occupations: number;
  /** Skills at or above OCCUPATION_SKILL_DEMAND_FLOOR once weighted, highest share first. */
  demand: ProgramJobThaiDemandSkill[];
}

/**
 * One programme's JobThai skill demand: each skill's share of the postings
 * behind its eligible links, weighting every occupation by its link's postings.
 *
 * Skill-overlap-only links are excluded. That path creates a link BECAUSE the
 * programme's taught skills are demanded, so measuring alignment through it
 * returns the link rule, not the labour market — under v1 every overlap-linked
 * programme scored at least 50 on jobthai_demand_alignment by construction.
 */
export function aggregateProgramJobThaiDemand(input: {
  links: ReadonlyArray<ProgramJobThaiLinkInput>;
  occupationSkills: ReadonlyArray<OccupationSkillShare>;
  generic: ReadonlySet<string>;
}): ProgramJobThaiDemand {
  const eligible = input.links.filter(isEligibleJobThaiLink);
  const postings = eligible.reduce((s, l) => s + l.postingCount, 0);
  if (eligible.length === 0) return { status: 'no-links', postings: 0, occupations: 0, demand: [] };
  if (postings < JOBTHAI_MIN_POSTINGS_FOR_SIGNAL) {
    return { status: 'below-floor', postings, occupations: eligible.length, demand: [] };
  }

  const weightByOccupation = new Map(eligible.map((l) => [l.occupationId, l.postingCount]));
  const acc = new Map<string, { weighted: number; occupations: number }>();
  for (const r of input.occupationSkills) {
    const w = weightByOccupation.get(r.occupationId);
    if (w === undefined) continue;
    const e = acc.get(r.skillId) ?? { weighted: 0, occupations: 0 };
    e.weighted += w * r.share;
    if (r.share >= OCCUPATION_SKILL_DEMAND_FLOOR) e.occupations += 1;
    acc.set(r.skillId, e);
  }

  const demand: ProgramJobThaiDemandSkill[] = [];
  for (const [skillId, e] of acc) {
    const share = e.weighted / postings;
    if (share < OCCUPATION_SKILL_DEMAND_FLOOR) continue;
    demand.push({ skillId, share, occupations: e.occupations, generic: input.generic.has(skillId) });
  }
  demand.sort((a, b) => b.share - a.share || a.skillId.localeCompare(b.skillId));
  return { status: 'ok', postings, occupations: eligible.length, demand };
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
