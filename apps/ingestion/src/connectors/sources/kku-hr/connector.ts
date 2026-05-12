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
  computeRetirementDateFromBirth,
  deriveIsActive,
  parseHcmDate,
  Q1RowSchema,
  type Q1Row,
  Q2RowSchema,
  type Q2Row,
  Q3RowSchema,
  type Q3Row,
  Q4RowSchema,
  type Q4Row,
  Q5RowSchema,
  type Q5Row,
} from './transforms';

// ─────────────────────────────────────────────────────────────────────────
// SQL queries — see docs/data-sources/kku-hr.md "Aggregation contract".
// COLLATE Thai_CI_AS on every cross-DB JOIN — different collations.
// ─────────────────────────────────────────────────────────────────────────

const Q1_FACULTY_MEMBERS = `
SELECT
  CONVERT(varchar(64), HASHBYTES('SHA2_256', CAST(e.EMPLOYEEID AS varbinary(500))), 2) AS EMPLOYEE_HASH,
  -- EMPLOYEEID raw — HR-internal employment number, NOT citizen ID.
  -- Confirmed not PII per KKU 2026-05-02. Surfaced for analyst lookup.
  CAST(e.EMPLOYEEID AS varchar(50)) AS EMPLOYEE_ID,
  -- ID_PEOPLE is NVARCHAR in HCM. CAST'ing to varbinary(500) of an
  -- NVARCHAR yields UTF-16-LE bytes, which produces a different SHA-256
  -- than Node's hashCitizenId() which uses UTF-8. Cast to VARCHAR first
  -- so the hash bytes match the canonical lowercase-hex SHA-256(UTF-8)
  -- shared across DS2003 / DS2004 / DS1001 / processed-HR.
  CASE WHEN e.ID_PEOPLE IS NULL OR e.ID_PEOPLE = ''
       THEN NULL
       ELSE CONVERT(varchar(64), HASHBYTES('SHA2_256', CAST(CAST(e.ID_PEOPLE AS varchar(50)) AS varbinary(500))), 2)
  END                          AS PERSON_HASH,
  e.EMP_PREFIX, e.FNAME, e.LNAME, e.EFNAME, e.ELNAME,
  e.STATUS,
  -- Full BIRTHDAY (was previously truncated to year). Needed for both
  -- accurate dateOfBirth + the retirementDate calculation (KKU civil-
  -- service rule: retire on the 1 Oct *after* turning 60).
  e.BIRTHDAY                   AS BIRTH_DATE,
  -- FIRSTHIREDATE = authoritative original join date. Supersedes
  -- STARTDATE (which has been observed with 2025 bulk-stamp anomalies
  -- on re-contracted staff). STARTDATE retained as a fallback when
  -- FIRSTHIREDATE is null (rare).
  e.FIRSTHIREDATE,
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

// Q5 — full HCM staff snapshot (hires + birth dates, every staff
// member with FIRSTHIREDATE in EmployeeDetail).
//
// Broadened 2026-05-12 from "hires last 10y" to "full snapshot":
//   - dropped the 10y FIRSTHIREDATE window (now covers all staff
//     with a hire date, ~15-18k rows)
//   - added BIRTHDAY (replaces vw_history.birthday as the primary
//     source for age/retirement-cliff calcs)
//
// Drives:
//   - "New hires (last 12 months)" KPI (FIRSTHIREDATE within 12m)
//   - Retirement projection 10y    (BIRTHDAY → KKU rule)
//   - Retirement cliff 5y          (BIRTHDAY → age)
//   - Faculties at retirement risk (BIRTHDAY → age)
//   - Age pyramids                 (BIRTHDAY → age)
//   - Tenure distribution          (FIRSTHIREDATE)
//
// vw_history (staff_lifecycle_dates) becomes the FALLBACK only — used
// when a citizenIdHash matches but the HCM row is missing
// (rare; observed for some legacy staff).
//
// Same PII gate as Q1/Q4: hashed identifiers only, no names/salaries.
const Q5_HIRES = `
SELECT
  CONVERT(varchar(64), HASHBYTES('SHA2_256', CAST(CAST(e.EMPLOYEEID AS varchar(50)) AS varbinary(500))), 2) AS EMPLOYEE_HASH,
  CAST(e.EMPLOYEEID AS varchar(50)) AS EMPLOYEE_ID,
  CASE WHEN e.ID_PEOPLE IS NULL OR e.ID_PEOPLE = ''
       THEN NULL
       ELSE CONVERT(varchar(64), HASHBYTES('SHA2_256', CAST(CAST(e.ID_PEOPLE AS varchar(50)) AS varbinary(500))), 2)
  END                          AS PERSON_HASH,
  e.STATUS,
  e.BIRTHDAY,
  e.FIRSTHIREDATE,
  e.BU1                        AS FACULTY_KEY,
  w.All_Position_Types         AS POSITION_TYPE
