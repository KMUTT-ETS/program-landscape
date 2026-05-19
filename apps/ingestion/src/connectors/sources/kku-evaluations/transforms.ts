// ────────────────────────────────────────────────────────────────────────
// Pure transforms for the kku-evaluations connector.
// No Prisma, no Oracle — testable from fixtures.
// ────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';
import { z } from 'zod';

export const QUESTION_ROW_SCHEMA = z.object({
  QUESTIONID: z.string(),
  QUESTION_TEXT_TH: z.string().nullable(),
  FIRST_SEEN_YEAR_BE: z.number().int(),
  LAST_SEEN_YEAR_BE: z.number().int(),
  SEMESTERS_USED: z.number().int(),
});
export type QuestionRow = z.infer<typeof QUESTION_ROW_SCHEMA>;

export const EVAL_ROW_SCHEMA = z.object({
  ACADYEAR: z.number().int(),
  SEMESTER: z.number().int(),
  CAMPUSID: z.number().int(),
  FACULTYID: z.number().int(),
  COURSECODE: z.string(),
  COURSENAME: z.string().nullable(),
  COURSENAMEENG: z.string().nullable(),
  CLASSID: z.coerce.bigint(),
  SECTION: z.number().int(),
  QUESTIONID: z.string(),
  OFFICERID: z.number().int(),
  KKUMAIL: z.string().nullable(),
  // Oracle may return numeric values as `string` under certain client
  // configs (e.g., NUMBER columns wider than JS number precision).
  // Coerce + clamp to [0, 5] just in case. Q3 SQL already filters out
  // NULL POINT_AVG rows.
  RATING_AVG: z.coerce.number().min(0).max(5),
  RESPONDENT_COUNT: z.coerce.number().int().min(5, 'respondentCount must be >= 5 by source-side filter'),
  LAST_UPDATE: z.union([z.string(), z.date()]).nullable(),
});
export type EvalRow = z.infer<typeof EVAL_ROW_SCHEMA>;

// ── question text hash ──────────────────────────────────────────────
// 16-char SHA-256 prefix of the Thai text. Two rows with same
// questionIdRegistrar but different hash = different versions of the
// same question. Whitespace-normalised so visually-identical strings
// collide; the trailing tab some registrar entries carry doesn't
// create a phantom version.
export function questionTextHash(textTh: string | null): string {
  const normalized = (textTh ?? '').replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(normalized).digest('hex').slice(0, 16);
}

// ── isCore classification ───────────────────────────────────────────
// A question is "core" when it appears in every (year, semester) bucket
// observed in the dataset. The thresholds come from Phase 0 findings:
// 21 total buckets observed in BE 2564–2569. We treat 95%+ as core to
// allow for one missing semester due to data-quality glitches.
export function isCoreFromSemestersUsed(semestersUsed: number, totalBuckets: number): boolean {
  if (totalBuckets <= 0) return false;
  return semestersUsed / totalBuckets >= 0.95;
}

// ── COURSECODE normalisation ────────────────────────────────────────
// Match the ClassOffering.courseCode convention so joins work:
//   - trim
//   - upper-case
//   - strip internal whitespace
export function normaliseCourseCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/\s+/g, '');
}

// ── KKUMAIL normalisation ───────────────────────────────────────────
// FacultyMember.kkuEmail stores lowercased exact emails. KKUMAIL on the
// view sometimes carries trailing whitespace.
export function normaliseKkumail(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  return trimmed.length === 0 ? null : trimmed;
}

// ── LAST_UPDATE → Date | null ───────────────────────────────────────
// oracledb returns dates as JS Date in OUT_FORMAT_OBJECT mode; older
// driver versions hand back strings. Coerce both.
export function parseLastUpdate(raw: string | Date | null): Date | null {
  if (raw === null || raw === undefined) return null;
  if (raw instanceof Date) return Number.isFinite(raw.getTime()) ? raw : null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

// ── theme-tag inference (heuristic) ─────────────────────────────────
// Lightweight rule-based tag for the 10 core + 15 extended questions.
// The AI-translation pass can refine later; this gives the dashboard
// a default grouping on first load.
const THEME_KEYWORDS: Record<string, RegExp> = {
  'active-learning': /(มีส่วนร่วม|ลงมือทำ|กิจกรรมการเรียน|ค้นคว้า)/,
  'ethics': /(คุณธรรม|จริยธรรม|จรรยาบรรณ)/,
  'assessment': /(ประเมินผล|เกณฑ์|วัดและประเมิน|สัดส่วนคะแนน)/,
  'feedback': /(ซักถาม|ตอบ|คำแนะนำ|เปิดโอกาส)/,
  'content-design': /(เนื้อหา|ทันสมัย|รูปแบบ|สื่อ)/,
  'english-skills': /(การฟัง|การพูด|การอ่าน|การเขียน|ไวยากรณ์|คำศัพท์|ภาษาอังกฤษ)/,
};

export function inferThemeTag(textTh: string | null): string | null {
  if (!textTh) return null;
  for (const [tag, re] of Object.entries(THEME_KEYWORDS)) {
    if (re.test(textTh)) return tag;
  }
  return null;
}
