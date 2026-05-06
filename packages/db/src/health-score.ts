import { Prisma } from '@prisma/client';
import { z } from 'zod';
import type { ScopeLevel } from './scope';
import { prisma } from './index';
import { queryMetricByScope, type MetricRow } from './scope';

// Health scores for the Portfolio Overview Cockpit + Deep-Dive radar.
// Five dimensions + overall composite. Scores 0-100 where 100 is healthy.
//
// Methodology: see docs/methodologies/health-score.md. Edit that first
// when changing the formula, then bump HEALTH_SCORE_VERSION here, then
// change the logic.
//
// Null handling rule: missing metrics are EXCLUDED from the average
// (not substituted with 0 or 50). dataCompletenessPct on every score
// tells the reader how much data actually went into it.

// v3.0 (2026-05-02) — full redesign. Five dimensions, all backed by
// real data after the 2026-04-27 → 2026-05-02 connector flips:
//
//   * attractiveness  — TCAS-anchored: competition vs peers, fill rate,
//                       enrollment trend
//   * financial       — net contribution per student, revenue coverage,
//                       tuition trend
//   * capability      — senior-rank share, publications per faculty,
//                       retirement horizon (was placeholder in v2)
//   * outcomes        — TCAS percentile + alumni outcomes (kku-alumni
//                       still pending; TCAS percentile lights it up)
//   * relevance       — labour-market alignment, demand-match filled,
//                       demographic resilience, strategic sector
//                       alignment (was placeholder in v2)
//
// v2 / v2.1 driver `labor_market_alignment_kmitl` (LinkedIn via MHESI,
// 4-quadrant fallback) is preserved under `relevance`. v1 / v2 / v2.1
// rows retained for audit; new rows stamp v3.0.
export const HEALTH_SCORE_VERSION = 'health-score.v3.4';

// ── KKU intake-floor policy ─────────────────────────────────────────
// Council policy (2026): every program must hit a minimum new-intake
// floor each academic year. Failing the floor is a structural risk
// signal — strict for undergraduate (closure-track), watch-list for
// postgraduate (where small-cohort is structurally normal).
//
// Compliance state surfaces in the attractiveness driver's `raw.compliance`
// field and feeds the lifecycle verdict.
export const KKU_INTAKE_FLOOR_BACHELOR = 30;
export const KKU_INTAKE_FLOOR_POSTGRAD = 8;

export type IntakeCompliance = 'compliant' | 'watch' | 'breach' | 'unknown';

/** Standalone helper for surface-layer code (deep-dive header, dashboard,
 *  cockpit). Returns the canonical compliance state for any program given
 *  its level + latest intake. Wraps `intakeComplianceFor` so callers
 *  don't need to import the internal scoring math. */
export function getKkuIntakePolicyVerdict(
  level: string,
  latestIntake: number | null,
): { state: IntakeCompliance; floor: number } {
  const v = intakeComplianceFor(level, latestIntake);
  return { state: v.state, floor: v.floor };
}

function intakeComplianceFor(
  level: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA' | string,
  intake: number | null,
): { state: IntakeCompliance; floor: number; score: number | null } {
  if (intake === null) return { state: 'unknown', floor: 0, score: null };
  if (level === 'BACHELOR') {
    const floor = KKU_INTAKE_FLOOR_BACHELOR;
    if (intake < floor) {
      // Strict policy: severely punish — far below floor → 0;
      // half the floor → ~25.
      return { state: 'breach', floor, score: clamp((intake / floor) * 50) };
    }
    // At or above floor — scale to 100 at 2× floor.
    return { state: 'compliant', floor, score: clamp(50 + ((intake - floor) / floor) * 50) };
  }
  // Postgraduate (MASTER / DOCTORAL / HIGHER_GRAD_DIPLOMA) — watch-list,
  // not strict closure-track. Below floor still penalised but not zeroed.
  const floor = KKU_INTAKE_FLOOR_POSTGRAD;
  if (intake < floor) {
    return { state: 'watch', floor, score: clamp(30 + (intake / floor) * 30) };
  }
  return { state: 'compliant', floor, score: clamp(60 + ((intake - floor) / floor) * 40) };
}

export const HEALTH_DIMENSIONS = [
  'attractiveness',
  'financial',
  'capability',
  'outcomes',
  'relevance',
] as const;
export type HealthDimension = (typeof HEALTH_DIMENSIONS)[number];

export const HealthScoreSchema = z.object({
  // null when every underlying metric was null — never 0.
  score: z.number().min(0).max(100).nullable(),
  dataCompletenessPct: z.number().min(0).max(100),
  // Subscores per underlying metric (for the hover tooltip — "here's
  // what's driving this dimension").
  drivers: z.array(
    z.object({
      label: z.string(),
      value: z.number().min(0).max(100).nullable(),
      raw: z.unknown(),
    }),
  ),
});
export type HealthScore = z.infer<typeof HealthScoreSchema>;

export const HealthDimensionScoresSchema = z.object({
  attractiveness: HealthScoreSchema,
  financial: HealthScoreSchema,
  capability: HealthScoreSchema,
  outcomes: HealthScoreSchema,
  relevance: HealthScoreSchema,
});
export type HealthDimensionScores = z.infer<typeof HealthDimensionScoresSchema>;

export const HealthScoreRowSchema = z.object({
  scope: z.string(),
  scopeId: z.string(),
  scopeLabel: z.string(),
  parentScopeId: z.string().nullable(),
  methodologyVersion: z.string(),
  dimensions: HealthDimensionScoresSchema,
  overall: HealthScoreSchema,
  latestFreshness: z.date().nullable(),
});
export type HealthScoreRow = z.infer<typeof HealthScoreRowSchema>;

// ──────────────────────────────────────────────────────────────────────────
// Public entry point
// ──────────────────────────────────────────────────────────────────────────

export async function computeHealthScores(
  scope: ScopeLevel,
  scopeId: string | null,
): Promise<HealthScoreRow[]> {
  // resolveChildren returns the EFFECTIVE child scope — usually the
  // natural child (faculty → department → program) but can collapse
  // a level when the org tree is incomplete (e.g., faculties whose
  // canonical programs all have departmentId=NULL skip the department
  // tier and return programs directly).
  const { scope: childScope, nodes: children } = await resolveChildren(scope, scopeId);

  // Pre-compute KMITL alignment for every program in one pass — used
  // by the relevance dimension. Empty map when the LinkedIn-via-MHESI
  // dataset has no rows yet → driver returns null per scope.
  const programAlignment = await computeKmitlProgramAlignment();

  const rows: HealthScoreRow[] = [];
  for (const child of children) {
    const enrollment = await queryMetricByScope({
      scope: childScope,
      scopeId: child.id,
      family: 'enrollment',
    });
    const financialsAgg = await queryMetricByScope({
      scope: childScope,
      scopeId: child.id,
      family: 'financial',
    });
    const outcomes = await queryMetricByScope({
      scope: childScope,
      scopeId: child.id,
      family: 'outcomes',
    });

    // Program-scope reads raw rows directly so the scorers can apply
    // partial-year heuristics + use program-internal fields the MV
    // doesn't expose. Faculty/dept/uni scopes still use the MV.
    const isProgram = childScope === 'program';

    // Pick the latest year that ACTUALLY has data for this family,
    // not just the latest year in the MV's union-of-years column. The
    // MV creates a row per (scope × year) for every distinct year
    // across enrollment ∪ financial ∪ outcomes; the freshest family
    // pulls forward the year axis, leaving NULL columns for the lagging
    // families. Without this filter, the LAGGING family (typically
    // outcomes — the survey runs ~6mo after the academic year) reads
    // null because its row at the latest universe-wide year is empty.
    // (Attractiveness pulls TCAS directly per scope — see
    // scoreAttractivenessScope — so we don't pre-pick an enrolment row
    // for it. Financial / outcomes still pivot on the latest year that
    // actually has data for that family.)
    const latestFinancial = latestWith(financialsAgg, (r) => r.netContributionTotal !== null);
    const latestOutcomes = latestWith(outcomes, (r) => r.employmentRateWeighted !== null);

    const attractiveness = isProgram
      ? await scoreAttractivenessProgram(child.id)
      : await scoreAttractivenessScope(childScope, child.id);
    const financial = isProgram
      ? await scoreFinancialProgram(child.id, enrollment)
      : scoreFinancialScope(latestFinancial);
    const capability = isProgram
      ? await scoreCapabilityProgram(child.id)
      : await scoreCapabilityScope(child.id, childScope);
    const outcomesScore = isProgram
      ? await scoreOutcomesProgram(child.id, latestOutcomes)
      : scoreOutcomesScope(latestOutcomes);
    const relevance = isProgram
      ? await scoreRelevanceProgram(child.id, programAlignment.get(child.id) ?? null)
      : await scoreRelevanceScope(child.id, childScope, programAlignment);

    const dimensions: HealthScoreRow['dimensions'] = {
      attractiveness,
      financial,
      capability,
      outcomes: outcomesScore,
      relevance,
    };
    rows.push({
      scope: childScope,
      scopeId: child.id,
      scopeLabel: child.label,
      parentScopeId: child.parentId,
      methodologyVersion: HEALTH_SCORE_VERSION,
      dimensions,
      overall: combineDimensions(Object.values(dimensions)),
      latestFreshness:
        enrollment.at(-1)?.latestFreshness ??
        financialsAgg.at(-1)?.latestFreshness ??
        outcomes.at(-1)?.latestFreshness ??
        null,
    });
  }
  return rows;
}

