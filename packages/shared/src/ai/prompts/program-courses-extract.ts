import { z } from 'zod';
import type { AiMessage } from '../types';
import { getInstitution } from '../../institution';
import { courseCodeRegex, isCourseCode } from '../../curriculum/course-code-pattern';

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

export const PROGRAM_COURSES_EXTRACT_VERSION = 'program-courses-extract.v4';

// credits.max(60): inherited v1's max(20) but that rejected entire
// extractions on prod for any program whose curriculum lists a
// doctoral thesis / dissertation unit. Bumped to 60. (Schema-fix-only
// bump v2 → v2.1.)
//
// v2.2 (runner-side): wrap the LLM call in try/catch so a hard failure
// (truncation, schema rejection) still materialises via the regex
// fallback on the full candidate set. maxOutputTokens 16k → 32k.
//
// v2.3 (2026-05-25, scope change): extract ONLY from the รายวิชา
// section — the structured course list that every KKU มคอ.2 organises
// into 3 หมวด:
//   1. หมวดวิชาศึกษาทั่วไป  (General Education)
//   2. หมวดวิชาเฉพาะ        (Major-specific)
//   3. หมวดวิชาเลือกเสรี    (Free Electives)
// Everything in ภาคผนวก (appendices) is invisible. The earlier-
// considered "คำอธิบายรายวิชา" section is also excluded — it duplicates
// the course list but adds a paragraph of prose per row that bloats
// the LLM input. The structured รายวิชา section is the canonical
// source of every active curriculum course.
//
// v2.0–2.2 deliberately scanned the appendices (curriculum-revision
// comparison + faculty teaching-load) to maximise recall, but on
// KKU-SEQ-0090 the model started quoting *old-curriculum* codes from
// the comparison-table appendix and tagging them as active — see the
// caveat the model itself volunteered:
//   "รหัสวิชาในประวัติอาจารย์ (ภาคผนวก 4) เป็นรหัสวิชาจากหลักสูตรเก่า
//    (พ.ศ. 2564) จึงไม่ได้นำามาใส่..."
// The runner now slices the PDF text to the รายวิชา section (start:
// "X.Y รายวิชา" header followed by หมวดวิชา + course codes; end: first
// subsequent คำอธิบายรายวิชา / ภาคผนวก header) and passes only that
// slice to the LLM + regex pre-scan + regex fallback. If the section
// can't be located the run is SKIPPED with a clear reason — better
// than silently extracting the wrong codes.
//
// v3 (2026-08-17, docs/prompt-standard.md conformance — mechanical
// TOUCH, audit #17): version scheme regularised from the patch-style
// v2.3 to the standard's major-only convention (this is the file's
// first behaviour-carrying bump since v2.3, so the regularisation
// lands here rather than as a separate rename-only commit, per the
// standard's Versioning section). Added CONFIDENCE RUBRIC (verbatim) +
// BANNED PHRASES + CHANNEL MANIFEST; `caveats` was Thai in practice —
// flipped to English. No extraction-logic change.
//
// v4 (2026-09-02): added `category` per course (the หมวด grouping), read
// from the curriculum-structure headings the slice already contains. v1-v3
// discarded them. Enables elective-to-core promotion advice in
// program-curriculum-revision.v1. No change to code/name/credits behaviour.
// (The plan for this change called it "v2"; that string is taken by the
// pre-v2.3 full-PDF prompt, and the standard forbids reusing a published
// version — see docs/prompt-standard.md § Versioning.)

/** The หมวด grouping a course sits under in the curriculum structure.
 *  Richer than the Course.type enum (CORE/ELECTIVE/GENERAL), which cannot
 *  express บังคับ-vs-เลือก WITHIN หมวดวิชาเฉพาะ — exactly the distinction
 *  elective-to-core promotion advice depends on.
 *
 *  UNKNOWN is a first-class answer, not a failure: a course the model
 *  cannot place must say so. Defaulting it into a real category would
 *  produce a confidently wrong promotion recommendation. */
export const CourseCategorySchema = z.enum([
  'GENERAL_EDUCATION', // หมวดวิชาศึกษาทั่วไป
  'CORE',              // กลุ่มวิชาแกน / กลุ่มวิชาพื้นฐาน
  'MAJOR_REQUIRED',    // วิชาเฉพาะบังคับ / วิชาชีพบังคับ / สหกิจศึกษา
  'MAJOR_ELECTIVE',    // วิชาเฉพาะเลือก / วิชาเอกเลือก / วิชาโท
  'FREE_ELECTIVE',     // หมวดวิชาเลือกเสรี
  'THESIS_PROJECT',    // วิทยานิพนธ์ / ดุษฎีนิพนธ์ / สารนิพนธ์ / การศึกษาอิสระ
  'UNKNOWN',
]);
export type CourseCategory = z.infer<typeof CourseCategorySchema>;