FROM dbo.EmployeeDetail e
LEFT JOIN [epm_report].[dbo].[workforce_hcm_actual] w
  ON e.EMP_POSITION COLLATE Thai_CI_AS = w.POSITION_NUMBER COLLATE Thai_CI_AS
WHERE e.FIRSTHIREDATE IS NOT NULL
`;

// Q4 — separations snapshot (10-year window).
//
// Pulls EVERY EmployeeDetail row that has ENDWORKDATE filled —
// regardless of current STATUS — so the turnover-rate numerator
// includes staff who have already separated (and therefore left
// the active-only Q1 projection). LEFT JOIN to workforce_hcm_actual
// because separated staff often have their position record cleared;
// All_Position_Types may be null for them.
//
// 10-year window is plenty for the 5-year-trend bars + 12-month
// rolling turnover; older history isn't policy-actionable.
//
// PII gate: same projection as Q1 — EMPLOYEEID + ID_PEOPLE are
// hashed server-side, EMP_PREFIX / FNAME / LNAME are NOT in the
// SELECT (we don't need names for an aggregate count).
const Q4_SEPARATIONS = `
SELECT
  CONVERT(varchar(64), HASHBYTES('SHA2_256', CAST(CAST(e.EMPLOYEEID AS varchar(50)) AS varbinary(500))), 2) AS EMPLOYEE_HASH,
  CAST(e.EMPLOYEEID AS varchar(50)) AS EMPLOYEE_ID,
  CASE WHEN e.ID_PEOPLE IS NULL OR e.ID_PEOPLE = ''
       THEN NULL
       ELSE CONVERT(varchar(64), HASHBYTES('SHA2_256', CAST(CAST(e.ID_PEOPLE AS varchar(50)) AS varbinary(500))), 2)
  END                          AS PERSON_HASH,
  e.STATUS,
  e.ENDWORKDATE,
  e.BU1                        AS FACULTY_KEY,
  w.All_Position_Types         AS POSITION_TYPE
FROM dbo.EmployeeDetail e
LEFT JOIN [epm_report].[dbo].[workforce_hcm_actual] w
  ON e.EMP_POSITION COLLATE Thai_CI_AS = w.POSITION_NUMBER COLLATE Thai_CI_AS
WHERE e.ENDWORKDATE IS NOT NULL
  AND e.ENDWORKDATE >= DATEADD(year, -10, GETDATE())
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

interface HrRawDataSeparation {
  kind: 'separation';
  q4: Q4Row;
}

interface HrRawDataHire {
  kind: 'hire';
  q5: Q5Row;
}

