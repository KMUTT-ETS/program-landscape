import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// program-overlap-recommendation.v1
//
// Drafts the reasoning behind the RULE-CHOSEN actions for one pair of
// same-level KKU programmes whose curricula overlap (program-overlap.v1,
// spec docs/superpowers/specs/2026-10-03-program-overlap-design.md §6.2).
// The actions themselves are decided deterministically in @kku/db
// (program-overlap/score.ts); the model never changes them. When the
// evidence contradicts the rule, the model says so in
// `disagreesWithAction` + `disagreementReason`, and a human judges.
//
// Conformant from birth (docs/prompt-standard.md): English output rule,
// CONFIDENCE RUBRIC (verbatim), BANNED PHRASES, CHANNEL MANIFEST.
// Category: verdict / assessment — every claim names its input field, a
// data-gaps note is required on thin coverage, and the rationale ends with
// what would change the assessment.
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRAM_OVERLAP_RECOMMENDATION_VERSION = 'program-overlap-recommendation.v1';

export const ProgramOverlapRecommendationSchema = z
  .object({
    rationale: z.string().min(80).max(1800),
    distinctiveA: z.string().min(20).max(700),
    distinctiveB: z.string().min(20).max(700),
    nextSteps: z.array(z.string().min(10).max(300)).min(2).max(4),
    confidence: z.number().min(0).max(1),
    disagreesWithAction: z.boolean(),
    disagreementReason: z.string().max(600).nullable(),
  })
  .superRefine((v, ctx) => {
    // A disagreement a human must judge needs a stated reason.
    if (v.disagreesWithAction && (v.disagreementReason ?? '').trim().length < 20) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['disagreementReason'],
        message: 'disagreesWithAction requires a disagreementReason of at least 20 characters',
      });
    }
  });
export type ProgramOverlapRecommendation = z.infer<typeof ProgramOverlapRecommendationSchema>;

export interface OverlapRecommendationProgramme {
  code: string;
  nameTh: string;
  nameEn: string | null;
  faculty: string;
  /** Newest real EnrollmentMetric.enrolled — total enrolled headcount, not
   *  the first-year intake; null = not available. */
  latestEnrolled: number | null;
}

/** A capped evidence list: at most OVERLAP_EVIDENCE_LIST_CAP items, plus how many were left out. */
export interface OverlapCappedList<T> {
  items: T[];
  omitted: number;
}

export const OVERLAP_EVIDENCE_LIST_CAP = 25;

export interface ProgramOverlapRecommendationInput {
  programA: OverlapRecommendationProgramme;
  programB: OverlapRecommendationProgramme;
  level: string;
  /** All 0–100, rounded to integers. Null = layer not computable (data not available). */
  scores: {
    structure: number | null;
    content: number | null;
    outcome: number | null;
    overlapIndex: number;
    containmentAInB: number | null;
    containmentBInA: number | null;
    marketSimilarity: number | null;
  };
  sharedCredits: number;
  equivCredits: number;
  sharedStaff: number;
  /** Thai and international (English-taught) versions of one programme. */
  languageVariant: boolean;
  /** Rule-chosen OverlapAction values, strongest first. */
  actions: string[];
  /** The strongest action (actions[0]); null only if actions is empty. */
  primaryAction: string | null;
  /** Similarities are 0–1, rounded to 2 dp. Each list is capped (see OverlapCappedList). */
  evidence: {
    sharedCourses: OverlapCappedList<{ code: string; credits: number; nameTh: string | null }>;
    equivalentCourses: OverlapCappedList<{
      codeA: string;
      codeB: string;
      nameA: string | null;
      nameB: string | null;
      credits: number;
      similarity: number;
      /** 'description' = both courses described; 'name' = matched on course
       *  names alone, which is weaker evidence. */
      basis: 'description' | 'name';
    }>;
    matchedPlos: OverlapCappedList<{ textA: string; textB: string; similarity: number }>;
    unmatchedPlosA: OverlapCappedList<string>;
    unmatchedPlosB: OverlapCappedList<string>;
    coverage: {
      majorCoursesA: number;
      majorCoursesB: number;
      describedA: number;
      describedB: number;
      descriptionMatches: number;
      plosA: number;
      plosB: number;
    };
  };
  /** Market-facing profile text (degree names, recruitment summary, careers). Null = not available. */
  marketTextA: string | null;
  marketTextB: string | null;
}

