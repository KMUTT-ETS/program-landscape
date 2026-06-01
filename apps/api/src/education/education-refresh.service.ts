import { Injectable, Logger } from '@nestjs/common';
import { Prisma, prisma } from '@kku/db';
import { lookupRegion } from '@kku/shared';
import { configFromEnv, query, withConnection } from './oracle-client';
import { IngestionQueueService } from '../data-sources/ingestion-queue.service';

// Recruitment refresh delegates to the `kku-admission-campaigns` connector
// (apps/ingestion) — the data lives in AdmissionCampaignStat
// (POWERBI.ADMISSION_STAT), not in a hand-rolled education cube. We enqueue a
// manual run and project the IngestionRun's status into the cube-refresh
// shape so the refresh-bar can show "X rows · Y s" without knowing it's a
// connector. (Migrated off the retired kku-tcas-funnel / ADMISSION_STAT_CURRID.)
const RECRUITMENT_CONNECTOR_SLUG = 'kku-admission-campaigns';

// Education cube refresh — runs three Oracle queries against the
// POWERBI warehouse and re-populates the three education cube tables.
// Triggered manually from the dashboard "Refresh" button (no nightly
// cron); concurrency-protected by a single in-memory promise + the
// EducationCubeRefresh table.

interface Q1StudentRow extends Record<string, unknown> {
  FACULTY_NAME: string;
  PROGRAM_NAME: string;
  PROGRAM_LEVEL: string;
  MAJOR: string | null;
  COHORT_YEAR_BE: number;
  STATUS_CODE: number;
  STATUS_NAME: string | null;
  GENDER: string | null;
  NATIONALITY: string | null;
  ENTRY_TYPE: string | null;
  N: number;
  AGE_SUM: number | null;
  AGE_COUNT: number | null;
}

interface Q2LocationRow extends Record<string, unknown> {
  FACULTY_NAME: string;
  PROGRAM_NAME: string;
  PROGRAM_LEVEL: string;
  COHORT_YEAR_BE: number;
  SCHOOL_NAME: string | null;
  SCHOOL_PROVINCE_NAME: string | null;
  STATUS_CODE: number;
  N: number;
}

interface Q3TuitionRow extends Record<string, unknown> {
  FACULTY_NAME: string;
  PROGRAM_NAME: string;
  PROGRAM_LEVEL: string;
  ACAD_YEAR_BE: number;
  SEMESTER: string | null;
  REVENUE_THB: number;
  STUDENT_COUNT: number;
}

interface Q4PerformanceRow extends Record<string, unknown> {
  FACULTY_NAME: string;
  PROGRAM_NAME: string;
  PROGRAM_LEVEL: string;
  SCHOOL_NAME: string | null;
  SCHOOL_PROVINCE_NAME: string | null;
  STATUS_NAME: string | null;
  N: number;
  ENTRY_GPA_SUM: number | null;
  ENTRY_GPA_COUNT: number | null;
  GPA_SUM: number | null;
  GPA_COUNT: number | null;
  ENGLISH_GPA_SUM: number | null;
  ENGLISH_GPA_COUNT: number | null;
}

interface Q5EntryScoreRow extends Record<string, unknown> {
  FACULTY_NAME: string;
  PROGRAM_NAME: string;
  PROGRAM_LEVEL: string;
  SUBJECT_CODE: string;
  SUBJECT_NAME: string | null;
  N: number;
  SCORE_SUM: number | null;
  SCORE_COUNT: number | null;
  SCORE_MIN: number | null;
  SCORE_MAX: number | null;
}

// Anomaly filter — these three buckets are administrative artefacts
// (dummy faculty for legacy data, internal language centre that isn't
// a teaching unit, and a sentinel "99" entry year) that confuse every
// downstream view. Filtered at refresh so they never enter any cube.
const ANOMALY_WHERE = `
  AND COALESCE(FACULTYNAME, '') NOT IN ('ศูนย์ภาษาอาเซียน', 'ข้อมูลเดิม')
  AND COALESCE(ADMITACADYEAR, 0) <> 99
`;

