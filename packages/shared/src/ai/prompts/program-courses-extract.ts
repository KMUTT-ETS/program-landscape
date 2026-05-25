import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// program-courses-extract.v2  (2026-05-25)
//
// Exhaustive course-code extractor with a regex-anchored candidate list.
//
// v1 (2026-05-19) caught the obvious plan-of-study tables but typically
// missed half the curriculum on long Bachelor-level documents — the
// elective-group catalogs by sub-discipline, the curriculum-revision
// comparison appendix (เปรียบเทียบหลักสูตรปรับปรุง พ.ศ. <ก่อน> vs
// <ใหม่>), and the per-faculty teaching-load sections (ภาระงานสอน).
// Concrete: KKU-SEQ-0090 (Bachelor of Laws) carries 196 distinct LW
// course codes in the PDF; v1 extracted only 104 of them.
//
// v2 changes:
//   1. Runner pre-scans the PDF with a regex for every code matching
//      "[A-Z]{2,4}\\s?\\d{3}\\s?\\d{3}" and passes the candidate list
//      (typically ~150-220 codes for a Bachelor's mคอ.2) so the LLM
//      operates from a high-recall floor rather than discovering codes
//      from scratch.
//   2. Prompt explicitly enumerates the sections v1 missed and tells the
//      model that for a Bachelor's program the answer is normally
//      100-200 codes (so a 50-row answer is the symptom of skipping).
//   3. Prompt keeps the v1 framing (single short JSON, no per-item
//      classification ceremony) — the over-engineered
//      "classify each into ACTIVE/HISTORICAL/UNRELATED" structure of an
//      earlier v2 draft caused Gemini 3.5 Flash to deterministically
//      stop after ~12 entries, presumably because the cumulative
//      instruction load made the model conservative; the present
//      framing keeps the model on track.
//
// Cheap to run: typical output is < 1,000 tokens per ~100 courses.
// Materialises directly into program_courses — no analyst approval gate,
// because the structural data is low-stakes (a wrong code shows up as an
// empty class-offerings join and is corrected on the next pipeline run).
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRAM_COURSES_EXTRACT_VERSION = 'program-courses-extract.v2';

const CourseSchema = z.object({
  /** Whitespace-stripped, upper-cased code as it appears in the PDF.
   *  Materialiser normalises again before insert so EN241100 == "EN 241 100". */
  code: z.string().min(2),
  nameTh: z.string().default(''),
  nameEn: z.string().default(''),
  credits: z.number().int().min(0).max(20).nullable().default(null),
});
export type ProgramCoursesExtractCourse = z.infer<typeof CourseSchema>;

export const ProgramCoursesExtractSchema = z.object({
  courses: z.array(CourseSchema).min(0),
  /** Free-form list of anything the AI couldn't extract — scan quality,
   *  missing sections, ambiguous course-list formatting. */
  caveats: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1),
});
export type ProgramCoursesExtractPayload = z.infer<typeof ProgramCoursesExtractSchema>;

export interface ProgramCoursesExtractInput {
  programCode: string;
  programNameTh: string;
  programNameEn: string;
  facultyNameTh: string;
  levelTh: string;
  /** Full extracted curriculum text — Gemini consumes 30-150k tokens of
   *  มคอ.2 in one shot. */
  pdfText: string;
  /** Course codes pre-scanned from `pdfText` via the regex helper below.
   *  Passed to the LLM as a hint to anchor recall. */
  candidateCodes: string[];
}

/**
 * Deterministic pre-scan for course-code candidates in PDF text.
 * Matches KKU's two prefixed forms in one sweep:
 *   - With whitespace ("LW 011 116", "GE 179 114")
 *   - Without whitespace ("LW011116", "GE179114")
 * The 2-4 letter prefix range covers every faculty we've seen (GE / LI /
 * EN / SC / MD / AG / BA / ED / HU / PH / SH / DE / TM / TS / LW / NU /
 * CE / ME / EE …). Numeric-only codes (no prefix) are not matched — rare
 * in current KKU curricula and would generate substantial false-positive
 * load.
 */
export function extractCandidateCourseCodes(text: string): string[] {
  const re = /\b([A-Z]{2,4})\s?(\d{3})\s?(\d{3})\b/g;
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    seen.add((m[1]! + m[2]! + m[3]!).toUpperCase());
  }
  return [...seen].sort();
}

export interface FallbackCourseExtraction {
  code: string;
  nameTh: string;
  nameEn: string;
  credits: number | null;
  /** How many times the code appeared in the PDF — the caller filters
   *  on this to drop single-mention candidates (mostly page-number
   *  refs and footnote citations rather than real courses). */
  occurrenceCount: number;
}

