/**
 * The gap analyzer's digital-competency lens.
 *
 * The gap analyzer computes skill supply as `ProgramSkill weight ×
 * graduate count`: it assumes a skill taught is a skill acquired. KKU's
 * Digital Intelligence (DQ) test is the only evidence in the platform
 * that measures whether students ACTUALLY acquired a competency, so it
 * is genuinely new information rather than a second opinion on the same
 * signal.
 *
 * It therefore enters as a SEPARATE lens and changes nothing: no figure
 * on `/gap-analysis`, `/gap-analysis/opportunities` or
 * `/gap-analysis/risks` reads anything computed here. Attainment is a
 * different axis from demand and supply, and the design is explicit that
 * no existing Council-facing number moves silently
 * (`docs/superpowers/specs/2026-08-25-dq-score-platform-integration-design.md`,
 * §3).
 *
 * Two things this query must not smooth over:
 *
 * 1. **Five of the thirteen DQ modules have no counterpart in the skill
 *    taxonomy at all.** That taxonomy is built from curriculum PDF
 *    extraction and carries almost no digital-competency vocabulary —
 *    there is no "Computer Basics", no "Word Processing", and the only
 *    "Internet" rows are Internet of Things and TCP/IP. Unmapped modules
 *    are returned as rows with `skillId: null`, never dropped: the
 *    absence is information for whoever curates the taxonomy. See
 *    `DQ_MODULE_SKILLS` in @kku/shared for the per-module evidence.
 *
 * 2. **The Thailand job-postings quadrant is thin.** It is the quadrant
 *    the gap analyzer's `demandSource: 'kmitl'` path reads, so it is the
 *    primary demand figure here; measured 2026-08-25 it holds 353
 *    (career × skill) rows and none of them is one of the eight mapped
 *    skills. Reporting only that quadrant would render the whole demand
 *    axis blank with no way to tell "not demanded" from "sample too
 *    small", so the global quadrant is returned alongside it, each
 *    labelled with the quadrant it came from. Neither is silently
 *    substituted for the other.
 *
 * Attribution: the demand data is LinkedIn, subscribed by MHESI. KMITL
 * hosts the API and nothing else — never describe it as KMITL's data.
 * The `kmitl_*` table names are the code identifier for the endpoint.
 */

import {
  DQ_MODULE_SKILLS,
  theoryModules,
  type DqSkillConfidence,
} from '@kku/shared';
import { prisma } from './index';
import { realDataSqlUnsafe, realDataWhere } from './data-quality';
import { DQ_ELIGIBLE_LEVEL, DQ_MIN_CELL_STUDENTS } from './student-dq';

export const DQ_SKILL_LENS_VERSION = 'dq-skill-lens.v1';

/** Connector slug behind both DQ cubes — the freshness anchor. */
const DQ_SOURCE_SLUG = 'kku-dq';

/** Weakest programmes named per module. Enough to act on, short enough
 *  that a Council reader does not have to scroll a 100-row table. */
const WEAKEST_PROGRAM_LIMIT = 5;

export type DqLensScope = 'university' | 'faculty' | 'department' | 'program';

/**
 * A demand reading, always paired with the quadrant it was read from.
 *
 * `careerCount` and `topCareers` are the sample behind `demand`: the API
 * contract is aggregate-only and carries no employer names, so the
 * careers are what a reader can inspect to judge whether the figure is
 * about the competency they think it is.
 */
export interface DqLensDemand {
  /** SUM of the percentage values across contributing careers. Same
   *  metric the gap analyzer's `demandSource: 'kmitl'` path uses. */
  demand: number;
  careerCount: number;
  topCareers: string[];
}

export interface DqLensProgramRow {
  programId: string;
  code: string;
  nameEn: string;
  nameTh: string;
  /** The programme's mean on this module, over students who took it. */
  mean: number;
  /** Students behind the mean — rendered beside it everywhere, because
   *  the floor is only 5 and a thin mean must look thin. */
  takenCount: number;
}

