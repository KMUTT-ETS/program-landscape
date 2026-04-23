import type {
  Intervention,
  ScenarioAssumptions,
  ScenarioType,
} from './types';
import { DEFAULT_ASSUMPTIONS } from './engine';

// ═══════════════════════════════════════════════════════════════════════
// Scenario templates (prompt 09)
//
// Seed data for the Library view. A user clicks "Use this template" →
// the API copies the template into a new Scenario row with the current
// user as owner and `isTemplate=false`. Templates themselves are kept
// pristine.
//
// For LAUNCH / SUNSET / MERGE templates, `affectedProgramIds` /
// intervention payload needs a real program id — the API seed layer
// fills these at seed time.
// ═══════════════════════════════════════════════════════════════════════

export interface ScenarioTemplate {
  slug: string;
  name: string;
  descriptionTh: string;
  descriptionEn: string;
  scenarioType: ScenarioType;
  horizonYears: number;
  assumptions: Partial<ScenarioAssumptions>;
  // Intervention blueprint (ids resolved at seed time).
  interventionBlueprint: Array<Omit<Intervention, 'programId' | 'programIds'> & {
    programSelector?: 'first' | 'two-smallest' | 'one-random';
    programIds?: string[];
    programId?: string;
  }>;
  // Council-facing caveat surfaced in UI + PDF.
  caveatTh: string;
}

export const SCENARIO_TEMPLATES: ScenarioTemplate[] = [
  {
    slug: 'demographic-stress',
    name: 'Demographic stress test (2030)',
    descriptionTh:
      'ทดสอบผลกระทบจากจำนวนเยาวชนอายุ 18–22 ปีที่ลดลง ~1.8% ต่อปี ถึงปี 2030 ต่อพอร์ตหลักสูตรทั้งหมด',
    descriptionEn:
      'Apply Thailand’s 2030 18–22 cohort projection against all programs, highlighting which become unsustainable.',
    scenarioType: 'REBALANCE',
    horizonYears: 5,
    assumptions: {
      ...DEFAULT_ASSUMPTIONS,
      demographicShockPct: -0.08, // extra -8% shock on top of baseline demographic multiplier
      demandGrowthPct: 0.0,
    },
    interventionBlueprint: [],
    caveatTh:
      'สมมติฐานประชากรอ้างอิงจาก NESDC-v1 ยังไม่ได้ซิงก์ข้อมูลจริงจากสภาการศึกษา — ปรับเปลี่ยนได้ใน Assumptions tab',
  },
  {
    slug: 'financial-stress-20pct',
    name: 'Financial stress test (-20% revenue)',
    descriptionTh:
      'ทดสอบความทนทานเมื่อรายได้ลดลง 20% ติดต่อกัน 5 ปี (ประเมินจากวิกฤตการศึกษา Covid-19 เป็นฐานความรุนแรง)',
    descriptionEn:
      'Apply a sustained −20% revenue shock for 5 years; rank programs by resilience.',
    scenarioType: 'REBALANCE',
    horizonYears: 5,
    assumptions: {
      ...DEFAULT_ASSUMPTIONS,
      financialShockPct: -0.2,
      tuitionGrowthPct: 0.0,
    },
    interventionBlueprint: [],
    caveatTh:
      'Shock 20% เป็นการจำลองกรณีเลวร้าย (เทียบเคียง Covid-19). ความเสียหายจริงขึ้นกับประเภทหลักสูตร',
  },
  {
    slug: 'ai-disruption',
    name: 'AI disruption test',
    descriptionTh:
      'จำลองผลกระทบของ AI และ automation ต่อการจ้างงานบัณฑิต โดยใช้ค่าประมาณจากรายงาน WEF + McKinsey (ชั่วคราว — จะถูกแทนที่ด้วยข้อมูลจริงใน prompt 14)',
    descriptionEn:
      'Model AI-displacement haircuts on graduate employment; currently placeholder coefficients until prompt 14.',
    scenarioType: 'REBALANCE',
    horizonYears: 10,
    assumptions: {
      ...DEFAULT_ASSUMPTIONS,
      aiDisplacementPct: 0.15,
    },
    interventionBlueprint: [],
    caveatTh:
      'ค่า AI displacement 15% เป็นค่าเฉลี่ยชั่วคราว — ข้อมูลจริงรายอาชีพจะมาในการเชื่อมต่อข้อมูลจริง (prompt 14)',
  },
  {
    slug: 'mekong-expansion',
    name: 'Mekong expansion',
    descriptionTh:
      'จำลองการขยายหลักสูตรเป้าหมายเข้าสู่ตลาดลาวและกัมพูชา โดยเพิ่ม intake 20% บนหลักสูตรที่เลือก (ตัวอย่าง — ปรับเปลี่ยนให้ตรงกับพื้นที่กลยุทธ์)',
    descriptionEn:
      'Model expansion of target programs into Lao/Cambodia markets via +20% intake on selected programs.',
    scenarioType: 'REBALANCE',
    horizonYears: 5,
    assumptions: {
      ...DEFAULT_ASSUMPTIONS,
      demandGrowthPct: 0.05,
    },
    interventionBlueprint: [
      {
        kind: 'rebalance',
        intakeMultiplier: 1.2,
        programSelector: 'first', // seed-time replaced with actual program ids
      } as Intervention & { programSelector: 'first' },
    ],
    caveatTh:
      'ยังไม่ได้เชื่อมต่อข้อมูลตลาดแรงงานของลาว/กัมพูชาโดยตรง — กรอบการประเมินเป็นเบื้องต้น',
  },
];
