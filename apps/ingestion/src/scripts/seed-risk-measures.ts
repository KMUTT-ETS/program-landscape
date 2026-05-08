#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Risk-measure seed (rule-based fallback)
//
// Generates a baseline set of recommended measures per latest assessment
// using deterministic rules over the driver scores + KKU level. Output is
// 3-5 measures per program, spread across SHORT_TERM / MEDIUM_TERM /
// LONG_TERM horizons, with rationales that cite the actual driver
// numbers from the assessment.
//
// This is the fallback path for when the AI provider is unavailable, when
// you want a quick baseline before running the AI sweep, or when AI cost
// is a concern. The rules are intentionally conservative — every measure
// is action-class LOW or MEDIUM (Council can scale up via AI sweep later).
//
// Usage:
//   pnpm risks:seed-measures                  # apply for all latest assessments
//   pnpm risks:seed-measures --dry-run         # show without writing
//   pnpm risks:seed-measures --replace         # delete existing measures first
//   pnpm risks:seed-measures --only-empty      # skip assessments that already have measures
//
// Idempotent under default mode (skips assessments with existing measures
// unless --replace).
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

import { prisma, Prisma, RISK_SCORING_VERSION } from '@kku/db';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const replace = args.includes('--replace');
const onlyEmpty = args.includes('--only-empty');

interface Measure {
  kind:
    | 'CURRICULUM_MODERNIZE'
    | 'CURRICULUM_DIFFERENTIATE'
    | 'RECRUITMENT_CHANNEL'
    | 'RECRUITMENT_TARGETING'
    | 'COHORT_REDUCTION'
    | 'PROGRAM_MERGE'
    | 'PROGRAM_PHASE_OUT'
    | 'PARTNERSHIP_INDUSTRY'
    | 'FACULTY_HIRE'
    | 'TUITION_ADJUST';
  titleTh: string;
  titleEn: string;
  rationaleTh: string;
  costClass: 'LOW' | 'MEDIUM' | 'HIGH';
  horizon: 'SHORT_TERM' | 'MEDIUM_TERM' | 'LONG_TERM';
  priority: number;
  evidence: Record<string, unknown>;
}

interface AssessmentRow {
  id: string;
  programId: string;
  programCode: string;
  programNameTh: string;
  facultyNameTh: string;
  l1: number | null;
  l2: number | null;
  l3: number | null;
  composite: number | null;
  tier: 'NEEDS_DATA' | 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
  kkuRiskLevel: 'NEEDS_DATA' | 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';
  kkuMatrixScore: number | null;
  directRevenueAtRiskThb: number | null;
}

