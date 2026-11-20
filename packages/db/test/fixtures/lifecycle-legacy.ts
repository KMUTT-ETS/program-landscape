// TEMPORARY — deleted once the lifecycle refactor is proven equal.
//
// A frozen, verbatim copy of the lifecycle.v1.4 maths as it stood in
// packages/db/src/program-deep-dive.ts before the refactor, with the Prisma
// fetches replaced by `inputs.*` reads and the snapshot upsert dropped.
// lifecycle-equivalence.test.ts compares the new computeLifecycle() with it.
// Never "fix" this file to make the comparison pass.

import type { ProgramLifecycleVerdict } from '@prisma/client';
import type { HealthDimension, HealthScoreRow } from '../../src/health-score';
import {
  FLAGSHIP_REVENUE_FLOOR_THB,
  REVENUE_TARGET_THB_BY_LEVEL,
} from '../../src/health-score/tuning';
import type {
  LifecycleGateEffect,
  LifecycleInputs,
  ProgramLifecycleDriver,
  ProgramLifecycleResult,
} from '../../src/lifecycle/types';

const LIFECYCLE_VERSION = 'lifecycle.v1.4';

function computeRevenueScaleContribution(
  latestAnnualRevenueThb: number | null,
  level: keyof typeof REVENUE_TARGET_THB_BY_LEVEL | string | null,
): number {
  if (latestAnnualRevenueThb === null || latestAnnualRevenueThb <= 0) return 0;
  if (!level || !(level in REVENUE_TARGET_THB_BY_LEVEL)) return 0;
  const target = REVENUE_TARGET_THB_BY_LEVEL[level as keyof typeof REVENUE_TARGET_THB_BY_LEVEL];
  const ratio = latestAnnualRevenueThb / target;
  if (ratio >= 1.5) return 10;
  if (ratio >= 1.0) return 5;
  if (ratio >= 0.5) return 0;
  if (ratio >= 0.25) return -5;
  return -10;
}