// Pick the most recent year-row in a metric series that actually
// satisfies `predicate`. Falls back to null when no row qualifies.
// MV rows are ordered ASC by year, so we walk backwards from the tail.
function latestWith<T>(rows: T[], predicate: (r: T) => boolean): T | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (predicate(r)) return r;
  }
  return null;
}

// ──────────────────────────────────────────────────────────────────────────
// Child resolution
// ──────────────────────────────────────────────────────────────────────────


interface ChildNode {
  id: string;
  label: string;
  parentId: string | null;
}

interface ChildResolution {
  /** Effective scope of the returned nodes — usually the natural child
   *  scope (university → faculty → department → program), but may
   *  collapse one level when an intermediate org tier is empty. */
  scope: ScopeLevel;
  nodes: ChildNode[];
}

async function resolveChildren(scope: ScopeLevel, scopeId: string | null): Promise<ChildResolution> {
  if (scope === 'university') {
    // Curriculum landscape = academic faculties that host at least one
    // canonical-297 program. Excludes:
    //   - non-academic units (kind != ACADEMIC: ADMIN / RESEARCH_CENTER /
    //     INSTITUTE) — they hold staff but no curriculum
    //   - academic faculties with zero canonical programs — cockpit
    //     can't compute meaningful health scores for them anyway
    const rows = await prisma.faculty.findMany({
      where: {
        kind: 'ACADEMIC',
        programs: {
          some: {
            status: 'ACTIVE',
            sequenceNoFromSheet: { not: null },
          },
        },
      },
      select: { id: true, nameEn: true, nameTh: true },
      orderBy: { code: 'asc' },
    });
    return {
      scope: 'faculty',
      nodes: rows.map((r) => ({ id: r.id, label: `${r.nameEn} · ${r.nameTh}`, parentId: null })),
    };
  }
  if (scope === 'faculty') {
    if (!scopeId) return { scope: 'department', nodes: [] };
    // Departments that host canonical+ACTIVE programs. When none exist
    // (KKU master sheet seeds many programs with departmentId=NULL —
    // 19 of 19 Engineering programs, for example), fall through to the
    // faculty's programs directly so the cockpit drill-down still
    // shows something instead of an empty heatmap.
    const deptRows = await prisma.department.findMany({
      where: {
        facultyId: scopeId,
        programs: {
          some: {
            status: 'ACTIVE',
            sequenceNoFromSheet: { not: null },
          },
        },
      },
      select: { id: true, nameEn: true, nameTh: true, facultyId: true },
      orderBy: { code: 'asc' },
    });
    if (deptRows.length > 0) {
      return {
        scope: 'department',
        nodes: deptRows.map((r) => ({
          id: r.id,
          label: `${r.nameEn} · ${r.nameTh}`,
          parentId: r.facultyId,
        })),
      };
    }
    // No departments host canonical programs — list the faculty's
    // programs directly. The childScope is normally 'department' here;
    // but since we're returning Program nodes, the caller will treat
    // them as program-scope. We mark this by returning Programs and
    // the caller's childScope continues to be 'department' which means
    // nothing tries to drill INTO these — they're terminal nodes in
    // the rollup at this level.
    const progRows = await prisma.program.findMany({
      where: {
        facultyId: scopeId,
        status: 'ACTIVE',
        sequenceNoFromSheet: { not: null },
      },
      select: { id: true, nameEn: true, nameTh: true, facultyId: true },
      orderBy: { code: 'asc' },
    });
    return {
      scope: 'program',
      nodes: progRows.map((r) => ({
        id: r.id,
        label: `${r.nameEn} · ${r.nameTh}`,
        parentId: r.facultyId,
      })),
    };
  }
  if (scope === 'department') {
    if (!scopeId) return { scope: 'program', nodes: [] };
    const rows = await prisma.program.findMany({
      where: {
        departmentId: scopeId,
        status: 'ACTIVE',
        sequenceNoFromSheet: { not: null },
      },
      select: { id: true, nameEn: true, nameTh: true, departmentId: true },
      orderBy: { code: 'asc' },
    });
    return {
      scope: 'program',
      nodes: rows.map((r) => ({
        id: r.id,
        label: `${r.nameEn} · ${r.nameTh}`,
        parentId: r.departmentId,
      })),
    };
  }
  if (!scopeId) return { scope: 'program', nodes: [] };
  const row = await prisma.program.findUnique({
    where: { id: scopeId },
    select: { id: true, nameEn: true, nameTh: true, departmentId: true },
  });
  return {
    scope: 'program',
    nodes: row
      ? [{ id: row.id, label: `${row.nameEn} · ${row.nameTh}`, parentId: row.departmentId }]
      : [],
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Attractiveness — TCAS competition + fill + enrollment trend
// ──────────────────────────────────────────────────────────────────────────

async function scoreAttractivenessProgram(programId: string): Promise<HealthScore> {
  // Latest COMPLETE year TCAS funnel — sums across rounds 1–4 + any
  // sub-rounds for the program's most recent FINISHED recruitment.
  // POWERBI.ADMISSION_STAT_CURRID gives quota / applicants / passed /
  // Clearinghouse send + confirm / registrar reg_reported.
  //
  // "Complete" = at least one round has reg_reported > 0. The current
  // recruitment year (in-progress) has reg_reported still null/0 across
  // all rounds — including it would make the registration-yield
  // driver score that program at 0% which is misleading. We score
  // against the latest completed cohort instead; the in-progress year
  // stays in the DB as informational data.
  //
  // Four drivers:
  //   - tcas_competition_ratio  (applicants / enrollSeats)
  //   - tcas_fill_rate          (totalPassed / enrollSeats)
  //   - tcas_registration_yield (regReported / sendClearinghouse)
  //   - tcas_competition_vs_peers — KKU's competition ratio vs the
  //     median ratio across other Thai universities running a
  //     comparable subject in TCAS3 (peer rows still live in
  //     TcasAdmissionStat — only KKU rows there were retired).
  //
  // Plus enrollment-trend + KKU intake-floor compliance drivers
  // (unchanged).
  const programRow = await prisma.program.findUnique({
    where: { id: programId },
    select: { level: true, nameTh: true },
  });

  // Find the latest COMPLETE year — every round in that year has
  // reg_reported NOT NULL AND > 0. Years where ANY round has 0 / null
  // reg_reported are still in-progress (e.g. round 2 done with
  // reg_reported populated but rounds 3/4 not run yet). Such years
  // stay in the DB as informational data — not used for scoring.
  let latestCompleteYear: number | null = null;
  let latestYearOverall: number | null = null;
  const yearStatusRows = await prisma.$queryRaw<
    Array<{
      entry_year_be: number;
      rows: bigint;
      with_reg: bigint;
      min_reg: number | null;
    }>
  >`
    SELECT
      entry_year_be,
      COUNT(*)::bigint AS rows,
      COUNT(reg_reported)::bigint AS with_reg,
      MIN(reg_reported) AS min_reg
    FROM tcas_admission_funnels
    WHERE program_id = ${programId}
    GROUP BY entry_year_be ORDER BY entry_year_be DESC
  `;
  for (const r of yearStatusRows) {
    if (latestYearOverall === null) latestYearOverall = r.entry_year_be;
    const allRoundsReported =
      Number(r.rows) === Number(r.with_reg) &&
      r.min_reg !== null &&
      Number(r.min_reg) > 0;
    if (allRoundsReported) {
      latestCompleteYear = r.entry_year_be;
      break;
    }
  }

  let funnelTotals: {
    enrollSeats: number;
    applicants: number;
    passed: number;
    sendCh: number;
    regReported: number;
    rounds: number;
    year: number;
    inProgressYear: number | null;
  } | null = null;
  if (latestCompleteYear !== null) {
    const rows = await prisma.tcasAdmissionFunnel.findMany({
      where: { programId, entryYearBE: latestCompleteYear },
      select: {
        enrollSeats: true,
        totalApplicants: true,
        totalPassed: true,
        sendClearinghouse: true,
        regReported: true,
      },
    });
    funnelTotals = rows.reduce(
      (acc, r) => ({
        enrollSeats: acc.enrollSeats + (r.enrollSeats ?? 0),
        applicants: acc.applicants + (r.totalApplicants ?? 0),
        passed: acc.passed + (r.totalPassed ?? 0),
        sendCh: acc.sendCh + (r.sendClearinghouse ?? 0),
        regReported: acc.regReported + (r.regReported ?? 0),
        rounds: acc.rounds + 1,
        year: latestCompleteYear,
        inProgressYear:
          latestYearOverall !== null && latestYearOverall > latestCompleteYear
            ? latestYearOverall
            : null,
      }),
      {
        enrollSeats: 0, applicants: 0, passed: 0, sendCh: 0, regReported: 0,
        rounds: 0, year: latestCompleteYear, inProgressYear: null as number | null,
      },
    );
  }

  // Peer competition ratio for the latest complete year — TCAS3 peer
  // rows in TcasAdmissionStat (KKU's own rows there were retired but
  // ~25,705 peer rows remain). Match by extractSubjectSignature on
  // Program.nameTh (the new funnel doesn't carry programmeName).
  let peerMedianRatio: number | null = null;
  let peerCount = 0;
  if (latestCompleteYear !== null && programRow?.nameTh) {
    const subjectKey = extractSubjectSignature(programRow.nameTh);
    if (subjectKey.length >= 2) {
      const peerRows = await prisma.tcasAdmissionStat.findMany({
        where: {
          entryYearBE: latestCompleteYear,
          institutionName: { not: 'มหาวิทยาลัยขอนแก่น' },
          programmeName: { contains: subjectKey, mode: 'insensitive' },
          quota: { gt: 0 },
        },
        select: { quota: true, applicants: true, programmeName: true },
      });
      const peerRatios = peerRows
        .filter((p) => extractSubjectSignature(p.programmeName) === subjectKey)
        .map((p) => p.applicants / p.quota)
        .sort((a, b) => a - b);
      peerCount = peerRatios.length;
      if (peerRatios.length > 0) {
        peerMedianRatio = peerRatios[Math.floor(peerRatios.length / 2)] ?? null;
      }
    }
  }

  // Enrollment series for the trend driver.
  const enrollment = await prisma.enrollmentMetric.findMany({
    where: { programId },
    orderBy: { academicYear: 'asc' },
    select: { academicYear: true, enrolled: true },
  });

  const drivers = [
    {
      label: 'tcas_competition_ratio',
      value: (() => {
        if (!funnelTotals || funnelTotals.enrollSeats <= 0) return null;
        const ratio = funnelTotals.applicants / funnelTotals.enrollSeats;
        return ratio >= 10
          ? 100
          : ratio >= 5
            ? 70 + ((ratio - 5) / 5) * 30
            : ratio >= 2
              ? 40 + ((ratio - 2) / 3) * 30
              : ratio >= 1
                ? 20 + (ratio - 1) * 20
                : Math.max(0, ratio * 20);
      })(),
      raw: funnelTotals,
    },
    {
      label: 'tcas_fill_rate',
      value: (() => {
        if (!funnelTotals || funnelTotals.enrollSeats <= 0) return null;
        // passed/seats ≥ 0.5 → 100, linear below.
        const fill = funnelTotals.passed / funnelTotals.enrollSeats;
        return fill >= 0.5 ? 100 : clamp((fill / 0.5) * 100);
      })(),
      raw: funnelTotals
        ? { passed: funnelTotals.passed, seats: funnelTotals.enrollSeats }
        : null,
    },
    {
      label: 'tcas_registration_yield',
      value: (() => {
        // Yield = reg_reported / send_clearinghouse. Programs that lose
        // most accepted students between Clearinghouse and registration
        // are bleeding attractiveness. ≥0.85 = excellent; 0.5 = mid;
        // <0.3 = serious leakage.
        if (!funnelTotals || funnelTotals.sendCh <= 0) return null;
        const yieldRate = funnelTotals.regReported / funnelTotals.sendCh;
        return yieldRate >= 0.85
          ? 100
          : yieldRate >= 0.5
            ? 50 + ((yieldRate - 0.5) / 0.35) * 50
            : Math.max(0, yieldRate * 100);
      })(),
      raw: funnelTotals
        ? { regReported: funnelTotals.regReported, sendCh: funnelTotals.sendCh }
        : null,
    },
    {
      label: 'tcas_competition_vs_peers',
      value: (() => {
        if (!funnelTotals || funnelTotals.enrollSeats <= 0) return null;
        if (peerMedianRatio === null || peerMedianRatio <= 0) return null;
        const kkuRatio = funnelTotals.applicants / funnelTotals.enrollSeats;
        // Score 50 = parity with peer median; 100 = 2× peer median.
        // Peers come from TCAS3 only — sample size and methodology
        // differ from our full-funnel data, so this is comparative
        // signal not a precise apples-to-apples metric. Worth half
        // weight in summariseDrivers (which it gets automatically by
        // virtue of being one of N drivers).
        return clamp((kkuRatio / peerMedianRatio) * 50);
      })(),
      raw: {
        kkuRatio:
          funnelTotals && funnelTotals.enrollSeats > 0
            ? funnelTotals.applicants / funnelTotals.enrollSeats
            : null,
        peerMedianRatio,
        peerCount,
        year: latestCompleteYear,
      },
    },
    {
      label: 'enrollment_trend_slope',
      value: (() => {
        // Drop the most-recent year if it looks partial (cohort < 30%
        // of the prior year — same heuristic as financials).
        const series = applyPartialYearDrop(
          enrollment.map((r) => ({ year: r.academicYear, value: r.enrolled })),
        );
        if (series.length < 2) return null;
        const slope = linearSlope(series);
        // 0 = flat (50). +5 students/year → 100. -5 → 0.
        return clamp(50 + (slope / 5) * 50);
      })(),
      raw: { series: enrollment.map((r) => r.enrolled) },
    },
    {
      // KKU intake-floor policy — bachelor=30, postgrad=8.
      // Bachelor breaches are strict (closure-track); postgrad
      // breaches are watch-list. The driver's `raw.compliance` is
      // the canonical surface for UI badges + lifecycle verdicts.
      label: 'kku_intake_policy',
      value: (() => {
        const series = applyPartialYearDrop(
          enrollment.map((r) => ({ year: r.academicYear, value: r.enrolled })),
        );
        const latestIntake = series[series.length - 1]?.value ?? null;
        return intakeComplianceFor(programRow?.level ?? 'BACHELOR', latestIntake).score;
      })(),
      raw: (() => {
        const series = applyPartialYearDrop(
          enrollment.map((r) => ({ year: r.academicYear, value: r.enrolled })),
        );
        const latestIntake = series[series.length - 1]?.value ?? null;
        const verdict = intakeComplianceFor(programRow?.level ?? 'BACHELOR', latestIntake);
        return {
          level: programRow?.level ?? null,
          latestIntake,
          floor: verdict.floor,
          compliance: verdict.state,
        };
      })(),
    },
  ];
  return summariseDrivers(drivers);
}

async function scoreAttractivenessScope(
  scope: ScopeLevel,
  scopeId: string,
): Promise<HealthScore> {
  // Faculty/dept/uni attractiveness — aggregate the TCAS funnel across
  // canonical+ACTIVE programs at the scope, latest entry year only.
  // Source: tcas_admission_funnels (POWERBI.ADMISSION_STAT_CURRID).
  // Replaces the legacy tcas_admission_stats reads (TCAS3-only).
  //
  // Three drivers (equal-weighted in summariseDrivers):
  //   - tcas_competition_ratio = applicants / enrollSeats
  //       → ≥10× : 100   ≥5× : 70   ≥2× : 40   ≥1× : 20   <1× : 0
  //   - tcas_fill_rate = totalPassed / enrollSeats
  //       → 0.5+ : 100; linear below
  //   - tcas_registration_yield = regReported / sendClearinghouse
  //       → 0.85+ : 100; 0.5 = mid (50); linear below
  const scopePredicate =
    scope === 'faculty'
      ? Prisma.sql`AND p.faculty_id = ${scopeId}`
      : scope === 'department'
        ? Prisma.sql`AND p.department_id = ${scopeId}`
        : Prisma.empty;

  // Pivot to the latest COMPLETE recruitment year — i.e. the latest
  // year where any row at the scope has reg_reported > 0. Excluding
  // the in-progress current cycle keeps the registration-yield
  // driver from collapsing the score every spring.
  const rows = await prisma.$queryRaw<
    Array<{
      applicants: bigint | null;
      seats: bigint | null;
      passed: bigint | null;
      send_ch: bigint | null;
      reg_reported: bigint | null;
    }>
  >`
    WITH eligible AS (
      SELECT
        t.entry_year_be,
        t.total_applicants, t.enroll_seats, t.total_passed,
        t.send_clearinghouse, t.reg_reported
      FROM tcas_admission_funnels t
      JOIN programs p ON p.id = t.program_id
      WHERE p.status = 'ACTIVE' AND p.sequence_no_from_sheet IS NOT NULL
        ${scopePredicate}
    ),
    -- A year is COMPLETE at scope-level when EVERY row in it (across
    -- programs × rounds) has reg_reported NOT NULL AND > 0. Any
    -- in-progress round (reg_reported = 0 / null) drops the year out.
    -- Excluding in-progress years keeps the registration-yield driver
    -- from collapsing the score every spring while the new cohort is
    -- mid-recruitment.
    year_status AS (
      SELECT
        entry_year_be,
        COUNT(*) AS row_count,
        COUNT(reg_reported) AS reg_count,
        MIN(reg_reported) AS min_reg
      FROM eligible GROUP BY entry_year_be
    ),
    latest_complete AS (
      SELECT MAX(entry_year_be) AS y FROM year_status
      WHERE row_count = reg_count AND min_reg > 0
    )
    SELECT
      COALESCE(SUM(e.total_applicants), 0)::bigint AS applicants,
      COALESCE(SUM(e.enroll_seats), 0)::bigint AS seats,
      COALESCE(SUM(e.total_passed), 0)::bigint AS passed,
      COALESCE(SUM(e.send_clearinghouse), 0)::bigint AS send_ch,
      COALESCE(SUM(e.reg_reported), 0)::bigint AS reg_reported
    FROM eligible e
    JOIN latest_complete l ON e.entry_year_be = l.y;
  `;

  const r = rows[0];
  const applicants = Number(r?.applicants ?? 0n);
  const seats = Number(r?.seats ?? 0n);
  const passed = Number(r?.passed ?? 0n);
  const sendCh = Number(r?.send_ch ?? 0n);
  const regReported = Number(r?.reg_reported ?? 0n);

  const competitionRatio = seats > 0 ? applicants / seats : null;
  const fillRate = seats > 0 ? passed / seats : null;
  const yieldRate = sendCh > 0 ? regReported / sendCh : null;

  const drivers = [
    {
      label: 'tcas_competition_ratio',
      value: competitionRatio === null
        ? null
        : competitionRatio >= 10
          ? 100
          : competitionRatio >= 5
            ? 70 + ((competitionRatio - 5) / 5) * 30
            : competitionRatio >= 2
              ? 40 + ((competitionRatio - 2) / 3) * 30
              : competitionRatio >= 1
                ? 20 + (competitionRatio - 1) * 20
                : Math.max(0, competitionRatio * 20),
      raw: { applicants, seats, competitionRatio },
    },
    {
      label: 'tcas_fill_rate',
      value: fillRate === null
        ? null
        : fillRate >= 0.5
          ? 100
          : clamp((fillRate / 0.5) * 100),
      raw: { passed, seats, fillRate },
    },
    {
      label: 'tcas_registration_yield',
      value: yieldRate === null
        ? null
        : yieldRate >= 0.85
          ? 100
          : yieldRate >= 0.5
            ? 50 + ((yieldRate - 0.5) / 0.35) * 50
            : Math.max(0, yieldRate * 100),
      raw: { regReported, sendCh, yieldRate },
    },
  ];
  return summariseDrivers(drivers);
}

// ──────────────────────────────────────────────────────────────────────────
// Financial — per-student contribution + cost coverage + tuition trend
// ──────────────────────────────────────────────────────────────────────────

async function scoreFinancialProgram(
  programId: string,
  enrollment: MetricRow[],
): Promise<HealthScore> {
  const rows = await prisma.financialMetric.findMany({
    where: { programId },
    orderBy: { fiscalYear: 'asc' },
  });
  if (rows.length === 0) {
    return emptyScore([
      'net_contribution_per_student',
      'revenue_coverage_program_direct',
      'tuition_trend_slope',
    ]);
  }
  const num = (v: { toNumber: () => number } | unknown): number =>
    typeof v === 'number' ? v : (v as { toNumber: () => number }).toNumber();

  // Drop most-recent year if partial (tuition < 30% of prior).
  const PARTIAL = 0.3;
  let pickIndex = rows.length - 1;
  if (rows.length >= 2) {
    const last = num(rows[rows.length - 1]!.tuitionRevenue);
    const prior = num(rows[rows.length - 2]!.tuitionRevenue);
    if (prior > 0 && last < prior * PARTIAL) pickIndex = rows.length - 2;
  }
  const head = rows[pickIndex]!;
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
        // 100k THB / student → 100; 0 → 50; -50k → 0.
        return clamp(50 + (perStudent / 100_000) * 50);
      })(),
      raw: enrolledHead ? netContribution / enrolledHead : null,
    },
    {
      label: 'revenue_coverage_program_direct',
      value: (() => {
        if (programDirectCost <= 0) return tuition > 0 ? 80 : null;
        return clamp((tuition / programDirectCost / 1.2) * 100);
      })(),
      raw: tuition,
    },
    {
      label: 'tuition_trend_slope',
      value: (() => {
        const series = applyPartialYearDrop(
          rows.map((r) => ({ year: r.fiscalYear, value: num(r.tuitionRevenue) })),
        );
        if (series.length < 2) return null;
        const slope = linearSlope(series);
        // +500k THB/year growth → 100; flat → 50; declining → toward 0.
        return clamp(50 + (slope / 500_000) * 50);
      })(),
      raw: rows.map((r) => num(r.tuitionRevenue)),
    },
  ];
  return summariseDrivers(drivers);
}

