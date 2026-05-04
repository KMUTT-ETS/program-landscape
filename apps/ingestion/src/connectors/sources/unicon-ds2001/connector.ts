// UNICON DS2001 — Staff master record (per-staff snapshot).
// Source: mysql://10.101.106.44:3310/UNICON_STAFF_KKU.DS2001
//
// 11,325 rows in current snapshot (AY 2568 sem 2). Master roster for
// every KKU employee — academic + support + executive + research,
// covering rank, contract, funding source, specialisation, lifecycle.
//
// PII handling at projection (DPO-approved 2026-05-04):
//   DROPPED:  HOMEADD, MOO, STREET, SUB_DISTRICT_ID, ZIPCODE, TELEPHONE,
//             EMAIL, PASSPORT_*, APPOINTMENT_*, SCHOLAR_ORDER_*,
//             DECORATION_*
//   HASHED:   CITIZEN_ID → citizenIdHash
//   YEAR-DOWN: BIRTHDAY → birth_year only

import {
  hashCitizenId,
  type Connector,
  type ConnectorContext,
  type HealthStatus,
  type LoadResult,
  type NormalizedRecord,
  type RawRecord,
} from '@kku/shared';
import { prisma } from '@kku/db';

import { ApiConnector } from '../../base/api-connector';
import { NonRetryableError } from '../../base/base-connector';
import { configFromEnv, query, withConnection } from '../../../lib/mysql-client';

interface RawDs2001Row extends Record<string, unknown> {
  ACADEMIC_YEAR: string;
  SEMESTER: string;
  UNIV_ID: string | null;
  CITIZEN_ID: string | null;
  PREFIX_NAME_ID: string | null;
  STF_FNAME: string | null;
  STF_MNAME: string | null;
  STF_LNAME: string | null;
  STF_FNAME_EN: string | null;
  STF_MNAME_EN: string | null;
  STF_LNAME_EN: string | null;
  GENDER_ID: string | null;
  BIRTH_YEAR: string | null;
  NATIONALITY_ID: string | null;
  STAFFTYPE_ID: string | null;
  TIME_CONTACT_ID: string | null;
  BUDGET_ID: string | null;
  SUBSTAFFTYPE_ID: string | null;
  ADMIN_POSITION_ID: string | null;
  ACADEMICSTANDING_ID: string | null;
  POSITIONLEVEL_ID: string | null;
  POSITION_WORK: string | null;
  DEPARTMENT_ID: string | null;
  DATE_INWORK: string | null;
  DATE_START_THIS_U: string | null;
  SPECIAL_NAME_ID_1: string | null;
  SPECIAL_NAME_ID_2: string | null;
  TEACH_LEVEL_ID: string | null;
  DEFORM_ID: string | null;
  INCOME_ID: string | null;
  MOVEMENT_TYPE_ID: string | null;
  MOVEMENT_DATE: string | null;
  ACADEMICSTANDING_SUBJECT_ID: string | null;
  ACADEMICSTANDING_SUBJECT_OTHER: string | null;
  RESEARCHER_STATUS_ID: string | null;
}

interface RunState {
  academicYear: number;
  semester: number;
  fetchedAt: Date;
  fetchedCount: number;
  byStaffType: Record<string, number>;
  byNationality: Record<string, number>;
  unhashableRows: number;
}

function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Map DS2001's 5-digit DEPARTMENT_ID → our Faculty.id by joining the
// MHESI codes already used by the DS2004 staff-program connector.
// Cached for the run so we don't hit the DB per-row.
async function buildDeptCodeToFacultyMap(): Promise<Map<string, string>> {
  const rows = await prisma.$queryRaw<Array<{ fac_id: string; faculty_id: string; n: number }>>`
    SELECT spa.fac_id,
           p.faculty_id::text AS faculty_id,
           COUNT(*)::int AS n
      FROM staff_program_assignment spa
      JOIN programs p ON p.id = spa.program_id
     WHERE spa.fac_id IS NOT NULL AND p.faculty_id IS NOT NULL
     GROUP BY spa.fac_id, p.faculty_id
  `;
  // For each fac_id, pick the most-used faculty_id (the rare ambiguous
  // cases happen when MHESI reuses a code across faculties — extremely
  // unusual, but cheap to guard against).
  const winner = new Map<string, { faculty_id: string; n: number }>();
  for (const r of rows) {
    const existing = winner.get(r.fac_id);
    if (!existing || r.n > existing.n) {
      winner.set(r.fac_id, { faculty_id: r.faculty_id, n: r.n });
    }
  }
  const map = new Map<string, string>();
  for (const [code, v] of winner) map.set(code, v.faculty_id);
  return map;
}

