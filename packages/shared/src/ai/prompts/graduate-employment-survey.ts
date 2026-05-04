import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// graduate-employment-survey.v1
//
// Extracts per-program employment outcomes from KKU's annual undergraduate
// graduate-employment survey reports (Thai-language PDFs, ~192 pages
// each, one report per academic year). Each report contains aggregate
// stats by ส่วนงาน (faculty/college) AND nested per-program breakdowns
// (มีงานทำ, อัตราการได้งานทำ, เงินเดือนเฉลี่ย, การศึกษาต่อ, etc.).
//
// Output: structured array of per-program outcomes for the survey year,
// resolved at the faculty + program-name level. Survey year = the year
// the report was published; graduation year = academic year of the
// surveyed cohort (typically 1 year before survey year because the
// survey runs in the following calendar year after graduation).
//
// PDF is sent via Gemini File API (no inline tokens). The AI reads
// the whole document and returns one row per program it can identify.
// Missing fields → null.
// ─────────────────────────────────────────────────────────────────────────────

export const GRADUATE_EMPLOYMENT_SURVEY_VERSION = 'graduate-employment-survey.v1';

const ProgramOutcomeRowSchema = z.object({
  /** Verbatim Thai faculty name as it appears in the report
   *  (e.g. "คณะวิศวกรรมศาสตร์", "วิทยาลัยการคอมพิวเตอร์"). */
  facultyNameTh: z.string().min(2).max(200),
  /** Verbatim Thai program name as it appears in the report's per-
   *  program breakdown (e.g. "วิทยาศาสตรบัณฑิต (เคมี)", "วิศวกรรมศาสตรบัณฑิต
   *  (วิศวกรรมเคมี)"). May be a degree-only string if the report doesn't
   *  separate by major. */
  programNameTh: z.string().min(2).max(300),
  /** English program name when present in the report; null otherwise. */
  programNameEn: z.string().max(300).nullable(),
  /** Academic year (Common Era) of the surveyed graduating cohort. */
  graduationYear: z.number().int().min(2010).max(2030),
  /** Survey year (Common Era) — the year KKU ran the survey. Typically
   *  graduationYear + 1 because the survey runs the year after
   *  graduation. */
  surveyYear: z.number().int().min(2010).max(2030),
  /** Number of graduates who responded to the survey for this program. */
  sampleSize: z.number().int().min(0).max(2000),
  /** Total graduates from this program in the cohort (denominator for
   *  response-rate context). Optional — older reports often don't
   *  break this out per program. */
  cohortSize: z.number().int().min(0).max(5000).nullable().optional(),
  /** Share of respondents currently employed (excluding those in
   *  further study), 0..1. */
  employmentRate: z.number().min(0).max(1).nullable(),
  /** Share currently in further study, 0..1. */
  furtherStudyRate: z.number().min(0).max(1).nullable(),
  /** Average monthly salary (THB). Null when not reported per-program. */
  averageSalary: z.number().min(0).max(500_000).nullable(),
  /** Share whose job is "ตรงสาขา" (relevant to their field of study), 0..1. */
  jobRelevanceScore: z.number().min(0).max(1).nullable(),
});
export type ProgramOutcomeRow = z.infer<typeof ProgramOutcomeRowSchema>;

export const GraduateEmploymentSurveySchema = z.object({
  /** Survey year (Common Era) for this report. */
  surveyYear: z.number().int().min(2010).max(2030),
  /** Cohort graduation year (Common Era). */
  cohortGraduationYear: z.number().int().min(2010).max(2030),
  /** Total surveyed graduates across the entire university. */
  totalRespondents: z.number().int().min(0).max(20_000).nullable(),
  /** Per-program outcome rows. */
  programs: z.array(ProgramOutcomeRowSchema).min(0).max(400),
  /** AI's self-rated confidence 0-1. Lower when many fields are
   *  missing or tables are ambiguous. */
  confidence: z.number().min(0).max(1),
});
export type GraduateEmploymentSurvey = z.infer<typeof GraduateEmploymentSurveySchema>;

