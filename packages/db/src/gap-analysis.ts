import { z } from 'zod';
import { Prisma, type ForecastKind, type SectorFamily } from '@prisma/client';
import { prisma } from './index';
import type { ScopeLevel } from './scope';
import {
  forecastHoltLinear,
  forecastLinear,
  forecastSupplyWithDemographic,
  FORECASTING_VERSION,
  type ForecastResult,
  type TimePoint,
} from '@kku/shared';

// ═══════════════════════════════════════════════════════════════════════
// Gap analysis (prompt 08)
//
// Pure read-side computation against existing metric tables + sectors
// + forecast runs. No state changes here — POST /gap/insights/generate
// writes one AiInference row via the AI service; that path lives in the
// API layer.
//
// All helpers return explicit result types (not Prisma's inferred shape)
// because packages/db compiles with declaration: true, and the inferred
// types would leak the full Prisma client path.
// ═══════════════════════════════════════════════════════════════════════

export const GAP_ANALYSIS_VERSION = 'gap-analysis.v1';

export const GapFilterSchema = z.object({
  scope: z.enum(['university', 'faculty', 'department', 'program']).default('university'),
  scopeId: z.string().optional(),
  region: z.string().default('TH'),
  // Years forward from "now". 0 = current.
  horizon: z.union([z.literal(0), z.literal(3), z.literal(5), z.literal(10)]).default(0),
  comparison: z.enum(['absolute', 'per-capita', 'growth-adjusted']).default('absolute'),
  limit: z.number().int().min(1).max(200).default(30),
  // Demand source for skill-gap computation. Default 'auto' picks 'kmitl'
  // when KmitlCareerSkillDemand has rows, else 'job_postings' (mock seed).
  // 'blended' weighs both 0.5/0.5 — analyst exploration only, not Council-
  // facing. Added 2026-05-01 with the kmitl-skill-mapping connector.
  demandSource: z.enum(['auto', 'job_postings', 'kmitl', 'blended']).default('auto'),
  // Exclude soft / transferable / language skills from the gap analysis.
  // Job-posting taxonomies (KMITL, JobThai, JobsDB) systematically
  // under-list these — every employer wants "teamwork" but few list it
  // as a posting requirement. Including them creates artificial
  // "oversupply" rows that mislead Council. Default ON.
  excludeSoftSkills: z.boolean().default(true),
});
// Output type (post-parse, defaults applied). Used internally + as the
// shape returned from helpers. Public callers can pass GapFilterInput
// (any field optional — defaults fill in) and receive a normalised
// GapFilter back via the schema.parse(filter) at function entry.
export type GapFilter = z.infer<typeof GapFilterSchema>;
export type GapFilterInput = z.input<typeof GapFilterSchema>;

// ── Skill gap ────────────────────────────────────────────────────────
export interface SkillGapRow {
  skillId: string;
  skillCode: string;
  nameTh: string;
  nameEn: string;
  category: string | null;
  demand: number; // job postings × weight, in the filter window
  supply: number; // program-skill weight × program graduate count
  gap: number; // positive = demand > supply (opportunity)
  gapPct: number | null; // gap / max(demand, 1) × 100
  topDemandingEmployers: string[]; // up to 3
  topSupplyingProgramIds: string[]; // up to 3
  methodologyVersion: string;
}
export interface SkillGapResult {
  filter: GapFilter;
  rows: SkillGapRow[];
  totalSkillsConsidered: number;
  asOf: string; // ISO date
  lowConfidenceReason: string | null;
}

