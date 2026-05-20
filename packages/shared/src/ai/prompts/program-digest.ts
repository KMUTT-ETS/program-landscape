import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// program-digest.v2
//
// One-shot full-PDF digest of a Thai university curriculum (มคอ.2 form
// or equivalent). Returns structured Thai-primary output covering:
//   1. Program metadata (degree name + abbrev TH/EN, total credits,
//      duration, language)
//   2. Course list (code, name TH/EN, credits, description TH)
//   3. The distinct skills the program builds — generalised, ESCO-style
//      actionable phrases split into technical / cognitive, with weights
//      and verbatim evidence quotes
//   4. Marketing-ready Thai recruitment summary (200-400 words) — the
//      net-new content the platform doesn't currently produce
//   5. Career paths graduates can pursue
//
// Skill resolution against our `Skill` taxonomy is deliberately deferred —
// the LLM emits canonical, generalised skill phrases (English-primary);
// materialiseProgramDigest() does the taxonomy lookup post-hoc and
// records unmatched names as PROPOSED_SKILL extractions.
//
// Version bumping rule: any change to system prompt / examples / output
// schema → bump VERSION. AiExtraction.methodVersion captures it so old
// extractions remain readable, and a re-digest lands as a new
// AiExtraction row alongside the prior one (full audit).
//
// v2 (2026-05-20): skill extraction reworked — generalised, English-
// primary actionable phrases (was verbatim curriculum fragments), 2
// categories (technical / cognitive, was a 5-value free-text bucket),
// deduplicated, and scoped to objectives + PLOs + course descriptions.
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRAM_DIGEST_VERSION = 'program-digest.v2';

