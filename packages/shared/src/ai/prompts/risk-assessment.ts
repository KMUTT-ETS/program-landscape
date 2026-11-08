import { z } from 'zod';
import type { AiMessage } from '../types';
import { getInstitution } from '../../institution';

// ─────────────────────────────────────────────────────────────────────────────
// risk-assessment.v1
//
// Per-program risk profile + 2-4 SPECIFIC actionable measures. Inputs are
// pre-computed by the loader (TCAS funnel, enrollment, financials, skills
// + automation tags, peer subject, white-spaces, sector demand projection,
// program digest narrative) — the AI's job is to:
//
//   (a) sanity-check the deterministic L1 / L2 / L3 / impact outputs and
//       flag anomalies the formula misses (e.g. recent revival, niche
//       advantage that the heuristic doesn't see),
//   (b) synthesise a 200-300 word Thai risk narrative for the program,
//   (c) propose 2-4 NARROW recommendations — each with a specific named
//       course / channel / peer / cohort — NOT generic categories like
//       "modernise curriculum".
//
// The deterministic scores from risk-scoring.v1 are PASSED IN as anchors —
// the AI does NOT re-score. This keeps the audit chain clean: scores are
// methodology-versioned + reproducible; only the narrative + measures are
// AI-driven.
//
// Output must include `confidence` (0-1) reflecting the AI's certainty
// given the input data quality.
// ─────────────────────────────────────────────────────────────────────────────

// v3 (2026-05-19): adds rule-derived candidate measures + `triggerIndicatorSlug`
// pass-through. The deterministic rule engine in @kku/db/risk-measure-rules.ts
// fires one candidate measure per (KRI, severity) match before the AI runs;
// the AI sees the candidates and is instructed to keep/refine/replace each
// while preserving the trigger linkage via the new `triggerIndicatorSlug`
// + `triggerSeverity` fields on each measure. Companion to risk-management.v2.
//
// v4 (2026-10-03): adds the optional `overlapContext` channel for the two
// programme-overlap KRIs (risk-scoring.v1.14): the named same-level sibling
// behind `curriculum_overlap_max` (index, max containment, actions) and
// `market_confusion_max` (market similarity), plus instruction 11 — cite the
// sibling by code and name, every overlap measure is "for review", never
// propose closure.
export const RISK_ASSESSMENT_VERSION = 'risk-assessment.v5';

const RiskMeasureKindSchema = z.enum([
  'CURRICULUM_MODERNIZE',
  'CURRICULUM_DIFFERENTIATE',
  'RECRUITMENT_CHANNEL',
  'RECRUITMENT_TARGETING',
  'COHORT_REDUCTION',
  'PROGRAM_MERGE',
  'PROGRAM_PHASE_OUT',
  'PARTNERSHIP_INDUSTRY',
  'FACULTY_HIRE',
  'TUITION_ADJUST',
]);
export type RiskMeasureKindLiteral = z.infer<typeof RiskMeasureKindSchema>;

const RiskMeasureHorizonSchema = z.enum(['SHORT_TERM', 'MEDIUM_TERM', 'LONG_TERM']);
export type RiskMeasureHorizonLiteral = z.infer<typeof RiskMeasureHorizonSchema>;