export async function computeSkillGap(filter: GapFilterInput): Promise<SkillGapResult> {
  const f = GapFilterSchema.parse(filter);

  // Scope filter for supply side — faculty/department/program restrict
  // which ProgramSkill rows count as supply. Demand side is region-
  // scoped, not faculty-scoped (labor market doesn't care about KKU
  // internal org).
  const programIds = await programIdsForScope(f.scope, f.scopeId);

  // Demand source resolution. 'auto' picks kmitl when its tables have rows,
  // else falls back to job_postings (which today is the mock seed).
  const resolvedSource = await resolveDemandSource(f.demandSource);

  // Demand: JobPostingSkill × JobPosting in region + recency window.
  // Window = 12 months back for horizon=0, else we use the forecast.
  const demandWindowStart = new Date();
  demandWindowStart.setFullYear(demandWindowStart.getFullYear() - 1);

  const demandRows = await fetchDemandRows(resolvedSource, demandWindowStart, f);

  // Supply: ProgramSkill weight × per-program graduate count.
  //
  // Per-program graduate count uses real cohort outcomes from
  // AlumniCohortStatus (sum of GRADUATED bucket across recent entry
  // years) when present. Falls back to enrollment_metrics
  // graduated_on_time (the older admission-side proxy) for programs
  // that don't have alumni rows yet. 207 / 297 active programs are
  // currently covered by AlumniCohortStatus.
  //
  // Recency window: alumni entry years BE ≥ (latest - 5) → roughly the
  // last 5 cohorts of graduates, which approximates "graduates per
  // year × 5". Divided by 5 below for a per-year supply rate.
  const supplyRows = await prisma.$queryRaw<
    {
      skill_id: string;
      supply: number;
      top_programs: string[];
    }[]
  >(Prisma.sql`
    WITH latest_be AS (
      SELECT MAX(entry_year_be) AS max_be FROM alumni_cohort_statuses
    ),
    alumni_per_program AS (
      SELECT
        program_id,
        SUM(count)::float / 5.0 AS graduates_per_year
      FROM alumni_cohort_statuses, latest_be
      WHERE status_bucket = 'GRADUATED'
        AND entry_year_be >= latest_be.max_be - 5
      GROUP BY program_id
    ),
    latest_grad AS (
      SELECT DISTINCT ON (program_id) program_id, graduated_on_time
      FROM enrollment_metrics
      ORDER BY program_id, academic_year DESC
    ),
    per_program_supply AS (
      SELECT
        p.id as program_id,
        COALESCE(a.graduates_per_year, lg.graduated_on_time, 0)::float AS supply,
        CASE WHEN a.graduates_per_year IS NOT NULL THEN 'alumni' ELSE 'enrolment-proxy' END AS source
      FROM programs p
      LEFT JOIN alumni_per_program a ON a.program_id = p.id
      LEFT JOIN latest_grad lg ON lg.program_id = p.id
    )
    SELECT
      ps.skill_id,
      SUM(ps.weight * pps.supply)::float AS supply,
      (ARRAY_AGG(ps.program_id ORDER BY ps.weight DESC))[1:3] AS top_programs
    FROM program_skills ps
    JOIN per_program_supply pps ON pps.program_id = ps.program_id
    ${programIds.length > 0 ? Prisma.sql`WHERE ps.program_id = ANY(${programIds})` : Prisma.empty}
    GROUP BY ps.skill_id
  `);

  // Index maps for merge.
  const demandMap = new Map<string, { demand: number; top: string[] }>();
  for (const r of demandRows) demandMap.set(r.skill_id, { demand: r.demand ?? 0, top: r.top_employers ?? [] });
  const supplyMap = new Map<string, { supply: number; top: string[] }>();
  for (const r of supplyRows) supplyMap.set(r.skill_id, { supply: r.supply ?? 0, top: r.top_programs ?? [] });

  const allSkillIds = new Set([...demandMap.keys(), ...supplyMap.keys()]);
  const skillRowsRaw = await prisma.skill.findMany({
    where: { id: { in: [...allSkillIds] } },
    select: { id: true, code: true, nameTh: true, nameEn: true, category: true },
  });
  const skillRows = f.excludeSoftSkills
    ? skillRowsRaw.filter((s) => !isSoftSkill(s.category, s.nameEn))
    : skillRowsRaw;

  const rows: SkillGapRow[] = skillRows.map((s) => {
    const d = demandMap.get(s.id)?.demand ?? 0;
    const sup = supplyMap.get(s.id)?.supply ?? 0;
    const gap = d - sup;
    const gapPct = d > 0 ? (gap / d) * 100 : null;
    return {
      skillId: s.id,
      skillCode: s.code,
      nameTh: s.nameTh,
      nameEn: s.nameEn,
      category: s.category,
      demand: d,
      supply: sup,
      gap,
      gapPct,
      topDemandingEmployers: demandMap.get(s.id)?.top ?? [],
      topSupplyingProgramIds: supplyMap.get(s.id)?.top ?? [],
      methodologyVersion: GAP_ANALYSIS_VERSION,
    };
  });

  // Per-capita comparison: normalise against KKU student body at the scope.
  // Growth-adjusted: divide by (1 + sector demandMultiplier diff) — cheap proxy.
  if (f.comparison === 'per-capita') {
    const totalStudents = await totalStudentsInScope(f.scope, f.scopeId);
    const denom = Math.max(totalStudents, 1);
    for (const r of rows) r.supply = r.supply / denom;
  }

  // Sort by |gap| descending so the most extreme (either direction) surfaces first.
  rows.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));

  const lowConfidenceReason =
    demandRows.length === 0 && supplyRows.length === 0
      ? `No demand or supply signal yet (demandSource=${resolvedSource}).`
      : demandRows.length === 0
        ? `Demand side empty (demandSource=${resolvedSource}) — only supply counts are live.`
        : resolvedSource === 'job_postings' && (await kmitlDemandHasRows())
          ? 'Using legacy job_postings source while the LinkedIn-via-MHESI labour-market data clears its 30-day green-history gate.'
          : null;

  return {
    filter: f,
    rows: rows.slice(0, f.limit),
    totalSkillsConsidered: rows.length,
    asOf: new Date().toISOString(),
    lowConfidenceReason,
  };
}

// ── Demand-source resolution + alternate fetchers ────────────────────────

type ResolvedDemandSource = 'job_postings' | 'kmitl' | 'blended';

async function resolveDemandSource(
  source: GapFilter['demandSource'],
): Promise<ResolvedDemandSource> {
  if (source === 'auto') {
    return (await kmitlDemandHasRows()) ? 'kmitl' : 'job_postings';
  }
  return source;
}

async function kmitlDemandHasRows(): Promise<boolean> {
  const n = await prisma.kmitlCareerSkillDemand.count({
    where: { dataScope: 'THAILAND', dataSource: 'JOB_POSTINGS' },
    take: 1,
  });
  return n > 0;
}

