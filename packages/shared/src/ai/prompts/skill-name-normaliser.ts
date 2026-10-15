import { z } from 'zod';
import type { AiMessage } from '../types';
import { getInstitution } from '../../institution';

// ─────────────────────────────────────────────────────────────────────────────
// Skill-name normaliser — maps free-text skill names (Thai or English,
// arbitrary surface form) to either an existing Skill in the taxonomy
// or a proposed NEW skill.
//
// Used by:
//   - LinkedIn-via-MHESI/KMITL connector (post-load step on unmatched names)
//   - Program-digest materialise (before queueing PROPOSED_SKILL extractions)
//   - One-shot backfill scripts (catch-up over historical unmatched rows)
//
// Batched: each call processes up to 50 raw names against the full taxonomy
// (~561 skills, name + category in ~12K tokens). Output is a structured
// decision per name. Cache + audit live in `SkillAlias` table — second time
// the same (rawName, sourceContext) appears, the cache hits and the LLM
// is bypassed entirely.
//
// Decisions:
//   MATCH        — confident map to an existing Skill.id
//   NEW_PROPOSED — name represents a genuinely new skill not in taxonomy
//   AMBIGUOUS    — multiple plausible matches, low confidence; needs human
//
// Version-bumping rule: any change to the system prompt, examples, output
// schema, or matching heuristic = bump VERSION. SkillAlias.methodVersion
// captures it. Backfill re-processes rows whose method version is older.
//
// v2 (2026-08-17, docs/prompt-standard.md conformance — mechanical
// TOUCH, audit #26): added CONFIDENCE RUBRIC (verbatim) + BANNED
// PHRASES + CHANNEL MANIFEST + explicit English rule. Output was
// already English (canonicalNameTh is the one exempt data-label field)
// and AMBIGUOUS was already a conformant abstain path — no matching
// logic change, markers only.
// ─────────────────────────────────────────────────────────────────────────────

export const SKILL_NAME_NORMALISER_VERSION = 'skill-name-normaliser.v2';

export const SkillNormaliserDecisionSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('MATCH'),
    rawName: z.string(),
    skillId: z.string(),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().max(300),
  }),
  z.object({
    decision: z.literal('NEW_PROPOSED'),
    rawName: z.string(),
    canonicalNameEn: z.string(),
    canonicalNameTh: z.string(),
    suggestedCategory: z.string().optional().default(''),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().max(300),
  }),
  z.object({
    decision: z.literal('AMBIGUOUS'),
    rawName: z.string(),
    candidateSkillIds: z.array(z.string()).max(5),
    confidence: z.number().min(0).max(1),
    reasoning: z.string().max(300),
  }),
]);
export type SkillNormaliserDecision = z.infer<typeof SkillNormaliserDecisionSchema>;

export const SkillNormaliserBatchSchema = z.object({
  decisions: z.array(SkillNormaliserDecisionSchema),
});
export type SkillNormaliserBatch = z.infer<typeof SkillNormaliserBatchSchema>;

export interface SkillNormaliserInput {
  /** Free-text skill names to resolve. Maximum 50 per batch. */
  rawNames: string[];
  /** Free-text discriminator: 'linkedin' | 'program_digest' | 'job_posting'.
   *  Helps the model bias toward source-appropriate matches (e.g.,
   *  LinkedIn skills tend to be English; Thai-curriculum skills tend to be
   *  Thai with English variants). */
  sourceContext: string;
  /** The full Skill taxonomy. ~500–600 entries; sent in every call. The
   *  model picks a `skillId` from this list when emitting MATCH. */
  taxonomy: Array<{
    id: string;
    nameEn: string;
    nameTh: string;
    category: string | null;
  }>;
}

function sourceHints(): Record<string, string> {
  const inst = getInstitution();
  return {
  linkedin: 'Source = LinkedIn labour-market data (subscribed by MHESI, hosted at KMITL). Names tend to be English, sometimes with parenthetical synonyms or acronyms.',
  program_digest: `Source = ${inst.shortNameEn} curriculum-document AI digest. Names are usually Thai with optional English; reflect what a curriculum teaches, not what a job demands.`,
  job_posting: 'Source = job postings (JobThai/JobsDB). Names mix Thai and English, often messy with abbreviations.',
  course_skill: 'Source = course-description AI extraction. Mostly Thai academic vocabulary.',
  manual: 'Source = manual analyst entry. Trust the surface form more than usual.',
};
}