const CourseSchema = z.object({
  /** Whitespace-stripped, upper-cased code as it appears in the PDF.
   *  Materialiser normalises again before insert so EN241100 == "EN 241 100". */
  code: z.string().min(2),
  /** `.nullish()`, not `.default()` alone: the model sometimes emits JSON
   *  null for a name it has no value for (usually nameEn on a Thai-only
   *  course), and a bare `.default()` only covers a MISSING key — the null
   *  failed the whole response and sent the programme to the regex fallback,
   *  losing every course category (10 of 89 programmes in the 2026-10-03 v4
   *  backfill). Parser leniency only: a response that validated before parses
   *  identically, so the prompt version does not change. */
  nameTh: z.string().nullish().transform((v) => v ?? ''),
  nameEn: z.string().nullish().transform((v) => v ?? ''),
  credits: z.number().int().min(0).max(60).nullable().default(null),
  /** Defaults to UNKNOWN so a v3-era payload re-parses without inventing a
   *  หมวด. The regex fallback path never reaches this schema — it builds
   *  rows directly and carries its own explicit UNKNOWN; see
   *  FallbackCourseExtraction.category below. */
  category: CourseCategorySchema.nullish().transform((v) => v ?? 'UNKNOWN'),
});
export type ProgramCoursesExtractCourse = z.infer<typeof CourseSchema>;

export const ProgramCoursesExtractSchema = z.object({
  courses: z.array(CourseSchema).min(0),
  /** Free-form list of anything the AI couldn't extract — scan quality,
   *  missing sections, ambiguous course-list formatting. English —
   *  analysis prose, not a data label, so it is NOT on the Thai
   *  exemption list (docs/prompt-standard.md). */
  caveats: z.array(z.string()).nullish().transform((v) => v ?? []),
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
 * Slice the PDF text down to the รายวิชา (Course List) section only —
 * the structured list of every curriculum course, organised into the
 * 3 หมวด (ศึกษาทั่วไป / เฉพาะ / เลือกเสรี). Everything before the
 * section header (cover, ToC, sections 1-3.2 of มคอ.2) and everything
 * from the next major section onward (ตัวอย่างแผนการศึกษา,
 * คำอธิบายรายวิชา, ภาคผนวก) is dropped.
 *
 * Heuristics:
 *   - The section header is a numbered form like "3.3 รายวิชา" or
 *     "2.3 รายวิชา" depending on the มคอ.2 template — match
 *     `<digit>.<digit> รายวิชา` and accept the first occurrence whose
 *     trailing 400 chars contain both หมวดวิชา and a course-code
 *     pattern (the real start always opens with the GE หมวด + its
 *     first course row).
 *   - End of section = the earliest of: next "ค[ ]อธิบายรายวิชา" /
 *     "ภาคผนวก" / "Appendix" / numbered sibling header (e.g. "3.4 ").
 *   - Returns found=false when no plausible section header is locatable
 *     — the runner SKIPs rather than guessing on the full PDF.
 */
export function extractCourseListSection(text: string): {
  found: boolean;
  text: string;
  startIndex: number;
  endIndex: number;
} {
  const codeRe = courseCodeRegex();
  const subsectionRe = /หมวดวิชา/;

  // Two anchors, tried in order. STRICT is the original and is tried FIRST,
  // unchanged, so every document it already handled is untouched.
  //
  // LOOSE exists because numbering depth varies between faculties: some มคอ.2
  // head the section "3.1 รายวิชา", others scope it under a หมวด and use a
  // single level — "หมวด 3 โครงสร้างหลักสูตร … 2. รายวิชา". A survey of 27
  // programme PDFs on 2026-09-07 found 8 refusals, 3 of them purely because
  // STRICT cannot see the second form.
  //
  // LOOSE MUST NOT be merged into STRICT or tried first. Measured across all
  // 280 programme PDFs: making it primary recovered 20 documents and broke
  // 103 — because the search takes the FIRST candidate passing the trailing
  // check, and a looser anchor lets an earlier weak match shadow the real
  // section, either slicing the wrong region (88279 -> 14125 chars on
  // KKU-SEQ-0048) or landing within 500 chars of an end marker and returning
  // nothing at all. Fallback ordering is what makes this safe: it can only
  // ever turn a refusal into a find.
  const STRICT = /\d[\s.]+\d[\s.]*รายวิชา/g;
  const LOOSE = /(?<![\d.])\d{1,2}[\s.]{1,3}รายวิชา/g;

  const locate = (re: RegExp): number | null => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      const trailing = text.slice(m.index, m.index + 400);
      // The trailing check — not the numbering depth — is what rejects a
      // table-of-contents line ("2. รายวิชา 17", no หมวดวิชา, no code) and
      // keeps the slice out of the curriculum-revision appendix, whose
      // old-curriculum codes mislinked ~30 programmes before v2.3. Do not
      // weaken it to make a stubborn document parse.
      if (subsectionRe.test(trailing) && codeRe.test(trailing)) return m.index;
    }
    return null;
  };

  const endPatterns = [
    /ค[\s฿]*(?:ำ|า|ํ)[\s฿]*อธิบายรายวิชา/g, // คำอธิบายรายวิชา (with broken sara-am)
    /ภาคผนวก/g,
    /Appendix[\s:]/gi,
    /ตัวอย่างแผนการศึกษา/g, // 3.4 (comes between 3.3 and 3.5 in standard มคอ.2)
  ];

  const sliceFrom = (start: number) => {
    let end = text.length;
    for (const re of endPatterns) {
      re.lastIndex = start + 1;
      const hit = re.exec(text);
      if (hit && hit.index < end) end = hit.index;
    }
    if (end - start < 500) return null;
    return { found: true as const, text: text.slice(start, end), startIndex: start, endIndex: end };
  };

  for (const re of [STRICT, LOOSE]) {
    const start = locate(re);
    if (start === null) continue;
    const sliced = sliceFrom(start);
    if (sliced) return sliced;
  }
  return { found: false, text: '', startIndex: 0, endIndex: 0 };
}

