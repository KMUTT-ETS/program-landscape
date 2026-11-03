// ────────────────────────────────────────────────────────────────────────
// Real KkuEvaluationsConnector — flips kku-evaluations to live.
//
// Wire-up:
//   - oracledb (thin) → POWERBI.EVALUATE_INSTRUCTOR on
//     the registrar Oracle warehouse (same host as kku-registry; see
//     KKU_REGISTRY_DB_HOST)
//   - Two queries:
//       Q1: catalog of distinct (QUESTIONID, question text) seen
//       Q3: aggregated cells (Y, S, classid, qid, officerid) with
//           TOTAL_STUDENT >= 5 anonymity gate
//   - Resolution (best-effort, never blocks the run):
//       FACULTYID → Faculty via existing ClassOffering rows with the
//                   same classId (no separate registry-faculty-map)
//       CLASSID   → ClassOffering.classId direct join
//       KKUMAIL   → FacultyMember.kkuEmail (lowercased exact)
//   - Idempotent upsert keyed on natural key
//     (acadYearBE, semester, classIdRegistrar, questionIdRegistrar,
//      officerIdRegistrar). Question rows upsert by
//     (questionIdRegistrar, questionTextHash).
//
// Performance (2026-06-02 rewrite — fixes the prod freeze):
//   - INCREMENTAL: a registrar refresh stamps every row with one shared
//     LAST_UPDATE, so Q3 fetches `LAST_UPDATE > watermark` — an entire new
//     batch or (between refreshes) nothing at all. Steady-state bi-weekly
//     runs are a near-instant no-op instead of re-loading ~986K rows.
//   - SINGLE BUFFER: cells are validated once into one typed array on
//     runState. We no longer build a second ~986K-element NormalizedRecord
//     array in transform() — that double-buffer was the GC-thrash that
//     froze the worker.
//   - BULK UPSERT: load() writes batched `INSERT … ON CONFLICT DO UPDATE`
//     (1,000 rows / statement) instead of ~986K single upserts, cutting a
//     full reload from ~11 min of pegged CPU to ~1–2 min.
//   Force a full reload with KKU_EVALUATIONS_FULL_REFRESH=1.
//
// PDPA: aggregation happens server-side; the connector receives only
// (class × question × instructor) cells with n >= 5. No per-student
// data crosses the wire. No PII columns are projected. The
// `powerbi` Oracle account is read-only.
//
// Resilience: per-row Zod validation; on validation error throws
// NonRetryableError to skip BullMQ backoff (registrar schema change is
// a deploy-time fix, not a transient blip). A bulk-statement failure
// falls back to per-row upserts for that batch so one bad row never
// loses the other 999.
// ────────────────────────────────────────────────────────────────────────

import { randomUUID } from 'node:crypto';

import { prisma, Prisma, type PrismaClient } from '@kku/db';
import type {
  ConnectorContext,
  HealthStatus,
  LoadResult,
  NormalizedRecord,
  RawRecord,
} from '@kku/shared';

import { ApiConnector } from '../../base/api-connector';
import { NonRetryableError } from '../../base/base-connector';
import {
  configFromEnv,
  type OracleConfig,
  query,
  withConnection,
} from '../../../lib/oracle-client';
import {
  EVAL_ROW_SCHEMA,
  type EvalRow,
  isCoreFromSemestersUsed,
  normaliseCourseCode,
  normaliseKkumail,
  parseLastUpdate,
  QUESTION_ROW_SCHEMA,
  type QuestionRow,
  questionTextHash,
  inferThemeTag,
} from './transforms';

// ── SQL queries ────────────────────────────────────────────────────────
// Q1 is the question catalog; Q3 is the per-cell aggregate. Both apply
// server-side aggregation; Q3 enforces the anonymity gate.