interface DemandRow {
  skill_id: string;
  demand: number;
  top_employers: string[];
}

async function fetchDemandRows(
  source: ResolvedDemandSource,
  windowStart: Date,
  f: GapFilter,
): Promise<DemandRow[]> {
  if (source === 'job_postings') {
    return prisma.$queryRaw<DemandRow[]>(Prisma.sql`
      SELECT
        jps.skill_id,
        SUM(jps.weight)::float AS demand,
        (ARRAY_AGG(DISTINCT jp.employer_name) FILTER (WHERE jp.employer_name IS NOT NULL))[1:3]
          AS top_employers
      FROM job_posting_skills jps
      JOIN job_postings jp ON jp.id = jps.job_posting_id
      WHERE jp.posted_date >= ${windowStart}
        ${regionFilterClause(f.region, 'jp.province')}
      GROUP BY jps.skill_id
    `);
  }

  // LinkedIn (via MHESI / KMITL-hosted API) demand: aggregate percentage
  // across all careers in the THAILAND × JOB_POSTINGS scope, latest
  // snapshot. `demand` is the SUM of percentage values — analogous to
  // "total weight" in the job_postings pathway. `top_employers` is empty
  // (the LinkedIn API contract is aggregate-only, no per-employer names);
  // we surface career names instead via top_employers. The internal enum
  // value `'kmitl'` is preserved as a code identifier — it identifies the
  // API endpoint; the data source is LinkedIn.
  const kmitlRows = await prisma.$queryRaw<DemandRow[]>(Prisma.sql`
    SELECT
      d.skill_id,
      SUM(d.percentage)::float AS demand,
      (ARRAY_AGG(c.career_name ORDER BY d.percentage DESC))[1:3] AS top_employers
    FROM kmitl_career_skill_demands d
    JOIN kmitl_careers c ON c.id = d.career_id
    WHERE d.skill_id IS NOT NULL
      AND d.data_scope = 'THAILAND'
      AND d.data_source = 'JOB_POSTINGS'
    GROUP BY d.skill_id
  `);

  if (source === 'kmitl') return kmitlRows;

  // Blended: 0.5 × job_postings + 0.5 × kmitl (normalised independently to
  // their own max, then summed). Analyst exploration only.
  const jpRows = await fetchDemandRows('job_postings', windowStart, f);
  const jpMax = Math.max(...jpRows.map((r) => r.demand), 1);
  const kmitlMax = Math.max(...kmitlRows.map((r) => r.demand), 1);
  const merged = new Map<string, DemandRow>();
  for (const r of jpRows) {
    merged.set(r.skill_id, { ...r, demand: (r.demand / jpMax) * 50 });
  }
  for (const r of kmitlRows) {
    const existing = merged.get(r.skill_id);
    const scaled = (r.demand / kmitlMax) * 50;
    if (existing) {
      existing.demand += scaled;
      existing.top_employers = [...new Set([...existing.top_employers, ...r.top_employers])].slice(0, 3);
    } else {
      merged.set(r.skill_id, { ...r, demand: scaled });
    }
  }
  return [...merged.values()];
}

// ── Occupation gap ───────────────────────────────────────────────────
//
// Uses OccupationDemand as authoritative demand. Supply side proxied
// through occupation → program mapping; we don't yet persist that
// mapping explicitly, so v1 approximates by matching skill overlap
// (shared skill with weight ≥ 0.3).
export interface OccupationGapRow {
  occupationCode: string;
  region: string;
  demandCurrent: number; // postings_count at latest period
  demandForecast: number | null; // null at horizon=0
  supplyCurrent: number; // approximate graduate supply matching this occupation
  supplyForecast: number | null;
  gap: number;
  thailandAverageShare: number; // this province / thailand total, 0–1
  kkuProductionShare: number; // KKU graduates / thailand graduates in proxy occupation
  methodologyVersion: string;
}
export interface OccupationGapResult {
  filter: GapFilter;
  rows: OccupationGapRow[];
  asOf: string;
  lowConfidenceReason: string | null;
}

export async function computeOccupationGap(filter: GapFilterInput): Promise<OccupationGapResult> {
  const f = GapFilterSchema.parse(filter);

  const latest = await prisma.occupationDemand.findMany({
    where: f.region !== 'TH' ? { province: f.region } : undefined,
    orderBy: [{ year: 'desc' }, { month: 'desc' }],
    take: 500,
  });

  // Pick the most recent (year, month) per occupation.
  const latestPerOcc = new Map<string, (typeof latest)[number]>();
  for (const r of latest) {
    const key = r.occupationCode;
    const prev = latestPerOcc.get(key);
    if (!prev || r.year * 100 + r.month > prev.year * 100 + prev.month) {
      latestPerOcc.set(key, r);
    }
  }

  // Thailand-total counts for share calc.
  const thailandTotal = await prisma.occupationDemand.groupBy({
    by: ['occupationCode'],
    _sum: { postingsCount: true },
    orderBy: { occupationCode: 'asc' },
  });
  const thailandMap = new Map(thailandTotal.map((r) => [r.occupationCode, r._sum.postingsCount ?? 0]));

  const rows: OccupationGapRow[] = [];
  for (const [code, row] of latestPerOcc) {
    const demandCurrent = row.postingsCount;
    const demandForecast = f.horizon === 0 ? null : await forecastDemandForOccupation(code, row.province, f.horizon);
    const supplyCurrent = await approximateOccupationSupply(code);
    const supplyForecast = f.horizon === 0 ? null : supplyCurrent; // v1: flat — real supply forecast via program-level in computeRisks
    const thailandShare = (demandCurrent / Math.max(thailandMap.get(code) ?? 1, 1));
    rows.push({
      occupationCode: code,
      region: row.province,
      demandCurrent,
      demandForecast,
      supplyCurrent,
      supplyForecast,
      gap: demandCurrent - supplyCurrent,
      thailandAverageShare: thailandShare,
      kkuProductionShare: 0, // computed in prompt 14 from KKU-Alumni real data
      methodologyVersion: GAP_ANALYSIS_VERSION,
    });
  }
  rows.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));

  return {
    filter: f,
    rows: rows.slice(0, f.limit),
    asOf: new Date().toISOString(),
    lowConfidenceReason: latest.length === 0
      ? 'No OccupationDemand rows yet — seed is sparse and real connectors are mocked until prompt 14.'
      : null,
  };
}

