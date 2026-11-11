import type { ScopeLevel } from '../scope';
import type { MetricRow } from '../scope';
import { prisma } from '../index';
import { realDataWhere } from '../data-quality';
import { getAcademicYearContext } from '../academic-year';
import { GRANT_AWARD_LABEL, grantAward, withAward } from '../grant-award';
import { pickFinancialYear } from '../financial-year';
import type { HealthScore } from './schema';
import { HEALTH_SCORE_TUNING, REVENUE_TARGET_THB_BY_LEVEL } from './tuning';
import { clamp } from './curves';
import { applyPartialYearDrop, excludeInProgressYear, linearSlope } from './series';
import { noDataScore, summariseDrivers } from './summarise';
import { collectProgramIdsForScope } from './scope-tree';
import { getProgramScoreIndex, rolledUpDriver } from './program-index';

const T = HEALTH_SCORE_TUNING.financial;

// ──────────────────────────────────────────────────────────────────────────
// Financial — per-student contribution + cost coverage + tuition trend
// ──────────────────────────────────────────────────────────────────────────

// Scope-only financial drivers: `revenue_coverage_ratio` is the
// ratio-of-sums analogue of the program scorer's
// `revenue_coverage_program_direct`, and "what does the average program
// contribute" is undefined for a single program. Omitted rather than
// null so a program's dataCompletenessPct is not docked for drivers that
// cannot apply to it.
const PROGRAM_FINANCIAL_OMITTED = ['revenue_coverage_ratio', 'net_contribution_per_program'] as const;

// v5.4: the external-grant award is applied to the FINISHED Financial score —
// after summariseDrivers — so it can only raise the score and never moves
// completeness. A null base earns nothing and costs no grant query.
async function applyGrantAward(
  base: HealthScore,
  staffIds: () => Promise<string[]>,
): Promise<HealthScore> {
  if (base.score === null) {
    return withAward(base, {
      label: GRANT_AWARD_LABEL,
      points: null,
      raw: { reason: 'no-base-financial-score' },
    });
  }
  return withAward(base, await grantAward(await staffIds()));
}

/** Distinct ACTIVE teaching staff across the given programmes. */
async function activeStaffIdsForPrograms(programIds: readonly string[]): Promise<string[]> {
  if (programIds.length === 0) return [];
  const links = await prisma.programFaculty.findMany({
    where: { programId: { in: [...programIds] } },
    select: { facultyMember: { select: { id: true, isActive: true } } },
  });
  return [...new Set(links.filter((l) => l.facultyMember.isActive).map((l) => l.facultyMember.id))];
}

export async function scoreFinancialProgram(programId: string, enrollment: MetricRow[]): Promise<HealthScore> {
  const base = await scoreFinancialProgramBase(programId, enrollment);
  return applyGrantAward(base, () => activeStaffIdsForPrograms([programId]));
}

export async function scoreFinancialScope(
  row: MetricRow | null,
  scope: ScopeLevel,
  scopeId: string,
  enrollment: MetricRow[],
): Promise<HealthScore> {
  const base = await scoreFinancialScopeBase(row, scope, scopeId, enrollment);
  return applyGrantAward(base, async () => activeStaffIdsForPrograms(await collectProgramIdsForScope(scopeId, scope)));
}