type HrRawPayload = HrRawData | HrRawDataCompensation | HrRawDataSeparation | HrRawDataHire;

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

    // 2. Run all five queries in one connection.
    const cfg = this.mssqlConfig();
    let q1Raw: unknown[] = [];
    let q2Raw: unknown[] = [];
    let q3Raw: unknown[] = [];
    let q4Raw: unknown[] = [];
    let q5Raw: unknown[] = [];
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

      ctx.log.info('running Q4 separations (10y window)');
      q4Raw = await query(pool, Q4_SEPARATIONS);
      ctx.log.info(`Q4 returned ${q4Raw.length.toLocaleString()} rows`);

      ctx.log.info('running Q5 hires (10y window)');
      q5Raw = await query(pool, Q5_HIRES);
      ctx.log.info(`Q5 returned ${q5Raw.length.toLocaleString()} rows`);
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
    const q4Rows = q4Raw.map((r, i): Q4Row => {
      const parsed = Q4RowSchema.safeParse(r);
      if (!parsed.success) {
        throw new NonRetryableError(
          'Q4_VALIDATION',
          `Q4 row ${i} failed validation: ${parsed.error.message}`,
        );
      }
      return parsed.data;
    });
    const q5Rows = q5Raw.map((r, i): Q5Row => {
      const parsed = Q5RowSchema.safeParse(r);
      if (!parsed.success) {
        throw new NonRetryableError(
          'Q5_VALIDATION',
          `Q5 row ${i} failed validation: ${parsed.error.message}`,
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

    // 5. Emit one RawRecord per Q1 row + one per Q2 row + one per Q4
    // (separation) row.
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
    for (const q4 of q4Rows) {
      records.push({
        externalId: `kku-hr:sep:${q4.EMPLOYEE_HASH}`,
        sourceTimestamp: fetchTimestamp,
        data: { kind: 'separation', q4 } satisfies HrRawPayload,
      });
    }
    for (const q5 of q5Rows) {
      records.push({
        externalId: `kku-hr:hire:${q5.EMPLOYEE_HASH}`,
        sourceTimestamp: fetchTimestamp,
        data: { kind: 'hire', q5 } satisfies HrRawPayload,
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
    if (data.kind === 'separation') {
      return this.transformSeparation(state, data.q4, raw.sourceTimestamp);
    }
    if (data.kind === 'hire') {
      return this.transformHire(state, data.q5, raw.sourceTimestamp);
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

    // Date sources (2026-05-12 — full HCM precision):
    //   dateOfBirth        ← e.BIRTHDAY (full date, was year-only)
    //   hireDate           ← e.FIRSTHIREDATE (authoritative join date);
    //                        STARTDATE is the fallback for the rare
    //                        legacy row without a FIRSTHIREDATE.
    //   retirementDate     ← COMPUTED from BIRTHDAY via the KKU civil-
    //                        service rule (1 Oct after turning 60).
    //                        Supersedes RESIGNDATE which is only
    //                        populated post-resignation.
    //   endEmploymentDate  ← e.ENDWORKDATE (was always queried but
    //                        previously discarded). For STATUS='A' staff
    //                        this is blank; for separated staff it's
    //                        the actual termination date.
    const dateOfBirth = parseHcmDate(q1.BIRTH_DATE);
    const hireDate = parseHcmDate(q1.FIRSTHIREDATE) ?? parseHcmDate(q1.STARTDATE);
    const retirementDate = computeRetirementDateFromBirth(dateOfBirth);
    const endEmploymentDate = parseHcmDate(q1.ENDWORKDATE);

    return [
      {
        target: 'faculty_members',
        externalId: `faculty_member:${q1.EMPLOYEE_HASH}`,
        payload: {
          facultyId,
          departmentId,
          employeeCode: buildEmployeeCode(q1.EMPLOYEE_HASH),
          employeeId: q1.EMPLOYEE_ID,
          // PERSON_HASH = SHA-256(ID_PEOPLE) computed server-side. This
          // is the same value `hashCitizenId(rawCitizenId)` produces in
          // every other connector — it's the canonical cross-system
          // join key linking kku-hr ↔ DS2003 ↔ DS2004 ↔ DS1001 ↔
          // processed-HR. Null when ID_PEOPLE was blank in HCM.
          citizenIdHash: q1.PERSON_HASH,
          nameTh,
          nameEn,
          rank,
          dateOfBirth,
          hireDate,
          retirementDate,
          endEmploymentDate,
          isActive: deriveIsActive(q1.STATUS),
        },
        freshnessDate,
      },
    ];
  }

  private transformSeparation(
    state: RunState,
    q4: Q4Row,
    freshnessDate: Date,
  ): NormalizedRecord[] {
    // Normalise ENDWORKDATE — mssql-client returns Date for DATETIME
    // columns, but rare rows can come back as text. Drop rows where
    // the value won't parse or is out of bounds.
    let endDate: Date | null = null;
    if (q4.ENDWORKDATE instanceof Date) {
      const y = q4.ENDWORKDATE.getUTCFullYear();
      if (y >= 1900 && y <= 2100) endDate = q4.ENDWORKDATE;
    } else if (typeof q4.ENDWORKDATE === 'string') {
      endDate = parseHcmDate(q4.ENDWORKDATE);
    }
    if (!endDate) return [];

    // Faculty resolution — non-fatal: BU1 not mapped → facultyId null.
    const facultyId = q4.FACULTY_KEY
      ? state.facultyMappings.get(q4.FACULTY_KEY) ?? null
      : null;

    return [
      {
        target: 'staff_separations',
        externalId: `kku-hr:sep:${q4.EMPLOYEE_HASH}`,
        payload: {
          employeeHash: q4.EMPLOYEE_HASH,
          employeeId: q4.EMPLOYEE_ID,
          citizenIdHash: q4.PERSON_HASH?.toLowerCase() ?? null,
          endWorkDate: endDate,
          status: q4.STATUS,
          facultyKey: q4.FACULTY_KEY,
          positionType: q4.POSITION_TYPE,
          facultyId,
        },
        freshnessDate,
      },
    ];
  }

  private transformHire(
    state: RunState,
    q5: Q5Row,
    freshnessDate: Date,
  ): NormalizedRecord[] {
    // Helper to normalise the Date/string union the mssql driver
    // returns. Same logic as transformSeparation.
    function normaliseHcmDate(v: Date | string | null): Date | null {
      if (v === null) return null;
      if (v instanceof Date) {
        const y = v.getUTCFullYear();
        return y >= 1900 && y <= 2100 ? v : null;
      }
      return parseHcmDate(v);
    }
    const hireDate = normaliseHcmDate(q5.FIRSTHIREDATE);
    if (!hireDate) return [];
    const birthDate = normaliseHcmDate(q5.BIRTHDAY);

    const facultyId = q5.FACULTY_KEY
      ? state.facultyMappings.get(q5.FACULTY_KEY) ?? null
      : null;

    return [
      {
        target: 'staff_hires',
        externalId: `kku-hr:hire:${q5.EMPLOYEE_HASH}`,
        payload: {
          employeeHash: q5.EMPLOYEE_HASH,
          employeeId: q5.EMPLOYEE_ID,
          citizenIdHash: q5.PERSON_HASH?.toLowerCase() ?? null,
          birthDate,
          firstHireDate: hireDate,
          status: q5.STATUS,
          facultyKey: q5.FACULTY_KEY,
          positionType: q5.POSITION_TYPE,
          facultyId,
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
            employeeId: string | null;
            citizenIdHash: string | null;
            nameTh: string;
            nameEn: string;
            rank: FacultyRank;
            dateOfBirth: Date | null;
            hireDate: Date | null;
            retirementDate: Date | null;
            endEmploymentDate: Date | null;
            isActive: boolean;
          };
          await this.db.facultyMember.upsert({
            where: { employeeCode: p.employeeCode },
            create: {
              facultyId: p.facultyId,
              departmentId: p.departmentId ?? undefined,
              employeeCode: p.employeeCode,
              employeeId: p.employeeId,
              // Lowercase to match Node's SHA-256 hex output. SQL Server's
              // HASHBYTES → CONVERT(varchar, …, 2) emits UPPERCASE hex; the
              // canonical convention across our app is lowercase (matches
              // hashCitizenId() in @kku/shared, used by every other connector).
              citizenIdHash: p.citizenIdHash?.toLowerCase() ?? undefined,
              nameTh: p.nameTh,
              nameEn: p.nameEn,
              rank: p.rank,
              dateOfBirth: p.dateOfBirth ?? undefined,
              hireDate: p.hireDate ?? undefined,
              retirementDate: p.retirementDate ?? undefined,
              endEmploymentDate: p.endEmploymentDate ?? undefined,
              isActive: p.isActive,
            },
            update: {
              facultyId: p.facultyId,
              departmentId: p.departmentId,
              employeeId: p.employeeId,
              citizenIdHash: p.citizenIdHash?.toLowerCase() ?? null,
              nameTh: p.nameTh,
              nameEn: p.nameEn,
              rank: p.rank,
              dateOfBirth: p.dateOfBirth,
              hireDate: p.hireDate,
              retirementDate: p.retirementDate,
              endEmploymentDate: p.endEmploymentDate,
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
                ingestionRunId: ctx.runId,
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
                ingestionRunId: ctx.runId,
              },
            });
          }
          loaded++;
        } else if (rec.target === 'staff_hires') {
          const p = rec.payload as {
            employeeHash: string;
            employeeId: string | null;
            citizenIdHash: string | null;
            birthDate: Date | null;
            firstHireDate: Date;
            status: string | null;
            facultyKey: string | null;
            positionType: string | null;
            facultyId: string | null;
          };
          await this.db.staffHire.upsert({
            where: { employeeHash: p.employeeHash },
            create: {
              employeeHash: p.employeeHash,
              employeeId: p.employeeId,
              citizenIdHash: p.citizenIdHash,
              birthDate: p.birthDate,
              firstHireDate: p.firstHireDate,
              status: p.status,
              facultyKey: p.facultyKey,
              positionType: p.positionType,
              facultyId: p.facultyId,
            },
            update: {
              employeeId: p.employeeId,
              citizenIdHash: p.citizenIdHash,
              birthDate: p.birthDate,
              firstHireDate: p.firstHireDate,
              status: p.status,
              facultyKey: p.facultyKey,
              positionType: p.positionType,
              facultyId: p.facultyId,
            },
          });
          loaded++;
        } else if (rec.target === 'staff_separations') {
          const p = rec.payload as {
            employeeHash: string;
            employeeId: string | null;
            citizenIdHash: string | null;
            endWorkDate: Date;
            status: string | null;
            facultyKey: string | null;
            positionType: string | null;
            facultyId: string | null;
          };
          await this.db.staffSeparation.upsert({
            where: { employeeHash: p.employeeHash },
            create: {
              employeeHash: p.employeeHash,
              employeeId: p.employeeId,
              citizenIdHash: p.citizenIdHash,
              endWorkDate: p.endWorkDate,
              status: p.status,
              facultyKey: p.facultyKey,
              positionType: p.positionType,
              facultyId: p.facultyId,
            },
            update: {
              employeeId: p.employeeId,
              citizenIdHash: p.citizenIdHash,
              endWorkDate: p.endWorkDate,
              status: p.status,
              facultyKey: p.facultyKey,
              positionType: p.positionType,
              facultyId: p.facultyId,
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