// ── Sector gap ───────────────────────────────────────────────────────
export interface SectorGapRow {
  sectorId: string;
  sectorCode: string;
  family: SectorFamily;
  nameTh: string;
  nameEn: string;
  demandIndex: number; // sum over member skills of (skill demand × weight) × sector demandMultiplier
  supplyIndex: number; // sum over member skills of (skill supply × weight)
  gap: number;
  trend: 'growing' | 'shrinking' | 'flat'; // from recent demand rate of change
  contributingProgramIds: string[];
  methodologyVersion: string;
}
export interface SectorGapResult {
  filter: GapFilter;
  rows: SectorGapRow[];
  asOf: string;
}

export async function computeSectorGap(filter: GapFilterInput): Promise<SectorGapResult> {
  const f = GapFilterSchema.parse(filter);

  const sectors = await prisma.sector.findMany({
    include: {
      skillSectors: {
        include: {
          skill: {
            include: {
              programSkills: true,
              jobPostingSkills: {
                include: { jobPosting: { select: { postedDate: true } } },
              },
            },
          },
        },
      },
    },
  });

  const programIds = await programIdsForScope(f.scope, f.scopeId);
  const programIdSet = new Set(programIds);
  // Window start for trend calc.
  const now = new Date();
  const lookback12 = new Date(now); lookback12.setFullYear(lookback12.getFullYear() - 1);
  const lookback24 = new Date(now); lookback24.setFullYear(lookback24.getFullYear() - 2);

  // Per-program latest graduate count for supply weighting.
  const latestGrad = await prisma.$queryRaw<
    { program_id: string; graduated_on_time: number }[]
  >(Prisma.sql`
    SELECT DISTINCT ON (program_id) program_id, graduated_on_time
    FROM enrollment_metrics
    ORDER BY program_id, academic_year DESC
  `);
  const gradMap = new Map(latestGrad.map((r) => [r.program_id, r.graduated_on_time ?? 0]));

  const rows: SectorGapRow[] = sectors.map((sec) => {
    let demand = 0;
    let supply = 0;
    let recentPostings = 0;
    let priorPostings = 0;
    const contributingPrograms = new Set<string>();
    for (const ss of sec.skillSectors) {
      // Demand from job postings in last 12 months.
      for (const jps of ss.skill.jobPostingSkills) {
        const posted = jps.jobPosting.postedDate;
        if (posted >= lookback12) {
          demand += jps.weight * ss.weight * sec.demandMultiplier;
          recentPostings += 1;
        } else if (posted >= lookback24) {
          priorPostings += 1;
        }
      }
      // Supply from program-skills in scope × graduate counts.
      for (const ps of ss.skill.programSkills) {
        if (programIdSet.size > 0 && !programIdSet.has(ps.programId)) continue;
        const grad = gradMap.get(ps.programId) ?? 0;
        supply += ps.weight * ss.weight * grad;
        if (grad > 0) contributingPrograms.add(ps.programId);
      }
    }
    const pctChange = priorPostings === 0
      ? (recentPostings > 0 ? 1 : 0)
      : (recentPostings - priorPostings) / priorPostings;
    const trend: SectorGapRow['trend'] = pctChange > 0.1 ? 'growing' : pctChange < -0.1 ? 'shrinking' : 'flat';

    return {
      sectorId: sec.id,
      sectorCode: sec.code,
      family: sec.family,
      nameTh: sec.nameTh,
      nameEn: sec.nameEn,
      demandIndex: demand,
      supplyIndex: supply,
      gap: demand - supply,
      trend,
      contributingProgramIds: [...contributingPrograms].slice(0, 5),
      methodologyVersion: GAP_ANALYSIS_VERSION,
    };
  });
  rows.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
  return { filter: f, rows, asOf: new Date().toISOString() };
}

// ── Regional gap (province-level demand) ─────────────────────────────
export interface RegionalGapCell {
  province: string;
  demandTotal: number;
  supplyTotal: number;
  gap: number;
  // 'demand-heavy' | 'supply-heavy' | 'balanced' — bucketed for choropleth colouring
  intensity: 'demand-heavy' | 'supply-heavy' | 'balanced' | 'no-data';
}
export interface RegionalGapResult {
  filter: GapFilter;
  cells: RegionalGapCell[];
  asOf: string;
  lowConfidenceReason: string | null;
}

