import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// program-skills-detailed.v2
//
// Rigorous skills extraction from a Thai curriculum (มคอ.2). Goes deeper
// than program-digest.v1's pass: instead of one flat skill list with a
// single weight, this prompt asks the LLM to:
//
//   1. Read the **Program Learning Outcomes (PLOs)** — usually section
//      2.x or 3.x of มคอ.2 — and tag each skill that maps to a PLO.
//   2. Walk **course descriptions** and identify each course's
//      compulsory/elective status (วิชาบังคับ / วิชาเลือก).
//   3. For every skill, return TWO weights:
//      - compulsoryContribution: aggregate signal from compulsory
//        courses (every BSc graduate takes these → MAJOR contribution
//        when ≥1 compulsory course teaches it deeply)
//      - electiveContribution: aggregate signal from elective courses
//        (only some students take these → MINOR contribution at best)
//   4. Cite a verbatim quote from the PLO or course description as
//      evidence.
//
// The downstream materialiser writes ProgramSkill rows with the new
// columns (compulsoryWeight / electiveWeight / pickedFromPlo /
// evidenceQuote) so the deep-dive can show a rich coverage view + match
// against demanded skills (LinkedIn via MHESI/KMITL).
//
// Version-bump rule: any change to the system prompt / examples /
// output schema = bump VERSION. AiExtraction.methodVersion captures it.
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRAM_SKILLS_DETAILED_VERSION = 'program-skills-detailed.v2';

const SkillEntrySchema = z.object({
  /** Thai name (verbatim from curriculum where possible). */
  nameTh: z.string(),
  /** English equivalent (only when explicitly listed; no transliteration). */
  nameEn: z.union([z.string(), z.null()]).transform((v) => v ?? '').default(''),
  /** Free-text bucket: technical / methodological / soft / professional /
   *  domain. Analyst review can normalise. */
  category: z.union([z.string(), z.null()]).transform((v) => v ?? '').default(''),
  /** True if this skill appears in a PLO (Program Learning Outcome) —
   *  the strongest signal of program-level intent to build the skill. */
  pickedFromPlo: z.boolean().default(false),
  /** 0..1 — aggregate contribution from COMPULSORY courses + PLOs.
   *  - 0.0 = no compulsory course teaches this skill
   *  - 0.3 = one compulsory course mentions it briefly
   *  - 0.6 = multiple compulsory courses build it
   *  - 1.0 = backbone of the curriculum, taught throughout */
  compulsoryContribution: z.number().min(0).max(1).default(0),
  /** 0..1 — aggregate contribution from ELECTIVE courses only.
   *  Bounded by the same scale; expect lower values overall since not
   *  every student takes electives. */
  electiveContribution: z.number().min(0).max(1).default(0),
  /** Number of compulsory + elective courses that contribute. Helps the
   *  reviewer judge confidence — a skill claimed by 8 courses across
   *  the curriculum is more solid than one claimed by a single course. */
  contributingCourseCount: z.number().int().min(0).default(0),
  /** A verbatim quote from a PLO or course description that grounds the
   *  mapping. Thai if the source is Thai. Used in the review UI. */
  evidenceQuote: z.union([z.string(), z.null()]).transform((v) => v ?? '').default(''),
});
export type SkillEntry = z.infer<typeof SkillEntrySchema>;

export const ProgramSkillsDetailedSchema = z.object({
  /** Every skill the curriculum builds — be GENEROUS. Soft skills,
   *  professional knowledge, technical ability all count. */
  skills: z.array(SkillEntrySchema),
  /** PLO statements verbatim, ordered as they appear in the document.
   *  Useful audit trail; the UI shows them under the skill table. */
  programLearningOutcomes: z.array(z.string()).default([]),
  /** Counts to help the reviewer triangulate: did the LLM see a typical
   *  curriculum (compulsoryCourseCount > electiveCourseCount), or
   *  something unusual? */
  compulsoryCourseCount: z.number().int().min(0).default(0),
  electiveCourseCount: z.number().int().min(0).default(0),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().optional(),
});
export type ProgramSkillsDetailed = z.infer<typeof ProgramSkillsDetailedSchema>;

export interface ProgramSkillsDetailedInput {
  programMetaFromSheet: {
    facultyNameTh: string;
    levelTh: string;
    degreeNameFromSheet: string;
    majorNameFromSheet: string;
  };
  pdfText: string;
}