/**
 * Deterministic pre-scan for course-code candidates in PDF text.
 * Matches the shared course-code pattern (curriculum/course-code-pattern.ts):
 *   - KKU 6-digit, with whitespace ("LW 011 116") or without ("LW011116")
 *   - KMUTT-style 3-digit ("MEE 221", "MEE221"), not followed by more digits
 * Results are whitespace-stripped and upper-cased.
 * The 2-4 letter prefix range covers every faculty we've seen (GE / LI /
 * EN / SC / MD / AG / BA / ED / HU / PH / SH / DE / TM / TS / LW / NU /
 * CE / ME / EE …). Numeric-only codes (no prefix) are not matched — rare
 * in current KKU curricula and would generate substantial false-positive
 * load.
 */
export function extractCandidateCourseCodes(text: string): string[] {
  const re = courseCodeRegex('g');
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    seen.add(m[0].replace(/\s+/g, '').toUpperCase());
  }
  return [...seen].sort();
}

export interface FallbackCourseExtraction {
  code: string;
  nameTh: string;
  nameEn: string;
  credits: number | null;
  /** Always UNKNOWN, and structurally so: this path recovers a course from
   *  a 300-char window around its code and never reads the หมวด headings,
   *  so it has no basis to place the course.
   *
   *  Consumed — program-courses-extract/run.ts writes it into the
   *  program_courses.category column on every fallback row. The field
   *  exists so that write can be explicit: downstream promotion logic
   *  reads UNKNOWN as "extracted, but the headings could not place it",
   *  which is a different state from NULL ("never category-extracted",
   *  i.e. a row from v3 or earlier that a re-run would fill). Dropping
   *  the field and letting the column default to NULL would collapse
   *  those two states. */
  category: Extract<CourseCategory, 'UNKNOWN'>;
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
  if (!/^[A-Z]{2,4}(?:\d{6}|\d{3})$/.test(code) || !isCourseCode(code)) return null;
  const prefix = /^[A-Z]+/.exec(code)![0]!;
  const digits = code.slice(prefix.length);
  const digitPat =
    digits.length === 6 ? `${digits.slice(0, 3)}\\s?${digits.slice(3)}` : `${digits}(?!\\d)(?!\\s?\\d{3})`;
  const codePat = `${prefix}\\s?${digitPat}`;
  const re = new RegExp(`\\b${codePat}(?!\\d)\\b`, 'g');