function scoreFinancialScope(row: MetricRow | null): HealthScore {
  const drivers = [
    {
      label: 'net_contribution_per_program',
      value: (() => {
        if (row?.netContributionTotal === null || row?.netContributionTotal === undefined) return null;
        if (!row.programCount) return null;
        return clamp(50 + (row.netContributionTotal / row.programCount / 20_000_000) * 50);
      })(),
      raw: row?.netContributionTotal,
    },
    {
      label: 'revenue_coverage_ratio',
      value: (() => {
        if (!row?.tuitionRevenueTotal || !row.totalCostTotal) return null;
        return clamp((row.tuitionRevenueTotal / row.totalCostTotal / 1.2) * 100);
      })(),
      raw: row?.tuitionRevenueTotal,
    },
  ];
  return summariseDrivers(drivers);
}

// ──────────────────────────────────────────────────────────────────────────
// Capability — senior rank + publications + retirement horizon
// ──────────────────────────────────────────────────────────────────────────

async function scoreCapabilityProgram(programId: string): Promise<HealthScore> {
  const links = await prisma.programFaculty.findMany({
    where: { programId },
    include: {
      facultyMember: {
        select: {
          id: true,
          rank: true,
          isActive: true,
          retirementDate: true,
        },
      },
    },
  });
  const active = links.filter((l) => l.facultyMember.isActive);
  if (active.length === 0) {
    return emptyScore([
      'senior_rank_share',
      'publications_per_faculty',
      'retirement_horizon_5y',
      'student_faculty_ratio',
    ]);
  }

  // Latest-year enrolment + faculty discipline (drives the SFR band).
  // QS/THE both weight student-faculty ratio heavily — and apply
  // different thresholds by subject (clinical = strict, humanities =
  // lenient). Pull the program's faculty.code so we can pick the
  // right band.
  const [latestEnrollment, programRow] = await Promise.all([
    prisma.enrollmentMetric.findFirst({
      where: { programId },
      orderBy: { academicYear: 'desc' },
      select: { enrolled: true },
    }),
    prisma.program.findUnique({
      where: { id: programId },
      select: { faculty: { select: { code: true } } },
    }),
  ]);
  const enrolled = latestEnrollment?.enrolled ?? 0;
  const sfrBand = sfrBandFor(programRow?.faculty?.code);

  // Publications: research outputs in the last 3 years for the same
  // faculty members.
  const memberIds = active.map((l) => l.facultyMember.id);
  const currentYear = new Date().getUTCFullYear();
  const pubCount = memberIds.length > 0
    ? await prisma.researchOutput.count({
        where: {
          facultyMemberId: { in: memberIds },
          year: { gte: currentYear - 3 },
        },
      })
    : 0;

  const seniorCount = active.filter(
    (l) => l.facultyMember.rank === 'PROF' || l.facultyMember.rank === 'ASSOC_PROF',
  ).length;

  const fiveYearHorizon = new Date();
  fiveYearHorizon.setUTCFullYear(fiveYearHorizon.getUTCFullYear() + 5);
  const retiringSoon = active.filter(
    (l) =>
      l.facultyMember.retirementDate !== null &&
      l.facultyMember.retirementDate <= fiveYearHorizon,
  ).length;

  const drivers = [
    {
      label: 'senior_rank_share',
      value: clamp((seniorCount / active.length) * 200), // 50% senior → 100
      raw: { seniorCount, total: active.length },
    },
    {
      label: 'publications_per_faculty',
      value: (() => {
        const ratio = pubCount / active.length;
        // 5 publications / faculty / 3 years → 100. 0 → 0.
        return clamp((ratio / 5) * 100);
      })(),
      raw: { pubCount, faculty: active.length, windowYears: 3 },
    },
    {
      label: 'retirement_horizon_5y',
      value: clamp(100 - (retiringSoon / active.length) * 100),
      raw: { retiringSoon, total: active.length },
    },
    {
      label: 'student_faculty_ratio',
      // Discipline-aware: clinical programs scored against a stricter
      // band than humanities. Null when no enrolment data yet —
      // programs without recent EnrollmentMetric rows get a null
      // driver rather than a misleading "perfect" 100.
      value: enrolled === 0
        ? null
        : clamp(scoreStudentFacultyRatio(enrolled / active.length, sfrBand)),
      raw: {
        enrolled,
        faculty: active.length,
        ratio: enrolled === 0 ? null : enrolled / active.length,
        band: sfrBand,
        bandThresholds: SFR_BANDS[sfrBand],
      },
    },
  ];
  return summariseDrivers(drivers);
}

