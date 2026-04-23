import { z } from 'zod';
import type { ScopeLevel } from './scope';
import { prisma } from './index';
import { queryMetricByScope } from './scope';

// Health scores for the Portfolio Overview Cockpit (prompt 05). Five
// dimensions + overall composite. Scores 0-100 where 100 is healthy.
//
// Methodology: see docs/methodologies/health-score.md. Edit that first
// when changing the formula, then bump HEALTH_SCORE_VERSION here, then
// change the logic.
//
// Null handling rule: missing metrics are EXCLUDED from the average
// (not substituted with 0 or 50). dataCompletenessPct on every score
// tells the reader how much data actually went into it.

export const HEALTH_SCORE_VERSION = 'health-score.v1';

export const HEALTH_DIMENSIONS = [
  'demand',
  'financial',
  'quality',
  'relevance',
  'capability',
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

// Each dimension is guaranteed present — using z.object (not z.record)
// gives consumers a narrowed type without undefined-checking on every
// access.
export const HealthDimensionScoresSchema = z.object({
  demand: HealthScoreSchema,
  financial: HealthScoreSchema,
  quality: HealthScoreSchema,
  relevance: HealthScoreSchema,
  capability: HealthScoreSchema,
});
export type HealthDimensionScores = z.infer<typeof HealthDimensionScoresSchema>;

export const HealthScoreRowSchema = z.object({
  scope: z.string(),                     // 'university' | 'faculty' | 'department' | 'program'
  scopeId: z.string(),
  scopeLabel: z.string(),                // human-facing name
  parentScopeId: z.string().nullable(),  // faculty within which a department sits, etc.
  methodologyVersion: z.string(),
  dimensions: HealthDimensionScoresSchema,
  overall: HealthScoreSchema,
  // Freshness of the newest underlying metric row used.
  latestFreshness: z.date().nullable(),
});
export type HealthScoreRow = z.infer<typeof HealthScoreRowSchema>;

// ──────────────────────────────────────────────────────────────────────────
// Public entry points
// ──────────────────────────────────────────────────────────────────────────

/**
 * Health scores for every rollup node under a given scope.
 *
 * At university scope → one row per faculty.
 * At faculty scope → one row per department in that faculty.
 * At department scope → one row per program in that department.
 * At program scope → a single row for that program.
 *
 * The caller decides whether to show overall only, or all five
 * dimensions — the row carries both.
 */
export async function computeHealthScores(
  scope: ScopeLevel,
  scopeId: string | null,
): Promise<HealthScoreRow[]> {
  const childScope = childScopeFor(scope);
  const children = await resolveChildren(scope, scopeId);

  const rows: HealthScoreRow[] = [];
  for (const child of children) {
    // Latest-year metric row at the child scope.
    const metrics = await queryMetricByScope({
      scope: childScope,
      scopeId: child.id,
      family: 'enrollment',
    });
    const latest = metrics.at(-1);
    const financials = await queryMetricByScope({
      scope: childScope,
      scopeId: child.id,
      family: 'financial',
    });
    const fLatest = financials.at(-1);
    const outcomes = await queryMetricByScope({
      scope: childScope,
      scopeId: child.id,
      family: 'outcomes',
    });
    const oLatest = outcomes.at(-1);

    const dimensions: HealthScoreRow['dimensions'] = {
      demand: scoreDemand(latest ?? null),
      financial: scoreFinancial(fLatest ?? null),
      quality: scoreQuality(oLatest ?? null),
      relevance: scoreRelevancePlaceholder(),
      capability: scoreCapabilityPlaceholder(),
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
        latest?.latestFreshness ?? fLatest?.latestFreshness ?? oLatest?.latestFreshness ?? null,
    });
  }
  return rows;
}

// ──────────────────────────────────────────────────────────────────────────
// Child resolution — which nodes hang off the given scope?
// ──────────────────────────────────────────────────────────────────────────

function childScopeFor(scope: ScopeLevel): ScopeLevel {
  switch (scope) {
    case 'university':
      return 'faculty';
    case 'faculty':
      return 'department';
    case 'department':
      return 'program';
    case 'program':
      return 'program';
  }
}

interface ChildNode {
  id: string;
  label: string;
  parentId: string | null;
}

async function resolveChildren(scope: ScopeLevel, scopeId: string | null): Promise<ChildNode[]> {
  if (scope === 'university') {
    const rows = await prisma.faculty.findMany({
      select: { id: true, nameEn: true, nameTh: true },
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, label: `${r.nameEn} · ${r.nameTh}`, parentId: null }));
  }
  if (scope === 'faculty') {
    if (!scopeId) return [];
    const rows = await prisma.department.findMany({
      where: { facultyId: scopeId },
      select: { id: true, nameEn: true, nameTh: true, facultyId: true },
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, label: `${r.nameEn} · ${r.nameTh}`, parentId: r.facultyId }));
  }
  if (scope === 'department') {
    if (!scopeId) return [];
    const rows = await prisma.program.findMany({
      where: { departmentId: scopeId },
      select: { id: true, nameEn: true, nameTh: true, departmentId: true },
      orderBy: { code: 'asc' },
    });
    return rows.map((r) => ({ id: r.id, label: `${r.nameEn} · ${r.nameTh}`, parentId: r.departmentId }));
  }
  // program
  if (!scopeId) return [];
  const row = await prisma.program.findUnique({
    where: { id: scopeId },
    select: { id: true, nameEn: true, nameTh: true, departmentId: true },
  });
  return row
    ? [{ id: row.id, label: `${row.nameEn} · ${row.nameTh}`, parentId: row.departmentId }]
    : [];
}