function buildMeasures(row: AssessmentRow): Measure[] {
  const out: Measure[] = [];

  // ── L1 Recruitment-driven measures ────────────────────────────────────
  if (row.l1 != null && row.l1 >= 50) {
    // High recruitment risk → fast marketing tweaks (short term)
    out.push({
      kind: 'RECRUITMENT_CHANNEL',
      titleTh: 'เปิดแคมเปญ TikTok / Instagram targeting นักเรียน ม.4-6 ภาคอีสาน 9 จังหวัด',
      titleEn: 'TikTok/Instagram campaign targeting NE Thailand high-school cohort',
      rationaleTh: `L1 (recruitment) = ${row.l1.toFixed(0)} ขึ้นกับสถานการณ์การสมัคร TCAS รอบล่าสุดอ่อนกว่าเป้า — ช่องทาง social ระยะสั้นเป็นวิธีที่ใช้ทรัพยากรเดิม + เห็นผลใน 1 รอบ TCAS ถัดไป (3-6 เดือน). กำหนด KPI: เพิ่มจำนวนผู้สมัครให้สูงกว่า plan_per_year × 1.5 ในรอบหน้า.`,
      costClass: 'LOW',
      horizon: 'SHORT_TERM',
      priority: 1,
      evidence: { drivers: ['L1'], kris: ['application_seat_ratio', 'enrollment_fill_rate'] },
    });
    if (row.l1 >= 65) {
      out.push({
        kind: 'RECRUITMENT_TARGETING',
        titleTh: 'ขยายฐานผู้สมัครออกนอกจังหวัดขอนแก่น — ทำ MoU โรงเรียนพันธมิตร 10 แห่งใน 4 จังหวัดข้างเคียง',
        titleEn: 'Partner-school MoU programme — 10 partner schools across 4 nearby provinces',
        rationaleTh: `L1 = ${row.l1.toFixed(0)} เกินเกณฑ์สูง — ฐานผู้สมัครปัจจุบันแคบเกินไป. ระยะเวลา 1-2 ปีที่จะเห็น cohort ใหม่จากโรงเรียนพันธมิตร. คาดเห็นผลตั้งแต่ TCAS ปีที่ 2.`,
        costClass: 'MEDIUM',
        horizon: 'MEDIUM_TERM',
        priority: 2,
        evidence: { drivers: ['L1'], kris: ['late_round_dependency'] },
      });
    }
  }

  // ── L2 AI-driven measures (lower-cost, short-horizon path) ────────────
  // The seed deliberately favours small AI integrations over big-bet AI
  // programmes — the user explicitly said L2 dominates and triggers
  // expensive investments that create new risk. Keep AI measures
  // proportional to L2 strength + bounded to SHORT/MEDIUM horizons here.
  if (row.l2 != null && row.l2 >= 35) {
    out.push({
      kind: 'CURRICULUM_MODERNIZE',
      titleTh: 'เพิ่ม module "AI ในวิชาชีพ" 6 ชั่วโมงในรายวิชาแกน — ใช้อาจารย์ปัจจุบัน + workshop จาก vendor',
      titleEn: 'Embed 6-hour "AI in the profession" module into core course',
      rationaleTh: `L2 (AI risk) = ${row.l2.toFixed(0)} — เพิ่ม AI literacy ในรายวิชาที่มีอยู่ก่อน (ไม่ต้องเปิดวิชาใหม่). ระยะสั้น 6-12 เดือน ใช้ทรัพยากรอาจารย์เดิม + 1-2 vendor workshop. ลด L2 ได้ทันที + ทดสอบความสนใจของนักศึกษาก่อนลงทุนใหญ่.`,
      costClass: 'LOW',
      horizon: 'SHORT_TERM',
      priority: row.l2 >= 60 ? 2 : 4,
      evidence: { drivers: ['L2'], notes: 'Conservative AI integration — avoid lock-in' },
    });
    if (row.l2 >= 55) {
      out.push({
        kind: 'PARTNERSHIP_INDUSTRY',
        titleTh: 'MoU กับบริษัท AI/tech 1-2 ราย เพื่อ guest lecture + internship slot ปีละ 5 คน',
        titleEn: 'Industry MoU for guest lectures + 5 internship slots per year',
        rationaleTh: `L2 = ${row.l2.toFixed(0)} แสดงว่าวิชาชีพกำลังถูก AI กระทบ. การจับมือ industry ระยะกลางทำให้นักศึกษาเข้าถึงเครื่องมือ AI ของจริงโดยไม่ต้องลงทุนสร้างห้องปฏิบัติการเอง. ลด disruption signal โดยไม่สร้างความเสี่ยงใหม่จากการลงทุน infrastructure.`,
        costClass: 'MEDIUM',
        horizon: 'MEDIUM_TERM',
        priority: 5,
        evidence: { drivers: ['L2'] },
      });
    }
  }

  // ── L3 Demographic / competitiveness ───────────────────────────────────
  if (row.l3 != null && row.l3 >= 60) {
    out.push({
      kind: 'CURRICULUM_DIFFERENTIATE',
      titleTh: 'เปิด track เลือกใหม่ที่เน้นจุดเด่นเฉพาะของหลักสูตร เพื่อแยกตัวจาก peer ที่หลักสูตรคล้ายกัน',
      titleEn: 'Open differentiated elective track leveraging the program\'s unique strengths',
      rationaleTh: `L3 (demographic) = ${row.l3.toFixed(0)} — แสดงว่าหลักสูตรอยู่ใน quartile ล่างของการแข่งขัน TCAS. การเปิด track เลือกใหม่ที่แตกต่างเป็นการสร้างจุดขายเฉพาะ ระยะ 1-3 ปี. ใช้ทรัพยากรอาจารย์เดิม + 2-3 รายวิชาเลือกใหม่.`,
      costClass: 'MEDIUM',
      horizon: 'MEDIUM_TERM',
      priority: 3,
      evidence: { drivers: ['L3'] },
    });
  }

  // ── Composite / KKU level high → strategic long-term ──────────────────
  if (row.kkuRiskLevel === 'VERY_HIGH' || row.kkuRiskLevel === 'HIGH') {
    out.push({
      kind: 'PROGRAM_MERGE',
      titleTh: 'พิจารณาความเป็นไปได้ในการควบรวมกับหลักสูตรพันธมิตรที่ใกล้เคียงในคณะหรือคณะข้างเคียง',
      titleEn: 'Explore merger feasibility with adjacent program in same or sibling faculty',
      rationaleTh: `KKU score = ${row.kkuMatrixScore ?? '—'} ระดับ ${row.kkuRiskLevel === 'VERY_HIGH' ? 'สูงมาก' : 'สูง'} — ทางเลือกระยะยาว 3-5 ปีคือศึกษาความเป็นไปได้ในการควบรวมเพื่อรวมทรัพยากร, ลด overhead, และสร้างหลักสูตรที่เข้มแข็งขึ้น. ระยะแรก: ทำ feasibility study ภายใน 12 เดือน, ตัดสินใจในปีที่ 2-3, executed ในปีที่ 4-5.`,
      costClass: 'HIGH',
      horizon: 'LONG_TERM',
      priority: row.kkuRiskLevel === 'VERY_HIGH' ? 3 : 6,
      evidence: { drivers: ['composite', 'KKU'] },
    });
  }

  // ── Always include at least one short-term operational measure ────────
  if (!out.some((m) => m.horizon === 'SHORT_TERM')) {
    out.push({
      kind: 'CURRICULUM_MODERNIZE',
      titleTh: 'ทบทวน learning outcomes รายวิชาแกน 5 ตัวให้สอดคล้องกับ ProgramSkill และ employer feedback ล่าสุด',
      titleEn: 'Review 5 core-course learning outcomes against current ProgramSkills + employer feedback',
      rationaleTh: 'รายการตรวจประจำปี — ทำได้ในเทอมหน้า ใช้ทรัพยากรอาจารย์เดิม. เป็น hygiene measure ที่ทำให้ KRI สำคัญสะอาดขึ้นโดยไม่ต้องลงทุน.',
      costClass: 'LOW',
      horizon: 'SHORT_TERM',
      priority: 7,
      evidence: { kind: 'baseline-hygiene' },
    });
  }
  if (!out.some((m) => m.horizon === 'MEDIUM_TERM')) {
    out.push({
      kind: 'FACULTY_HIRE',
      titleTh: 'เปิดตำแหน่งอาจารย์ใหม่ 1 ตำแหน่ง — สาขาความเชี่ยวชาญที่ใกล้เคียงกับ peer top-tier ที่ขาดในหลักสูตรนี้',
      titleEn: 'Open 1 new faculty position aligned to a peer-top-tier specialisation gap',
      rationaleTh: 'การเสริม specialisation gap เป็นการลงทุนระยะกลาง 1-3 ปี ใช้กระบวนการ recruit ปกติของมหาวิทยาลัย. กำหนด JD ที่อ้างอิง peer benchmark + KKU strategic plan.',
      costClass: 'MEDIUM',
      horizon: 'MEDIUM_TERM',
      priority: 8,
      evidence: { kind: 'baseline-faculty' },
    });
  }

  // De-duplicate by kind+horizon, keep highest priority (lowest priority number)
  const dedup = new Map<string, Measure>();
  for (const m of out) {
    const key = `${m.kind}-${m.horizon}`;
    const existing = dedup.get(key);
    if (!existing || m.priority < existing.priority) dedup.set(key, m);
  }
  return [...dedup.values()].sort((a, b) => a.priority - b.priority);
}