const Q1_QUESTIONS = `
SELECT
  QUESTIONID                                              AS QUESTIONID,
  MAX(QUESTION)                                           AS QUESTION_TEXT_TH,
  MIN(ACADYEAR)                                           AS FIRST_SEEN_YEAR_BE,
  MAX(ACADYEAR)                                           AS LAST_SEEN_YEAR_BE,
  COUNT(DISTINCT ACADYEAR || '-' || SEMESTER)             AS SEMESTERS_USED
FROM POWERBI.EVALUATE_INSTRUCTOR
WHERE :year_from IS NULL OR ACADYEAR >= :year_from
GROUP BY QUESTIONID
`;

const Q2_BUCKETS_COUNT = `
SELECT COUNT(DISTINCT ACADYEAR || '-' || SEMESTER) AS N
FROM POWERBI.EVALUATE_INSTRUCTOR
WHERE :year_from IS NULL OR ACADYEAR >= :year_from
`;

// Q3 retrieves the per-cell aggregates. The view itself is already
// per-(class × question × instructor); we just project and filter. The
// incremental `AND LAST_UPDATE > :watermark` clause is appended in code
// only when a watermark exists — we never bind a bare null (oracledb
// can't infer its type, and `DATE > NULL` would fail the parse-time type
// check even though the row would pass).
const Q3_EVAL_CELLS = `
SELECT
  ACADYEAR,
  SEMESTER,
  CAMPUSID,
  FACULTYID,
  COURSECODE,
  COURSENAME,
  COURSENAMEENG,
  CLASSID,
  SECTION,
  QUESTIONID,
  OFFICERID,
  KKUMAIL,
  POINT_AVG       AS RATING_AVG,
  TOTAL_STUDENT   AS RESPONDENT_COUNT,
  LAST_UPDATE
FROM POWERBI.EVALUATE_INSTRUCTOR
WHERE TOTAL_STUDENT >= 5
  AND POINT_AVG IS NOT NULL
  AND (:year_from IS NULL OR ACADYEAR >= :year_from)
`;

// Appended to Q3 (and `watermark` bound) only on the incremental path.
const Q3_INCREMENTAL_CLAUSE = ` AND LAST_UPDATE > :watermark`;

// ── per-run state ──────────────────────────────────────────────────────

interface RunState {
  capturedAt: string;
  fetchTimestamp: Date;
  yearFrom: number;
  totalBuckets: number;
  loadMode: 'full' | 'incremental';
  // Question catalog from Q1 (after Zod validation).
  questions: QuestionRow[];
  // The validated cells — the single in-memory buffer for the run. Built
  // once in fetch(); load() reads from here. We never expand it into a
  // parallel NormalizedRecord array.
  cells: EvalRow[];
  // questionIdRegistrar → DB row id (resolved during load before cells)
  questionIdMap: Map<string, string>;
  // Resolution lookups, batch-loaded once.
  classOfferingLookup: Map<string, { id: string; facultyId: string | null }>; // key = classId.toString()
  facultyMemberLookup: Map<string, string>; // kkuEmail (lowercased) → fmId
  // Per-run counters for IngestionRun.metadata.
  unresolvedClassOfferings: Set<string>;
  unresolvedFacultyMembers: Set<string>;
  unresolvedFaculties: Set<number>;
  loadedCells: number;
  loadedQuestions: number;
}

interface EvalsRawData {
  kind: 'questions' | 'cells';
  /** Questions payload — small (~40 rows). Cells carry a count only. */
  rows?: unknown[];
  count?: number;
}

// Bulk-insert tuning. 22 bound params per row × 1,000 rows = 22K params,
// comfortably under Postgres' 65,535-param ceiling.
const LOAD_CHUNK = 1_000;

export class KkuEvaluationsRealConnector extends ApiConnector {
  readonly slug = 'kku-evaluations';
  readonly mocked = false;

  private runState?: RunState;

