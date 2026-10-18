// ─────────────────────────────────────────────────────────────────────────────
// Risk Management module — pure scoring functions (risk-scoring.v1)
//
// Methodology: see docs/methodologies/risk-scoring.md. Edit that first when
// changing the formula, then bump RISK_SCORING_VERSION, then change the logic.
//
// Three Likelihood drivers (each 0-100, or null = data gap):
//   L1 = recruitment / TCAS competition decay
//   L2 = AI-disruption (share of taught skills tagged HIGH automationRisk)
//   L3 = demographic vulnerability (entry buffer + trend + forward projection)
//
// Two Impact dimensions (in raw THB plus 0-100 normalised):
//   I1 = direct revenue at risk over rolling 5y
//   I2 = stranded structural cost
//
// Composite: max(L1, L2, L3) over non-null drivers — preserves single-driver
// criticality. Null when ALL three drivers are null (rare; usually means
// program has neither TCAS data nor enrollment data nor any skills).
//
// Scope: undergraduate only (Program.level = BACHELOR).
// ─────────────────────────────────────────────────────────────────────────────

import { Prisma, ProgramLevel, ProgramStatus, AutomationRisk, KkuRiskLevel, RiskTier } from '@prisma/client';
import { campaignPlanKeySql } from './campaign-plan-key';
import { prisma } from './index';
import { programDemographicOutlook } from './program-deep-dive';
import { programFunnelRoundRows } from './program-funnel';
import { realDataSql } from './data-quality';
import { academicYearContextSync } from './academic-year';
import { OVERLAP_THRESHOLDS } from './program-overlap/score';
import { loadOverlapRiskSignal, type OverlapRiskSignal } from './program-overlap/risk';

// Version history (latest entries; full history in
// docs/methodologies/risk-scoring.md):
//   v1.14 (2026-10-03): two KRIs from programme overlap (program-overlap.v1)
//     — curriculum_overlap_max (WARN 50 / CRITICAL 70) and
//     market_confusion_max (WARN 60 / CRITICAL 75, calibrated 2026-10-03).
//     Drivers, tiers and composites are unchanged.
export const RISK_SCORING_VERSION = 'risk-scoring.v1.14';

// L2 (AI-disruption) is intentionally discounted in the COMPOSITE only.
// Rationale: AI mitigation typically requires large multi-year investment
// that creates new operational risks (faculty turnover, curriculum churn,
// over-fitting to a tech wave that shifts). A single high L2 should not
// alone drive a CRITICAL composite. Operational risk drivers (L1
// recruitment, L3 demographic) carry their full weight because they
// reflect realised performance the program has direct levers on.
//
// The RAW L2 score is preserved everywhere else: it drives the AI prompt's
// recommendation generation, the L2 component breakdown UI, the KKU 5×5
// cell placement, and the readiness-deficit + disruption-signal panels.
// What's discounted is only its contribution to the max-of-drivers
// composite that classifies tier.
export const L2_COMPOSITE_DISCOUNT = 0.7;

// ── KKU 5×5 institutional risk matrix ──────────────────────────────────────
// KKU's ERM template uses a 5-level likelihood × 5-level impact matrix.
// Score = L × I, range 1-25, bucketed per the university colour rule.
//
// Equal-width 0-100 → 1-5 bin map (default ERM convention):
//   [0, 20)  → 1  (rare / minor)
//   [20, 40) → 2
//   [40, 60) → 3
//   [60, 80) → 4
//   [80, 100] → 5  (almost certain / catastrophic)
//
// Colour rule (KKU criteria):
//   1-4   → LOW       (green)
//   5-9   → MODERATE  (yellow)
//   10-15 → HIGH      (orange)
//   16-25 → VERY_HIGH (red)
// Programs whose composite likelihood OR impact is null fall to NEEDS_DATA.

export function bin5(score0to100: number | null): number | null {
  if (score0to100 == null) return null;
  const clamped = Math.max(0, Math.min(100, score0to100));
  if (clamped >= 80) return 5;
  if (clamped >= 60) return 4;
  if (clamped >= 40) return 3;
  if (clamped >= 20) return 2;
  return 1;
}

export function kkuMatrixScore(likelihoodBin: number | null, impactBin: number | null): number | null {
  if (likelihoodBin == null || impactBin == null) return null;
  return likelihoodBin * impactBin; // 1..25
}

export function kkuRiskLevelFromScore(matrixScore: number | null): KkuRiskLevel {
  if (matrixScore == null) return 'NEEDS_DATA';
  if (matrixScore >= 16) return 'VERY_HIGH';
  if (matrixScore >= 10) return 'HIGH';
  if (matrixScore >= 5) return 'MODERATE';
  return 'LOW';
}

export interface KkuMatrixVerdict {
  likelihoodBin: number | null;
  impactBin: number | null;
  matrixScore: number | null;
  level: KkuRiskLevel;
}

export function deriveKkuMatrix(
  compositeScore: number | null,
  impactScore: number | null,
): KkuMatrixVerdict {
  const likelihoodBin = bin5(compositeScore);
  const impactBin = bin5(impactScore);
  const matrixScore = kkuMatrixScore(likelihoodBin, impactBin);
  return {
    likelihoodBin,
    impactBin,
    matrixScore,
    level: kkuRiskLevelFromScore(matrixScore),
  };
}

// In-progress TCAS cycle filter. Today's calendar year corresponds to a
// BE cohort that's still being filled (TCAS round 1 opens Nov of the year
// before; round 4 finalises around June). Pulling that year's partial
// counts into L1 / KRIs would systematically understate competition and
// fill rate. Rule: only include rows whose entryYearBE is strictly less
// than the BE equivalent of the current calendar year. Rolls forward each
// January 1 automatically.
// Latest BE entry year whose recruitment is COMPLETE. Delegates to the
// configurable academic-year boundary (academic-year.ts) — previously a
// hardcoded Jan-1 rollover (now.getFullYear()+543-1). Synchronous accessor:
// uses the warmed setting if an async entry point loaded it, else the
// June-16 default (which already yields the corrected current year).
export function latestCompleteEntryYearBE(now: Date = new Date()): number {
  return academicYearContextSync(now).latestCompleteEntryYearBE;
}

export function isInProgressBE(yearBE: number, now: Date = new Date()): boolean {
  return yearBE > latestCompleteEntryYearBE(now);
}

// CE-equivalent of latestCompleteEntryYearBE() — used by FinancialMetric
// (which stores fiscalYear in CE, unlike TCAS which stores BE). Sibling
// helper kept obvious so the unit mismatch can't recur.
export function latestCompleteFiscalYearCE(now: Date = new Date()): number {
  return now.getFullYear() - 1;
}

// ── Tunable constants — change → bump RISK_SCORING_VERSION ────────────────
const TIER_THRESHOLDS = {
  // composite < these → that tier
  LOW: 35,
  MODERATE: 60,
  HIGH: 80,
  // anything ≥ HIGH → CRITICAL
} as const;

const KKU_INTAKE_FLOOR_BACHELOR = 30; // mirrors health-score policy

const L1_WEIGHTS = {
  competitionRatio: 0.35, // applications / planPerYear
  fillRate: 0.35, // regReported / planPerYear
  trendDecay: 0.20, // 5y CAGR direction
  lateRoundDependency: 0.10, // share of admits in TCAS rounds 3+ / 4+
} as const;

// L2 v1.3 — three weighted components rolled into the AI-disruption score.
// Each component is normalised to 0-100 then blended.
const L2_COMPONENT_WEIGHTS = {
  skillPressure: 0.35, // weighted ProgramSkill.automationRisk × ProgramSkill.weight
  readinessDeficit: 0.35, // 100 − ProgramAiReadinessAssessment.relevanceScore
  disruptionSignal: 0.30, // severity-weighted gaps + priority-weighted recommendations
} as const;

// Sub-weights inside the skill-pressure component (kept from v1.2).
const L2_WEIGHTS = {
  highRiskShare: 0.7,
  mediumRiskShare: 0.3,
} as const;

// Severity weights for AI readiness gaps + priorities (used in disruptionSignal).
const GAP_SEVERITY_WEIGHTS = { major: 3, moderate: 2, minor: 1 } as const;
const REC_PRIORITY_WEIGHTS = { high: 3, medium: 2, low: 1 } as const;
// Empirical denominator — calibrated against the deep-dive's typical output:
// program-ai-readiness.v2 emits 0-6 gaps + 1-6 recommendations. Sum of
// max-weighted gaps (6 × 3 = 18) and max-weighted recs (6 × 3 = 18) maps
// the upper end of the observed distribution to ~100 on the gap/rec axis.
const GAP_DENOMINATOR = 18;
const REC_DENOMINATOR = 18;

