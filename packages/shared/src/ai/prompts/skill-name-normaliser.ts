import { z } from 'zod';
import type { AiMessage } from '../types';

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
// ─────────────────────────────────────────────────────────────────────────────

export const SKILL_NAME_NORMALISER_VERSION = 'skill-name-normaliser.v1';

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

const SOURCE_HINT: Record<string, string> = {
  linkedin: 'Source = LinkedIn labour-market data (subscribed by MHESI, hosted at KMITL). Names tend to be English, sometimes with parenthetical synonyms or acronyms.',
  program_digest: 'Source = KKU curriculum-document AI digest. Names are usually Thai with optional English; reflect what a curriculum teaches, not what a job demands.',
  job_posting: 'Source = job postings (JobThai/JobsDB). Names mix Thai and English, often messy with abbreviations.',
  course_skill: 'Source = course-description AI extraction. Mostly Thai academic vocabulary.',
  manual: 'Source = manual analyst entry. Trust the surface form more than usual.',
};

export function buildSkillNormaliserMessages(input: SkillNormaliserInput): AiMessage[] {
  if (input.rawNames.length === 0) throw new Error('Empty rawNames batch');
  if (input.rawNames.length > 50) {
    throw new Error(`Batch too large: ${input.rawNames.length} > 50 (split before calling)`);
  }

  const sourceHint = SOURCE_HINT[input.sourceContext] ?? `Source = ${input.sourceContext}.`;

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