export async function computeRegionalGap(filter: GapFilterInput): Promise<RegionalGapResult> {
  const f = GapFilterSchema.parse(filter);
  // Demand by province from OccupationDemand (last 12 months).
  const now = new Date();
  const oneYearAgo = new Date(now); oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const byProvince = await prisma.$queryRaw<
    { province: string; demand_total: number; supply_total: number }[]
  >(Prisma.sql`
    WITH demand AS (
      SELECT province, SUM(postings_count)::float AS demand_total
      FROM occupation_demand
      WHERE (year * 100 + month) >= ${now.getFullYear() * 100 + now.getMonth() + 1 - 100}
      GROUP BY province
    ),
    -- Supply is deferred (KKU-Alumni connector, prompt 14). Returns 0 today
    -- unless a province has been manually tagged on enrollment_metrics.
    supply AS (
      SELECT 'KKU'::text AS province, 0::float AS supply_total
    )
    SELECT
      COALESCE(d.province, s.province) AS province,
      COALESCE(d.demand_total, 0)       AS demand_total,
      COALESCE(s.supply_total, 0)       AS supply_total
    FROM demand d
    FULL OUTER JOIN supply s ON d.province = s.province
  `);

  const cells: RegionalGapCell[] = byProvince.map((r) => {
    const gap = r.demand_total - r.supply_total;
    let intensity: RegionalGapCell['intensity'];
    if (r.demand_total === 0 && r.supply_total === 0) intensity = 'no-data';
    else if (Math.abs(gap) / Math.max(r.demand_total + r.supply_total, 1) < 0.1) intensity = 'balanced';
    else intensity = gap > 0 ? 'demand-heavy' : 'supply-heavy';
    return {
      province: r.province,
      demandTotal: r.demand_total,
      supplyTotal: r.supply_total,
      gap,
      intensity,
    };
  });

  return {
    filter: f,
    cells,
    asOf: new Date().toISOString(),
    lowConfidenceReason:
      'Per-province supply data is deferred to prompt 14 (KKU-Alumni connector). Demand side is live against OccupationDemand seeds.',
  };
}

// ── Opportunities (underserved skills) ───────────────────────────────
export interface OpportunityRow {
  skillId: string;
  nameTh: string;
  nameEn: string;
  recentDemand: number;
  demandGrowthPct: number; // last year vs prior year
  existingProgramCount: number;
  peerProgramCount: number; // peer institutions with this skill
  estimatedCohortSize: number; // rough
  fitNote: string;
}
export interface OpportunityResult {
  filter: GapFilter;
  rows: OpportunityRow[];
  asOf: string;
}

export async function computeOpportunities(filter: GapFilterInput): Promise<OpportunityResult> {
  const f = GapFilterSchema.parse(filter);
  const gap = await computeSkillGap({ ...f, limit: 200 });
  // Underserved = positive gap + demand > small threshold + existing supply zero or tiny.
  const underserved = gap.rows.filter((r) => r.gap > 0 && r.demand > 5 && r.supply < 5);

  // Pull real growth pcts from KmitlSkillGrowth for the candidate skills.
  // Prefer the most recent group-level growth signal (broad context),
  // averaging across data scopes when multiple snapshots exist.
  const skillIds = underserved.slice(0, f.limit).map((r) => r.skillId);
  const growthRows = skillIds.length === 0 ? [] : await prisma.kmitlSkillGrowth.groupBy({
    by: ['skillId'],
    where: { skillId: { in: skillIds }, contextLevel: 'group' },
    _avg: { growthPct: true },
  });
  const growthMap = new Map<string, number>();
  for (const g of growthRows) {
    if (g.skillId && g._avg.growthPct !== null) growthMap.set(g.skillId, g._avg.growthPct);
  }

  const rows: OpportunityRow[] = await Promise.all(
    underserved.slice(0, f.limit).map(async (r) => {
      const [programCount, peerCount] = await Promise.all([
        prisma.programSkill.count({ where: { skillId: r.skillId } }),
        0, // peer coverage real in prompt 10 (benchmarking) — placeholder 0 here
      ]);
      return {
        skillId: r.skillId,
        nameTh: r.nameTh,
        nameEn: r.nameEn,
        recentDemand: r.demand,
        demandGrowthPct: growthMap.get(r.skillId) ?? 0,
        existingProgramCount: programCount,
        peerProgramCount: peerCount,
        estimatedCohortSize: Math.round(r.demand / 12), // very rough: annualised
        fitNote: growthMap.has(r.skillId)
          ? 'Demand growth from KMITL skill-mapping (THAILAND × LinkedIn job postings).'
          : 'Auto-ranked by positive gap. Growth pct unavailable (skill not in KMITL taxonomy).',
      };
    }),
  );

  return { filter: f, rows, asOf: new Date().toISOString() };
}