// L3 v1.9: demographic vulnerability is no longer the universal-constant
// cohort decline applied identically to every program. It's driven by
// program-specific entry-competitiveness — a program with 5:1
// applicants/seat is genuinely insulated from cohort decline (their ratio
// can absorb years of shrinkage before crossing the 1:1 cliff). A program
// at 1.2:1 has no buffer left and is one bad year from under-subscription.
//
// L3 v1.11 adds a FORWARD component: programDemographicOutlook scales the
// program's applicants by the NESDC national-cohort decline and reports
// `superCriticalYear` — the year the pool is projected to fall below 1.5
// applicants/seat. That horizon is discriminating (gated by the program's
// current ratio), unlike the v1.8 universal baseline — so L3 now blends
// the present (buffer), the past (trend) and the future (projection).
//
// Council policy threshold: applicants/seat < 1.5 = "no buffer" → CRITICAL.
const L3_WEIGHTS = {
  buffer: 0.5, // current proximity to the 1:1 cliff
  demographicProjection: 0.3, // forward super-critical horizon (programDemographicOutlook)
  trend: 0.2, // 5y applicant CAGR (negative = shrinking)
} as const;

const COHORT_DECLINE_PCT_PER_YEAR = 1.8; // retained for documentation; not used in scoring v1.9+

// ── Types ──────────────────────────────────────────────────────────────────

export interface DriverScore {
  /** 0–100, null if data gap */
  score: number | null;
  /** 0–1 — share of inputs available to this driver */
  confidence: number;
  /** Free-shape detail used by the UI's driver-drawer */
  detail: Record<string, unknown>;
  /** Data gaps — `[{field, reason}]` */
  gaps: Array<{ field: string; reason: string }>;
}

export interface ImpactScore {
  /** Direct 5y revenue at risk in THB; null if revenue data missing */
  directRevenueAtRiskThb: number | null;
  /** Stranded structural cost in THB; null if cost data missing */
  strandedCostThb: number | null;
  /** Sum, in THB */
  totalThb: number | null;
  /** 0-100 normalised — 100 = top of the at-risk distribution. Filled
   *  by the portfolio-level normaliser, not by computeProgramImpact. */
  normalisedScore: number | null;
  detail: Record<string, unknown>;
  gaps: Array<{ field: string; reason: string }>;
}

export interface ProgramRiskInputs {
  programId: string;
  level: ProgramLevel;
  status: ProgramStatus;
  // 5-year TCAS funnel rolled up per (entryYearBE) → per round.
  tcasFunnel: Array<{
    entryYearBE: number;
    round: string;
    planPerYear: number | null;
    totalApplicants: number | null;
    totalPassed: number | null;
    regReported: number | null;
  }>;
  // Per-year applications/admitted/enrolled/dropouts.
  enrollment: Array<{
    academicYear: number;
    applications: number;
    admitted: number;
    enrolled: number;
    dropouts: number;
  }>;
  // ProgramSkill rows joined to Skill.automationRisk + the program's own
  // weight on each skill (1.0 = backbone of curriculum, 0.2 = briefly touched).
  // L2 weights HIGH-risk shares by these so a fringe HIGH-risk skill doesn't
  // dominate over a core LOW-risk skill.
  skills: Array<{
    skillId: string;
    nameEn: string;
    nameTh: string;
    automationRisk: AutomationRisk;
    weight: number;
  }>;
  // Discipline-aware AI readiness signal from program-ai-readiness.v2 (the
  // deep-dive analysis). Gives L2 v1.3 a second dimension beyond raw skill
  // tagging — programs with strong AI coverage in their own discipline
  // earn lower L2 risk even if the discipline is heavily AI-affected.
  aiReadiness: {
    relevanceScore: number; // 0-100; higher = better AI coverage in this discipline
    summary: string | null;
    methodVersion: string;
    gaps: Array<{
      topic: string;
      severity: 'major' | 'moderate' | 'minor';
      observation: string;
    }>;
    recommendations: Array<{
      priority: 'high' | 'medium' | 'low';
      title: string;
      detail: string;
    }>;
  } | null;
  // 5-year financial series.
  financial: Array<{
    fiscalYear: number;
    tuitionRevenueThb: number;
    otherRevenueThb: number;
    directCostThb: number;
    allocatedFacultyCostThb: number;
    allocatedFacilityCostThb: number;
    allocatedOverheadThb: number;
  }>;
  // Programs's competitiveness percentile — relative TCAS pass rank vs
  // KKU peers in same level. 0 = worst, 100 = best. Computed by the
  // portfolio loader from the full program list.
  competitivenessPercentile: number | null;
  // Forward demographic projection from programDemographicOutlook — the
  // program's applicant pool scaled by the NESDC national-cohort decline.
  // Drives L3's forward-looking component. Null when there is no NESDC
  // cohort data or no TCAS funnel baseline to project from.
  demographicProjection: {
    /** Year the pool is projected to fall below 1.5 applicants/seat;
     *  null when it stays healthy through the +15y horizon. */
    superCriticalYear: number | null;
    /** Years from now to that year; null when superCriticalYear is null. */
    yearsToSuperCritical: number | null;
  } | null;
  // Programme overlap (program-overlap.v1) from the latest SUCCEEDED run
  // with newer scoped runs overlaid. Null/absent = no overlap analysis yet;
  // the two overlap KRIs then emit no row. Only evaluateKris reads it.
  overlap?: OverlapRiskSignal | null;
}

export interface ProgramRiskResult {
  programId: string;
  l1Recruitment: DriverScore;
  l2AiDisruption: DriverScore;
  l3Demographic: DriverScore;
  composite: number | null;
  tier: RiskTier;
  impact: ImpactScore;
  methodologyVersion: string;
}

// ── L1: Recruitment / TCAS decay ────────────────────────────────────────────

export function scoreL1Recruitment(inputs: ProgramRiskInputs): DriverScore {
  const gaps: Array<{ field: string; reason: string }> = [];
  const detail: Record<string, unknown> = {};
  const components: Array<{ key: keyof typeof L1_WEIGHTS; value: number; weight: number }> = [];

  // Drop the in-progress cycle — its applicants/reported counts are partial
  // until TCAS round 4 closes. See latestCompleteEntryYearBE().
  const completeThroughBE = latestCompleteEntryYearBE();
  const funnel = inputs.tcasFunnel.filter((r) => r.entryYearBE <= completeThroughBE);
  detail.completeThroughEntryYearBE = completeThroughBE;
  if (inputs.tcasFunnel.length > funnel.length) {
    detail.inProgressYearsExcluded = [
      ...new Set(inputs.tcasFunnel.filter((r) => r.entryYearBE > completeThroughBE).map((r) => r.entryYearBE)),
    ];
  }
  const recentYears = [...new Set(funnel.map((r) => r.entryYearBE))].sort().slice(-5);
  const yearAggregates = recentYears.map((year) => {
    const rows = funnel.filter((r) => r.entryYearBE === year);
    // planPerYear is per-round-redundant — use MAX
    const plan = Math.max(...rows.map((r) => r.planPerYear ?? 0), 0) || null;
    const applicants = rows.reduce((acc, r) => acc + (r.totalApplicants ?? 0), 0);
    const reported = rows.reduce((acc, r) => acc + (r.regReported ?? 0), 0);
    const lateRoundReported = rows
      .filter((r) => {
        const n = parseFloat(r.round);
        return Number.isFinite(n) && n >= 3;
      })
      .reduce((acc, r) => acc + (r.regReported ?? 0), 0);
    return {
      year,
      plan,
      applicants: applicants || null,
      reported: reported || null,
      lateRoundShare: reported > 0 ? lateRoundReported / reported : null,
    };
  });
  detail.yearAggregates = yearAggregates;

  // Competition ratio — most-recent year applications / plan
  const latest = yearAggregates[yearAggregates.length - 1];
  if (latest?.applicants != null && latest.plan != null && latest.plan > 0) {
    const ratio = latest.applicants / latest.plan;
    // Score: ratio < 1 (fewer applicants than seats) → 100. ratio ≥ 3 → 0.
    const score = Math.max(0, Math.min(100, (3 - ratio) * 50));
    components.push({ key: 'competitionRatio', value: score, weight: L1_WEIGHTS.competitionRatio });
    detail.competitionRatio = ratio;
  } else {
    gaps.push({ field: 'competitionRatio', reason: 'No TCAS funnel data for the most recent year' });
  }

  // Fill rate — reported / plan
  if (latest?.reported != null && latest.plan != null && latest.plan > 0) {
    const fillRate = latest.reported / latest.plan;
    // KKU intake-floor policy reinforces: under 30 → flagged regardless.
    const floorBreach =
      inputs.level === 'BACHELOR' && latest.reported < KKU_INTAKE_FLOOR_BACHELOR;
    // Score: fillRate ≥ 1 → 0. fillRate ≤ 0.4 → 100. Linear in between.
    let score = Math.max(0, Math.min(100, (1 - fillRate) * 100 / 0.6));
    if (floorBreach) score = Math.max(score, 80);
    components.push({ key: 'fillRate', value: score, weight: L1_WEIGHTS.fillRate });
    detail.fillRate = fillRate;
    detail.floorBreach = floorBreach;
  } else {
    gaps.push({ field: 'fillRate', reason: 'No TCAS reported headcount for latest year' });
  }

  // Trend decay — 5y CAGR of applicants
  const applicantsByYear = yearAggregates.filter((y) => y.applicants != null) as Array<{
    year: number;
    applicants: number;
  }>;
  const first = applicantsByYear[0];
  const lastApplicants = applicantsByYear[applicantsByYear.length - 1];
  if (applicantsByYear.length >= 3 && first && lastApplicants) {
    const years = lastApplicants.year - first.year;
    const cagr =
      years > 0 ? Math.pow(lastApplicants.applicants / Math.max(1, first.applicants), 1 / years) - 1 : 0;
    // -10%/yr or worse → 100. 0%/yr → 50. +10%/yr or better → 0.
    const score = Math.max(0, Math.min(100, 50 - cagr * 500));
    components.push({ key: 'trendDecay', value: score, weight: L1_WEIGHTS.trendDecay });
    detail.applicantsCagr = cagr;
  } else {
    gaps.push({ field: 'trendDecay', reason: 'Need ≥3 years of applicant data for CAGR' });
  }

  // Late-round dependency — share filling in rounds 3+
  if (latest?.lateRoundShare != null) {
    // 0% → 0. 100% in late rounds → 100.
    const score = latest.lateRoundShare * 100;
    components.push({ key: 'lateRoundDependency', value: score, weight: L1_WEIGHTS.lateRoundDependency });
    detail.lateRoundShare = latest.lateRoundShare;
  } else {
    gaps.push({ field: 'lateRoundDependency', reason: 'No round-level reported headcount' });
  }

  if (components.length === 0) {
    return { score: null, confidence: 0, detail, gaps };
  }

  const totalWeight = components.reduce((acc, c) => acc + c.weight, 0);
  const weightedScore = components.reduce((acc, c) => acc + c.value * c.weight, 0) / totalWeight;
  const confidence = totalWeight; // weights sum to 1 ⇒ confidence = share of inputs present

  return { score: weightedScore, confidence, detail, gaps };
}