// Note: BIRTHDATE lives on VIEW_STUDENT_DETAIL but NOT on
// VIEW_STUDENT_DETAIL_ALL (which is the broader student-snapshot view
// we group by). LEFT JOIN to bring it across — students that exist in
// _ALL but not _DETAIL (alumni / withdrawn / etc.) simply contribute
// nothing to AGE_SUM / AGE_COUNT, which is the correct behaviour
// (only count ages we can actually observe).
const Q1_STUDENT = `
SELECT
  a.FACULTYNAME           AS FACULTY_NAME,
  a.PROGRAMNAME           AS PROGRAM_NAME,
  a.PROGRAMLEVEL          AS PROGRAM_LEVEL,
  a.MAJOR                 AS MAJOR,
  a.ADMITACADYEAR         AS COHORT_YEAR_BE,
  a.STUDENTSTATUSCODE     AS STATUS_CODE,
  a.STUDENTSTATUS         AS STATUS_NAME,
  a.STUDENTSEX            AS GENDER,
  a.NATIONNAME            AS NATIONALITY,
  a.ENTRYTYPE             AS ENTRY_TYPE,
  COUNT(*)                AS N,
  SUM(CASE
    WHEN d.BIRTHDATE IS NOT NULL
     AND FLOOR(MONTHS_BETWEEN(SYSDATE, d.BIRTHDATE)/12) BETWEEN 16 AND 80
    THEN FLOOR(MONTHS_BETWEEN(SYSDATE, d.BIRTHDATE)/12)
    ELSE 0
  END) AS AGE_SUM,
  SUM(CASE
    WHEN d.BIRTHDATE IS NOT NULL
     AND FLOOR(MONTHS_BETWEEN(SYSDATE, d.BIRTHDATE)/12) BETWEEN 16 AND 80
    THEN 1
    ELSE 0
  END) AS AGE_COUNT
FROM POWERBI.VIEW_STUDENT_DETAIL_ALL a
LEFT JOIN POWERBI.VIEW_STUDENT_DETAIL d ON d.STUDENTCODE = a.STUDENTCODE
WHERE a.FACULTYNAME IS NOT NULL AND a.PROGRAMNAME IS NOT NULL
  AND COALESCE(a.FACULTYNAME, '') NOT IN ('ศูนย์ภาษาอาเซียน', 'ข้อมูลเดิม')
  AND COALESCE(a.ADMITACADYEAR, 0) <> 99
GROUP BY
  a.FACULTYNAME, a.PROGRAMNAME, a.PROGRAMLEVEL, a.MAJOR, a.ADMITACADYEAR,
  a.STUDENTSTATUSCODE, a.STUDENTSTATUS, a.STUDENTSEX, a.NATIONNAME, a.ENTRYTYPE
`;

const Q2_LOCATION = `
SELECT
  FACULTYNAME           AS FACULTY_NAME,
  PROGRAMNAME           AS PROGRAM_NAME,
  PROGRAMLEVEL          AS PROGRAM_LEVEL,
  ADMITACADYEAR         AS COHORT_YEAR_BE,
  SCHOOLNAME            AS SCHOOL_NAME,
  SCHOOLPROVINCENAME    AS SCHOOL_PROVINCE_NAME,
  STUDENTSTATUSCODE     AS STATUS_CODE,
  COUNT(*)              AS N
FROM POWERBI.VIEW_STUDENT_DETAIL_ALL
WHERE FACULTYNAME IS NOT NULL AND PROGRAMNAME IS NOT NULL
${ANOMALY_WHERE}
GROUP BY
  FACULTYNAME, PROGRAMNAME, PROGRAMLEVEL, ADMITACADYEAR,
  SCHOOLNAME, SCHOOLPROVINCENAME, STUDENTSTATUSCODE
`;

// Tuition aggregate per (program × academic year × semester). Joins
// VIEWSTUDENTENROLLFEE with the student-detail view on STUDENTCODE so
// we get faculty / program metadata. SEMESTER column on
// VIEWSTUDENTENROLLFEE; if upstream renames it, the refresh fails with
// a clear error and we adjust here.
const Q3_TUITION = `
SELECT
  s.FACULTYNAME    AS FACULTY_NAME,
  s.PROGRAMNAME    AS PROGRAM_NAME,
  s.PROGRAMLEVEL   AS PROGRAM_LEVEL,
  f.ACADYEAR       AS ACAD_YEAR_BE,
  f.SEMESTER       AS SEMESTER,
  COUNT(DISTINCT f.STUDENTCODE) AS STUDENT_COUNT,
  SUM(f.AMOUNT)    AS REVENUE_THB
FROM POWERBI.VIEWSTUDENTENROLLFEE f
INNER JOIN (
  SELECT DISTINCT STUDENTCODE, FACULTYNAME, PROGRAMNAME, PROGRAMLEVEL
  FROM POWERBI.VIEW_STUDENT_DETAIL_ALL
  WHERE COALESCE(FACULTYNAME, '') NOT IN ('ศูนย์ภาษาอาเซียน', 'ข้อมูลเดิม')
) s ON s.STUDENTCODE = f.STUDENTCODE
WHERE s.FACULTYNAME IS NOT NULL AND s.PROGRAMNAME IS NOT NULL
  AND COALESCE(f.ACADYEAR, 0) <> 99
GROUP BY s.FACULTYNAME, s.PROGRAMNAME, s.PROGRAMLEVEL, f.ACADYEAR, f.SEMESTER
HAVING COUNT(DISTINCT f.STUDENTCODE) >= 1
`;