// ──────────────────────────────────────────────────────────────────────────
// Dimension scorers — each returns a HealthScore or the empty shape.
//
// Each one is a pure function of a metric row (or null). Null in →
// score: null, completeness: 0. Missing field in the row → that driver
// is null; completeness proportional to non-null drivers.
// ──────────────────────────────────────────────────────────────────────────

import type { MetricRow } from './scope';

function scoreDemand(row: MetricRow | null): HealthScore {
  // Drivers: admission yield, retention year 2, enrolled-per-program.
  // Demand's proper form (labour-market + demographic ceiling) needs
  // prompt 14's real connectors — placeholders filled in below.
  const drivers = [
    {
      label: 'admission_yield',
      value: (() => {
        if (!row?.admittedTotal || !row.applicationsTotal) return null;
        const yieldPct = row.admittedTotal / row.applicationsTotal;
        // Higher yield = higher demand-to-supply. Scale 0.3 → 100.
        return clamp((yieldPct / 0.3) * 100);
      })(),
      raw: row?.applicationsTotal,
    },
    {
      label: 'retention_year2',
      value: (() => {
        if (!row?.retainedYear2Total || !row.enrolledTotal) return null;
        return clamp((row.retainedYear2Total / row.enrolledTotal) * 100);
      })(),
      raw: row?.retainedYear2Total,
    },
    {
      label: 'on_time_graduation',
      value: (() => {
        if (!row?.graduatedOnTimeTotal) return null;
        const total = (row.graduatedOnTimeTotal ?? 0) + (row.graduatedLateTotal ?? 0) + (row.dropoutsTotal ?? 0);
        if (total === 0) return null;
        return clamp((row.graduatedOnTimeTotal / total) * 100);
      })(),
      raw: row?.graduatedOnTimeTotal,
    },
  ];
  return summariseDrivers(drivers);
}

function scoreFinancial(row: MetricRow | null): HealthScore {
  const drivers = [
    {
      label: 'net_contribution_per_program',
      value: (() => {
        if (row?.netContributionTotal === null || row?.netContributionTotal === undefined) return null;
        if (!row.programCount) return null;
        const perProgram = row.netContributionTotal / row.programCount;
        // 20M THB / program → 100. 0 → 50. Negative → scales down to 0.
        return clamp(50 + (perProgram / 20_000_000) * 50);
      })(),
      raw: row?.netContributionTotal,
    },
    {
      label: 'revenue_coverage_ratio',
      value: (() => {
        if (!row?.tuitionRevenueTotal || !row.totalCostTotal) return null;
        const ratio = row.tuitionRevenueTotal / row.totalCostTotal;
        // 1.0 → 80. Below 1 (subsidised) → scales down. 1.2+ → 100.
        return clamp((ratio / 1.2) * 100);
      })(),
      raw: row?.tuitionRevenueTotal,
    },
  ];
  return summariseDrivers(drivers);
}

function scoreQuality(row: MetricRow | null): HealthScore {
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
      value: (() => {
        if (!row?.averageSalaryWeighted) return null;
        // Salary 30k THB/month → 100 (strong entry level in Khon Kaen
        // for a fresh graduate). 15k → 50. Clamp beyond.
        return clamp((row.averageSalaryWeighted / 30_000) * 100);
      })(),
      raw: row?.averageSalaryWeighted,
    },
  ];
  return summariseDrivers(drivers);
}

function scoreRelevancePlaceholder(): HealthScore {
  // Real relevance = skill coverage × policy alignment. Needs the
  // prompt-04 ProgramSkill rollups to be materialised (post-approval
  // handler — deferred). For now we return empty so every row shows
  // "low data" rather than a fabricated number.
  return {
    score: null,
    dataCompletenessPct: 0,
    drivers: [
      { label: 'skill_coverage_vs_demand', value: null, raw: null },
      { label: 'policy_alignment', value: null, raw: null },
    ],
  };
}

function scoreCapabilityPlaceholder(): HealthScore {
  // Real capability = faculty-to-student ratio + retirement horizon +
  // active research. Needs KKU-HR real feed (prompt 14) + research
  // output crosswalk. Empty for v1.
  return {
    score: null,
    dataCompletenessPct: 0,
    drivers: [
      { label: 'faculty_student_ratio', value: null, raw: null },
      { label: 'retirement_horizon', value: null, raw: null },
      { label: 'active_research', value: null, raw: null },
    ],
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Aggregators
// ──────────────────────────────────────────────────────────────────────────

function summariseDrivers(drivers: HealthScore['drivers']): HealthScore {
  const nonNull = drivers.filter((d) => d.value !== null);
  const completeness = (nonNull.length / drivers.length) * 100;
  if (nonNull.length === 0) {
    return { score: null, dataCompletenessPct: 0, drivers };
  }
  const score = nonNull.reduce((s, d) => s + (d.value ?? 0), 0) / nonNull.length;
  return { score: clamp(score), dataCompletenessPct: completeness, drivers };
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
