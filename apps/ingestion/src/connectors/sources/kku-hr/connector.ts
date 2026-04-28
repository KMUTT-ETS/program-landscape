// ─────────────────────────────────────────────────────────────────────────────
// Real KkuHrConnector — flips kku-hr from mock to live.
//
// Wire-up:
//   - mssql (tedious) → HCMEmployee.dbo.EmployeeDetail on
//     10.101.104.192:1433 (encrypt=false; KKU internal network only)
//   - Cross-database JOIN to epm_report.dbo.workforce_hcm_actual via
//     COLLATE Thai_CI_AS clause (HCMEmployee uses Thai_CS_AI; epm_report
//     uses Thai_CI_AS — different collations)
//   - Cross-database lookup of epm_report.dbo.Faculty for BU code
//     decoding (run-metadata only — not used to JOIN since BU codes
//     are already keys)
//   - Q1 returns one row per active academic-staff employee (~2,569)
//     with names, position info, hashes, and BU keys
//   - Q2 returns aggregate compensation per (faculty × dept × rank ×
//     year) with HEADCOUNT >= 5 suppression at the source
//   - BU codes resolve to Faculty/Department FKs via HrOrgMapping
//     bridge — no fuzzy match, allowlist only
//
// Partial upsert: this connector touches only the FacultyMember
// columns it can authoritatively fill (employeeCode, nameTh, nameEn,
// rank, hireDate, retirementDate, isActive, dateOfBirth at year-
// precision, faculty/department FKs). `academicQualification` and
// `specialization` are deferred — the HCM mega-table doesn't expose
// degree info or research areas.
//
// PDPA: server-side projection guarantees the connector never reads
// citizen ID raw, passport, tax ID, social security, salary per-row,
// email, or contact phone. The two SQL queries are the only place
// this rule lives — review them carefully if you change either. The
// HR account is read-only.
// ─────────────────────────────────────────────────────────────────────────────

import { prisma, type FacultyRank, type PrismaClient } from '@kku/db';
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
  type MssqlConfig,
  query,
  withConnection,
} from '../../../lib/mssql-client';
import { positionLevelToFacultyRank } from './rank-mapping';
import {
  buildEmployeeCode,
  buildNameEn,
  buildNameTh,
  deriveIsActive,
  parseBirthYear,
  parseHcmDate,
  Q1RowSchema,
  type Q1Row,
  Q2RowSchema,
  type Q2Row,
  Q3RowSchema,
  type Q3Row,
} from './transforms';

// ─────────────────────────────────────────────────────────────────────────
// SQL queries — see docs/data-sources/kku-hr.md "Aggregation contract".
// COLLATE Thai_CI_AS on every cross-DB JOIN — different collations.
// ─────────────────────────────────────────────────────────────────────────

const Q1_FACULTY_MEMBERS = `
SELECT
  CONVERT(varchar(64), HASHBYTES('SHA2_256', CAST(e.EMPLOYEEID AS varbinary(500))), 2) AS EMPLOYEE_HASH,
  CASE WHEN e.ID_PEOPLE IS NULL OR e.ID_PEOPLE = ''
       THEN NULL
       ELSE CONVERT(varchar(64), HASHBYTES('SHA2_256', CAST(e.ID_PEOPLE AS varbinary(500))), 2)
  END                          AS PERSON_HASH,
  e.EMP_PREFIX, e.FNAME, e.LNAME, e.EFNAME, e.ELNAME,
  e.STATUS,
  LEFT(e.BIRTHDAY, 4)          AS BIRTH_YEAR,
  e.STARTDATE,
  e.RESIGNDATE,
  e.ENDWORKDATE,
  e.BU1, e.BU2, e.BU3, e.BU4,
  w.POSITION                   AS POSITION_TH,
  w.POSITION_LEVEL             AS POSITION_LEVEL_RAW,
  w.JOB_CODE                   AS JOB_CODE,
  w.All_Position_Types         AS POSITION_TYPE,
  w.JOB_FAMILY                 AS JOB_FAMILY
FROM dbo.EmployeeDetail e
INNER JOIN [epm_report].[dbo].[workforce_hcm_actual] w
  ON e.EMP_POSITION COLLATE Thai_CI_AS = w.POSITION_NUMBER COLLATE Thai_CI_AS
WHERE e.STATUS = 'A'
  AND w.All_Position_Types IN (N'วิชาการ', N'วิจัย')
`;

