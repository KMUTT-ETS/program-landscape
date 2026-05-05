// ─────────────────────────────────────────────────────────────────────────────
// Single payload backing the redesigned home dashboard.
//
// All queries run in parallel against the live DB. Returns a structured
// payload covering: header KPIs, lifecycle-vs-revenue quadrant data,
// faculty composition treemap, urgent-review + momentum cards,
// portfolio mix, and live narrative pulse.
//
// Designed to populate against what data is actually landed (see
// dashboard discovery 2026-05-03). Skips KMITL skill whitespace
// because curated demand data isn't usable yet.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from './index';
import { computeHealthScores, getKkuIntakePolicyVerdict, type HealthScoreRow } from './health-score';

export const DASHBOARD_OVERVIEW_VERSION = 'dashboard-overview.v1';

export interface DashboardKpis {
  programCount: number;
  facultyCount: number;
  latestEnrolled: number;
  netContributionThb: number;
  zeroEnrollmentCount: number;
  crashingCount: number; // < -50% over 3 yrs
  surgingCount: number; // > +50% over 3 yrs
  /** KKU intake-floor policy: bachelor < 30, postgrad < 8. */
  intakePolicy: {
    bachelorBreach: number;     // BACHELOR programs strictly below 30 — closure-track per policy
    postgradWatch: number;      // postgrad programs below 8 — watch-list per policy
    bachelorCompliant: number;
    postgradCompliant: number;
    unknownCount: number;       // programs without latest-year intake data
  };
  bulkPipelineProgress: { done: number; total: number; lastCompletedCode: string | null; lastCompletedAt: Date | null };
}

export interface QuadrantPoint {
  programId: string;
  code: string;
  name: string; // nameEn || nameTh
  facultyCode: string;
  level: string;
  enrollmentDeltaPct: number; // 3-yr trend, signed
  netContributionThb: number;
  enrolledLatest: number;
  /** "star" | "cash-cow" | "question" | "dog" | "dead" */
  quadrant: 'star' | 'cash-cow' | 'question' | 'dog' | 'dead';
}

export interface FacultyTile {
  facultyId: string;
  code: string;
  nameEn: string;
  nameTh: string;
  programCount: number;
  enrollmentLatest: number;
  netContributionThb: number;
  /** Net contribution per enrolled student (THB), or null when no enrolment. */
  contributionPerStudentThb: number | null;
}

export interface ProgramAlert {
  programId: string;
  code: string;
  name: string;
  facultyCode: string;
  level: string;
  enrolledLatest: number;
  enrolledThreeYearsAgo: number | null;
  deltaPct: number | null;
  netContributionThb: number | null;
  /** Free-text Thai/English caveat one-liner (e.g. "0 students for 2 yrs"). */
  caption: string;
}

export interface LevelMixRow {
  level: string;
  programCount: number;
  enrollmentLatest: number;
}

export interface NarrativePulseRow {
  programCode: string;
  programName: string;
  facultyCode: string;
  generatedAt: Date;
  contentLength: number;
  confidence: number;
}

export interface LifecycleDistribution {
  /** Total programs covered by a snapshot. < programCount when backfill is partial. */
  total: number;
  /** Total canonical programs the snapshot is being compared against (= 297). */
  expectedTotal: number;
  /** Per-verdict counts. Missing verdicts default to 0. */
  counts: { FRONTIER: number; RISING: number; STABLE: number; SUNSET: number };
  /** Methodology versions present in the current snapshot set (drift detection). */
  methodologyVersions: string[];
  /** Most recent computedAt. null when no snapshots exist. */
  latestComputedAt: Date | null;
}

export interface FacultyHealthRow {
  facultyId: string;
  scopeLabel: string;
  /** Overall 0-100 score; null when every dimension was null. */
  overallScore: number | null;
  /** 0-100 share of dimensions that had usable data. */
  dataCompletenessPct: number;
  /** Per-dimension overall scores (each can be null). */
  dimensions: {
    attractiveness: number | null;
    financial: number | null;
    capability: number | null;
    outcomes: number | null;
    relevance: number | null;
  };
}

