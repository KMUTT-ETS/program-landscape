// UNICON DS2004 — Academic staff per program (curriculum).
// Source: mysql://10.130.2.156:3306/reg_unicon.ds2004_<YYSEM>
//
// One row per (staff × program × teach_type). The naming convention
// `ds2004_<YYSEM>` uses BE last-2-digits + semester (e.g., `682` =
// AY 2568 sem 2, `672` = AY 2567 sem 2). The connector resolves the
// MAX(suffix) at runtime so it always reads the latest snapshot.
//
// Note: the documented `view_ds2004_682` filters to TEACH_TYPE_ID=3 only
// (responsible lecturer) — the underlying TABLE has all 3 teach types,
// which is what we want.
//
//   1 = อาจารย์ประจำ            (regular faculty)
//   2 = อาจารย์ประจำหลักสูตร     (curriculum lecturer)
//   3 = อาจารย์ผู้รับผิดชอบหลักสูตร (responsible lecturer / 5-person committee)
//
// CURR_ID = MHESI curriculum ID = `Program.mhesiCode`. Resolution is
// done in load() via a single batch lookup; unmatched rows persist
// with `programId = NULL` and `mhesiCurrId` for analyst follow-up.
//
// PDPA: same treatment as DS2003 — hash CITIZEN_ID at the boundary.

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

interface RawDs2004Row extends Record<string, unknown> {
  ACADEMIC_YEAR: number;
  SEMESTER: number;
  UNIV_ID: string | null;
  CITIZEN_ID: string;
  FAC_ID: string | null;
  CURR_ID: string;
  TEACH_TYPE_ID: number;
}

interface NormalizedPayload {
  citizenIdHash: string;
  mhesiCurrId: string;
  facId: string | null;
  teachTypeId: number;
  academicYear: number;
  semester: number;
  univId: string | null;
}

interface RunState {
  resolvedTable: string;
  academicYear: number;
  semester: number;
  fetchedAt: Date;
  fetchedCount: number;
  byTeachType: Record<number, number>;
  unhashableRows: number;
}

// Resolve the latest ds2004_<YYSEM> base table. The naming convention
// embeds BE-year-last-two-digits + semester, e.g. `682` = AY 2568 sem 2.
async function resolveLatestTable(
  conn: import('mysql2/promise').Connection,
  database: string,
): Promise<{ table: string; academicYear: number; semester: number }> {
  const tables = await query<{ TABLE_NAME: string }>(
    conn,
    `SELECT TABLE_NAME FROM information_schema.TABLES
       WHERE TABLE_SCHEMA = ?
         AND TABLE_TYPE = 'BASE TABLE'
         AND TABLE_NAME REGEXP '^ds2004_[0-9]+$'`,
    [database],
  );
  if (tables.length === 0) {
    throw new NonRetryableError(
      'NO_DS2004_TABLE',
      `No ds2004_<YYSEM> tables found in ${database}`,
    );
  }
  const sorted = tables
    .map((t) => {
      const m = /^ds2004_(\d+)$/.exec(t.TABLE_NAME);
      const suffix = m ? Number(m[1]) : 0;
      return { name: t.TABLE_NAME, suffix };
    })
    .sort((a, b) => b.suffix - a.suffix);
  const winner = sorted[0]!;
  const sStr = String(winner.suffix);
  const sem = Number(sStr.slice(-1));
  const ayLast2 = Number(sStr.slice(0, -1));
  const academicYear = 2500 + ayLast2;
  return { table: winner.name, academicYear, semester: sem };
}

export class UniconDs2004RealConnector extends ApiConnector implements Connector {
  readonly slug = 'unicon-ds2004';
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
    const { rows, table, academicYear, semester } = await withConnection(cfg, async (conn) => {
      const resolved = await resolveLatestTable(conn, cfg.database);
      const fetched = await query<RawDs2004Row>(
        conn,
        `SELECT ACADEMIC_YEAR, SEMESTER, UNIV_ID, CITIZEN_ID,
                FAC_ID, CURR_ID, TEACH_TYPE_ID
           FROM \`${resolved.table}\``,
      );
      return { rows: fetched, ...resolved };
    });

    if (rows.length === 0) {
      throw new NonRetryableError(
        'EMPTY_DATA',
        `${table} returned 0 rows — refusing to wipe existing snapshot`,
      );
    }

