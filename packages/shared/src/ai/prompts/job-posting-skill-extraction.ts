import { z } from 'zod';
import type { AiMessage } from '../types';

// Extracts skills + ISCO-08 occupation + seniority + responsibilities
// from a single job posting.
//
// Used by ExtractJobPostingSkillsJob — reads from JobPosting rows the
// JobThai/JobsDB connectors already populated (or the PDF intake
// pipeline's JobPostingsBatchExtractor in 03b).

export const JOB_POSTING_SKILL_EXTRACTION_VERSION = 'job-posting-skills.v1';

export const JobPostingSkillExtractionSchema = z.object({
  skills: z.array(
    z.object({
      skillId: z.string(),
      weight: z.number().min(0).max(1),
      required: z.boolean().default(true),
      evidence: z.string(),
    }),
  ),
  proposedSkills: z.array(
    z.object({
      nameTh: z.string(),
      nameEn: z.string(),
      suggestedParentSkillId: z.string(),
      rationale: z.string(),
    }),
  ).default([]),
  // ISCO-08 4-digit occupation code (best guess). Empty string if
  // unclear.
  iscoCode: z.string(),
  // Seniority level. 'unknown' when the posting is ambiguous.
  seniority: z.enum(['entry', 'junior', 'mid', 'senior', 'lead', 'unknown']),
  keyResponsibilities: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional(),
});
export type JobPostingSkillExtraction = z.infer<typeof JobPostingSkillExtractionSchema>;

export interface JobPostingSkillExtractionInput {
  posting: {
    id: string;
    title: string;
    companyName?: string;
    location?: string;
    descriptionTh?: string;
    descriptionEn?: string;
    skillsRaw?: string[];
  };
  candidateSkills: Array<{
    id: string;
    nameTh: string;
    nameEn: string;
    category: string | null;
  }>;
}

export function buildJobPostingSkillExtractionMessages(input: JobPostingSkillExtractionInput): AiMessage[] {
  const system = `You extract skills + occupation + seniority from a job posting.

Output STRICT JSON (no prose, no fences):
{
  "skills": [ { "skillId": "<candidate id>", "weight": 0.0-1.0, "required": true|false, "evidence": "<short quote>" } ],
  "proposedSkills": [ { "nameTh": "...", "nameEn": "...", "suggestedParentSkillId": "<id or ''>", "rationale": "..." } ],
  "iscoCode": "<4-digit ISCO-08 or ''>",
  "seniority": "entry|junior|mid|senior|lead|unknown",
  "keyResponsibilities": ["..."],
  "confidence": 0.0-1.0,
  "reasoning": "<one sentence>"
}

Rules:
- Prefer existing candidates; only propose new skills when nothing fits.
- weight 1.0 = core requirement; 0.3 = "bonus skill" or "nice to have".
- required = true if the posting says the skill is MUST-HAVE; false for nice-to-have.
- iscoCode: return 4 digits (e.g. 2512 for Software Developers). Empty string if the role is too generic to classify confidently.
- seniority: parse from title + years-of-experience; 'unknown' when nothing signals it.
- Thai postings are common. Do not translate before extracting.`;

  const candidatesBlock = input.candidateSkills
    .map((c) => `${c.id}: ${c.nameEn} / ${c.nameTh}${c.category ? ` [${c.category}]` : ''}`)
    .join('\n');

  const desc =
    (input.posting.descriptionTh ? `[Description (TH)] ${input.posting.descriptionTh}` : '') +
    (input.posting.descriptionEn ? `\n[Description (EN)] ${input.posting.descriptionEn}` : '');
  const rawSkills = input.posting.skillsRaw?.length
    ? `\n[Raw skills tags] ${input.posting.skillsRaw.join(', ')}`
    : '';

  const user = `[Job] ${input.posting.title}${input.posting.companyName ? ' @ ' + input.posting.companyName : ''}${input.posting.location ? ' · ' + input.posting.location : ''}
${desc}${rawSkills}

[Candidates]
${candidatesBlock}

Return the JSON.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
