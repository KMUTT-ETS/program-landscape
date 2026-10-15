import { z } from 'zod';
import type { AiMessage } from '../types';
import { getInstitution } from '../../institution';

// Summarises + tags a policy document. Runs AFTER the PDF intake
// pipeline's PolicyDocExtractor has produced the base PolicyDocument
// row — this prompt takes the full text and produces:
//   - a summary (English analysis) + issuing org + key directives
//   - skill tags (from candidates), with a verbatim evidence quote each
//   - sector tags
//   - impact score with reasoning
//   - suggested programs that are affected (for reviewer verification)
//
// ProcessPolicyDocJob (in apps/ingestion) invokes this. The output lands in
// AiExtraction.payloadJson (extractionKind POLICY_DOC_ANALYSIS) for human
// review — the PolicyDocument.summaryTh/summaryEn columns this file's
// output field name once collided with are NOT written by this pipeline
// today (verified: `grep -rln "prisma.policyDocument" apps packages` finds
// no writer at all; the materialisation step from AiExtraction -> the
// PolicyDocument row is a deferred follow-up, same posture as
// program-digest's pre-materialisation state). Renaming summaryTh here is
// therefore a JSON-shape change inside an already-generic, JSON.stringify'd
// review UI (apps/web/app/admin/extraction-review/[id]/client.tsx), NOT a
// database schema change — confirmed before renaming, per the rewrite
// task's instruction to check for a live Prisma-column collision first.
//
// docs/prompt-standard.md conformance (2026-08-17 rewrite, audit #14):
//   - English rule, CONFIDENCE RUBRIC (verbatim), BANNED PHRASES, CHANNEL
//     MANIFEST all added below.
//   - `summaryTh` -> `summary` (English). The audit's finding: this is an
//     ANALYSIS summary of a policy document's impact, not a data label —
//     the v1 instruction ("Thai primary... not a translation") is exactly
//     the pattern the language standard reverses. Checked for a Prisma
//     schema collision (see note above) before renaming; found none.
//   - `keyDirectives` / `impactReasoning` made explicitly English (v1 left
//     their language unstated, which risked inheriting Thai from the
//     source document by default); `affectedSkills[].evidence` stays a
//     verbatim quote in the source document's own language — that is the
//     Extraction addendum's verbatim-quote requirement, not a language
//     exemption to justify.
// ─────────────────────────────────────────────────────────────────────────────

// v2 (2026-08-17): prompt-standard.md conformance — markers added,
// summaryTh -> summary (English), keyDirectives/impactReasoning made
// explicitly English. No change to affectedSkills[].evidence (verbatim,
// source language) or to suggestedProgramIds (still caller-filled).
export const POLICY_DOC_ANALYSIS_VERSION = 'policy-doc.v2';

export const PolicyDocAnalysisSchema = z.object({
  summary: z.string(),
  issuingOrg: z.string(),
  publicationDate: z.string().optional(), // ISO date if extractable
  keyDirectives: z.array(z.string()).default([]),
  affectedSkills: z.array(
    z.object({
      skillId: z.string(),
      evidence: z.string(),
    }),
  ).default([]),
  affectedSectors: z.array(z.string()).default([]),
  // Suggested programs — reviewer verifies. Empty initially; the post-
  // approval step uses skill overlap with ProgramSkill to propose these.
  suggestedProgramIds: z.array(z.string()).default([]),
  // Impact on KKU's strategic decisions.
  estimatedImpact: z.enum(['low', 'medium', 'high']),
  impactReasoning: z.string(),
  confidence: z.number().min(0).max(1),
});
export type PolicyDocAnalysis = z.infer<typeof PolicyDocAnalysisSchema>;

export interface PolicyDocAnalysisInput {
  fullText: string;
  originalFilename: string;
  candidateSkills: Array<{ id: string; nameTh: string; nameEn: string; category: string | null }>;
}