// ── L2: AI-disruption (v1.3 — three-component blend) ──────────────────────
//
// Three independent signals, each normalised 0-100, blended via L2_COMPONENT_WEIGHTS:
//
//   1. Skill pressure (35%)      — weighted Skill.automationRisk × ProgramSkill.weight.
//      How much of the curriculum's centre of gravity sits on automation-prone
//      tasks. A program teaching an automatable core skill at weight=1.0 scores
//      higher than one touching one at weight=0.1.
//
//   2. Readiness deficit (35%)   — 100 − ProgramAiReadinessAssessment.relevanceScore.
//      The deep-dive's discipline-aware AI coverage assessment. A music
//      program with strong AI music-tech coverage scores low deficit even
//      if its skills are tagged HIGH-automation. Anchors L2 in the
//      program's actual discipline rather than generic ML coverage.
//
//   3. Disruption signal (30%)   — severity-weighted gaps + priority-weighted
//      recommendations from program-ai-readiness.v2. More major gaps + more
//      high-priority recommendations = stronger discipline-level pressure
//      to adapt. A program in an AI-distant discipline produces few gaps;
//      a program in a heavily AI-affected discipline produces many.
//
// When a signal is missing the blend collapses to the available components
// (e.g. skill-only fallback when no AI readiness assessment exists).
// Confidence reflects which signals were present.

export function scoreL2AiDisruption(inputs: ProgramRiskInputs): DriverScore {
  const gaps: Array<{ field: string; reason: string }> = [];
  const detail: Record<string, unknown> = {};
  const skills = inputs.skills;
  const ai = inputs.aiReadiness;

  // ── Component 1: Skill pressure (v1.2 carryover) ────────────────────
  let skillPressure: number | null = null;
  let skillConfidence = 0;
  const skillCounts = { LOW: 0, MEDIUM: 0, HIGH: 0, UNKNOWN: 0 };
  const totalWeight = skills.reduce((acc, s) => acc + (s.weight ?? 0), 0) || skills.length;
  const topHigh: Array<{ skillId: string; nameEn: string; nameTh: string; weight: number }> = [];
  if (skills.length > 0) {
    let highW = 0;
    let mediumW = 0;
    let lowW = 0;
    let knownW = 0;
    for (const s of skills) {
      skillCounts[s.automationRisk] += 1;
      const w = s.weight ?? 0;
      if (s.automationRisk === 'HIGH') {
        highW += w;
        knownW += w;
        topHigh.push({ skillId: s.skillId, nameEn: s.nameEn, nameTh: s.nameTh, weight: w });
      } else if (s.automationRisk === 'MEDIUM') {
        mediumW += w;
        knownW += w;
      } else if (s.automationRisk === 'LOW') {
        lowW += w;
        knownW += w;
      }
    }
    if (knownW > 0) {
      const highShare = highW / totalWeight;
      const mediumShare = mediumW / totalWeight;
      const raw = highShare * L2_WEIGHTS.highRiskShare + 0.5 * mediumShare * L2_WEIGHTS.mediumRiskShare;
      skillPressure = Math.max(0, Math.min(100, raw * 100 * 1.5));
      skillConfidence = knownW / totalWeight;
      detail.skillPressure = {
        score: skillPressure,
        highShare,
        mediumShare,
        lowShare: lowW / totalWeight,
        confidence: skillConfidence,
      };
      if (skillConfidence < 1) {
        gaps.push({
          field: 'skills.automationRisk',
          reason: `${skillCounts.UNKNOWN} of ${skills.length} program skills (${Math.round(
            (1 - skillConfidence) * 100,
          )}% by weight) are UNKNOWN`,
        });
      }
    } else {
      gaps.push({
        field: 'skills.automationRisk',
        reason: `${skillCounts.UNKNOWN} of ${skills.length} program skills are UNKNOWN — heuristic + AI sweep not yet run`,
      });
    }
  } else {
    gaps.push({ field: 'skills', reason: 'Program has no ProgramSkill rows' });
  }
  topHigh.sort((a, b) => b.weight - a.weight);

  // ── Component 2: Readiness deficit (program-ai-readiness.v2) ────────
  let readinessDeficit: number | null = null;
  if (ai != null) {
    readinessDeficit = Math.max(0, Math.min(100, 100 - ai.relevanceScore));
    detail.readinessDeficit = {
      score: readinessDeficit,
      relevanceScore: ai.relevanceScore,
      methodVersion: ai.methodVersion,
      summary: ai.summary,
    };
  } else {
    gaps.push({
      field: 'aiReadiness',
      reason: 'No discipline-aware AI readiness assessment yet — run pnpm programs:ai-readiness',
    });
  }

  // ── Component 3: Disruption signal (gap + recommendation pressure) ──
  let disruptionSignal: number | null = null;
  if (ai != null && (ai.gaps.length > 0 || ai.recommendations.length > 0)) {
    const gapWeightSum = ai.gaps.reduce((acc, g) => acc + GAP_SEVERITY_WEIGHTS[g.severity], 0);
    const recWeightSum = ai.recommendations.reduce(
      (acc, r) => acc + REC_PRIORITY_WEIGHTS[r.priority],
      0,
    );
    const gapAxis = Math.min(100, (gapWeightSum / GAP_DENOMINATOR) * 100);
    const recAxis = Math.min(100, (recWeightSum / REC_DENOMINATOR) * 100);
    disruptionSignal = 0.6 * gapAxis + 0.4 * recAxis;
    detail.disruptionSignal = {
      score: disruptionSignal,
      gapWeightSum,
      recWeightSum,
      gapBreakdown: {
        major: ai.gaps.filter((g) => g.severity === 'major').length,
        moderate: ai.gaps.filter((g) => g.severity === 'moderate').length,
        minor: ai.gaps.filter((g) => g.severity === 'minor').length,
      },
      recBreakdown: {
        high: ai.recommendations.filter((r) => r.priority === 'high').length,
        medium: ai.recommendations.filter((r) => r.priority === 'medium').length,
        low: ai.recommendations.filter((r) => r.priority === 'low').length,
      },
    };
  }

  // ── Blend ──────────────────────────────────────────────────────────
  const components: Array<{ key: keyof typeof L2_COMPONENT_WEIGHTS; value: number; weight: number }> = [];
  if (skillPressure != null) {
    components.push({ key: 'skillPressure', value: skillPressure, weight: L2_COMPONENT_WEIGHTS.skillPressure });
  }
  if (readinessDeficit != null) {
    components.push({
      key: 'readinessDeficit',
      value: readinessDeficit,
      weight: L2_COMPONENT_WEIGHTS.readinessDeficit,
    });
  }
  if (disruptionSignal != null) {
    components.push({
      key: 'disruptionSignal',
      value: disruptionSignal,
      weight: L2_COMPONENT_WEIGHTS.disruptionSignal,
    });
  }

  if (components.length === 0) {
    return {
      score: null,
      confidence: 0,
      detail: { ...detail, skillCount: skills.length, counts: skillCounts },
      gaps,
    };
  }

  const totalCompWeight = components.reduce((acc, c) => acc + c.weight, 0);
  const score = components.reduce((acc, c) => acc + c.value * c.weight, 0) / totalCompWeight;
  // Confidence is the share of the L2 weight envelope that had data.
  const confidence = totalCompWeight;

  // Surface top AI-readiness signals to the program profile + AI prompt.
  const topGaps = (ai?.gaps ?? [])
    .slice()
    .sort((a, b) => GAP_SEVERITY_WEIGHTS[b.severity] - GAP_SEVERITY_WEIGHTS[a.severity])
    .slice(0, 4);
  const topRecommendations = (ai?.recommendations ?? [])
    .slice()
    .sort((a, b) => REC_PRIORITY_WEIGHTS[b.priority] - REC_PRIORITY_WEIGHTS[a.priority])
    .slice(0, 4);

  return {
    score: Math.max(0, Math.min(100, score)),
    confidence,
    detail: {
      ...detail,
      composition: components.map((c) => ({ key: c.key, value: c.value, weight: c.weight })),
      skillCount: skills.length,
      counts: skillCounts,
      totalWeight,
      topAutomationRiskSkills: topHigh.slice(0, 12),
      topAiReadinessGaps: topGaps,
      topAiReadinessRecommendations: topRecommendations,
      readinessSummary: ai?.summary ?? null,
    },
    gaps,
  };
}