async function main(): Promise<void> {
  console.log(`[seed-measures] mode=${dryRun ? 'DRY-RUN' : 'APPLY'}${replace ? ' (replacing existing)' : ''}${onlyEmpty ? ' (only-empty)' : ''}`);

  const latestRows = await prisma.$queryRawUnsafe<
    Array<{
      id: string;
      program_id: string;
      program_code: string;
      program_name_th: string;
      faculty_name_th: string;
      l1_recruitment_score: number | null;
      l2_ai_disruption_score: number | null;
      l3_demographic_score: number | null;
      composite_score: number | null;
      tier: 'NEEDS_DATA' | 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';
      kku_risk_level: 'NEEDS_DATA' | 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH';
      kku_matrix_score: number | null;
      direct_revenue_at_risk_thb: string | null;
    }>
  >(`
    SELECT DISTINCT ON (ra.program_id)
      ra.id, ra.program_id, p.code AS program_code, p.name_th AS program_name_th,
      f.name_th AS faculty_name_th,
      ra.l1_recruitment_score, ra.l2_ai_disruption_score, ra.l3_demographic_score,
      ra.composite_score, ra.tier, ra.kku_risk_level, ra.kku_matrix_score,
      ra.direct_revenue_at_risk_thb::text
    FROM risk_assessments ra
    JOIN programs p ON p.id = ra.program_id
    JOIN faculties f ON f.id = p.faculty_id
    WHERE p.level = 'BACHELOR' AND p.status = 'ACTIVE'
    ORDER BY ra.program_id, ra.assessed_at DESC
  `);

  console.log(`[seed-measures] ${latestRows.length} latest assessments`);

  let written = 0;
  let skipped = 0;
  let totalMeasures = 0;
  for (const r of latestRows) {
    const row: AssessmentRow = {
      id: r.id,
      programId: r.program_id,
      programCode: r.program_code,
      programNameTh: r.program_name_th,
      facultyNameTh: r.faculty_name_th,
      l1: r.l1_recruitment_score,
      l2: r.l2_ai_disruption_score,
      l3: r.l3_demographic_score,
      composite: r.composite_score,
      tier: r.tier,
      kkuRiskLevel: r.kku_risk_level,
      kkuMatrixScore: r.kku_matrix_score,
      directRevenueAtRiskThb: r.direct_revenue_at_risk_thb ? Number(r.direct_revenue_at_risk_thb) : null,
    };

    if (onlyEmpty || !replace) {
      const existing = await prisma.riskMeasure.count({ where: { assessmentId: row.id } });
      if (existing > 0) {
        skipped += 1;
        continue;
      }
    }

    const measures = buildMeasures(row);
    if (measures.length === 0) {
      skipped += 1;
      continue;
    }

    if (replace && !dryRun) {
      await prisma.riskMeasure.deleteMany({ where: { assessmentId: row.id } });
    }

    if (!dryRun) {
      await prisma.riskMeasure.createMany({
        data: measures.map((m) => ({
          assessmentId: row.id,
          kind: m.kind,
          titleTh: m.titleTh,
          titleEn: m.titleEn,
          rationaleTh: m.rationaleTh,
          costClass: m.costClass,
          horizon: m.horizon,
          priority: m.priority,
          evidenceJson: { ...m.evidence, _seedSource: 'rule-based-seed.v1', _scoring: RISK_SCORING_VERSION } as Prisma.InputJsonValue,
        })),
      });
    }

    written += 1;
    totalMeasures += measures.length;

    const horizonBreakdown = {
      short: measures.filter((m) => m.horizon === 'SHORT_TERM').length,
      medium: measures.filter((m) => m.horizon === 'MEDIUM_TERM').length,
      long: measures.filter((m) => m.horizon === 'LONG_TERM').length,
    };
    console.log(
      `  ${row.programCode.padEnd(13)} ${row.programNameTh.slice(0, 30).padEnd(30)} ${row.kkuRiskLevel.padEnd(10)} → ${measures.length} measures (S${horizonBreakdown.short}/M${horizonBreakdown.medium}/L${horizonBreakdown.long})`,
    );
  }

  console.log('');
  console.log(`[seed-measures] DONE`);
  console.log(`  assessments processed: ${latestRows.length}`);
  console.log(`  measures written:      ${written} (${totalMeasures} total measures)`);
  console.log(`  skipped (existing):    ${skipped}`);
}

main()
  .catch((err) => {
    console.error('[seed-measures] failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