// ── Discipline-aware student-per-faculty ratio scoring ────────────────
//
// QS World Rankings + THE both apply different SFR thresholds by
// subject. Clinical disciplines (MD, dentistry, vet, nursing) require
// far more 1:1 supervision than humanities or business; a flat 5/15/45
// scale would punish humanities programs and over-reward medical
// schools. The bands below mirror QS subject-band conventions:
//
//   CLINICAL    — bedside / lab-supervised programs       6:1 → 100, 16:1 → 0
//   STEM_LAB    — lab-intensive sciences + engineering    10:1 → 100, 28:1 → 0
//   STUDIO      — studio / individual-instruction arts    8:1 → 100, 22:1 → 0
//   PROFESSIONAL — business / law / professional cohorts  18:1 → 100, 38:1 → 0
//   HUMANITIES  — lecture-driven humanities + social sci  22:1 → 100, 48:1 → 0
//
// Each band: linear from "world-class" at the lower bound to 0 at the
// upper bound; below lower → 100; above upper → 0.
type SfrBand = 'CLINICAL' | 'STEM_LAB' | 'STUDIO' | 'PROFESSIONAL' | 'HUMANITIES';
const SFR_BANDS: Record<SfrBand, { lower: number; upper: number }> = {
  CLINICAL:     { lower: 6,  upper: 16 },
  STEM_LAB:     { lower: 10, upper: 28 },
  STUDIO:       { lower: 8,  upper: 22 },
  PROFESSIONAL: { lower: 18, upper: 38 },
  HUMANITIES:   { lower: 22, upper: 48 },
};