// Undergraduate-performance aggregate. VIEW_STUDENT_DETAIL has the
// per-student GPA columns we need (ENTRYGPA + GPA + ENGLISH_GPA) plus
// SCHOOLNAME / SCHOOLPROVINCENAME for the location drill-down. Scoped
// to undergraduate (ปริญญาตรี) per the dashboard's design contract.
// GPAs are filtered to the realistic 0..4 range so any sentinel values
// (e.g., 99 = "no entry GPA on file") don't skew the average.
const Q4_PERFORMANCE = `
SELECT
  FACULTYNAME           AS FACULTY_NAME,
  PROGRAMNAME           AS PROGRAM_NAME,
  PROGRAMLEVEL          AS PROGRAM_LEVEL,
  SCHOOLNAME            AS SCHOOL_NAME,
  SCHOOLPROVINCENAME    AS SCHOOL_PROVINCE_NAME,
  STUDENTSTATUS         AS STATUS_NAME,
  COUNT(*)              AS N,
  SUM(CASE WHEN ENTRYGPA BETWEEN 0 AND 4 THEN ENTRYGPA ELSE 0 END)        AS ENTRY_GPA_SUM,
  SUM(CASE WHEN ENTRYGPA BETWEEN 0 AND 4 THEN 1 ELSE 0 END)               AS ENTRY_GPA_COUNT,
  SUM(CASE WHEN GPA      BETWEEN 0 AND 4 THEN GPA      ELSE 0 END)        AS GPA_SUM,
  SUM(CASE WHEN GPA      BETWEEN 0 AND 4 THEN 1 ELSE 0 END)               AS GPA_COUNT,
  SUM(CASE WHEN ENGLISH_GPA BETWEEN 0 AND 4 THEN ENGLISH_GPA ELSE 0 END)  AS ENGLISH_GPA_SUM,
  SUM(CASE WHEN ENGLISH_GPA BETWEEN 0 AND 4 THEN 1 ELSE 0 END)            AS ENGLISH_GPA_COUNT
FROM POWERBI.VIEW_STUDENT_DETAIL
WHERE FACULTYNAME IS NOT NULL AND PROGRAMNAME IS NOT NULL
  AND PROGRAMLEVEL = 'ปริญญาตรี'
  AND COALESCE(FACULTYNAME, '') NOT IN ('ศูนย์ภาษาอาเซียน', 'ข้อมูลเดิม')
GROUP BY
  FACULTYNAME, PROGRAMNAME, PROGRAMLEVEL,
  SCHOOLNAME, SCHOOLPROVINCENAME, STUDENTSTATUS
`;

// Per-subject entry-test-score aggregate. AVSREG.VIEW_STUDENT_SCORES
// is per-student-per-subject; joined to VIEW_STUDENT_DETAIL_ALL (the
// BROADER student view that includes alumni / withdrawn / etc., not
// just current students) on STUDENTCODE so we don't accidentally drop
// graduates' scores.
//
// SCORE column assumed numeric; SUBJECTCODE + SUBJECTNAME are the
// subject identity. Negative / sentinel values are filtered out via
// SCORE >= 0.
const Q5_ENTRY_SCORES = `
SELECT
  d.FACULTYNAME    AS FACULTY_NAME,
  d.PROGRAMNAME    AS PROGRAM_NAME,
  d.PROGRAMLEVEL   AS PROGRAM_LEVEL,
  s.SUBJECTCODE    AS SUBJECT_CODE,
  s.SUBJECTNAME    AS SUBJECT_NAME,
  COUNT(*)         AS N,
  SUM(s.SCORE)     AS SCORE_SUM,
  COUNT(s.SCORE)   AS SCORE_COUNT,
  MIN(s.SCORE)     AS SCORE_MIN,
  MAX(s.SCORE)     AS SCORE_MAX
FROM AVSREG.VIEW_STUDENT_SCORES s
INNER JOIN POWERBI.VIEW_STUDENT_DETAIL_ALL d ON d.STUDENTCODE = s.STUDENTCODE
WHERE d.FACULTYNAME IS NOT NULL AND d.PROGRAMNAME IS NOT NULL
  AND d.PROGRAMLEVEL = 'ปริญญาตรี'
  AND COALESCE(d.FACULTYNAME, '') NOT IN ('ศูนย์ภาษาอาเซียน', 'ข้อมูลเดิม')
  AND s.SCORE IS NOT NULL
  AND s.SCORE >= 0
GROUP BY
  d.FACULTYNAME, d.PROGRAMNAME, d.PROGRAMLEVEL, s.SUBJECTCODE, s.SUBJECTNAME
`;

// NATIONNAME values that mean "Thai" — used to flip the isThai flag.
// The registrar mostly uses "ไทย"; older rows occasionally have
// "Thai" or "THAI". Anything else is non-Thai.
const THAI_NATIONALITY_TOKENS = new Set([
  'ไทย',
  'thai',
]);

function isThaiNationality(name: string | null): boolean {
  if (!name) return false;
  return THAI_NATIONALITY_TOKENS.has(name.trim().toLowerCase());
}

function norm(s: unknown): string {
  // Oracle's `oracledb` driver returns NUMBER-typed columns as JS
  // numbers even when the schema annotates them as strings (semesters
  // like "1" / "2" / "3" come back as numeric). Coerce defensively.
  if (s === null || s === undefined) return '';
  return String(s).trim();
}

// Postgres bind-parameter limit is 65,535 per statement. Each cube row
// is ~15-18 columns, so 1000 rows = ~18k binds — comfortably under
// the cap. Keeps individual createMany statements snappy.
//
// (We deliberately do NOT wrap the wipe + bulk insert in an interactive
// Prisma transaction. The student cube can be tens of thousands of
// rows; even with a generous timeout, the transaction approach has
// proven brittle under tsx-watch reloads + Prisma's default 5s tx
// timeout. ACID isn't load-bearing for an ad-hoc cube refresh — if a
// run dies mid-insert, the next click just wipes and reloads.)
const BATCH_SIZE = 1000;

function* chunked<T>(arr: T[], size: number): Generator<T[]> {
  for (let i = 0; i < arr.length; i += size) {
    yield arr.slice(i, i + size);
  }
}

@Injectable()
export class EducationRefreshService {
  private readonly logger = new Logger(EducationRefreshService.name);
  // In-memory lock — second concurrent caller waits on the same promise
  // rather than starting a parallel refresh. Cleared in finally().
  private inflight: Promise<RefreshResult> | null = null;

  constructor(private readonly ingestionQueue: IngestionQueueService) {}