// ── L3: Demographic vulnerability (v1.9 — entry-competitiveness driven) ────
//
// Two components:
//   1. Buffer score (75%) — proximity to the 1:1 applicants/seat cliff.
//      Council policy: < 1.5 applicants/seat = critical (no buffer).
//      Piecewise function:
//          ratio ≤ 1.0 → 100  (already at the cliff)
//          ratio ≤ 1.5 → 75–100 (Council "critical" band)
//          ratio ≤ 3.0 → 25–75 (moderate buffer)
//          ratio ≤ 5.0 → 0–25  (strong buffer)
//          ratio > 5.0 → 0     (insulated)
//   2. Trend score (25%) — 5y applicant CAGR. Negative trend amplifies
//      vulnerability; positive trend means the program is gaining ground
//      faster than the cohort is shrinking. CAGR of −10%/yr → 50, 0 → 0.
//
// Programs without TCAS funnel data return null L3 (the v1 universal
// cohort-shrinkage baseline that fired for every program is removed —
// it was non-program-specific and forced everyone into MODERATE+).

function bufferScoreFromRatio(appsPerSeat: number): number {
  if (appsPerSeat <= 1.0) return 100;
  if (appsPerSeat <= 1.5) return 75 + (1.5 - appsPerSeat) * 50; // 1.0→100, 1.5→75
  if (appsPerSeat <= 3.0) return 25 + (3.0 - appsPerSeat) * (50 / 1.5); // 1.5→75, 3.0→25
  if (appsPerSeat <= 5.0) return (5.0 - appsPerSeat) * 12.5; // 3.0→25, 5.0→0
  return 0;
}

// Forward-projection sub-score (L3 v1.11). Maps the horizon until the
// program is projected to fall below 1.5 applicants/seat into 0-100:
//   0y (already super-critical) → 100; +5y → 77; +10y → 53; +15y → 30.
// A program that never crosses within +15y is scored 0 by the caller.
function projectionScoreFromYearsAway(yearsAway: number): number {
  return Math.max(0, Math.min(100, 100 - yearsAway * (70 / 15)));
}

export function scoreL3Demographic(inputs: ProgramRiskInputs): DriverScore {
  const gaps: Array<{ field: string; reason: string }> = [];
  const detail: Record<string, unknown> = {};
  const components: Array<{ key: keyof typeof L3_WEIGHTS; value: number; weight: number }> = [];

  // Re-aggregate the TCAS funnel per year (same shape as L1; complete cycles only).
  const completeThroughBE = latestCompleteEntryYearBE();
  const funnel = inputs.tcasFunnel.filter((r) => r.entryYearBE <= completeThroughBE);
  detail.completeThroughEntryYearBE = completeThroughBE;
  const recentYears = [...new Set(funnel.map((r) => r.entryYearBE))].sort();
  const yearAggregates = recentYears.map((year) => {
    const rows = funnel.filter((r) => r.entryYearBE === year);
    const plan = Math.max(...rows.map((r) => r.planPerYear ?? 0), 0) || null;
    const applicants = rows.reduce((acc, r) => acc + (r.totalApplicants ?? 0), 0) || null;
    return { year, plan, applicants };
  });
  detail.yearAggregates = yearAggregates;

  // ── Component 1: Buffer (current applicants/seat) ─────────────────────
  const latest = yearAggregates[yearAggregates.length - 1];
  if (latest?.applicants != null && latest.plan != null && latest.plan > 0) {
    const ratio = latest.applicants / latest.plan;
    const score = bufferScoreFromRatio(ratio);
    components.push({ key: 'buffer', value: score, weight: L3_WEIGHTS.buffer });
    detail.applicantsPerSeat = ratio;
    detail.bufferScore = score;
    detail.bufferBand =
      ratio <= 1.0
        ? 'past cliff (<1:1)'
        : ratio < 1.5
          ? 'critical (<1.5)'
          : ratio < 3.0
            ? 'moderate (1.5–3.0)'
            : ratio < 5.0
              ? 'strong (3.0–5.0)'
              : 'insulated (≥5.0)';
  } else {
    gaps.push({
      field: 'applicantsPerSeat',
      reason: 'Missing applicants or plan_per_year on the latest complete TCAS cycle',
    });
  }

  // ── Component 2: Trend (5y applicant CAGR) ────────────────────────────
  const applicantSeries = yearAggregates.filter(
    (y): y is { year: number; plan: number | null; applicants: number } => y.applicants != null,
  );
  if (applicantSeries.length >= 3) {
    const firstY = applicantSeries[0];
    const lastY = applicantSeries[applicantSeries.length - 1];
    if (firstY && lastY) {
      const yearsSpan = lastY.year - firstY.year;
      const cagr =
        yearsSpan > 0 ? Math.pow(lastY.applicants / Math.max(1, firstY.applicants), 1 / yearsSpan) - 1 : 0;
      // Negative CAGR pushes score up. -10%/yr → 50; -20%/yr → 100; +5%/yr → 0.
      const score = Math.max(0, Math.min(100, -cagr * 500));
      components.push({ key: 'trend', value: score, weight: L3_WEIGHTS.trend });
      detail.applicantCagrPct = cagr * 100;
      detail.trendScore = score;
    }
  } else {
    gaps.push({
      field: 'applicantTrend',
      reason: 'Need ≥3 years of applicant data for CAGR-based trend',
    });
  }

  // ── Component 3: Forward demographic projection (v1.11) ───────────────
  // programDemographicOutlook scales applicants by the NESDC national-
  // cohort decline; superCriticalYear is when the pool drops below 1.5
  // applicants/seat. A program that never crosses scores 0 (no forward
  // demographic risk) — still a real component, not a gap.
  if (inputs.demographicProjection) {
    const { superCriticalYear, yearsToSuperCritical } = inputs.demographicProjection;
    const score =
      yearsToSuperCritical !== null
        ? projectionScoreFromYearsAway(yearsToSuperCritical)
        : 0;
    components.push({
      key: 'demographicProjection',
      value: score,
      weight: L3_WEIGHTS.demographicProjection,
    });
    detail.superCriticalYear = superCriticalYear;
    detail.demographicProjectionScore = score;
  } else {
    gaps.push({
      field: 'demographicProjection',
      reason: 'No NESDC cohort projection or no TCAS funnel baseline to project forward',
    });
  }

  if (components.length === 0) {
    return { score: null, confidence: 0, detail, gaps };
  }

  const totalWeight = components.reduce((acc, c) => acc + c.weight, 0);
  const weightedScore = components.reduce((acc, c) => acc + c.value * c.weight, 0) / totalWeight;

  return { score: weightedScore, confidence: totalWeight, detail, gaps };
}

// ── Impact ──────────────────────────────────────────────────────────────────

