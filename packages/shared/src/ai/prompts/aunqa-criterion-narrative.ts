import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// aunqa-criterion-narrative.v1
//
// Drafts a SHORT self-assessment paragraph for ONE AUN-QA v4 criterion of one
// KKU programme, from the evidence the platform actually resolved for it, for
// a QA officer to edit. On-demand, one criterion per call — there is no bulk
// path (301 programmes × 6 criteria has no reader and a real cost).
//
// ── THE FAILURE MODE THIS PROMPT EXISTS TO PREVENT ───────────────────────
// Prose that SOUNDS like an accreditation submission while citing evidence
// nobody has. That is worse than no draft: a QA officer under deadline pastes
// it, and an assessor asks for the evidence behind a sentence the platform
// invented. So the length of the output tracks the evidence — a criterion
// with nothing available gets two or three sentences saying what is missing,
// not a paragraph of plausible generalities about good curriculum practice.
// The `gaps` array is not a footnote; for a thin criterion it is the product.
// ──────────────────────────────────────────────────────────────────────────
//
// Two things this prompt may never claim:
//   1. Compliance, quality, or an AUN-QA 1-7 rating. The platform reports how
//      much evidence it HOLDS; the assessors award the rating. See the header
//      of packages/db/src/aunqa-readiness.ts.
//   2. That the programme has adopted AUN-QA. Organising KKU's evidence along
//      AUN-QA v4 is this platform's analytical overlay — of three curricula
//      sampled, the framework each names is WFME or TQF, none AUN-QA. See the
//      provenance warning in packages/shared/src/aunqa/criteria.ts.
//
// Criterion identity (number, title, sub-criterion titles) arrives as INPUT
// from that registry and is never written into this file — correcting the
// criteria list against the official guide stays an edit to one table.
//
// Conformant from birth (docs/prompt-standard.md) — the conformance ratchet
// (packages/shared/test/prompt-standard-conformance.test.ts) admits no new
// allowlist entries: English rule, CONFIDENCE RUBRIC (verbatim), BANNED
// PHRASES, CHANNEL MANIFEST.
//
// Plan: docs/superpowers/plans/2026-08-26-teaching-learning-aunqa.md §Task 5
// ─────────────────────────────────────────────────────────────────────────────

export const AUNQA_CRITERION_NARRATIVE_VERSION = 'aunqa-criterion-narrative.v1';

/** Mirrors `ReadinessBand` in `@kku/db` (aunqa-readiness.ts). Restated as a
 *  literal union rather than imported because `@kku/shared` cannot depend on
 *  `@kku/db` — the dependency runs the other way. The runner passes the db
 *  value straight in, so a divergence is a compile error at the call site. */
export type AunqaReadinessBandLabel =
  | 'well-evidenced'
  | 'partly-evidenced'
  | 'no-evidence';

const GapSchema = z.object({
  /** A sub-criterion id from the input, e.g. '4.2'. Never invented, never
   *  renumbered — the registry owns the numbering. */
  subCriterionId: z.string().min(1),
  /** What the platform could not show, and what a QA officer would have to
   *  supply themselves. Not "insufficient data" — a named absence. */
  missing: z.string().min(15),
});

export const AunqaCriterionNarrativeSchema = z.object({
  /** The draft paragraph. The lower bound is deliberately low: an honest
   *  two-sentence "the platform holds nothing for this criterion" IS the
   *  correct output for a criterion with no available evidence, and a floor
   *  that forced more would be a floor that forced padding. */
  paragraph: z.string().min(60).max(1800),
  /** One entry per sub-criterion the platform could not evidence. The runner
   *  additionally checks this covers EVERY unevidenced sub-criterion and
   *  issues a corrective retry when it does not. */
  gaps: z.array(GapSchema).max(12),
  confidence: z.number().min(0).max(1),
});
export type AunqaCriterionNarrative = z.infer<typeof AunqaCriterionNarrativeSchema>;