export interface DqSkillLensRow {
  moduleNo: number;
  moduleKey: string;
  moduleNameEn: string;
  moduleNameTh: string | null;
  moduleShortEn: string;
  domain: string;

  /** Mapping verdict from the curated table. `none` means the taxonomy
   *  has no defensible counterpart — not that none was looked for. */
  confidence: DqSkillConfidence;
  /** For `near`, the caveat a domain expert would raise if the pairing
   *  were shown unqualified. For `none`, what was searched for. Surfaced
   *  on screen, not hidden behind a tooltip. */
  note: string;
  skillId: string | null;
  skillNameEn: string | null;

  /** Thailand job postings — the quadrant the gap analyzer reads. */
  demandThailand: DqLensDemand | null;
  /** Global job postings, shown so a null Thailand reading is legible as
   *  a sample-size fact rather than as absent demand. */
  demandGlobal: DqLensDemand | null;

  /** Measured attainment at the requested scope: SUM(score_sum) /
   *  SUM(taken_count), never a mean of programme means. Null below the
   *  small-cell floor — never 0. */
  mean: number | null;
  takenCount: number;
  studentsInScope: number;
  /** Share of in-scope students who took the module, 0-100. Module 13's
   *  partial rollout is visible here and nowhere else. */
  coveragePct: number | null;
  weakestPrograms: DqLensProgramRow[];
}

export interface DqSkillLensResult {
  scope: DqLensScope;
  scopeId: string | null;
  rows: DqSkillLensRow[];
  counts: {
    /** Modules whose taxonomy pairing is a direct name-and-concept match. */
    exact: number;
    /** Paired, but with a caveat that must be read with the row. */
    near: number;
    /** No defensible counterpart in the taxonomy. */
    none: number;
    /** Mapped modules carrying a Thailand job-postings reading. */
    withThailandDemand: number;
    /** Mapped modules carrying a global job-postings reading. */
    withGlobalDemand: number;
  };
  /** Rows in the Thailand × job-postings quadrant overall — the
   *  sample-size caveat, stated rather than implied. */
  thailandQuadrantRows: number;
  /** When the DQ cubes were last written, or null if never. */
  dqRefreshedAt: string | null;
  methodologyVersion: string;
  asOf: string;
}

interface ModuleAggRow {
  module_no: number;
  mean: number | null;
  taken: bigint;
  in_scope: bigint;
}

interface WeakestRow {
  module_no: number;
  program_id: string;
  code: string;
  name_en: string;
  name_th: string;
  mean: number;
  taken: bigint;
}

interface DemandAggRow {
  skill_id: string;
  data_scope: string;
  demand: number;
  careers: bigint;
  top_careers: string[];
}

/**
 * Scope predicate for both cube queries.
 *
 * Plain SQL + a positional parameter rather than a `Prisma.Sql` fragment,
 * for the reason documented on `dqCompetencyByScope`: under concurrent
 * execution Prisma's `instanceof Prisma.Sql` check fails across async
 * contexts and the parameter mis-binds with `syntax error at or near
 * "$1"`. Only `scopeId` is ever user-supplied and it rides as a
 * parameter; the level and floor constants are module literals.
 */
function scopeClause(scope: DqLensScope, scopeId: string | null): {
  sql: string;
  params: string[];
} {
  if (scope === 'program' && scopeId) return { sql: 'AND p.id = $1', params: [scopeId] };
  if (scope === 'faculty' && scopeId) return { sql: 'AND p.faculty_id = $1', params: [scopeId] };
  if (scope === 'department' && scopeId) {
    return { sql: 'AND p.department_id = $1', params: [scopeId] };
  }
  return { sql: '', params: [] };
}

/**
 * Demand for the labour market's digital skills against what KKU
 * students measurably score on the matching DQ module.
 *
 * All thirteen modules come back, mapped or not. Weakest programmes are
 * computed for every module including the unmapped ones: the two lowest
 * competencies university-wide (Word Processing and Presentation) are
 * both unmapped, and withholding the actionable part of a lens because
 * the taxonomy is missing a row would be the wrong trade.
 */
