// ────────────────────────────────────────────────────────────────────────────
// KkuTcasFunnelRealConnector — flips kku-tcas-funnel from mock to live.
//
// Source: registry Oracle view POWERBI.ADMISSION_STAT_CURRID. One row
// per (CURR_ID × ROUND × ACADYEAR) carrying the full TCAS admission
// funnel — from quota and applicants all the way through Clearinghouse
// confirmation and registrar reporting.
//
// Per-program resolution: CURR_ID joins to Program.mhesiCode first;
// when that misses, ProgramMhesiAlias.mhesiCode. Unmapped rows are
// retained (programId=NULL) so the analyst sees what to add to
// ProgramMhesiAlias on the next pass.
//
// Replaces the legacy TCAS3-only data ingested into TcasAdmissionStat
// (KKU rows there are deleted in a separate migration; peer rows for
// other Thai universities stay for benchmarking).
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

// ── SQL ──────────────────────────────────────────────────────────────────
const Q_FUNNEL = `
SELECT
  CURR_ID                AS CURR_ID,
  ACADYEAR               AS ACADYEAR,
  ROUND                  AS ROUND,
  ENROLLSEAT             AS ENROLL_SEATS,
  PLAN_PER_YEAR          AS PLAN_PER_YEAR,
  TOTAL_APPLICANT        AS TOTAL_APPLICANTS,
  TOTAL_PASS             AS TOTAL_PASSED,
  SEND_CLEARINGHOUSE     AS SEND_CLEARINGHOUSE,
  CONFIRM_CLEARINGHOUSE  AS CONFIRM_CLEARINGHOUSE,
  SEND_REG_REPORTED      AS SEND_REG_REPORTED,
  REG_REPORTED           AS REG_REPORTED,
  UPDATED_AT             AS UPDATED_AT
FROM POWERBI.ADMISSION_STAT_CURRID
`;

// Oracle's NUMBER becomes JS number; nullable funnel columns can land
// as null. Round can be fractional (1.2, 4.2 etc) so we coerce to
// string verbatim from the Oracle response.
const RowSchema = z.object({
  CURR_ID: z.string().min(8).max(32),
  ACADYEAR: z.coerce.number().int().min(2400).max(2700),
  ROUND: z.union([z.number(), z.string()]).transform((v) => String(v)),
  ENROLL_SEATS: z.coerce.number().int().min(0).max(10_000).nullable(),
  PLAN_PER_YEAR: z.coerce.number().int().min(0).max(10_000).nullable(),
  TOTAL_APPLICANTS: z.coerce.number().int().min(0).max(100_000).nullable(),
  TOTAL_PASSED: z.coerce.number().int().min(0).max(100_000).nullable(),
  SEND_CLEARINGHOUSE: z.coerce.number().int().min(0).max(100_000).nullable(),
  CONFIRM_CLEARINGHOUSE: z.coerce.number().int().min(0).max(100_000).nullable(),
  SEND_REG_REPORTED: z.coerce.number().int().min(0).max(100_000).nullable(),
  REG_REPORTED: z.coerce.number().int().min(0).max(100_000).nullable(),
  UPDATED_AT: z.coerce.date().nullable(),
});
type FunnelRow = z.infer<typeof RowSchema>;

// ── Per-run state ────────────────────────────────────────────────────────
interface RunState {
  fetchTimestamp: Date;
  /** CURR_ID → programId. Built once per run from
   *  Program.mhesiCode ∪ ProgramMhesiAlias. */
  currIdToProgramId: Map<string, string>;
  unmappedCurrIds: Set<string>;
  loaded: number;
}

// ── Connector ────────────────────────────────────────────────────────────
export class KkuTcasFunnelRealConnector extends ApiConnector {
  readonly slug = 'kku-tcas-funnel';
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

    // 1. Pull all rows in one Oracle round-trip.
    let raw: unknown[] = [];
    await withConnection(this.oracleConfig(), async (conn) => {
      ctx.log.info('querying POWERBI.ADMISSION_STAT_CURRID');
      raw = await query(conn, Q_FUNNEL);
      ctx.log.info(`retrieved ${raw.length.toLocaleString()} rows`);
    });

    // 2. Validate via Zod. Schema-drift here is a connector bug, not
    // transient — fail loudly.
    const rows = raw.map((r, i): FunnelRow => {
      const result = RowSchema.safeParse(r);
      if (!result.success) {
        throw new NonRetryableError(
          'TCAS_FUNNEL_VALIDATION',
          `row ${i} failed schema validation: ${result.error.message}`,
        );
      }
      return result.data;
    });

