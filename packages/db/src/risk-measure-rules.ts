// ─────────────────────────────────────────────────────────────────────────────
// risk-measure-rules.v1  —  automated breach → measure templates
//
// Deterministic rule engine that turns a list of triggered KRI breaches into
// candidate RiskMeasure templates. Runs BEFORE the AI in the risk pipeline;
// the AI prompt receives these candidates as a baseline and may keep, refine,
// discard, or extend them.
//
// Why a rule layer at all (v1 didn't have one):
//   - Gives Council a defensible "if KRI X breached we ALWAYS at least
//     propose measure Y" guarantee. Independent of AI availability or
//     quality, every breach gets at least one corresponding candidate
//     in the assessment.
//   - Lets the analyst/Risk Office tune institutional posture by editing
//     the rule table, not by reshaping prompts.
//   - Surfaces traceability in the UI: a measure carries the indicator
//     slug + severity that triggered it (when rule-originated).
//
// Why this lives as a static TypeScript constant instead of a DB table:
//   - 6 rules total. A DB-backed catalog with admin UI is v3 scope —
//     same trajectory as the indicator catalog (v1 static → v2 tunable
//     via /admin/risks/indicators/).
//   - Keeps the engine a pure function: tests don't need a DB.
//
// Versioning: bump `RISK_MEASURE_RULES_VERSION` when the rule set OR a
// template body changes. The persisted RiskMeasure carries the active
// version in evidence so an auditor can reproduce which template fired.
// ─────────────────────────────────────────────────────────────────────────────

import type { RiskIndicatorSeverity, RiskMeasureKind, RiskMeasureHorizon } from '@prisma/client';

export const RISK_MEASURE_RULES_VERSION = 'risk-measure-rules.v1';

/** A single rule: when this indicator hits the trigger severity, surface
 *  the templated candidate measure. */
export interface RiskMeasureRule {
  /** Which indicator slug fires this rule (matches RiskIndicator.slug). */
  indicatorSlug: string;
  /** Minimum severity to fire (CRITICAL fires if either WARN or CRITICAL
   *  rule has triggerSeverity = WARN; setting CRITICAL means the rule fires
   *  ONLY on critical). */
  triggerSeverity: Exclude<RiskIndicatorSeverity, 'OK'>;
  measureKind: RiskMeasureKind;
  /** Short title in Thai + English. The AI may refine these into more
   *  program-specific phrasing — these are the safe baseline that always
   *  fires regardless of AI availability. */
  titleTh: string;
  titleEn: string;
  /** Rationale TEMPLATE — placeholders `{value}` and `{threshold}` are
   *  substituted in `deriveRuleMeasures()` at evaluation time. Keep these
   *  short (≤ 280 chars) because the AI typically rewrites them with
   *  more specific evidence. */
  rationaleTemplateTh: string;
  rationaleTemplateEn: string;
  horizon: RiskMeasureHorizon;
  costClass: 'LOW' | 'MEDIUM' | 'HIGH';
  /** 1 = highest priority in the assessment. The AI may reorder based on
   *  its own judgement but these defaults seed the priority field. */
  priority: number;
}

/** v1 rule catalog. Six rules covering all five v1 KRIs (intake-floor
 *  fires two rules — WARN suggests outreach, CRITICAL suggests cohort
 *  reduction). */
