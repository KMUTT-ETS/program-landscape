// ────────────────────────────────────────────────────────────────────────────
// KkuAdmissionCampaignsRealConnector — kku-admission-campaigns, live.
//
// Source: registry Oracle view POWERBI.ADMISSION_STAT. One row per
// WPROGRAMID — a single recruitment campaign TRACK (a competency /
// language / exam option / quota type / branch-campus intake) within a
// program × round × year. This is the PRACTICAL recruitment grain, finer
// than the curriculum-level POWERBI.ADMISSION_STAT_CURRID that backs the
// existing /education/recruitment dashboard.
//
// PROGRAMID (the 12-digit recruitment-program code) is NOT the MHESI curr
// code, so it is NOT resolved to a canonical Program here — that mapping
// is LLM-assisted and lives in AdmissionStatProgramMapping, joined at
// query time. FACULTYNAME ships inline (Thai), so the faculty IS resolved
// here by exact nameTh match (nullable when unassigned / unmatched).
//
// Seat / plan columns: ADMISSION_STAT does not yet carry ENROLLSEAT /
// PLAN_PER_YEAR (Registrar IT is adding them). The connector PROBES
// ALL_TAB_COLUMNS each run and includes whichever seat columns exist —
// so when the Registrar adds them, a re-run populates them with no code
// change.
// ────────────────────────────────────────────────────────────────────────────

import { z } from 'zod';
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

// Always-present columns. Seat columns are appended conditionally.
// CURR_ID is detected like the seat columns (added 2026-05-30) so the
// connector tolerates the table both before and after the Registrar's
// schema change.
const BASE_SELECT = `
  WPROGRAMID            AS WPROGRAMID,
  FACULTYID             AS FACULTYID,
  FACULTYNAME           AS FACULTYNAME,
  PROGRAMID             AS PROGRAMID,
  PROGRAMNAME           AS PROGRAMNAME,
  ACADYEAR              AS ACADYEAR,
  ROUND                 AS ROUND,
  TOTAL_APPLICANT       AS TOTAL_APPLICANTS,
  TOTAL_PASS            AS TOTAL_PASSED,
  SEND_CLEARINGHOUSE    AS SEND_CLEARINGHOUSE,
  CONFIRM_CLEARINGHOUSE AS CONFIRM_CLEARINGHOUSE,
  SEND_REG_REPORTED     AS SEND_REG_REPORTED,
  REG_REPORTED          AS REG_REPORTED`;

// Columns that may or may not exist depending on the table revision —
// detected per run via ALL_TAB_COLUMNS. NOTE: the plan column is spelled
// PLAN_PER_YEAER (Registrar's typo); we accept the correct spelling too
// in case it's fixed later.
const OPTIONAL_COLUMN_CANDIDATES: Array<{
  alias: 'ENROLL_SEATS' | 'PLAN_PER_YEAR' | 'CURR_ID';
  names: string[];
}> = [
  { alias: 'ENROLL_SEATS', names: ['ENROLLSEAT', 'ENROLL_SEAT', 'ENROLLSEATS'] },
  { alias: 'PLAN_PER_YEAR', names: ['PLAN_PER_YEAER', 'PLAN_PER_YEAR', 'PLANPERYEAR', 'PLAN'] },
  { alias: 'CURR_ID', names: ['CURR_ID', 'CURRID'] },
];

const RowSchema = z.object({
  WPROGRAMID: z.union([z.number(), z.string()]).transform((v) => String(v)),
  FACULTYID: z.coerce.number().int().nullable(),
  FACULTYNAME: z.string().min(1),
  // PROGRAMID can be the length-1 "0"/placeholder for not-yet-assigned rows.
  PROGRAMID: z.union([z.number(), z.string()]).transform((v) => String(v)),
  PROGRAMNAME: z.string().min(1),
  ACADYEAR: z.coerce.number().int().min(2400).max(2700),
  ROUND: z.union([z.number(), z.string()]).transform((v) => String(v)),
  TOTAL_APPLICANTS: z.coerce.number().int().min(0).max(1_000_000).nullable(),
  TOTAL_PASSED: z.coerce.number().int().min(0).max(1_000_000).nullable(),
  SEND_CLEARINGHOUSE: z.coerce.number().int().min(0).max(1_000_000).nullable(),
  CONFIRM_CLEARINGHOUSE: z.coerce.number().int().min(0).max(1_000_000).nullable(),
  SEND_REG_REPORTED: z.coerce.number().int().min(0).max(1_000_000).nullable(),
  REG_REPORTED: z.coerce.number().int().min(0).max(1_000_000).nullable(),
  // Optional columns — present depending on table revision.
  ENROLL_SEATS: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
  PLAN_PER_YEAR: z.coerce.number().int().min(0).max(100_000).nullable().optional(),
  CURR_ID: z.union([z.number(), z.string()]).transform((v) => String(v)).nullable().optional(),
});
type CampaignRow = z.infer<typeof RowSchema>;

