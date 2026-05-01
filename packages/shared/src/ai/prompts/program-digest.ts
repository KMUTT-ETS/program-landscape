import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// program-digest.v1
//
// One-shot full-PDF digest of a Thai university curriculum (มคอ.2 form
// or equivalent). Returns structured Thai-primary output covering:
//   1. Program metadata (degree name + abbrev TH/EN, total credits,
//      duration, language)
//   2. Course list (code, name TH/EN, credits, description TH)
//   3. ALL skills built by the program (technical / methodological /
//      soft) with weights and supporting evidence quotes
//   4. Marketing-ready Thai recruitment summary (200-400 words) — the
//      net-new content the platform doesn't currently produce
//   5. Career paths graduates can pursue
//
// Skill resolution against our `Skill` taxonomy is deliberately deferred —
// the LLM extracts free-text Thai/English skill names; the script that
// invokes this prompt does the lookup post-hoc and stamps each skill
// with status='matched' | 'proposed' before persisting AiExtraction.
//
// Version bumping rule: any change to system prompt / examples / output
// schema → bump VERSION. AiExtraction.methodVersion captures it so old
// extractions remain readable, and a re-digest with v2 lands as a new
// AiExtraction row alongside the v1 one (full audit).
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRAM_DIGEST_VERSION = 'program-digest.v1';

const ProgramSkillExtractionSchema = z.object({
  // Thai-primary skill name (verbatim from curriculum where possible).
  nameTh: z.string(),
  // English equivalent (if explicitly given in the curriculum, otherwise
  // best-effort transliteration / translation; OK if blank for soft skills).
  nameEn: z.string().default(''),
  // High-level bucket: technical / methodological / soft / professional /
  // domain. Free-text — analyst review will normalise.
  category: z.string().default(''),
  // 0..1 — central a skill is to the program. 1 = backbone of curriculum
  // (e.g., "structural design" for a Civil Engineering program). 0.2 =
  // briefly introduced.
  weight: z.number().min(0).max(1),
  // A short verbatim quote from the curriculum that justifies this skill.
  // Thai if the source is Thai. Used in the review UI to ground the LLM.
  evidenceQuote: z.string(),
});
export type ProgramSkillExtraction = z.infer<typeof ProgramSkillExtractionSchema>;

const ProgramCourseExtractionSchema = z.object({
  code: z.string().default(''),         // e.g., "EN013 201" — empty if not present
  nameTh: z.string(),
  nameEn: z.string().default(''),
  credits: z.number().nullable().default(null),
  descriptionTh: z.string().default(''),
  // คำอธิบายรายวิชา / Learning outcomes — bullet points if available.
  learningOutcomesTh: z.array(z.string()).default([]),
});
export type ProgramCourseExtraction = z.infer<typeof ProgramCourseExtractionSchema>;

export const ProgramDigestSchema = z.object({
  // ── Program-level metadata ──────────────────────────────────────────
  programNameTh: z.string(),
  programNameEn: z.string().default(''),
  degreeNameTh: z.string().default(''),     // e.g., "วิศวกรรมศาสตรบัณฑิต (วิศวกรรมระบบอิเล็กทรอนิกส์)"
  degreeNameEn: z.string().default(''),     // e.g., "Bachelor of Engineering (Electronic Systems)"
  degreeAbbrTh: z.string().default(''),     // e.g., "วศ.บ. (วิศวกรรมระบบอิเล็กทรอนิกส์)"
  degreeAbbrEn: z.string().default(''),     // e.g., "B.Eng. (Electronic Systems)"
  totalCredits: z.number().nullable().default(null),
  durationYears: z.number().nullable().default(null),
  language: z.enum(['TH', 'EN', 'MIXED']).default('TH'),

  // ── Curriculum content ──────────────────────────────────────────────
  courses: z.array(ProgramCourseExtractionSchema).default([]),

  // ── Skills graduates build (THE supply side) ────────────────────────
  // Extract EVERY skill the curriculum implies — be generous. Soft
  // skills, professional knowledge, technical ability all count.
  // Skill-taxonomy mapping happens after this output, in the script.
  extractedSkills: z.array(ProgramSkillExtractionSchema).default([]),

  // ── Recruitment narrative (Thai-primary, 200-400 words) ─────────────
  // Aimed at prospective students. Marketing tone but factually
  // grounded. Cover: what the program is about, what makes it
  // distinctive at KKU, what graduates can do, why a student should
  // choose it. Avoid superlatives, brand puffery, comparative claims
  // ("the best in Thailand"). One paragraph or 2-3 short paragraphs.
  recruitmentSummaryTh: z.string(),

  // ── Career paths ────────────────────────────────────────────────────
  // Roles / professions a graduate can plausibly pursue. Thai labels.
  careerPathsTh: z.array(z.string()).default([]),

  // ── Self-rated quality + caveats ────────────────────────────────────
  // 0..1 — how confidently the LLM read the curriculum. Lower when the
  // PDF is mostly scanned, terse, or in a non-standard format.
  confidence: z.number().min(0).max(1),
  // Anything the digester couldn't determine, surface here so reviewers
  // know what to fill in manually.
  caveats: z.array(z.string()).default([]),
});
export type ProgramDigest = z.infer<typeof ProgramDigestSchema>;