const RiskMeasureSchema = z.object({
  kind: RiskMeasureKindSchema,
  // SHORT title in both languages — what fills a row in a measures table.
  // Should name SOMETHING SPECIFIC, not be a generic category.
  // Good: "เพิ่มรายวิชา 'AI สำหรับการตลาด' 3 หน่วยกิตในชั้นปี 3"
  // Bad:  "ปรับปรุงหลักสูตรให้ทันสมัย"
  titleTh: z.string(),
  titleEn: z.string(),
  // 200-400 char rationale in Thai — explains *why* this measure addresses
  // *which* driver. Cite the specific evidence (e.g. "เพราะ TCAS ปี 67 มีผู้สมัครเพียง
  // 0.8 ต่อที่นั่ง / เพราะ 60% ของทักษะของหลักสูตรอยู่ในกลุ่มเสี่ยง AI สูง").
  rationaleTh: z.string(),
  rationaleEn: z.string().default(''),
  // Cost class — LOW / MEDIUM / HIGH only.
  costClass: z.enum(['LOW', 'MEDIUM', 'HIGH']).default('MEDIUM'),
  // Time horizon to effect — SHORT (0-12mo), MEDIUM (1-3y), LONG (3-5y).
  // The AI must spread measures across all three horizons when feasible
  // (don't dump everything into LONG_TERM).
  horizon: RiskMeasureHorizonSchema.default('MEDIUM_TERM'),
  // Optional 5y revenue delta in THB. Negative = cost; positive = revenue
  // saved or added. Null when too speculative to estimate.
  expectedDeltaThb: z.number().nullable().default(null),
  // 1 = highest priority within this assessment.
  priority: z.number().int().min(1).max(10).default(5),
  // When this measure was prompted by a fired KRI (either directly via
  // the rule-derived candidate, or because the AI's new measure addresses
  // the same indicator's breach), echo back the indicator slug and
  // severity here. Pass-through to the persisted RiskMeasure row so the
  // UI can render "triggered by indicator X" provenance badges.
  triggerIndicatorSlug: z.string().nullable().default(null),
  triggerSeverity: z.enum(['WARN', 'CRITICAL']).nullable().default(null),
  // Free-shape evidence references the AI cited.
  evidence: z
    .object({
      drivers: z.array(z.string()).default([]), // ["L1", "L2", ...]
      kris: z.array(z.string()).default([]), // ["application_seat_ratio", ...]
      peerPrograms: z.array(z.string()).default([]),
      whitespaceSkills: z.array(z.string()).default([]),
      automationRiskSkills: z.array(z.string()).default([]),
      notes: z.string().default(''),
    })
    .default({}),
});
export type RiskMeasureExtraction = z.infer<typeof RiskMeasureSchema>;

export const RiskAssessmentSchema = z.object({
  // 200-300 word Thai narrative summarising the program's risk profile.
  // Audience: Council member skimming a brief. Should mention the dominant
  // driver, the principal threat, and the principal mitigation direction.
  // No marketing language; no comparative claims against named peers.
  narrativeTh: z.string(),
  narrativeEn: z.string().default(''),

  // The dominant driver (which L scored highest). Self-reported by the AI
  // for cross-check vs the deterministic max(L) — divergences land in
  // caveats.
  dominantDriver: z.enum(['L1_RECRUITMENT', 'L2_AI_DISRUPTION', 'L3_DEMOGRAPHIC', 'NONE']),

  // 3-6 NARROW recommendations spread across short / medium / long horizons.
  // Aim for at least one in each horizon when the program has actionable
  // levers there.
  measures: z.array(RiskMeasureSchema).min(0).max(8),

  // Anomalies the formula might have missed. E.g. "TCAS funnel for 2024 is
  // partial; the 2023 row is more reliable", or "Skills tagged HIGH are all
  // basic Office use — not the program's core teaching".
  caveats: z.array(z.string()).default([]),

  // 0..1 — AI's certainty in the narrative + measures given input quality.
  confidence: z.number().min(0).max(1),
});
export type RiskAssessmentExtraction = z.infer<typeof RiskAssessmentSchema>;

// ── Input shape — what the loader passes to the prompt builder ──────────