export interface DashboardOverview {
  methodologyVersion: string;
  generatedAt: Date;
  kpis: DashboardKpis;
  quadrant: {
    points: QuadrantPoint[];
    /** Programs with no recent enrollment data — listed for transparency. */
    excludedCount: number;
  };
  facultyTiles: FacultyTile[];
  urgent: ProgramAlert[];
  momentum: ProgramAlert[];
  levelMix: LevelMixRow[];
  pulse: NarrativePulseRow[];
  /** Lifecycle verdict distribution from persisted snapshots. */
  lifecycle: LifecycleDistribution;
  /** Per-faculty health rollup from `computeHealthScores('university')`. */
  facultyHealth: FacultyHealthRow[];
}

export async function getDashboardOverview(): Promise<DashboardOverview> {
  const [
    programCount,
    facultyCountRow,
    latestEnrolledRow,
    financialSum,
    quadrantPoints,
    facultyRollup,
    levelMix,
    pulseRows,
    narrativeProgress,
    intakeRows,
    lifecycleSnapshots,
    facultyHealthRows,
  ] = await Promise.all([
    // Count only ACTIVE programs from the canonical 297 KKU master
    // sheet. Legacy mock-seed rows (`sequence_no_from_sheet IS NULL`)
    // and SUNSET/PAUSED rows must not inflate the headline portfolio
    // number — the curriculum landscape is the canonical 297, not
    // every Program row that ever existed.
    prisma.program.count({
      where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
    }),
    // Faculty count for the curriculum landscape = academic faculties
    // only. Non-academic units (ADMIN / RESEARCH_CENTER / INSTITUTE)
    // host staff but not programs and would inflate the count from
    // 24 to 36. Raw SQL because long-running dev processes may still
    // hold a Prisma client predating the FacultyKind schema addition.
    prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS count FROM faculties WHERE kind = 'ACADEMIC';
    `,
    prisma.$queryRaw<Array<{ total: bigint }>>`
      WITH latest AS (
        SELECT program_id, MAX(academic_year) as max_year FROM enrollment_metrics GROUP BY program_id
      )
      SELECT COALESCE(SUM(em.enrolled), 0)::bigint as total
      FROM enrollment_metrics em
      JOIN latest l ON l.program_id = em.program_id AND em.academic_year = l.max_year
      JOIN programs p ON p.id = em.program_id
        AND p.status = 'ACTIVE'
        AND p.sequence_no_from_sheet IS NOT NULL;
    `,
    prisma.financialMetric.aggregate({
      _sum: { netContribution: true },
      where: { fiscalYear: { gte: 2024 } },
    }),
    prisma.$queryRaw<
      Array<{
        programId: string;
        code: string;
        name: string;
        facultyCode: string;
        level: string;
        enrollmentDeltaPct: number | null;
        netContributionThb: number;
        enrolledLatest: number;
      }>
    >`
      WITH latest_em AS (
        SELECT program_id, MAX(academic_year) as max_year FROM enrollment_metrics GROUP BY program_id
      )
      SELECT
        p.id as "programId",
        p.code,
        COALESCE(NULLIF(TRIM(p.name_en), ''), p.name_th) as name,
        f.code as "facultyCode",
        p.level::text as level,
        ROUND(
          ((now_em.enrolled::numeric - old_em.enrolled::numeric) / NULLIF(old_em.enrolled, 0)) * 100,
          1
        )::float8 as "enrollmentDeltaPct",
        COALESCE(latest_fm.net_contribution, 0)::float8 as "netContributionThb",
        now_em.enrolled::int as "enrolledLatest"
      FROM programs p
      JOIN faculties f ON f.id = p.faculty_id
      JOIN latest_em l ON l.program_id = p.id
      JOIN enrollment_metrics now_em ON now_em.program_id = p.id AND now_em.academic_year = l.max_year
      LEFT JOIN enrollment_metrics old_em ON old_em.program_id = p.id AND old_em.academic_year = l.max_year - 3
      LEFT JOIN LATERAL (
        SELECT net_contribution FROM financial_metrics WHERE program_id = p.id ORDER BY fiscal_year DESC LIMIT 1
      ) latest_fm ON true
      WHERE old_em.enrolled IS NOT NULL AND old_em.enrolled > 0
        AND p.status = 'ACTIVE'
        AND p.sequence_no_from_sheet IS NOT NULL;
    `,
    prisma.$queryRaw<
      Array<{
        facultyId: string;
        code: string;
        nameEn: string;
        nameTh: string;
        programCount: number;
        enrollmentLatest: number;
        netContributionThb: number;
      }>
    >`
      SELECT
        f.id as "facultyId",
        f.code,
        f.name_en as "nameEn",
        f.name_th as "nameTh",
        COUNT(DISTINCT p.id)::int as "programCount",
        COALESCE(SUM(latest_em.enrolled), 0)::int as "enrollmentLatest",
        COALESCE(SUM(latest_fm.net_contribution), 0)::float8 as "netContributionThb"
      FROM faculties f
      LEFT JOIN programs p ON p.faculty_id = f.id
        AND p.status = 'ACTIVE'
        AND p.sequence_no_from_sheet IS NOT NULL
      LEFT JOIN LATERAL (
        SELECT enrolled FROM enrollment_metrics WHERE program_id = p.id ORDER BY academic_year DESC LIMIT 1
      ) latest_em ON true
      LEFT JOIN LATERAL (
        SELECT net_contribution FROM financial_metrics WHERE program_id = p.id ORDER BY fiscal_year DESC LIMIT 1
      ) latest_fm ON true
      WHERE f.kind = 'ACADEMIC'
      GROUP BY f.id, f.code, f.name_en, f.name_th
      HAVING COUNT(DISTINCT p.id) > 0
      ORDER BY "enrollmentLatest" DESC;
    `,
    prisma.$queryRaw<Array<{ level: string; programCount: number; enrollmentLatest: number }>>`
      SELECT
        p.level::text as level,
        COUNT(DISTINCT p.id)::int as "programCount",
        COALESCE(SUM(latest_em.enrolled), 0)::int as "enrollmentLatest"
      FROM programs p
      LEFT JOIN LATERAL (
        SELECT enrolled FROM enrollment_metrics WHERE program_id = p.id ORDER BY academic_year DESC LIMIT 1
      ) latest_em ON true
      WHERE p.status = 'ACTIVE'
        AND p.sequence_no_from_sheet IS NOT NULL
      GROUP BY p.level
      ORDER BY MIN(
        CASE p.level::text
          WHEN 'BACHELOR' THEN 1
          WHEN 'HIGHER_GRAD_DIPLOMA' THEN 2
          WHEN 'MASTER' THEN 3
          WHEN 'DOCTORAL' THEN 4
          ELSE 5
        END
      );
    `,
    prisma.programStrategicNarrative.findMany({
      take: 5,
      orderBy: { generatedAt: 'desc' },
      select: {
        generatedAt: true,
        confidence: true,
        contentMarkdown: true,
        program: { select: { code: true, nameEn: true, nameTh: true, faculty: { select: { code: true } } } },
      },
    }),
    prisma.programStrategicNarrative.count({
      where: { program: { sequenceNoFromSheet: { not: null } } },
    }),
    // KKU intake-floor compliance — pull every active program with its
    // latest-year intake, then bucket via the canonical helper.
    prisma.$queryRaw<Array<{ id: string; level: string; intake: number | null }>>`
      WITH latest AS (
        SELECT program_id, MAX(academic_year) as max_year FROM enrollment_metrics GROUP BY program_id
      )
      SELECT
        p.id,
        p.level::text as level,
        em.enrolled::int as intake
      FROM programs p
      LEFT JOIN latest l ON l.program_id = p.id
      LEFT JOIN enrollment_metrics em ON em.program_id = p.id AND em.academic_year = l.max_year
      WHERE p.status = 'ACTIVE'
        AND p.sequence_no_from_sheet IS NOT NULL;
    `,
    // Lifecycle verdict distribution. Reads from the write-through
    // snapshot table populated by `programLifecycleVerdict()`. Filter to
    // canonical-297 programs so legacy mock-seed rows can't inflate the
    // distribution. Returns one row per program; we group in JS.
    prisma.programLifecycleSnapshot.findMany({
      where: { program: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } } },
      select: { verdict: true, methodologyVersion: true, computedAt: true },
    }),
    // Faculty-level health rollup. The university scope returns one
    // HealthScoreRow per faculty (24 rows) — fast enough to inline in
    // the dashboard payload.
    computeHealthScores('university', null),
  ]);

  const latestEnrolled = Number(latestEnrolledRow[0]?.total ?? 0);
  const facultyCount = Number(facultyCountRow[0]?.count ?? 0);
  const netContributionThb = Number(financialSum._sum.netContribution ?? 0);

  // Bucket programs by KKU intake-floor policy (bachelor=30, postgrad=8).
  const intakeBuckets = {
    bachelorBreach: 0,
    postgradWatch: 0,
    bachelorCompliant: 0,
    postgradCompliant: 0,
    unknownCount: 0,
  };
  for (const r of intakeRows) {
    const verdict = getKkuIntakePolicyVerdict(r.level, r.intake);
    if (verdict.state === 'unknown') intakeBuckets.unknownCount++;
    else if (r.level === 'BACHELOR') {
      if (verdict.state === 'breach') intakeBuckets.bachelorBreach++;
      else if (verdict.state === 'compliant') intakeBuckets.bachelorCompliant++;
    } else {
      if (verdict.state === 'watch') intakeBuckets.postgradWatch++;
      else if (verdict.state === 'compliant') intakeBuckets.postgradCompliant++;
    }
  }

  // Bucket every program by quadrant + count alerts.
  const points: QuadrantPoint[] = quadrantPoints.map((p) => {
    const dPct = p.enrollmentDeltaPct ?? 0;
    const nc = p.netContributionThb;
    const enrolled = p.enrolledLatest;
    let quadrant: QuadrantPoint['quadrant'];
    if (enrolled === 0) quadrant = 'dead';
    else if (dPct >= 0 && nc >= 0) quadrant = 'star';
    else if (dPct < 0 && nc >= 0) quadrant = 'cash-cow';
    else if (dPct >= 0 && nc < 0) quadrant = 'question';
    else quadrant = 'dog';
    return {
      programId: p.programId,
      code: p.code,
      name: p.name,
      facultyCode: p.facultyCode,
      level: p.level,
      enrollmentDeltaPct: dPct,
      netContributionThb: nc,
      enrolledLatest: enrolled,
      quadrant,
    };
  });

  // zeroEnrollmentCount must NOT be derived from `points` — the
  // quadrant query filters out programs without a positive 3-yr-prior
  // enrolment, so a program that has been at 0 for years won't appear
  // there at all. Count from ALL canonical+ACTIVE programs at their
  // own latest year, matching cockpit's `at risk` semantics.
  const zeroEnrolRow = await prisma.$queryRaw<Array<{ count: bigint }>>`
    WITH latest AS (
      SELECT program_id, MAX(academic_year) AS max_year
      FROM enrollment_metrics GROUP BY program_id
    )
    SELECT COUNT(*)::bigint AS count
    FROM enrollment_metrics em
    JOIN latest l ON l.program_id = em.program_id AND em.academic_year = l.max_year
    JOIN programs p ON p.id = em.program_id
      AND p.status = 'ACTIVE' AND p.sequence_no_from_sheet IS NOT NULL
    WHERE em.enrolled = 0;
  `;
  const zeroEnrollmentCount = Number(zeroEnrolRow[0]?.count ?? 0n);
  const crashingCount = points.filter((p) => p.enrolledLatest > 0 && p.enrollmentDeltaPct <= -50).length;
  const surgingCount = points.filter((p) => p.enrollmentDeltaPct >= 50).length;

  // Urgent review = zero-enrolment first, then worst crashers, capped at 8.
  const urgent: ProgramAlert[] = [];
  for (const p of points
    .filter((x) => x.enrolledLatest === 0)
    .slice(0, 4)) {
    urgent.push({
      programId: p.programId,
      code: p.code,
      name: p.name,
      facultyCode: p.facultyCode,
      level: p.level,
      enrolledLatest: 0,
      enrolledThreeYearsAgo: Math.round(Math.abs(p.enrollmentDeltaPct) > 0 ? p.enrolledLatest / (1 + p.enrollmentDeltaPct / 100) : 0),
      deltaPct: -100,
      netContributionThb: p.netContributionThb,
      caption: 'Zero enrolment — de-facto sunset',
    });
  }
  for (const p of [...points]
    .filter((x) => x.enrolledLatest > 0 && x.enrollmentDeltaPct <= -50)
    .sort((a, b) => a.enrollmentDeltaPct - b.enrollmentDeltaPct)
    .slice(0, 8 - urgent.length)) {
    urgent.push({
      programId: p.programId,
      code: p.code,
      name: p.name,
      facultyCode: p.facultyCode,
      level: p.level,
      enrolledLatest: p.enrolledLatest,
      enrolledThreeYearsAgo: Math.round(p.enrolledLatest / (1 + p.enrollmentDeltaPct / 100)),
      deltaPct: p.enrollmentDeltaPct,
      netContributionThb: p.netContributionThb,
      caption: `${p.enrollmentDeltaPct.toFixed(0)}% over 3 yrs`,
    });
  }

  const momentum: ProgramAlert[] = [...points]
    .filter((x) => x.enrollmentDeltaPct >= 100)
    .sort((a, b) => b.enrollmentDeltaPct - a.enrollmentDeltaPct)
    .slice(0, 8)
    .map((p) => ({
      programId: p.programId,
      code: p.code,
      name: p.name,
      facultyCode: p.facultyCode,
      level: p.level,
      enrolledLatest: p.enrolledLatest,
      enrolledThreeYearsAgo: Math.round(p.enrolledLatest / (1 + p.enrollmentDeltaPct / 100)),
      deltaPct: p.enrollmentDeltaPct,
      netContributionThb: p.netContributionThb,
      caption: `+${p.enrollmentDeltaPct.toFixed(0)}% over 3 yrs`,
    }));

  const facultyTiles: FacultyTile[] = facultyRollup.map((f) => ({
    facultyId: f.facultyId,
    code: f.code,
    nameEn: f.nameEn,
    nameTh: f.nameTh,
    programCount: f.programCount,
    enrollmentLatest: f.enrollmentLatest,
    netContributionThb: f.netContributionThb,
    contributionPerStudentThb:
      f.enrollmentLatest > 0 ? f.netContributionThb / f.enrollmentLatest : null,
  }));

  const pulse: NarrativePulseRow[] = pulseRows.map((r) => ({
    programCode: r.program.code,
    programName: (r.program.nameEn?.trim() || r.program.nameTh).slice(0, 80),
    facultyCode: r.program.faculty.code,
    generatedAt: r.generatedAt,
    contentLength: r.contentMarkdown.length,
    confidence: r.confidence,
  }));

  const lastNarrative = pulseRows[0];

  // ── Lifecycle distribution ──────────────────────────────────────────
  const lifecycleCounts = { FRONTIER: 0, RISING: 0, STABLE: 0, SUNSET: 0 };
  const methodologyVersionsSet = new Set<string>();
  let latestComputedAt: Date | null = null;
  for (const s of lifecycleSnapshots) {
    lifecycleCounts[s.verdict] += 1;
    methodologyVersionsSet.add(s.methodologyVersion);
    if (latestComputedAt === null || s.computedAt > latestComputedAt) {
      latestComputedAt = s.computedAt;
    }
  }
  const lifecycle: LifecycleDistribution = {
    total: lifecycleSnapshots.length,
    expectedTotal: programCount,
    counts: lifecycleCounts,
    methodologyVersions: Array.from(methodologyVersionsSet).sort(),
    latestComputedAt,
  };

  // ── Faculty health rollup ───────────────────────────────────────────
  // computeHealthScores('university', null) returns one row per
  // faculty across all 24 — including non-academic ones. Filter to
  // faculties that appear in `facultyTiles` (academic + has programs)
  // so the home page card matches the rest of the dashboard.
  const academicFacultyIds = new Set(facultyTiles.map((t) => t.facultyId));
  const facultyHealth: FacultyHealthRow[] = (facultyHealthRows as HealthScoreRow[])
    .filter((row) => academicFacultyIds.has(row.scopeId))
    .map((row) => ({
      facultyId: row.scopeId,
      scopeLabel: row.scopeLabel,
      overallScore: row.overall.score,
      dataCompletenessPct: row.overall.dataCompletenessPct,
      dimensions: {
        attractiveness: row.dimensions.attractiveness.score,
        financial: row.dimensions.financial.score,
        capability: row.dimensions.capability.score,
        outcomes: row.dimensions.outcomes.score,
        relevance: row.dimensions.relevance.score,
      },
    }))
    .sort((a, b) => (b.overallScore ?? -1) - (a.overallScore ?? -1));

  return {
    methodologyVersion: DASHBOARD_OVERVIEW_VERSION,
    generatedAt: new Date(),
    kpis: {
      programCount,
      facultyCount,
      latestEnrolled,
      netContributionThb,
      zeroEnrollmentCount,
      crashingCount,
      surgingCount,
      intakePolicy: intakeBuckets,
      bulkPipelineProgress: {
        done: narrativeProgress,
        total: programCount,
        lastCompletedCode: lastNarrative?.program.code ?? null,
        lastCompletedAt: lastNarrative?.generatedAt ?? null,
      },
    },
    quadrant: {
      points,
      excludedCount: programCount - points.length,
    },
    facultyTiles,
    urgent,
    momentum,
    levelMix: levelMix.map((r) => ({ ...r })),
    pulse,
    lifecycle,
    facultyHealth,
  };
}