export interface ProgramDigestInput {
  // From the master sheet — used as ground truth to anchor the digest.
  // The LLM should NOT contradict these unless the PDF strongly
  // disagrees (in which case it surfaces the contradiction in caveats).
  programMetaFromSheet: {
    facultyNameTh: string;
    levelTh: string;          // 'ป.ตรี' | 'ป.โท' | 'ป.เอก' | 'ป.บัณฑิตชั้นสูง'
    degreeNameFromSheet: string;
    majorNameFromSheet: string;
    curriculumYearBe: number | null;
    mhesiCode: string | null;
  };
  // Full extracted PDF text. We feed it whole — Gemini handles the
  // 30-150k tokens of a typical มคอ.2 in one prompt cleanly.
  pdfText: string;
  // Soft cap on courses to enumerate. Some PDFs list 60+ courses;
  // truncating keeps token cost bounded. Default 80, override per-call.
  maxCourses?: number;
}

export function buildProgramDigestMessages(input: ProgramDigestInput): AiMessage[] {
  const meta = input.programMetaFromSheet;
  const maxCourses = input.maxCourses ?? 80;

  const system = `คุณเป็นผู้เชี่ยวชาญด้านการวิเคราะห์หลักสูตรอุดมศึกษาไทย (มคอ.2) ของมหาวิทยาลัยขอนแก่น

หน้าที่: อ่านหลักสูตรฉบับเต็ม แล้วสกัดข้อมูลออกมาเป็น JSON ที่ถูกต้องตามโครงสร้างที่กำหนด

เนื้อหาผลลัพธ์ทั้งหมดต้องเป็นภาษาไทยเป็นหลัก ยกเว้นชื่อภาษาอังกฤษของหลักสูตร/รายวิชา/ทักษะที่ปรากฏในเอกสารต้นฉบับ

โครงสร้าง JSON (ออกตรงนี้เท่านั้น ห้ามมี markdown หรือคำอธิบายเพิ่มเติม):
{
  "programNameTh": "<ชื่อหลักสูตรภาษาไทย>",
  "programNameEn": "<ชื่อหลักสูตรภาษาอังกฤษ>",
  "degreeNameTh": "<ชื่อปริญญาเต็มภาษาไทย>",
  "degreeNameEn": "<ชื่อปริญญาเต็มภาษาอังกฤษ>",
  "degreeAbbrTh": "<ตัวย่อปริญญาภาษาไทย เช่น วศ.บ. หรือ ปร.ด.>",
  "degreeAbbrEn": "<ตัวย่อปริญญาภาษาอังกฤษ เช่น B.Eng. หรือ Ph.D.>",
  "totalCredits": <จำนวนหน่วยกิตรวม | null>,
  "durationYears": <ระยะเวลาการศึกษา ปี | null>,
  "language": "TH" | "EN" | "MIXED",
  "courses": [
    { "code": "<รหัสวิชา>", "nameTh": "<ชื่อวิชาไทย>", "nameEn": "<ชื่อวิชาอังกฤษ>",
      "credits": <จำนวนหน่วยกิต | null>, "descriptionTh": "<คำอธิบายรายวิชาภาษาไทย>",
      "learningOutcomesTh": ["<ผลการเรียนรู้/วัตถุประสงค์>", ...] }
  ],
  "extractedSkills": [
    { "nameTh": "<ทักษะภาษาไทย>", "nameEn": "<ทักษะภาษาอังกฤษ>",
      "category": "technical|methodological|soft|professional|domain",
      "weight": <0.0-1.0>, "evidenceQuote": "<ข้อความสั้นจากหลักสูตรที่อ้างอิง>" }
  ],
  "recruitmentSummaryTh": "<บทแนะนำหลักสูตรสำหรับนักเรียนที่สนใจสมัครเรียน 200-400 คำ>",
  "careerPathsTh": ["<อาชีพ 1>", "<อาชีพ 2>", ...],
  "confidence": <0.0-1.0>,
  "caveats": ["<สิ่งที่ไม่สามารถสกัดได้จากเอกสาร 1>", ...]
}

กฎสำคัญ:
1. **ทักษะ**: สกัดทักษะ "ทุกทักษะ" ที่หลักสูตรสร้างให้บัณฑิต ไม่ว่าจะเป็นทักษะเฉพาะทาง (technical), วิธีคิด/วิจัย (methodological), ทักษะการทำงาน (soft), ความรู้วิชาชีพ (professional), หรือความเข้าใจในสาขา (domain) — รวมแล้วควรมี 15-40 ทักษะ ขึ้นกับขนาดหลักสูตร
2. **ชื่อทักษะ**: ใช้คำที่อยู่ในเอกสารต้นฉบับ ห้ามคิดคำใหม่หรือใช้ jargon ที่ไม่ปรากฏในเอกสาร
3. **น้ำหนัก (weight)**: 1.0 = ทักษะแกนของหลักสูตร, 0.6-0.8 = หลักสูตรสร้างชัดเจนแต่ไม่ใช่จุดเน้น, 0.2-0.4 = แตะ-แต่ไม่ลึก
4. **Evidence quote**: ต้องเป็นข้อความ "verbatim" จากเอกสาร — ไม่สรุป ไม่แปล (ถ้าเอกสารเป็นภาษาไทย ก็เป็นภาษาไทย)
5. **รายวิชา**: ใส่ทุกวิชาที่ระบุใน "ข้อ 3.1.3" / "หมวดวิชาเฉพาะ" / โครงสร้างหลักสูตร — ถ้ามีมากกว่า ${maxCourses} วิชา ให้เลือกวิชาแกน + วิชาเอกของสาขา
6. **บทแนะนำหลักสูตร (recruitmentSummaryTh)**:
   - 200-400 คำ ภาษาไทย
   - ผู้รับสาร: นักเรียน ม.6 / ผู้สนใจสมัครเรียน
   - ครอบคลุม: หลักสูตรนี้คืออะไร, ความโดดเด่น, สิ่งที่นักศึกษาจะได้เรียนรู้, อาชีพที่ทำได้หลังจบ, ทำไมจึงน่าสนใจ
   - ห้าม: ใช้คำเกินจริง ("ดีที่สุดในประเทศ"), เปรียบเทียบกับสถาบันอื่น, ใช้ภาษา marketing ที่ฟ้องเสียงปลอม
   - น้ำเสียง: ชัดเจน เป็นมิตร น่าเชื่อถือ
7. **Caveats**: ระบุทุกประเด็นที่เอกสารไม่ชัดเจน (เช่น ไม่พบจำนวนหน่วยกิต, สแกนคุณภาพต่ำในบางหน้า, ภาษาผสม) เพื่อให้ผู้ตรวจทราบ
8. **Confidence**: ต่ำลง (0.4-0.7) เมื่อเอกสารไม่ครบหรือสแกนคุณภาพต่ำ; สูง (0.85+) เมื่อเอกสาร format ปกติและครบถ้วน

ออก JSON ตรงๆ ไม่มี markdown fences ไม่มีคำอธิบายล่วงหน้า

สำคัญมาก: ตอบกลับเป็น JSON object เดี่ยว ({...}) ไม่ใช่ array ([...]) ห้ามห่อในวงเล็บเหลี่ยม`;

  const sheetMeta = `[ข้อมูลจากตารางหลักสูตรหลัก สจล./KKU - ใช้เป็นฐานข้อมูลในการตรวจสอบ]
- คณะ: ${meta.facultyNameTh}
- ระดับ: ${meta.levelTh}
- ชื่อปริญญา: ${meta.degreeNameFromSheet}
- ชื่อสาขา: ${meta.majorNameFromSheet}
- ปีหลักสูตร (พ.ศ.): ${meta.curriculumYearBe ?? 'ไม่ระบุ'}
- รหัสหลักสูตร อว.: ${meta.mhesiCode ?? 'ไม่ระบุ'}`;

  const user = `${sheetMeta}

[เอกสารหลักสูตรฉบับเต็ม - มคอ.2]
${input.pdfText}

โปรดวิเคราะห์ และส่งผลลัพธ์เป็น JSON ตามโครงสร้างที่กำหนด`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
