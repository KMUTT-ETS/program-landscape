// UNICON DS1001 — Student information.
// Source: mysql://10.130.2.156:3306/reg_unicon.view_ds1001 (same
// endpoint as DS2004; reuse UNICON_DS2004_DB_* env credentials).
//
// One row per (student × academicYear × semester). 35,406 rows in
// current snapshot (AY 2568 sem 2). 35,390 distinct students.
//
// PII handling — DPO-approved 2026-05-04. The SQL projection in fetch()
// is the trust boundary; review carefully if you change either:
//
//   DROPPED at projection (never enters our process):
//     STD_FNAME, STD_MNAME, STD_LNAME (Thai), and _EN versions
//     PREFIX_NAME_ID  · BIRTHDAY (full date) · SUB_DISTRICT_ID
//     PASSPORT_NUMBER · PASSPORT_STARTDATE · PASSPORT_ENDDATE
//
//   HASHED at the connector boundary (raw never persists):
//     CITIZEN_ID → citizenIdHash (canonical cross-system join key)
//     STD_ID     → studentCodeHash (KKU-internal opaque token)
//
//   YEAR-PRECISION DOWNCASTS:
//     BIRTHDAY → birth_year only
//
// CURR_ID resolves to Program via Program.mhesiCode ∪ ProgramMhesiAlias
// (same path as DS2004). Snapshot replace by (academicYear, semester)
// on every refresh — older AY snapshots preserved.

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

interface RawDs1001Row extends Record<string, unknown> {
  ACADEMIC_YEAR: string;
  SEMESTER: string;
  UNIV_ID: string | null;
  CITIZEN_ID: string | null;
  STD_ID: string | null;
  GENDER_ID: string | null;
  BIRTH_YEAR: string | null;
  NATIONALITY_ID: string | null;
  ADMIT_YEAR: string | null;
  FAC_ID: string | null;
  CURR_ID: string | null;
  STUDY_TYPE_ID: string | null;
  STUDY_TIME_ID: string | null;
  STUDY_REG_ID: string | null;
  CLASS: string | null;
  GRAD_STATUS_ID: string | null;
  STD_STATUS_ID: string | null;
  TERMINATE_STUDY_CAUSE: string | null;
  GPA: string | null;
  GPAX: string | null;
  NUM_CREDIT: string | null;
  ACC_CREDIT: string | null;
  DEFORM_ID: string | null;
  FUND_STATUS_ID: string | null;
  FUND_NAME: string | null;
  TALENT_ID: string | null;
  DEGREE_NUM: string | null;
}

interface NormalizedPayload {
  citizenIdHash: string;
  studentCodeHash: string | null;
  mhesiCurrId: string;
  facId: string | null;
  academicYear: number;
  semester: number;
  univId: string | null;
  genderId: string | null;
  nationalityId: string | null;
  birthYear: number | null;
  admitYear: number | null;
  studyTypeId: string | null;
  studyTimeId: string | null;
  studyRegId: string | null;
  classYear: string | null;
  degreeNum: number | null;
  graduationStatusId: string | null;
  studentStatusId: string | null;
  terminateCause: string | null;
  gpa: number | null;
  gpax: number | null;
  numCredit: number | null;
  accCredit: number | null;
  fundStatusId: string | null;
  fundName: string | null;
  deformId: string | null;
  talentId: string | null;
}

interface RunState {
  academicYear: number;
  semester: number;
  fetchedAt: Date;
  fetchedCount: number;
  byStatus: Record<string, number>;
  byNationality: Record<string, number>;
  unhashableRows: number;
  withoutCurrId: number;
}