function parseBeDate(s: string | null): Date | null {
  if (!s || s === '0000-00-00' || s.startsWith('0000')) return null;
  // YYYY-MM-DD where YYYY is BE — convert to AD.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  const beYear = Number(m[1]);
  if (beYear < 2400 || beYear > 2700) return null;
  const adYear = beYear - 543;
  return new Date(`${adYear}-${m[2]}-${m[3]}T00:00:00Z`);
}

export class UniconDs2001RealConnector extends ApiConnector implements Connector {
  readonly slug = 'unicon-ds2001';
  readonly mocked = false;

  private runState: RunState | null = null;

  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    try {
      const cfg = configFromEnv('UNICON_DS2001_DB');
      await withConnection(cfg, async (conn) => query(conn, 'SELECT 1 AS ok'));
      return { ok: true, message: `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  async fetch(ctx: ConnectorContext): Promise<RawRecord[]> {
    const cfg = configFromEnv('UNICON_DS2001_DB');
    const rows = await withConnection(cfg, (conn) =>
      query<RawDs2001Row>(
        conn,
        `SELECT
            ACADEMIC_YEAR, SEMESTER, UNIV_ID,
            CITIZEN_ID, PREFIX_NAME_ID,
            STF_FNAME, STF_MNAME, STF_LNAME,
            STF_FNAME_EN, STF_MNAME_EN, STF_LNAME_EN,
            GENDER_ID,
            CASE WHEN BIRTHDAY IS NULL THEN NULL
                 ELSE LEFT(BIRTHDAY, 4) END AS BIRTH_YEAR,
            NATIONALITY_ID,
            STAFFTYPE_ID, TIME_CONTACT_ID, BUDGET_ID, SUBSTAFFTYPE_ID,
            ADMIN_POSITION_ID, ACADEMICSTANDING_ID, POSITIONLEVEL_ID, POSITION_WORK,
            DEPARTMENT_ID,
            DATE_INWORK, DATE_START_THIS_U,
            SPECIAL_NAME_ID_1, SPECIAL_NAME_ID_2, TEACH_LEVEL_ID,
            DEFORM_ID, INCOME_ID,
            MOVEMENT_TYPE_ID, MOVEMENT_DATE,
            ACADEMICSTANDING_SUBJECT_ID, ACADEMICSTANDING_SUBJECT_OTHER,
            RESEARCHER_STATUS_ID
           FROM DS2001`,
      ),
    );

    if (rows.length === 0) {
      throw new NonRetryableError('EMPTY_DATA', 'DS2001 returned 0 rows — refusing to wipe');
    }

    const academicYear = Number(rows[0]!.ACADEMIC_YEAR);
    const semester = Number(rows[0]!.SEMESTER);
    if (!Number.isFinite(academicYear) || !Number.isFinite(semester)) {
      throw new NonRetryableError('BAD_HEADER', `Could not parse AY/sem: ${JSON.stringify(rows[0])}`);
    }

    this.runState = {
      academicYear,
      semester,
      fetchedAt: new Date(),
      fetchedCount: rows.length,
      byStaffType: {},
      byNationality: {},
      unhashableRows: 0,
    };
    for (const r of rows) {
      const t = r.STAFFTYPE_ID ?? '∅';
      this.runState.byStaffType[t] = (this.runState.byStaffType[t] ?? 0) + 1;
      const n = r.NATIONALITY_ID ?? '∅';
      this.runState.byNationality[n] = (this.runState.byNationality[n] ?? 0) + 1;
    }
    ctx.log.info(`DS2001 fetched ${rows.length} rows for AY ${academicYear} sem ${semester}`);

    const ts = this.runState.fetchedAt;
    return rows.map((r, i) => ({
      externalId: `${r.ACADEMIC_YEAR}|${r.SEMESTER}|${r.CITIZEN_ID ?? `row${i}`}`,
      data: r,
      sourceTimestamp: ts,
    }));
  }

  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    const r = raw.data as RawDs2001Row;
    const citizenIdHash = hashCitizenId(r.CITIZEN_ID);
    if (!citizenIdHash) {
      if (this.runState) this.runState.unhashableRows += 1;
      return [];
    }

    return [
      {
        target: 'staff_master_record',
        externalId: raw.externalId,
        payload: {
          citizenIdHash,
          prefixNameId: r.PREFIX_NAME_ID,
          firstName: r.STF_FNAME,
          middleName: r.STF_MNAME,
          lastName: r.STF_LNAME,
          firstNameEn: r.STF_FNAME_EN,
          middleNameEn: r.STF_MNAME_EN,
          lastNameEn: r.STF_LNAME_EN,
          genderId: r.GENDER_ID,
          birthYear: num(r.BIRTH_YEAR),
          nationalityId: r.NATIONALITY_ID,
          staffTypeId: r.STAFFTYPE_ID,
          subStaffTypeId: r.SUBSTAFFTYPE_ID,
          timeContactId: r.TIME_CONTACT_ID,
          budgetId: r.BUDGET_ID,
          adminPositionId: r.ADMIN_POSITION_ID,
          positionWork: r.POSITION_WORK,
          academicStandingId: r.ACADEMICSTANDING_ID,
          positionLevelId: r.POSITIONLEVEL_ID,
          departmentRawId: r.DEPARTMENT_ID,
          dateInWork: parseBeDate(r.DATE_INWORK),
          dateStartThisU: parseBeDate(r.DATE_START_THIS_U),
          movementTypeId: r.MOVEMENT_TYPE_ID,
          movementDate: parseBeDate(r.MOVEMENT_DATE),
          specialNameId1: r.SPECIAL_NAME_ID_1,
          specialNameId2: r.SPECIAL_NAME_ID_2,
          academicStandingSubjectId: r.ACADEMICSTANDING_SUBJECT_ID,
          academicStandingSubjectOther: r.ACADEMICSTANDING_SUBJECT_OTHER,
          teachLevelId: r.TEACH_LEVEL_ID,
          incomeId: r.INCOME_ID,
          deformId: r.DEFORM_ID,
          researcherStatusId: r.RESEARCHER_STATUS_ID,
          academicYear: Number(r.ACADEMIC_YEAR),
          semester: Number(r.SEMESTER),
          univId: r.UNIV_ID,
        },
        freshnessDate: raw.sourceTimestamp,
      },
    ];
  }

  async load(ctx: ConnectorContext, normalized: NormalizedRecord[]): Promise<LoadResult> {
    if (!this.runState) throw new Error('runState missing');
    const { academicYear, semester } = this.runState;

    // Build (DEPARTMENT_ID → faculty_id) map by matching every Faculty.nameTh
    // against the rows already loaded by the kku-finance / kku-hr / DS2004
    // connectors. We approximate by joining on the Thai name we'd expect in
    // REF_FAC; in practice the same code shows up in `staff_program_assignment.fac_id`
    // → resolves to the program's faculty, so we can derive `code → faculty_id`
    // without re-reading the xlsx every run.
    const codeToFacultyId = await buildDeptCodeToFacultyMap();
    let resolved = 0;
    let unresolvedDistinct = new Set<string>();

    const deleted = await prisma.staffMasterRecord.deleteMany({
      where: { academicYear, semester },
    });
    ctx.log.info(`deleted ${deleted.count} prior rows for AY ${academicYear} sem ${semester}`);

    let inserted = 0;
    const CHUNK = 1000;
    for (let i = 0; i < normalized.length; i += CHUNK) {
      const slice = normalized.slice(i, i + CHUNK);
      const data = slice.map((n) => {
        const p = n.payload as Record<string, unknown>;
        const code = (p.departmentRawId as string | null) ?? null;
        const facultyId = code ? codeToFacultyId.get(code) ?? null : null;
        if (facultyId) resolved += 1;
        else if (code) unresolvedDistinct.add(code);
        return { ...p, facultyId, ingestionRunId: ctx.runId };
      }) as never;
      const result = await prisma.staffMasterRecord.createMany({ data, skipDuplicates: true });
      inserted += result.count;
    }
    ctx.log.info(`faculty resolved: ${resolved}/${inserted} (${unresolvedDistinct.size} distinct unresolved codes)`);

    return {
      recordsFetched: this.runState.fetchedCount,
      recordsLoaded: inserted,
      recordsFailed: this.runState.unhashableRows,
      metadata: {
        academicYear,
        semester,
        unhashableRows: this.runState.unhashableRows,
        topStaffTypes: Object.entries(this.runState.byStaffType)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([k, v]) => ({ staffType: k, count: v })),
        topNationalities: Object.entries(this.runState.byNationality)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([k, v]) => ({ nationality: k, count: v })),
      },
    };
  }
}