  constructor(
    private readonly oracleConfig: () => OracleConfig = () =>
      configFromEnv('KKU_REGISTRY_DB'),
    private readonly db: PrismaClient = prisma,
  ) {
    super();
  }

  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    try {
      await withConnection(this.oracleConfig(), async (conn) => {
        await query(conn, 'SELECT 1 AS OK FROM DUAL');
      });
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  async fetch(ctx: ConnectorContext, _since?: Date): Promise<RawRecord[]> {
    const fetchTimestamp = new Date();
    const capturedAt = fetchTimestamp.toISOString();
    const yearFrom = Number(process.env['KKU_EVALUATIONS_YEAR_FROM'] ?? 2564);
    const forceFull = process.env['KKU_EVALUATIONS_FULL_REFRESH'] === '1';

    // Incremental watermark: the max source LAST_UPDATE we've already
    // stored. We compare source-time to source-time (NOT our wall-clock
    // dataSource.lastSyncedAt — `_since`) so clock skew between KKU's
    // Oracle and our server can never silently drop a refresh.
    let watermark: Date | null = null;
    if (!forceFull) {
      const wm = await this.db.evaluationResponseSummary.aggregate({
        _max: { lastUpdateAt: true },
        // Rows from the spreadsheet import never advance the source watermark.
        // ingestionRunId is NOT NULL on this table, so a plain NOT is complete.
        where: { NOT: { ingestionRun: { dataSource: { slug: 'xlsx-course-evaluations' } } } },
      });
      watermark = wm._max.lastUpdateAt ?? null;
    }
    const loadMode: 'full' | 'incremental' = watermark ? 'incremental' : 'full';

    const cfg = this.oracleConfig();
    let qRaw: unknown[] = [];
    let cellsRaw: unknown[] = [];
    let totalBuckets = 0;
    await withConnection(cfg, async (conn) => {
      ctx.log.info(`running Q1 question catalog (year_from=${yearFrom})`);
      qRaw = await query(conn, Q1_QUESTIONS, { year_from: yearFrom });
      ctx.log.info(`Q1 returned ${qRaw.length} question rows`);

      const bucketCount = await query<{ N: number }>(conn, Q2_BUCKETS_COUNT, {
        year_from: yearFrom,
      });
      totalBuckets = Number(bucketCount[0]?.N ?? 0);
      ctx.log.info(`observed ${totalBuckets} (year,sem) buckets`);

      ctx.log.info(
        `running Q3 aggregated cells with n>=5 gate — ${loadMode}` +
          (watermark ? ` (LAST_UPDATE > ${watermark.toISOString()})` : ''),
      );
      // Bind watermark (a real Date) only on the incremental path — never
      // a bare null. See Q3_INCREMENTAL_CLAUSE.
      const q3Sql = watermark ? Q3_EVAL_CELLS + Q3_INCREMENTAL_CLAUSE : Q3_EVAL_CELLS;
      const q3Binds = watermark
        ? { year_from: yearFrom, watermark }
        : { year_from: yearFrom };
      cellsRaw = await query(conn, q3Sql, q3Binds);
      ctx.log.info(`Q3 returned ${cellsRaw.length.toLocaleString()} cells (post-gate)`);
    });

    const questions = qRaw.map((r, i): QuestionRow => {
      const result = QUESTION_ROW_SCHEMA.safeParse(r);
      if (!result.success) {
        throw new NonRetryableError(
          'Q1_VALIDATION',
          `Q1 row ${i} failed schema validation: ${result.error.message}`,
        );
      }
      return result.data;
    });

    // Validate cells ONCE into a single typed array. (Previously this
    // happened in transform() and produced a second ~986K NormalizedRecord
    // array — the double-buffer that pinned memory and froze the worker.)
    // `cellsRaw` is local and drops out of scope after fetch(), so only the
    // typed `cells` array survives on runState.
    const cells: EvalRow[] = new Array(cellsRaw.length);
    for (let i = 0; i < cellsRaw.length; i++) {
      const result = EVAL_ROW_SCHEMA.safeParse(cellsRaw[i]);
      if (!result.success) {
        throw new NonRetryableError(
          'Q3_VALIDATION',
          `Q3 cell ${i} failed schema validation: ${result.error.message}`,
        );
      }
      cells[i] = result.data;
    }

    // Resolution lookups — skip the two full-table scans entirely when an
    // incremental run found nothing new to load.
    const classOfferingLookup = new Map<string, { id: string; facultyId: string | null }>();
    const facultyMemberLookup = new Map<string, string>();
    if (cells.length > 0) {
      const classOfferings = await this.db.classOffering.findMany({
        select: { id: true, classId: true, facultyId: true },
      });
      for (const co of classOfferings) {
        classOfferingLookup.set(co.classId.toString(), {
          id: co.id,
          facultyId: co.facultyId,
        });
      }
      ctx.log.info(`loaded ${classOfferingLookup.size.toLocaleString()} class offerings for resolution`);

      const facultyMembers = await this.db.facultyMember.findMany({
        where: { kkuEmail: { not: null } },
        select: { id: true, kkuEmail: true },
      });
      for (const fm of facultyMembers) {
        if (fm.kkuEmail) facultyMemberLookup.set(fm.kkuEmail.toLowerCase(), fm.id);
      }
      ctx.log.info(`loaded ${facultyMemberLookup.size.toLocaleString()} faculty members for resolution`);
    } else {
      ctx.log.info('no new cells to load — skipping resolution-map load');
    }

    this.runState = {
      capturedAt,
      fetchTimestamp,
      yearFrom,
      totalBuckets,
      loadMode,
      questions,
      cells,
      questionIdMap: new Map(),
      classOfferingLookup,
      facultyMemberLookup,
      unresolvedClassOfferings: new Set(),
      unresolvedFacultyMembers: new Set(),
      unresolvedFaculties: new Set(),
      loadedCells: 0,
      loadedQuestions: 0,
    };

    // Two lightweight RawRecords — questions (with payload) then a cells
    // MARKER (count only; the validated rows live on runState). Order
    // matters: cells FK to question rows, so questions load first.
    return [
      {
        externalId: 'kku-evaluations:questions',
        sourceTimestamp: fetchTimestamp,
        data: { kind: 'questions', rows: questions } satisfies EvalsRawData,
      },
      {
        externalId: 'kku-evaluations:cells',
        sourceTimestamp: fetchTimestamp,
        data: { kind: 'cells', count: cells.length } satisfies EvalsRawData,
      },
    ];
  }

  async transform(
    _ctx: ConnectorContext,
    raw: RawRecord,
  ): Promise<NormalizedRecord[]> {
    const state = this.runState;
    if (!state) {
      throw new Error('transform() called before fetch() — connector lifecycle violated');
    }
    const data = raw.data as EvalsRawData;

    if (data.kind === 'questions') {
      // Questions land as a single normalized record with the full
      // catalog payload — load() iterates and upserts.
      return [
        {
          target: 'evaluation_questions',
          externalId: 'evaluation_questions:catalog',
          payload: { rows: data.rows as QuestionRow[] },
          freshnessDate: state.fetchTimestamp,
        },
      ];
    }

    // Cells: emit a single MARKER record. We deliberately do NOT expand to
    // one NormalizedRecord per cell — that ~986K-object array is what used
    // to pin memory and freeze the worker. The validated rows already live
    // on runState.cells; load() reads them directly.
    return [
      {
        target: 'evaluation_response_summaries',
        externalId: 'kku-evaluations:cells',
        payload: { marker: true, count: data.count ?? 0 },
        freshnessDate: state.fetchTimestamp,
      },
    ];
  }

  async load(
    ctx: ConnectorContext,
    normalized: NormalizedRecord[],
  ): Promise<LoadResult> {
    const state = this.runState;
    if (!state) {
      throw new Error('load() called before fetch() — connector lifecycle violated');
    }
    const runId = ctx.runId;

    // 1. Load questions first so cells can FK to them.
    const questionRec = normalized.find((r) => r.target === 'evaluation_questions');
    if (questionRec) {
      const rows = (questionRec.payload as { rows: QuestionRow[] }).rows;
      for (const q of rows) {
        try {
          const hash = questionTextHash(q.QUESTION_TEXT_TH);
          const theme = inferThemeTag(q.QUESTION_TEXT_TH);
          const isCore = isCoreFromSemestersUsed(q.SEMESTERS_USED, state.totalBuckets);
          const upserted = await this.db.evaluationQuestion.upsert({
            where: {
              questionIdRegistrar_questionTextHash: {
                questionIdRegistrar: q.QUESTIONID,
                questionTextHash: hash,
              },
            },
            create: {
              questionIdRegistrar: q.QUESTIONID,
              questionTextTh: q.QUESTION_TEXT_TH ?? '',
              questionTextHash: hash,
              themeTag: theme,
              firstSeenYearBE: q.FIRST_SEEN_YEAR_BE,
              lastSeenYearBE: q.LAST_SEEN_YEAR_BE,
              semestersUsed: q.SEMESTERS_USED,
              isCore,
              ingestionRunId: runId,
            },
            update: {
              // Refresh observed-range + presence on each run. Do NOT
              // overwrite questionTextEn / questionTextEnOverride — those
              // are produced by the AI translation pass / DEAN curation.
              questionTextTh: q.QUESTION_TEXT_TH ?? '',
              themeTag: theme,
              firstSeenYearBE: q.FIRST_SEEN_YEAR_BE,
              lastSeenYearBE: q.LAST_SEEN_YEAR_BE,
              semestersUsed: q.SEMESTERS_USED,
              isCore,
              ingestionRunId: runId,
            },
          });
          state.questionIdMap.set(q.QUESTIONID + '|' + hash, upserted.id);
          // Also key by QID alone — if multiple versions of the same QID
          // exist, the most recent upsert wins for cell-time resolution.
          // Cells without hash context still get a valid FK that way.
          state.questionIdMap.set(q.QUESTIONID, upserted.id);
          state.loadedQuestions++;
        } catch (err) {
          ctx.log.error(
            `failed to upsert question ${q.QUESTIONID}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
      ctx.log.info(`upserted ${state.loadedQuestions} evaluation questions`);
    }

    // 2. Bulk-upsert cells in batches of LOAD_CHUNK. A batched
    //    `INSERT … ON CONFLICT DO UPDATE` replaces ~986K single upserts.
    const cells = state.cells;
    let loaded = 0;
    let failed = 0;
    for (let i = 0; i < cells.length; i += LOAD_CHUNK) {
      const chunk = cells.slice(i, i + LOAD_CHUNK);
      try {
        await this.bulkUpsertCells(chunk, state, runId);
        loaded += chunk.length;
      } catch (err) {
        // A whole-statement failure is near-impossible in steady state
        // (FKs are resolved from our own DB), but if it happens we isolate
        // the bad row rather than losing the batch.
        ctx.log.warn(
          `bulk upsert failed for cells [${i}..${i + chunk.length}) — falling back to per-row: ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
        const r = await this.perRowFallback(ctx, chunk, state, runId);
        loaded += r.loaded;
        failed += r.failed;
      }
      if (i > 0 && i % (LOAD_CHUNK * 20) === 0) {
        ctx.log.info(`progress: ${loaded.toLocaleString()} cells upserted so far`);
      }
    }
    state.loadedCells = loaded;

    return {
      recordsFetched: state.questions.length + cells.length,
      recordsLoaded: state.loadedQuestions + loaded,
      recordsFailed: failed,
      metadata: {
        connectorMode: 'real',
        loadMode: state.loadMode,
        capturedAt: state.capturedAt,
        yearFrom: state.yearFrom,
        totalBuckets: state.totalBuckets,
        cellsFetched: cells.length,
        questionsUpserted: state.loadedQuestions,
        cellsUpserted: loaded,
        unresolvedClassOfferings: state.unresolvedClassOfferings.size,
        unresolvedFacultyMembers: state.unresolvedFacultyMembers.size,
        unresolvedFaculties: [...state.unresolvedFaculties].sort((a, b) => a - b),
        notes:
          'Per-(class × question × instructor) cells with n>=5. ' +
          `Load mode: ${state.loadMode} (set KKU_EVALUATIONS_FULL_REFRESH=1 to force full). ` +
          'questionTextEn populated by `pnpm evaluations:translate-questions` after this run.',
      },
    };
  }

  // ── private helpers ─────────────────────────────────────────────────

  /** Resolve a row's FKs from the in-memory lookups + track unresolved. */
  private resolveRow(
    row: EvalRow,
    state: RunState,
  ): {
    classOfferingId: string | null;
    facultyId: string | null;
    facultyMemberId: string | null;
    questionId: string | null;
    email: string | null;
  } {
    const classIdStr = row.CLASSID.toString();
    const coLookup = state.classOfferingLookup.get(classIdStr);
    const classOfferingId = coLookup?.id ?? null;
    const facultyId = coLookup?.facultyId ?? null;
    if (!coLookup) state.unresolvedClassOfferings.add(classIdStr);
    if (!facultyId) state.unresolvedFaculties.add(row.FACULTYID);

    const email = normaliseKkumail(row.KKUMAIL);
    const facultyMemberId = email ? state.facultyMemberLookup.get(email) ?? null : null;
    if (!facultyMemberId && email) state.unresolvedFacultyMembers.add(email);

    const questionId = state.questionIdMap.get(row.QUESTIONID) ?? null;
    return { classOfferingId, facultyId, facultyMemberId, questionId, email };
  }

  /** Batched `INSERT … ON CONFLICT DO UPDATE` for one chunk of cells. */
  private async bulkUpsertCells(
    chunk: EvalRow[],
    state: RunState,
    runId: string,
  ): Promise<void> {
    const values = chunk.map((row) => {
      const { classOfferingId, facultyId, facultyMemberId, questionId, email } =
        this.resolveRow(row, state);
      const courseCode = normaliseCourseCode(row.COURSECODE);
      const lastUpdateAt = parseLastUpdate(row.LAST_UPDATE);
      // Column order matches the INSERT list below. `updated_at` is a SQL
      // literal `now()` (not a bound param) to keep params at 22/row.
      return Prisma.sql`(${randomUUID()}, ${row.ACADYEAR}, ${row.SEMESTER}, ${facultyId}, ${classOfferingId}, ${facultyMemberId}, ${questionId}, ${row.FACULTYID}, ${row.CLASSID}::bigint, ${row.OFFICERID}, ${row.QUESTIONID}, ${courseCode}, ${row.COURSECODE}, ${row.COURSENAME ?? null}, ${row.COURSENAMEENG ?? null}, ${row.SECTION}, ${row.CAMPUSID}, ${email}, ${row.RATING_AVG.toFixed(3)}::numeric, ${row.RESPONDENT_COUNT}, ${lastUpdateAt}::timestamp, ${runId}, now())`;
    });

    await this.db.$executeRaw(Prisma.sql`
      INSERT INTO evaluation_response_summaries (
        id, acad_year_be, semester, faculty_id, class_offering_id, faculty_member_id, question_id,
        faculty_registry_id, class_id_registrar, officer_id_registrar, question_id_registrar,
        course_code, course_code_raw, course_name_th, course_name_en, section, campus_id, kkumail_raw,
        rating_avg, respondent_count, last_update_at, ingestion_run_id, updated_at
      )
      VALUES ${Prisma.join(values)}
      ON CONFLICT (acad_year_be, semester, class_id_registrar, question_id_registrar, officer_id_registrar)
      DO UPDATE SET
        faculty_id = EXCLUDED.faculty_id,
        class_offering_id = EXCLUDED.class_offering_id,
        faculty_member_id = EXCLUDED.faculty_member_id,
        question_id = EXCLUDED.question_id,
        faculty_registry_id = EXCLUDED.faculty_registry_id,
        course_code = EXCLUDED.course_code,
        course_code_raw = EXCLUDED.course_code_raw,
        course_name_th = EXCLUDED.course_name_th,
        course_name_en = EXCLUDED.course_name_en,
        section = EXCLUDED.section,
        campus_id = EXCLUDED.campus_id,
        kkumail_raw = EXCLUDED.kkumail_raw,
        rating_avg = EXCLUDED.rating_avg,
        respondent_count = EXCLUDED.respondent_count,
        last_update_at = EXCLUDED.last_update_at,
        ingestion_run_id = EXCLUDED.ingestion_run_id,
        updated_at = now()
    `);
  }

  /** Per-row upsert isolation path for a batch the bulk statement rejected. */
  private async perRowFallback(
    ctx: ConnectorContext,
    chunk: EvalRow[],
    state: RunState,
    runId: string,
  ): Promise<{ loaded: number; failed: number }> {
    let loaded = 0;
    let failed = 0;
    for (const row of chunk) {
      try {
        await this.upsertCell(row, state, runId);
        loaded++;
      } catch (err) {
        failed++;
        ctx.log.error(
          `cell load failed (eval:${row.ACADYEAR}:${row.SEMESTER}:${row.CLASSID}:${row.QUESTIONID}:${row.OFFICERID}): ` +
            `${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    return { loaded, failed };
  }

  /** Single-row Prisma upsert — used only by the fallback path. */
  private async upsertCell(
    row: EvalRow,
    state: RunState,
    runId: string,
  ): Promise<void> {
    const { classOfferingId, facultyId, facultyMemberId, questionId, email } =
      this.resolveRow(row, state);

    const data: Prisma.EvaluationResponseSummaryUncheckedCreateInput = {
      acadYearBE: row.ACADYEAR,
      semester: row.SEMESTER,
      facultyId,
      classOfferingId,
      facultyMemberId,
      questionId,
      facultyRegistryId: row.FACULTYID,
      classIdRegistrar: row.CLASSID,
      officerIdRegistrar: row.OFFICERID,
      questionIdRegistrar: row.QUESTIONID,
      courseCode: normaliseCourseCode(row.COURSECODE),
      courseCodeRaw: row.COURSECODE,
      courseNameTh: row.COURSENAME ?? null,
      courseNameEn: row.COURSENAMEENG ?? null,
      section: row.SECTION,
      campusId: row.CAMPUSID,
      kkumailRaw: email,
      ratingAvg: row.RATING_AVG.toFixed(3),
      respondentCount: row.RESPONDENT_COUNT,
      lastUpdateAt: parseLastUpdate(row.LAST_UPDATE),
      ingestionRunId: runId,
    };

    await this.db.evaluationResponseSummary.upsert({
      where: {
        evaluation_natural_key: {
          acadYearBE: row.ACADYEAR,
          semester: row.SEMESTER,
          classIdRegistrar: row.CLASSID,
          questionIdRegistrar: row.QUESTIONID,
          officerIdRegistrar: row.OFFICERID,
        },
      },
      create: data,
      update: {
        facultyId,
        classOfferingId,
        facultyMemberId,
        questionId,
        ratingAvg: row.RATING_AVG.toFixed(3),
        respondentCount: row.RESPONDENT_COUNT,
        lastUpdateAt: parseLastUpdate(row.LAST_UPDATE),
        ingestionRunId: runId,
        courseCode: normaliseCourseCode(row.COURSECODE),
        courseCodeRaw: row.COURSECODE,
        courseNameTh: row.COURSENAME ?? null,
        courseNameEn: row.COURSENAMEENG ?? null,
        section: row.SECTION,
        campusId: row.CAMPUSID,
        kkumailRaw: email,
        facultyRegistryId: row.FACULTYID,
      },
    });
  }
}
