// Fetches everything the lifecycle formula reads and returns it as a plain
// LifecycleInputs object. All database access for the lifecycle verdict is
// here; compute.ts is pure.

import type { Prisma } from '@prisma/client';
import { computeHealthScores } from '../health-score';
import { HEALTH_SCORE_TUNING } from '../health-score/tuning';
import { prisma } from '../index';
import {
  programAiReadiness,
  programDemographicOutlook,
  programStudentCohorts,
} from '../program-deep-dive';
import type { LifecycleInputs } from './types';

/** Latest annual tuition revenue (THB) from FinancialMetric rows ordered
 *  newest first. When the latest year is below the partial-year share of the
 *  prior year it is treated as partial and the prior year's figure is used.
 *
 *  Kept exactly as lifecycle.v1.4 published it: a zero figure is data (not
 *  missing), and `fiscalYear` is the latest row's year even when the prior
 *  year's figure was picked. The health score's financial dimension moved to
 *  pickFinancialYear() in health-score v3.9; aligning lifecycle with it
 *  changes verdicts and needs a new lifecycle version. */
export function pickLatestAnnualRevenue(
  rows: ReadonlyArray<{ tuitionRevenue: Prisma.Decimal | null; fiscalYear: number }>,
): { thb: number | null; fiscalYear: number | null } {
  const head = rows[0];
  if (!head?.tuitionRevenue) return { thb: null, fiscalYear: null };
  const latest = Number(head.tuitionRevenue);
  const prior = rows[1]?.tuitionRevenue;
  const priorN = prior ? Number(prior) : 0;
  const partialShare = HEALTH_SCORE_TUNING.shared.partialYearBelowShareOfPrior;
  const thb = priorN > 0 && latest < priorN * partialShare ? priorN : latest;
  return { thb, fiscalYear: head.fiscalYear };
}

export async function loadLifecycleInputs(programId: string): Promise<LifecycleInputs> {
  const [healthRows, cohorts, demoOutlook, peerReviewRow, peerSelections, aiReadiness, program, financial] =
    await Promise.all([
      computeHealthScores('program', programId),
      programStudentCohorts(programId),
      programDemographicOutlook(programId),
      prisma.programPeerReview.findUnique({ where: { programId } }),
      prisma.programPeerSelection.findMany({ where: { programId }, take: 1 }),
      programAiReadiness(programId),
      prisma.program.findUnique({ where: { id: programId }, select: { level: true } }),
      prisma.financialMetric.findMany({
        where: { programId },
        orderBy: { fiscalYear: 'desc' },
        select: { tuitionRevenue: true, fiscalYear: true },
        take: 2,
      }),
    ]);
  const revenue = pickLatestAnnualRevenue(financial);

  return {
    health: healthRows[0] ?? null,
    aiReadiness,
    peerReview: (peerReviewRow?.payloadJson ?? null) as LifecycleInputs['peerReview'],
    hasPeerSelection: peerSelections.length > 0,
    cohorts,
    demographicRiskLevel: demoOutlook?.riskLevel ?? null,
    level: program?.level ?? null,
    latestAnnualRevenueThb: revenue.thb,
    latestRevenueFiscalYear: revenue.fiscalYear,
  };
}
