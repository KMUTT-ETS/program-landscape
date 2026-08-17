import { z } from 'zod';
import type { AiMessage } from '../types';

// Extracts the ESCO/KKU skills covered by a single course description.
// Callers hand over (a) the full course description (Thai or English),
// (b) a shortlist of candidate skills from our taxonomy (name + id +
// category), scored by vector similarity. The LLM picks which candidates
// actually apply, with weights, or proposes new skills if the course
// covers something the taxonomy doesn't know about yet.
//
// Version bumping rule: change any of the system prompt, examples, or
// output schema? Bump VERSION. AiExtraction.methodVersion captures it
// so we can re-run old extractions against the new prompt deliberately.
//
// v2 (2026-08-17, docs/prompt-standard.md conformance — mechanical
// TOUCH, audit #20): added CONFIDENCE RUBRIC (verbatim) + BANNED
// PHRASES + CHANNEL MANIFEST + explicit English rule. Output was
// already English (nameTh / evidence are exempt data-label / verbatim
// fields) — no language change, markers only.

export const COURSE_SKILL_EXTRACTION_VERSION = 'course-skills.v2';

export const CourseSkillExtractionSchema = z.object({
  skills: z.array(
    z.object({
      // Matches one of the candidates we handed the model. Empty string
      // when the model proposes a NEW skill (see proposedSkills below).
      skillId: z.string(),
      // 0..1 — how central this skill is to the course. 1 = this
      // course's whole point. 0.2 = tangentially covered.
      weight: z.number().min(0).max(1),
      // A short quote/paraphrase from the course description that
      // justifies this mapping. Displayed in the review UI.
      evidence: z.string(),
    }),
  ),
  proposedSkills: z.array(
    z.object({
      nameTh: z.string(),
      nameEn: z.string(),
      // Best-guess parent in the existing taxonomy (candidate id).
      // Empty string if unclear — the reviewer sets it manually.
      suggestedParentSkillId: z.string(),
      rationale: z.string(),
    }),
  ).default([]),
  // Overall extraction confidence (informs review-queue routing).
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional(),
});
export type CourseSkillExtraction = z.infer<typeof CourseSkillExtractionSchema>;

export interface CourseSkillExtractionInput {
  course: {
    code: string;
    nameTh: string;
    nameEn: string;
    descriptionTh?: string;
    descriptionEn?: string;
    // Credits — informs weight calibration (3-credit vs 1-credit).
    credits: number;
  };
  // Candidate skills from vector search, plus a "top-K" of ~30. The
  // model picks FROM these when possible; only proposes new if the
  // candidates don't cover the concept.
  candidateSkills: Array<{
    id: string;
    nameTh: string;
    nameEn: string;
    category: string | null;
  }>;
}

export function buildCourseSkillExtractionMessages(input: CourseSkillExtractionInput): AiMessage[] {
  const system = `You map academic-course descriptions to skills from a curated taxonomy.

Output STRICT JSON matching this shape (no prose, no markdown fences):
{
  "skills": [
    { "skillId": "<one of the candidate ids>", "weight": 0.0-1.0, "evidence": "<short quote>" }
  ],
  "proposedSkills": [
    { "nameTh": "...", "nameEn": "...", "suggestedParentSkillId": "<candidate id or ''>", "rationale": "..." }
  ],
  "confidence": 0.0-1.0,
  "reasoning": "<one sentence>"
}

Rules:
- Prefer existing candidates. Only propose a NEW skill when NONE of the candidates covers a concept that is clearly central to the course.
- weight 1.0 = the whole course is about this skill. weight 0.2 = briefly introduced.
- evidence MUST be a verbatim phrase from the course description, translated to the description's language. If description is Thai, evidence is Thai.
- confidence reflects how well you understood the course. Low when the description is terse or ambiguous.
- Thai curriculum descriptions are common. Handle Thai naturally without translating into English first.
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
- "in today's rapidly evolving"

Examples:

[Course] CP201 — โครงสร้างข้อมูลและอัลกอริทึม (3 credits)
[Description (TH)] ศึกษาโครงสร้างข้อมูลพื้นฐาน เช่น array linked list tree graph และวิเคราะห์ประสิทธิภาพของอัลกอริทึม
[Candidates] s1: ข้อมูลและการจัดการ, s2: การเขียนโปรแกรม, s3: โครงสร้างข้อมูลและอัลกอริทึม, s4: การวิเคราะห์ประสิทธิภาพ
[Output]
{"skills":[{"skillId":"s3","weight":1.0,"evidence":"ศึกษาโครงสร้างข้อมูลพื้นฐาน"},{"skillId":"s4","weight":0.6,"evidence":"วิเคราะห์ประสิทธิภาพของอัลกอริทึม"},{"skillId":"s2","weight":0.3,"evidence":"implicit in algorithm study"}],"proposedSkills":[],"confidence":0.92,"reasoning":"Clear, matches taxonomy well."}

[Course] BIO301 — Molecular Epigenetics (3 credits)
[Description (EN)] Mechanisms of DNA methylation, histone modification, and heritable gene expression changes; laboratory techniques in ChIP-seq and bisulfite sequencing.
[Candidates] s10: Molecular biology, s11: Genetics, s12: Laboratory techniques, s13: Bioinformatics
[Output]
{"skills":[{"skillId":"s10","weight":0.8,"evidence":"DNA methylation, histone modification"},{"skillId":"s12","weight":0.6,"evidence":"ChIP-seq and bisulfite sequencing"}],"proposedSkills":[{"nameTh":"เอพิเจเนติกส์","nameEn":"Epigenetics","suggestedParentSkillId":"s11","rationale":"Distinct subfield of genetics; central to this course but absent from candidates"}],"confidence":0.78,"reasoning":"Course mostly fits molecular biology; proposes epigenetics subtopic."}`;

  const candidatesBlock = input.candidateSkills
    .map((c) => `${c.id}: ${c.nameEn} / ${c.nameTh}${c.category ? ` [${c.category}]` : ''}`)
    .join('\n');

  const desc =
    (input.course.descriptionTh ? `[Description (TH)] ${input.course.descriptionTh}` : '') +
    (input.course.descriptionEn ? `\n[Description (EN)] ${input.course.descriptionEn}` : '');

  const user = `[Course] ${input.course.code} — ${input.course.nameEn} / ${input.course.nameTh} (${input.course.credits} credits)
${desc}

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
//   - course (code, nameTh/nameEn, descriptionTh/descriptionEn, credits)
//     — THE source text this prompt maps to skills.
//   - candidateSkills — a vector-similarity shortlist (~30) from the
//     existing Skill taxonomy. The model matches against these first;
//     proposedSkills is the escape hatch when nothing fits.
//
// Deliberately omitted, with reason:
//   - Full taxonomy (~561 skills) — only the vector-scored candidate
//     shortlist is sent; the full list would dilute the match and blow
//     the context budget for a per-course, high-volume ai-jobs handler.
//   - Program-level context (which program this course belongs to) —
//     this prompt is intentionally course-scoped; program-level skill
//     rollup happens downstream, not by widening this prompt's input.
// ─────────────────────────────────────────────────────────────────────────────
