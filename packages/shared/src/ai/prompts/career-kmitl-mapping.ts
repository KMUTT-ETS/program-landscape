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
//
// v2 (2026-08-17, docs/prompt-standard.md conformance — mechanical
// TOUCH, audit #24): added CONFIDENCE RUBRIC (verbatim) + BANNED
// PHRASES + CHANNEL MANIFEST; `reasoning` was Thai in practice —
// flipped to English. `careerLabel` stays Thai (verbatim echo of the
// program's own career string, per the standard's exemption list). No
// mapping-logic change.
// ─────────────────────────────────────────────────────────────────────────────

export const CAREER_KMITL_MAPPING_VERSION = 'career-kmitl-mapping.v2';

export const CareerKmitlMappingSchema = z.object({
  mappings: z.array(
    z.object({
      careerLabel: z.string(),
      kmitlCareerIds: z.array(z.number().int()),
      /** English — analysis prose, not a data label, so it is NOT on
       *  the Thai exemption list (docs/prompt-standard.md).
       *  `careerLabel` above IS exempt: it's a verbatim echo of the
       *  program's own Thai career string, not model-generated
       *  analysis. */
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
      "reasoning": "<one sentence, in English, explaining why these KMITL careers were chosen>",
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

LANGUAGE RULE (English-only free text):
- \`reasoning\` MUST be written in English.
- \`careerLabel\` stays Thai — it is a verbatim echo of the program's own
  career string (an exempt data label per docs/prompt-standard.md), not
  model-generated analysis.

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
  {"careerLabel":"วิศวกรเครื่องกลในโรงงานอุตสาหกรรม","kmitlCareerIds":[312,313,314],"reasoning":"Direct match to all three Mechanic-subgroup careers.","noKmitlMatch":false},
  {"careerLabel":"วิศวกรในอุตสาหกรรมการผลิตไฟฟ้าและพลังงานทดแทน","kmitlCareerIds":[303,304,305],"reasoning":"Power Engineer + Power Plant + Renewable cover both fossil and renewable energy.","noKmitlMatch":false},
  {"careerLabel":"นักวิจัยและพัฒนาด้านหุ่นยนต์","kmitlCareerIds":[291,443],"reasoning":"Robotics Engineer is a direct match; Automation Engineer covers adjacent industrial automation.","noKmitlMatch":false},
  {"careerLabel":"ผู้ประกอบการนวัตกรรม","kmitlCareerIds":[],"reasoning":"KMITL taxonomy has no Entrepreneur category — route to external grounded search.","noKmitlMatch":true}
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

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed:
//   - programCareers — the program's own free-text career list (from
//     program-digest's careerPathsTh, verbatim).
//   - kmitlCareers — the FULL KMITL career taxonomy (id, name, group,
//     sub-group). THE closed-world label set this prompt classifies
//     against (per the standard's Classification addendum — the model
//     may only emit ids that were offered here).
//   - programDegree / programFaculty — identity context only, not used
//     to derive any mapping decision beyond framing.
//
// Deliberately omitted, with reason:
//   - ISCO-08 crosswalk — KMITL careers aren't ISCO-08 codes; a
//     hand-mapped `KmitlCareer.iscoCode` crosswalk is a separate,
//     analyst-driven enrichment tracked elsewhere, not something this
//     prompt derives.
//   - Labour-market demand volume (KmitlCareerSkillDemand) — this
//     prompt only resolves WHICH KMITL careers a program's stated
//     careers correspond to; how much each career is in demand is read
//     downstream by the caller, not needed here.
// ─────────────────────────────────────────────────────────────────────────────