export function legacyComputeLifecycle(
  inputs: LifecycleInputs,
): Omit<ProgramLifecycleResult, 'generatedAt'> {
  const health = inputs.health;
  const aiReadiness = inputs.aiReadiness;
  const peerReviewRow = inputs.peerReview === null ? null : { payloadJson: inputs.peerReview };
  const cohorts = inputs.cohorts;
  const program = { level: inputs.level };
  const latestAnnualRevenueThb = inputs.latestAnnualRevenueThb;
  const latestRevenueFiscalYear = inputs.latestRevenueFiscalYear;

  // ── Driver 1: overall health (central signal, weight 0.4) ────────
  const overall = health?.overall.score ?? null;
  const healthDriver: ProgramLifecycleDriver = {
    label: 'health_overall',
    contribution: overall === null ? 0 : (overall - 50) * 0.4,
    raw: { score: overall, completeness: health?.overall.dataCompletenessPct ?? 0 },
  };

  // ── Driver 0 (heaviest): AI readiness ────────────────────────────
  const aiReadinessDriver: ProgramLifecycleDriver = {
    label: 'ai_readiness',
    contribution: (aiReadiness.overallScore - 50) * 0.5,
    raw: {
      score: aiReadiness.overallScore,
      curriculumIntegration: aiReadiness.subScores.curriculumIntegration,
      skillResilience: aiReadiness.subScores.skillResilience,
      researchPresence: aiReadiness.subScores.researchPresence,
    },
  };

  // ── Driver 2: enrollment trend slope (from attractiveness) ───────
  const enrollmentTrendDriver = extractDriverFromHealth(
    health,
    'attractiveness',
    'enrollment_trend_slope',
    (v) => (v - 50) * 0.6,
    'enrollment_trend',
    15,
  );

  // ── Driver 3: tuition trend slope (from financial) ───────────────
  const tuitionTrendDriver = extractDriverFromHealth(
    health,
    'financial',
    'tuition_trend_slope',
    (v) => (v - 50) * 0.4,
    'tuition_trend',
    10,
  );

  // ── Driver 4: content modernity ──────────────────────────────────
  const reviewPayload = peerReviewRow?.payloadJson as
    | { contentModernity?: { verdict: string }; contentGaps?: Array<{ severity: string }> }
    | null
    | undefined;
  let modernityContribution = 0;
  let modernityVerdict: string | null = null;
  if (reviewPayload?.contentModernity) {
    modernityVerdict = reviewPayload.contentModernity.verdict;
    if (modernityVerdict === 'FRONTIER') modernityContribution = 10;
    else if (modernityVerdict === 'OLD_SCHOOL') modernityContribution = -10;
  }
  const modernityDriver: ProgramLifecycleDriver = {
    label: 'content_modernity',
    contribution: modernityContribution,
    raw: { verdict: modernityVerdict ?? 'unknown' },
  };

  // ── Driver 4b: labour-market alignment ───────────────────────────
  const labourMarketScore =
    health?.dimensions.relevance.drivers.find((d) => d.label === 'labour_market_alignment')
      ?.value ?? null;
  const labourMarketDriver: ProgramLifecycleDriver = {
    label: 'labour_market_alignment',
    contribution:
      labourMarketScore === null
        ? 0
        : labourMarketScore >= 70
          ? 15
          : labourMarketScore >= 50
            ? 5
            : labourMarketScore >= 30
              ? -5
              : -15,
    raw: { score: labourMarketScore },
  };

  // ── Driver 5: major content gaps (penalty) ───────────────────────
  const majorGapCount =
    reviewPayload?.contentGaps?.filter((g) => g.severity === 'major').length ?? 0;
  const gapDriver: ProgramLifecycleDriver = {
    label: 'major_content_gaps',
    contribution: -Math.min(majorGapCount * 4, 12),
    raw: { count: majorGapCount },
  };

  // ── Driver 6: demographic resilience ─────────────────────────────
  const resilienceScore =
    health?.dimensions.relevance.drivers.find((d) => d.label === 'demographic_resilience')?.value ?? null;
  const resilienceDriver: ProgramLifecycleDriver = {
    label: 'demographic_resilience',
    contribution:
      resilienceScore === null
        ? 0
        : resilienceScore >= 80
          ? 10
          : resilienceScore >= 50
            ? 0
            : -10,
    raw: { score: resilienceScore, riskLevel: inputs.demographicRiskLevel ?? 'unknown' },
  };

  // ── Driver 7: delayed graduation share (cohort) ──────────────────
  const delayedShare =
    cohorts.totalActive > 0 ? cohorts.delayedCount / cohorts.totalActive : 0;
  const delayedDriver: ProgramLifecycleDriver = {
    label: 'delayed_graduation_share',
    contribution:
      delayedShare === 0
        ? 0
        : delayedShare >= 0.25
          ? -10
          : delayedShare >= 0.15
            ? -5
            : delayedShare >= 0.05
              ? -2
              : 0,
    raw: { delayedPct: delayedShare * 100 },
  };

  // ── Driver 8: capability strength ────────────────────────────────
  const capabilityScore = health?.dimensions.capability.score ?? null;
  const capabilityDriver: ProgramLifecycleDriver = {
    label: 'capability_strength',
    contribution:
      capabilityScore === null
        ? 0
        : capabilityScore >= 80
          ? 8
          : capabilityScore >= 60
            ? 3
            : capabilityScore < 40
              ? -8
              : 0,
    raw: { score: capabilityScore },
  };

  // ── Driver 4c: revenue scale ─────────────────────────────────────
  const revenueScaleDriver: ProgramLifecycleDriver = {
    label: 'revenue_scale',
    contribution: computeRevenueScaleContribution(latestAnnualRevenueThb, program?.level ?? null),
    raw: {
      latestAnnualRevenueThb,
      fiscalYear: latestRevenueFiscalYear,
      level: program?.level ?? null,
      target: program?.level
        ? REVENUE_TARGET_THB_BY_LEVEL[program.level as keyof typeof REVENUE_TARGET_THB_BY_LEVEL] ?? null
        : null,
    },
  };

  const drivers: ProgramLifecycleDriver[] = [
    aiReadinessDriver,
    healthDriver,
    enrollmentTrendDriver,
    tuitionTrendDriver,
    modernityDriver,
    labourMarketDriver,
    revenueScaleDriver,
    gapDriver,
    resilienceDriver,
    delayedDriver,
    capabilityDriver,
  ];

  const baselineScore = 50;
  const summed = drivers.reduce((s, d) => s + d.contribution, 0);
  const trajectoryScore = Math.max(0, Math.min(100, baselineScore + summed));

  let verdict: ProgramLifecycleVerdict;
  if (trajectoryScore >= 80 && modernityVerdict === 'FRONTIER') verdict = 'FRONTIER';
  else if (trajectoryScore >= 65) verdict = 'RISING';
  else if (trajectoryScore >= 45) verdict = 'STABLE';
  else verdict = 'SUNSET';

  const ungatedVerdict = verdict;
  const gatesApplied: LifecycleGateEffect[] = [];

  if (modernityVerdict === 'OLD_SCHOOL' && (verdict === 'RISING' || verdict === 'FRONTIER')) {
    const from = verdict;
    verdict = 'STABLE';
    gatesApplied.push({
      name: 'oldSchoolContentCap',
      from,
      to: verdict,
      reason: 'Peer-review content modernity verdict = OLD_SCHOOL; curriculum out of touch with the field caps the verdict at STABLE regardless of trajectory.',
    });
  }

  if (aiReadiness.overallScore < 30 && (verdict === 'RISING' || verdict === 'FRONTIER')) {
    const from = verdict;
    verdict = 'STABLE';
    gatesApplied.push({
      name: 'aiReadinessStableCap',
      from,
      to: verdict,
      reason: `AI readiness ${aiReadiness.overallScore.toFixed(0)}/100 < 30 — program faces structural AI threat regardless of trajectory; caps verdict at STABLE.`,
    });
  }
  if (aiReadiness.overallScore < 50 && verdict === 'FRONTIER') {
    const from = verdict;
    verdict = 'RISING';
    gatesApplied.push({
      name: 'aiReadinessFrontierCap',
      from,
      to: verdict,
      reason: `AI readiness ${aiReadiness.overallScore.toFixed(0)}/100 < 50 — FRONTIER label reserved for genuinely AI-integrated programs; caps at RISING.`,
    });
  }

  if (
    labourMarketScore !== null &&
    labourMarketScore < 30 &&
    (verdict === 'RISING' || verdict === 'FRONTIER')
  ) {
    const from = verdict;
    verdict = 'STABLE';
    gatesApplied.push({
      name: 'lowLabourMarketAlignmentStableCap',
      from,
      to: verdict,
      reason: `Labour-market alignment ${labourMarketScore.toFixed(0)}/100 < 30 — program teaches only a fraction of employer-demanded skills; caps verdict at STABLE regardless of trajectory.`,
    });
  }
  if (labourMarketScore !== null && labourMarketScore < 50 && verdict === 'FRONTIER') {
    const from = verdict;
    verdict = 'RISING';
    gatesApplied.push({
      name: 'lowLabourMarketAlignmentFrontierCap',
      from,
      to: verdict,
      reason: `Labour-market alignment ${labourMarketScore.toFixed(0)}/100 < 50 — FRONTIER label reserved for programs that meet employer demand; caps at RISING.`,
    });
  }

  if (
    latestAnnualRevenueThb !== null &&
    latestAnnualRevenueThb < FLAGSHIP_REVENUE_FLOOR_THB &&
    verdict === 'FRONTIER'
  ) {
    const from = verdict;
    verdict = 'RISING';
    const revM = (latestAnnualRevenueThb / 1_000_000).toFixed(1);
    const floorM = (FLAGSHIP_REVENUE_FLOOR_THB / 1_000_000).toFixed(0);
    gatesApplied.push({
      name: 'lowRevenuePotentialFrontierCap',
      from,
      to: verdict,
      reason: `Annual tuition revenue ${revM}M THB < ${floorM}M flagship floor — FRONTIER reserved for revenue-substantial programs (strategic, not academic); caps at RISING. Path to FRONTIER: grow cohort or partnerships.`,
    });
  }

  // ── Narrative ────────────────────────────────────────────────────
  const sortedDrivers = [...drivers].sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
  );
  const positives = sortedDrivers.filter((d) => d.contribution > 0).slice(0, 2);
  const negatives = sortedDrivers.filter((d) => d.contribution < 0).slice(0, 2);
  const narrativeParts: string[] = [];
  narrativeParts.push(verdictHeadline(verdict, trajectoryScore, modernityVerdict));
  if (positives.length > 0) {
    narrativeParts.push(
      `Lifting forces: ${positives.map((d) => labelToPhrase(d.label)).join(', ')}.`,
    );
  }
  if (negatives.length > 0) {
    narrativeParts.push(
      `Drag: ${negatives.map((d) => labelToPhrase(d.label)).join(', ')}.`,
    );
  }
  if (gatesApplied.length > 0) {
    const gateNames = gatesApplied.map((g) => labelGateName(g.name)).join(', ');
    narrativeParts.push(
      `Modifier gate(s) lowered verdict from ${ungatedVerdict} to ${verdict}: ${gateNames}.`,
    );
  }
  if (!inputs.hasPeerSelection) {
    narrativeParts.push(
      'AI peer review not yet generated — run `pnpm peers:select <code>` for richer modernity + content-gap inputs.',
    );
  }
  const narrative = narrativeParts.join(' ');

  return {
    verdict,
    ungatedVerdict,
    trajectoryScore,
    drivers: sortedDrivers,
    gatesApplied,
    narrative,
    methodologyVersion: LIFECYCLE_VERSION,
  };
}