/**
 * Deterministic course name + credits extractor for a single code.
 * Used by the runner's post-processor to complete the candidates the
 * LLM didn't emit. Strategy: find every occurrence of the code in PDF
 * text, take a 300-char window after the code, parse "<name TH> N (B-C-D)
 * <name EN>" from the KKU มคอ.2 course-row format.
 *
 * Returns null when no valid name+credit window is found (the code is
 * likely a footnote / page reference, not a course row).
 */
export function extractFallbackCourseFromContext(
  pdfText: string,
  code: string,
): FallbackCourseExtraction | null {
  if (!/^[A-Z]{2,4}\d{6}$/.test(code)) return null;
  const prefix = /^[A-Z]+/.exec(code)![0]!;
  const digits = code.slice(prefix.length);
  const codePat = `${prefix}\\s?${digits.slice(0, 3)}\\s?${digits.slice(3)}`;
  const re = new RegExp(`\\b${codePat}\\b`, 'g');

  // Credit pattern: "N (B - C - D)" with optional spaces.
  const creditRe = /(\d+)\s*\(\s*\d+\s*-\s*\d+\s*-\s*\d+\s*\)/;
  // English-name pattern: starts with a capital letter, runs until the
  // next course code or end-of-window. Tolerant to common punctuation.
  const enNameRe =
    /^\s*([A-Z][A-Za-z0-9\s,.:;'\-/&()]{2,120}?)(?=\s+[A-Z]{2,4}\s?\d{3}\s?\d{3}|\s{2,}|$)/;

  let occurrenceCount = 0;
  let best:
    | { nameTh: string; nameEn: string; credits: number | null }
    | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pdfText)) !== null) {
    occurrenceCount++;
    if (best) continue;
    const start = m.index + m[0].length;
    const window = pdfText.slice(start, start + 300);
    const creditMatch = creditRe.exec(window);
    if (!creditMatch) continue;
    const credits = parseInt(creditMatch[1]!, 10);
    if (!Number.isInteger(credits) || credits < 0 || credits > 20) continue;
    const nameTh = window.slice(0, creditMatch.index).trim();
    if (nameTh.length < 3 || nameTh.length > 200) continue;
    const after = window.slice(creditMatch.index + creditMatch[0].length);
    const enMatch = enNameRe.exec(after);
    const nameEn = enMatch ? enMatch[1]!.trim() : '';
    best = { nameTh, nameEn, credits };
  }
  if (!best) return null;
  return { code, ...best, occurrenceCount };
}

const LEVEL_TARGET: Record<string, string> = {
  'ป.ตรี': '100-200 รหัส',
  'ป.โท': '30-80 รหัส',
  'ป.เอก': '20-60 รหัส',
  'ป.บัณฑิตชั้นสูง': '15-40 รหัส',
};