interface RunState {
  fetchTimestamp: Date;
  /** normalized Thai faculty name → Faculty.id. */
  facultyByNameTh: Map<string, string>;
  /** CURR_ID → canonical programId (mhesiCode ∪ ProgramMhesiAlias). */
  currToProgramId: Map<string, string>;
  /** PROGRAMID → programId (name-based bridge, fallback). */
  bridgeByPid: Map<string, string>;
  seatColumnsFound: string[];
  unmatchedFaculties: Set<string>;
  unmappedPrograms: Set<string>;
  loaded: number;
}

const normTh = (s: string): string => s.replace(/\s+/g, ' ').trim();

export class KkuAdmissionCampaignsRealConnector extends ApiConnector {
  readonly slug = 'kku-admission-campaigns';
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
      return { ok: false, message: err instanceof Error ? err.message : String(err) };
    }
  }

  async fetch(ctx: ConnectorContext, _since?: Date): Promise<RawRecord[]> {
    const fetchTimestamp = new Date();

    let raw: unknown[] = [];
    let seatColumnsFound: string[] = [];
    await withConnection(this.oracleConfig(), async (conn) => {
      // 1. Detect which seat columns exist this run.
      const colRows = await query<{ COLUMN_NAME: string }>(
        conn,
        `SELECT COLUMN_NAME FROM ALL_TAB_COLUMNS
         WHERE OWNER='POWERBI' AND TABLE_NAME='ADMISSION_STAT'`,
      );
      const present = new Set(colRows.map((c) => c.COLUMN_NAME.toUpperCase()));
      const optSelects: string[] = [];
      for (const cand of OPTIONAL_COLUMN_CANDIDATES) {
        const hit = cand.names.find((n) => present.has(n));
        if (hit) {
          optSelects.push(`${hit} AS ${cand.alias}`);
          seatColumnsFound.push(`${hit}→${cand.alias}`);
        }
      }
      const select = optSelects.length
        ? `${BASE_SELECT},\n  ${optSelects.join(',\n  ')}`
        : BASE_SELECT;

      ctx.log.info(
        `querying POWERBI.ADMISSION_STAT` +
          (seatColumnsFound.length
            ? ` (optional columns: ${seatColumnsFound.join(', ')})`
            : ' (no seat/curr columns yet — plan/seats/curr stay null)'),
      );
      raw = await query(conn, `SELECT${select}\nFROM POWERBI.ADMISSION_STAT`);
      ctx.log.info(`retrieved ${raw.length.toLocaleString()} rows`);
    });

    // 2. Validate.
    const rows = raw.map((r, i): CampaignRow => {
      const result = RowSchema.safeParse(r);
      if (!result.success) {
        throw new NonRetryableError(
          'ADMISSION_CAMPAIGNS_VALIDATION',
          `row ${i} failed schema validation: ${result.error.message}`,
        );
      }
      return result.data;
    });

    // 3. Faculty lookup by Thai name (exact, whitespace-normalized).
    const faculties = await this.db.faculty.findMany({
      select: { id: true, nameTh: true },
    });
    const facultyByNameTh = new Map<string, string>();
    for (const f of faculties) facultyByNameTh.set(normTh(f.nameTh), f.id);
    ctx.log.info(`built faculty lookup: ${facultyByNameTh.size} entries`);

    // 4. Program resolution: CURR_ID → canonical program (mhesiCode ∪ alias,
    // restricted to ACTIVE + on-the-master-sheet programs), with the
    // name-based AdmissionStatProgramMapping bridge as fallback. Stored on
    // each row so downstream scoring / deep-dive / risk read program_id
    // directly (drop-in for tcas_admission_funnels).
    const programs = await this.db.program.findMany({
      where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
      select: { id: true, mhesiCode: true },
    });
    const validIds = new Set(programs.map((p) => p.id));
    const currToProgramId = new Map<string, string>();
    for (const p of programs) if (p.mhesiCode) currToProgramId.set(p.mhesiCode, p.id);
    const aliases = await this.db.programMhesiAlias.findMany({ select: { mhesiCode: true, programId: true } });
    for (const a of aliases) {
      if (!currToProgramId.has(a.mhesiCode) && validIds.has(a.programId)) currToProgramId.set(a.mhesiCode, a.programId);
    }
    const bridge = await this.db.admissionStatProgramMapping.findMany({ select: { recruitmentProgramId: true, programId: true } });
    const bridgeByPid = new Map<string, string>();
    for (const b of bridge) if (validIds.has(b.programId)) bridgeByPid.set(b.recruitmentProgramId, b.programId);
    ctx.log.info(`built program lookup: ${currToProgramId.size} curr_id + ${bridgeByPid.size} bridge entries`);

    this.runState = {
      fetchTimestamp,
      facultyByNameTh,
      currToProgramId,
      bridgeByPid,
      seatColumnsFound,
      unmatchedFaculties: new Set(),
      unmappedPrograms: new Set(),
      loaded: 0,
    };

    return rows.map((r): RawRecord => ({
      externalId: `wpid:${r.WPROGRAMID}`,
      data: r,
      sourceTimestamp: fetchTimestamp,
    }));
  }

  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    if (!this.runState) {
      throw new NonRetryableError('NO_RUN_STATE', 'transform called before fetch');
    }
    const r = raw.data as CampaignRow;
    const facultyId = this.runState.facultyByNameTh.get(normTh(r.FACULTYNAME)) ?? null;
    if (!facultyId) this.runState.unmatchedFaculties.add(r.FACULTYNAME);
    // CURR_ID first (authoritative), then the name-based bridge.
    const programId =
      (r.CURR_ID ? this.runState.currToProgramId.get(r.CURR_ID) : undefined) ??
      this.runState.bridgeByPid.get(r.PROGRAMID) ??
      null;
    if (!programId) this.runState.unmappedPrograms.add(r.PROGRAMID);
    return [
      {
        target: 'admission_campaign_stats',
        externalId: raw.externalId,
        payload: { row: r, facultyId, programId } as unknown as Record<string, unknown>,
        freshnessDate: raw.sourceTimestamp,
      },
    ];
  }

  async load(ctx: ConnectorContext, normalized: NormalizedRecord[]): Promise<LoadResult> {
    if (!this.runState) {
      throw new NonRetryableError('NO_RUN_STATE', 'load called before fetch');
    }
    const fetchTimestamp = this.runState.fetchTimestamp;

    const CHUNK = 50;
    for (let i = 0; i < normalized.length; i += CHUNK) {
      const chunk = normalized.slice(i, i + CHUNK);
      await Promise.all(
        chunk.map(async (n) => {
          const { row, facultyId, programId } = n.payload as {
            row: CampaignRow;
            facultyId: string | null;
            programId: string | null;
          };
          const data = {
            wProgramId: row.WPROGRAMID,
            recruitmentProgramId: row.PROGRAMID,
            programId,
            currId: row.CURR_ID ?? null,
            campaignName: row.PROGRAMNAME,
            sourceFacultyId: row.FACULTYID,
            facultyNameTh: row.FACULTYNAME,
            facultyId,
            acadYearBE: row.ACADYEAR,
            round: row.ROUND,
            enrollSeats: row.ENROLL_SEATS ?? null,
            planPerYear: row.PLAN_PER_YEAR ?? null,
            totalApplicants: row.TOTAL_APPLICANTS,
            totalPassed: row.TOTAL_PASSED,
            sendClearinghouse: row.SEND_CLEARINGHOUSE,
            confirmClearinghouse: row.CONFIRM_CLEARINGHOUSE,
            sendRegReported: row.SEND_REG_REPORTED,
            regReported: row.REG_REPORTED,
            freshnessDate: fetchTimestamp,
            source: 'kku-admission-campaigns',
            ingestionRunId: ctx.runId,
          };
          await this.db.admissionCampaignStat.upsert({
            where: { wProgramId: row.WPROGRAMID },
            create: data,
            update: data,
          });
        }),
      );
      this.runState.loaded += chunk.length;
    }

    const unmatchedSamples = Array.from(this.runState.unmatchedFaculties).slice(0, 30);
    ctx.log.info(
      `loaded ${this.runState.loaded.toLocaleString()} campaign rows; ` +
        `unmatched faculties: ${this.runState.unmatchedFaculties.size}; ` +
        `unmapped PROGRAMIDs: ${this.runState.unmappedPrograms.size}`,
    );

    return {
      recordsFetched: normalized.length,
      recordsLoaded: this.runState.loaded,
      recordsFailed: 0,
      metadata: {
        fetchedAt: fetchTimestamp.toISOString(),
        seatColumnsFound: this.runState.seatColumnsFound,
        hasSeatData: this.runState.seatColumnsFound.length > 0,
        unmatchedFacultyCount: this.runState.unmatchedFaculties.size,
        unmatchedFacultySamples: unmatchedSamples,
        unmappedProgramCount: this.runState.unmappedPrograms.size,
        unmappedProgramSamples: Array.from(this.runState.unmappedPrograms).slice(0, 30),
      },
    };
  }
}