const Q2_COMPENSATION_AGGREGATE = `
SELECT
  e.BU1                                            AS FACULTY_KEY,
  CASE WHEN e.BU2 IS NULL OR e.BU2 = ''
       THEN NULL ELSE e.BU2 END                    AS DEPARTMENT_KEY,
  w.POSITION_LEVEL                                 AS POSITION_LEVEL_RAW,
  LEFT(e.STARTDATE, 4)                             AS START_YEAR,
  COUNT(*)                                         AS HEADCOUNT,
  SUM(TRY_CAST(e.SALARY AS decimal(18,2)))         AS SUM_SALARY,
  AVG(TRY_CAST(e.SALARY AS decimal(18,2)))         AS MEAN_SALARY,
  MIN(TRY_CAST(e.SALARY AS decimal(18,2)))         AS MIN_SALARY,
  MAX(TRY_CAST(e.SALARY AS decimal(18,2)))         AS MAX_SALARY
FROM dbo.EmployeeDetail e
INNER JOIN [epm_report].[dbo].[workforce_hcm_actual] w
  ON e.EMP_POSITION COLLATE Thai_CI_AS = w.POSITION_NUMBER COLLATE Thai_CI_AS
WHERE e.STATUS = 'A'
  AND w.All_Position_Types IN (N'วิชาการ', N'วิจัย')
  AND e.BU1 IS NOT NULL AND e.BU1 != ''
  AND w.POSITION_LEVEL IS NOT NULL AND w.POSITION_LEVEL != ''
  AND LEFT(e.STARTDATE, 4) LIKE '[12][0-9][0-9][0-9]'
GROUP BY e.BU1, e.BU2, w.POSITION_LEVEL, LEFT(e.STARTDATE, 4)
HAVING COUNT(*) >= 5
`;

const Q3_FACULTY_LOOKUP = `
SELECT DISTINCT
  Faculty       AS BU_CODE,
  Alias_Default AS LABEL_TH,
  Parent        AS PARENT
FROM [epm_report].[dbo].[Faculty]
ORDER BY Faculty
`;

// ─────────────────────────────────────────────────────────────────────────
// Per-run state — built up during fetch + transform, surfaced via
// load metadata. Lives on the instance because the runner calls fetch
// → transform[] → load on the same connector object (per-run, single-
// threaded — same pattern as kku-registry).
// ─────────────────────────────────────────────────────────────────────────

interface BuTotals {
  employeesByFaculty: Record<string, number>;
  unranked: number;
}

interface RunState {
  capturedAt: string;
  fetchTimestamp: Date;
  // hrCode → { facultyId | departmentId } from HrOrgMapping; batch-
  // loaded once at fetch start so transform doesn't hit Prisma per row.
  facultyMappings: Map<string, string>; // hrCode → facultyId
  departmentMappings: Map<string, string>; // hrCode → departmentId
  // Distinct hrCodes that we couldn't resolve to a Faculty/Department
  // FK — surfaced in IngestionRun.metadata.unmappedSamples for triage.
  unmappedFacultyCodes: Map<string, { hrLabel: string | null; recordCount: number }>;
  // Counts of skipped rows by reason.
  skippedNoFacultyMapping: number;
  skippedNoRank: number;
  // Totals.
  totals: BuTotals;
  // BU code → human label from epm_report.Faculty for run metadata.
  buLabelLookup: Map<string, string>;
}

interface HrRawData {
  kind: 'faculty_member';
  q1: Q1Row;
}

interface HrRawDataCompensation {
  kind: 'compensation';
  q2: Q2Row;
}

type HrRawPayload = HrRawData | HrRawDataCompensation;

export class KkuHrRealConnector extends ApiConnector {
  readonly slug = 'kku-hr';
  readonly mocked = false;

  private runState?: RunState;