// Faculty-code → SFR band. Anchored to KKU's 24 faculties as of 2026-05.
// Graduate School / MBA / International College roll up small cohorts of
// mixed discipline; default them to PROFESSIONAL (mid-band) — analyst
// can refine later via per-program override if needed.
const SFR_BAND_BY_FACULTY: Record<string, SfrBand> = {
  // Clinical / patient-supervised
  MD:   'CLINICAL',
  DT:   'CLINICAL',
  VM:   'CLINICAL',
  NU:   'CLINICAL',
  AMS:  'CLINICAL',
  PH:   'CLINICAL',
  PHA:  'CLINICAL',
  // Lab-intensive sciences + engineering
  AG:   'STEM_LAB',
  SC:   'STEM_LAB',
  EN:   'STEM_LAB',
  TC:   'STEM_LAB',
  COC:  'STEM_LAB',
  // Studio / individual-instruction
  AR:   'STUDIO',
  FAR:  'STUDIO',
  // Professional / cohort-based
  BS:   'PROFESSIONAL',
  LAW:  'PROFESSIONAL',
  EC:   'PROFESSIONAL',
  COLA: 'PROFESSIONAL',
  IC:   'PROFESSIONAL',
  NK:   'PROFESSIONAL',
  GS:   'PROFESSIONAL',
  MBA:  'PROFESSIONAL',
  // Humanities + lecture-heavy social science / education
  HU:   'HUMANITIES',
  ED:   'HUMANITIES',
};

