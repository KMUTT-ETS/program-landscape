// ────────────────────────────────────────────────────────────────────────
// KkuDqRealConnector — KKU Digital Intelligence (DQ) student scores.
//
// One GET returns every student (24,776 / 13.7 MB / ~3.4 s), so there is
// no pagination. Students are resolved to a program IN MEMORY and only
// aggregates are written: the payload carries firstname/lastname and
// neither those nor the student id ever reach the database, the logs or
// disk. Same aggregate-at-source posture as kku-hr and kku-registry.
//
// Resolution: hashCitizenId(studentId) → student_program_record
// .student_code_hash → program_id. Measured coverage is cohort-shaped
// (BE 65-68 ≈ 81-90%, BE 64 and older ≈ 7-15%) because that table is an
// AY 2568 enrolment snapshot while this export is cumulative. Unresolved
// students are NOT dropped — they land under a null programId, which the
// dashboard renders as "Program not identified".
//
// Counting rules (a score of 0 means NOT TAKEN) live in ./transforms.ts;
// this file must not re-implement them.
// ────────────────────────────────────────────────────────────────────────

import { prisma, type Prisma, type PrismaClient } from '@kku/db';
import {
  DQ_PASS_MARK,
  cohortFromStudentId,
  hashCitizenId,
  normaliseDqFaculty,
  type ConnectorContext,
  type HealthStatus,
  type LoadResult,
  type NormalizedRecord,
  type RawRecord,
} from '@kku/shared';

import { ApiConnector } from '../../base/api-connector';
import { NonRetryableError } from '../../base/base-connector';
import {
  DqExportItemSchema,
  DqExportResponseSchema,
  accumulate,
  emptyAccumulator,
  type DqAccumulator,
  type DqExportItem,
} from './transforms';

const EXPORT_PATH = '/export/student-scores';
const DEFAULT_TIMEOUT_MS = 120_000;

// Postgres caps a statement at 65,535 bound parameters; the module cube
// binds 12 columns per row, so 2,000 rows/statement leaves ample room.
const INSERT_CHUNK = 2_000;

interface RunState {
  fetchTimestamp: Date;
  fetched: number;
  parsed: number;
  parseFailed: number;
  /** Items the source flags `hasResult`. Strictly wider than `withScores`:
   *  a result can exist and carry no module payload at all. */
  withResult: number;
  withScores: number;
  matchedProgram: number;
  unmatchedFacultyNames: Set<string>;
  unmatchedFacultyStudents: number;
  allPassedInconsistent: number;
  acc: DqAccumulator;
}

// The export sends `hasResult` / `allPassed` as null (not absent) for
// students with no result. That is absorbed by `DqExportItemSchema`
// itself — see the note there; this connector does no pre-normalisation.

/** Diagnostic counter maps → the biggest-first list the run reports. */
function topCounts(counter: ReadonlyMap<string, number>, limit: number): Record<string, number> {
  return Object.fromEntries(
    [...counter.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit),
  );
}

