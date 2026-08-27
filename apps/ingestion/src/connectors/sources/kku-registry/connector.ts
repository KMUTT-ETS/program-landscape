// ────────────────────────────────────────────────────────────────────────────
// Real KkuRegistryConnector — flips kku-registry from mock to live.
//
// Wire-up:
//   - oracledb (thin) → POWERBI views on the registrar Oracle warehouse
//     (host/service/user from KKU_REGISTRY_DB_*)
//   - SQL aggregates server-side; raw rows never leave the result set
//   - Q1 returns status counts per (program × cohort × status)
//   - Q2 returns demographic histograms per (program × cohort × demo)
//   - Bucketing into our funnel happens in TS (status-mapping.ts)
//   - Programs match through the RegistryProgramMapping bridge table —
//     no fuzzy match, no LIKE; mapping rows are the allowlist
//
// Partial upsert: this connector touches only `enrolled`, `dropouts`,
// `graduatedOnTime` (approximation). `applications`, `admitted`,
// `retainedYear2`, `graduatedLate` are deferred to TCAS / future
// graduation-date sourcing — they keep their existing seed value when
// updating an existing row, and default to 0 sentinel on create.
//
// PDPA: server-side GROUP BY guarantees the connector never receives
// citizen IDs, names, or contact info. The two SQL queries are the
// only place this rule lives — review them carefully if you change
// either. The `powerbi` Oracle account is read-only.
// ────────────────────────────────────────────────────────────────────────────

import { prisma, type PrismaClient } from '@kku/db';
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
  buddhistToCommonEra,
  buildBreakdown,
  type DemographicBreakdown,
  type MappingKey,
  mappingKeyToString,
  normaliseMappingKey,
  Q1RowSchema,
  type Q1Row,
  Q2RowSchema,
  type Q2Row,
  rollupFunnel,
} from './transforms';

// ────────────────────────────────────────────────────────────────────────
// SQL queries — see docs/data-sources/kku-registry.md "Aggregation
// contract" for the rationale and column rationales.
// ────────────────────────────────────────────────────────────────────────

const Q1_STATUS_COUNTS = `
SELECT
  FACULTYNAME                AS FACULTY_NAME,
  PROGRAMNAME                AS PROGRAM_NAME,
  PROGRAMLEVEL               AS PROGRAM_LEVEL,
  MAJOR                      AS MAJOR,
  ADMITACADYEAR              AS COHORT_YEAR_BE,
  STUDENTSTATUS              AS STATUS,
  STUDENTSTATUSCODE          AS STATUS_CODE,
  COUNT(*)                   AS N
FROM POWERBI.VIEW_STUDENT_DETAIL_ALL
WHERE FACULTYNAME IS NOT NULL AND PROGRAMNAME IS NOT NULL
GROUP BY
  FACULTYNAME, PROGRAMNAME, PROGRAMLEVEL, MAJOR, ADMITACADYEAR,
  STUDENTSTATUS, STUDENTSTATUSCODE
`;

const Q2_DEMOGRAPHIC_BUCKETS = `
SELECT
  FACULTYNAME                AS FACULTY_NAME,
  PROGRAMNAME                AS PROGRAM_NAME,
  PROGRAMLEVEL               AS PROGRAM_LEVEL,
  MAJOR                      AS MAJOR,
  ADMITACADYEAR              AS COHORT_YEAR_BE,
  STUDENTSEX                 AS GENDER,
  HOMEPROVINCENAME           AS HOME_PROVINCE,
  NATIONNAME                 AS NATION,
  COUNT(*)                   AS N
FROM POWERBI.VIEW_STUDENT_DETAIL_ALL
WHERE FACULTYNAME IS NOT NULL AND PROGRAMNAME IS NOT NULL
GROUP BY
  FACULTYNAME, PROGRAMNAME, PROGRAMLEVEL, MAJOR, ADMITACADYEAR,
  STUDENTSEX, HOMEPROVINCENAME, NATIONNAME
`;

// ────────────────────────────────────────────────────────────────────────
// Per-run state — built up during fetch + transform, surfaced via load
// metadata. Lives on the instance because the runner calls fetch →
// transform[] → load on the same connector object.
// ────────────────────────────────────────────────────────────────────────