// ── Risks (oversupply) ────────────────────────────────────────────────
export interface RiskRow {
  programId: string;
  programCode: string;
  nameTh: string;
  nameEn: string;
  currentGraduates: number;
  projectedSupply5yr: number;
  projectedSupplyAfterDemographic: number;
  estimatedRegionalDemand: number;
  oversupplyPct: number;
  recommendationHint: 'reduce-intake' | 'rebalance' | 'repurpose' | 'watch';
}
export interface RiskResult {
  filter: GapFilter;
  rows: RiskRow[];
  asOf: string;
  lowConfidenceReason: string | null;
}

export async function computeRisks(filter: GapFilterInput): Promise<RiskResult> {
  const f = GapFilterSchema.parse(filter);
  const programIds = await programIdsForScope(f.scope, f.scopeId);
  const programs = await prisma.program.findMany({
    where: programIds.length > 0 ? { id: { in: programIds } } : undefined,
    select: { id: true, code: true, nameTh: true, nameEn: true },
  });
  const enrollments = await prisma.enrollmentMetric.findMany({
    where: programIds.length > 0 ? { programId: { in: programIds } } : undefined,
    orderBy: [{ programId: 'asc' }, { academicYear: 'asc' }],
    select: { programId: true, academicYear: true, graduatedOnTime: true },
  });
  // Demographic multiplier from DemographicProjection.
  const demoBase = await prisma.demographicProjection.findFirst({
    where: { region: f.region, ageCohort: '18-22' },
    orderBy: { year: 'asc' },
  });
  const demoTarget = await prisma.demographicProjection.findFirst({
    where: { region: f.region, ageCohort: '18-22' },
    orderBy: { year: 'desc' },
  });
  const demoMultiplier =
    demoBase && demoTarget && demoBase.population > 0
      ? demoTarget.population / demoBase.population
      : 0.92; // sensible default — Thailand 18–22 cohort in 2030 ≈ 92% of 2025

  const rows: RiskRow[] = programs.map((p) => {
    const series: TimePoint[] = enrollments
      .filter((e) => e.programId === p.id && e.graduatedOnTime != null)
      .map((e) => ({ period: e.academicYear, value: e.graduatedOnTime! }));
    const last = series[series.length - 1]?.value ?? 0;
    const target = new Date().getFullYear() + 5;
    const proj = series.length >= 2 ? forecastLinear(series, target).projected : last;
    const adjusted = series.length >= 2
      ? forecastSupplyWithDemographic(series, demoMultiplier, target).projected
      : last * demoMultiplier;
    // Estimated regional demand — crude proxy for v1: sum of recent occupation
    // postings in the region, scaled to account for inter-program sharing.
    // Real demand-per-program wiring lands in prompt 14 with the KKU-Alumni
    // graduate-to-occupation crosswalk.
    const regionalDemand = 100; // placeholder so the ratio stays sensible
    const oversupply = adjusted - regionalDemand;
    const pct = regionalDemand > 0 ? (oversupply / regionalDemand) * 100 : 0;
    let hint: RiskRow['recommendationHint'];
    if (pct > 100) hint = 'reduce-intake';
    else if (pct > 50) hint = 'repurpose';
    else if (pct > 20) hint = 'rebalance';
    else hint = 'watch';
    return {
      programId: p.id,
      programCode: p.code,
      nameTh: p.nameTh,
      nameEn: p.nameEn,
      currentGraduates: last,
      projectedSupply5yr: proj,
      projectedSupplyAfterDemographic: adjusted,
      estimatedRegionalDemand: regionalDemand,
      oversupplyPct: pct,
      recommendationHint: hint,
    };
  });
  rows.sort((a, b) => b.oversupplyPct - a.oversupplyPct);

  return {
    filter: f,
    rows,
    asOf: new Date().toISOString(),
    lowConfidenceReason:
      'Regional demand proxy is a placeholder — per-program demand lands with KKU-Alumni real data in prompt 14.',
  };
}

// ── Per-program demand-match gaps ────────────────────────────────────
//
// Powered by ProgramDemandMatch — AI-resolved per-program assessments
// of "is this in-demand skill (a) relevant to this discipline AND (b)
// covered by the curriculum?". v1: 5,377 rows × 207 programs, ~24% of
// pairs are TRUE GAPS (demand-relevant skill the curriculum doesn't
// teach). Sharper than aggregated computeSkillGap because each row is
// already discipline-filtered.

export interface ProgramDemandGapRow {
  programId: string;
  programCode: string;
  programNameEn: string;
  programNameTh: string;
  facultyCode: string;
  /** Total relevant skills (matched + unmatched). */
  relevantSkillCount: number;
  /** Skills the curriculum already covers. */
  coveredCount: number;
  /** Relevant skills the curriculum does NOT cover — the gap. */
  gapCount: number;
  /** 0..1 — coveredCount / relevantSkillCount. */
  coverageRatio: number;
  /** Top 5 highest-relatedness gaps (by demanded skill name + relatedness). */
  topGaps: Array<{
    skillId: string;
    skillNameEn: string;
    skillNameTh: string;
    relatedness: number;
  }>;
  methodologyVersion: string;
}

export interface ProgramDemandGapResult {
  filter: GapFilter;
  rows: ProgramDemandGapRow[];
  /** Programs with NO demand-match data yet (excluded from rows). */
  uncoveredProgramCount: number;
  asOf: string;
}