export function computeImpact(inputs: ProgramRiskInputs): ImpactScore {
  const gaps: Array<{ field: string; reason: string }> = [];
  const detail: Record<string, unknown> = {};

  // Drop the in-progress fiscal year — its tuition + cost numbers aren't
  // closed yet and would skew the 5-year revenue projection.
  //
  // IMPORTANT: FinancialMetric.fiscalYear is stored in CE (2021..2026) while
  // TCAS uses BE. Use latestCompleteFiscalYearCE() — NOT the BE helper —
  // for the comparison. The original v1.5 ship used the BE helper, which
  // made the filter a no-op (CE values are always less than BE thresholds)
  // and let partial CE 2026 numbers deflate revenue projections. Fixed in v1.7.
  const completeFY = latestCompleteFiscalYearCE();
  const droppedInProgress = inputs.financial
    .filter((f) => f.fiscalYear > completeFY)
    .map((f) => f.fiscalYear);
  const fin = inputs.financial
    .filter((f) => f.fiscalYear <= completeFY)
    .sort((a, b) => b.fiscalYear - a.fiscalYear)
    .slice(0, 5);
  const latest = fin[0];
  detail.completeThroughFiscalYearCE = completeFY;
  if (droppedInProgress.length > 0) {
    detail.inProgressFiscalYearsExcluded = [...new Set(droppedInProgress)];
  }

  if (!latest) {
    gaps.push({
      field: 'financial',
      reason:
        droppedInProgress.length > 0
          ? `No completed-year FinancialMetric rows (in-progress FY ${droppedInProgress.join(',')} excluded)`
          : 'No FinancialMetric rows',
    });
    return {
      directRevenueAtRiskThb: null,
      strandedCostThb: null,
      totalThb: null,
      normalisedScore: null,
      detail,
      gaps,
    };
  }

  // Direct: latest annual tuition revenue × 5 (rolling 5y projection).
  const annualTuition = latest.tuitionRevenueThb;
  const direct = annualTuition * 5;
  detail.annualTuitionThb = annualTuition;
  detail.fiveYrDirectThb = direct;

  // v1.10: Stranded structural cost is no longer included in the impact
  // total. KKU's financial system tracks tuition revenue (programs) and
  // government salary subsidy (staff payroll) but does NOT carry per-program
  // expense allocation. The cost-allocation methodology is still v0 and the
  // FinancialMetric.allocatedFacultyCost / allocatedFacilityCost / allocatedOverhead
  // fields are placeholder seed data (e.g. constant 15.17M/yr repeated
  // identically across years) — using them produces noise, not signal.
  // Until the cost-allocation methodology lands and Finance Committee
  // signs off, impact = direct revenue at risk only.
  detail.strandedExcludedReason =
    'Cost-allocation methodology v0 not yet validated; allocated cost columns are placeholder values';

  return {
    directRevenueAtRiskThb: direct,
    strandedCostThb: null,
    totalThb: direct,
    normalisedScore: null, // filled by portfolio normaliser
    detail,
    gaps,
  };
}

// ── Composite + tier ────────────────────────────────────────────────────────

export function compositeFromDrivers(
  l1: DriverScore,
  l2: DriverScore,
  l3: DriverScore,
): { composite: number | null; tier: RiskTier; l2EffectiveScore: number | null } {
  // Apply the L2 discount ONLY for composite calculation. Keeps L2's full
  // strength for everything that should reflect AI risk honestly (UI,
  // prompts, recommendations).
  const l2Effective = l2.score != null ? l2.score * L2_COMPOSITE_DISCOUNT : null;
  const scores = [l1.score, l2Effective, l3.score].filter((s): s is number => s != null);
  if (scores.length === 0) {
    return { composite: null, tier: 'NEEDS_DATA', l2EffectiveScore: null };
  }
  // NEEDS_DATA rule: if the only contributing driver is L3 (universal cohort
  // shrinkage that fires identically for every program), there's no
  // program-specific signal and the verdict would mislead. Require at least
  // one of L1/L2 to have data before issuing a tier.
  if (l1.score == null && l2.score == null) {
    return { composite: l3.score, tier: 'NEEDS_DATA', l2EffectiveScore: null };
  }
  const composite = Math.max(...scores);
  let tier: RiskTier;
  if (composite >= TIER_THRESHOLDS.HIGH) tier = 'CRITICAL';
  else if (composite >= TIER_THRESHOLDS.MODERATE) tier = 'HIGH';
  else if (composite >= TIER_THRESHOLDS.LOW) tier = 'MODERATE';
  else tier = 'LOW';
  return { composite, tier, l2EffectiveScore: l2Effective };
}

export function scoreProgramRisk(inputs: ProgramRiskInputs): ProgramRiskResult {
  const l1 = scoreL1Recruitment(inputs);
  const l2 = scoreL2AiDisruption(inputs);
  const l3 = scoreL3Demographic(inputs);
  const { composite, tier: rawTier } = compositeFromDrivers(l1, l2, l3);
  const impact = computeImpact(inputs);
  // v1.8: Risk = Likelihood × Impact. If we can't measure impact, we can't
  // issue a risk verdict — the program drops to NEEDS_DATA regardless of
  // how high the L scores are. The L scores remain visible on the program
  // profile (they're useful per-driver signals) but the program is excluded
  // from comparative viz (bubble chart, composite histogram, KKU matrix
  // cell counts) where the missing axis would be misleading.
  let tier: RiskTier = rawTier;
  if (impact.totalThb == null && rawTier !== 'NEEDS_DATA') {
    tier = 'NEEDS_DATA';
    impact.gaps.push({
      field: 'impact',
      reason: 'No FinancialMetric data — tuition baseline missing, impact unmeasurable',
    });
  }
  return {
    programId: inputs.programId,
    l1Recruitment: l1,
    l2AiDisruption: l2,
    l3Demographic: l3,
    composite,
    tier,
    impact,
    methodologyVersion: RISK_SCORING_VERSION,
  };
}

// ── Loader: build inputs from Prisma ────────────────────────────────────────

export async function loadProgramRiskInputs(programId: string): Promise<ProgramRiskInputs | null> {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: {
      id: true,
      level: true,
      status: true,
      mhesiCode: true,
      enrollmentMetrics: {
        select: {
          academicYear: true,
          applications: true,
          admitted: true,
          enrolled: true,
          dropouts: true,
        },
        orderBy: { academicYear: 'asc' },
      },
      programSkills: {
        select: {
          weight: true,
          skill: { select: { id: true, nameEn: true, nameTh: true, automationRisk: true } },
        },
      },
      aiReadinessAssessment: {
        select: {
          relevanceScore: true,
          methodVersion: true,
          payloadJson: true,
        },
      },
      financialMetrics: {
        select: {
          fiscalYear: true,
          tuitionRevenue: true,
          otherRevenue: true,
          directCost: true,
          allocatedFacultyCost: true,
          allocatedFacilityCost: true,
          allocatedOverhead: true,
        },
        orderBy: { fiscalYear: 'asc' },
      },
    },
  });

  if (!program) return null;

  // 5-year recruitment funnel from ADMISSION_STAT via the adapter (per
  // year × round; annual plan replicated per round). realData-gated.
  const tcasFunnel = await programFunnelRoundRows(programId);

  const competitivenessPercentile = await computeCompetitivenessPercentile(programId, program.level);

  // Overlap KRIs 6–7 (risk-scoring.v1.14).
  const overlap = await loadOverlapRiskSignal(programId, program.level);

  // Forward demographic projection — L3 v1.11's third component.
  const demoOutlook = await programDemographicOutlook(programId);
  let demographicProjection: ProgramRiskInputs['demographicProjection'] = null;
  if (demoOutlook && demoOutlook.funnelBaseline && demoOutlook.projections.length > 0) {
    const anchorYear = demoOutlook.projections[0]!.year;
    demographicProjection = {
      superCriticalYear: demoOutlook.superCriticalYear,
      yearsToSuperCritical:
        demoOutlook.superCriticalYear !== null
          ? Math.max(0, demoOutlook.superCriticalYear - anchorYear)
          : null,
    };
  }

  // Map ProgramAiReadinessAssessment.payloadJson into the typed shape L2 needs.
  // Payload conforms to ProgramAiReadinessAssessmentSchema in @kku/shared.
  let aiReadiness: ProgramRiskInputs['aiReadiness'] = null;
  if (program.aiReadinessAssessment) {
    type AiReadinessPayload = {
      summary?: string;
      gaps?: Array<{ topic: string; severity: 'major' | 'moderate' | 'minor'; observation: string }>;
      recommendations?: Array<{
        priority: 'high' | 'medium' | 'low';
        title: string;
        detail: string;
      }>;
    };
    const payload = program.aiReadinessAssessment.payloadJson as AiReadinessPayload;
    aiReadiness = {
      relevanceScore: program.aiReadinessAssessment.relevanceScore,
      methodVersion: program.aiReadinessAssessment.methodVersion,
      summary: payload?.summary ?? null,
      gaps: Array.isArray(payload?.gaps)
        ? payload.gaps.map((g) => ({
            topic: g.topic,
            severity: g.severity,
            observation: g.observation,
          }))
        : [],
      recommendations: Array.isArray(payload?.recommendations)
        ? payload.recommendations.map((r) => ({
            priority: r.priority,
            title: r.title,
            detail: r.detail,
          }))
        : [],
    };
  }

  return {
    programId: program.id,
    level: program.level,
    status: program.status,
    tcasFunnel,
    enrollment: program.enrollmentMetrics,
    skills: program.programSkills.map((ps) => ({
      skillId: ps.skill.id,
      nameEn: ps.skill.nameEn,
      nameTh: ps.skill.nameTh,
      automationRisk: ps.skill.automationRisk,
      weight: ps.weight ?? 0.5,
    })),
    aiReadiness,
    financial: program.financialMetrics.map((f) => ({
      fiscalYear: f.fiscalYear,
      tuitionRevenueThb: f.tuitionRevenue.toNumber(),
      otherRevenueThb: f.otherRevenue.toNumber(),
      directCostThb: f.directCost.toNumber(),
      allocatedFacultyCostThb: f.allocatedFacultyCost.toNumber(),
      allocatedFacilityCostThb: f.allocatedFacilityCost.toNumber(),
      allocatedOverheadThb: f.allocatedOverhead.toNumber(),
    })),
    competitivenessPercentile,
    demographicProjection,
    overlap,
  };
}