interface BucketTotals {
  GRADUATED: number;
  ACTIVE: number;
  DROPOUT: number;
  NEVER_ENROLLED: number;
  UNCATEGORISED: number;
}

interface RunState {
  capturedAt: string;
  fetchTimestamp: Date;
  // (faculty | program | level | major) → programId, batch-loaded once
  // from the bridge table so transform doesn't hit Prisma per record.
  mappingLookup: Map<string, string>;
  // Tuples that fetched data but had no mapping row. The list goes
  // into IngestionRun.metadata for triage. Capped at 50 samples but
  // we still report the total count.
  rejectedTuples: { tupleKey: string; cohortYearBE: number; recordCount: number }[];
  // Status codes not in STATUS_BUCKET_MAP — the analyst adds them in
  // a follow-up commit.
  unknownStatusCodes: Set<number>;
  // Bucket totals across the run, for sanity-checking against last run.
  statusBucketTotals: BucketTotals;
}

interface RegistryRawData {
  mappingKey: MappingKey;
  cohortYearBE: number;
  q1: Q1Row[];
  q2: Q2Row[];
}

export class KkuRegistryRealConnector extends ApiConnector {
  readonly slug = 'kku-registry';
  readonly mocked = false;

  private runState?: RunState;

  constructor(
    private readonly oracleConfig: () => OracleConfig = () => configFromEnv('KKU_REGISTRY_DB'),
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

    // 1. Run both queries in one Oracle connection.
    const cfg = this.oracleConfig();
    let q1Raw: unknown[] = [];
    let q2Raw: unknown[] = [];
    await withConnection(cfg, async (conn) => {
      ctx.log.info('running Q1 status counts');
      q1Raw = await query(conn, Q1_STATUS_COUNTS);
      ctx.log.info(`Q1 returned ${q1Raw.length.toLocaleString()} rows`);

      ctx.log.info('running Q2 demographic histograms');
      q2Raw = await query(conn, Q2_DEMOGRAPHIC_BUCKETS);
      ctx.log.info(`Q2 returned ${q2Raw.length.toLocaleString()} rows`);
    });

    // 2. Validate via Zod. Validation failure = connector bug, not
    // transient — fail loudly without retrying.
    const q1Rows = q1Raw.map((r, i): Q1Row => {
      const result = Q1RowSchema.safeParse(r);
      if (!result.success) {
        throw new NonRetryableError(
          'Q1_VALIDATION',
          `Q1 row ${i} failed schema validation: ${result.error.message}`,
        );
      }
      return result.data;
    });
    const q2Rows = q2Raw.map((r, i): Q2Row => {
      const result = Q2RowSchema.safeParse(r);
      if (!result.success) {
        throw new NonRetryableError(
          'Q2_VALIDATION',
          `Q2 row ${i} failed schema validation: ${result.error.message}`,
        );
      }
      return result.data;
    });

    // 3. Group by (faculty, program, level, major, cohort) tuple. Each
    // tuple becomes one RawRecord — its data carries the matching Q1
    // status rows and Q2 demographic rows for that tuple.
    const tuples = new Map<string, RegistryRawData>();
    for (const row of q1Rows) {
      const tk = tupleKey(row);
      let entry = tuples.get(tk);
      if (!entry) {
        entry = {
          mappingKey: normaliseMappingKey(row),
          cohortYearBE: row.COHORT_YEAR_BE,
          q1: [],
          q2: [],
        };
        tuples.set(tk, entry);
      }
      entry.q1.push(row);
    }
    for (const row of q2Rows) {
      const tk = tupleKey(row);
      let entry = tuples.get(tk);
      if (!entry) {
        entry = {
          mappingKey: normaliseMappingKey(row),
          cohortYearBE: row.COHORT_YEAR_BE,
          q1: [],
          q2: [],
        };
        tuples.set(tk, entry);
      }
      entry.q2.push(row);
    }

    // 4. Batch-load the mapping table once so transform() doesn't hit
    // Prisma per record. ~hundreds of rows, plenty memory-efficient.
    const allMappings = await this.db.registryProgramMapping.findMany({
      select: {
        registryFacultyName: true,
        registryProgramName: true,
        registryLevel: true,
        registryMajor: true,
        programId: true,
      },
    });
    const mappingLookup = new Map<string, string>();
    for (const m of allMappings) {
      mappingLookup.set(
        mappingKeyToString({
          registryFacultyName: m.registryFacultyName,
          registryProgramName: m.registryProgramName,
          registryLevel: m.registryLevel,
          registryMajor: m.registryMajor,
        }),
        m.programId,
      );
    }
    ctx.log.info(`loaded ${mappingLookup.size.toLocaleString()} program mappings`);
    if (mappingLookup.size === 0) {
      ctx.log.warn(
        'RegistryProgramMapping is empty — every fetched tuple will land in metadata.unmappedSamples for analyst triage. ' +
          'Run is still considered SUCCESS but will load 0 metric rows.',
      );
    }

    // 5. Initialise run state.
    this.runState = {
      capturedAt,
      fetchTimestamp,
      mappingLookup,
      rejectedTuples: [],
      unknownStatusCodes: new Set(),
      statusBucketTotals: {
        GRADUATED: 0,
        ACTIVE: 0,
        DROPOUT: 0,
        NEVER_ENROLLED: 0,
        UNCATEGORISED: 0,
      },
    };

    // 6. Emit one RawRecord per tuple. The runner then calls transform
    // once per RawRecord.
    return [...tuples.entries()].map(([tk, data]) => ({
      externalId: `kku-registry:${tk}`,
      sourceTimestamp: fetchTimestamp,
      data,
    }));
  }

