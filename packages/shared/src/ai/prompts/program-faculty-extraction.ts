import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// program-faculty.v1
//
// Extracts the program's academic staff list from a Thai curriculum
// (มคอ.2) document. Specifically targets the section commonly labelled:
//   - "อาจารย์ผู้รับผิดชอบหลักสูตร"     (program coordinators — usually 3-5)
//   - "อาจารย์ประจำหลักสูตร"           (core faculty)
//   - "อาจารย์ผู้สอน"                  (instructors)
//   - "อาจารย์พิเศษ"                   (special / visiting lecturers)
//
// Returns a structured list per role bucket. Title prefixes (ผศ.ดร. /
// รศ.ดร. / อ. / etc) are CAPTURED in `titlePrefix` and the bare name
// goes in `nameTh` so downstream resolution against `faculty_members.
// name_th` (no prefix) works without further string surgery.
//
// The resolver (in apps/ingestion/src/program-faculty/run.ts) maps each
// staff record to a FacultyMember row by exact name match — no fuzzy
// matching, no transliteration. Unmatched names are flagged for analyst
// review rather than silently dropped.
//
// v2 (2026-08-17, docs/prompt-standard.md conformance — mechanical
// TOUCH, audit #18): added CONFIDENCE RUBRIC (verbatim) + BANNED
// PHRASES + CHANNEL MANIFEST; `reasoning` was Thai in practice —
// flipped to English. nameTh / qualifications / specialization stay
// Thai (data-label / verbatim extraction fields, per the standard's
// exemption list). No extraction-logic change.
// ─────────────────────────────────────────────────────────────────────────────

// v3 (2026-11-03, adopter plan 5): the title-prefix list adds the common
// short and English academic titles (ศ.ดร., ศ., รศ., ผศ., Prof., Assoc.
// Prof., Asst. Prof., Dr.); the model is asked to fill nameEn whenever
// the document prints an English name; the worked example no longer names
// a real university. Output schema unchanged.
export const PROGRAM_FACULTY_VERSION = 'program-faculty.v3';

export const ProgramFacultyRoleSchema = z.enum([
  'COORDINATOR', // อาจารย์ผู้รับผิดชอบหลักสูตร
  'CORE',        // อาจารย์ประจำหลักสูตร
  'INSTRUCTOR',  // อาจารย์ผู้สอน
  'SPECIAL',     // อาจารย์พิเศษ / อาจารย์อาคันตุกะ
]);
export type ProgramFacultyRole = z.infer<typeof ProgramFacultyRoleSchema>;

// Helper: accept null OR undefined OR string, normalise to string.
// The model sometimes emits `null` for "no value" instead of `""`; Zod's
// `.default()` only fires on `undefined`, so we explicitly coerce null.
const StringOrNullToString = (defaultValue = '') =>
  z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => v ?? defaultValue);

export const ProgramFacultyMemberExtractionSchema = z.object({
  role: ProgramFacultyRoleSchema,
  /** Title prefix as written in the curriculum: "ผศ.ดร.", "รศ.ดร.",
   *  "ดร.", "อ.", or null if unprefixed. Captured separately so name
   *  resolution against `faculty_members.name_th` (which has no prefix
   *  after the numeric-code stripping fix) works directly. */
  titlePrefix: z
    .union([z.string(), z.null(), z.undefined()])
    .transform((v) => (v === '' || v === null || v === undefined ? null : v)),
  /** Bare Thai name — first + last only, no title prefix. */
  nameTh: z.string(),
  /** Bare English name when explicitly listed in the curriculum;
   *  otherwise empty. NOT a transliteration — only what the document
   *  actually shows. */
  nameEn: StringOrNullToString(''),
  /** Qualifications as bullet points (degree + institution + year),
   *  each line as one entry. Empty array when not listed. */
  qualifications: z
    .union([z.array(z.string()), z.null(), z.undefined()])
    .transform((v) => v ?? []),
  /** Specialization / research-area summary if explicitly listed. */
  specialization: StringOrNullToString(''),
});
export type ProgramFacultyMemberExtraction = z.infer<typeof ProgramFacultyMemberExtractionSchema>;