/**
 * Deterministic ceiling on self-reported confidence (docs/prompt-standard.md
 * `## Confidence rubric`), enforced by the runner. Counts the material
 * channels that are missing, matching the rubric text in the system prompt:
 * the content layer, the outcome layer, the market channel (ONE channel:
 * missing when market similarity is null or either market text is absent),
 * and description-backed course evidence (missing when every equivalent
 * course rests on names alone).
 *   0 missing → 1.00 · 1 → 0.89 · 2 → 0.69 · 3+ → 0.49
 */
export function overlapRecommendationConfidenceCeiling(input: ProgramOverlapRecommendationInput): number {
  let missing = 0;
  if (input.scores.content === null) missing++;
  if (input.scores.outcome === null) missing++;
  if (input.scores.marketSimilarity === null || !input.marketTextA || !input.marketTextB) missing++;
  const eq = input.evidence.equivalentCourses.items;
  if (eq.length > 0 && eq.every((e) => e.basis === 'name')) missing++;
  if (missing === 0) return 1;
  if (missing === 1) return 0.89;
  if (missing === 2) return 0.69;
  return 0.49;
}

const SYSTEM = `You draft the reasoning for a rule-chosen action on a pair of overlapping KKU academic programmes at the same level. The actions were decided by deterministic rules over the scores you are given. You never change the action, add an action, or remove one. Your output is read by deans and the University Council, and every action is "for review" — a prompt for a human conversation, never a decision.

CHANNEL MANIFEST (each input channel is a JSON field in the user message; null or an empty list means "data not available", never zero):
- programA / programB: code, Thai name (nameTh), English name (nameEn), faculty, latestEnrolled (newest TOTAL enrolled headcount across all years of study, not a first-year intake; null = not available).
- level: the shared degree level.
- Scale: scores are 0–100 (integers); similarities are 0–1 (2 decimals).
- scores (0–100): structure (credit-weighted shared courses), content (equivalent courses by embedding similarity), outcome (PLO alignment), overlapIndex (the combined index), containmentAInB / containmentBInA (how much of one programme's major sits inside the other), marketSimilarity (how alike the two market-facing profiles read). A null layer was not computable.
- sharedCredits, equivCredits: credits in shared-code courses and in equivalent-course pairs.
- sharedStaff: number of teaching staff on both rosters.
- languageVariant: true when the pair is the Thai and the international (English-taught) version of the same programme.
- actions: the rule-chosen actions, strongest first. primaryAction: the strongest one (actions[0]).
- Each evidence list is an object { items, omitted }: items holds at most 25 entries (the strongest first) and omitted counts the entries left out. A non-zero omitted means the list is longer than shown; do not count items as if they were the whole list.
- evidence.sharedCourses: courses with the same code in both programmes (largest credits first).
- evidence.equivalentCourses: course pairs judged equivalent, each with a similarity and a basis. basis "description" means both courses have catalogue descriptions and the match rests on content. basis "name" means at least one course was embedded on its name alone; treat these as weaker evidence and say so when they carry the case.
- evidence.matchedPlos, unmatchedPlosA, unmatchedPlosB: programme learning outcomes that align, and those unique to each side. The unmatched PLOs are the main evidence for what is distinctive.
- evidence.coverage: how many major courses, described courses and PLOs each side has — the size of the evidence base.
- marketTextA / marketTextB: each programme's market-facing text.

WHAT EACH ACTION MEANS (all "for review"):
- COORDINATE_SHARED_COURSES: the two programmes already teach the same course codes; coordinate scheduling, sections and staffing of those courses.
- CONSOLIDATE_EQUIVALENT_COURSES: different course codes appear to teach the same content; review whether one course could serve both.
- SHARE_STAFF_RESOURCES: the overlap is large enough that staff, labs or teaching resources could be shared.
- DIFFERENTIATE: the curricula overlap AND the programmes present themselves to the market alike; applicants may not see the difference, so sharpen what each offers.
- CONSIDER_MERGE_OR_TRACK: one programme largely sits inside the other; review whether one could become a track of the other.

LANGUAGE VARIANTS: when languageVariant is true, the overlap exists by design — the same curriculum is offered in Thai and in English. Never suggest merging them. Frame the steps around sharing courses, staff and resources, and around keeping the two versions distinct in language of instruction and intake.

GROUNDING RULES:
1. Numbers only from the input. Every figure you write (scores, credits, counts, intake, similarities) must appear in the input. Do not compute new figures beyond simple restatement, and never use outside knowledge about KKU or Thai higher education.
2. Every claim names the input field it rests on (for example "structure 62", "unmatchedPlosB", "sharedStaff 4").
3. Missing input is written as "data not available", never guessed.
4. Causal claims are hypotheses. Write "consistent with" or "may reflect", never "because", unless the input states the mechanism.
5. distinctiveA and distinctiveB describe what each programme has that the other lacks, drawn from its unmatched PLOs, its courses outside the shared and equivalent lists, and its market text. If the input shows nothing distinctive for a side, say that plainly; do not invent a difference.
6. When evidence.coverage is thin (either side with fewer than 3 PLOs, or fewer than half of its major courses described), the rationale must include a short data-gaps note naming what is thin.
7. The rationale ends with one sentence on what evidence would change this assessment.
8. nextSteps must not propose merging, folding one programme into the other as a track, closing or suspending a programme unless CONSIDER_MERGE_OR_TRACK is in actions. Never propose closure. If you believe a stronger action is warranted, say so only via disagreesWithAction.
9. nextSteps are 2 to 4 concrete steps a faculty or the university can take (who does what), consistent with the actions. "Monitor the situation" and similar non-actions are not acceptable. List as many steps as the evidence supports, not a rhetorically round number.
10. disagreesWithAction is true ONLY when the evidence in the input contradicts the rule (for example, the equivalent courses all rest on names alone and their names suggest different subjects, or a merge is suggested where unmatched PLOs show clearly different purposes). Then disagreementReason (at least 20 characters) states the contradiction and the field it comes from. Otherwise disagreesWithAction is false and disagreementReason is null.

LANGUAGE: Write all output in English; quote Thai course and programme names verbatim as data (do not translate or transliterate them). Paraphrase PLO and market text in English and refer to them by list position (e.g. unmatchedPlosB[2]); never quote a Thai sentence. Only course and programme names may appear in Thai, quoted verbatim.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95.
For this prompt the material channels are: the content layer, the outcome layer, market similarity with both market texts, and description-backed (not name-only) course equivalence.

BANNED PHRASES (do not use these words/phrases or their close paraphrases):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — "the competitive landscape" — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"
Also: do not open two nextSteps with the same words or sentence structure.

OUTPUT JSON:
{
  "rationale": "<80-1800 chars: why the rule chose these actions, citing fields; data-gaps note when coverage is thin; final sentence on what would change it>",
  "distinctiveA": "<20-700 chars: what programme A has that B lacks>",
  "distinctiveB": "<20-700 chars: what programme B has that A lacks>",
  "nextSteps": ["<2-4 concrete steps>"],
  "confidence": 0.0-1.0,
  "disagreesWithAction": true | false,
  "disagreementReason": "<reason citing the contradicting field>" | null
}

No prose outside the JSON. No markdown fences around the JSON.`;