  async transform(
    _ctx: ConnectorContext,
    raw: RawRecord,
  ): Promise<NormalizedRecord[]> {
    const state = this.runState;
    if (!state) {
      throw new Error('transform() called before fetch() — connector lifecycle violated');
    }

    const data = raw.data as RegistryRawData;
    const { mappingKey, cohortYearBE, q1, q2 } = data;

    const programId = state.mappingLookup.get(mappingKeyToString(mappingKey));
    if (!programId) {
      const recordCount = q1.reduce((s, r) => s + r.N, 0);
      // Cap surfaced samples at 50 to keep IngestionRun.metadata small;
      // a count is always reported.
      if (state.rejectedTuples.length < 50) {
        state.rejectedTuples.push({
          tupleKey: mappingKeyToString(mappingKey),
          cohortYearBE,
          recordCount,
        });
      } else {
        // Just bump count; we already have 50 samples.
        state.rejectedTuples.push({ tupleKey: '...truncated...', cohortYearBE, recordCount });
      }
      return [];
    }

    const cohortYear = buddhistToCommonEra(cohortYearBE);
    const funnel = rollupFunnel(q1);

    // Tally bucket totals + unknown codes for run metadata.
    state.statusBucketTotals.GRADUATED += funnel.graduatedTotal;
    state.statusBucketTotals.ACTIVE += funnel.active;
    state.statusBucketTotals.DROPOUT += funnel.dropouts;
    state.statusBucketTotals.NEVER_ENROLLED += funnel.neverEnrolled;
    state.statusBucketTotals.UNCATEGORISED += funnel.uncategorised;
    for (const c of funnel.unknownStatusCodes) state.unknownStatusCodes.add(c);

    const breakdown = buildBreakdown(q2, state.capturedAt);

    const records: NormalizedRecord[] = [];

    // EnrollmentMetric — partial. applications/admitted/retainedYear2/
    // graduatedLate are sentinel-zero on create; left untouched on
    // update so existing seed/TCAS values survive.
    records.push({
      target: 'enrollment_metrics',
      externalId: `enrollment:${programId}:${cohortYear}`,
      payload: {
        programId,
        academicYear: cohortYear,
        enrolled: funnel.enrolled,
        graduatedOnTime: funnel.graduatedTotal,
        dropouts: funnel.dropouts,
      },
      freshnessDate: state.fetchTimestamp,
    });

    // StudentDemographic — full upsert (registry is the authoritative
    // source for these histograms).
    if (q2.length > 0) {
      records.push({
        target: 'student_demographics',
        externalId: `demographics:${programId}:${cohortYear}`,
        payload: {
          programId,
          academicYear: cohortYear,
          breakdownJson: breakdown,
        },
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

    let loaded = 0;
    let failed = 0;

    for (const rec of normalized) {
      try {
        if (rec.target === 'enrollment_metrics') {
          const p = rec.payload as {
            programId: string;
            academicYear: number;
            enrolled: number;
            graduatedOnTime: number;
            dropouts: number;
          };
          await this.db.enrollmentMetric.upsert({
            where: {
              programId_academicYear: {
                programId: p.programId,
                academicYear: p.academicYear,
              },
            },
            create: {
              programId: p.programId,
              academicYear: p.academicYear,
              // Sentinel zeros — TCAS / future graduation-date session fills.
              applications: 0,
              admitted: 0,
              retainedYear2: 0,
              graduatedLate: 0,
              // Authoritative from registrar:
              enrolled: p.enrolled,
              graduatedOnTime: p.graduatedOnTime,
              dropouts: p.dropouts,
              freshnessDate: rec.freshnessDate,
              methodologyVersion: 'kku-registry.v1',
              ingestionRunId: ctx.runId,
            },
            update: {
              // Partial — applications/admitted/retainedYear2/graduatedLate
              // are deliberately omitted so existing seed/TCAS values
              // survive. See `metadata.deferredFields` in the run record.
              enrolled: p.enrolled,
              graduatedOnTime: p.graduatedOnTime,
              dropouts: p.dropouts,
              freshnessDate: rec.freshnessDate,
              methodologyVersion: 'kku-registry.v1',
              ingestionRunId: ctx.runId,
            },
          });
          loaded++;
        } else if (rec.target === 'student_demographics') {
          const p = rec.payload as {
            programId: string;
            academicYear: number;
            breakdownJson: DemographicBreakdown;
          };
          await this.db.studentDemographic.upsert({
            where: {
              programId_academicYear: {
                programId: p.programId,
                academicYear: p.academicYear,
              },
            },
            create: {
              programId: p.programId,
              academicYear: p.academicYear,
              breakdownJson: p.breakdownJson as unknown as object,
              freshnessDate: rec.freshnessDate,
              ingestionRunId: ctx.runId,
            },
            update: {
              breakdownJson: p.breakdownJson as unknown as object,
              freshnessDate: rec.freshnessDate,
              ingestionRunId: ctx.runId,
            },
          });
          loaded++;
        } else {
          ctx.log.warn(`unknown target "${rec.target}", skipping`);
          failed++;
        }
      } catch (err) {
        failed++;
        ctx.log.error(
          `failed to load ${rec.target}/${rec.externalId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const totalUnmappedTuples = state.rejectedTuples.length;
    const totalUnmappedStudents = state.rejectedTuples.reduce(
      (s, r) => s + r.recordCount,
      0,
    );
    // First 50 unmapped sample tuples — the analyst uses this to add
    // mapping rows. After 50, we just report the count.
    const unmappedSamples = state.rejectedTuples.slice(0, 50);

    return {
      recordsFetched: normalized.length,
      recordsLoaded: loaded,
      recordsFailed: failed,
      metadata: {
        connectorMode: 'real',
        capturedAt: state.capturedAt,
        statusBucketTotals: state.statusBucketTotals,
        mappingTableRowCount: state.mappingLookup.size,
        unmappedTuplesCount: totalUnmappedTuples,
        unmappedStudentCount: totalUnmappedStudents,
        unmappedSamples,
        unknownStatusCodes: [...state.unknownStatusCodes].sort((a, b) => a - b),
        // Documented in docs/data-sources/kku-registry.md — these
        // columns of EnrollmentMetric are not authoritative from this
        // source. TCAS / graduation-date sourcing fills them later.
        deferredFields: ['applications', 'admitted', 'retainedYear2', 'graduatedLate'],
        notes:
          'Partial upsert. applications/admitted come from TCAS; ' +
          'retainedYear2/graduatedLate require graduation-date data not present in registrar views.',
      },
    };
  }
}

function tupleKey(row: {
  FACULTY_NAME: string;
  PROGRAM_NAME: string;
  PROGRAM_LEVEL: string | null;
  MAJOR: string | null;
  COHORT_YEAR_BE: number;
}): string {
  return `${mappingKeyToString(normaliseMappingKey(row))}|${row.COHORT_YEAR_BE}`;
}
