import { z } from 'zod';
import type { AiMessage } from '../types';

// Extracts skills + ISCO-08 occupation + seniority + responsibilities
// from a single job posting.
//
// Used by ExtractJobPostingSkillsJob — reads from JobPosting rows the
// JobThai/JobsDB connectors already populated (or the PDF intake
// pipeline's JobPostingsBatchExtractor in 03b).
//
// v2 (2026-08-17, docs/prompt-standard.md conformance — mechanical
// TOUCH, audit #21): added CONFIDENCE RUBRIC (verbatim) + BANNED
// PHRASES + CHANNEL MANIFEST + explicit English rule. Output was
// already English (nameTh / evidence are exempt data-label / verbatim
// fields) — no language change, markers only.

export const JOB_POSTING_SKILL_EXTRACTION_VERSION = 'job-posting-skills.v2';

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
- Thai postings are common. Do not translate before extracting.
- Write \`reasoning\` and \`proposedSkills[].rationale\` in English. \`evidence\` stays verbatim in the source's own language (a structural extraction requirement, not a language exemption call) — nameTh / nameEn fields are data labels and also stay as written.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95.

BANNED PHRASES (do not use these words/phrases or their close paraphrases in reasoning/rationale):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"`;

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

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - posting (title, companyName, location, descriptionTh/En,
//     skillsRaw) — THE source text this prompt maps to skills +
//     occupation + seniority.
//   - candidateSkills — a vector-similarity shortlist from the existing
//     Skill taxonomy. The model matches against these first;
//     proposedSkills is the escape hatch when nothing fits.
//
// Deliberately omitted, with reason:
//   - Full taxonomy (~561 skills) — only the candidate shortlist is
//     sent, same rationale as course-skill-extraction (context budget,
//     per-posting high-volume handler).
//   - ISCO-08 reference table — iscoCode is a best-guess 4-digit label
//     from the model's own knowledge of the standard, not looked up
//     against a wired taxonomy table; there is no ISCO channel to wire
//     in yet (tracked as a KMITL/ISCO crosswalk gap elsewhere).
// ─────────────────────────────────────────────────────────────────────────────