function sfrBandFor(facultyCode: string | null | undefined): SfrBand {
  if (!facultyCode) return 'PROFESSIONAL'; // defensive default — middle of the road
  return SFR_BAND_BY_FACULTY[facultyCode] ?? 'PROFESSIONAL';
}

function scoreStudentFacultyRatio(ratio: number, band: SfrBand): number {
  const { lower, upper } = SFR_BANDS[band];
  if (ratio <= lower) return 100;
  if (ratio >= upper) return 0;
  return 100 - ((ratio - lower) / (upper - lower)) * 100;
}

async function scoreCapabilityScope(scopeId: string, scope: ScopeLevel): Promise<HealthScore> {
  // Aggregate over all programs under this scope.
  const programIds = await collectProgramIdsForScope(scopeId, scope);
  const driverLabels = [
    'senior_rank_share',
    'publications_per_faculty',
    'retirement_horizon_5y',
    'student_faculty_ratio',
  ];
  if (programIds.length === 0) return emptyScore(driverLabels);

  // SFR band selection at scope level:
  //   faculty / department → use that faculty's discipline band
  //   university (rollup)  → use PROFESSIONAL (middle-of-the-road) since
  //                          the row aggregates a mix of disciplines
  let scopeBand: SfrBand = 'PROFESSIONAL';
  if (scope === 'faculty' || scope === 'department') {
    const fac = await prisma.faculty.findFirst({
      where:
        scope === 'faculty'
          ? { id: scopeId }
          : { departments: { some: { id: scopeId } } },
      select: { code: true },
    });
    scopeBand = sfrBandFor(fac?.code);
  } else if (scope === 'program') {
    const p = await prisma.program.findUnique({
      where: { id: scopeId },
      select: { faculty: { select: { code: true } } },
    });
    scopeBand = sfrBandFor(p?.faculty?.code);
  }
  const links = await prisma.programFaculty.findMany({
    where: { programId: { in: programIds } },
    include: {
      facultyMember: {
        select: { id: true, rank: true, isActive: true, retirementDate: true },
      },
    },
  });
  const distinctActive = new Map<string, typeof links[number]['facultyMember']>();
  for (const l of links) {
    if (l.facultyMember.isActive) distinctActive.set(l.facultyMember.id, l.facultyMember);
  }
  const active = [...distinctActive.values()];
  if (active.length === 0) return emptyScore(driverLabels);

  const memberIds = active.map((m) => m.id);
  const currentYear = new Date().getUTCFullYear();
  const pubCount = await prisma.researchOutput.count({
    where: { facultyMemberId: { in: memberIds }, year: { gte: currentYear - 3 } },
  });
  const seniorCount = active.filter((m) => m.rank === 'PROF' || m.rank === 'ASSOC_PROF').length;
  const fiveYearHorizon = new Date();
  fiveYearHorizon.setUTCFullYear(fiveYearHorizon.getUTCFullYear() + 5);
  const retiringSoon = active.filter(
    (m) => m.retirementDate !== null && m.retirementDate <= fiveYearHorizon,
  ).length;

  // Aggregate enrolment across all programs in scope (sum of latest year per program).
  const latestEnrolByProgram = await prisma.$queryRaw<Array<{ enrolled: bigint }>>`
    WITH latest AS (
      SELECT program_id, MAX(academic_year) as max_year
      FROM enrollment_metrics
      WHERE program_id = ANY(${programIds})
      GROUP BY program_id
    )
    SELECT em.enrolled::bigint as enrolled
    FROM enrollment_metrics em
    JOIN latest l ON l.program_id = em.program_id AND em.academic_year = l.max_year;
  `;
  const totalEnrolled = latestEnrolByProgram.reduce((s, r) => s + Number(r.enrolled), 0);
  const drivers = [
    { label: 'senior_rank_share', value: clamp((seniorCount / active.length) * 200), raw: { seniorCount, total: active.length } },
    { label: 'publications_per_faculty', value: clamp((pubCount / active.length / 5) * 100), raw: { pubCount, total: active.length } },
    { label: 'retirement_horizon_5y', value: clamp(100 - (retiringSoon / active.length) * 100), raw: { retiringSoon, total: active.length } },
    {
      label: 'student_faculty_ratio',
      value: totalEnrolled === 0
        ? null
        : clamp(scoreStudentFacultyRatio(totalEnrolled / active.length, scopeBand)),
      raw: {
        enrolled: totalEnrolled,
        faculty: active.length,
        ratio: totalEnrolled === 0 ? null : totalEnrolled / active.length,
        band: scopeBand,
        bandThresholds: SFR_BANDS[scopeBand],
      },
    },
  ];
  return summariseDrivers(drivers);
}

// ──────────────────────────────────────────────────────────────────────────
// Outcomes — TCAS percentile + employment + salary
// ──────────────────────────────────────────────────────────────────────────

