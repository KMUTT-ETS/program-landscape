import { z } from 'zod';
import type { AiMessage } from '../types';

// Summarises + tags a policy document. Runs AFTER the PDF intake
// pipeline's PolicyDocExtractor has produced the base PolicyDocument
// row — this prompt takes the full text and produces:
//   - Thai + English summaries
//   - skill tags (from candidates)
//   - sector tags
//   - impact score with reasoning
//   - suggested programs that are affected (for reviewer verification)
//
// ProcessPolicyDocJob (in apps/ingestion) invokes this.

export const POLICY_DOC_ANALYSIS_VERSION = 'policy-doc.v1';

export const PolicyDocAnalysisSchema = z.object({
  summaryTh: z.string(),
  summaryEn: z.string(),
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
  const system = `You analyse Thai/English higher-education policy documents (MHESI, NESDC, NXPO, BOI, EECO) for their impact on university curriculum decisions.

Output STRICT JSON (no prose, no fences) matching:
{
  "summaryTh": "<3-5 sentences Thai>",
  "summaryEn": "<3-5 sentences English>",
  "issuingOrg": "<name>",
  "publicationDate": "<YYYY-MM-DD or omit>",
  "keyDirectives": ["..."],
  "affectedSkills": [{"skillId":"<candidate id>","evidence":"<quote>"}],
  "affectedSectors": ["..."],
  "suggestedProgramIds": [],  // leave empty — caller fills this via skill overlap
  "estimatedImpact": "low|medium|high",
  "impactReasoning": "<one paragraph>",
  "confidence": 0.0-1.0
}

Impact rubric:
- high: directly affects which programs KKU should launch, close, or restructure
- medium: informs faculty-level strategic decisions but not individual programs
- low: background context or historical

Thai primary for summaryTh — natural, not a translation. Write summaryEn for English readers separately; don't machine-translate summaryTh.`;

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
