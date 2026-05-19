// ────────────────────────────────────────────────────────────────────────
// Real KkuEvaluationsConnector — flips kku-evaluations to live.
//
// Wire-up:
//   - oracledb (thin) → POWERBI.EVALUATE_INSTRUCTOR on
//     regora19scan.kku.ac.th:1521 (same warehouse as kku-registry)
//   - Two queries:
//       Q1: catalog of distinct (QUESTIONID, question text) seen
//       Q2: aggregated cells (Y, S, classid, qid, officerid) with
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
// PDPA: aggregation happens server-side; the connector receives only
// (class × question × instructor) cells with n >= 5. No per-student
// data crosses the wire. No PII columns are projected. The
// `powerbi` Oracle account is read-only.
//
// Resilience: per-row Zod validation; on validation error throws
// NonRetryableError to skip BullMQ backoff (registrar schema change is
// a deploy-time fix, not a transient blip).
// ────────────────────────────────────────────────────────────────────────

import { prisma, type PrismaClient, type Prisma } from '@kku/db';
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
// Q1 is the question catalog; Q2 is the per-cell aggregate. Both apply
// server-side aggregation; Q2 enforces the anonymity gate.

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
// per-(class × question × instructor); we just project and filter.
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

// ── per-run state ──────────────────────────────────────────────────────

interface RunState {
  capturedAt: string;
  fetchTimestamp: Date;
  yearFrom: number;
  totalBuckets: number;
  // Question catalog from Q1 (after Zod validation).
  questions: QuestionRow[];
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
  rows: unknown[];
}

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

      ctx.log.info('running Q3 aggregated cells with n>=5 gate');
      cellsRaw = await query(conn, Q3_EVAL_CELLS, { year_from: yearFrom });
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

    // Batch-load resolution lookups once.
    const classOfferings = await this.db.classOffering.findMany({
      select: { id: true, classId: true, facultyId: true },
    });
    const classOfferingLookup = new Map<string, { id: string; facultyId: string | null }>();
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
    const facultyMemberLookup = new Map<string, string>();
    for (const fm of facultyMembers) {
      if (fm.kkuEmail) facultyMemberLookup.set(fm.kkuEmail.toLowerCase(), fm.id);
    }
    ctx.log.info(`loaded ${facultyMemberLookup.size.toLocaleString()} faculty members for resolution`);

    this.runState = {
      capturedAt,
      fetchTimestamp,
      yearFrom,
      totalBuckets,
      questions,
      questionIdMap: new Map(),
      classOfferingLookup,
      facultyMemberLookup,
      unresolvedClassOfferings: new Set(),
      unresolvedFacultyMembers: new Set(),
      unresolvedFaculties: new Set(),
      loadedCells: 0,
      loadedQuestions: 0,
    };

    // Two RawRecord batches — questions first, then cells (load order matters
    // because cells FK to question rows).
    return [
      {
        externalId: 'kku-evaluations:questions',
        sourceTimestamp: fetchTimestamp,
        data: { kind: 'questions', rows: questions } satisfies EvalsRawData,
      },
      {
        externalId: 'kku-evaluations:cells',
        sourceTimestamp: fetchTimestamp,
        data: { kind: 'cells', rows: cellsRaw } satisfies EvalsRawData,
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

    // Cells: validate + emit one normalized record per row.
    const records: NormalizedRecord[] = [];
    for (let i = 0; i < data.rows.length; i++) {
      const result = EVAL_ROW_SCHEMA.safeParse(data.rows[i]);
      if (!result.success) {
        throw new NonRetryableError(
          'Q3_VALIDATION',
          `Q3 cell ${i} failed schema validation: ${result.error.message}`,
        );
      }
      const row = result.data;
      records.push({
        target: 'evaluation_response_summaries',
        externalId: `eval:${row.ACADYEAR}:${row.SEMESTER}:${row.CLASSID}:${row.QUESTIONID}:${row.OFFICERID}`,
        payload: row as unknown as Record<string, unknown>,
        freshnessDate: state.fetchTimestamp,
      });
    }
    return records;
  }

  async load(
    ctx: ConnectorContext,
    normalized: NormalizedRecord[],
  ): Promise<LoadResult> {
    const state = this.runState;
    if (!state) {
      throw new Error('load() called before fetch() — connector lifecycle violated');
    }

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
              ingestionRunId: ctx.runId,
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
              ingestionRunId: ctx.runId,
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

    // 2. Load cells in chunks.
    const cellRecs = normalized.filter((r) => r.target === 'evaluation_response_summaries');
    let loaded = 0;
    let failed = 0;
    const CHUNK = 25;
    for (let i = 0; i < cellRecs.length; i += CHUNK) {
      const chunk = cellRecs.slice(i, i + CHUNK);
      const results = await Promise.allSettled(
        chunk.map((rec) => this.upsertCell(ctx, rec.payload as unknown as EvalRow, state)),
      );
      for (const r of results) {
        if (r.status === 'fulfilled') loaded++;
        else {
          failed++;
          ctx.log.error(`cell load failed: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
        }
      }
      if (i % (CHUNK * 40) === 0 && i > 0) {
        ctx.log.info(`progress: ${loaded.toLocaleString()} cells loaded so far`);
      }
    }
    state.loadedCells = loaded;

    return {
      recordsFetched: normalized.length,
      recordsLoaded: state.loadedQuestions + loaded,
      recordsFailed: failed,
      metadata: {
        connectorMode: 'real',
        capturedAt: state.capturedAt,
        yearFrom: state.yearFrom,
        totalBuckets: state.totalBuckets,
        questionsUpserted: state.loadedQuestions,
        cellsUpserted: loaded,
        unresolvedClassOfferings: state.unresolvedClassOfferings.size,
        unresolvedFacultyMembers: state.unresolvedFacultyMembers.size,
        unresolvedFaculties: [...state.unresolvedFaculties].sort((a, b) => a - b),
        notes:
          'Per-(class × question × instructor) cells with n>=5. ' +
          'questionTextEn populated by `pnpm evaluations:translate-questions` after this run.',
      },
    };
  }

  // ── private helpers ─────────────────────────────────────────────────

  private async upsertCell(
    _ctx: ConnectorContext,
    row: EvalRow,
    state: RunState,
  ): Promise<void> {
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

    const runId = (_ctx as { runId?: string }).runId;
    if (!runId) throw new Error('runId not present in context');

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
        // Resolution may improve between runs (a new ClassOffering or
        // FacultyMember row was added), so refresh the FKs each time.
        facultyId,
        classOfferingId,
        facultyMemberId,
        questionId,
        ratingAvg: row.RATING_AVG.toFixed(3),
        respondentCount: row.RESPONDENT_COUNT,
        lastUpdateAt: parseLastUpdate(row.LAST_UPDATE),
        ingestionRunId: runId,
        // Denormalized columns — refresh in case the source corrected
        // a course name typo or similar.
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