  // Credit pattern: "N (B - C - D)" with optional spaces.
  const creditRe = /(\d+)\s*\(\s*\d+\s*-\s*\d+\s*-\s*\d+\s*\)/;
  // English-name pattern: starts with a capital letter, runs until the
  // next course code or end-of-window. Tolerant to common punctuation.
  const enNameRe =
    /^\s*([A-Z][A-Za-z0-9\s,.:;'\-/&()]{2,120}?)(?=\s+[A-Z]{2,4}\s?\d{3}(?:\s?\d{3})?(?!\d)|\s{2,}|$)/;

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
  return { code, ...best, category: 'UNKNOWN', occurrenceCount };
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

  const inst = getInstitution();
  const system = `คุณเป็นผู้สกัดข้อมูล "รหัสรายวิชา" จากส่วน "รายวิชา" ของเอกสารหลักสูตร (มคอ.2) ${inst.nameTh}

★ ขอบเขต (สำคัญ) ★
ข้อความ user ที่จะให้คุณ คือ **เฉพาะส่วน "รายวิชา"** ของหลักสูตร (ตัดส่วนหน้าเอกสาร, คำอธิบายรายวิชา, และภาคผนวกทั้งหมดออกแล้ว)
ส่วนนี้แบ่งเป็น 3 หมวด:
  1. หมวดวิชาศึกษาทั่วไป
  2. หมวดวิชาเฉพาะ (อาจมีกลุ่มย่อย เช่น กลุ่มวิชาแกน, กลุ่มวิชาเฉพาะด้าน)
  3. หมวดวิชาเลือกเสรี

★ ห้ามอนุมาน, ห้ามคาดเดา ★
- ห้ามใส่รหัสวิชาที่ไม่ปรากฏในข้อความที่ให้
- ห้ามแก้รหัสวิชาให้ "ดูถูกต้องกว่า"

หน้าที่: สกัดทุกรายวิชาในทั้ง 3 หมวด พร้อมรหัส ชื่อ TH/EN และจำนวนหน่วยกิต

รูปแบบของแต่ละรายวิชาในเอกสาร:
  <รหัสวิชา> <ชื่อภาษาไทย> <ชื่อภาษาอังกฤษ> <หน่วยกิต (B-C-D)>

ปกติ ${input.levelTh} ของ ม.ขก. มี ${target} ในส่วนรายวิชา

[หมายเหตุ — pattern matching ฝั่ง runner]
runner ได้ทำ pattern matching ในส่วนเดียวกันและพบรหัส candidate ${candidateHint}
runner จะ post-process ผลลัพธ์ของคุณกับ candidate list — focus ให้สกัดครบ

COURSE CATEGORY:
Every course must carry a \`category\` naming the หมวด it sits under in the
curriculum structure:
  GENERAL_EDUCATION  หมวดวิชาศึกษาทั่วไป
  CORE               กลุ่มวิชาแกน / กลุ่มวิชาพื้นฐาน / วิชาพื้นฐานวิชาชีพ
  MAJOR_REQUIRED     วิชาเฉพาะบังคับ / วิชาชีพบังคับ / วิชาเอกบังคับ /
                     สหกิจศึกษา / การฝึกงาน
  MAJOR_ELECTIVE     วิชาเฉพาะเลือก / วิชาเอกเลือก / วิชาโท
  FREE_ELECTIVE      หมวดวิชาเลือกเสรี
  THESIS_PROJECT     วิทยานิพนธ์ / ดุษฎีนิพนธ์ / สารนิพนธ์ /
                     การศึกษาอิสระ / โครงงาน / ปัญหาพิเศษ
  UNKNOWN            the headings do not place this course

HEADING SCOPE:
A หมวด / กลุ่มวิชา heading applies to EVERY course row listed beneath it,
until the next heading of the same or higher level. Carry the current
heading down the rows — a row is NOT UNKNOWN merely because it sits far
below its heading. In a มคอ.2 one heading normally governs dozens of rows.

PRECEDENCE (headings nest — the MOST SPECIFIC heading wins):
- A course under กลุ่มวิชาแกน / กลุ่มวิชาพื้นฐาน is CORE, even though that
  group sits inside หมวดวิชาเฉพาะ. CORE beats MAJOR_REQUIRED.
- A course under วิทยานิพนธ์ / ดุษฎีนิพนธ์ / สารนิพนธ์ / การศึกษาอิสระ is
  THESIS_PROJECT whichever หมวด encloses it. THESIS_PROJECT beats its
  parent หมวด.
- MAJOR_REQUIRED is for บังคับ groups inside หมวดวิชาเฉพาะ that are NOT
  แกน / พื้นฐาน.
- กลุ่มวิชาเฉพาะด้าน follows its own บังคับ / เลือก label
  (บังคับ → MAJOR_REQUIRED, เลือก → MAJOR_ELECTIVE); when the group is
  labelled neither, return UNKNOWN — an unlabelled เฉพาะด้าน block is
  often a pick-from menu, so guessing บังคับ would be a guess in the one
  direction that corrupts this field's purpose.
- The names above classify a course ONLY when they appear as a group
  heading. A keyword occurring inside a course TITLE never overrides the
  heading its row sits under: โครงงานวิศวกรรม listed under
  กลุ่มวิชาเฉพาะบังคับ is MAJOR_REQUIRED, not THESIS_PROJECT. This applies
  to สหกิจศึกษา / การฝึกงาน / โครงงาน / ปัญหาพิเศษ especially — these are
  usually course names, not headings.

Read the category from the heading a course is listed under, not from the
course name. Almost every row in the รายวิชา section sits under a clear
หมวด heading, so UNKNOWN should be a small minority — ปกติ ไม่เกิน ~3%
ของรหัสทั้งหมด. Use it only when the headings genuinely do not place the
course; do NOT infer a category from the course title or code. A wrong
category is worse than an absent one, because downstream advice about
promoting an elective to required is built on this field.

รูปแบบ JSON ผลลัพธ์ (ออก JSON เดี่ยวเท่านั้น ห้ามมี markdown ห้ามมีคำอธิบายล่วงหน้า):
{
  "courses": [
    { "code": "<รหัสวิชาในรูปแบบไม่มีเว้นวรรค เช่น LW011116 หรือ GE179114>",
      "nameTh": "<ชื่อวิชาภาษาไทย>",
      "nameEn": "<ชื่อวิชาภาษาอังกฤษ ถ้ามี>",
      "credits": <จำนวนหน่วยกิต | null>,
      "category": "<GENERAL_EDUCATION | CORE | MAJOR_REQUIRED | MAJOR_ELECTIVE | FREE_ELECTIVE | THESIS_PROJECT | UNKNOWN>" }
  ],
  "caveats": ["<English only — e.g. unreadable page, missing course name, unusual format>"],
  "confidence": <0.0-1.0>
}

กฎรหัสวิชา:
- เก็บรหัสในรูปแบบไม่มีเว้นวรรค (เช่น "LW011116" ไม่ใช่ "LW 011 116")
- ห้ามคิดรหัสเอง ถ้ามีชื่อวิชาแต่ไม่มีรหัส ให้ข้าม
- รหัสซ้ำในเอกสารหลายที่ ให้ใส่ครั้งเดียว

LANGUAGE RULE (English-only free text):
- \`caveats\` entries MUST be written in English, even though the rest of
  this prompt (and the courses[].nameTh field) is Thai.
- courses[].nameTh / nameEn are data-label fields (course names as they
  appear in the source) — these stay in whatever language the document uses.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95.

BANNED PHRASES (do not use these words/phrases or their close paraphrases in caveats):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"

ออก JSON ตรงๆ ตัวเดียว`;

  const user = `[หลักสูตร]
รหัส: ${input.programCode}
ชื่อ: ${input.programNameTh} (${input.programNameEn})
คณะ: ${input.facultyNameTh}
ระดับ: ${input.levelTh}

[ส่วน "รายวิชา" — 3 หมวด — สกัดทุกรายวิชาในข้อความนี้]
${input.pdfText}

โปรดสกัดทุกรายวิชาตามที่อธิบายไว้ในส่วนระบบ`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - pdfText — the รายวิชา-section slice of the curriculum PDF (see
//     extractCourseListSection above). THE source for every course row;
//     there is no other channel.
//   - candidateCodes — a deterministic regex pre-scan of the SAME slice
//     (extractCandidateCourseCodes), shown as a recall hint/count, not
//     as ground truth the model must reproduce verbatim.
//   - programCode / programNameTh / programNameEn / facultyNameTh /
//     levelTh — identity context only, used to set the level-appropriate
//     expected-code-count hint (LEVEL_TARGET).
//
// Deliberately omitted, with reason:
//   - Appendices (curriculum-revision comparison, faculty teaching-load)
//     — deliberately excluded per the v2.3 finding above: the model
//     quoted stale pre-revision codes from these sections and tagged
//     them as active. Excluding the slice is the fix, not a prompt rule.
//   - คำอธิบายรายวิชา (course-description section) — duplicates the
//     course list but adds a paragraph of prose per row that bloats the
//     LLM input for no additional code-recall benefit; program-digest
//     and program-skills-detailed read descriptions separately.
//   - โครงสร้างหลักสูตร (the §3.1 curriculum-structure table: credit
//     totals per หมวด) — sits BEFORE this prompt's slice start anchor, so
//     it is structurally out of reach. The most relevant omission for
//     `category`: it states the หมวด breakdown independently, so it could
//     cross-check the per-course categories and catch a mis-carried
//     heading. Wiring it in means passing a second slice; deferred until
//     the v4 category output has been measured against real มคอ.2s.
// ─────────────────────────────────────────────────────────────────────────────