async function scoreOutcomesProgram(programId: string, oRow: MetricRow | null): Promise<HealthScore> {
  // TCAS min-score percentile: KKU's min score's percentile among
  // peer programs in the same subject + (year, round).
  const kkuTcas = await prisma.tcasAdmissionStat.findFirst({
    where: { programId, minScorePass1: { not: null } },
    orderBy: [{ entryYearBE: 'desc' }, { round: 'desc' }],
  });
  let percentile: number | null = null;
  if (kkuTcas && kkuTcas.minScorePass1 !== null) {
    const subjectKey = extractSubjectSignature(kkuTcas.programmeName);
    const peers = await prisma.tcasAdmissionStat.findMany({
      where: {
        entryYearBE: kkuTcas.entryYearBE,
        round: kkuTcas.round,
        minScorePass1: { not: null },
        institutionName: { not: 'มหาวิทยาลัยขอนแก่น' },
        programmeName: { contains: subjectKey, mode: 'insensitive' },
      },
      select: { minScorePass1: true, programmeName: true },
    });
    const peerScores = peers
      .filter((p) => extractSubjectSignature(p.programmeName) === subjectKey)
      .map((p) => p.minScorePass1!)
      .filter((v): v is number => v !== null);
    if (peerScores.length >= 3) {
      const below = peerScores.filter((s) => s < kkuTcas.minScorePass1!).length;
      percentile = (below / peerScores.length) * 100;
    }
  }

  // Pull the latest GraduateOutcome row directly. The annual KKU
  // graduate-employment survey (real data, ingested via
  // `pnpm outcomes:ingest`) is the canonical source; fall back to the
  // MV-aggregate `oRow` when no GraduateOutcome row exists yet for
  // this program (postgrad programs aren't surveyed; older cohorts
  // may not yet be ingested).
  const grad = await prisma.graduateOutcome.findFirst({
    where: { programId },
    orderBy: [{ surveyYear: 'desc' }, { graduationYear: 'desc' }],
  });

  const drivers = [
    {
      label: 'tcas_min_score_percentile',
      value: percentile !== null ? clamp(percentile) : null,
      raw: { kkuMin: kkuTcas?.minScorePass1, percentile },
    },
    {
      label: 'employment_rate',
      // GraduateOutcome.employmentRate is 0..1; convert to 0..100.
      // Fall back to MV when no survey row exists.
      value: grad
        ? clamp(grad.employmentRate * 100)
        : oRow?.employmentRateWeighted != null
          ? clamp(oRow.employmentRateWeighted * 100)
          : null,
      raw: grad
        ? {
            employmentRate: grad.employmentRate,
            surveyYear: grad.surveyYear,
            graduationYear: grad.graduationYear,
            sampleSize: grad.sampleSize,
            method: grad.methodologyVersion,
          }
        : oRow?.employmentRateWeighted,
    },
    {
      label: 'job_relevance',
      // Share of graduates whose job is "ตรงสาขา" (matches discipline).
      // 0..1 → 0..100. Null when not surveyed (postgrad) or when the
      // report didn't break this out per program.
      value: grad && grad.jobRelevanceScore > 0
        ? clamp(grad.jobRelevanceScore * 100)
        : null,
      raw: grad
        ? { jobRelevanceScore: grad.jobRelevanceScore, surveyYear: grad.surveyYear }
        : null,
    },
    {
      label: 'average_salary',
      // Thai graduate-salary anchors (Council benchmark 2024):
      //   ฿15,000 → 0     (legal floor)
      //   ฿20,000 → 40    (typical entry)
      //   ฿25,000 → 70
      //   ฿35,000+ → 100  (premium / high-skill clinical / engineering)
      value: (() => {
        const salary = grad ? Number(grad.averageSalary) : oRow?.averageSalaryWeighted ?? null;
        if (!salary || salary <= 0) return null;
        return clamp(((salary - 15_000) / 200));
      })(),
      raw: grad
        ? { averageSalary: Number(grad.averageSalary), surveyYear: grad.surveyYear }
        : oRow?.averageSalaryWeighted,
    },
    {
      label: 'further_study_rate',
      // Share continuing to graduate school. Mid-band is the sweet
      // spot — too low signals weak academic pipeline; too high
      // suggests under-employment masquerading as further study.
      // 0..0.05 → 50 (low), 0.05..0.15 → 100 (sweet spot), 0.15..0.30
      // → 70, 0.30+ → 30.
      value: grad
        ? clamp(scoreFurtherStudyRate(grad.furtherStudyRate))
        : null,
      raw: grad
        ? { furtherStudyRate: grad.furtherStudyRate, surveyYear: grad.surveyYear }
        : null,
    },
  ];
  return summariseDrivers(drivers);
}

// Sweet-spot scoring for further-study rate. Both extremes are
// negative signals (no academic pipeline / under-employment).
function scoreFurtherStudyRate(rate: number): number {
  if (rate <= 0.05) return 50 + (rate / 0.05) * 50; // 0% → 50, 5% → 100
  if (rate <= 0.15) return 100;
  if (rate <= 0.30) return 100 - ((rate - 0.15) / 0.15) * 30; // → 70 at 30%
  return Math.max(30, 70 - ((rate - 0.30) / 0.20) * 40);     // taper to 30
}

function scoreOutcomesScope(row: MetricRow | null): HealthScore {
  const drivers = [
    {
      label: 'employment_rate',
      value: row?.employmentRateWeighted !== null && row?.employmentRateWeighted !== undefined
        ? clamp(row.employmentRateWeighted * 100)
        : null,
      raw: row?.employmentRateWeighted,
    },
    {
      label: 'average_salary',
      value: row?.averageSalaryWeighted ? clamp((row.averageSalaryWeighted / 30_000) * 100) : null,
      raw: row?.averageSalaryWeighted,
    },
  ];
  return summariseDrivers(drivers);
}

// ──────────────────────────────────────────────────────────────────────────
// Relevance — labour-market alignment + demand-match + demographic +
// strategic-sector. Most signals real after the connector flips on
// 2026-04-27 → 2026-05-02.
// ──────────────────────────────────────────────────────────────────────────

const STRATEGIC_KMITL_GROUPS = new Set([
  'IT',
  'Engineer',
  'Health Science',
  'Smart Farmer',
  'New S Curve',
  'Food',
]);

async function scoreRelevanceProgram(
  programId: string,
  kmitlAlignment: number | null,
): Promise<HealthScore> {
  // Demand-match: share of *relevant* demanded skills the curriculum
  // already teaches. Only counts rows where relevant=true.
  const matchRows = await prisma.programDemandMatch.findMany({
    where: { programId, relevant: true },
    select: { matched: true },
  });
  let demandMatchValue: number | null = null;
  if (matchRows.length > 0) {
    const matched = matchRows.filter((r) => r.matched).length;
    demandMatchValue = clamp((matched / matchRows.length) * 100);
  }

  // Demographic resilience: inverted required cohort share at +10y.
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { kmitlCareerIds: true, level: true },
  });
  const demoOutlook = await computeRequiredShareAt10Y(programId, program?.level ?? 'BACHELOR');
  let demoValue: number | null = null;
  if (demoOutlook !== null) {
    // requiredShare 0.05% (5e-4) → 50; 0.001% → ~100; 0.2% → ~0.
    demoValue = clamp(100 - (demoOutlook / 0.002) * 100);
  }

  // Strategic-sector alignment: 100 if any KMITL career maps to a
  // strategic-sector group; 50 otherwise.
  let sectorValue: number | null = null;
  if (program && program.kmitlCareerIds.length > 0) {
    const careers = await prisma.kmitlCareer.findMany({
      where: { kmitlCareerId: { in: program.kmitlCareerIds } },
      select: { groupName: true },
    });
    const inStrategic = careers.some((c) => STRATEGIC_KMITL_GROUPS.has(c.groupName));
    sectorValue = inStrategic ? 100 : 50;
  }

  const drivers = [
    {
      label: 'labour_market_alignment',
      value: kmitlAlignment === null ? null : clamp(kmitlAlignment),
      raw: kmitlAlignment,
    },
    { label: 'demand_match_filled', value: demandMatchValue, raw: { totalRelevant: matchRows.length } },
    { label: 'demographic_resilience', value: demoValue, raw: { requiredShare10y: demoOutlook } },
    { label: 'strategic_sector_alignment', value: sectorValue, raw: { kmitlCareers: program?.kmitlCareerIds.length ?? 0 } },
  ];
  return summariseDrivers(drivers);
}