    this.runState = {
      resolvedTable: table,
      academicYear,
      semester,
      fetchedAt: new Date(),
      fetchedCount: rows.length,
      byTeachType: {},
      unhashableRows: 0,
    };
    for (const r of rows) {
      this.runState.byTeachType[r.TEACH_TYPE_ID] =
        (this.runState.byTeachType[r.TEACH_TYPE_ID] ?? 0) + 1;
    }
    ctx.log.info(
      `DS2004 fetched ${rows.length} rows from ${table} (AY ${academicYear} sem ${semester})`,
    );

    const ts = this.runState.fetchedAt;
    return rows.map((r) => ({
      externalId: `${r.ACADEMIC_YEAR}|${r.SEMESTER}|${r.CITIZEN_ID}|${r.CURR_ID}|${r.TEACH_TYPE_ID}`,
      data: r,
      sourceTimestamp: ts,
    }));
  }

  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    const r = raw.data as RawDs2004Row;
    const hash = hashCitizenId(r.CITIZEN_ID);
    if (!hash) {
      if (this.runState) this.runState.unhashableRows += 1;
      return [];
    }

    const payload: NormalizedPayload = {
      citizenIdHash: hash,
      mhesiCurrId: r.CURR_ID,
      facId: r.FAC_ID,
      teachTypeId: r.TEACH_TYPE_ID,
      academicYear: r.ACADEMIC_YEAR,
      semester: r.SEMESTER,
      univId: r.UNIV_ID,
    };

    return [
      {
        target: 'staff_program_assignment',
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

    // Resolve mhesiCurrId → programId via two lookup paths in priority
    // order:
    //   1. Program.mhesiCode (the canonical primary)
    //   2. ProgramMhesiAlias (multiple CURR_IDs ↔ one Program;
    //      populated by the reconcile script for Thai/International
    //      program-mode variants and curriculum-revision codes)
    const distinctCurrIds = [
      ...new Set(normalized.map((n) => (n.payload as unknown as NormalizedPayload).mhesiCurrId)),
    ];
    const programs = await prisma.program.findMany({
      where: { mhesiCode: { in: distinctCurrIds } },
      select: { id: true, mhesiCode: true },
    });
    const aliases = await prisma.programMhesiAlias.findMany({
      where: { mhesiCode: { in: distinctCurrIds } },
      select: { programId: true, mhesiCode: true },
    });
    // mhesiCode is NOT unique on Program (intentionally — the seed
    // sheet reuses codes between BSc/MSc variants). When multiple
    // Programs match a CURR_ID, we link to the first; aliases are
    // unique by mhesiCode so they always resolve cleanly.
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
    let ambiguousCount = 0;
    const unresolvedSamples = new Set<string>();

    // Snapshot replace by (academicYear, semester) — same scope rule
    // as DS2003.
    const deleted = await prisma.staffProgramAssignment.deleteMany({
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
          if (matches.length > 1) ambiguousCount += 1;
        }
        return {
          citizenIdHash: p.citizenIdHash,
          programId,
          mhesiCurrId: p.mhesiCurrId,
          facId: p.facId,
          teachTypeId: p.teachTypeId,
          academicYear: p.academicYear,
          semester: p.semester,
          univId: p.univId,
          ingestionRunId: ctx.runId,
        };
      });
      const result = await prisma.staffProgramAssignment.createMany({
        data,
        skipDuplicates: true,
      });
      inserted += result.count;
    }

    const distinctStaff = new Set(
      normalized.map((n) => (n.payload as unknown as NormalizedPayload).citizenIdHash),
    ).size;

    return {
      recordsFetched: this.runState.fetchedCount,
      recordsLoaded: inserted,
      recordsFailed: this.runState.unhashableRows,
      metadata: {
        sourceTable: this.runState.resolvedTable,
        academicYear,
        semester,
        byTeachType: this.runState.byTeachType,
        distinctStaff,
        distinctCurrIds: distinctCurrIds.length,
        programResolution: {
          resolved: resolvedCount,
          unresolved: unresolvedCount,
          ambiguous: ambiguousCount,
        },
        unresolvedCurrIdSamples: [...unresolvedSamples],
        unhashableRows: this.runState.unhashableRows,
      },
    };
  }
}