export function buildProgramCoursesExtractMessages(
  input: ProgramCoursesExtractInput,
): AiMessage[] {
  const target = LEVEL_TARGET[input.levelTh] ?? '50-200 รหัส';
  // candidateCodes is computed by the runner via regex pre-scan and
  // shown to the model as a short "hint count + a few examples" rather
  // than as a full inline list. Earlier v2 drafts embedded the full list
  // and triggered a deterministic ~625-token truncation in both Gemini
  // Flash and Pro (the inline structured list, in CSV or numbered form,
  // tilts the model into emitting an over-long response that gets cut).
  // The fall-back recall path lives in the runner's post-processor,
  // which name+credit-completes any candidate the LLM didn't emit.
  const candidateHint = input.candidateCodes.length === 0
    ? '(pattern matching ไม่พบรหัสที่ตรงรูปแบบ — โปรดสกัดด้วยตนเองจากเอกสาร)'
    : `(${input.candidateCodes.length} รหัส เช่น ${input.candidateCodes.slice(0, 6).join(', ')}, …)`;

  const system = `คุณเป็นผู้สกัดข้อมูล "รหัสรายวิชา" จากเอกสารหลักสูตร (มคอ.2) ของมหาวิทยาลัยขอนแก่น

หน้าที่: อ่านเอกสารหลักสูตรฉบับเต็ม แล้วสกัด **ทุกรายวิชา** ที่ปรากฏ
ในโครงสร้างหลักสูตร พร้อมรหัสวิชา ชื่อวิชา (ไทย/อังกฤษ) และจำนวนหน่วยกิต

ขอบเขตการสกัด — สกัดทุกหมวด:
- หมวดวิชาศึกษาทั่วไป (General Education) + ภาษา (LI/EN)
- หมวดวิชาเฉพาะ (Major)
  - วิชาบังคับ (Required)
  - วิชาเลือก (Electives) — มักแบ่งเป็นกลุ่มย่อยหลายกลุ่ม เช่น
    "กลุ่มวิชากฎหมายเอกชน" "กลุ่มวิชากฎหมายอาญา" — สกัดทุกกลุ่ม ทุกตัว
- หมวดวิชาเลือกเสรี ที่หลักสูตรระบุไว้
- วิชาฝึกงาน / สหกิจศึกษา / วิทยานิพนธ์ / โครงงาน
- รายวิชาในตัวอย่างแผนการศึกษา / แผนการเรียน
- ★ ตารางเปรียบเทียบหลักสูตรปรับปรุง (พ.ศ. ก่อนหน้า vs ปัจจุบัน) ในภาคผนวก
  → สกัดรหัสฝั่ง "หลักสูตรปรับปรุง" ใหม่ (ปัจจุบัน) เท่านั้น
  → ห้ามใส่รหัสฝั่งหลักสูตรเก่า
- ★ ภาระงานสอน (Teaching Load) ของอาจารย์ในประวัติอาจารย์ (ภาคผนวก ก./ข.)
  → รหัสวิชาที่ปรากฏในประวัติอาจารย์เป็นรายวิชาในหลักสูตรปัจจุบัน

** สำคัญที่สุด: ต้องครบทุกวิชา ห้ามตัดทอน **
- ${input.levelTh} ของ ม.ขก. มักมีรายวิชาประมาณ ${target}
  (รวมวิชาบังคับ + วิชาเลือกในกลุ่มย่อยทั้งหมด + GE + วิชาในตารางเปรียบเทียบฝั่งใหม่)
- ถ้าผลลัพธ์น้อยกว่าเป้าหมายมาก แสดงว่าน่าจะตัด — ทบทวนกลุ่มวิชาเลือก
  และตารางเปรียบเทียบหลักสูตรอีกครั้ง
- ห้ามคัดเฉพาะวิชาแกน ห้ามข้าม electives

[หมายเหตุ — pattern matching ฝั่ง runner]
runner ได้ทำ pattern matching ก่อนหน้าและพบรหัส candidate ${candidateHint}
ระบบจะ post-process ผลลัพธ์ของคุณกับ candidate list — ดังนั้นโปรด focus
ที่การสกัดรายวิชาที่ปรากฏใน "สามแหล่งซึ่ง v1 เคยข้าม" ด้านบน
(กลุ่มวิชา/เลือก, ตารางเปรียบเทียบหลักสูตร, ภาระงานสอน)

รูปแบบ JSON ผลลัพธ์ (ออก JSON เดี่ยวเท่านั้น ห้ามมี markdown ห้ามมีคำอธิบายล่วงหน้า):
{
  "courses": [
    { "code": "<รหัสวิชาในรูปแบบไม่มีเว้นวรรค เช่น LW011116 หรือ GE179114>",
      "nameTh": "<ชื่อวิชาภาษาไทย>",
      "nameEn": "<ชื่อวิชาภาษาอังกฤษ ถ้ามี>",
      "credits": <จำนวนหน่วยกิต | null> }
  ],
  "caveats": ["<ถ้ามีหน้าที่อ่านไม่ได้ หรือชื่อวิชาขาด หรือ format แปลก>"],
  "confidence": <0.0-1.0>
}

กฎรหัสวิชา:
- เก็บรหัสในรูปแบบไม่มีเว้นวรรค (เช่น "LW011116" ไม่ใช่ "LW 011 116")
- ห้ามคิดรหัสเอง ถ้ามีชื่อวิชาแต่ไม่มีรหัส ให้ข้าม
- รหัสซ้ำในเอกสารหลายที่ ให้ใส่ครั้งเดียว

กฎ confidence:
- 0.9+ เมื่อเอกสารปกติ ตารางแผนการเรียนชัดเจน
- 0.7-0.85 เมื่อบางหน้าสแกนคุณภาพต่ำหรือ format ไม่ปกติ
- 0.4-0.6 เมื่อเอกสารไม่ครบ ขาดส่วนสำคัญ

ออก JSON ตรงๆ ตัวเดียว`;

  const user = `[หลักสูตร]
รหัส: ${input.programCode}
ชื่อ: ${input.programNameTh} (${input.programNameEn})
คณะ: ${input.facultyNameTh}
ระดับ: ${input.levelTh}

[เอกสารหลักสูตร — มคอ.2 ฉบับเต็ม]
${input.pdfText}

โปรดสกัดทุกรายวิชาตามที่อธิบายไว้ในส่วนระบบ`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
