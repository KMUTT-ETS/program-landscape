import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// program-courses-extract.v1  (2026-05-19)
//
// Focused, exhaustive course-code extractor. Distinct from the program
// digest (program-digest.v1+) which is a 15-field rich payload — that
// extractor competes for token budget between skills, narrative, and the
// course list, and tends to under-extract courses (observed: ~8 courses
// for KKU programs that actually carry 40-60+). This prompt asks for
// course codes ONLY, no descriptions/learning outcomes/skills, and asks
// for EVERY course mentioned in the curriculum's course-listing
// section(s).
//
// Cheap to run: typical output is < 1,000 tokens (just code/name/credits
// per course). Materialises directly into program_courses — no analyst
// approval gate, because the structural data is low-stakes (a wrong
// course code shows up as an empty class-offerings join and is corrected
// on the next pipeline run).
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRAM_COURSES_EXTRACT_VERSION = 'program-courses-extract.v1';

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
}

export function buildProgramCoursesExtractMessages(
  input: ProgramCoursesExtractInput,
): AiMessage[] {
  const system = `คุณเป็นผู้สกัดข้อมูล "รหัสรายวิชา" จากเอกสารหลักสูตร (มคอ.2) ของมหาวิทยาลัยขอนแก่น

หน้าที่: อ่านเอกสารหลักสูตรฉบับเต็ม แล้วสกัด **ทุกรายวิชา** ที่ปรากฏ
ในโครงสร้างหลักสูตร พร้อมรหัสวิชา ชื่อวิชา (ไทย/อังกฤษ) และจำนวนหน่วยกิต

ขอบเขตการสกัด — สกัดทุกหมวดดังต่อไปนี้:
- หมวดวิชาศึกษาทั่วไป (General Education)
- หมวดวิชาเฉพาะ (Major)
  - วิชาบังคับ (Required)
  - วิชาเลือก (Electives)
- หมวดวิชาเลือกเสรี (Free Electives) ที่หลักสูตรระบุไว้
- วิชาฝึกงาน / สหกิจศึกษา / วิทยานิพนธ์ / โครงงาน
- รายวิชาที่ระบุใน "ตัวอย่างแผนการศึกษา / แผนการเรียน"

** สำคัญที่สุด: ต้องครบทุกวิชา ห้ามตัดทอน **
- หลักสูตรปริญญาตรีมักมี 40-60 วิชา; ระดับโท/เอกมี 8-30
- ถ้าเอกสารระบุวิชามากกว่า 80 วิชา ให้สกัดทุกตัวอยู่ดี (ไม่มีเพดาน)
- ห้ามคัดเฉพาะวิชาแกน ห้ามข้าม electives

รูปแบบ JSON ผลลัพธ์ (ออก JSON เดี่ยวเท่านั้น ห้ามมี markdown ห้ามมีคำอธิบายล่วงหน้า):
{
  "courses": [
    { "code": "<รหัสวิชา เช่น EN241100 หรือ 00010101>",
      "nameTh": "<ชื่อวิชาภาษาไทย>",
      "nameEn": "<ชื่อวิชาภาษาอังกฤษ ถ้ามี>",
      "credits": <จำนวนหน่วยกิต | null> }
  ],
  "caveats": ["<ถ้ามีหน้าที่อ่านไม่ได้ หรือชื่อวิชาขาด หรือ format แปลก>"],
  "confidence": <0.0-1.0>
}

กฎรหัสวิชา:
- ให้เก็บรหัสตามที่ปรากฏในเอกสาร (อาจมีหรือไม่มีเว้นวรรค) — ระบบจะ normalise ภายหลัง
- ถ้ามีหลายเลขรุ่น (เช่น "EN 241 100 หรือ EN241100") เลือกตัวที่ครบที่สุด
- ห้ามคิดรหัสเอง ถ้ามีแต่ชื่อวิชาไม่มีรหัส ให้ข้ามวิชานั้น (อย่าเดารหัส)

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