export interface GraduateEmploymentSurveyInput {
  /** Survey year hint extracted from the PDF filename — helps the AI
   *  bound year extraction when the report mentions multiple years. */
  surveyYearHint: number;
  /** Optional list of canonical KKU faculty Thai names so the AI can
   *  prefer the canonical spelling when faculty names appear in
   *  multiple variants in the report. */
  knownFacultyNamesTh?: string[];
}

const SYSTEM_PROMPT = `You are extracting structured per-program employment outcomes from a KKU annual graduate-employment survey report (Thai-language PDF). Your output drives the strategic-planning system used by the University Council.

GROUND RULES:

1. Find the per-program tables — they typically appear in chapter 3
   (บทที่ 3) and break down outcomes by faculty (ส่วนงาน) and within
   each faculty by program/curriculum (หลักสูตร).
2. Extract one row per UNIQUE program found in the report. A "program"
   is a curriculum at the undergraduate level (ปริญญาตรี). Skip
   postgraduate (ปริญญาโท / เอก) — these reports are undergraduate-only.
3. employmentRate = share of respondents who are EMPLOYED (มีงานทำ
   / ทำงานแล้ว), as a fraction 0..1. Convert percentages to fractions
   (e.g. 68.52% → 0.6852).
4. furtherStudyRate = share in further study (กำลังศึกษาต่อ / ศึกษาต่อ).
5. jobRelevanceScore = share whose job is "ตรงสาขา" (matches field of
   study). Null when the report doesn't break this out per program.
6. averageSalary = monthly salary in THB (บาทต่อเดือน), the per-program
   average. Null when not reported.
7. graduationYear = academic year of the surveyed cohort (CE). The
   report uses Buddhist Era — convert (BE - 543 = CE).
8. surveyYear = the year KKU ran the survey (CE). Typically = graduation
   year + 1 because the survey runs the year after graduation.
9. Preserve verbatim Thai program names — DO NOT normalise or translate.
   English names go in the separate \`programNameEn\` field, null when
   absent.
10. If you encounter ambiguity (e.g. percentages don't add to 100,
    salary missing, sample size unclear), set the field to null
    rather than guessing. Lower the overall \`confidence\` accordingly.
11. DO NOT invent rows. If a program isn't named in the report, omit it.

Output: a single JSON object matching the schema below.`;

const USER_PROMPT = (input: GraduateEmploymentSurveyInput) => {
  const facultyHint = input.knownFacultyNamesTh && input.knownFacultyNamesTh.length > 0
    ? `\n\nCanonical KKU faculty Thai names (prefer these spellings):\n${input.knownFacultyNamesTh.map((n) => `  - ${n}`).join('\n')}`
    : '';
  return `Extract the per-program graduate-employment outcomes from this PDF.

Survey year hint (from filename): ${input.surveyYearHint}${facultyHint}

Output as a single JSON object using EXACTLY these top-level fields:

\`\`\`json
{
  "surveyYear": <number CE>,
  "cohortGraduationYear": <number CE>,
  "totalRespondents": <number or null>,
  "programs": [
    {
      "facultyNameTh": "<verbatim Thai faculty name>",
      "programNameTh": "<verbatim Thai program name>",
      "programNameEn": "<English name or null>",
      "graduationYear": <number CE>,
      "surveyYear": <number CE>,
      "sampleSize": <number>,
      "cohortSize": <number or null>,
      "employmentRate": <0..1>,
      "furtherStudyRate": <0..1>,
      "averageSalary": <number THB or null>,
      "jobRelevanceScore": <0..1 or null>
    }
  ],
  "confidence": <0..1>
}
\`\`\`

Remember:
- Undergraduate (ปริญญาตรี) only — skip postgraduate programs.
- Convert all Buddhist-Era years to CE (BE - 543).
- Convert percentages to fractions 0..1.
- Use null for any field not clearly stated in the report.
- Preserve verbatim Thai names; do not normalise.`;
};

export function buildGraduateEmploymentSurveyMessages(
  input: GraduateEmploymentSurveyInput,
): AiMessage[] {
  return [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: USER_PROMPT(input) },
  ];
}