export function buildSkillNormaliserMessages(input: SkillNormaliserInput): AiMessage[] {
  if (input.rawNames.length === 0) throw new Error('Empty rawNames batch');
  if (input.rawNames.length > 50) {
    throw new Error(`Batch too large: ${input.rawNames.length} > 50 (split before calling)`);
  }

  const sourceHint = sourceHints()[input.sourceContext] ?? `Source = ${input.sourceContext}.`;

  const system = `You normalise free-text skill names to a curated bilingual (Thai/English) skill taxonomy.

For EACH raw name, emit ONE decision:
- MATCH        — clearly maps to an existing taxonomy entry. Pick its id.
- NEW_PROPOSED — represents a genuinely distinct skill not in the taxonomy. Suggest canonical Thai + English names.
- AMBIGUOUS    — could match 2–5 entries equally well, OR meaning is unclear. List candidate ids.

Output STRICT JSON (no prose, no markdown fences):
{
  "decisions": [
    { "decision": "MATCH", "rawName": "<raw>", "skillId": "<taxonomy id>", "confidence": 0.0-1.0, "reasoning": "<≤300 chars>" },
    { "decision": "NEW_PROPOSED", "rawName": "<raw>", "canonicalNameEn": "<en>", "canonicalNameTh": "<th>", "suggestedCategory": "<category or ''>", "confidence": 0.0-1.0, "reasoning": "<≤300 chars>" },
    { "decision": "AMBIGUOUS", "rawName": "<raw>", "candidateSkillIds": ["id1","id2"], "confidence": 0.0-1.0, "reasoning": "<≤300 chars>" }
  ]
}

Rules:
1. EVERY raw name in the input MUST appear in the output exactly once. Preserve raw names verbatim.
2. Treat acronyms as their expansion: "SEO" = "Search Engine Optimization", "ML" = "Machine learning", "AI" = "Artificial intelligence", "NLP" = "Natural language processing", "QA" = "Quality assurance".
3. Treat Thai/English variants as the same skill: "การตลาดดิจิทัล" = "Digital marketing"; "การพยาบาล" = "Nursing"; "วิศวกรรมซอฟต์แวร์" = "Software engineering".
4. Treat parenthetical content as decoration: "Search Engine Optimization (SEO)" → resolves the same as "SEO".
5. Treat "X" and "X skills" as the same: "Communication" = "Communication skills".
6. NEW_PROPOSED only when a genuinely distinct concept is missing — NOT for every variant of an existing skill. When in doubt, MATCH.
7. AMBIGUOUS when the raw text could plausibly be 2+ taxonomy entries (e.g., "Marketing" → "Digital marketing" OR "Marketing strategy"). Prefer MATCH with lower confidence over AMBIGUOUS unless truly unclear.
8. confidence: ≥0.85 = certain. 0.6–0.85 = probable. <0.6 = uncertain (use AMBIGUOUS instead). For NEW_PROPOSED, confidence reflects how confident you are it's NOT already in the taxonomy.
9. ${sourceHint}
10. LANGUAGE RULE (English-only free text): \`reasoning\` MUST be written in English. \`canonicalNameTh\` stays Thai — it's a data label (the proposed skill's Thai name), not analysis prose. \`rawName\` is preserved verbatim regardless of language.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95.
(This prompt's own confidence bands in rule 8 are the operative per-decision
routing thresholds — MATCH/NEW_PROPOSED/AMBIGUOUS confidence semantics
predate and stay compatible with the rubric above; grade holistically
against both.)

BANNED PHRASES (do not use these words/phrases or their close paraphrases in reasoning):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"

Examples:

[Raw names] Python, ML, การตลาดดิจิทัล, Project Management Software, Quantum Computing
[Taxonomy excerpt] s001: Python (programming), s042: Machine learning (ai), s089: Digital marketing (business), s090: Project management (business)
[Output]
{"decisions":[
  {"decision":"MATCH","rawName":"Python","skillId":"s001","confidence":0.99,"reasoning":"Exact name match"},
  {"decision":"MATCH","rawName":"ML","skillId":"s042","confidence":0.98,"reasoning":"ML = Machine learning"},
  {"decision":"MATCH","rawName":"การตลาดดิจิทัล","skillId":"s089","confidence":0.97,"reasoning":"Thai for Digital marketing"},
  {"decision":"AMBIGUOUS","rawName":"Project Management Software","candidateSkillIds":["s090"],"confidence":0.5,"reasoning":"Unclear if this is the skill of using PM tools or PM in general"},
  {"decision":"NEW_PROPOSED","rawName":"Quantum Computing","canonicalNameEn":"Quantum computing","canonicalNameTh":"ควอนตัมคอมพิวติ้ง","suggestedCategory":"computing","confidence":0.92,"reasoning":"Distinct emerging-tech skill not represented in taxonomy"}
]}`;

  const taxonomyBlock = input.taxonomy
    .map((s) => `${s.id}: ${s.nameEn}${s.nameTh ? ` / ${s.nameTh}` : ''}${s.category ? ` (${s.category})` : ''}`)
    .join('\n');

  const namesBlock = input.rawNames.map((n, i) => `${i + 1}. ${n}`).join('\n');

  const user = `[Source context]
${sourceHint}

[Taxonomy] (id: nameEn / nameTh (category))
${taxonomyBlock}

[Raw names to normalise] (${input.rawNames.length} names)
${namesBlock}

Return the JSON.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - rawNames — the free-text skill names to resolve (up to 50/batch).
//   - taxonomy — the FULL Skill taxonomy (id, nameEn, nameTh, category).
//     THE closed-world label set this prompt classifies against (per
//     the standard's Classification addendum — MATCH may only pick an
//     id offered here).
//   - sourceContext — a free-text discriminator (linkedin / program_digest
//     / job_posting / course_skill / manual) that biases the model
//     toward source-appropriate matching conventions.
//
// Deliberately omitted, with reason:
//   - SkillAlias cache rows — callers check the cache BEFORE invoking
//     this prompt (same (rawName, sourceContext) pair short-circuits to
//     the cached decision); this prompt only ever sees cache-miss names,
//     so prior decisions are not re-fed in as a channel.
// ─────────────────────────────────────────────────────────────────────────────