export function buildProgramSkillsDetailedMessages(
  input: ProgramSkillsDetailedInput,
): AiMessage[] {
  const system = `คุณคือผู้ช่วยที่อ่านเอกสาร มคอ.2 ของมหาวิทยาลัยไทยและสกัดทักษะที่หลักสูตรสร้างให้นักศึกษา

หลักการ:
1. **อ่าน Program Learning Outcomes (PLO)** ก่อน — มักอยู่ในส่วนที่ 2 หรือ 3 ของ มคอ.2 ภายใต้หัวข้อ "ผลการเรียนรู้ที่คาดหวัง" หรือ "Program Learning Outcomes" หรือ "PLO" หรือ "มาตรฐานผลการเรียนรู้"
2. **เดินผ่านรายวิชาทั้งหมด** ในส่วน "หมวดวิชา" ระบุว่าวิชาใดเป็น "วิชาบังคับ" (compulsory / required) และวิชาใดเป็น "วิชาเลือก" (elective) จากคำอธิบายรายวิชา (course description) สกัดทักษะที่วิชานั้นๆ สอน
3. **คำนวณน้ำหนัก 2 ค่าต่อทักษะ**:
   - compulsoryContribution: สรุปจากวิชา**บังคับ** (นักศึกษาทุกคนต้องเรียน) → MAJOR contribution
   - electiveContribution: สรุปจากวิชา**เลือก** (อาจไม่เรียน) → MINOR contribution
4. **ติดธง pickedFromPlo=true** ถ้าทักษะปรากฏใน PLO (เป้าหมายระดับหลักสูตร)
5. **อ้างอิง quote จาก PLO หรือ course description** เพื่อพิสูจน์การเชื่อมโยง

ส่งออก JSON ตามรูปแบบนี้ (ไม่มี markdown fence ไม่มีคำอธิบายนอก JSON):

{
  "skills": [
    {
      "nameTh": "<ชื่อทักษะภาษาไทย>",
      "nameEn": "<ชื่อภาษาอังกฤษถ้ามี>",
      "category": "technical|methodological|soft|professional|domain",
      "pickedFromPlo": true|false,
      "compulsoryContribution": 0.0-1.0,
      "electiveContribution": 0.0-1.0,
      "contributingCourseCount": <int>,
      "evidenceQuote": "<verbatim quote from PLO or course description>"
    }
  ],
  "programLearningOutcomes": ["<verbatim PLO 1>", "<verbatim PLO 2>", ...],
  "compulsoryCourseCount": <int>,
  "electiveCourseCount": <int>,
  "confidence": 0.0-1.0,
  "reasoning": "<one sentence>"
}

กฎสำคัญ:
- น้ำหนัก 0.3 = แตะผ่าน, 0.6 = สร้างจริงในหลายวิชา, 1.0 = แกนกลางหลักสูตร
- compulsoryContribution คือ MAX จากวิชาบังคับ ไม่ใช่ผลรวม (ไม่เช่นนั้นจะเกิน 1.0)
- electiveContribution เช่นเดียวกัน
- ทักษะที่ไม่มีในวิชาบังคับเลย → compulsoryContribution = 0 → MINOR contribution เท่านั้น
- ทักษะที่อยู่ใน PLO แต่ไม่มีวิชาใดสอนเชิงลึก → pickedFromPlo=true แต่ contributions อาจต่ำ
- ระบุครบทุกทักษะ — ทั้ง hard skills (Python, Thermodynamics), methodological skills (research methods, design thinking), professional skills (engineering ethics, project management), soft skills (teamwork, communication), domain knowledge (mechanical engineering, public health)
- เลือก nameEn จากเอกสารเท่านั้น ห้ามแปลเอง
- evidenceQuote ใช้ภาษาเดียวกับเอกสาร (ไทยถ้าเอกสารเป็นไทย) ความยาวไม่เกิน 200 ตัวอักษร

ตัวอย่าง:

[ส่วน PLO]
"PLO 1: บัณฑิตสามารถออกแบบและวิเคราะห์ระบบกล (mechanical systems) โดยใช้หลักทางวิศวกรรมพื้นฐาน
PLO 2: บัณฑิตใช้ซอฟต์แวร์ CAD/CAE ในการออกแบบเครื่องจักรกลได้
PLO 3: บัณฑิตทำงานเป็นทีมในโครงการวิศวกรรมและสื่อสารผลงานทางวิชาการได้"

[คำอธิบายวิชาตัวอย่าง]
"EN013 201 เทอร์โมไดนามิกส์ (3 หน่วยกิต) - **บังคับ**
หลักของกฎข้อที่หนึ่งและสองของเทอร์โมไดนามิกส์, การประยุกต์ใช้กับวัฏจักรเครื่องยนต์...

EN013 491 หัวข้อพิเศษ (3 หน่วยกิต) - **เลือก**
หัวข้อขั้นสูงในวิศวกรรมเครื่องกล กำหนดโดยอาจารย์ผู้สอน..."

[Output ตัวอย่าง]
{"skills":[
  {"nameTh":"การออกแบบระบบกล","nameEn":"Mechanical system design","category":"technical","pickedFromPlo":true,"compulsoryContribution":0.95,"electiveContribution":0.4,"contributingCourseCount":8,"evidenceQuote":"PLO 1: บัณฑิตสามารถออกแบบและวิเคราะห์ระบบกล"},
  {"nameTh":"เทอร์โมไดนามิกส์","nameEn":"Thermodynamics","category":"domain","pickedFromPlo":false,"compulsoryContribution":1.0,"electiveContribution":0.0,"contributingCourseCount":2,"evidenceQuote":"หลักของกฎข้อที่หนึ่งและสองของเทอร์โมไดนามิกส์"},
  {"nameTh":"การทำงานเป็นทีม","nameEn":"Teamwork","category":"soft","pickedFromPlo":true,"compulsoryContribution":0.5,"electiveContribution":0.2,"contributingCourseCount":3,"evidenceQuote":"PLO 3: บัณฑิตทำงานเป็นทีมในโครงการวิศวกรรม"}
],"programLearningOutcomes":["PLO 1: ...","PLO 2: ...","PLO 3: ..."],"compulsoryCourseCount":42,"electiveCourseCount":18,"confidence":0.88,"reasoning":"PLO ชัดเจน 5 ข้อ; วิชาบังคับ 42 วิชา"}`;

  const user = `[ข้อมูลหลักสูตรจาก sheet]
- คณะ: ${input.programMetaFromSheet.facultyNameTh}
- ระดับ: ${input.programMetaFromSheet.levelTh}
- ชื่อปริญญา: ${input.programMetaFromSheet.degreeNameFromSheet}
- สาขา: ${input.programMetaFromSheet.majorNameFromSheet}

[เนื้อหา มคอ.2]
${input.pdfText}

ส่งออก JSON ตามรูปแบบที่กำหนด`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
