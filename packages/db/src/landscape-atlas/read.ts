// packages/db/src/landscape-atlas/read.ts
// The atlas's only I/O. Every raw query's rows are Zod-validated; every
// metric table is read through realDataSqlUnsafe / realDataWhere.
import { z } from 'zod';
import { prisma } from '../index';
import { realDataSqlUnsafe, realDataWhere } from '../data-quality';
import { getProgramScoreIndex } from '../health-score';
import { listPortfolioRisk } from '../risk-scoring';
import { grantAward } from '../grant-award';
import { dqCompetencyByScope } from '../student-dq';
import { programAiReadiness } from '../program-deep-dive';
import { scopeProgramIds } from '../gap-map';
import { meanOf } from './scales';
import { buildShape, type ShapeChapter } from './shape';
import { buildGrowthShare, buildHealthRisk, buildPosition, type PositionChapter } from './position';
import { buildCapability, type CapabilityChapter, type CapabilityInput } from './capability';
import { buildFuture, type FutureChapter, type ScorecardInput } from './future';

export type AtlasScopeLevel = 'university' | 'faculty' | 'department' | 'program';

export interface AtlasScope {
  level: AtlasScopeLevel;
  id: string | null;
  /** null = whole university; [] = a scope with no programmes. */
  programIds: string[] | null;
}

export async function resolveAtlasScope(level: AtlasScopeLevel, id: string | null): Promise<AtlasScope> {
  if (level === 'university' || !id) return { level: 'university', id: null, programIds: null };
  if (level === 'program') return { level, id, programIds: [id] };
  return { level, id, programIds: (await scopeProgramIds(level, id)) ?? [] };
}

/** Canonical ACTIVE programmes in scope; $1 is the programIds array or null. */
const IN_SCOPE = `p.status = 'ACTIVE' AND p.sequence_no_from_sheet IS NOT NULL
  AND ($1::text[] IS NULL OR p.id = ANY($1::text[]))`;

const isEmpty = (s: AtlasScope) => s.programIds !== null && s.programIds.length === 0;
const nowIso = () => new Date().toISOString();

// ── Shape ─────────────────────────────────────────────────────────────

const ShapeRow = z.object({
  programId: z.string(),
  code: z.string(),
  nameTh: z.string(),
  nameEn: z.string(),
  level: z.string(),
  facultyId: z.string(),
  facultyCode: z.string(),
  facultyNameTh: z.string(),
  facultyNameEn: z.string().nullable(),
  activeStudents: z.number().nullable(),
});

const ACTIVE_STUDENTS_CTE = `SELECT sc.program_id, SUM(sc.student_count)::int AS students
  FROM student_cohort_distributions sc
  WHERE ${realDataSqlUnsafe('sc')}
  GROUP BY sc.program_id`;

export async function readShape(scope: AtlasScope): Promise<ShapeChapter> {
  if (isEmpty(scope)) return buildShape([], nowIso());
  const raw = await prisma.$queryRawUnsafe<unknown[]>(
    `SELECT p.id AS "programId", p.code, p.name_th AS "nameTh",
            COALESCE(NULLIF(TRIM(p.name_en), ''), p.name_th) AS "nameEn", p.level::text AS level,
            f.id AS "facultyId", f.code AS "facultyCode", f.name_th AS "facultyNameTh", f.name_en AS "facultyNameEn",
            st.students AS "activeStudents"
     FROM programs p
     JOIN faculties f ON f.id = p.faculty_id
     LEFT JOIN (${ACTIVE_STUDENTS_CTE}) st ON st.program_id = p.id
     WHERE ${IN_SCOPE}`,
    scope.programIds,
  );
  const rows = z.array(ShapeRow).parse(raw);
  const index = await getProgramScoreIndex();
  return buildShape(
    rows.map((r) => ({ ...r, facultyNameEn: r.facultyNameEn ?? '', health: index.get(r.programId)?.overall ?? null })),
    nowIso(),
  );
}

// ── Position (bachelor) ───────────────────────────────────────────────

const PositionRow = z.object({
  programId: z.string(),
  code: z.string(),
  nameTh: z.string(),
  nameEn: z.string(),
  facultyCode: z.string(),
  applications: z.number().nullable(),
  seats: z.number().nullable(),
  tcasYearBe: z.number().nullable(),
  enrolmentChangePct: z.number().nullable(),
  activeStudents: z.number().nullable(),
  netContributionThb: z.number().nullable(),
});