export const RISK_MEASURE_RULES: readonly RiskMeasureRule[] = [
  {
    indicatorSlug: 'application_seat_ratio',
    triggerSeverity: 'WARN',
    measureKind: 'RECRUITMENT_CHANNEL',
    titleTh: 'เปิดช่องทางการตลาด TCAS รอบ 1-2 (Portfolio / Quota)',
    titleEn: 'Open targeted marketing channels for TCAS rounds 1-2 (Portfolio / Quota)',
    rationaleTemplateTh:
      'อัตราส่วนผู้สมัครต่อที่นั่ง = {value} (ต่ำกว่าเกณฑ์ {threshold}) — ต้องเร่งดึงดูดผู้สมัครเพิ่ม โดยเฉพาะรอบต้น ๆ ที่นักเรียนคุณภาพสูงเลือกก่อน',
    rationaleTemplateEn:
      'Applications-to-seat ratio is {value} (below threshold {threshold}) — needs more early-round applicants where higher-GPA students typically commit first.',
    horizon: 'SHORT_TERM',
    costClass: 'LOW',
    priority: 3,
  },
  {
    indicatorSlug: 'enrollment_fill_rate',
    triggerSeverity: 'WARN',
    measureKind: 'RECRUITMENT_TARGETING',
    titleTh: 'ทบทวนเป้าหมายโรงเรียน / ภูมิภาคของหลักสูตร',
    titleEn: 'Revisit target schools and regions for the program',
    rationaleTemplateTh:
      'อัตราการรายงานตัวจริง = {value} (ต่ำกว่าเกณฑ์ {threshold}) — ผู้สมัครติดแต่ไม่ยืนยัน บ่งชี้ว่ากลุ่มเป้าหมายอาจไม่ตรง หรือมีคู่แข่งที่น่าสนใจกว่า',
    rationaleTemplateEn:
      'Fill rate is {value} (below threshold {threshold}) — admits not confirming suggests target audience mismatch or a more attractive competitor.',
    horizon: 'SHORT_TERM',
    costClass: 'LOW',
    priority: 3,
  },
  {
    indicatorSlug: 'late_round_dependency',
    triggerSeverity: 'WARN',
    measureKind: 'RECRUITMENT_TARGETING',
    titleTh: 'ปรับ mix ตลาดให้พึ่งรอบ Portfolio / Quota มากขึ้น',
    titleEn: 'Rebalance recruitment mix toward Portfolio / Quota rounds',
    rationaleTemplateTh:
      'สัดส่วนการรับรอบท้าย = {value} (สูงกว่าเกณฑ์ {threshold}) — การพึ่งรอบ 3-4 บ่งบอกว่ารอบ Portfolio/Quota แข่งกับคู่แข่งไม่ได้',
    rationaleTemplateEn:
      'Late-round dependency is {value} (above threshold {threshold}) — heavy reliance on rounds 3-4 signals weak competitiveness in early rounds.',
    horizon: 'SHORT_TERM',
    costClass: 'LOW',
    priority: 4,
  },
  {
    indicatorSlug: 'skill_automation_index',
    triggerSeverity: 'WARN',
    measureKind: 'CURRICULUM_MODERNIZE',
    titleTh: 'แทรก module AI literacy + GenAI ในวิชาที่มีอยู่',
    titleEn: 'Embed AI-literacy + GenAI modules into existing courses',
    rationaleTemplateTh:
      'สัดส่วนทักษะเสี่ยง AI = {value} (สูงกว่าเกณฑ์ {threshold}) — เริ่มต้นด้วยการเพิ่มเนื้อหา AI/GenAI ในวิชาแกน 2-3 ตัวก่อน ไม่ต้องลงทุนหลักสูตรใหม่ทันที',
    rationaleTemplateEn:
      'Skill automation index is {value} (above threshold {threshold}) — start by embedding AI/GenAI content into 2-3 core courses; full curriculum redesign comes later.',
    horizon: 'SHORT_TERM',
    costClass: 'LOW',
    priority: 2,
  },
  {
    indicatorSlug: 'bachelor_intake_floor',
    triggerSeverity: 'WARN',
    measureKind: 'RECRUITMENT_CHANNEL',
    titleTh: 'เร่งช่องทางการ outreach เฉพาะกลุ่ม — การรับยังต่ำกว่าเป้าหมายสภา',
    titleEn: 'Accelerate targeted outreach — intake below Council policy floor',
    rationaleTemplateTh:
      'จำนวนนักศึกษารับ = {value} คน (ต่ำกว่าเกณฑ์เตือน {threshold}) — เกือบไม่ผ่านนโยบายสภา ≥ 30 คน/ปี ต้องเปิดช่องทาง outreach เพิ่มก่อนเข้ารอบ TCAS หน้า',
    rationaleTemplateEn:
      'Intake is {value} students (below warn threshold {threshold}) — close to breaching the Council ≥ 30/year floor; open additional outreach channels before next TCAS cycle.',
    horizon: 'SHORT_TERM',
    costClass: 'LOW',
    priority: 3,
  },
  {
    indicatorSlug: 'bachelor_intake_floor',
    triggerSeverity: 'CRITICAL',
    measureKind: 'COHORT_REDUCTION',
    titleTh: 'พิจารณาควบรวมหรือปรับลด cohort target ให้ตรงกับ demand จริง',
    titleEn: 'Consider merging or reducing the cohort target to match real demand',
    rationaleTemplateTh:
      'จำนวนนักศึกษารับ = {value} คน — ต่ำกว่านโยบายสภาขั้นต่ำ {threshold} คน/ปี การฝืนคงเป้าใหญ่จะดึงต้นทุนต่อหัวสูง ควรพิจารณาควบรวมกับหลักสูตรพี่น้อง หรือลด planned intake ให้ตรง demand',
    rationaleTemplateEn:
      'Intake is {value} students — below the Council floor of {threshold}/year. Maintaining a high target inflates cost-per-student; consider merging with a sibling program or reducing planned intake to match real demand.',
    horizon: 'MEDIUM_TERM',
    costClass: 'MEDIUM',
    priority: 1,
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Engine
// ─────────────────────────────────────────────────────────────────────────────

/** Output of the rule engine — a candidate measure ready for either direct
 *  persistence (if `--no-ai`) or for inclusion in the AI prompt as a
 *  baseline. */
export interface RuleDerivedMeasure {
  /** Stable identifier — `<indicatorSlug>:<severity>` — used by the AI
   *  prompt and by the post-AI matcher to write back triggerIndicatorSlug. */
  ruleKey: string;
  indicatorSlug: string;
  triggerSeverity: 'WARN' | 'CRITICAL';
  observedValue: number | null;
  threshold: number;
  measure: {
    kind: RiskMeasureKind;
    titleTh: string;
    titleEn: string;
    rationaleTh: string;
    rationaleEn: string;
    horizon: RiskMeasureHorizon;
    costClass: 'LOW' | 'MEDIUM' | 'HIGH';
    priority: number;
  };
}

/** Breach input shape — matches what `evaluateKris()` returns. */
export interface DerivationBreach {
  indicatorSlug: string;
  severity: RiskIndicatorSeverity;
  value: number | null;
}

/**
 * Walk the rule catalog against the program's breach list. Returns one
 * candidate measure per matched rule.
 *
 * Matching is exact-severity:
 *   - A rule with triggerSeverity=WARN fires only on `severity==='WARN'`.
 *   - A rule with triggerSeverity=CRITICAL fires only on `severity==='CRITICAL'`.
 *
 * This is deliberate — different mitigation intensities for the two
 * severity levels (see bachelor_intake_floor: WARN suggests outreach,
 * CRITICAL suggests cohort reduction). If you want a rule to fire on
 * BOTH severities, add two entries to the catalog.
 *
 * Pure function — no IO, deterministic given (catalog, breaches,
 * thresholds). Safe for unit tests.
 */
export function deriveRuleMeasures(
  breaches: DerivationBreach[],
  /** RISK_INDICATOR_CATALOG-shaped threshold lookup. Pass through from
   *  the loader; engine doesn't import the catalog itself to keep the
   *  dependency graph clean. */
  thresholdLookup: Record<
    string,
    { warnThreshold: number; criticalThreshold: number }
  >,
): RuleDerivedMeasure[] {
  const out: RuleDerivedMeasure[] = [];
  for (const breach of breaches) {
    if (breach.severity === 'OK') continue;
    for (const rule of RISK_MEASURE_RULES) {
      if (rule.indicatorSlug !== breach.indicatorSlug) continue;
      if (rule.triggerSeverity !== breach.severity) continue;
      const thresholds = thresholdLookup[rule.indicatorSlug];
      if (!thresholds) continue;
      const threshold =
        rule.triggerSeverity === 'CRITICAL'
          ? thresholds.criticalThreshold
          : thresholds.warnThreshold;
      const valueStr =
        breach.value === null ? '—' : formatValue(breach.value, rule.indicatorSlug);
      const thresholdStr = formatValue(threshold, rule.indicatorSlug);
      out.push({
        ruleKey: `${rule.indicatorSlug}:${rule.triggerSeverity}`,
        indicatorSlug: rule.indicatorSlug,
        triggerSeverity: rule.triggerSeverity,
        observedValue: breach.value,
        threshold,
        measure: {
          kind: rule.measureKind,
          titleTh: rule.titleTh,
          titleEn: rule.titleEn,
          rationaleTh: rule.rationaleTemplateTh
            .replace('{value}', valueStr)
            .replace('{threshold}', thresholdStr),
          rationaleEn: rule.rationaleTemplateEn
            .replace('{value}', valueStr)
            .replace('{threshold}', thresholdStr),
          horizon: rule.horizon,
          costClass: rule.costClass,
          priority: rule.priority,
        },
      });
    }
  }
  return out;
}

/** Format a numeric value for inclusion in the rationale template.
 *  Ratios get 2 decimals; whole-number indicators get integers; percent-
 *  style indicators get one decimal. The indicator-aware formatting keeps
 *  the rendered rationale readable to a non-technical Council audience. */
function formatValue(n: number, indicatorSlug: string): string {
  if (indicatorSlug === 'bachelor_intake_floor') return String(Math.round(n));
  // ratios + percentages — 0..3 typical range; 2 decimals is plenty
  return n.toFixed(2);
}
