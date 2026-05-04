import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// career-kmitl-mapping.v1
//
// Maps a program's free-text career list (e.g., "วิศวกรเครื่องกลในโรงงาน
// อุตสาหกรรม", "ผู้ประกอบการนวัตกรรม") to KMITL career taxonomy IDs so the
// deep-dive skills section can filter labour-market demand to the careers
// the program actually targets — instead of generic top-10 across all
// careers.
//
// Per program-career, the LLM may map to:
//   - 1 KMITL career id (most common)
//   - multiple KMITL ids (e.g., "Power & Renewable Energy Engineer" maps
//     to KMITL "Power Engineer" + "Power Plant Engineer" + "Renewable
//     Energy Engineer")
//   - empty array → KMITL doesn't have a relevant entry; the downstream
//     pipeline routes that career to external Gemini-grounded search
//
// Single batched call. Input is the FULL KMITL career list (~400 rows ×
// ~50 chars = ~20K tokens). Output is the mapping. Cost ~$0.01-0.03 per
// program depending on careers count.
// ─────────────────────────────────────────────────────────────────────────────

export const CAREER_KMITL_MAPPING_VERSION = 'career-kmitl-mapping.v1';

export const CareerKmitlMappingSchema = z.object({
  mappings: z.array(
    z.object({
      careerLabel: z.string(),
      kmitlCareerIds: z.array(z.number().int()),
      reasoning: z
        .union([z.string(), z.null()])
        .transform((v) => v ?? '')
        .default(''),
      noKmitlMatch: z.boolean().default(false),
    }),
  ),
  confidence: z.number().min(0).max(1),
});
export type CareerKmitlMapping = z.infer<typeof CareerKmitlMappingSchema>;

export interface CareerKmitlMappingInput {
  programDegree: string;
  programFaculty: string;
  programCareers: string[];
  /** Full KMITL career taxonomy: id, name, group, sub-group. */
  kmitlCareers: Array<{
    id: number;
    name: string;
    group: string;
    subGroup: string;
  }>;
}

export function buildCareerKmitlMappingMessages(input: CareerKmitlMappingInput): AiMessage[] {
  const system = `คุณคือผู้ช่วยที่จับคู่อาชีพที่บัณฑิตของหลักสูตรไทยจะประกอบได้ กับ "อาชีพ" ในชุดข้อมูล KMITL Career Taxonomy ซึ่งเป็นรายการอาชีพมาตรฐานที่ใช้ในระบบวิเคราะห์ตลาดแรงงาน

อาชีพ KMITL จัดตามโครงสร้าง: Group > Sub-group > Career

ส่งออก JSON ตามรูปแบบนี้ (ไม่มี markdown fence ไม่มีคำอธิบายนอก JSON):

{
  "mappings": [
    {
      "careerLabel": "<อาชีพจาก program (verbatim)>",
      "kmitlCareerIds": [<number>, <number>, ...],
      "reasoning": "<หนึ่งประโยคอธิบายว่าทำไมเลือก KMITL careers เหล่านี้>",
      "noKmitlMatch": false
    }
  ],
  "confidence": 0.0-1.0
}

กฎ:
1. **mappings array ต้องครบทุก careerLabel ใน input** — ห้ามข้าม
2. แต่ละ careerLabel เลือก KMITL careers ที่เป็น "core match" (ความหมายตรงหรือใกล้เคียง) — ปกติ 1-3 ids
3. หาก KMITL ไม่มีอาชีพที่เกี่ยวข้องเลย ให้ตั้ง kmitlCareerIds = [] และ noKmitlMatch = true เช่น
   - "ผู้ประกอบการนวัตกรรม" → KMITL ไม่มีหมวด Entrepreneur → []
   - "อาจารย์มหาวิทยาลัย" → KMITL ไม่มีหมวด Academic → []
4. ห้ามจับคู่หลวมๆ — ถ้า "วิศวกรยานยนต์" ไม่มีใน KMITL ก็ไม่จับ ไม่ลาก "Mechanical Engineer" มาแทน
5. confidence ระดับ overall ของการจับคู่ทั้งชุด

ตัวอย่าง:

[program careers]
1. วิศวกรเครื่องกลในโรงงานอุตสาหกรรม
2. วิศวกรในอุตสาหกรรมการผลิตไฟฟ้าและพลังงานทดแทน
3. นักวิจัยและพัฒนาด้านหุ่นยนต์
4. ผู้ประกอบการนวัตกรรม

[KMITL careers (เฉพาะที่เกี่ยวข้อง)]
312: Mechanical Design Engineer (Engineer / Mechanic)
313: Mechanical Engineer (Engineer / Mechanic)
314: Mechanical Project Engineer (Engineer / Mechanic)
303: Power Engineer (Engineer / Electrical)
304: Power Plant Engineer (Engineer / Electrical)
305: Renewable Energy Engineer (Engineer / Electrical)
291: Robotics Engineer (Engineer / AI)
443: Automation Engineer (Engineer / Industrial)

[Output]
{"mappings":[
  {"careerLabel":"วิศวกรเครื่องกลในโรงงานอุตสาหกรรม","kmitlCareerIds":[312,313,314],"reasoning":"Direct match to all three Mechanic-subgroup careers","noKmitlMatch":false},
  {"careerLabel":"วิศวกรในอุตสาหกรรมการผลิตไฟฟ้าและพลังงานทดแทน","kmitlCareerIds":[303,304,305],"reasoning":"Power Engineer + Power Plant + Renewable cover both fossil and renewable energy","noKmitlMatch":false},
  {"careerLabel":"นักวิจัยและพัฒนาด้านหุ่นยนต์","kmitlCareerIds":[291,443],"reasoning":"Robotics Engineer is direct match; Automation Engineer for adjacent industrial automation","noKmitlMatch":false},
  {"careerLabel":"ผู้ประกอบการนวัตกรรม","kmitlCareerIds":[],"reasoning":"KMITL taxonomy has no Entrepreneur category — route to external grounded search","noKmitlMatch":true}
],"confidence":0.92}`;

  const careersBlock = input.programCareers.map((c, i) => `${i + 1}. ${c}`).join('\n');
  const kmitlBlock = input.kmitlCareers
    .map((k) => `${k.id}: ${k.name} (${k.group} / ${k.subGroup})`)
    .join('\n');

  const user = `[หลักสูตร]
ชื่อปริญญา: ${input.programDegree}
คณะ: ${input.programFaculty}

[Program careers (${input.programCareers.length})]
${careersBlock}

[KMITL career taxonomy (${input.kmitlCareers.length})]
${kmitlBlock}

ส่งออก JSON ตามรูปแบบที่กำหนด`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