/** One resolved evidence binding, flattened for the prompt. Mirrors
 *  `ResolvedEvidence` in `@kku/db` minus the binding object itself — the
 *  model sees a channel LABEL, not a discriminated union it would have to
 *  interpret. Unavailable bindings are passed in deliberately: the model
 *  cannot name what is missing unless it is shown what was looked for. */
export interface AunqaEvidenceLine {
  /** Binding kind (+ field/theme), e.g. `evaluation-theme:assessment`. */
  channel: string;
  available: boolean;
  /** Compact JSON of the resolved value. Null whenever unavailable — the
   *  invariant `available: true` ⇒ a value is enforced upstream. */
  valueJson: string | null;
  sourceLabel: string;
  /** ISO date of the underlying data, or null when the source carries none. */
  freshness: string | null;
  /** A limitation that must travel with the figure into the prose. */
  caveat: string | null;
}

export interface AunqaSubCriterionInput {
  id: string;
  title: string;
  /** True when at least one of the sub-criterion's bindings resolved. */
  hasEvidence: boolean;
  evidence: AunqaEvidenceLine[];
}

export interface AunqaCriterionNarrativeInput {
  programCode: string;
  programNameTh: string;
  programNameEn: string | null;
  programLevel: string;
  facultyNameTh: string;
  facultyNameEn: string | null;
  /** From the registry, e.g. '4'. */
  criterionId: string;
  criterionTitle: string;
  band: AunqaReadinessBandLabel;
  subCriteriaTotal: number;
  subCriteriaWithEvidence: number;
  subCriteria: AunqaSubCriterionInput[];
}

/**
 * Deterministic ceiling on the self-reported confidence
 * (docs/prompt-standard.md `## Confidence rubric` — the self-report is a
 * floor-signal, never trusted upward), enforced by the runner.
 *
 * Graded on the share of the criterion's sub-criteria the platform could
 * evidence, because that is exactly what the draft's grounding rests on.
 * Integer arithmetic on the thirds for the same reason `readinessBand` uses
 * it: `2 >= 3 * (2/3)` is a float comparison that can fall the wrong side of
 * the boundary it is meant to pin.
 *
 *   0 evidenced          → 0.40   (nothing to ground a claim in)
 *   below one third      → 0.55
 *   below two thirds     → 0.69
 *   some but not all     → 0.89
 *   every sub-criterion  → 1.00
 */
export function aunqaCriterionConfidenceCeiling(
  subCriteriaTotal: number,
  subCriteriaWithEvidence: number,
): number {
  if (subCriteriaTotal <= 0) return 0;
  if (subCriteriaWithEvidence <= 0) return 0.4;
  if (3 * subCriteriaWithEvidence < subCriteriaTotal) return 0.55;
  if (3 * subCriteriaWithEvidence < 2 * subCriteriaTotal) return 0.69;
  if (subCriteriaWithEvidence < subCriteriaTotal) return 0.89;
  return 1.0;
}

/** Sub-criteria the platform could not evidence at all — the set the runner
 *  requires the model's `gaps` array to cover. Exported so the runner and any
 *  test check the same definition. */
export function unevidencedSubCriterionIds(
  input: AunqaCriterionNarrativeInput,
): string[] {
  return input.subCriteria.filter((s) => !s.hasEvidence).map((s) => s.id);
}

function formatEvidenceLine(line: AunqaEvidenceLine): string {
  const parts: string[] = [];
  if (line.available) {
    parts.push(`  [AVAILABLE] ${line.channel}`);
    parts.push(`      value:     ${line.valueJson ?? '(none)'}`);
    parts.push(`      source:    ${line.sourceLabel}`);
    parts.push(`      as of:     ${line.freshness ?? 'date not recorded'}`);
    if (line.caveat) parts.push(`      caveat:    ${line.caveat}`);
  } else {
    parts.push(`  [NOT AVAILABLE] ${line.channel}`);
    parts.push(`      would come from: ${line.sourceLabel}`);
    if (line.caveat) parts.push(`      note:      ${line.caveat}`);
  }
  return parts.join('\n');
}