export function buildPolicyDocAnalysisMessages(input: PolicyDocAnalysisInput): AiMessage[] {
  const inst = getInstitution();
  const system = `You analyse Thai/English higher-education policy documents (MHESI, NESDC, NXPO, BOI, EECO) for their impact on university curriculum decisions.

Output STRICT JSON (no prose, no fences) matching:
{
  "summary": "<3-5 sentences English: what the document does + why it matters to ${inst.shortNameEn} curriculum strategy>",
  "issuingOrg": "<name>",
  "publicationDate": "<YYYY-MM-DD or omit>",
  "keyDirectives": ["<English — summarise or translate each directive; do not leave Thai source phrasing untranslated>"],
  "affectedSkills": [{"skillId":"<candidate id>","evidence":"<VERBATIM quote from the document text, in the document's own language — do not translate the quote>"}],
  "affectedSectors": ["..."],
  "suggestedProgramIds": [],  // leave empty — caller fills this via skill overlap
  "estimatedImpact": "low|medium|high",
  "impactReasoning": "<one paragraph, English>",
  "confidence": 0.0-1.0
}

Impact rubric:
- high: directly affects which programs ${inst.shortNameEn} should launch, close, or restructure
- medium: informs faculty-level strategic decisions but not individual programs
- low: background context or historical

GROUNDING:
- \`affectedSkills[].skillId\` MUST be one of the candidate ids listed in [Candidate skills] below — never invent a skill id, and never guess one when nothing in the document supports it (return an empty affectedSkills array rather than a forced match).
- \`affectedSkills[].evidence\` MUST be a VERBATIM quote copied from [Full text] — not a paraphrase, not a translation. If the source is Thai, the quote stays Thai; that is a structural extraction requirement (proving the claim is traceable to the source), not new Thai analysis prose.
- \`keyDirectives\`, \`summary\`, and \`impactReasoning\` are analysis you write — these are always English, regardless of the source document's language.
- Numbers, dates, and thresholds in \`summary\`/\`keyDirectives\`/\`impactReasoning\` must come from [Full text] — never invented or estimated.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95. A document with no candidate skills matched, or truncated/garbled text, should score in the lower bands.

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

Write \`summary\`, \`keyDirectives\`, and \`impactReasoning\` in English. \`affectedSkills[].evidence\` is the one exception — a verbatim quote, kept in the source document's own language.`;

  // Trim extremely long docs to stay inside context windows. 60k chars
  // covers most policy PDFs; longer ones should be chunk-processed by
  // the job (deferred; see CLAUDE.md).
  const body = input.fullText.length > 60_000
    ? input.fullText.slice(0, 60_000) + '\n…[truncated]'
    : input.fullText;

  const candidatesBlock = input.candidateSkills
    .map((c) => `${c.id}: ${c.nameEn} / ${c.nameTh}${c.category ? ` [${c.category}]` : ''}`)
    .join('\n');

  const user = `[Document] ${input.originalFilename}

[Full text]
${body}

[Candidate skills]
${candidatesBlock}

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
//   - fullText          — the PDF intake pipeline's extracted text for this
//     policy document (all pages concatenated; see the ANALYZE_POLICY_DOC
//     handler in apps/ingestion/src/ai-jobs/handlers.ts), capped at 60k
//     chars here.
//   - originalFilename  — shown for provenance / model context only.
//   - candidateSkills   — up to 50 candidate Skill rows (id, nameEn, nameTh,
//     category), supplied by the caller's pickCandidateSkills() helper —
//     the closed-world set affectedSkills[].skillId must be drawn from
//     (Classification addendum: closed-world output only).
//
// Deliberately omitted, with reason:
//   - Existing PolicyDocument rows / prior analyses of related documents —
//     no dedup or "have we seen a similar policy" signal wired; each
//     document is analysed independently on its own text.
//   - KKU's program list — this prompt tags skills/sectors and reasons
//     about impact; it does NOT pick affected programs. suggestedProgramIds
//     stays an empty array by design ("caller fills this via skill
//     overlap") — a deterministic, code-computed step downstream, not a
//     model guess, once that materialisation step is built.
//   - Per-page text / page anchors — the PDF intake pipeline hands this
//     prompt one concatenated fullText string, not per-page structure, so
//     there is nothing to anchor evidence quotes to beyond the verbatim
//     text match itself (Extraction addendum's "page/section anchors where
//     the source document has them" — this source shape doesn't have them
//     yet; wiring per-page provenance through would be a pipeline change,
//     not a prompt change).
// ─────────────────────────────────────────────────────────────────────────────