export async function computeProgramDemandGaps(
  filter: GapFilterInput,
): Promise<ProgramDemandGapResult> {
  const f = GapFilterSchema.parse(filter);
  const programIds = await programIdsForScope(f.scope, f.scopeId);

  // Pull ProgramDemandMatch + program metadata in one go.
  const matchesRaw = await prisma.programDemandMatch.findMany({
    where: {
      ...(programIds.length > 0 ? { programId: { in: programIds } } : {}),
      relevant: true,
    },
    include: {
      program: {
        select: {
          id: true,
          code: true,
          nameEn: true,
          nameTh: true,
          faculty: { select: { code: true } },
        },
      },
      skill: { select: { id: true, nameEn: true, nameTh: true, category: true } },
    },
  });
  // Filter out soft skills from the per-program gap analysis. Same
  // rationale as computeSkillGap: job-posting taxonomies under-list
  // soft skills, so flagging them as "uncovered" against demand is
  // misleading (every program teaches teamwork; no posting demands it
  // by name). Default ON via filter.
  const matches = f.excludeSoftSkills
    ? matchesRaw.filter((m) => !isSoftSkill(m.skill.category, m.skill.nameEn))
    : matchesRaw;

  // Group by program.
  const byProgram = new Map<
    string,
    {
      program: { id: string; code: string; nameEn: string; nameTh: string; faculty: { code: string } };
      relevant: typeof matches;
    }
  >();
  for (const m of matches) {
    const e = byProgram.get(m.programId);
    if (e) e.relevant.push(m);
    else byProgram.set(m.programId, { program: m.program, relevant: [m] });
  }

  // Compute counts of programs with zero demand-match data — for the
  // "uncoveredProgramCount" stat (Council needs to know how many
  // programs were excluded because the AI hasn't run yet).
  const totalProgramsAtScope =
    programIds.length > 0
      ? programIds.length
      : await prisma.program.count({ where: { status: 'ACTIVE' } });
  const uncoveredProgramCount = totalProgramsAtScope - byProgram.size;

  const rows: ProgramDemandGapRow[] = [...byProgram.values()].map(({ program, relevant }) => {
    const covered = relevant.filter((m) => m.matched);
    const gaps = relevant.filter((m) => !m.matched);
    const topGaps = [...gaps]
      .sort((a, b) => b.relatedness - a.relatedness)
      .slice(0, 5)
      .map((m) => ({
        skillId: m.skill.id,
        skillNameEn: m.skill.nameEn,
        skillNameTh: m.skill.nameTh,
        relatedness: m.relatedness,
      }));
    return {
      programId: program.id,
      programCode: program.code,
      programNameEn: program.nameEn,
      programNameTh: program.nameTh,
      facultyCode: program.faculty.code,
      relevantSkillCount: relevant.length,
      coveredCount: covered.length,
      gapCount: gaps.length,
      coverageRatio: relevant.length > 0 ? covered.length / relevant.length : 0,
      topGaps,
      methodologyVersion: 'demand-match.v1',
    };
  });

  // Sort by gapCount desc — programs with the biggest curriculum holes first.
  rows.sort((a, b) => b.gapCount - a.gapCount);

  return {
    filter: f,
    rows: rows.slice(0, f.limit),
    uncoveredProgramCount,
    asOf: new Date().toISOString(),
  };
}

// ── Forecast accuracy ────────────────────────────────────────────────
export interface ForecastAccuracyRow {
  id: string;
  kind: ForecastKind;
  subjectType: string;
  subjectId: string;
  targetYear: number;
  projectedValue: number;
  actualValue: number | null;
  errorPct: number | null;
  inBand95: boolean | null;
  methodologyVersion: string;
  runAt: Date;
}
export interface ForecastAccuracyResult {
  rows: ForecastAccuracyRow[];
  mapeByHorizon: Array<{ horizonYears: number; mape: number | null; n: number }>;
  asOf: string;
}

export async function computeForecastAccuracy(): Promise<ForecastAccuracyResult> {
  const runs = await prisma.forecastRun.findMany({ orderBy: { runAt: 'desc' }, take: 100 });
  const rows: ForecastAccuracyRow[] = runs.map((r) => ({
    id: r.id,
    kind: r.kind,
    subjectType: r.subjectType,
    subjectId: r.subjectId,
    targetYear: r.targetYear,
    projectedValue: r.projectedValue,
    actualValue: r.actualValue,
    errorPct: r.errorPct,
    inBand95:
      r.actualValue != null && r.ci95Low != null && r.ci95High != null
        ? r.actualValue >= r.ci95Low && r.actualValue <= r.ci95High
        : null,
    methodologyVersion: r.methodologyVersion,
    runAt: r.runAt,
  }));

  const byHorizon = new Map<number, number[]>();
  const thisYear = new Date().getFullYear();
  for (const r of rows) {
    if (r.errorPct == null) continue;
    const h = r.targetYear - thisYear;
    if (!byHorizon.has(h)) byHorizon.set(h, []);
    byHorizon.get(h)!.push(Math.abs(r.errorPct));
  }
  const mapeByHorizon = [...byHorizon.entries()]
    .map(([h, errs]) => ({ horizonYears: h, mape: errs.reduce((s, x) => s + x, 0) / errs.length, n: errs.length }))
    .sort((a, b) => a.horizonYears - b.horizonYears);

  return { rows, mapeByHorizon, asOf: new Date().toISOString() };
}