function num(v: string | null | undefined): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export class UniconDs1001RealConnector extends ApiConnector implements Connector {
  readonly slug = 'unicon-ds1001';
  readonly mocked = false;

  private runState: RunState | null = null;

  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    try {
      const cfg = configFromEnv('UNICON_DS2004_DB');
      await withConnection(cfg, async (conn) => query(conn, 'SELECT 1 AS ok'));
      return { ok: true, message: `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  async fetch(ctx: ConnectorContext): Promise<RawRecord[]> {
    const cfg = configFromEnv('UNICON_DS2004_DB');
    const rows = await withConnection(cfg, (conn) =>
      // PII-safe projection: explicit column list. The columns NOT in
      // this SELECT (STD_FNAME, STD_LNAME, BIRTHDAY full-date,
      // SUB_DISTRICT_ID, PASSPORT_*) never enter our process memory.
      // BIRTHDAY is derived to year-precision via LEFT(BIRTHDAY, 4).
      query<RawDs1001Row>(
        conn,
        `SELECT
            ACADEMIC_YEAR, SEMESTER, UNIV_ID,
            CITIZEN_ID, STD_ID,
            GENDER_ID, NATIONALITY_ID,
            CASE
              WHEN BIRTHDAY IS NULL OR BIRTHDAY = '' THEN NULL
              ELSE LEFT(BIRTHDAY, 4)
            END AS BIRTH_YEAR,
            ADMIT_YEAR, FAC_ID, CURR_ID,
            STUDY_TYPE_ID, STUDY_TIME_ID, STUDY_REG_ID, CLASS,
            GRAD_STATUS_ID, STD_STATUS_ID, TERMINATE_STUDY_CAUSE,
            GPA, GPAX, NUM_CREDIT, ACC_CREDIT,
            DEFORM_ID, FUND_STATUS_ID, FUND_NAME, TALENT_ID, DEGREE_NUM
           FROM view_ds1001`,
      ),
    );

    if (rows.length === 0) {
      throw new NonRetryableError(
        'EMPTY_DATA',
        'view_ds1001 returned 0 rows — refusing to wipe existing snapshot',
      );
    }

    const academicYear = Number(rows[0]!.ACADEMIC_YEAR);
    const semester = Number(rows[0]!.SEMESTER);
    if (!Number.isFinite(academicYear) || !Number.isFinite(semester)) {
      throw new NonRetryableError(
        'BAD_HEADER',
        `Could not parse AY/sem from first row: ${JSON.stringify(rows[0])}`,
      );
    }

    this.runState = {
      academicYear,
      semester,
      fetchedAt: new Date(),
      fetchedCount: rows.length,
      byStatus: {},
      byNationality: {},
      unhashableRows: 0,
      withoutCurrId: 0,
    };
    for (const r of rows) {
      const s = r.STD_STATUS_ID ?? '∅';
      this.runState.byStatus[s] = (this.runState.byStatus[s] ?? 0) + 1;
      const n = r.NATIONALITY_ID ?? '∅';
      this.runState.byNationality[n] = (this.runState.byNationality[n] ?? 0) + 1;
    }
    ctx.log.info(
      `DS1001 fetched ${rows.length} rows for AY ${academicYear} sem ${semester}`,
    );

    const ts = this.runState.fetchedAt;
    return rows.map((r, i) => ({
      externalId: `${r.ACADEMIC_YEAR}|${r.SEMESTER}|${r.CITIZEN_ID ?? r.STD_ID ?? `row${i}`}`,
      data: r,
      sourceTimestamp: ts,
    }));
  }

  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    const r = raw.data as RawDs1001Row;
    const citizenIdHash = hashCitizenId(r.CITIZEN_ID);
    if (!citizenIdHash) {
      // No citizen ID = can't cross-join; skip but track so the count
      // shows up in run metadata.
      if (this.runState) this.runState.unhashableRows += 1;
      return [];
    }
    const studentCodeHash = hashCitizenId(r.STD_ID);

    const mhesiCurrId = (r.CURR_ID ?? '').trim();
    if (!mhesiCurrId) {
      if (this.runState) this.runState.withoutCurrId += 1;
      return [];
    }

    const payload: NormalizedPayload = {
      citizenIdHash,
      studentCodeHash,
      mhesiCurrId,
      facId: r.FAC_ID,
      academicYear: Number(r.ACADEMIC_YEAR),
      semester: Number(r.SEMESTER),
      univId: r.UNIV_ID,
      genderId: r.GENDER_ID,
      nationalityId: r.NATIONALITY_ID,
      birthYear: num(r.BIRTH_YEAR),
      admitYear: num(r.ADMIT_YEAR),
      studyTypeId: r.STUDY_TYPE_ID,
      studyTimeId: r.STUDY_TIME_ID,
      studyRegId: r.STUDY_REG_ID,
      classYear: r.CLASS,
      degreeNum: num(r.DEGREE_NUM),
      graduationStatusId: r.GRAD_STATUS_ID,
      studentStatusId: r.STD_STATUS_ID,
      terminateCause: r.TERMINATE_STUDY_CAUSE,
      gpa: num(r.GPA),
      gpax: num(r.GPAX),
      numCredit: num(r.NUM_CREDIT),
      accCredit: num(r.ACC_CREDIT),
      fundStatusId: r.FUND_STATUS_ID,
      fundName: r.FUND_NAME,
      deformId: r.DEFORM_ID,
      talentId: r.TALENT_ID,
    };

    return [
      {
        target: 'student_program_record',
        externalId: raw.externalId,
        payload: payload as unknown as Record<string, unknown>,
        freshnessDate: raw.sourceTimestamp,
      },
    ];
  }

  async load(ctx: ConnectorContext, normalized: NormalizedRecord[]): Promise<LoadResult> {
    if (!this.runState) {
      throw new Error('runState missing — fetch() must run before load()');
    }
    const { academicYear, semester } = this.runState;

    // Resolve mhesiCurrId → programId via Program.mhesiCode ∪ ProgramMhesiAlias
    // (same path as DS2004).
    const distinctCurrIds = [
      ...new Set(normalized.map((n) => (n.payload as unknown as NormalizedPayload).mhesiCurrId)),
    ];
    const [programs, aliases] = await Promise.all([
      prisma.program.findMany({
        where: { mhesiCode: { in: distinctCurrIds } },
        select: { id: true, mhesiCode: true },
      }),
      prisma.programMhesiAlias.findMany({
        where: { mhesiCode: { in: distinctCurrIds } },
        select: { programId: true, mhesiCode: true },
      }),
    ]);

    const codeToProgramIds = new Map<string, string[]>();
    for (const p of programs) {
      if (!p.mhesiCode) continue;
      const list = codeToProgramIds.get(p.mhesiCode) ?? [];
      list.push(p.id);
      codeToProgramIds.set(p.mhesiCode, list);
    }
    for (const a of aliases) {
      const list = codeToProgramIds.get(a.mhesiCode) ?? [];
      if (!list.includes(a.programId)) list.push(a.programId);
      codeToProgramIds.set(a.mhesiCode, list);
    }

    let resolvedCount = 0;
    let unresolvedCount = 0;
    const unresolvedSamples = new Set<string>();

    // Snapshot replace by (academicYear, semester).
    const deleted = await prisma.studentProgramRecord.deleteMany({
      where: { academicYear, semester },
    });
    ctx.log.info(`deleted ${deleted.count} prior rows for AY ${academicYear} sem ${semester}`);

    let inserted = 0;
    const CHUNK = 1000;
    for (let i = 0; i < normalized.length; i += CHUNK) {
      const slice = normalized.slice(i, i + CHUNK);
      const data = slice.map((n) => {
        const p = n.payload as unknown as NormalizedPayload;
        const matches = codeToProgramIds.get(p.mhesiCurrId) ?? [];
        let programId: string | null = null;
        if (matches.length === 0) {
          unresolvedCount += 1;
          if (unresolvedSamples.size < 25) unresolvedSamples.add(p.mhesiCurrId);
        } else {
          programId = matches[0]!;
          resolvedCount += 1;
        }
        return {
          citizenIdHash: p.citizenIdHash,
          studentCodeHash: p.studentCodeHash,
          programId,
          mhesiCurrId: p.mhesiCurrId,
          facId: p.facId,
          academicYear: p.academicYear,
          semester: p.semester,
          univId: p.univId,
          genderId: p.genderId,
          nationalityId: p.nationalityId,
          birthYear: p.birthYear,
          admitYear: p.admitYear,
          studyTypeId: p.studyTypeId,
          studyTimeId: p.studyTimeId,
          studyRegId: p.studyRegId,
          classYear: p.classYear,
          degreeNum: p.degreeNum,
          graduationStatusId: p.graduationStatusId,
          studentStatusId: p.studentStatusId,
          terminateCause: p.terminateCause,
          gpa: p.gpa,
          gpax: p.gpax,
          numCredit: p.numCredit,
          accCredit: p.accCredit,
          fundStatusId: p.fundStatusId,
          fundName: p.fundName,
          deformId: p.deformId,
          talentId: p.talentId,
          ingestionRunId: ctx.runId,
        };
      });
      const result = await prisma.studentProgramRecord.createMany({
        data,
        skipDuplicates: true,
      });
      inserted += result.count;
    }

    return {
      recordsFetched: this.runState.fetchedCount,
      recordsLoaded: inserted,
      recordsFailed: this.runState.unhashableRows + this.runState.withoutCurrId,
      metadata: {
        academicYear,
        semester,
        unhashableRows: this.runState.unhashableRows,
        withoutCurrId: this.runState.withoutCurrId,
        distinctCurrIds: distinctCurrIds.length,
        programResolution: {
          resolved: resolvedCount,
          unresolved: unresolvedCount,
        },
        unresolvedCurrIdSamples: [...unresolvedSamples],
        topStatuses: Object.entries(this.runState.byStatus)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([k, v]) => ({ status: k, count: v })),
        topNationalities: Object.entries(this.runState.byNationality)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([k, v]) => ({ nationality: k, count: v })),
      },
    };
  }
}