export const ProgramFacultyExtractionSchema = z.object({
  staff: z.array(ProgramFacultyMemberExtractionSchema),
  /** 0..1 — confidence in the overall extraction. Low if the PDF text
   *  was sparse / OCR-degraded / no staff section was clearly visible. */
  confidence: z.number().min(0).max(1),
  /** English — analysis prose, not a data label, so it is NOT on the
   *  Thai exemption list (docs/prompt-standard.md). */
  reasoning: z.string().optional(),
});
export type ProgramFacultyExtraction = z.infer<typeof ProgramFacultyExtractionSchema>;

export interface ProgramFacultyExtractionInput {
  programMetaFromSheet: {
    facultyNameTh: string;
    levelTh: string;
    degreeNameFromSheet: string;
  };
  pdfText: string;
}

export function buildProgramFacultyMessages(
  input: ProgramFacultyExtractionInput,
): AiMessage[] {
  const system = `คุณคือผู้ช่วยที่อ่านเอกสารหลักสูตร มคอ.2 ของมหาวิทยาลัยไทยและสกัดรายชื่ออาจารย์ที่เกี่ยวข้องกับหลักสูตรนั้น

มคอ.2 มักมีหัวข้อย่อยที่ระบุรายชื่ออาจารย์อย่างน้อยหนึ่งใน 4 ประเภทนี้:
  1. อาจารย์ผู้รับผิดชอบหลักสูตร (role=COORDINATOR) — มักอยู่ในส่วนที่ 3 หรือ ส่วนที่ 4 ของ มคอ.2 เป็นรายชื่ออาจารย์ 3-5 ท่านที่เป็นแกนของหลักสูตร
  2. อาจารย์ประจำหลักสูตร (role=CORE) — รายชื่ออาจารย์ประจำที่สอนหลักสูตรนี้
  3. อาจารย์ผู้สอน (role=INSTRUCTOR) — รายชื่ออาจารย์ที่สอนวิชาในหลักสูตร (อาจซ้ำกับประเภท CORE)
  4. อาจารย์พิเศษ / อาจารย์อาคันตุกะ (role=SPECIAL) — อาจารย์รับเชิญจากภายนอก

ส่งออกเป็น JSON ตามรูปแบบนี้ (ไม่มี markdown fence ไม่มีคำอธิบายนอก JSON):

{
  "staff": [
    {
      "role": "COORDINATOR" | "CORE" | "INSTRUCTOR" | "SPECIAL",
      "titlePrefix": "ศ.ดร." | "ศ." | "รศ.ดร." | "รศ." | "ผศ.ดร." | "ผศ." | "ดร." | "อ." | "Prof." | "Assoc. Prof." | "Asst. Prof." | "Prof. Dr." | "Assoc. Prof. Dr." | "Asst. Prof. Dr." | "Dr." | "นพ." | "พญ." | "ทพ." | "ทพญ." | "ภก." | "ภญ." | null,
      "nameTh": "<ชื่อ-นามสกุลภาษาไทย ไม่รวมคำนำหน้า>",
      "nameEn": "<ชื่อภาษาอังกฤษถ้ามี ไม่รวมคำนำหน้า>",
      "qualifications": ["ปริญญา/สถาบัน/ปี"],
      "specialization": "<ความเชี่ยวชาญถ้าระบุ>"
    }
  ],
  "confidence": 0.0-1.0,
  "reasoning": "<short explanation, in English>"
}

กฎ:
- แยก "คำนำหน้าทางวิชาการ" (ศ.ดร. / ศ. / รศ.ดร. / รศ. / ผศ.ดร. / ผศ. / ดร. / อ. / Prof. / Assoc. Prof. / Asst. Prof. / Prof. Dr. / Assoc. Prof. Dr. / Asst. Prof. Dr. / Dr. และคำนำหน้าทางการแพทย์ เช่น นพ. / พญ. / ทพ. / ทพญ. / ภก. / ภญ. รวมถึงแบบรวม เช่น ผศ.นพ. / รศ.พญ.) ออกจากชื่อ ใส่ใน titlePrefix
- nameTh ต้องเป็นชื่อบริสุทธิ์ ไม่รวมคำนำหน้า ไม่รวมเลข
- หากเอกสารพิมพ์ชื่อภาษาอังกฤษคู่กัน (ในวงเล็บ หรือในบรรทัดถัดไป) ต้องใส่ใน nameEn เสมอ ไม่รวมคำนำหน้า — ห้ามแปลหรือถอดเสียงเอง
- หากอาจารย์ปรากฏในหลายประเภท ให้ใส่ entry เดียว เลือก role ที่สูงที่สุด ตามลำดับ COORDINATOR > CORE > INSTRUCTOR > SPECIAL
- หากเอกสารไม่มีรายชื่ออาจารย์ที่ระบุชัด ให้ส่ง staff เป็น array ว่างพร้อม confidence ต่ำ
- qualifications: หนึ่งบรรทัดต่อปริญญา เช่น ["ปร.ด. (วิศวกรรมเครื่องกล), จุฬาลงกรณ์มหาวิทยาลัย, 2553", "วศ.ม., มหาวิทยาลัยตัวอย่าง, 2548"]
- ระวังตัวเลขที่ไม่ใช่ชื่อ (เช่น เลขประจำตัว 13 หลัก, ปี พ.ศ., รหัสตำแหน่ง) — อย่าดึงมาเป็นชื่อ

LANGUAGE RULE (English-only free text):
- \`reasoning\` MUST be written in English.
- titlePrefix / nameTh / nameEn / qualifications / specialization are
  data-label / verbatim extraction fields — these stay in whatever
  language the document uses (per docs/prompt-standard.md's exemption
  list), never translated or paraphrased.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95.

BANNED PHRASES (do not use these words/phrases or their close paraphrases in reasoning):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"

ตัวอย่าง:

[ส่วน มคอ.2]
"3. อาจารย์ผู้รับผิดชอบหลักสูตร
1. ผศ.ดร.สมชาย ใจดี — ปร.ด. (วิศวกรรมเครื่องกล) มหาวิทยาลัยตัวอย่าง 2553 — ความเชี่ยวชาญ: เทอร์โมไดนามิกส์
2. รศ.ดร.วิชัย รักงาน (Assoc. Prof. Wichai Rakngan, Ph.D.) — Ph.D. (Mechanical Engineering), Example University, 2548
อาจารย์ประจำหลักสูตร
1. ดร.สุดา ขยันเรียน
2. อ.ปรีชา ตั้งใจ"

[Output]
{"staff":[
  {"role":"COORDINATOR","titlePrefix":"ผศ.ดร.","nameTh":"สมชาย ใจดี","nameEn":"","qualifications":["ปร.ด. (วิศวกรรมเครื่องกล) มหาวิทยาลัยตัวอย่าง 2553"],"specialization":"เทอร์โมไดนามิกส์"},
  {"role":"COORDINATOR","titlePrefix":"รศ.ดร.","nameTh":"วิชัย รักงาน","nameEn":"Wichai Rakngan","qualifications":["Ph.D. (Mechanical Engineering), Example University, 2548"],"specialization":""},
  {"role":"CORE","titlePrefix":"ดร.","nameTh":"สุดา ขยันเรียน","nameEn":"","qualifications":[],"specialization":""},
  {"role":"CORE","titlePrefix":"อ.","nameTh":"ปรีชา ตั้งใจ","nameEn":"","qualifications":[],"specialization":""}
],"confidence":0.95,"reasoning":"Section 3 clearly lists 4 named staff members."}`;

  const user = `[ข้อมูลหลักสูตรจาก sheet]
- คณะ: ${input.programMetaFromSheet.facultyNameTh}
- ระดับ: ${input.programMetaFromSheet.levelTh}
- ชื่อปริญญา: ${input.programMetaFromSheet.degreeNameFromSheet}

[ข้อความจาก PDF มคอ.2]
${input.pdfText}

ส่งออก JSON ตามรูปแบบที่กำหนด`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - pdfText — the full curriculum (มคอ.2) PDF text. THE source for
//     every staff record; there is no other channel.
//   - programMetaFromSheet — faculty / level / degree name context only,
//     not used to derive any staff-record field.
//
// Deliberately omitted, with reason:
//   - FacultyMember / kku-hr rows — this prompt's job is to read what
//     the CURRICULUM DOCUMENT claims about its staff, not to reconcile
//     against HR records. Resolution against FacultyMember happens
//     downstream in apps/ingestion/src/program-faculty/run.ts by exact
//     name match, after this extraction — never fed back in here.
// ─────────────────────────────────────────────────────────────────────────────