export async function readPosition(scope: AtlasScope): Promise<PositionChapter> {
  if (isEmpty(scope)) return buildPosition(buildGrowthShare([]), buildHealthRisk([]), nowIso());
  const raw = await prisma.$queryRawUnsafe<unknown[]>(
    `WITH tcas AS (
       SELECT ts.program_id, ts.entry_year_be, SUM(ts.applicants)::int AS applications, SUM(ts.quota)::int AS seats
       FROM tcas_admission_stats ts
       WHERE ts.program_id IS NOT NULL AND ${realDataSqlUnsafe('ts')}
       GROUP BY ts.program_id, ts.entry_year_be
     ), latest_tcas AS (
       SELECT DISTINCT ON (program_id) program_id, entry_year_be, applications, seats
       FROM tcas ORDER BY program_id, entry_year_be DESC
     ), latest_em AS (
       SELECT program_id, MAX(academic_year) AS max_year
       FROM enrollment_metrics em0 WHERE ${realDataSqlUnsafe('em0')}
       GROUP BY program_id
     )
     SELECT p.id AS "programId", p.code, p.name_th AS "nameTh",
            COALESCE(NULLIF(TRIM(p.name_en), ''), p.name_th) AS "nameEn", f.code AS "facultyCode",
            lt.applications, lt.seats, lt.entry_year_be AS "tcasYearBe",
            CASE WHEN old_em.enrolled > 0 THEN
              ROUND(((now_em.enrolled::numeric - old_em.enrolled::numeric) / old_em.enrolled) * 100, 1)::float8
            END AS "enrolmentChangePct",
            st.students AS "activeStudents",
            fm.net_contribution::float8 AS "netContributionThb"
     FROM programs p
     JOIN faculties f ON f.id = p.faculty_id
     LEFT JOIN latest_tcas lt ON lt.program_id = p.id
     LEFT JOIN latest_em l ON l.program_id = p.id
     LEFT JOIN enrollment_metrics now_em
       ON now_em.program_id = p.id AND now_em.academic_year = l.max_year AND ${realDataSqlUnsafe('now_em')}
     LEFT JOIN enrollment_metrics old_em
       ON old_em.program_id = p.id AND old_em.academic_year = l.max_year - 3 AND ${realDataSqlUnsafe('old_em')}
     LEFT JOIN (${ACTIVE_STUDENTS_CTE}) st ON st.program_id = p.id
     LEFT JOIN LATERAL (
       SELECT fm1.net_contribution FROM financial_metrics fm1
       WHERE fm1.program_id = p.id AND ${realDataSqlUnsafe('fm1')}
       ORDER BY fm1.fiscal_year DESC LIMIT 1
     ) fm ON true
     WHERE p.level = 'BACHELOR' AND ${IN_SCOPE}`,
    scope.programIds,
  );
  const rows = z.array(PositionRow).parse(raw);
  const index = await getProgramScoreIndex();
  const risk = await listPortfolioRisk(scope.programIds ? { programIds: scope.programIds } : undefined);
  const riskById = new Map(risk.map((r) => [r.programId, r]));
  const gs = buildGrowthShare(
    rows.map((r) => ({
      ...r,
      contributionPerStudentThb:
        r.netContributionThb === null || !r.activeStudents ? null : r.netContributionThb / r.activeStudents,
    })),
  );
  const hr = buildHealthRisk(
    rows.map((r) => {
      const rk = riskById.get(r.programId);
      return {
        programId: r.programId,
        code: r.code,
        nameTh: r.nameTh,
        nameEn: r.nameEn,
        facultyCode: r.facultyCode,
        health: index.get(r.programId)?.overall ?? null,
        riskMatrixScore: rk?.kkuMatrixScore ?? null,
        riskLevel: rk?.kkuRiskLevel ?? 'NEEDS_DATA',
        activeStudents: r.activeStudents,
      };
    }),
  );
  return buildPosition(gs, hr, nowIso());
}

// ── Capability (by faculty) ───────────────────────────────────────────

const StaffRow = z.object({
  facultyId: z.string(),
  code: z.string(),
  nameTh: z.string(),
  nameEn: z.string().nullable(),
  memberIds: z.array(z.string()),
});

export async function readCapability(scope: AtlasScope): Promise<CapabilityChapter> {
  if (isEmpty(scope)) return buildCapability([], nowIso());
  const raw = await prisma.$queryRawUnsafe<unknown[]>(
    `SELECT f.id AS "facultyId", f.code, f.name_th AS "nameTh", f.name_en AS "nameEn",
            ARRAY_AGG(DISTINCT fm.id) AS "memberIds"
     FROM programs p
     JOIN faculties f ON f.id = p.faculty_id
     JOIN program_faculties pf ON pf.program_id = p.id
     JOIN faculty_members fm ON fm.id = pf.faculty_member_id AND fm.is_active
     WHERE ${IN_SCOPE}
     GROUP BY f.id, f.code, f.name_th, f.name_en`,
    scope.programIds,
  );
  const faculties = z.array(StaffRow).parse(raw);
  const year = new Date().getUTCFullYear();
  const inputs: CapabilityInput[] = [];
  for (const f of faculties) {
    const [publications3y, award] = await Promise.all([
      prisma.researchOutput.count({
        where: { facultyMemberId: { in: f.memberIds }, year: { gte: year - 3, lte: year - 1 }, ...realDataWhere() },
      }),
      grantAward(f.memberIds),
    ]);
    const perStaff = award.raw['bahtPerStaffPerYear'];
    inputs.push({
      facultyId: f.facultyId,
      code: f.code,
      nameTh: f.nameTh,
      nameEn: f.nameEn ?? '',
      activeStaff: f.memberIds.length,
      publications3y,
      grantBahtPerStaffPerYear: award.points === null || typeof perStaff !== 'number' ? null : perStaff,
    });
  }
  return buildCapability(inputs, nowIso());
}