function extractDriverFromHealth(
  health: HealthScoreRow | null,
  dim: HealthDimension,
  driverLabel: string,
  scaler: (v: number) => number,
  outLabel: string,
  cap: number,
): ProgramLifecycleDriver {
  const driver = health?.dimensions[dim].drivers.find((d) => d.label === driverLabel);
  if (!driver || driver.value === null) {
    return { label: outLabel, contribution: 0, raw: { score: null } };
  }
  const raw = scaler(driver.value);
  const clamped = Math.max(-cap, Math.min(cap, raw));
  return { label: outLabel, contribution: clamped, raw: { score: driver.value } };
}

function labelGateName(name: LifecycleGateEffect['name']): string {
  switch (name) {
    case 'oldSchoolContentCap':
      return 'OLD_SCHOOL content cap';
    case 'aiReadinessStableCap':
      return 'AI readiness < 30 (STABLE cap)';
    case 'aiReadinessFrontierCap':
      return 'AI readiness < 50 (FRONTIER cap)';
    case 'lowLabourMarketAlignmentStableCap':
      return 'Labour-market alignment < 30 (STABLE cap)';
    case 'lowLabourMarketAlignmentFrontierCap':
      return 'Labour-market alignment < 50 (FRONTIER cap)';
    case 'lowRevenuePotentialFrontierCap':
      return 'Revenue < 3M THB/yr flagship floor (FRONTIER cap)';
  }
}