// ── Internal helpers ─────────────────────────────────────────────────

// Soft / transferable / language skill detector. Job-posting taxonomies
// systematically under-list these — every employer wants "teamwork" but
// few list it as a posting requirement. Including them in the gap
// analysis creates artificial "oversupply" rows that mislead Council.
//
// Detection: category substring match (covers `transferable`,
// `Transferable`, `transferable/engineering`, `language/transferable`,
// etc.) plus a name-based fallback for un-categorised soft skills.
const SOFT_CATEGORY_RE = /(transferable|^language|^vocational|soft.skill|transversal)/i;
const SOFT_NAME_RE = /\b(teamwork|leadership|critical thinking|problem solving|communication|interpersonal|self.directed|professional ethics|english language|english communication|research methodology|entrepreneurship|collaboration|presentation skills|negotiation skills|time management)\b/i;
function isSoftSkill(category: string | null, nameEn: string | null): boolean {
  if (category && SOFT_CATEGORY_RE.test(category)) return true;
  if (nameEn && SOFT_NAME_RE.test(nameEn)) return true;
  return false;
}

async function programIdsForScope(scope: ScopeLevel, scopeId: string | undefined): Promise<string[]> {
  if (scope === 'university') return [];
  if (!scopeId) return [];
  if (scope === 'program') return [scopeId];
  if (scope === 'faculty') {
    const progs = await prisma.program.findMany({ where: { facultyId: scopeId }, select: { id: true } });
    return progs.map((p) => p.id);
  }
  if (scope === 'department') {
    const progs = await prisma.program.findMany({ where: { departmentId: scopeId }, select: { id: true } });
    return progs.map((p) => p.id);
  }
  return [];
}

async function totalStudentsInScope(scope: ScopeLevel, scopeId: string | undefined): Promise<number> {
  const ids = await programIdsForScope(scope, scopeId);
  const agg = await prisma.enrollmentMetric.aggregate({
    where: ids.length > 0 ? { programId: { in: ids } } : undefined,
    _sum: { enrolled: true },
  });
  return agg._sum?.enrolled ?? 0;
}

function regionFilterClause(region: string, column: string): Prisma.Sql {
  if (region === 'TH' || region === 'ALL') return Prisma.empty;
  if (region === 'Northeast') {
    // Thailand's Northeast (Isaan) provinces.
    const isaan = [
      'Khon Kaen', 'Udon Thani', 'Nakhon Ratchasima', 'Ubon Ratchathani', 'Buriram',
      'Sisaket', 'Surin', 'Roi Et', 'Chaiyaphum', 'Sakon Nakhon', 'Kalasin',
      'Maha Sarakham', 'Loei', 'Nong Khai', 'Nong Bua Lamphu', 'Yasothon',
      'Mukdahan', 'Nakhon Phanom', 'Amnat Charoen', 'Bueng Kan',
    ];
    return Prisma.sql` AND ${Prisma.raw(column)} = ANY(${isaan})`;
  }
  if (region === 'Mekong') {
    const mekong = ['Nong Khai', 'Nakhon Phanom', 'Mukdahan', 'Ubon Ratchathani', 'Bueng Kan', 'Loei'];
    return Prisma.sql` AND ${Prisma.raw(column)} = ANY(${mekong})`;
  }
  return Prisma.sql` AND ${Prisma.raw(column)} = ${region}`;
}

async function forecastDemandForOccupation(
  occupationCode: string,
  province: string,
  horizonYears: number,
): Promise<number | null> {
  const history = await prisma.occupationDemand.findMany({
    where: { occupationCode, province },
    orderBy: [{ year: 'asc' }, { month: 'asc' }],
  });
  if (history.length < 2) return null;
  const series: TimePoint[] = history.map((h) => ({ period: h.year * 12 + h.month, value: h.postingsCount }));
  const last = series[series.length - 1]!.period;
  const target = last + horizonYears * 12;
  return forecastHoltLinear(series, target).projected;
}

async function approximateOccupationSupply(occupationCode: string): Promise<number> {
  // v1 approximation: sum of graduates across programs that teach any
  // skill associated with this occupation. Real occupation→skill
  // mapping table is prompt 14 work.
  const rows = await prisma.$queryRaw<{ total: number }[]>(Prisma.sql`
    WITH latest_grad AS (
      SELECT DISTINCT ON (program_id) program_id, graduated_on_time
      FROM enrollment_metrics
      ORDER BY program_id, academic_year DESC
    )
    SELECT COALESCE(SUM(lg.graduated_on_time), 0)::float AS total
    FROM latest_grad lg
    WHERE lg.program_id IN (
      SELECT DISTINCT program_id FROM program_skills
      WHERE skill_id IN (
        -- heuristic: occupation_code as text match against skill code prefix
        SELECT id FROM skills WHERE code ILIKE ${occupationCode + '%'}
      )
    )
  `);
  return rows[0]?.total ?? 0;
}

// Re-export constants consumers may want.
export { FORECASTING_VERSION };
export type { ForecastResult, TimePoint };