async function scoreFinancialProgramBase(
  programId: string,
  enrollment: MetricRow[],
): Promise<HealthScore> {
  const [rows, programMeta] = await Promise.all([
    prisma.financialMetric.findMany({
      where: { programId, ...realDataWhere() },
      orderBy: { fiscalYear: 'asc' },
    }),
    prisma.program.findUnique({ where: { id: programId }, select: { level: true } }),
  ]);
  if (rows.length === 0) {
    return noDataScore('financial', PROGRAM_FINANCIAL_OMITTED);
  }
  const num = (v: { toNumber: () => number } | unknown): number =>
    typeof v === 'number' ? v : (v as { toNumber: () => number }).toNumber();

  // Score on the latest COMPLETE academic year — never the year still
  // being billed. See packages/db/src/financial-year.ts for why a ratio
  // test alone can't detect "in progress" (median in-progress year reads
  // ~44% of the prior complete year, but with a long tail above 90%).
  const academicYearCtx = await getAcademicYearContext();
  const currentAcademicYearCE = academicYearCtx.currentAcademicYearBE - 543;
  const pick = pickFinancialYear(rows, currentAcademicYearCE, (row) => num(row.tuitionRevenue));
  if (!pick.row) {
    return noDataScore('financial', PROGRAM_FINANCIAL_OMITTED);
  }
  const head = pick.row;
  const tuition = num(head.tuitionRevenue);
  const direct = num(head.directCost);
  const facility = num(head.allocatedFacilityCost);
  const overhead = num(head.allocatedOverhead);
  const netContribution = num(head.netContribution);
  const programDirectCost = direct + facility + overhead;

  const enrolledHead =
    enrollment.find((e) => e.year === head.fiscalYear)?.enrolledTotal ??
    enrollment.at(-1)?.enrolledTotal ??
    null;

  const drivers = [
    {
      label: 'net_contribution_per_student',
      value: (() => {
        if (!enrolledHead || enrolledHead === 0) return null;
        const perStudent = netContribution / enrolledHead;
        // T.netContributionPerStudentThbForFull per student → 100; 0 → 50;
        // the same loss → 0.
        return clamp(50 + (perStudent / T.netContributionPerStudentThbForFull) * 50);
      })(),
      raw: enrolledHead ? netContribution / enrolledHead : null,
    },
    {
      label: 'revenue_coverage_program_direct',
      value: (() => {
        if (programDirectCost <= 0) return tuition > 0 ? T.revenueCoverageScoreWhenNoCost : null;
        return clamp((tuition / programDirectCost / T.revenueCoverageTargetRatio) * 100);
      })(),
      raw: tuition,
    },
    {
      label: 'tuition_trend_slope',
      value: (() => {
        // Exclude the in-progress academic year BEFORE the ratio-based
        // applyPartialYearDrop runs — a half-billed year drags the slope
        // toward a manufactured decline no matter its ratio to the prior
        // year (see excludeInProgressYear's doc comment). This mirrors
        // the head-selection rule in pickFinancialYear above.
        const series = applyPartialYearDrop(
          excludeInProgressYear(
            rows.map((r) => ({ year: r.fiscalYear, value: num(r.tuitionRevenue) })),
            currentAcademicYearCE,
          ),
        );
        if (series.length < 2) return null;
        const slope = linearSlope(series);
        // +T.tuitionSlopeThbPerYearForFull THB/year → 100; flat → 50;
        // the same decline → 0.
        return clamp(50 + (slope / T.tuitionSlopeThbPerYearForFull) * 50);
      })(),
      raw: rows.map((r) => num(r.tuitionRevenue)),
    },
    {
      label: 'revenue_scale',
      // v3.5: level-aware absolute revenue. Captures "is this program
      // revenue-substantial for its level" — complements per-student /
      // coverage / trend ratios above with the absolute scale signal.
      // 0-100 scaled against REVENUE_TARGET_THB_BY_LEVEL: score =
      // min(ratio, cap) × points; with the published 2 and 50, ratio 0.5 →
      // 25, 1.0 → 50, 2.0+ → 100, 0 → 0.
      value: (() => {
        const level = programMeta?.level ?? null;
        if (!level || !(level in REVENUE_TARGET_THB_BY_LEVEL)) return null;
        if (tuition <= 0) return 0;
        const target = REVENUE_TARGET_THB_BY_LEVEL[level as keyof typeof REVENUE_TARGET_THB_BY_LEVEL];
        const ratio = tuition / target;
        // Capped: past the cap multiple of the per-level target a program
        // is already revenue-substantial, so more revenue earns nothing.
        return clamp(Math.min(ratio, T.revenueScaleCapTargetMultiple) * T.revenueScalePointsPerTarget);
      })(),
      raw: { latestAnnualRevenueThb: tuition, level: programMeta?.level ?? null },
    },
  ];
  return summariseDrivers('financial', drivers, PROGRAM_FINANCIAL_OMITTED);
}

async function scoreFinancialScopeBase(
  row: MetricRow | null,
  scope: ScopeLevel,
  scopeId: string,
  enrollment: MetricRow[],
): Promise<HealthScore> {
  // Enrolment for the financial head year, falling back to the latest
  // enrolment row — the MV pivots per family, so the financial row can
  // carry a null enrolledTotal. Mirrors scoreFinancialProgramBase.
  const enrolledHead =
    (row ? enrollment.find((e) => e.year === row.year)?.enrolledTotal : null) ??
    enrollment.at(-1)?.enrolledTotal ??
    null;

  const drivers: HealthScore['drivers'] = [
    {
      label: 'net_contribution_per_program',
      value: (() => {
        if (row?.netContributionTotal === null || row?.netContributionTotal === undefined) return null;
        if (!row.programCount) return null;
        return clamp(50 + (row.netContributionTotal / row.programCount / T.netContributionPerProgramThbForFull) * 50);
      })(),
      raw: row?.netContributionTotal,
    },
    {
      label: 'revenue_coverage_ratio',
      value: (() => {
        if (!row?.tuitionRevenueTotal || !row.totalCostTotal) return null;
        return clamp((row.tuitionRevenueTotal / row.totalCostTotal / T.revenueCoverageTargetRatio) * 100);
      })(),
      raw: row?.tuitionRevenueTotal,
    },
    {
      // v5.0: ratio-of-sums, not a mean of per-program ratios — the
      // ฿100k/student scale is scope-invariant, so aggregating weights by
      // program size instead of letting a 7-student program count as much
      // as a 700-student one.
      label: 'net_contribution_per_student',
      value: (() => {
        if (row?.netContributionTotal === null || row?.netContributionTotal === undefined) return null;
        if (!enrolledHead || enrolledHead === 0) return null;
        const perStudent = row.netContributionTotal / enrolledHead;
        return clamp(50 + (perStudent / T.netContributionPerStudentThbForFull) * 50);
      })(),
      raw: { netContributionTotal: row?.netContributionTotal ?? null, enrolled: enrolledHead },
    },
  ];

  // v5.0: absolute-THB calibration cannot be reused at scope. ±฿500k/yr
  // means "excellent" for one program and noise for a whole faculty, and
  // revenue_scale is scored against a per-LEVEL target a faculty does not
  // have. Both roll up from the program scores instead.
  const programIds = await collectProgramIdsForScope(scopeId, scope);
  const index = await getProgramScoreIndex();
  drivers.push(
    rolledUpDriver(index, programIds, 'financial', 'tuition_trend_slope'),
    rolledUpDriver(index, programIds, 'financial', 'revenue_scale'),
  );

  // revenue_coverage_program_direct is deliberately NOT rolled up:
  // revenue_coverage_ratio above is the same metric as ratio-of-sums, and
  // carrying both would weight cost coverage twice in the mean.
  return summariseDrivers('financial', drivers, ['revenue_coverage_program_direct']);
}