function verdictHeadline(
  v: ProgramLifecycleVerdict,
  score: number,
  modernityVerdict: string | null,
): string {
  const s = score.toFixed(0);
  switch (v) {
    case 'FRONTIER':
      return `Frontier program (trajectory ${s}/100) — leading-edge content, strong fundamentals, future-defining.`;
    case 'RISING': {
      const modernityNote =
        modernityVerdict === 'IN_BETWEEN'
          ? ' Content sits in between fundamentals and the frontier — pushing the curriculum further would unlock Frontier status.'
          : modernityVerdict === null
            ? ' AI peer review not yet generated — content modernity unverified.'
            : '';
      return `Rising program (trajectory ${s}/100) — improving across multiple signals, growth trajectory.${modernityNote}`;
    }
    case 'STABLE': {
      const modernityNote =
        modernityVerdict === 'OLD_SCHOOL'
          ? ' Held back by old-school curriculum content — strong metrics are not enough without a content refresh.'
          : '';
      return `Stable program (trajectory ${s}/100) — meeting expectations, not yet growing.${modernityNote}`;
    }
    case 'SUNSET':
      return `Sunset risk (trajectory ${s}/100) — multiple signals declining; closure / merger / radical restructure on the table.`;
  }
}

function labelToPhrase(label: string): string {
  switch (label) {
    case 'ai_readiness': return 'AI readiness';
    case 'health_overall': return 'overall health';
    case 'enrollment_trend': return 'enrollment growth';
    case 'tuition_trend': return 'tuition growth';
    case 'content_modernity': return 'curriculum modernity';
    case 'labour_market_alignment': return 'labour-market alignment';
    case 'revenue_scale': return 'revenue scale';
    case 'major_content_gaps': return 'major content gaps vs peers';
    case 'demographic_resilience': return 'demographic resilience';
    case 'delayed_graduation_share': return 'delayed graduation share';
    case 'capability_strength': return 'faculty capability';
    default: return label.replace(/_/g, ' ');
  }
}