  constructor(
    private readonly mssqlConfig: () => MssqlConfig = () => configFromEnv('KKU_HR_DB'),
    private readonly db: PrismaClient = prisma,
  ) {
    super();
  }

  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    try {
      await withConnection(this.mssqlConfig(), async (pool) => {
        await query(pool, 'SELECT 1 AS OK');
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

    // 1. Load HrOrgMapping once. Resolves BU codes to Faculty/Department
    //    FKs. Empty mapping = first-run state; every fetched row will
    //    land in unmappedSamples for analyst triage.
    const allMappings = await this.db.hrOrgMapping.findMany({
      where: { isResolved: true },
      select: {
        hrCode: true,
        hrOrgKind: true,
        facultyId: true,
        departmentId: true,
      },
    });
    const facultyMappings = new Map<string, string>();
    const departmentMappings = new Map<string, string>();
    for (const m of allMappings) {
      if (m.hrOrgKind === 'FACULTY' && m.facultyId) {
        facultyMappings.set(m.hrCode, m.facultyId);
      } else if (m.hrOrgKind === 'DEPARTMENT' && m.departmentId) {
        departmentMappings.set(m.hrCode, m.departmentId);
      }
    }
    ctx.log.info(
      `loaded HR org mappings: ${facultyMappings.size} faculty + ${departmentMappings.size} department`,
    );
    if (facultyMappings.size === 0) {
      ctx.log.warn(
        'HrOrgMapping is empty — every fetched employee will land in metadata.unmappedSamples for analyst triage. ' +
          'Run is still considered SUCCESS but will load 0 FacultyMember rows.',
      );
    }

    // 2. Run all three queries in one connection.
    const cfg = this.mssqlConfig();
    let q1Raw: unknown[] = [];
    let q2Raw: unknown[] = [];
    let q3Raw: unknown[] = [];
    await withConnection(cfg, async (pool) => {
      ctx.log.info('running Q3 Faculty lookup');
      q3Raw = await query(pool, Q3_FACULTY_LOOKUP);
      ctx.log.info(`Q3 returned ${q3Raw.length.toLocaleString()} rows`);

      ctx.log.info('running Q1 faculty-member projection');
      q1Raw = await query(pool, Q1_FACULTY_MEMBERS);
      ctx.log.info(`Q1 returned ${q1Raw.length.toLocaleString()} rows`);

      ctx.log.info('running Q2 compensation aggregate');
      q2Raw = await query(pool, Q2_COMPENSATION_AGGREGATE);
      ctx.log.info(`Q2 returned ${q2Raw.length.toLocaleString()} rows`);
    });

    // 3. Validate via Zod. Failure = connector bug; throw NonRetryable.
    const q1Rows = q1Raw.map((r, i): Q1Row => {
      const parsed = Q1RowSchema.safeParse(r);
      if (!parsed.success) {
        throw new NonRetryableError(
          'Q1_VALIDATION',
          `Q1 row ${i} failed validation: ${parsed.error.message}`,
        );
      }
      return parsed.data;
    });
    const q2Rows = q2Raw.map((r, i): Q2Row => {
      const parsed = Q2RowSchema.safeParse(r);
      if (!parsed.success) {
        throw new NonRetryableError(
          'Q2_VALIDATION',
          `Q2 row ${i} failed validation: ${parsed.error.message}`,
        );
      }
      return parsed.data;
    });
    const q3Rows = q3Raw.map((r, i): Q3Row => {
      const parsed = Q3RowSchema.safeParse(r);
      if (!parsed.success) {
        throw new NonRetryableError(
          'Q3_VALIDATION',
          `Q3 row ${i} failed validation: ${parsed.error.message}`,
        );
      }
      return parsed.data;
    });
    const buLabelLookup = new Map<string, string>();
    for (const r of q3Rows) {
      if (r.LABEL_TH) buLabelLookup.set(r.BU_CODE, r.LABEL_TH);
    }

    // 4. Initialise run state.
    this.runState = {
      capturedAt,
      fetchTimestamp,
      facultyMappings,
      departmentMappings,
      unmappedFacultyCodes: new Map(),
      skippedNoFacultyMapping: 0,
      skippedNoRank: 0,
      totals: { employeesByFaculty: {}, unranked: 0 },
      buLabelLookup,
    };

    // 5. Emit one RawRecord per Q1 row + one per Q2 row.
    const records: RawRecord[] = [];
    for (const q1 of q1Rows) {
      records.push({
        externalId: `kku-hr:fm:${q1.EMPLOYEE_HASH}`,
        sourceTimestamp: fetchTimestamp,
        data: { kind: 'faculty_member', q1 } satisfies HrRawPayload,
      });
    }
    for (const q2 of q2Rows) {
      const key = `${q2.FACULTY_KEY}|${q2.DEPARTMENT_KEY ?? ''}|${q2.POSITION_LEVEL_RAW ?? ''}|${q2.START_YEAR ?? ''}`;
      records.push({
        externalId: `kku-hr:comp:${key}`,
        sourceTimestamp: fetchTimestamp,
        data: { kind: 'compensation', q2 } satisfies HrRawPayload,
      });
    }
    return records;
  }

  async transform(
    _ctx: ConnectorContext,
    raw: RawRecord,
  ): Promise<NormalizedRecord[]> {
    const state = this.runState;
    if (!state) {
      throw new Error('transform() called before fetch() — connector lifecycle violated');
    }
    const data = raw.data as HrRawPayload;

    if (data.kind === 'faculty_member') {
      return this.transformFacultyMember(state, data.q1, raw.sourceTimestamp);
    }
    return this.transformCompensation(state, data.q2, raw.sourceTimestamp);
  }

  private transformFacultyMember(
    state: RunState,
    q1: Q1Row,
    freshnessDate: Date,
  ): NormalizedRecord[] {
    // Resolve faculty FK. BU1 is the canonical faculty key.
    const bu1 = q1.BU1?.trim() ?? '';
    if (!bu1) {
      state.skippedNoFacultyMapping++;
      return [];
    }
    const facultyId = state.facultyMappings.get(bu1);
    if (!facultyId) {
      state.skippedNoFacultyMapping++;
      const existing = state.unmappedFacultyCodes.get(bu1);
      if (existing) {
        existing.recordCount++;
      } else {
        state.unmappedFacultyCodes.set(bu1, {
          hrLabel: state.buLabelLookup.get(bu1) ?? null,
          recordCount: 1,
        });
      }
      return [];
    }

    // Department resolution is optional — null if unmapped (vs faculty
    // which is required). Try BU2 first, fall back to BU3 if BU2 maps.
    const bu2 = q1.BU2?.trim() ?? '';
    const bu3 = q1.BU3?.trim() ?? '';
    const departmentId =
      (bu2 && state.departmentMappings.get(bu2)) ||
      (bu3 && state.departmentMappings.get(bu3)) ||
      null;

    // Parse rank. If we can't, skip — FacultyRank is required.
    const rank = positionLevelToFacultyRank(q1.POSITION_LEVEL_RAW);
    if (!rank) {
      state.skippedNoRank++;
      state.totals.unranked++;
      return [];
    }

    // Build name fields. nameTh + nameEn fall back to the hash if
    // empty, so the FacultyMember row stays identifiable.
    const nameTh =
      buildNameTh(q1.EMP_PREFIX, q1.FNAME, q1.LNAME) ||
      `[unnamed:${q1.EMPLOYEE_HASH.slice(0, 8)}]`;
    const nameEn = buildNameEn(q1.EFNAME, q1.ELNAME);

    state.totals.employeesByFaculty[facultyId] =
      (state.totals.employeesByFaculty[facultyId] ?? 0) + 1;

    return [
      {
        target: 'faculty_members',
        externalId: `faculty_member:${q1.EMPLOYEE_HASH}`,
        payload: {
          facultyId,
          departmentId,
          employeeCode: buildEmployeeCode(q1.EMPLOYEE_HASH),
          nameTh,
          nameEn,
          rank,
          dateOfBirth: parseBirthYear(q1.BIRTH_YEAR),
          hireDate: parseHcmDate(q1.STARTDATE),
          retirementDate: parseHcmDate(q1.RESIGNDATE),
          isActive: deriveIsActive(q1.STATUS),
        },
        freshnessDate,
      },
    ];
  }

  private transformCompensation(
    state: RunState,
    q2: Q2Row,
    freshnessDate: Date,
  ): NormalizedRecord[] {
    const facultyId = state.facultyMappings.get(q2.FACULTY_KEY);
    if (!facultyId) {
      // Unmapped — skip silently; the Q1 path already tracks it.
      return [];
    }
    const departmentId =
      (q2.DEPARTMENT_KEY && state.departmentMappings.get(q2.DEPARTMENT_KEY)) ||
      null;
    const rank = positionLevelToFacultyRank(q2.POSITION_LEVEL_RAW);
    if (!rank) {
      // Unparseable rank cell — skip; Q1 already tracks unranked.
      return [];
    }
    const fiscalYear = q2.START_YEAR ? Number(q2.START_YEAR) : NaN;
    if (!Number.isInteger(fiscalYear) || fiscalYear < 1900 || fiscalYear > 2100) {
      return [];
    }
    return [
      {
        target: 'faculty_compensation',
        externalId: `faculty_compensation:${facultyId}:${departmentId ?? 'NA'}:${rank}:${fiscalYear}`,
        payload: {
          facultyId,
          departmentId,
          rank,
          fiscalYear,
          headcount: q2.HEADCOUNT,
          sumSalary: q2.SUM_SALARY,
          meanSalary: q2.MEAN_SALARY,
          minSalary: q2.MIN_SALARY,
          maxSalary: q2.MAX_SALARY,
        },
        freshnessDate,
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
    let loaded = 0;
    let failed = 0;

    for (const rec of normalized) {
      try {
        if (rec.target === 'faculty_members') {
          const p = rec.payload as {
            facultyId: string;
            departmentId: string | null;
            employeeCode: string;
            nameTh: string;
            nameEn: string;
            rank: FacultyRank;
            dateOfBirth: Date | null;
            hireDate: Date | null;
            retirementDate: Date | null;
            isActive: boolean;
          };
          await this.db.facultyMember.upsert({
            where: { employeeCode: p.employeeCode },
            create: {
              facultyId: p.facultyId,
              departmentId: p.departmentId ?? undefined,
              employeeCode: p.employeeCode,
              nameTh: p.nameTh,
              nameEn: p.nameEn,
              rank: p.rank,
              dateOfBirth: p.dateOfBirth ?? undefined,
              hireDate: p.hireDate ?? undefined,
              retirementDate: p.retirementDate ?? undefined,
              isActive: p.isActive,
            },
            update: {
              facultyId: p.facultyId,
              departmentId: p.departmentId,
              nameTh: p.nameTh,
              nameEn: p.nameEn,
              rank: p.rank,
              dateOfBirth: p.dateOfBirth,
              hireDate: p.hireDate,
              retirementDate: p.retirementDate,
              isActive: p.isActive,
            },
          });
          loaded++;
        } else if (rec.target === 'faculty_compensation') {
          const p = rec.payload as {
            facultyId: string;
            departmentId: string | null;
            rank: FacultyRank;
            fiscalYear: number;
            headcount: number;
            sumSalary: number;
            meanSalary: number;
            minSalary: number;
            maxSalary: number;
          };
          // Manual upsert because the compound-unique key includes a
          // nullable `departmentId`. Postgres treats NULL != NULL in
          // unique indexes, so Prisma's compound-key `where` doesn't
          // accept a null departmentId. findFirst → update | create
          // is the canonical workaround. Connector is single-threaded
          // so no race.
          const existing = await this.db.facultyCompensation.findFirst({
            where: {
              facultyId: p.facultyId,
              departmentId: p.departmentId,
              rank: p.rank,
              fiscalYear: p.fiscalYear,
            },
            select: { id: true },
          });
          if (existing) {
            await this.db.facultyCompensation.update({
              where: { id: existing.id },
              data: {
                headcount: p.headcount,
                sumSalary: p.sumSalary,
                meanSalary: p.meanSalary,
                minSalary: p.minSalary,
                maxSalary: p.maxSalary,
                freshnessDate: rec.freshnessDate,
                methodologyVersion: 'kku-hr.v1',
              },
            });
          } else {
            await this.db.facultyCompensation.create({
              data: {
                facultyId: p.facultyId,
                departmentId: p.departmentId,
                rank: p.rank,
                fiscalYear: p.fiscalYear,
                headcount: p.headcount,
                sumSalary: p.sumSalary,
                meanSalary: p.meanSalary,
                minSalary: p.minSalary,
                maxSalary: p.maxSalary,
                freshnessDate: rec.freshnessDate,
                methodologyVersion: 'kku-hr.v1',
              },
            });
          }
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

    // Top-N unmapped BU codes for run metadata.
    const unmappedSamples = [...state.unmappedFacultyCodes.entries()]
      .map(([hrCode, info]) => ({ hrCode, hrLabel: info.hrLabel, recordCount: info.recordCount }))
      .sort((a, b) => b.recordCount - a.recordCount)
      .slice(0, 50);

    return {
      recordsFetched: normalized.length,
      recordsLoaded: loaded,
      recordsFailed: failed,
      metadata: {
        connectorMode: 'real',
        capturedAt: state.capturedAt,
        mappingTableRowCount:
          state.facultyMappings.size + state.departmentMappings.size,
        skippedNoFacultyMapping: state.skippedNoFacultyMapping,
        skippedNoRank: state.skippedNoRank,
        unmappedFacultyCodesCount: state.unmappedFacultyCodes.size,
        unmappedSamples,
        notes:
          'kku-hr.v1: Q1 produces FacultyMember rows for active วิชาการ + วิจัย employees ' +
          'with parseable POSITION_LEVEL ranks. Q2 produces aggregate FacultyCompensation ' +
          'with HEADCOUNT >= 5 suppression at the source. PII columns never in projection.',
      },
    };
  }
}