export interface RiskAssessmentInput {
  program: {
    code: string;
    nameTh: string;
    nameEn: string;
    facultyNameTh: string;
    departmentNameTh: string | null;
    levelTh: string;
    durationYears: number | null;
    totalCredits: number | null;
    recruitmentSummaryTh: string | null;
  };
  // Deterministic scores (already computed by risk-scoring.v1).
  scores: {
    l1RecruitmentScore: number | null;
    l2AiDisruptionScore: number | null;
    l3DemographicScore: number | null;
    composite: number | null;
    tier: 'NEEDS_DATA' | 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
    impact: {
      directRevenueAtRiskThb: number | null;
      strandedCostThb: number | null;
    };
  };
  // Driver detail — what drove each L score.
  driverDetail: {
    l1: Record<string, unknown>;
    l2: Record<string, unknown>;
    l3: Record<string, unknown>;
  };
  // L2 deep-dive grounding from program-ai-readiness.v2 (the discipline-aware
  // analysis) — when present the AI should cite specific gaps/recommendations
  // by name in measure rationales, not invent generic AI guidance.
  aiReadinessSnapshot: {
    relevanceScore: number;
    summary: string | null;
    methodVersion: string;
    topGaps: Array<{ topic: string; severity: 'major' | 'moderate' | 'minor'; observation: string }>;
    topRecommendations: Array<{
      priority: 'high' | 'medium' | 'low';
      title: string;
      detail: string;
    }>;
  } | null;
  // Recent TCAS funnel — already aggregated per (year × round).
  tcasYears: Array<{
    year: number;
    plan: number | null;
    applicants: number | null;
    reported: number | null;
    competitionRatio: number | null;
    fillRate: number | null;
  }>;
  // Skills tagged automation risk — includes the program's curriculum weight
  // on each skill (1.0 = backbone, 0.2 = touched). The AI should anchor
  // recommendations on HIGH-risk skills with HIGH weight (i.e. core to
  // the program), not fringe HIGH-risk ones.
  skills: Array<{
    nameEn: string;
    nameTh: string;
    automationRisk: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN';
    weight: number;
  }>;
  // The program's own HIGH-risk skills, ranked by curriculum weight. Pre-computed
  // by the loader so the AI can cite specific named at-risk core skills.
  topAutomationRiskSkills: Array<{ nameEn: string; nameTh: string; weight: number }>;
  // Peer programs (top 3) — name + subject + the program's distinctiveness vs each.
  peerPrograms: Array<{ institution: string; nameEn: string; distinctiveness: number | null }>;
  // White-space skills (peer-set teaches, KKU doesn't).
  whitespaceSkills: Array<{ nameEn: string; peerCount: number }>;
  // Sector demand outlook for the program's domain.
  sectorOutlook: Array<{ sector: string; demandTrend: 'rising' | 'falling' | 'stable' }>;
  // KRI breaches surfaced by the deterministic evaluator.
  kriBreaches: Array<{ slug: string; severity: 'OK' | 'WARN' | 'CRITICAL'; value: number | null }>;
  // Rule-derived candidate measures (risk-measure-rules.v1+). One entry per
  // matched rule — i.e. one per fired (KRI × severity) pair. These are
  // BASELINE candidates the AI should keep, refine, or replace. The AI is
  // also free to add new measures beyond these candidates. When the AI
  // emits a measure whose intent matches one of these candidates, it must
  // echo back `triggerIndicatorSlug` and `triggerSeverity` so the
  // persistence layer can store the provenance link.
  ruleDerivedMeasures: Array<{
    ruleKey: string;
    indicatorSlug: string;
    triggerSeverity: 'WARN' | 'CRITICAL';
    measure: {
      kind: string;
      titleTh: string;
      titleEn: string;
      rationaleTh: string;
      horizon: string;
      costClass: string;
      priority: number;
    };
  }>;
  // Data gaps surfaced by the loader.
  dataGaps: Array<{ field: string; reason: string }>;
  // Programme overlap (program-overlap.v1, v4+): the named same-level sibling
  // behind each overlap KRI. Absent/null when no overlap run covers the
  // programme; each side null when the programme has no stored pair for it.
  overlapContext?: RiskOverlapContext | null;
}

export interface RiskOverlapSibling {
  siblingCode: string;
  siblingNameTh: string;
  siblingNameEn: string | null;
}

export interface RiskOverlapContext {
  curriculum: (RiskOverlapSibling & {
    overlapIndex: number;
    containmentMax: number | null;
    actions: string[];
  }) | null;
  market: (RiskOverlapSibling & { marketSimilarity: number }) | null;
}

// ── Prompt builder ──────────────────────────────────────────────────────