  /** Trigger a refresh. With no `cubes` argument, refreshes all five
   *  cubes; with a list, refreshes only those (useful for the per-cube
   *  refresh icons in the dashboard header). Returns the most recent
   *  refresh row immediately when one is already running. */
  async refresh(
    triggeredByUserId: string | null,
    cubes?: RefreshableCube[],
  ): Promise<RefreshResult> {
    if (this.inflight) {
      this.logger.log('Refresh already in flight — joining existing run');
      return this.inflight;
    }
    this.inflight = this.doRefresh(triggeredByUserId, cubes).finally(() => {
      this.inflight = null;
    });
    return this.inflight;
  }

  /** True when a refresh is currently running. */
  isRunning(): boolean {
    return this.inflight !== null;
  }

  /** Most recent refresh row per cube (newest first). Drives the
   *  "last fetched" badge on every dashboard. Recruitment is sourced
   *  from IngestionRun (not the cube-refresh table) because that data
   *  flows through the `kku-tcas-funnel` connector, not a hand-rolled
   *  cube. */
  async latestPerCube(): Promise<
    {
      cubeName: string;
      status: string;
      startedAt: Date;
      completedAt: Date | null;
      recordsLoaded: number | null;
      durationMs: number | null;
      errorMessage: string | null;
    }[]
  > {
    const [rows, recruitmentRow] = await Promise.all([
      prisma.$queryRaw<
        {
          cube_name: string;
          status: string;
          started_at: Date;
          completed_at: Date | null;
          records_loaded: number | null;
          duration_ms: number | null;
          error_message: string | null;
        }[]
      >(Prisma.sql`
        SELECT DISTINCT ON (cube_name)
          cube_name, status, started_at, completed_at,
          records_loaded, duration_ms, error_message
        FROM education_cube_refresh
        ORDER BY cube_name, started_at DESC
      `),
      this.latestRecruitmentRun(),
    ]);

    const out = rows.map((r) => ({
      cubeName: r.cube_name,
      status: r.status,
      startedAt: r.started_at,
      completedAt: r.completed_at,
      recordsLoaded: r.records_loaded,
      durationMs: r.duration_ms,
      errorMessage: r.error_message,
    }));
    if (recruitmentRow) out.push(recruitmentRow);
    return out;
  }

  /** Project the latest IngestionRun for `kku-tcas-funnel` into the
   *  cube-refresh shape so the refresh-bar can display it alongside
   *  the hand-rolled cubes without special-casing in the UI. */
  private async latestRecruitmentRun(): Promise<{
    cubeName: string;
    status: string;
    startedAt: Date;
    completedAt: Date | null;
    recordsLoaded: number | null;
    durationMs: number | null;
    errorMessage: string | null;
  } | null> {
    const source = await prisma.dataSource.findUnique({
      where: { slug: RECRUITMENT_CONNECTOR_SLUG },
      select: { id: true },
    });
    if (!source) return null;
    const run = await prisma.ingestionRun.findFirst({
      where: { dataSourceId: source.id },
      orderBy: { createdAt: 'desc' },
      select: {
        status: true,
        startedAt: true,
        completedAt: true,
        durationMs: true,
        recordsLoaded: true,
        errorMessage: true,
        createdAt: true,
      },
    });
    if (!run) return null;
    const startedAt = run.startedAt ?? run.createdAt;
    return {
      cubeName: 'recruitment',
      status:
        run.status === 'RUNNING' || run.status === 'QUEUED'
          ? 'RUNNING'
          : run.status === 'SUCCEEDED'
            ? 'SUCCEEDED'
            : run.status === 'SKIPPED'
              ? 'SKIPPED'
              : 'FAILED',
      startedAt,
      completedAt: run.completedAt,
      recordsLoaded: run.recordsLoaded ?? null,
      durationMs:
        run.durationMs ??
        (run.completedAt
          ? run.completedAt.getTime() - startedAt.getTime()
          : null),
      errorMessage: run.errorMessage,
    };
  }

  // ── Internal ──────────────────────────────────────────────────────