const ProgramSkillExtractionSchema = z.object({
  // Thai rendering of the canonical skill.
  nameTh: z.string(),
  // Canonical English skill name — a concise, actionable noun phrase in
  // ESCO style (e.g. "Financial Statement Preparation", "Critical
  // Thinking"). This is the PRIMARY key the taxonomy match runs against,
  // so it must be a generalised competency label, never a verbatim
  // sentence fragment lifted from the curriculum.
  nameEn: z.string().default(''),
  // Two values only: 'technical' (domain-specific hard skills, tools,
  // methods, standards, software, compliance frameworks) or 'cognitive'
  // (mental + interpersonal competencies — analytical/critical thinking,
  // problem solving, decision making, communication, teamwork).
  category: z.string().default('technical'),
  // 0..1 — how central the skill is to the program. 1 = backbone of the
  // curriculum (e.g. "structural design" for Civil Engineering); 0.2 =
  // briefly introduced.
  weight: z.number().min(0).max(1),
  // A short verbatim quote from the curriculum that grounds this skill.
  // Thai if the source is Thai. The NAME is generalised; the QUOTE is not.
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
  // Distinct, generalised skills drawn from the program objectives,
  // PLOs, and course descriptions. Deduplicated — one canonical entry
  // per competency, not one per course. Taxonomy mapping happens
  // post-hoc in materialiseProgramDigest().
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
  // Live system grounding — pulled by the caller from DS2004 / DS2003 /
  // DS1001 / kku-hr. When present, the LLM treats these as factual
  // anchors that override anything the PDF says about staff counts,
  // student enrolment, or faculty composition. The recruitment summary
  // is also told NOT to invent stats — only mention the numbers below.
  systemContext?: ProgramSystemFacts;
}

export interface ProgramSystemFacts {
  staffTotal: number;
  staffByTeachType: { type1: number; type2: number; type3: number };
  staffByRank: { lecturer: number; asstProf: number; assocProf: number; prof: number; unranked: number };
  staffEducationOrigin: { thai: number; international: number; unknown: number };
  internationalCountriesTop: Array<{ country: string; count: number }>;
  studentTotal: number;
  studentByGender: { male: number; female: number; other: number };
  studentByNationality: { thai: number; foreign: number };
  studentAdmitYearRange: { earliest: number | null; latest: number | null };
  studentGpaAvg: number | null;
}

export function buildProgramDigestMessages(input: ProgramDigestInput): AiMessage[] {
  const meta = input.programMetaFromSheet;
  const maxCourses = input.maxCourses ?? 80;

  const system = `คุณเป็นผู้เชี่ยวชาญด้านการวิเคราะห์หลักสูตรอุดมศึกษาไทย (มคอ.2) ของมหาวิทยาลัยขอนแก่น และผู้เชี่ยวชาญด้านการพัฒนากำลังคน (workforce development)

หน้าที่: อ่านหลักสูตรฉบับเต็ม แล้วสกัดข้อมูลออกมาเป็น JSON ที่ถูกต้องตามโครงสร้างที่กำหนด

เนื้อหาผลลัพธ์ทั้งหมดต้องเป็นภาษาไทยเป็นหลัก ยกเว้นชื่อภาษาอังกฤษของหลักสูตร/รายวิชา และชื่อทักษะภาษาอังกฤษ (nameEn) ที่ต้องระบุเป็นภาษาอังกฤษมาตรฐานเสมอ

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
    { "nameEn": "<ชื่อทักษะภาษาอังกฤษ — วลีคำนามกระชับสไตล์ ESCO>",
      "nameTh": "<ทักษะเดียวกันในภาษาไทย>",
      "category": "technical" | "cognitive",
      "weight": <0.0-1.0>, "evidenceQuote": "<ข้อความ verbatim สั้นจากหลักสูตรที่อ้างอิง>" }
  ],
  "recruitmentSummaryTh": "<บทแนะนำหลักสูตรสำหรับนักเรียนที่สนใจสมัครเรียน 200-400 คำ>",
  "careerPathsTh": ["<อาชีพ 1>", "<อาชีพ 2>", ...],
  "confidence": <0.0-1.0>,
  "caveats": ["<สิ่งที่ไม่สามารถสกัดได้จากเอกสาร 1>", ...]
}

กฎสำคัญ:
1. **ทักษะ (extractedSkills)**: สกัดทักษะที่หลักสูตรสร้างให้บัณฑิต โดยพิจารณา "เฉพาะ" 3 ส่วนนี้ของเอกสารเท่านั้น — (ก) วัตถุประสงค์ของหลักสูตร (ข) ผลลัพธ์การเรียนรู้ที่คาดหวังของหลักสูตร (PLO / ELO) (ค) คำอธิบายรายวิชา
   จัดทักษะเป็น 2 ประเภทเท่านั้น (ค่า category):
   - **technical** = ทักษะเฉพาะทาง เครื่องมือ วิธีการ มาตรฐาน ซอฟต์แวร์ กรอบวิชาชีพ/การกำกับ
   - **cognitive** = กระบวนการทางความคิดและทักษะระหว่างบุคคล เช่น การคิดวิเคราะห์ การคิดเชิงวิพากษ์ การตัดสินใจ การแก้ปัญหาเชิงระบบ การวางแผนเชิงกลยุทธ์ การเรียนรู้ด้วยตนเอง การทำงานเป็นทีม การสื่อสาร
2. **รูปแบบชื่อทักษะ**: ห้ามคัดลอกข้อความดิบจากเอกสารมาเป็นชื่อทักษะ — ให้ "สรุปและจัดเป็นวลีทักษะที่กระชับและเป็นรูปธรรม"
   - \`nameEn\` คือคีย์หลัก ต้องระบุเสมอ ห้ามเว้นว่าง — เป็นวลีคำนามภาษาอังกฤษมาตรฐานสไตล์ ESCO (เช่น "Financial Statement Preparation", "Systemic Problem Solving", "Critical Thinking")
   - \`nameTh\` คือทักษะเดียวกันในภาษาไทย
   - ห้ามกุทักษะที่เอกสารไม่ได้กล่าวถึงเลย — ต้องอ้างอิงเนื้อหาจริง แต่อนุญาตให้สรุปและจัดหมวดได้
   - ห้ามรายการซ้ำ — ถ้าทักษะแกนเดียวกันปรากฏหลายรายวิชา ให้รวมเป็นทักษะเดียว ไม่ต้องแยกเป็นหลายรายการ
   - หลังจากรวมและสรุปแล้ว โดยทั่วไปจะได้ทักษะที่แตกต่างกันประมาณ 10-30 รายการ — ไม่ต้องเพิ่มจำนวนเกินจำเป็น
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

  const systemFactsBlock = buildSystemFactsBlock(input.systemContext);

  const user = `${sheetMeta}${systemFactsBlock}

[เอกสารหลักสูตรฉบับเต็ม - มคอ.2]
${input.pdfText}

โปรดวิเคราะห์ และส่งผลลัพธ์เป็น JSON ตามโครงสร้างที่กำหนด`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// Live grounding facts injected from DS2004 / DS2003 / DS1001 / kku-hr.
// The LLM is instructed to TRUST these over anything the PDF says.
function buildSystemFactsBlock(ctx: ProgramSystemFacts | undefined): string {
  if (!ctx) return '';

  const lines: string[] = [];
  lines.push('');
  lines.push('[ข้อเท็จจริงจริงปัจจุบัน — ดึงจากระบบ MHESI/UNICON + HR ของ มข.]');
  lines.push(
    'ให้ใช้ตัวเลขในส่วนนี้เป็น "ข้อเท็จจริง" สำหรับ recruitmentSummaryTh และ caveats',
  );
  lines.push('— ห้าม "นักศึกษา 200+ คน" หรือ "อาจารย์ผู้ทรงคุณวุฒิจำนวนมาก" ถ้าตัวเลขจริงไม่สอดคล้อง');
  lines.push('— เมื่อ PDF ระบุตัวเลขที่ขัดกับด้านล่าง ให้บันทึกใน caveats แทนที่จะใช้ใน summary');
  lines.push('');

  // Staff
  if (ctx.staffTotal > 0) {
    const r = ctx.staffByRank;
    const ranks: string[] = [];
    if (r.prof) ranks.push(`ศ. ${r.prof}`);
    if (r.assocProf) ranks.push(`รศ. ${r.assocProf}`);
    if (r.asstProf) ranks.push(`ผศ. ${r.asstProf}`);
    if (r.lecturer) ranks.push(`อ. ${r.lecturer}`);
    if (r.unranked) ranks.push(`ไม่ระบุ ${r.unranked}`);
    lines.push(`อาจารย์ปัจจุบันที่สังกัดหลักสูตรนี้ (DS2004): ${ctx.staffTotal} คน`);
    if (ranks.length) lines.push(`  • แยกตามตำแหน่ง: ${ranks.join(' / ')}`);
    lines.push(
      `  • บทบาทในหลักสูตร — ผู้รับผิดชอบ: ${ctx.staffByTeachType.type3} · ประจำหลักสูตร: ${ctx.staffByTeachType.type2} · ประจำ: ${ctx.staffByTeachType.type1}`,
    );

    const intl = ctx.staffEducationOrigin.international;
    const thai = ctx.staffEducationOrigin.thai;
    if (intl + thai > 0) {
      const intlPct = Math.round((intl / (intl + thai)) * 100);
      lines.push(`  • วุฒิการศึกษาสูงสุด: จบจากต่างประเทศ ${intl}/${intl + thai} (${intlPct}%)`);
      if (ctx.internationalCountriesTop.length) {
        const tops = ctx.internationalCountriesTop
          .map((c) => `${c.country} ${c.count}`)
          .join(', ');
        lines.push(`  • ประเทศต้นทางการศึกษา (ต่างประเทศ): ${tops}`);
      }
    }
  } else {
    lines.push('อาจารย์ปัจจุบันที่สังกัดหลักสูตรนี้ (DS2004): ไม่มีข้อมูล');
  }

  // Students
  if (ctx.studentTotal > 0) {
    lines.push(`นักศึกษาปัจจุบันที่ลงทะเบียน (DS1001): ${ctx.studentTotal} คน`);
    const g = ctx.studentByGender;
    if (g.male + g.female > 0) {
      lines.push(`  • เพศ: ชาย ${g.male} / หญิง ${g.female}${g.other ? ` / อื่นๆ ${g.other}` : ''}`);
    }
    const n = ctx.studentByNationality;
    if (n.foreign > 0) {
      lines.push(`  • สัญชาติ: ไทย ${n.thai} / ต่างชาติ ${n.foreign}`);
    }
    const ay = ctx.studentAdmitYearRange;
    if (ay.earliest && ay.latest) {
      lines.push(`  • ปีที่เข้าศึกษา: ${ay.earliest}-${ay.latest} (พ.ศ.)`);
    }
    if (ctx.studentGpaAvg !== null) {
      lines.push(`  • GPA สะสมเฉลี่ย: ${ctx.studentGpaAvg.toFixed(2)}`);
    }
  } else {
    lines.push('นักศึกษาปัจจุบันที่ลงทะเบียน (DS1001): ไม่มีข้อมูล');
  }

  return '\n' + lines.join('\n');
}