// Compute a program's competitiveness percentile vs same-level peers within
// KKU. Defined as: per-program, take the latest-year applicants / planPerYear
// (TCAS competition ratio); rank programs descending; emit percentile.
// Higher = more competitive (more applicants per seat).
async function computeCompetitivenessPercentile(
  programId: string,
  level: ProgramLevel,
): Promise<number | null> {
  // Same in-progress-year exclusion as L1 + KRIs. The ratio is computed off
  // the latest COMPLETED cycle for fair cross-program comparison.
  const completeThroughBE = latestCompleteEntryYearBE();
  // Competition ratio = applicants / plan, per program, for its latest
  // complete cohort. Source: admission_campaign_stats (ADMISSION_STAT).
  // Plan = Σ over sub-programs (PROGRAMID) of MAX(plan) — never MAX-across-
  // rounds, which would undercount a program that runs several intakes.
  const rows = await prisma.$queryRaw<Array<{ program_id: string; ratio: number }>>(Prisma.sql`
    WITH eligible AS (
      SELECT c.program_id, c.recruitment_program_id, c.round, c.campaign_name, c.acad_year_be,
             c.total_applicants, c.plan_per_year
      FROM admission_campaign_stats c
      JOIN programs p ON p.id = c.program_id
      WHERE p.level = ${level}::"ProgramLevel"
        AND p.status = 'ACTIVE'
        AND c.acad_year_be <= ${completeThroughBE}
        AND ${realDataSql('c')}
    ),
    latest AS (SELECT program_id, MAX(acad_year_be) AS y FROM eligible GROUP BY program_id),
    scoped AS (
      SELECT e.* FROM eligible e JOIN latest l ON l.program_id = e.program_id AND e.acad_year_be = l.y
    ),
    plan_by_prog AS (
      SELECT program_id, SUM(pp) AS plan FROM (
        SELECT program_id, ${campaignPlanKeySql('scoped')} AS plan_key, MAX(plan_per_year) AS pp
        FROM scoped GROUP BY program_id, plan_key
      ) s GROUP BY program_id
    ),
    apps_by_prog AS (
      SELECT program_id, SUM(COALESCE(total_applicants, 0))::float AS apps FROM scoped GROUP BY program_id
    )
    SELECT a.program_id, a.apps / NULLIF(pb.plan, 0) AS ratio
    FROM apps_by_prog a JOIN plan_by_prog pb ON pb.program_id = a.program_id
    WHERE pb.plan > 0
  `);

  if (rows.length === 0) return null;
  const target = rows.find((r) => r.program_id === programId);
  if (!target) return null;

  const sorted = rows.map((r) => r.ratio).sort((a, b) => a - b);
  const rank = sorted.findIndex((r) => r >= target.ratio); // 0-based ascending rank
  // Percentile: where this row sits in the distribution (0=worst, 100=best).
  return Math.round((rank / Math.max(1, sorted.length - 1)) * 100);
}

// ── Portfolio rollup ────────────────────────────────────────────────────────

export interface PortfolioRiskRow {
  programId: string;
  programCode: string;
  programNameTh: string;
  programNameEn: string;
  curriculumYearBE: number | null;
  facultyId: string;
  facultyNameTh: string;
  facultyNameEn: string;
  composite: number | null;
  tier: RiskTier;
  l1: number | null;
  l2: number | null;
  l3: number | null;
  directRevenueAtRiskThb: number | null;
  strandedCostThb: number | null;
  impactScore: number | null;
  // KKU 5×5 matrix view
  likelihoodBin: number | null;
  impactBin: number | null;
  kkuMatrixScore: number | null;
  kkuRiskLevel: KkuRiskLevel;
  assessedAt: Date;
}

/**
 * Most-recent assessment per program at portfolio level.
 * Filters to undergraduate by default.
 */
export async function listPortfolioRisk(opts?: {
  level?: ProgramLevel;
  /** Single-faculty clamp (back-compat). Either this OR facultyIds. */
  facultyId?: string;
  /** Multi-scope: UNION of program rows in any of these faculties. */
  facultyIds?: string[];
  /** Single-program clamp (back-compat). Either this OR programIds. */
  programId?: string;
  /** Multi-scope: UNION of these specific programs. */
  programIds?: string[];
  tier?: RiskTier;
}): Promise<PortfolioRiskRow[]> {
  const level = opts?.level ?? 'BACHELOR';
  // Normalise scope clauses. When both facultyIds + programIds are set
  // (a mixed-scope user has both faculty-wide and program-specific
  // grants), the WHERE becomes an OR — show programs that match either.
  // Single-value back-compat: `facultyId` → `facultyIds: [facultyId]`.
  const facultyIdSet = new Set<string>([
    ...(opts?.facultyId ? [opts.facultyId] : []),
    ...(opts?.facultyIds ?? []),
  ]);
  const programIdSet = new Set<string>([
    ...(opts?.programId ? [opts.programId] : []),
    ...(opts?.programIds ?? []),
  ]);
  let scopeClause: Prisma.Sql = Prisma.empty;
  if (facultyIdSet.size > 0 && programIdSet.size > 0) {
    scopeClause = Prisma.sql`AND (p.faculty_id IN (${Prisma.join([...facultyIdSet])}) OR p.id IN (${Prisma.join([...programIdSet])}))`;
  } else if (facultyIdSet.size > 0) {
    scopeClause = Prisma.sql`AND p.faculty_id IN (${Prisma.join([...facultyIdSet])})`;
  } else if (programIdSet.size > 0) {
    scopeClause = Prisma.sql`AND p.id IN (${Prisma.join([...programIdSet])})`;
  }
  // Legacy named bindings kept for the existing SQL template below.
  const facultyClause = Prisma.empty;
  const programClause = Prisma.empty;
  const tierClause = opts?.tier ? Prisma.sql`AND ra.tier = ${opts.tier}::"RiskTier"` : Prisma.empty;

  const rows = await prisma.$queryRaw<
    Array<{
      program_id: string;
      program_code: string;
      program_name_th: string;
      program_name_en: string;
      program_curriculum_year_be: number | null;
      faculty_id: string;
      faculty_name_th: string;
      faculty_name_en: string;
      composite_score: number | null;
      tier: RiskTier;
      l1_recruitment_score: number | null;
      l2_ai_disruption_score: number | null;
      l3_demographic_score: number | null;
      direct_revenue_at_risk_thb: Prisma.Decimal | null;
      stranded_cost_thb: Prisma.Decimal | null;
      impact_score: number | null;
      likelihood_bin: number | null;
      impact_bin: number | null;
      kku_matrix_score: number | null;
      kku_risk_level: KkuRiskLevel;
      assessed_at: Date;
    }>
  >(Prisma.sql`
    WITH latest AS (
      SELECT DISTINCT ON (program_id)
        id, program_id, assessed_at, composite_score, tier,
        l1_recruitment_score, l2_ai_disruption_score, l3_demographic_score,
        direct_revenue_at_risk_thb, stranded_cost_thb, impact_score,
        likelihood_bin, impact_bin, kku_matrix_score, kku_risk_level
      FROM risk_assessments
      ORDER BY program_id, assessed_at DESC
    )
    SELECT
      p.id AS program_id,
      p.code AS program_code,
      p.name_th AS program_name_th,
      p.name_en AS program_name_en,
      p.curriculum_year_be AS program_curriculum_year_be,
      p.faculty_id,
      f.name_th AS faculty_name_th,
      f.name_en AS faculty_name_en,
      ra.composite_score,
      ra.tier,
      ra.l1_recruitment_score,
      ra.l2_ai_disruption_score,
      ra.l3_demographic_score,
      ra.direct_revenue_at_risk_thb,
      ra.stranded_cost_thb,
      ra.impact_score,
      ra.likelihood_bin,
      ra.impact_bin,
      ra.kku_matrix_score,
      ra.kku_risk_level,
      ra.assessed_at
    FROM programs p
    INNER JOIN latest ra ON ra.program_id = p.id
    INNER JOIN faculties f ON f.id = p.faculty_id
    WHERE p.level = ${level}::"ProgramLevel"
      AND p.status = 'ACTIVE'
      ${scopeClause}
      ${facultyClause}
      ${programClause}
      ${tierClause}
    ORDER BY ra.composite_score DESC NULLS LAST, p.name_th ASC
  `);

  return rows.map((r) => ({
    programId: r.program_id,
    programCode: r.program_code,
    programNameTh: r.program_name_th,
    programNameEn: r.program_name_en,
    curriculumYearBE: r.program_curriculum_year_be,
    facultyId: r.faculty_id,
    facultyNameTh: r.faculty_name_th,
    facultyNameEn: r.faculty_name_en,
    composite: r.composite_score,
    tier: r.tier,
    l1: r.l1_recruitment_score,
    l2: r.l2_ai_disruption_score,
    l3: r.l3_demographic_score,
    directRevenueAtRiskThb: r.direct_revenue_at_risk_thb?.toNumber() ?? null,
    strandedCostThb: r.stranded_cost_thb?.toNumber() ?? null,
    impactScore: r.impact_score,
    likelihoodBin: r.likelihood_bin,
    impactBin: r.impact_bin,
    kkuMatrixScore: r.kku_matrix_score,
    kkuRiskLevel: r.kku_risk_level,
    assessedAt: r.assessed_at,
  }));
}