  private async doRefresh(
    triggeredByUserId: string | null,
    cubeFilter?: RefreshableCube[],
  ): Promise<RefreshResult> {
    const startedAt = new Date();
    const wantAll = !cubeFilter || cubeFilter.length === 0;
    const want = (c: RefreshableCube) => wantAll || cubeFilter!.includes(c);
    this.logger.log(
      `Education cube refresh starting · triggered by ${triggeredByUserId ?? 'system'}${
        wantAll ? '' : ` · cubes=${cubeFilter!.join(',')}`
      }`,
    );

    const cfg = configFromEnv('KKU_REGISTRY_DB');

    // Top-level run-attempt log so any pre-persist failure (Oracle
    // connect, SQL syntax, schema drift) is visible in the refresh
    // history table — no need to grep the api stdout to debug.
    const fetchLog = await this.startLog('fetch', startedAt, triggeredByUserId);

    // Fetch all five result sets up-front (single Oracle connection),
    // then write them into Postgres in their own transactions. This
    // keeps the Oracle connection short — Postgres writes happen after
    // the warehouse handle is released. Q4 + Q5 are best-effort: if
    // they fail (column drift, missing AVSREG access) we still finish
    // the rest of the refresh and surface the failure in the log.
    let q1: Q1StudentRow[] = [];
    let q2: Q2LocationRow[] = [];
    let q3: Q3TuitionRow[] = [];
    let q4: Q4PerformanceRow[] = [];
    let q5: Q5EntryScoreRow[] = [];
    try {
      const fetched = await withConnection(cfg, async (conn) => {
        let q1: Q1StudentRow[] = [];
        let q2: Q2LocationRow[] = [];
        let q3: Q3TuitionRow[] = [];
        let q4: Q4PerformanceRow[] = [];
        let q5: Q5EntryScoreRow[] = [];
        if (want('student')) {
          this.logger.log('Q1 — student demographic cube…');
          q1 = await query<Q1StudentRow>(conn, Q1_STUDENT);
          this.logger.log(`Q1 ← ${q1.length} rows`);
        }
        if (want('location')) {
          this.logger.log('Q2 — student location cube…');
          q2 = await query<Q2LocationRow>(conn, Q2_LOCATION);
          this.logger.log(`Q2 ← ${q2.length} rows`);
        }
        if (want('tuition')) {
          this.logger.log('Q3 — tuition cube…');
          q3 = await query<Q3TuitionRow>(conn, Q3_TUITION);
          this.logger.log(`Q3 ← ${q3.length} rows`);
        }
        if (want('performance')) {
          try {
            this.logger.log('Q4 — performance (GPA) cube…');
            q4 = await query<Q4PerformanceRow>(conn, Q4_PERFORMANCE);
            this.logger.log(`Q4 ← ${q4.length} rows`);
          } catch (err) {
            this.logger.warn(
              `Q4 performance cube failed — continuing without GPA data: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
        if (want('entryScores')) {
          try {
            this.logger.log('Q5 — entry test scores cube…');
            q5 = await query<Q5EntryScoreRow>(conn, Q5_ENTRY_SCORES);
            this.logger.log(`Q5 ← ${q5.length} rows`);
          } catch (err) {
            this.logger.warn(
              `Q5 entry scores cube failed — continuing without score data: ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
        }
        return { q1, q2, q3, q4, q5 };
      });
      q1 = fetched.q1;
      q2 = fetched.q2;
      q3 = fetched.q3;
      q4 = fetched.q4;
      q5 = fetched.q5;
      await this.completeLog(
        fetchLog.id,
        'SUCCEEDED',
        q1.length + q2.length + q3.length + q4.length + q5.length,
      );
    } catch (err) {
      await this.completeLog(fetchLog.id, 'FAILED', null, errMsg(err));
      throw err;
    }

    const refreshedAt = new Date();
    const performanceRows = want('performance')
      ? await this.persistPerformance(q4, refreshedAt, triggeredByUserId, startedAt)
      : 0;
    const entryScoreRows = want('entryScores')
      ? await this.persistEntryScores(q5, refreshedAt, triggeredByUserId, startedAt)
      : 0;
    void performanceRows;
    void entryScoreRows;
    const studentRows = want('student')
      ? await this.persistStudent(q1, refreshedAt, triggeredByUserId, startedAt)
      : 0;
    const locationRows = want('location')
      ? await this.persistLocation(q2, refreshedAt, triggeredByUserId, startedAt)
      : 0;
    const tuitionRows = want('tuition')
      ? await this.persistTuition(q3, refreshedAt, triggeredByUserId, startedAt)
      : 0;

    // Recruitment is asynchronous — the connector runs on the
    // ingestion worker. We enqueue a manual run and report `0` rows
    // synchronously; the refresh-bar's status-poll picks up the real
    // count from the IngestionRun once the worker finishes.
    let recruitmentEnqueued = 0;
    if (want('recruitment')) {
      try {
        await this.ingestionQueue.enqueueManual(
          RECRUITMENT_CONNECTOR_SLUG,
          triggeredByUserId ?? 'system',
        );
        recruitmentEnqueued = 1;
        this.logger.log(
          `recruitment cube · enqueued ${RECRUITMENT_CONNECTOR_SLUG} manual run`,
        );
      } catch (err) {
        this.logger.warn(
          `Failed to enqueue ${RECRUITMENT_CONNECTOR_SLUG} — ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    const completedAt = new Date();
    this.logger.log(
      `Education cube refresh complete · student=${studentRows} · location=${locationRows} · tuition=${tuitionRows} · recruitment=${recruitmentEnqueued} · ${completedAt.getTime() - startedAt.getTime()}ms`,
    );

    return {
      startedAt,
      completedAt,
      recordsByCube: {
        student: studentRows,
        location: locationRows,
        tuition: tuitionRows,
        performance: performanceRows,
        entryScores: entryScoreRows,
        recruitment: recruitmentEnqueued,
      },
    };
  }

  private async persistStudent(
    rows: Q1StudentRow[],
    refreshedAt: Date,
    triggeredByUserId: string | null,
    runStartedAt: Date,
  ): Promise<number> {
    const log = await this.startLog(
      'student',
      runStartedAt,
      triggeredByUserId,
    );
    try {
      // De-dup in memory before the transaction — the JS work is CPU-only
      // and shouldn't run inside a Postgres tx (which has a 5s timeout
      // by default). Two cells can collide on the normalised key
      // (e.g., MAJOR=null vs MAJOR=''), so re-tally regardless of what
      // Oracle's GROUP BY produced.
      const map = new Map<string, Prisma.EducationStudentCubeCreateManyInput>();
      let skipped = 0;
      for (const r of rows) {
        // Skip rows with null required fields. The Oracle WHERE clause
        // already filters null FACULTYNAME / PROGRAMNAME, but program
        // level / cohort year / status code can also be null on stale
        // rows, and the cube columns are NOT NULL.
        if (
          !r.FACULTY_NAME ||
          !r.PROGRAM_LEVEL ||
          !r.PROGRAM_NAME ||
          r.COHORT_YEAR_BE === null ||
          r.COHORT_YEAR_BE === undefined ||
          r.STATUS_CODE === null ||
          r.STATUS_CODE === undefined
        ) {
          skipped += 1;
          continue;
        }
        const major = norm(r.MAJOR);
        const gender = norm(r.GENDER);
        const nationality = norm(r.NATIONALITY);
        const entryType = norm(r.ENTRY_TYPE);
        const isThai = isThaiNationality(r.NATIONALITY);
        const key = [
          r.FACULTY_NAME,
          r.PROGRAM_LEVEL,
          r.PROGRAM_NAME,
          major,
          r.COHORT_YEAR_BE,
          r.STATUS_CODE,
          gender,
          nationality,
          isThai ? '1' : '0',
          entryType,
        ].join('|');
        const ageSum = Number(r.AGE_SUM ?? 0) || 0;
        const ageCount = Number(r.AGE_COUNT ?? 0) || 0;
        const existing = map.get(key);
        if (existing) {
          existing.studentCount += Number(r.N);
          existing.ageSum = (existing.ageSum ?? 0) + ageSum;
          existing.ageCount = (existing.ageCount ?? 0) + ageCount;
        } else {
          map.set(key, {
            facultyName: r.FACULTY_NAME,
            programLevel: r.PROGRAM_LEVEL,
            programName: r.PROGRAM_NAME,
            major: major || null,
            majorNorm: major,
            cohortYearBe: Number(r.COHORT_YEAR_BE),
            statusCode: Number(r.STATUS_CODE),
            statusName: r.STATUS_NAME,
            gender: gender || null,
            genderNorm: gender,
            nationality: nationality || null,
            nationalityNorm: nationality,
            isThai,
            entryType: entryType || null,
            entryTypeNorm: entryType,
            studentCount: Number(r.N),
            ageSum,
            ageCount,
            refreshedAt,
          });
        }
      }
      const data = Array.from(map.values());
      this.logger.log(
        `student cube · ${data.length} unique rows (${skipped} skipped for null required fields)`,
      );

      await prisma.educationStudentCube.deleteMany({});
      for (const chunk of chunked(data, BATCH_SIZE)) {
        await prisma.educationStudentCube.createMany({
          data: chunk,
          skipDuplicates: true,
        });
      }
      await this.completeLog(log.id, 'SUCCEEDED', data.length);
      return data.length;
    } catch (err) {
      await this.completeLog(log.id, 'FAILED', null, errMsg(err));
      throw err;
    }
  }

  private async persistLocation(
    rows: Q2LocationRow[],
    refreshedAt: Date,
    triggeredByUserId: string | null,
    runStartedAt: Date,
  ): Promise<number> {
    const log = await this.startLog(
      'location',
      runStartedAt,
      triggeredByUserId,
    );
    try {
      const map = new Map<
        string,
        Prisma.EducationStudentLocationCubeCreateManyInput
      >();
      let skipped = 0;
      for (const r of rows) {
        if (
          !r.FACULTY_NAME ||
          !r.PROGRAM_LEVEL ||
          !r.PROGRAM_NAME ||
          r.COHORT_YEAR_BE === null ||
          r.COHORT_YEAR_BE === undefined ||
          r.STATUS_CODE === null ||
          r.STATUS_CODE === undefined
        ) {
          skipped += 1;
          continue;
        }
        const schoolName = norm(r.SCHOOL_NAME);
        const provinceName = norm(r.SCHOOL_PROVINCE_NAME);
        const region = lookupRegion(provinceName);
        const key = [
          r.FACULTY_NAME,
          r.PROGRAM_LEVEL,
          r.PROGRAM_NAME,
          r.COHORT_YEAR_BE,
          schoolName,
          provinceName,
          r.STATUS_CODE,
        ].join('|');
        const existing = map.get(key);
        if (existing) {
          existing.studentCount += Number(r.N);
        } else {
          map.set(key, {
            facultyName: r.FACULTY_NAME,
            programLevel: r.PROGRAM_LEVEL,
            programName: r.PROGRAM_NAME,
            cohortYearBe: Number(r.COHORT_YEAR_BE),
            schoolName: schoolName || null,
            schoolNameNorm: schoolName,
            schoolProvinceName: provinceName || null,
            schoolProvinceNorm: provinceName,
            thaiRegion: region,
            statusCode: Number(r.STATUS_CODE),
            studentCount: Number(r.N),
            refreshedAt,
          });
        }
      }
      const data = Array.from(map.values());
      this.logger.log(
        `location cube · ${data.length} unique rows (${skipped} skipped for null required fields)`,
      );

      await prisma.educationStudentLocationCube.deleteMany({});
      for (const chunk of chunked(data, BATCH_SIZE)) {
        await prisma.educationStudentLocationCube.createMany({
          data: chunk,
          skipDuplicates: true,
        });
      }
      await this.completeLog(log.id, 'SUCCEEDED', data.length);
      return data.length;
    } catch (err) {
      await this.completeLog(log.id, 'FAILED', null, errMsg(err));
      throw err;
    }
  }

  private async persistTuition(
    rows: Q3TuitionRow[],
    refreshedAt: Date,
    triggeredByUserId: string | null,
    runStartedAt: Date,
  ): Promise<number> {
    const log = await this.startLog(
      'tuition',
      runStartedAt,
      triggeredByUserId,
    );
    try {
      const map = new Map<
        string,
        Prisma.EducationTuitionCubeCreateManyInput
      >();
      let skipped = 0;
      for (const r of rows) {
        if (
          !r.FACULTY_NAME ||
          !r.PROGRAM_LEVEL ||
          !r.PROGRAM_NAME ||
          r.ACAD_YEAR_BE === null ||
          r.ACAD_YEAR_BE === undefined
        ) {
          skipped += 1;
          continue;
        }
        const semester = norm(r.SEMESTER) || '—';
        const key = [
          r.FACULTY_NAME,
          r.PROGRAM_LEVEL,
          r.PROGRAM_NAME,
          r.ACAD_YEAR_BE,
          semester,
        ].join('|');
        const existing = map.get(key);
        if (existing) {
          existing.revenueThb = (
            Number(existing.revenueThb) + Number(r.REVENUE_THB)
          ).toFixed(2);
          existing.studentCount += Number(r.STUDENT_COUNT);
        } else {
          map.set(key, {
            facultyName: r.FACULTY_NAME,
            programLevel: r.PROGRAM_LEVEL,
            programName: r.PROGRAM_NAME,
            academicYearBe: Number(r.ACAD_YEAR_BE),
            semester,
            revenueThb: Number(r.REVENUE_THB).toFixed(2),
            studentCount: Number(r.STUDENT_COUNT),
            refreshedAt,
          });
        }
      }
      const data = Array.from(map.values());
      this.logger.log(
        `tuition cube · ${data.length} unique rows (${skipped} skipped for null required fields)`,
      );

      await prisma.educationTuitionCube.deleteMany({});
      for (const chunk of chunked(data, BATCH_SIZE)) {
        await prisma.educationTuitionCube.createMany({
          data: chunk,
          skipDuplicates: true,
        });
      }
      await this.completeLog(log.id, 'SUCCEEDED', data.length);
      return data.length;
    } catch (err) {
      await this.completeLog(log.id, 'FAILED', null, errMsg(err));
      throw err;
    }
  }

  private async persistPerformance(
    rows: Q4PerformanceRow[],
    refreshedAt: Date,
    triggeredByUserId: string | null,
    runStartedAt: Date,
  ): Promise<number> {
    const log = await this.startLog(
      'performance',
      runStartedAt,
      triggeredByUserId,
    );
    try {
      const map = new Map<
        string,
        Prisma.EducationPerformanceCubeCreateManyInput
      >();
      let skipped = 0;
      for (const r of rows) {
        if (
          !r.FACULTY_NAME ||
          !r.PROGRAM_LEVEL ||
          !r.PROGRAM_NAME
        ) {
          skipped += 1;
          continue;
        }
        const schoolName = norm(r.SCHOOL_NAME);
        const provinceName = norm(r.SCHOOL_PROVINCE_NAME);
        const region = lookupRegion(provinceName);
        const statusName = norm(r.STATUS_NAME);
        const key = [
          r.FACULTY_NAME,
          r.PROGRAM_LEVEL,
          r.PROGRAM_NAME,
          schoolName,
          provinceName,
          statusName,
        ].join('|');
        const existing = map.get(key);
        if (existing) {
          existing.studentCount += Number(r.N);
          existing.entryGpaSum =
            (Number(existing.entryGpaSum) ?? 0) +
            (Number(r.ENTRY_GPA_SUM) || 0);
          existing.entryGpaCount =
            (Number(existing.entryGpaCount) ?? 0) +
            (Number(r.ENTRY_GPA_COUNT) || 0);
          existing.gpaSum =
            (Number(existing.gpaSum) ?? 0) + (Number(r.GPA_SUM) || 0);
          existing.gpaCount =
            (Number(existing.gpaCount) ?? 0) + (Number(r.GPA_COUNT) || 0);
          existing.englishGpaSum =
            (Number(existing.englishGpaSum) ?? 0) +
            (Number(r.ENGLISH_GPA_SUM) || 0);
          existing.englishGpaCount =
            (Number(existing.englishGpaCount) ?? 0) +
            (Number(r.ENGLISH_GPA_COUNT) || 0);
        } else {
          map.set(key, {
            facultyName: r.FACULTY_NAME,
            programLevel: r.PROGRAM_LEVEL,
            programName: r.PROGRAM_NAME,
            schoolName: schoolName || null,
            schoolNameNorm: schoolName,
            schoolProvinceName: provinceName || null,
            schoolProvinceNorm: provinceName,
            thaiRegion: region,
            statusName: statusName || null,
            statusNameNorm: statusName,
            studentCount: Number(r.N),
            entryGpaSum: Number(r.ENTRY_GPA_SUM) || 0,
            entryGpaCount: Number(r.ENTRY_GPA_COUNT) || 0,
            gpaSum: Number(r.GPA_SUM) || 0,
            gpaCount: Number(r.GPA_COUNT) || 0,
            englishGpaSum: Number(r.ENGLISH_GPA_SUM) || 0,
            englishGpaCount: Number(r.ENGLISH_GPA_COUNT) || 0,
            refreshedAt,
          });
        }
      }
      const data = Array.from(map.values());
      this.logger.log(
        `performance cube · ${data.length} rows (${skipped} skipped)`,
      );

      await prisma.educationPerformanceCube.deleteMany({});
      for (const chunk of chunked(data, BATCH_SIZE)) {
        await prisma.educationPerformanceCube.createMany({
          data: chunk,
          skipDuplicates: true,
        });
      }
      await this.completeLog(log.id, 'SUCCEEDED', data.length);
      return data.length;
    } catch (err) {
      await this.completeLog(log.id, 'FAILED', null, errMsg(err));
      // Performance cube failure shouldn't kill the entire refresh —
      // student / location / tuition already succeeded by this point.
      this.logger.error(
        `Performance cube persist failed: ${errMsg(err)}`,
      );
      return 0;
    }
  }

  private async persistEntryScores(
    rows: Q5EntryScoreRow[],
    refreshedAt: Date,
    triggeredByUserId: string | null,
    runStartedAt: Date,
  ): Promise<number> {
    const log = await this.startLog(
      'entryScores',
      runStartedAt,
      triggeredByUserId,
    );
    try {
      const map = new Map<
        string,
        Prisma.EducationEntryScoreCubeCreateManyInput
      >();
      let skipped = 0;
      for (const r of rows) {
        if (
          !r.FACULTY_NAME ||
          !r.PROGRAM_LEVEL ||
          !r.PROGRAM_NAME ||
          !r.SUBJECT_CODE
        ) {
          skipped += 1;
          continue;
        }
        const subjectCode = String(r.SUBJECT_CODE);
        const key = [
          r.FACULTY_NAME,
          r.PROGRAM_LEVEL,
          r.PROGRAM_NAME,
          subjectCode,
        ].join('|');
        const existing = map.get(key);
        const sum = Number(r.SCORE_SUM) || 0;
        const count = Number(r.SCORE_COUNT) || 0;
        const min = r.SCORE_MIN === null ? null : Number(r.SCORE_MIN);
        const max = r.SCORE_MAX === null ? null : Number(r.SCORE_MAX);
        if (existing) {
          existing.studentCount += Number(r.N);
          existing.scoreSum = (Number(existing.scoreSum) ?? 0) + sum;
          existing.scoreCount = (Number(existing.scoreCount) ?? 0) + count;
          if (min !== null)
            existing.scoreMin =
              existing.scoreMin === null
                ? min
                : Math.min(Number(existing.scoreMin), min);
          if (max !== null)
            existing.scoreMax =
              existing.scoreMax === null
                ? max
                : Math.max(Number(existing.scoreMax), max);
        } else {
          map.set(key, {
            facultyName: r.FACULTY_NAME,
            programLevel: r.PROGRAM_LEVEL,
            programName: r.PROGRAM_NAME,
            subjectCode,
            subjectName: r.SUBJECT_NAME,
            studentCount: Number(r.N),
            scoreSum: sum,
            scoreCount: count,
            scoreMin: min,
            scoreMax: max,
            refreshedAt,
          });
        }
      }
      const data = Array.from(map.values());
      this.logger.log(
        `entry score cube · ${data.length} rows (${skipped} skipped)`,
      );

      await prisma.educationEntryScoreCube.deleteMany({});
      for (const chunk of chunked(data, BATCH_SIZE)) {
        await prisma.educationEntryScoreCube.createMany({
          data: chunk,
          skipDuplicates: true,
        });
      }
      await this.completeLog(log.id, 'SUCCEEDED', data.length);
      return data.length;
    } catch (err) {
      await this.completeLog(log.id, 'FAILED', null, errMsg(err));
      this.logger.error(
        `Entry score cube persist failed: ${errMsg(err)}`,
      );
      return 0;
    }
  }

  private async startLog(
    cubeName: string,
    startedAt: Date,
    triggeredByUserId: string | null,
  ): Promise<{ id: string }> {
    return prisma.educationCubeRefresh.create({
      data: {
        cubeName,
        status: 'RUNNING',
        startedAt,
        triggeredByUserId,
      },
      select: { id: true },
    });
  }

  private async completeLog(
    id: string,
    status: 'SUCCEEDED' | 'FAILED',
    recordsLoaded: number | null,
    errorMessage?: string,
  ): Promise<void> {
    const completedAt = new Date();
    const row = await prisma.educationCubeRefresh.findUnique({ where: { id } });
    await prisma.educationCubeRefresh.update({
      where: { id },
      data: {
        status,
        completedAt,
        recordsLoaded,
        durationMs: row
          ? completedAt.getTime() - row.startedAt.getTime()
          : null,
        errorMessage: errorMessage ?? null,
      },
    });
  }
}

export type RefreshableCube =
  | 'student'
  | 'location'
  | 'tuition'
  | 'performance'
  | 'entryScores'
  | 'recruitment';

export const REFRESHABLE_CUBES: RefreshableCube[] = [
  'student',
  'location',
  'tuition',
  'performance',
  'entryScores',
  'recruitment',
];

export interface RefreshResult {
  startedAt: Date;
  completedAt: Date;
  recordsByCube: {
    student: number;
    location: number;
    tuition: number;
    performance: number;
    entryScores: number;
    /** 1 when the connector was enqueued; 0 when refresh didn't ask
     *  for it. Actual rows landed are reported by the IngestionRun. */
    recruitment: number;
  };
}

function errMsg(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 4000);
  return String(err).slice(0, 4000);
}