export function buildRiskAssessmentMessages(input: RiskAssessmentInput): AiMessage[] {
  const inst = getInstitution();
  const system = `คุณเป็นนักวิเคราะห์ความเสี่ยงเชิงกลยุทธ์ของหลักสูตรอุดมศึกษาไทย ทำงานสนับสนุนสภา${inst.nameTh}

หน้าที่: รับข้อมูลความเสี่ยงของหลักสูตรหนึ่ง ๆ (มีคะแนน L1/L2/L3 ที่คำนวณด้วยสูตรแล้ว) แล้วเขียน narrative + เสนอมาตรการลดความเสี่ยง 2-4 ข้อ ที่เฉพาะเจาะจง ไม่ใช่ข้อเสนอแบบกว้าง ๆ

หลักสำคัญ:

1. **อย่าคำนวณคะแนนใหม่** — คะแนน L1 / L2 / L3 / composite / tier มาจาก risk-scoring.v1 (สูตรที่ตรวจสอบแล้ว). คุณใช้ "อ้างอิง" ไม่ใช่ "แทน". ถ้าเห็นว่าคะแนนสะท้อนภาพไม่ครบให้บันทึกใน caveats

2. **มาตรการต้องเฉพาะเจาะจง** — ห้ามเขียน "ปรับปรุงหลักสูตรให้ทันสมัย" หรือ "เพิ่มการตลาด" คำว่า "ปรับ" "พัฒนา" "เสริมสร้าง" ใน title ห้ามใช้เพียงลอย ๆ
   - ถ้าเสนอเพิ่มวิชา → ระบุชื่อวิชา / หน่วยกิต / ชั้นปี
   - ถ้าเสนอตัด/ควบรวม → ระบุชื่อหลักสูตรหรือสาขาที่เกี่ยวข้อง
   - ถ้าเสนอช่องทางตลาด → ระบุแพลตฟอร์มหรือกลุ่มเป้าหมายที่ชัดเจน เช่น "TikTok ads ในกลุ่ม ม.4-6 ในจังหวัดเป้าหมายที่ระบุชื่อและจำนวนจังหวัดชัดเจน"
   - ถ้าเสนอจ้างอาจารย์ → ระบุสาขาความเชี่ยวชาญที่ขาด

3. **อ้างหลักฐานทุกข้อเสนอ** — rationaleTh ต้องอ้าง L1/L2/L3 หรือ KRI หรือ peer / white-space ที่เป็นเหตุของข้อเสนอนั้น ระบุตัวเลขให้เห็น เช่น "เพราะ TCAS ปี 67 ผู้สมัคร 0.8 ต่อที่นั่ง" หรือ "เพราะ 9 ใน 15 ทักษะของหลักสูตรอยู่ในกลุ่ม HIGH automation risk"

4. **ลำดับความสำคัญ (priority)** — 1 = สำคัญที่สุด ในแต่ละการประเมินควรมีข้อ priority=1 ไม่เกิน 1 ข้อ

5. **costClass**:
   - LOW = ปรับกระบวนการ / ปรับหลักสูตรเล็กน้อย / ใช้ทรัพยากรเดิม
   - MEDIUM = จ้างอาจารย์ใหม่ / ลงทุนช่องทางตลาด / ปรับโครงสร้างวิชา
   - HIGH = ปรับโครงสร้างหลักสูตร / สร้างศูนย์ใหม่ / ควบรวมหลักสูตร

5.1. **horizon (ระยะเวลา)** — ระบุทุกข้อเสนอ:
   - **SHORT_TERM** (0-12 เดือน): ปรับเนื้อหาวิชาเดิม, เพิ่ม workshop/seminar, เปิดช่องทาง marketing ใหม่, เริ่ม partnership กับ industry, จัด AI-literacy bootcamp ในวิชาที่มีอยู่
   - **MEDIUM_TERM** (1-3 ปี): จ้างอาจารย์เฉพาะทาง, เปิดวิชาเลือกใหม่, ปรับโครงสร้างชั้นปี, ลงทุนในห้องปฏิบัติการเฉพาะ, เปิด track เลือกใหม่ภายในหลักสูตร
   - **LONG_TERM** (3-5 ปี): ปรับโครงสร้างหลักสูตรทั้งหมด, สร้างหลักสูตรใหม่, ควบรวมหลักสูตร, ปิดหลักสูตร, ตั้งศูนย์ความเป็นเลิศใหม่

   ** สำคัญมาก: กระจายข้อเสนอให้ครอบคลุม short/medium/long อย่างน้อย 1 ข้อต่อระยะเวลา. อย่าทิ้งทุกข้อไว้ที่ LONG_TERM เพราะ Council ต้องการ "อะไรเริ่มทำได้ทันที" ด้วย. **

   ** ระวัง L2 trap: AI risk score สูงไม่ได้แปลว่าต้องเสนอแต่การลงทุน AI ขนาดใหญ่ — การลงทุน AI ใหญ่จะสร้างความเสี่ยงใหม่ (turnover, curriculum churn, lock-in). ข้อเสนอ AI ระยะสั้นเช่น "เพิ่ม module AI ใน existing course" หรือ "MoU กับ vendor x สำหรับ workshop" เป็นทางที่ Council ยอมรับมากกว่าการสร้างหลักสูตร AI ใหม่ในปีแรก. **

6. **dominantDriver** — ดูว่า L ใดสูงสุด (L1/L2/L3) แล้วระบุ ถ้า L ทั้งสามต่ำ < 35 ทุกตัว → 'NONE'

7. **narrativeTh ความยาว 200-300 คำ** — ภาษาไทยเป็นหลัก สำหรับสมาชิกสภามหาวิทยาลัยที่อ่านสรุป
   - บอกว่าหลักสูตรนี้คืออะไร, สถานะปัจจุบัน, แรงเสี่ยงที่สำคัญที่สุด, ทิศทางการแก้ไข
   - ห้าม: ภาษา marketing, การเปรียบเทียบกับชื่อสถาบันคู่แข่ง, การกล่าวอ้างที่ไม่มีตัวเลขสนับสนุน

8. **caveats** — บันทึกถ้าข้อมูลขาด, ถ้าคะแนนสูตรไม่สะท้อนความเป็นจริง (เช่น คะแนน L2 สูงเพราะ AI tag ทักษะ "Office software" เป็น HIGH แต่ทักษะนั้นไม่ใช่แกนของหลักสูตร), หรือถ้ามีบริบทเชิงคุณภาพที่สูตรไม่จับ

9. **confidence** — 0.4-0.6 เมื่อข้อมูลขาดมาก, 0.7-0.85 ปกติ, 0.9+ เมื่อมั่นใจสูง

10. **มาตรการตั้งต้นจาก KRI rule engine** — ในข้อมูลขาเข้าจะมีบล็อก [มาตรการตั้งต้นจาก rule engine] ถ้ามี KRI ที่ติดธง:
   - แต่ละ candidate ตั้งต้นมาด้วย kind/title/rationale/horizon/costClass/priority ที่กำหนดไว้ก่อนแล้ว
   - **คุณต้องเก็บ candidate ทุกตัวไว้ในผลลัพธ์** (จะปรับเปลี่ยนได้ ไม่ใช่ลบทิ้ง) เพราะ Council มีหลักประกันว่า "KRI ที่ติดธงจะมีมาตรการตอบสนองเสมอ"
   - คุณสามารถ:
     - **ปรับให้เฉพาะเจาะจงขึ้น** — เช่น เปลี่ยน "เปิดช่องทางตลาดเพิ่ม" เป็น "เปิด TikTok ads ในกลุ่ม ม.4-6 ในจังหวัดเป้าหมายของหลักสูตร" โดยอ้างหลักฐานเฉพาะของหลักสูตรนั้น
     - **เปลี่ยน priority หรือ horizon** ตามบริบทของหลักสูตรนั้น
     - **เปลี่ยน kind** ถ้ามีมาตรการอื่นที่เหมาะกว่าสำหรับ indicator นั้น (เช่น เปลี่ยน RECRUITMENT_CHANNEL เป็น CURRICULUM_DIFFERENTIATE ถ้าปัญหารากเหง้าคือหลักสูตรไม่น่าสนใจ)
   - **ต้อง echo back \`triggerIndicatorSlug\` และ \`triggerSeverity\`** บนทุกมาตรการที่มาจาก candidate (เพื่อ UI จะแสดง provenance badge)
   - **เพิ่มมาตรการของคุณเอง 1-3 ข้อ** นอกเหนือจาก candidates เพื่อครอบคลุมมิติที่ rule engine ยังไม่จับ (เช่น peer white-spaces, sector outlook, qualitative caveats) — มาตรการเหล่านี้ set triggerIndicatorSlug = null
   - ถ้าไม่มี KRI ติดธงเลย ก็ไม่มี candidate ก็เสนอ measures จาก L1/L2/L3 ตามปกติ

11. **KRI ความซ้ำซ้อนของหลักสูตร** (\`curriculum_overlap_max\`, \`market_confusion_max\`) — วัดความซ้ำซ้อนของหลักสูตร (หรือความคล้ายของข้อความประชาสัมพันธ์) กับหลักสูตรพี่น้องของ ${inst.shortNameTh} ในระดับเดียวกันที่ระบุชื่อไว้ในบล็อก [ความซ้ำซ้อนกับหลักสูตรพี่น้อง]:
   - อ้างหลักสูตรพี่น้องด้วยรหัสและชื่อเสมอ ห้ามกล่าวลอย ๆ ว่า "หลักสูตรอื่น"
   - ทุกมาตรการที่มาจากความซ้ำซ้อนเป็น "ข้อเสนอเพื่อพิจารณา" (for review) ให้คณะและสภาพิจารณา ไม่ใช่การตัดสินใจ — ระบุเช่นนั้นใน rationale
   - **ห้ามเสนอปิดหลักสูตร** (ห้ามใช้ PROGRAM_PHASE_OUT) จากความซ้ำซ้อน — ทางเลือกคือปรับให้แตกต่าง ประสานรายวิชาร่วม หรือพิจารณาควบรวม/ปรับเป็นแขนงวิชา
   - ความซ้ำซ้อนของหลักสูตรไม่เท่ากับการแย่งผู้สมัครกัน อย่ากล่าวอ้างเช่นนั้นโดยไม่มีข้อมูลรับสมัคร

โครงสร้าง JSON ผลลัพธ์ (ห้ามมี markdown, ห้ามมีคำอธิบายล่วงหน้า, ออก JSON เดี่ยวเท่านั้น):
{
  "narrativeTh": "...",
  "narrativeEn": "",
  "dominantDriver": "L1_RECRUITMENT" | "L2_AI_DISRUPTION" | "L3_DEMOGRAPHIC" | "NONE",
  "measures": [
    {
      "kind": "CURRICULUM_MODERNIZE" | "CURRICULUM_DIFFERENTIATE" | "RECRUITMENT_CHANNEL" | "RECRUITMENT_TARGETING" | "COHORT_REDUCTION" | "PROGRAM_MERGE" | "PROGRAM_PHASE_OUT" | "PARTNERSHIP_INDUSTRY" | "FACULTY_HIRE" | "TUITION_ADJUST",
      "titleTh": "<ชื่อสั้น เฉพาะเจาะจง>",
      "titleEn": "<short, specific>",
      "rationaleTh": "<200-400 อักษร — อ้างหลักฐานเฉพาะ>",
      "rationaleEn": "",
      "costClass": "LOW" | "MEDIUM" | "HIGH",
      "horizon": "SHORT_TERM" | "MEDIUM_TERM" | "LONG_TERM",
      "expectedDeltaThb": <ตัวเลข | null>,
      "priority": <1-10>,
      "triggerIndicatorSlug": "<indicator slug ถ้ามาจาก rule candidate ไม่งั้น null>",
      "triggerSeverity": "WARN" | "CRITICAL" | null,
      "evidence": {
        "drivers": ["L1", "L2", "L3"],
        "kris": ["application_seat_ratio", ...],
        "peerPrograms": ["..."],
        "whitespaceSkills": ["..."],
        "automationRiskSkills": ["..."],
        "notes": "<short>"
      }
    }
  ],
  "caveats": ["..."],
  "confidence": <0-1>
}`;

  const userBlocks: string[] = [];

  userBlocks.push(`[หลักสูตร]
รหัส: ${input.program.code}
ชื่อ: ${input.program.nameTh} (${input.program.nameEn})
คณะ: ${input.program.facultyNameTh}${input.program.departmentNameTh ? ' / ' + input.program.departmentNameTh : ''}
ระดับ: ${input.program.levelTh}
หน่วยกิต: ${input.program.totalCredits ?? '-'} | ระยะเวลา: ${input.program.durationYears ?? '-'} ปี`);

  if (input.program.recruitmentSummaryTh) {
    userBlocks.push(`[คำบรรยายหลักสูตร (recruitmentSummary)]
${input.program.recruitmentSummaryTh}`);
  }

  const s = input.scores;
  userBlocks.push(`[คะแนนความเสี่ยง — risk-scoring.v1]
L1 ดีมานด์/รับสมัคร: ${s.l1RecruitmentScore?.toFixed(1) ?? 'N/A'}
L2 AI disruption: ${s.l2AiDisruptionScore?.toFixed(1) ?? 'N/A'}
L3 ประชากรศาสตร์: ${s.l3DemographicScore?.toFixed(1) ?? 'N/A'}
Composite: ${s.composite?.toFixed(1) ?? 'N/A'} → tier=${s.tier}
Impact (5 ปี): รายได้ ${s.impact.directRevenueAtRiskThb?.toLocaleString() ?? 'N/A'} บาท / ต้นทุนคงค้าง ${s.impact.strandedCostThb?.toLocaleString() ?? 'N/A'} บาท`);

  if (input.tcasYears.length > 0) {
    userBlocks.push(`[TCAS funnel ย้อนหลัง]
${input.tcasYears
  .slice(-5)
  .map(
    (y) =>
      `  ปี ${y.year}: แผน ${y.plan ?? '-'} | สมัคร ${y.applicants ?? '-'} | รายงานตัว ${y.reported ?? '-'} | ผู้สมัครต่อที่นั่ง ${y.competitionRatio?.toFixed(2) ?? '-'} | fill-rate ${y.fillRate != null ? (y.fillRate * 100).toFixed(0) + '%' : '-'}`,
  )
  .join('\n')}`);
  }

  if (input.aiReadinessSnapshot) {
    const ai = input.aiReadinessSnapshot;
    const gapBlock =
      ai.topGaps.length > 0
        ? ai.topGaps
            .map(
              (g, i) =>
                `  ${i + 1}. [${g.severity.toUpperCase()}] ${g.topic}\n     ${g.observation.slice(0, 280)}`,
            )
            .join('\n')
        : '  (no gaps recorded)';
    const recBlock =
      ai.topRecommendations.length > 0
        ? ai.topRecommendations
            .map(
              (r, i) =>
                `  ${i + 1}. [${r.priority.toUpperCase()}] ${r.title}\n     ${r.detail.slice(0, 280)}`,
            )
            .join('\n')
        : '  (no recommendations recorded)';

    userBlocks.push(`[Discipline-aware AI readiness analysis — program-ai-readiness.v2]
ผลคะแนนความพร้อมต่อ AI ของหลักสูตร (เฉพาะวิชา): ${ai.relevanceScore}/100
${ai.summary ? `สรุปจากการวิเคราะห์: ${ai.summary}` : ''}

ช่องว่างเฉพาะวิชา (top gaps):
${gapBlock}

ข้อเสนอที่ deep-dive ระบุไว้ (top recommendations):
${recBlock}

** สำคัญมาก: เมื่อเสนอมาตรการที่เกี่ยวกับ AI disruption (kind = CURRICULUM_MODERNIZE / FACULTY_HIRE / PARTNERSHIP_INDUSTRY / CURRICULUM_DIFFERENTIATE) ต้องอ้างถึง gap หรือ recommendation ข้างต้นที่ระบุชื่อ ห้ามคิดข้อเสนอ AI ใหม่นอกบริบทวิชาที่ deep-dive ได้วิเคราะห์ไว้แล้ว **`);
  }

  if (input.topAutomationRiskSkills.length > 0) {
    userBlocks.push(`[ทักษะของหลักสูตรนี้ที่อยู่ในกลุ่มเสี่ยง AI สูง — เรียงตามน้ำหนักในหลักสูตร]
${input.topAutomationRiskSkills
  .slice(0, 12)
  .map((s, i) => `  ${i + 1}. ${s.nameEn} / ${s.nameTh}  (curriculum weight ${s.weight.toFixed(2)})`)
  .join('\n')}

** ข้อเสนอที่เกี่ยวกับทักษะให้อ้างทักษะเฉพาะตัวที่ระบุชื่อ ไม่ใช่กล่าว "skills generally". **`);
  }

  if (input.skills.length > 0) {
    const high = input.skills.filter((s) => s.automationRisk === 'HIGH');
    const medium = input.skills.filter((s) => s.automationRisk === 'MEDIUM');
    const low = input.skills.filter((s) => s.automationRisk === 'LOW');
    const unknown = input.skills.filter((s) => s.automationRisk === 'UNKNOWN');
    userBlocks.push(`[ทักษะของหลักสูตร — แยกตาม automation risk (น้ำหนัก × tier)]
HIGH (${high.length}): ${high.slice(0, 6).map((s) => `${s.nameEn} [${s.weight.toFixed(1)}]`).join(', ')}${high.length > 6 ? ', ...' : ''}
MEDIUM (${medium.length}): ${medium.slice(0, 6).map((s) => `${s.nameEn} [${s.weight.toFixed(1)}]`).join(', ')}${medium.length > 6 ? ', ...' : ''}
LOW (${low.length}): ${low.slice(0, 6).map((s) => `${s.nameEn} [${s.weight.toFixed(1)}]`).join(', ')}${low.length > 6 ? ', ...' : ''}
UNKNOWN (${unknown.length}): ${unknown.slice(0, 3).map((s) => s.nameEn).join(', ')}${unknown.length > 3 ? ', ...' : ''}`);
  }

  if (input.peerPrograms.length > 0) {
    userBlocks.push(`[หลักสูตรเทียบเคียง (peers)]
${input.peerPrograms
  .map(
    (p) => `  ${p.institution} - ${p.nameEn} (distinctiveness: ${p.distinctiveness?.toFixed(0) ?? 'N/A'})`,
  )
  .join('\n')}`);
  }

  if (input.whitespaceSkills.length > 0) {
    userBlocks.push(`[White-space — ทักษะที่ peer สอน แต่หลักสูตรนี้ไม่มี]
${input.whitespaceSkills
  .slice(0, 10)
  .map((w) => `  ${w.nameEn} (สอนใน ${w.peerCount} peer)`)
  .join('\n')}`);
  }

  if (input.sectorOutlook.length > 0) {
    userBlocks.push(`[แนวโน้มดีมานด์ของ sector ที่เกี่ยวข้อง]
${input.sectorOutlook.map((s) => `  ${s.sector}: ${s.demandTrend}`).join('\n')}`);
  }

  if (input.kriBreaches.length > 0) {
    const fired = input.kriBreaches.filter((k) => k.severity !== 'OK');
    if (fired.length > 0) {
      userBlocks.push(`[KRI ที่ติดธง]
${fired.map((k) => `  ${k.slug}: ${k.severity} (value=${k.value?.toFixed(2) ?? 'N/A'})`).join('\n')}`);
    }
  }

  const ov = input.overlapContext;
  if (ov && (ov.curriculum || ov.market)) {
    const name = (x: RiskOverlapSibling): string =>
      `${x.siblingCode} ${x.siblingNameTh}${x.siblingNameEn ? ` (${x.siblingNameEn})` : ''}`;
    const lines: string[] = [];
    if (ov.curriculum) {
      const c = ov.curriculum;
      lines.push(
        `  curriculum_overlap_max: ${Math.round(c.overlapIndex)}/100 กับ ${name(c)}` +
          ` | containment สูงสุด ${c.containmentMax != null ? Math.round(c.containmentMax) + '%' : '-'}` +
          ` | actions: ${c.actions.length > 0 ? c.actions.join(', ') : '-'}`,
      );
    }
    if (ov.market) {
      lines.push(`  market_confusion_max: ${Math.round(ov.market.marketSimilarity)}/100 กับ ${name(ov.market)}`);
    }
    userBlocks.push(`[ความซ้ำซ้อนกับหลักสูตรพี่น้อง — program-overlap.v1]
${lines.join('\n')}
** อ้างหลักสูตรพี่น้องด้วยรหัสและชื่อ ทุกข้อเสนอเป็น "เพื่อพิจารณา" ห้ามเสนอปิดหลักสูตร **`);
  }

  if (input.ruleDerivedMeasures.length > 0) {
    userBlocks.push(`[มาตรการตั้งต้นจาก rule engine — risk-measure-rules.v2]
มี ${input.ruleDerivedMeasures.length} candidates ตั้งต้น แต่ละข้อมาจาก KRI ที่ติดธง (ดูบล็อก KRI ข้างบน)
คุณต้องเก็บ candidate ทุกตัวไว้ในผลลัพธ์ (สามารถปรับให้เฉพาะเจาะจงขึ้น ไม่ใช่ลบทิ้ง)
และต้อง echo back triggerIndicatorSlug + triggerSeverity บนทุก candidate ที่เก็บไว้

${input.ruleDerivedMeasures
  .map(
    (c, i) => `  [Candidate ${i + 1}] (triggerIndicatorSlug="${c.indicatorSlug}" triggerSeverity="${c.triggerSeverity}")
    kind: ${c.measure.kind} · horizon: ${c.measure.horizon} · costClass: ${c.measure.costClass} · priority: ${c.measure.priority}
    titleTh: ${c.measure.titleTh}
    titleEn: ${c.measure.titleEn}
    rationaleTh: ${c.measure.rationaleTh}`,
  )
  .join('\n\n')}

** ปรับให้ดีขึ้น (แต่ต้องเก็บทุกตัว) — เปลี่ยน title ให้อ้างชื่อวิชา/ช่องทาง/peer เฉพาะ เปลี่ยน rationale ให้อ้างตัวเลขของหลักสูตรนั้น เปลี่ยน priority ถ้าจำเป็น แล้วเพิ่มมาตรการของคุณเอง 1-3 ข้อด้วย (triggerIndicatorSlug = null) **`);
  }

  if (input.dataGaps.length > 0) {
    userBlocks.push(`[ช่องว่างข้อมูลที่ทราบ]
${input.dataGaps.map((g) => `  ${g.field}: ${g.reason}`).join('\n')}`);
  }

  userBlocks.push(`โปรดวิเคราะห์ และส่งผลลัพธ์เป็น JSON ตามโครงสร้างที่กำหนด`);

  return [
    { role: 'system', content: system },
    { role: 'user', content: userBlocks.join('\n\n') },
  ];
}