// ── University averages ─────────────────────────────────────────────────────

export interface UniversityAverages {
  level: ProgramLevel;
  programCount: number;
  l1: number | null;
  l2: number | null;
  l3: number | null;
  composite: number | null;
  impactScore: number | null;
  kkuMatrixScore: number | null;
}

/**
 * Mean L1/L2/L3/composite/impactScore/kkuMatrixScore across the latest
 * assessment per program at the specified level. Used to overlay the
 * university average on the per-program radar chart.
 */
export async function getUniversityAverages(
  level: ProgramLevel = 'BACHELOR',
): Promise<UniversityAverages> {
  const rows = await prisma.$queryRaw<
    Array<{
      l1: number | null;
      l2: number | null;
      l3: number | null;
      composite: number | null;
      impact_score: number | null;
      kku_matrix_score: number | null;
    }>
  >(Prisma.sql`
    SELECT
      AVG(l1_recruitment_score)::float AS l1,
      AVG(l2_ai_disruption_score)::float AS l2,
      AVG(l3_demographic_score)::float AS l3,
      AVG(composite_score)::float AS composite,
      AVG(impact_score)::float AS impact_score,
      AVG(kku_matrix_score)::float AS kku_matrix_score
    FROM (
      SELECT DISTINCT ON (program_id)
        program_id, l1_recruitment_score, l2_ai_disruption_score,
        l3_demographic_score, composite_score, impact_score, kku_matrix_score
      FROM risk_assessments
      ORDER BY program_id, assessed_at DESC
    ) t
    JOIN programs p ON p.id = (
      SELECT program_id FROM risk_assessments WHERE id = (
        SELECT id FROM risk_assessments
        WHERE program_id = t.program_id
        ORDER BY assessed_at DESC LIMIT 1
      )
    )
    WHERE p.level = ${level}::"ProgramLevel" AND p.status = 'ACTIVE'
  `);
  const cnt = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(*)::bigint AS count
    FROM (
      SELECT DISTINCT ON (program_id) program_id
      FROM risk_assessments
      ORDER BY program_id, assessed_at DESC
    ) t
    JOIN programs p ON p.id = t.program_id
    WHERE p.level = ${level}::"ProgramLevel" AND p.status = 'ACTIVE'
  `);
  const r = rows[0];
  return {
    level,
    programCount: cnt[0] ? Number(cnt[0].count) : 0,
    l1: r?.l1 ?? null,
    l2: r?.l2 ?? null,
    l3: r?.l3 ?? null,
    composite: r?.composite ?? null,
    impactScore: r?.impact_score ?? null,
    kkuMatrixScore: r?.kku_matrix_score ?? null,
  };
}

// ── Impact normalisation ────────────────────────────────────────────────────

/**
 * Recompute the 0-100 normalised impactScore across all latest assessments
 * for a given level, then derive the KKU 5×5 matrix score + level for each.
 * Should run after a pipeline batch completes.
 *
 * Formula: log10(totalThb) min-max scaled across the population. Log scale
 * because revenue distribution is right-skewed — without log, a few large
 * faculty programs would max out the scale and squash everyone else into 0-5.
 *
 * Same pass also writes likelihoodBin, impactBin, kkuMatrixScore, and
 * kkuRiskLevel based on the freshly computed impactScore + the assessment's
 * existing compositeScore. Single transaction per row.
 *
 * NEEDS_DATA tier programs are forced to KKU level = NEEDS_DATA regardless
 * of math — if the analytic verdict is "data-thin", the institutional
 * matrix shouldn't emit a confident green/yellow/orange/red for it.
 */
export async function normaliseImpactScores(level: ProgramLevel = 'BACHELOR'): Promise<number> {
  const latest = await prisma.$queryRaw<
    Array<{ id: string; total: number | null; composite_score: number | null; tier: RiskTier }>
  >(Prisma.sql`
    WITH latest AS (
      SELECT DISTINCT ON (program_id) id, program_id, composite_score, tier,
        COALESCE(direct_revenue_at_risk_thb, 0) + COALESCE(stranded_cost_thb, 0) AS total
      FROM risk_assessments
      ORDER BY program_id, assessed_at DESC
    )
    SELECT ra.id, ra.total::float, ra.composite_score, ra.tier
    FROM latest ra
    JOIN programs p ON p.id = (
      SELECT program_id FROM risk_assessments WHERE id = ra.id
    )
    WHERE p.level = ${level}::"ProgramLevel" AND p.status = 'ACTIVE'
  `);

  const totals = latest.map((r) => r.total).filter((t): t is number => t != null && t > 0);
  if (totals.length === 0) return 0;

  const logs = totals.map((t) => Math.log10(t));
  const minLog = Math.min(...logs);
  const maxLog = Math.max(...logs);
  const range = Math.max(0.01, maxLog - minLog);

  let updated = 0;
  for (const row of latest) {
    let impactScore: number;
    if (row.total == null || row.total <= 0) {
      impactScore = 0;
    } else {
      impactScore = Math.round(((Math.log10(row.total) - minLog) / range) * 100);
    }
    const matrix = deriveKkuMatrix(row.composite_score, impactScore);
    // NEEDS_DATA tier override: don't issue a numeric KKU score when the
    // analytic verdict is suspended.
    const isNeedsData = row.tier === 'NEEDS_DATA';
    await prisma.riskAssessment.update({
      where: { id: row.id },
      data: {
        impactScore,
        likelihoodBin: isNeedsData ? null : matrix.likelihoodBin,
        impactBin: isNeedsData ? null : matrix.impactBin,
        kkuMatrixScore: isNeedsData ? null : matrix.matrixScore,
        kkuRiskLevel: isNeedsData ? 'NEEDS_DATA' : matrix.level,
      },
    });
    updated += 1;
  }
  return updated;
}

// ── KRI evaluation ──────────────────────────────────────────────────────────

export interface KriBreach {
  programId: string;
  indicatorSlug: string;
  value: number | null;
  severity: 'OK' | 'WARN' | 'CRITICAL';
  freshnessDate: Date;
}

/**
 * Compute breach severity for the v1 KRI set against a program's inputs.
 * Pure — no DB writes. Caller persists the resulting RiskIndicatorBreach rows.
 */
export function evaluateKris(inputs: ProgramRiskInputs, freshnessDate: Date): KriBreach[] {
  const out: KriBreach[] = [];
  // Drop in-progress cycle — KRIs measure "latest completed cycle".
  const completeThroughBE = latestCompleteEntryYearBE(freshnessDate);
  const funnel = inputs.tcasFunnel.filter((r) => r.entryYearBE <= completeThroughBE);
  const recentYears = [...new Set(funnel.map((r) => r.entryYearBE))].sort();
  const latestYear = recentYears[recentYears.length - 1];
  const latestRows = funnel.filter((r) => r.entryYearBE === latestYear);
  const plan = Math.max(...latestRows.map((r) => r.planPerYear ?? 0), 0) || null;
  const applicants = latestRows.reduce((acc, r) => acc + (r.totalApplicants ?? 0), 0);
  const reported = latestRows.reduce((acc, r) => acc + (r.regReported ?? 0), 0);

  // KRI 1: application-to-seat ratio
  if (plan != null && plan > 0 && applicants > 0) {
    const ratio = applicants / plan;
    out.push({
      programId: inputs.programId,
      indicatorSlug: 'application_seat_ratio',
      value: ratio,
      severity: ratio < 1.0 ? 'CRITICAL' : ratio < 1.5 ? 'WARN' : 'OK',
      freshnessDate,
    });
  }

  // KRI 2: enrollment fill rate
  if (plan != null && plan > 0) {
    const fill = reported / plan;
    out.push({
      programId: inputs.programId,
      indicatorSlug: 'enrollment_fill_rate',
      value: fill,
      severity: fill < 0.5 ? 'CRITICAL' : fill < 0.7 ? 'WARN' : 'OK',
      freshnessDate,
    });
  }

  // KRI 3: late-round dependency
  if (reported > 0) {
    const lateReported = latestRows
      .filter((r) => {
        const n = parseFloat(r.round);
        return Number.isFinite(n) && n >= 3;
      })
      .reduce((acc, r) => acc + (r.regReported ?? 0), 0);
    const share = lateReported / reported;
    out.push({
      programId: inputs.programId,
      indicatorSlug: 'late_round_dependency',
      value: share,
      severity: share > 0.7 ? 'CRITICAL' : share > 0.5 ? 'WARN' : 'OK',
      freshnessDate,
    });
  }

  // KRI 4: skill automation index
  if (inputs.skills.length > 0) {
    const known = inputs.skills.filter((s) => s.automationRisk !== 'UNKNOWN').length;
    if (known > 0) {
      const high = inputs.skills.filter((s) => s.automationRisk === 'HIGH').length;
      const idx = high / inputs.skills.length;
      out.push({
        programId: inputs.programId,
        indicatorSlug: 'skill_automation_index',
        value: idx,
        severity: idx > 0.6 ? 'CRITICAL' : idx > 0.3 ? 'WARN' : 'OK',
        freshnessDate,
      });
    }
  }

  // KRI 5: bachelor intake floor (KKU policy)
  if (inputs.level === 'BACHELOR' && reported > 0) {
    out.push({
      programId: inputs.programId,
      indicatorSlug: 'bachelor_intake_floor',
      value: reported,
      severity:
        reported < KKU_INTAKE_FLOOR_BACHELOR
          ? 'CRITICAL'
          : reported < KKU_INTAKE_FLOOR_BACHELOR * 1.2
          ? 'WARN'
          : 'OK',
      freshnessDate,
    });
  }

  // KRIs 6–7: programme overlap (program-overlap.v1). No row until a run
  // covers the programme. Once one does, each KRI always emits a row so a
  // stale breach is superseded: a programme with no stored value reads OK
  // with a null value (every pair is below the storage floor, which sits
  // below WARN). Values are maxima over stored pairs — see
  // program-overlap/risk.ts.
  // Covered is not measured: a programme its covering run did not measure on
  // courses (no major course) gets no curriculum row at all — never an OK
  // that would read as "no overlap".
  if (inputs.overlap) {
    const c = inputs.overlap.curriculumOverlapMax;
    const raw = c == null ? 'OK' : c >= CURRICULUM_OVERLAP_CRITICAL ? 'CRITICAL' : c >= CURRICULUM_OVERLAP_WARN ? 'WARN' : 'OK';
    if (inputs.overlap.curriculumMeasured !== false) {
      out.push({
        programId: inputs.programId,
        indicatorSlug: 'curriculum_overlap_max',
        value: c,
        // The index is course-based (program-overlap D9), so no evidence cap.
        severity: raw,
        freshnessDate,
      });
    }
    const m = inputs.overlap.marketConfusionMax;
    out.push({
      programId: inputs.programId,
      indicatorSlug: 'market_confusion_max',
      value: m,
      severity: m == null ? 'OK' : m >= MARKET_CONFUSION_CRITICAL ? 'CRITICAL' : m >= MARKET_CONFUSION_WARN ? 'WARN' : 'OK',
      freshnessDate,
    });
  }

  return out;
}

// ── Indicator catalog (seeded by the pipeline on first run) ────────────────

// Overlap KRI thresholds (0–100 scale). Curriculum overlap reuses the
// overlap bands so the KRI and the Education overlap page agree.
export const CURRICULUM_OVERLAP_WARN = OVERLAP_THRESHOLDS.bandModerate; // 50
export const CURRICULUM_OVERLAP_CRITICAL = OVERLAP_THRESHOLDS.bandHigh; // 70
// Market confusion: calibrated 2026-10-03 (spec §12) — defined once in
// OVERLAP_THRESHOLDS (marketConfusionWarn / marketConfusion), which also drive
// pair storage and the DIFFERENTIATE action. Changing them after release
// bumps RISK_SCORING_VERSION and PROGRAM_OVERLAP_VERSION.
export const MARKET_CONFUSION_WARN = OVERLAP_THRESHOLDS.marketConfusionWarn; // 60
export const MARKET_CONFUSION_CRITICAL = OVERLAP_THRESHOLDS.marketConfusion; // 75

export const RISK_INDICATOR_CATALOG = [
  {
    slug: 'application_seat_ratio',
    labelTh: 'อัตราส่วนผู้สมัครต่อที่นั่ง',
    labelEn: 'Application-to-seat ratio',
    descriptionTh:
      'ผู้สมัครรวมในปีล่าสุดหารด้วยที่นั่งตามแผนต่อปี — สัญญาณความน่าสนใจของหลักสูตร',
    descriptionEn: 'Latest-year total applicants ÷ planned annual seats — program desirability signal',
    formula: 'SUM(total_applicants) / MAX(plan_per_year) for latest entry_year_be',
    warnThreshold: 1.5,
    criticalThreshold: 1.0,
    alarmDirection: 'low',
  },
  {
    slug: 'enrollment_fill_rate',
    labelTh: 'อัตราการเข้าศึกษา',
    labelEn: 'Enrollment fill rate',
    descriptionTh: 'จำนวนรายงานตัวจริงหารด้วยที่นั่งตามแผน — บอกสภาพการเติมที่นั่ง',
    descriptionEn: 'Reported registered ÷ planned annual seats — measures seat utilisation',
    formula: 'SUM(reg_reported) / MAX(plan_per_year) for latest entry_year_be',
    warnThreshold: 0.7,
    criticalThreshold: 0.5,
    alarmDirection: 'low',
  },
  {
    slug: 'late_round_dependency',
    labelTh: 'การพึ่งพารอบท้าย',
    labelEn: 'Late-round dependency',
    descriptionTh: 'สัดส่วนนักเรียนที่รับในรอบ 3 และ 4 ของ TCAS — บ่งชี้ดีมานด์อ่อนในรอบหลัก',
    descriptionEn: 'Share of admits in TCAS rounds 3 + 4 — flags weak demand in primary rounds',
    formula: 'Late-round reg_reported ÷ total reg_reported',
    warnThreshold: 0.5,
    criticalThreshold: 0.7,
    alarmDirection: 'high',
  },
  {
    slug: 'skill_automation_index',
    labelTh: 'ดัชนีความเสี่ยงต่อ AI ของทักษะ',
    labelEn: 'Skill automation index',
    descriptionTh: 'สัดส่วนทักษะที่ระบุว่ามีความเสี่ยงต่อการถูกแทนที่ด้วย AI สูง',
    descriptionEn: 'Share of program skills tagged HIGH automation risk',
    formula: 'COUNT(skills WHERE automation_risk = HIGH) / COUNT(skills)',
    warnThreshold: 0.3,
    criticalThreshold: 0.6,
    alarmDirection: 'high',
  },
  {
    slug: 'bachelor_intake_floor',
    labelTh: 'จำนวนรับขั้นต่ำตามนโยบาย (ป.ตรี)',
    labelEn: 'Bachelor intake floor (KKU policy)',
    descriptionTh: 'นโยบายสภามหาวิทยาลัย: หลักสูตรปริญญาตรีต้องรับนักศึกษาใหม่อย่างน้อย 30 คน/ปี',
    descriptionEn: 'Council policy: bachelor programs must enroll ≥30 new students per year',
    formula: 'SUM(reg_reported) for latest entry_year_be',
    warnThreshold: 36,
    criticalThreshold: 30,
    alarmDirection: 'low',
  },
  {
    slug: 'curriculum_overlap_max',
    labelTh: 'ความซ้ำซ้อนของหลักสูตรกับหลักสูตรอื่นระดับเดียวกัน',
    labelEn: 'Curriculum overlap with a sibling programme',
    descriptionTh:
      'ดัชนีความซ้ำซ้อนของหลักสูตรสูงสุดเมื่อเทียบกับหลักสูตรอื่นของ มข. ในระดับเดียวกัน (คิดจากรายวิชาเท่านั้น: รายวิชาเอกร่วมและรายวิชาเอกที่เทียบเท่ากัน) ไม่รวมหลักสูตรคู่ภาษา',
    descriptionEn:
      'Highest curriculum overlap index (courses only: shared and equivalent major courses) against any same-level KKU programme, excluding language variants',
    formula: 'MAX(overlap_index) over the programme\'s current same-level overlap pairs (program-overlap.v1), language_variant = false',
    warnThreshold: CURRICULUM_OVERLAP_WARN,
    criticalThreshold: CURRICULUM_OVERLAP_CRITICAL,
    alarmDirection: 'high',
  },
  {
    slug: 'market_confusion_max',
    labelTh: 'ความสับสนทางการตลาดกับหลักสูตรอื่นระดับเดียวกัน',
    labelEn: 'Market confusion with a sibling programme',
    descriptionTh:
      'ความคล้ายคลึงสูงสุดของข้อความประชาสัมพันธ์หลักสูตร (ชื่อปริญญา คำอธิบายรับสมัคร อาชีพ) เมื่อเทียบกับหลักสูตรอื่นของ มข. ในระดับเดียวกัน ไม่รวมหลักสูตรคู่ภาษา',
    descriptionEn:
      'Highest market-facing similarity (degree names, recruitment summary, careers) against any same-level KKU programme, excluding language variants',
    formula: 'MAX(market_similarity) over the programme\'s current same-level overlap pairs (program-overlap.v1), language_variant = false',
    warnThreshold: MARKET_CONFUSION_WARN,
    criticalThreshold: MARKET_CONFUSION_CRITICAL,
    alarmDirection: 'high',
  },
] as const;