    // 3. Build the CURR_ID → programId lookup once.
    const allMhesi = await this.db.program.findMany({
      where: { mhesiCode: { not: null }, sequenceNoFromSheet: { not: null } },
      select: { id: true, mhesiCode: true },
    });
    const allAliases = await this.db.programMhesiAlias.findMany({
      select: { mhesiCode: true, programId: true },
    });
    const currIdToProgramId = new Map<string, string>();
    for (const p of allMhesi) {
      if (p.mhesiCode) currIdToProgramId.set(p.mhesiCode, p.id);
    }
    for (const a of allAliases) {
      // Aliases never override primary mhesiCode.
      if (!currIdToProgramId.has(a.mhesiCode)) {
        currIdToProgramId.set(a.mhesiCode, a.programId);
      }
    }
    ctx.log.info(`built CURR_ID → programId map: ${currIdToProgramId.size} entries`);

    this.runState = {
      fetchTimestamp,
      currIdToProgramId,
      unmappedCurrIds: new Set(),
      loaded: 0,
    };

    return rows.map((r): RawRecord => ({
      externalId: `${r.CURR_ID}|${r.ROUND}|${r.ACADYEAR}`,
      data: r,
      sourceTimestamp: r.UPDATED_AT ?? fetchTimestamp,
    }));
  }

  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    if (!this.runState) {
      throw new NonRetryableError('NO_RUN_STATE', 'transform called before fetch');
    }
    const r = raw.data as FunnelRow;
    const programId = this.runState.currIdToProgramId.get(r.CURR_ID);
    if (!programId) {
      this.runState.unmappedCurrIds.add(r.CURR_ID);
    }
    return [
      {
        target: 'tcas_admission_funnels',
        externalId: raw.externalId,
        payload: { row: r, programId: programId ?? null } as unknown as Record<string, unknown>,
        freshnessDate: raw.sourceTimestamp,
      },
    ];
  }

  async load(ctx: ConnectorContext, normalized: NormalizedRecord[]): Promise<LoadResult> {
    if (!this.runState) {
      throw new NonRetryableError('NO_RUN_STATE', 'load called before fetch');
    }
    const fetchTimestamp = this.runState.fetchTimestamp;

    // Concurrent upserts in chunks of 50 — matches the kku-finance
    // pattern. Keeps the connection pool comfortable.
    const CHUNK = 50;
    for (let i = 0; i < normalized.length; i += CHUNK) {
      const chunk = normalized.slice(i, i + CHUNK);
      await Promise.all(
        chunk.map(async (n) => {
          const { row, programId } = n.payload as {
            row: FunnelRow;
            programId: string | null;
          };
          const data = {
            programId,
            mhesiCurrId: row.CURR_ID,
            round: row.ROUND,
            entryYearBE: row.ACADYEAR,
            enrollSeats: row.ENROLL_SEATS,
            planPerYear: row.PLAN_PER_YEAR,
            totalApplicants: row.TOTAL_APPLICANTS,
            totalPassed: row.TOTAL_PASSED,
            sendClearinghouse: row.SEND_CLEARINGHOUSE,
            confirmClearinghouse: row.CONFIRM_CLEARINGHOUSE,
            sendRegReported: row.SEND_REG_REPORTED,
            regReported: row.REG_REPORTED,
            // Use the row's UPDATED_AT when present, else the run's
            // fetch timestamp. Cast to date-only since the column is
            // @db.Date.
            freshnessDate: row.UPDATED_AT ?? fetchTimestamp,
            source: 'kku-tcas-funnel',
            ingestionRunId: ctx.runId,
          };
          await this.db.tcasAdmissionFunnel.upsert({
            where: {
              mhesiCurrId_round_entryYearBE: {
                mhesiCurrId: row.CURR_ID,
                round: row.ROUND,
                entryYearBE: row.ACADYEAR,
              },
            },
            create: data,
            update: data,
          });
        }),
      );
      this.runState.loaded += chunk.length;
    }

    const unmappedSamples = Array.from(this.runState.unmappedCurrIds).slice(0, 30);
    ctx.log.info(
      `loaded ${this.runState.loaded.toLocaleString()} rows; ` +
        `unmapped CURR_IDs: ${this.runState.unmappedCurrIds.size}`,
    );

    return {
      recordsFetched: normalized.length,
      recordsLoaded: this.runState.loaded,
      recordsFailed: 0,
      metadata: {
        fetchedAt: fetchTimestamp.toISOString(),
        unmappedCurrIdsCount: this.runState.unmappedCurrIds.size,
        unmappedCurrIdSamples: unmappedSamples,
      },
    };
  }
}