// ── Future (by faculty) ───────────────────────────────────────────────

const FacultyProgrammeRow = z.object({
  programId: z.string(),
  facultyId: z.string(),
  code: z.string(),
  nameTh: z.string(),
  nameEn: z.string().nullable(),
});
const CoverageRow = z.object({ facultyId: z.string(), sectorId: z.string(), programmes: z.number() });

/**
 * programAiReadiness() per programme, bounded concurrency. It is computed on
 * read (six queries, no AI call) and nothing stores it. A programme with no
 * extracted skills has no readiness — the function would otherwise return its
 * defaults — so it is left out; so is one whose computation throws.
 */
export async function aiReadinessByProgram(ids: readonly string[], concurrency = 8): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  for (let i = 0; i < ids.length; i += concurrency) {
    const slice = ids.slice(i, i + concurrency);
    const results = await Promise.all(
      slice.map(async (id) => {
        try {
          const r = await programAiReadiness(id);
          const b = r.skillBreakdown;
          return b.aiNative + b.aiAugmented + b.aiDisplaceable + b.neutral === 0 ? null : ([id, r.overallScore] as const);
        } catch (err) {
          console.error(`[landscape-atlas] AI readiness failed for ${id}`, err);
          return null;
        }
      }),
    );
    for (const r of results) if (r) out.set(r[0], r[1]);
  }
  return out;
}

export async function readFuture(scope: AtlasScope): Promise<FutureChapter> {
  const sectors = await prisma.sector.findMany({
    select: { id: true, code: true, nameTh: true, nameEn: true },
    orderBy: { code: 'asc' },
  });
  if (isEmpty(scope)) return buildFuture([], { faculties: [], sectors, counts: [] }, nowIso());
  const programmes = z.array(FacultyProgrammeRow).parse(
    await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT p.id AS "programId", f.id AS "facultyId", f.code, f.name_th AS "nameTh", f.name_en AS "nameEn"
       FROM programs p JOIN faculties f ON f.id = p.faculty_id
       WHERE ${IN_SCOPE}`,
      scope.programIds,
    ),
  );
  const counts = z.array(CoverageRow).parse(
    await prisma.$queryRawUnsafe<unknown[]>(
      `SELECT p.faculty_id AS "facultyId", ss.sector_id AS "sectorId", COUNT(DISTINCT p.id)::int AS programmes
       FROM programs p
       JOIN program_skills ps ON ps.program_id = p.id
       JOIN skill_sectors ss ON ss.skill_id = ps.skill_id
       WHERE ${IN_SCOPE}
       GROUP BY p.faculty_id, ss.sector_id`,
      scope.programIds,
    ),
  );
  const index = await getProgramScoreIndex();
  const ai = await aiReadinessByProgram(programmes.map((p) => p.programId));

  const faculties = new Map<string, { id: string; code: string; nameTh: string; nameEn: string; programIds: string[] }>();
  for (const p of programmes) {
    const f = faculties.get(p.facultyId) ?? { id: p.facultyId, code: p.code, nameTh: p.nameTh, nameEn: p.nameEn ?? '', programIds: [] };
    f.programIds.push(p.programId);
    faculties.set(p.facultyId, f);
  }

  // DQ is a scope rollup (never a mean of programme scores). A programme or
  // department scope reads its own scope; otherwise each faculty is read.
  const narrow = (scope.level === 'program' || scope.level === 'department') && scope.id;
  const scorecard: ScorecardInput[] = [];
  for (const f of faculties.values()) {
    const dq = narrow
      ? await dqCompetencyByScope({ scope: scope.level as 'program' | 'department', scopeId: scope.id! })
      : await dqCompetencyByScope({ scope: 'faculty', scopeId: f.id });
    scorecard.push({
      facultyId: f.id,
      code: f.code,
      nameTh: f.nameTh,
      nameEn: f.nameEn,
      aiReadiness: meanOf(f.programIds.map((id) => ai.get(id) ?? null)),
      dq: dq.rawMean,
      dqStudents: dq.scoredStudents,
      relevance: meanOf(f.programIds.map((id) => index.get(id)?.dimensions.relevance.score ?? null)),
    });
  }
  return buildFuture(
    scorecard,
    {
      faculties: [...faculties.values()].map(({ id, code, nameTh, nameEn }) => ({ id, code, nameTh, nameEn })),
      sectors,
      counts,
    },
    nowIso(),
  );
}