function chunk<T>(rows: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export class KkuDqRealConnector extends ApiConnector {
  readonly slug = 'kku-dq';
  readonly mocked = false;

  private runState?: RunState;

  constructor(private readonly db: PrismaClient = prisma) {
    super();
  }

  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    // Presence check only — the export is a single 13.7 MB response, so a
    // "real" probe would double the transfer for no extra signal.
    if (!process.env['DQ_API_BASE_URL']) {
      return { ok: false, message: 'DQ_API_BASE_URL is not set' };
    }
    if (!process.env['DQ_API_TOKEN']) {
      return { ok: false, message: 'DQ_API_TOKEN is not set' };
    }
    return Promise.resolve({ ok: true });
  }

  async fetch(ctx: ConnectorContext, _since?: Date): Promise<RawRecord[]> {
    const base = process.env['DQ_API_BASE_URL'];
    const token = process.env['DQ_API_TOKEN'];
    if (!base || !token) {
      throw new NonRetryableError(
        'DQ_NOT_CONFIGURED',
        'DQ_API_BASE_URL / DQ_API_TOKEN not configured',
      );
    }
    const timeoutMs = Number(process.env['DQ_API_REQUEST_TIMEOUT_MS']) || DEFAULT_TIMEOUT_MS;
    const fetchTimestamp = new Date();

    const payload = await this.fetchExport(ctx, base, token, timeoutMs);
    const envelope = DqExportResponseSchema.parse(payload);
    ctx.log.info(`DQ export returned ${envelope.items.length.toLocaleString()} items`);

    const state: RunState = {
      fetchTimestamp,
      fetched: envelope.items.length,
      parsed: 0,
      parseFailed: 0,
      withResult: 0,
      withScores: 0,
      matchedProgram: 0,
      unmatchedFacultyNames: new Set<string>(),
      unmatchedFacultyStudents: 0,
      allPassedInconsistent: 0,
      acc: emptyAccumulator(),
    };

    // Validate once into a single typed array. `envelope.items` drops out
    // of scope at the end of fetch(); nothing person-identifying survives
    // past the aggregation loop below.
    const items: DqExportItem[] = [];
    for (const raw of envelope.items) {
      const parsed = DqExportItemSchema.safeParse(raw);
      if (parsed.success) items.push(parsed.data);
      else state.parseFailed += 1;
    }
    state.parsed = items.length;
    if (state.parseFailed > 0) {
      // Count only — a rejected record must never be logged, it carries a name.
      ctx.log.warn(`${state.parseFailed} export items failed schema validation and were skipped`);
    }

    // Batch the hash lookups: 24,776 per-student round-trips would
    // dominate the run.
    const hashes = items
      .map((i) => hashCitizenId(i.studentId))
      .filter((h): h is string => h !== null);
    const records = await this.db.studentProgramRecord.findMany({
      where: { studentCodeHash: { in: hashes }, programId: { not: null } },
      select: { studentCodeHash: true, programId: true },
    });
    const programIdByHash = new Map<string, string>();
    for (const r of records) {
      if (r.studentCodeHash && r.programId) programIdByHash.set(r.studentCodeHash, r.programId);
    }
    ctx.log.info(
      `resolved ${programIdByHash.size.toLocaleString()} distinct student hashes to a program`,
    );

    const programs = await this.db.program.findMany({
      select: { id: true, nameTh: true, nameEn: true },
    });
    const programById = new Map(programs.map((p) => [p.id, p]));
    const faculties = await this.db.faculty.findMany({ select: { id: true, nameTh: true } });
    const facultyIdByName = new Map(faculties.map((f) => [f.nameTh, f.id]));

    for (const item of items) {
      const facultyName = normaliseDqFaculty(item.faculty);
      const facultyId = facultyIdByName.get(facultyName) ?? null;
      if (!facultyId) {
        state.unmatchedFacultyNames.add(facultyName);
        state.unmatchedFacultyStudents += 1;
      }

      const hash = hashCitizenId(item.studentId);
      const programId = hash ? (programIdByHash.get(hash) ?? null) : null;
      if (programId) state.matchedProgram += 1;
      const program = programId ? programById.get(programId) : undefined;

      // Two distinct populations, and the gap between them is the point:
      // `hasResult` says the student has a result on file, the payload
      // says whether that result carries any module scores. Reporting
      // only the second leaves "tested minus scored" to be read as one
      // group when it is two — students with no result at all, and
      // students whose result is empty.
      if (item.hasResult) state.withResult += 1;
      if (Object.keys(item.modules ?? {}).length > 0) state.withScores += 1;

      // Track the source's self-contradiction so the dashboard can state
      // its size instead of the reader discovering it.
      const m13 = item.modules?.['THEORY_MODULE_13'];
      if (item.allPassed && typeof m13 === 'number' && m13 > 0 && m13 < DQ_PASS_MARK) {
        state.allPassedInconsistent += 1;
      }

      accumulate(state.acc, item, {
        facultyName,
        facultyId,
        programId,
        programName: program ? (program.nameTh || program.nameEn) : null,
        cohortYearBe: cohortFromStudentId(item.studentId),
      });
    }

    // A score key the framework does not know would otherwise be dropped
    // by `accumulate` without a trace. Say it out loud: module 13 arrived
    // unannounced once already and skewed every mean until someone found
    // it. Keys only — these are module names, never student data.
    if (state.acc.unknownModuleKeys.size > 0) {
      ctx.log.warn(
        `DQ export carries ${state.acc.unknownModuleKeys.size} module key(s) the framework ` +
          `does not know: ${[...state.acc.unknownModuleKeys.keys()].sort().slice(0, 20).join(', ')} ` +
          `— add them to DQ_MODULES in @kku/shared or they stay out of every cube`,
      );
    }
    if (state.acc.outOfRangeScores.size > 0) {
      const total = [...state.acc.outOfRangeScores.values()].reduce((a, b) => a + b, 0);
      ctx.log.warn(
        `${total} module score(s) fell outside 0-100 and were skipped ` +
          `(affected modules: ${[...state.acc.outOfRangeScores.keys()].sort().join(', ')})`,
      );
    }

    this.runState = state;
    ctx.log.info(
      `aggregated ${state.parsed.toLocaleString()} students into ` +
        `${state.acc.students.size.toLocaleString()} student-cube rows and ` +
        `${state.acc.modules.size.toLocaleString()} module-cube rows`,
    );

    // The accumulator IS the payload from here on. Returning a single
    // marker record keeps the framework's fetch → transform → load shape
    // without building a second 24,776-element array (the double-buffer
    // that froze the evaluations worker).
    return [{ externalId: 'kku-dq:batch', data: { marker: true }, sourceTimestamp: fetchTimestamp }];
  }

  async transform(_ctx: ConnectorContext, _raw: RawRecord): Promise<NormalizedRecord[]> {
    const state = this.runState;
    if (!state) {
      throw new NonRetryableError(
        'LIFECYCLE',
        'transform() called before fetch() — connector lifecycle violated',
      );
    }
    return [
      {
        target: 'dq_student_cube',
        externalId: 'kku-dq:batch',
        payload: { marker: true, students: state.acc.students.size, modules: state.acc.modules.size },
        freshnessDate: state.fetchTimestamp,
      },
    ];
  }

  async load(ctx: ConnectorContext, _normalized: NormalizedRecord[]): Promise<LoadResult> {
    const state = this.runState;
    if (!state) {
      throw new NonRetryableError(
        'LIFECYCLE',
        'load() called before fetch() — connector lifecycle violated',
      );
    }
    const ingestionRunId = ctx.runId;

    const students = [...state.acc.students.values()].map((r) => ({ ...r, ingestionRunId }));
    const modules = [...state.acc.modules.values()].map((r) => ({ ...r, ingestionRunId }));

    // Replace wholesale in one transaction: the cube is a snapshot, and a
    // half-replaced cube would read as a real collapse in student numbers.
    const ops: Prisma.PrismaPromise<unknown>[] = [
      this.db.dqStudentCube.deleteMany({}),
      this.db.dqModuleCube.deleteMany({}),
      ...chunk(students, INSERT_CHUNK).map((data) => this.db.dqStudentCube.createMany({ data })),
      ...chunk(modules, INSERT_CHUNK).map((data) => this.db.dqModuleCube.createMany({ data })),
    ];
    await this.db.$transaction(ops);

    ctx.log.info(
      `replaced cubes: ${students.length.toLocaleString()} student rows, ` +
        `${modules.length.toLocaleString()} module rows`,
    );

    const matchRatePct =
      state.parsed > 0 ? Math.round((1000 * state.matchedProgram) / state.parsed) / 10 : 0;

    const result: LoadResult = {
      recordsFetched: state.fetched,
      recordsLoaded: students.length + modules.length,
      recordsFailed: state.parseFailed,
      metadata: {
        connectorMode: 'real',
        capturedAt: state.fetchTimestamp.toISOString(),
        studentsFetched: state.fetched,
        studentsParsed: state.parsed,
        studentsParseFailed: state.parseFailed,
        studentsWithResult: state.withResult,
        studentsWithScores: state.withScores,
        studentsMatchedProgram: state.matchedProgram,
        programMatchRatePct: matchRatePct,
        unmatchedFacultyStudents: state.unmatchedFacultyStudents,
        unmatchedFacultyNames: [...state.unmatchedFacultyNames].sort().slice(0, 50),
        allPassedInconsistent: state.allPassedInconsistent,
        // Same posture as kku-research's unmatchedAuthorSamples and
        // kmitl's unmappedSkillSamples: a sized, capped worklist rather
        // than a silent drop. Both are counts by key, biggest first.
        unknownModuleKeyCount: state.acc.unknownModuleKeys.size,
        unknownModuleKeySamples: topCounts(state.acc.unknownModuleKeys, 20),
        outOfRangeScoreCount: [...state.acc.outOfRangeScores.values()].reduce((a, b) => a + b, 0),
        outOfRangeScoresByModule: topCounts(state.acc.outOfRangeScores, 20),
        studentCubeRows: students.length,
        moduleCubeRows: modules.length,
        notes:
          'Aggregate-only: no student name or id is persisted. A module score of 0 means ' +
          'NOT TAKEN and is excluded from takenCount/scoreSum. `allPassed` is the source’s ' +
          'own verdict, passed through unchanged — allPassedInconsistent sizes its ' +
          'module-13 contradiction. Program match is cohort-shaped: student_program_record ' +
          'is an AY 2568 enrolment snapshot while this export is cumulative. ' +
          'unknownModuleKeySamples lists score keys absent from DQ_MODULES — they are in no ' +
          'cube until the framework table is extended; outOfRangeScoresByModule lists scores ' +
          'outside 0-100, which are skipped rather than averaged in.',
      },
    };

    this.runState = undefined;
    return result;
  }

  // ── private helpers ───────────────────────────────────────────────────

  /** One GET of the whole export. Never writes the body anywhere. */
  private async fetchExport(
    ctx: ConnectorContext,
    base: string,
    token: string,
    timeoutMs: number,
  ): Promise<unknown> {
    const url = `${base.replace(/\/+$/, '')}${EXPORT_PATH}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      ctx.log.info(`GET ${url} (timeout ${timeoutMs} ms)`);
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (res.status === 401 || res.status === 403) {
        // A rejected token is a configuration fix, not a transient blip —
        // do not burn BullMQ retries on it.
        throw new NonRetryableError(
          'DQ_UNAUTHORIZED',
          `DQ export rejected the token (HTTP ${res.status})`,
        );
      }
      if (!res.ok) throw new Error(`DQ export failed: HTTP ${res.status}`);
      return (await res.json()) as unknown;
    } finally {
      clearTimeout(timer);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────
// Mock. This source is real from day one — there is no sample dataset and
// fabricating DQ scores would violate the no-mock-data policy. The
// registry's ConnectorEntry requires a `mock` factory, so this is a
// deliberate no-op that loads nothing rather than a weakening of that
// type. Running it is always a configuration mistake, hence the warn.
// ────────────────────────────────────────────────────────────────────────
export class KkuDqConnector extends ApiConnector {
  readonly slug = 'kku-dq';
  readonly mocked = true;

  override healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    return Promise.resolve({
      ok: true,
      message: 'mocked — kku-dq has no sample data; set CONNECTOR_KKU_DQ_MODE=real',
    });
  }

  fetch(ctx: ConnectorContext, _since?: Date): Promise<RawRecord[]> {
    ctx.log.warn('kku-dq mock produces no records — set CONNECTOR_KKU_DQ_MODE=real');
    return Promise.resolve([]);
  }

  transform(_ctx: ConnectorContext, _raw: RawRecord): Promise<NormalizedRecord[]> {
    return Promise.resolve([]);
  }

  load(_ctx: ConnectorContext, _normalized: NormalizedRecord[]): Promise<LoadResult> {
    return Promise.resolve({
      recordsFetched: 0,
      recordsLoaded: 0,
      recordsFailed: 0,
      metadata: { connectorMode: 'mocked', notes: 'No sample data for kku-dq by design.' },
    });
  }
}