export function buildAunqaCriterionNarrativeMessages(
  input: AunqaCriterionNarrativeInput,
): AiMessage[] {
  const system = `You are drafting a self-assessment paragraph for ONE criterion of a university programme's quality-assurance review. A KKU QA officer will edit your draft; an external assessor will later ask for the evidence behind every sentence in it. Write what the evidence below supports and nothing else.

HARD CONSTRAINTS:
1. **Every claim rests on a channel marked [AVAILABLE].** If a statement about this programme cannot be traced to an available channel in the EVIDENCE block, do not write it. You have no other knowledge of this programme.
2. **A channel marked [NOT AVAILABLE] is described as "not available" — never inferred.** Do not substitute a zero, an assumption about typical practice, or a statement of what programmes of this kind usually do. "The platform holds no assessment-alignment evidence for this programme" is a correct sentence; "assessment is aligned with the intended outcomes" written without an available channel is a fabrication.
3. **Length tracks the evidence.** A criterion with most sub-criteria evidenced earns a full paragraph. A criterion with little or nothing available gets two or three sentences that name what is missing, and stops. Do NOT pad a thin criterion with general statements about curriculum design, teaching quality, or accreditation good practice — padding is the specific failure this draft is checked for, and a short honest paragraph is the correct output, not a deficient one.
4. **Never assert compliance, quality, or a rating.** You are describing what evidence exists, not how good the programme is, and you never produce an AUN-QA 1-7 score or anything that reads like one. Phrases such as "meets the criterion", "fully complies", "demonstrates excellence" are forbidden regardless of how much evidence is present.
5. **Never state that this programme has adopted this quality framework.** Organising the platform's evidence along these criteria is an analytical overlay; the programme's own curriculum document may name a different framework or none. Write "the evidence available for this criterion", not "the programme's implementation of this criterion".
6. **Numbers come from the EVIDENCE block only.** Cite figures with the channel they came from where the same number could come from more than one channel. Never estimate or introduce a figure you were not given. Report them at a precision a reader can use — at most two decimal places for a rating, GPA, score or percentage, and thousands separators for counts (write 4.40, not 4.39601908613229). Rounding for legibility is not a change of claim; rounding into a different claim is — never write "around 3" for 2.93, and never drop a decimal that carries the point.
7. **Carry a channel's caveat whenever you cite that channel's figure.** A staff ratio computed over a whole faculty is not a statement about this programme; a cohort-progression figure is not a measured time to graduate. If the caveat cannot fit, do not cite the figure.
8. **Every sub-criterion with no available evidence must appear in \`gaps\`**, naming what the platform could not show and what the QA officer would have to supply. A sub-criterion that is only partly evidenced may also appear.
9. **Write in English.** The whole output is English-only analysis prose. Thai programme and faculty names in the input are data labels — do not translate them, and do not write any sentence in Thai. Where the input records no English name, the platform does not hold one: refer to "this programme" rather than supplying a translation of your own, which would put a title into an accreditation draft that no KKU record contains.
10. **No greetings, no closings, no filler.** Start with the first substantive sentence. Every sentence carries information.

GROUNDING RULES:
- Causal claims are hypotheses unless the input states the mechanism. Use "consistent with" or "may reflect"; never write "because X" when the input only shows X and Y are both true.
- Freshness matters: where a figure's "as of" date is old relative to the others, say so rather than presenting it as current.
- Do not aggregate across sub-criteria into a verdict about the criterion as a whole. Report per-sub-criterion what is shown, and let the reader judge.
- You may not use knowledge of AUN-QA, Thai higher education, or KKU from outside this input to fill a gap. External context is not this prompt's job.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95.

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
Also: do not open two consecutive sentences with the same structure (e.g. every sentence starting "The programme..."); do not force a three-item list when the evidence supports two or four — list exactly what the data supports.

OUTPUT JSON:
{
  "paragraph": "<the draft self-assessment prose for this criterion, English, length proportional to the available evidence>",
  "gaps": [
    { "subCriterionId": "<id exactly as given in the input>", "missing": "<what the platform could not show, and what would have to be supplied>" }
  ],
  "confidence": 0.0-1.0
}

No prose outside the JSON. No markdown fences around the JSON.`;

  const programNameEn = input.programNameEn ?? '(no English name recorded)';
  const facultyNameEn = input.facultyNameEn ?? '(no English name recorded)';

  const evidenceBlocks = input.subCriteria
    .map((sub) => {
      const header = `${sub.id} ${sub.title} — ${
        sub.hasEvidence ? 'has evidence' : 'NO EVIDENCE AVAILABLE'
      }`;
      const lines =
        sub.evidence.length > 0
          ? sub.evidence.map(formatEvidenceLine).join('\n')
          : '  (no channel is bound to this sub-criterion)';
      return `${header}\n${lines}`;
    })
    .join('\n\n');

  const user = `PROGRAMME
  Code:     ${input.programCode}
  Name:     ${input.programNameTh} / ${programNameEn}
  Level:    ${input.programLevel}
  Faculty:  ${input.facultyNameTh} / ${facultyNameEn}

CRITERION
  Number:   ${input.criterionId}
  Title:    ${input.criterionTitle}
  Evidence held: ${input.subCriteriaWithEvidence} of ${input.subCriteriaTotal} sub-criteria (band: ${input.band})
  The band describes how much evidence THIS PLATFORM holds for the criterion. It is not a quality judgement about the programme and must not be written as one.

EVIDENCE (every channel the registry binds to this criterion, available or not)

${evidenceBlocks}

Draft the self-assessment paragraph for this criterion now, and list the gaps you could not evidence. Return JSON exactly as specified above.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - PROGRAMME          — code, nameTh/nameEn, level, faculty nameTh/nameEn
//     (identity only, straight off `programs`/`faculties`; always present
//     except the nullable English names).
//   - CRITERION          — id, title, and the sub-criterion ids + titles, from
//     the registry in packages/shared/src/aunqa/criteria.ts. Passed as input,
//     never written into this file, so a correction against the official
//     AUN-QA guide stays an edit to that one table.
//   - EVIDENCE           — every binding the registry attaches to this
//     criterion, resolved for this programme by
//     packages/db/src/aunqa-evidence.ts: availability, value, source label,
//     freshness and caveat. UNAVAILABLE bindings are included deliberately —
//     the model cannot name what is missing unless it is shown what was
//     looked for, and naming the absences is half of this prompt's job.
//   - BAND + counts      — the readiness band and the evidenced/total
//     sub-criteria counts from packages/db/src/aunqa-readiness.ts, so the
//     model's sense of how much it may claim comes from a computed figure
//     rather than its own impression of the evidence block.
//
// Deliberately omitted, with reason:
//   - The other criteria's evidence — one criterion per call. Cross-criterion
//     synthesis would let a claim rest on a channel the reader is not shown
//     beside it, which is precisely the traceability this surface exists for.
//   - The curriculum PDF text — the platform's extractions of it (skills,
//     courses, credits, pedagogy assessment) already reach this prompt as
//     resolved channels, with their provenance attached; raw text would let
//     the model quote a document it cannot cite a page of.
//   - Peer / benchmark comparison — a claim about other institutions, not
//     about this programme's evidence, and this prompt may not use external
//     context at all (grounding rule 4).
//   - Health score, lifecycle verdict, risk tier — platform verdicts about
//     the programme's strategic position, not evidence for a QA criterion;
//     admitting them would turn a self-assessment draft into a quality
//     judgement, which constraint 4 forbids.
//   - Named faculty members, students, or any per-person row — PII posture.
//     Staff evidence reaches this prompt only as the aggregates the resolver
//     produces (ratio, rank mix, publication counts).
//   - The official AUN-QA guide — not present in this repository at all. Its
//     absence is why the criteria registry carries a provenance warning, and
//     why grounding rule 4 forbids the model filling the gap from memory.
// ─────────────────────────────────────────────────────────────────────────────