async function scoreRelevanceScope(
  scopeId: string,
  scope: ScopeLevel,
  programAlignment: Map<string, number>,
): Promise<HealthScore> {
  const programIds = await collectProgramIdsForScope(scopeId, scope);
  if (programIds.length === 0) {
    return emptyScore([
      'labour_market_alignment',
      'demand_match_filled',
      'demographic_resilience',
      'strategic_sector_alignment',
    ]);
  }
  const alignmentValues = programIds
    .map((id) => programAlignment.get(id))
    .filter((v): v is number => v !== undefined);
  const alignment =
    alignmentValues.length > 0
      ? alignmentValues.reduce((a, b) => a + b, 0) / alignmentValues.length
      : null;

  const matchRows = await prisma.programDemandMatch.findMany({
    where: { programId: { in: programIds }, relevant: true },
    select: { matched: true, programId: true },
  });
  const byProgram = new Map<string, { m: number; t: number }>();
  for (const r of matchRows) {
    const c = byProgram.get(r.programId) ?? { m: 0, t: 0 };
    c.t++;
    if (r.matched) c.m++;
    byProgram.set(r.programId, c);
  }
  const matchValues = [...byProgram.values()].filter((c) => c.t > 0).map((c) => (c.m / c.t) * 100);
  const demandMatch =
    matchValues.length > 0 ? matchValues.reduce((a, b) => a + b, 0) / matchValues.length : null;

  // Skip demographic + sector at scope level for v3.0 — they're
  // per-program signals; the cockpit can roll them up explicitly when
  // analyst surfaces require it.
  const drivers = [
    { label: 'labour_market_alignment', value: alignment === null ? null : clamp(alignment), raw: alignment },
    { label: 'demand_match_filled', value: demandMatch === null ? null : clamp(demandMatch), raw: demandMatch },
    { label: 'demographic_resilience', value: null, raw: null },
    { label: 'strategic_sector_alignment', value: null, raw: null },
  ];
  return summariseDrivers(drivers);
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

const KMITL_DEMAND_THRESHOLD_PCT = 5;
const KMITL_QUADRANT_FALLBACK = [
  { dataScope: 'THAILAND' as const, dataSource: 'JOB_POSTINGS' as const },
  { dataScope: 'GLOBAL' as const,   dataSource: 'JOB_POSTINGS' as const },
  { dataScope: 'THAILAND' as const, dataSource: 'PROFILES' as const },
  { dataScope: 'GLOBAL' as const,   dataSource: 'PROFILES' as const },
] as const;

async function computeKmitlProgramAlignment(): Promise<Map<string, number>> {
  const programSkills = await prisma.programSkill.findMany({
    select: { programId: true, skillId: true },
  });
  if (programSkills.length === 0) return new Map();
  const skillsByProgram = new Map<string, Set<string>>();
  for (const ps of programSkills) {
    const set = skillsByProgram.get(ps.programId) ?? new Set();
    set.add(ps.skillId);
    skillsByProgram.set(ps.programId, set);
  }
  const out = new Map<string, number>();
  const programIds = [...skillsByProgram.keys()];
  for (const quadrant of KMITL_QUADRANT_FALLBACK) {
    const remaining = programIds.filter((id) => !out.has(id));
    if (remaining.length === 0) break;
    const demandRows = await prisma.kmitlCareerSkillDemand.findMany({
      where: {
        dataScope: quadrant.dataScope,
        dataSource: quadrant.dataSource,
        percentage: { gte: KMITL_DEMAND_THRESHOLD_PCT },
        skillId: { not: null },
      },
      select: { skillId: true },
      distinct: ['skillId'],
    });
    if (demandRows.length === 0) continue;
    const demanded = new Set(demandRows.map((r) => r.skillId!).filter(Boolean));
    for (const pid of remaining) {
      const skills = skillsByProgram.get(pid)!;
      let matched = 0;
      for (const sid of skills) if (demanded.has(sid)) matched++;
      if (matched > 0 && skills.size > 0) out.set(pid, (matched / skills.size) * 100);
    }
  }
  return out;
}

async function computeRequiredShareAt10Y(
  programId: string,
  level: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA',
): Promise<number | null> {
  const cohort = level === 'BACHELOR' ? '18-22' : '23-29';
  const targetYear = new Date().getUTCFullYear() + 10;
  const projection = await prisma.demographicProjection.findFirst({
    where: {
      region: 'Northeast',
      ageCohort: cohort,
      year: targetYear,
      source: 'NESDC-PopProj-2010-2040',
    },
    select: { population: true },
  });
  if (!projection || projection.population <= 0) return null;
  const enrollment = await prisma.enrollmentMetric.findMany({
    where: { programId },
    orderBy: { academicYear: 'desc' },
    take: 2,
    select: { enrolled: true },
  });
  if (enrollment.length === 0) return null;
  // Use the prior year if it's higher (in-progress current year is
  // partial — enrolled count would be too small).
  const baseline = enrollment.length >= 2 && enrollment[1]!.enrolled > enrollment[0]!.enrolled
    ? enrollment[1]!.enrolled
    : enrollment[0]!.enrolled;
  if (baseline === 0) return null;
  return baseline / projection.population;
}

async function collectProgramIdsForScope(scopeId: string, scope: ScopeLevel): Promise<string[]> {
  if (scope === 'program') return [scopeId];
  if (scope === 'department') {
    const ps = await prisma.program.findMany({
      where: { departmentId: scopeId },
      select: { id: true },
    });
    return ps.map((p) => p.id);
  }
  if (scope === 'faculty') {
    const ps = await prisma.program.findMany({
      where: { OR: [{ facultyId: scopeId }, { department: { facultyId: scopeId } }] },
      select: { id: true },
    });
    return ps.map((p) => p.id);
  }
  // university
  const ps = await prisma.program.findMany({ select: { id: true } });
  return ps.map((p) => p.id);
}

function extractSubjectSignature(programmeName: string): string {
  const inParens = programmeName.match(/\(([^)]+)\)/);
  if (inParens) return normaliseSubjectKey(inParens[1]!);
  const withSakha = programmeName.match(/สาขาวิชา\s*([^\s,()/]+(?:\s+[^\s,()/]+)?)/);
  if (withSakha) return normaliseSubjectKey(withSakha[1]!);
  return normaliseSubjectKey(programmeName);
}

// Normalise a Thai discipline key for cross-row equality. Strips
// degree-name suffixes (บัณฑิต / มหาบัณฑิต / ดุษฎีบัณฑิต), the
// "หลักสูตร"/"สาขาวิชา" prefix words, and the mai-thanthakhat (์) silent
// mark — so "แพทยศาสตรบัณฑิต" and "แพทยศาสตร์" both collapse to
// "แพทยศาสตร". Necessary because the new TCAS funnel doesn't carry the
// peer institutions' programmeName format; we resolve via Program.nameTh
// which often has the degree-only form.
function normaliseSubjectKey(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/^(หลักสูตร|สาขาวิชา)\s*/g, '')
    .replace(/(ดุษฎีบัณฑิต|มหาบัณฑิต|บัณฑิต)$/g, '')
    .replace(/์/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

interface SeriesPoint { year: number; value: number }
function applyPartialYearDrop(series: SeriesPoint[]): SeriesPoint[] {
  if (series.length < 2) return series;
  const last = series[series.length - 1]!.value;
  const prior = series[series.length - 2]!.value;
  if (prior > 0 && last < prior * 0.3) return series.slice(0, -1);
  return series;
}

function linearSlope(series: SeriesPoint[]): number {
  if (series.length < 2) return 0;
  const n = series.length;
  const meanX = series.reduce((s, p) => s + p.year, 0) / n;
  const meanY = series.reduce((s, p) => s + p.value, 0) / n;
  let num = 0;
  let den = 0;
  for (const p of series) {
    num += (p.year - meanX) * (p.value - meanY);
    den += (p.year - meanX) ** 2;
  }
  if (den === 0) return 0;
  return num / den;
}

function summariseDrivers(drivers: HealthScore['drivers']): HealthScore {
  const nonNull = drivers.filter((d) => d.value !== null);
  const completeness = (nonNull.length / drivers.length) * 100;
  if (nonNull.length === 0) return { score: null, dataCompletenessPct: 0, drivers };
  const score = nonNull.reduce((s, d) => s + (d.value ?? 0), 0) / nonNull.length;
  return { score: clamp(score), dataCompletenessPct: completeness, drivers };
}

function emptyScore(labels: string[]): HealthScore {
  return {
    score: null,
    dataCompletenessPct: 0,
    drivers: labels.map((label) => ({ label, value: null, raw: null })),
  };
}

function combineDimensions(dims: HealthScore[]): HealthScore {
  const nonNull = dims.filter((d) => d.score !== null);
  const completenessContribs = dims.map((d) => d.dataCompletenessPct / 100);
  const avgCompleteness = (completenessContribs.reduce((s, v) => s + v, 0) / dims.length) * 100;
  if (nonNull.length === 0) {
    return { score: null, dataCompletenessPct: avgCompleteness, drivers: [] };
  }
  const score = nonNull.reduce((s, d) => s + (d.score ?? 0), 0) / nonNull.length;
  return { score: clamp(score), dataCompletenessPct: avgCompleteness, drivers: [] };
}

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, n));
}