export function buildProgramOverlapRecommendationMessages(input: ProgramOverlapRecommendationInput): AiMessage[] {
  return [
    { role: 'system', content: SYSTEM },
    // Compact JSON: the evidence lists dominate the token count.
    { role: 'user', content: JSON.stringify(input) },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed (assembled by apps/ingestion/src/program-overlap/run.ts):
//   - programA / programB identity — Program.code/nameTh/nameEn, Faculty.nameEn.
//   - latestEnrolled — newest EnrollmentMetric.enrolled passing realDataWhere()
//     (kku-registry): TOTAL enrolled headcount, not first-year intake; null
//     when no real row exists.
//   - scores (0–100, rounded to integers), sharedCredits, equivCredits,
//     sharedStaff, languageVariant, actions (re-sorted strongest first by
//     ACTION_STRENGTH) and primaryAction — the stored ProgramOverlapPair row
//     (program-overlap.v1).
//   - evidence — ProgramOverlapPair.evidenceJson: shared courses (credits
//     desc), equivalent courses WITH their basis (description vs name-only,
//     D7; similarity desc), matched PLOs (similarity desc), unmatched PLOs,
//     coverage counts. Each list capped at 25 with an `omitted` count;
//     similarities 0–1 rounded to 2 dp. Ordinals and embedded-course counts
//     are dropped (no meaning to the model).
//   - marketTextA / marketTextB — ProgramMarketProfile.text.
//
// Deliberately omitted, with reason:
//   - Full course lists — only the shared/equivalent subsets bear on the
//     action; full lists would blow the context budget across many pairs.
//   - Staff names — PDPA posture; the shared count is all the action needs.
//   - Health scores, finances, demand — a different question (programme
//     health, not curriculum overlap); mixing them in would let the model
//     argue for closures the overlap rules never proposed.
//   - band — derivable from overlapIndex.
// ─────────────────────────────────────────────────────────────────────────────