export async function computeDqSkillLens(args: {
  scope?: DqLensScope;
  scopeId?: string | null;
}): Promise<DqSkillLensResult> {
  const scope: DqLensScope = args.scope ?? 'university';
  const scopeId = args.scopeId ?? null;
  const { sql: scopeSql, params: scopeParams } = scopeClause(scope, scopeId);

  const mappedSkillIds = DQ_MODULE_SKILLS.map((m) => m.skillId).filter(
    (id): id is string => id !== null,
  );

  const [moduleAgg, weakest, demandRows, thailandQuadrantRows, dqRun] = await Promise.all([
    prisma.$queryRawUnsafe<ModuleAggRow[]>(
      `
      SELECT
        m.module_no,
        (SUM(m.score_sum) / NULLIF(SUM(m.taken_count), 0))::float AS mean,
        SUM(m.taken_count)::bigint      AS taken,
        SUM(m.students_in_scope)::bigint AS in_scope
      FROM dq_module_cube m
      JOIN programs p ON p.id = m.program_id
      WHERE m.module_kind = 'THEORY'
        AND p.level = '${DQ_ELIGIBLE_LEVEL}'
        ${scopeSql}
      GROUP BY m.module_no
      `,
      ...scopeParams,
    ),

    prisma.$queryRawUnsafe<WeakestRow[]>(
      `
      WITH per_program AS (
        SELECT
          m.module_no,
          m.program_id,
          SUM(m.score_sum) / NULLIF(SUM(m.taken_count), 0) AS mean,
          SUM(m.taken_count)                               AS taken
        FROM dq_module_cube m
        JOIN programs p ON p.id = m.program_id
        WHERE m.module_kind = 'THEORY'
          AND p.level = '${DQ_ELIGIBLE_LEVEL}'
          ${scopeSql}
        GROUP BY m.module_no, m.program_id
        HAVING SUM(m.taken_count) >= ${DQ_MIN_CELL_STUDENTS}
      ),
      ranked AS (
        SELECT
          per_program.*,
          ROW_NUMBER() OVER (PARTITION BY module_no ORDER BY mean ASC) AS rn
        FROM per_program
        WHERE mean IS NOT NULL
      )
      SELECT
        r.module_no,
        r.program_id,
        p.code,
        p.name_en,
        p.name_th,
        r.mean::float   AS mean,
        r.taken::bigint AS taken
      FROM ranked r
      JOIN programs p ON p.id = r.program_id
      WHERE r.rn <= ${WEAKEST_PROGRAM_LIMIT}
      ORDER BY r.module_no ASC, r.mean ASC
      `,
      ...scopeParams,
    ),

    mappedSkillIds.length === 0
      ? Promise.resolve<DemandAggRow[]>([])
      : prisma.$queryRawUnsafe<DemandAggRow[]>(
          `
          SELECT
            d.skill_id,
            d.data_scope::text        AS data_scope,
            SUM(d.percentage)::float  AS demand,
            COUNT(DISTINCT d.career_id)::bigint AS careers,
            (ARRAY_AGG(c.career_name ORDER BY d.percentage DESC))[1:3] AS top_careers
          FROM kmitl_career_skill_demands d
          JOIN kmitl_careers c ON c.id = d.career_id
          WHERE d.skill_id = ANY($1::text[])
            AND d.data_source = 'JOB_POSTINGS'
            AND ${realDataSqlUnsafe('d')}
            AND ${realDataSqlUnsafe('c')}
          GROUP BY d.skill_id, d.data_scope
          `,
          mappedSkillIds,
        ),

    prisma.kmitlCareerSkillDemand.count({
      where: {
        dataScope: 'THAILAND',
        dataSource: 'JOB_POSTINGS',
        skillId: { not: null },
        ...realDataWhere(),
      },
    }),

    latestDqRefreshedAt(),
  ]);

  const aggByModule = new Map(moduleAgg.map((r) => [r.module_no, r]));

  const weakestByModule = new Map<number, DqLensProgramRow[]>();
  for (const w of weakest) {
    const list = weakestByModule.get(w.module_no) ?? [];
    list.push({
      programId: w.program_id,
      code: w.code,
      nameEn: w.name_en,
      nameTh: w.name_th,
      mean: w.mean,
      takenCount: Number(w.taken),
    });
    weakestByModule.set(w.module_no, list);
  }

  const demandBySkill = new Map<string, { THAILAND?: DqLensDemand; GLOBAL?: DqLensDemand }>();
  for (const d of demandRows) {
    const entry = demandBySkill.get(d.skill_id) ?? {};
    const reading: DqLensDemand = {
      demand: d.demand,
      careerCount: Number(d.careers),
      topCareers: d.top_careers ?? [],
    };
    if (d.data_scope === 'THAILAND') entry.THAILAND = reading;
    else if (d.data_scope === 'GLOBAL') entry.GLOBAL = reading;
    demandBySkill.set(d.skill_id, entry);
  }

  const rows: DqSkillLensRow[] = theoryModules().map((mod) => {
    const mapping = DQ_MODULE_SKILLS.find((m) => m.moduleNo === mod.no);
    const agg = aggByModule.get(mod.no);
    const takenCount = Number(agg?.taken ?? 0);
    const studentsInScope = Number(agg?.in_scope ?? 0);
    const rawMean = agg?.mean;
    const demand = mapping?.skillId ? demandBySkill.get(mapping.skillId) : undefined;

    return {
      moduleNo: mod.no,
      moduleKey: mod.key,
      moduleNameEn: mod.nameEn,
      moduleNameTh: mod.nameTh,
      moduleShortEn: mod.shortEn,
      domain: mod.domain,
      confidence: mapping?.confidence ?? 'none',
      note: mapping?.note ?? 'No mapping row for this module.',
      skillId: mapping?.skillId ?? null,
      skillNameEn: mapping?.skillNameEn ?? null,
      demandThailand: demand?.THAILAND ?? null,
      demandGlobal: demand?.GLOBAL ?? null,
      // The floor applies to the scope's own headcount on this module.
      // Below it the mean is withheld, not zeroed: a thin cell has not
      // scored zero.
      mean:
        takenCount >= DQ_MIN_CELL_STUDENTS &&
        typeof rawMean === 'number' &&
        Number.isFinite(rawMean)
          ? rawMean
          : null,
      takenCount,
      studentsInScope,
      coveragePct: studentsInScope > 0 ? (takenCount / studentsInScope) * 100 : null,
      weakestPrograms: weakestByModule.get(mod.no) ?? [],
    };
  });

  return {
    scope,
    scopeId,
    rows,
    counts: {
      exact: rows.filter((r) => r.confidence === 'exact').length,
      near: rows.filter((r) => r.confidence === 'near').length,
      none: rows.filter((r) => r.confidence === 'none').length,
      withThailandDemand: rows.filter((r) => r.demandThailand !== null).length,
      withGlobalDemand: rows.filter((r) => r.demandGlobal !== null).length,
    },
    thailandQuadrantRows,
    dqRefreshedAt: dqRun ? dqRun.toISOString() : null,
    methodologyVersion: DQ_SKILL_LENS_VERSION,
    asOf: new Date().toISOString(),
  };
}

/**
 * Freshness of the DQ cubes.
 *
 * The latest SUCCEEDED run, not the latest run of any status: a failed
 * refresh leaves the previous cube contents in place, so a failed run's
 * timestamp would misdate what is on screen.
 */
async function latestDqRefreshedAt(): Promise<Date | null> {
  const source = await prisma.dataSource.findUnique({
    where: { slug: DQ_SOURCE_SLUG },
    select: { id: true },
  });
  if (!source) return null;
  const run = await prisma.ingestionRun.findFirst({
    where: { dataSourceId: source.id, status: 'SUCCEEDED' },
    orderBy: { createdAt: 'desc' },
    select: { completedAt: true, createdAt: true },
  });
  if (!run) return null;
  return run.completedAt ?? run.createdAt;
}
