// UNICON DS2003 — Education qualifications of all employees.
// Source: mysql://10.101.106.44:3310/UNICON_STAFF_KKU.DS2003
//
// One row per (staff × degree). 18,060 rows in current snapshot
// (AY 2568 sem 2). Schema is well-defined but several reference
// columns are sparsely populated:
//   - GRAD_LEV_ID: 65% blank ('-' or NULL); we derive level from
//     GRAD_CURR (Thai degree-name string matching) when missing
//   - GRAD_ISCED_ID: 100% blank in current data; persisted for the
//     day KKU re-codes their historical records
//
// PDPA: hash CITIZEN_ID via the canonical hashCitizenId() helper at
// the connector boundary; raw never persists.
//
// Idempotency: each daily run captures the current AY+sem snapshot.
// load() deletes rows for the same (academicYear, semester, source)
// scope before inserting — older AY snapshots retained for history.

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

interface RawDs2003Row extends Record<string, unknown> {
  ACADEMIC_YEAR: string;
  SEMESTER: string;
  UNIV_ID: string;
  CITIZEN_ID: string;
  GRAD_YEAR: string | null;
  GRAD_LEV_ID: string | null;
  GRAD_CURR: string | null;
  GRAD_ISCED_ID: string | null;
  GRAD_PROG: string | null;
  GRAD_UNIV: string | null;
  GRAD_COUNTRY_ID: string | null;
}

interface NormalizedPayload {
  citizenIdHash: string;
  academicYear: string;
  semester: string;
  univId: string;
  gradYear: string | null;
  gradLevelId: string | null;
  gradLevelName: string | null;
  gradCurriculum: string | null;
  gradIscedId: string | null;
  gradProgram: string | null;
  gradInstitute: string | null;
  gradCountryId: string | null;
}

interface RunState {
  academicYear: string;
  semester: string;
  fetchedAt: Date;
  fetchedCount: number;
  byCountry: Record<string, number>;
  derivedLevelCount: number;
  unhashableRows: number;
}

// Derive education level from the Thai degree-name string when GRAD_LEV_ID
// is missing. Order matters — check more-specific Thai keywords first.
function deriveLevelFromCurriculum(curr: string | null): string | null {
  if (!curr) return null;
  const c = curr;
  if (c.includes('ดุษฎีบัณฑิต') || /\bPh\.?\s*D\b/i.test(c) || /\bDoctor\b/i.test(c)) return 'ปริญญาเอก';
  if (c.includes('มหาบัณฑิต') || /\bMaster\b/i.test(c)) return 'ปริญญาโท';
  if (c.includes('ประกาศนียบัตรบัณฑิตชั้นสูง')) return 'ประกาศนียบัตรบัณฑิตชั้นสูง';
  if (c.includes('ประกาศนียบัตรบัณฑิต')) return 'ประกาศนียบัตรบัณฑิต';
  if (c.includes('บัณฑิต') || /\bBachelor\b/i.test(c)) return 'ปริญญาตรี';
  if (c.includes('อนุปริญญา')) return 'อนุปริญญา';
  return null;
}

export class UniconDs2003RealConnector extends ApiConnector implements Connector {
  readonly slug = 'unicon-ds2003';
  readonly mocked = false;

  private runState: RunState | null = null;

  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    try {
      const cfg = configFromEnv('UNICON_DS2003_DB');
      await withConnection(cfg, async (conn) => query(conn, 'SELECT 1 AS ok'));
      return { ok: true, message: `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  async fetch(ctx: ConnectorContext): Promise<RawRecord[]> {
    const cfg = configFromEnv('UNICON_DS2003_DB');
    const rows = await withConnection(cfg, (conn) =>
      query<RawDs2003Row>(
        conn,
        `SELECT ACADEMIC_YEAR, SEMESTER, UNIV_ID, CITIZEN_ID,
                GRAD_YEAR, GRAD_LEV_ID, GRAD_CURR, GRAD_ISCED_ID,
                GRAD_PROG, GRAD_UNIV, GRAD_COUNTRY_ID
           FROM DS2003`,
      ),
    );

    if (rows.length === 0) {
      throw new NonRetryableError(
        'EMPTY_DATA',
        'DS2003 returned 0 rows — refusing to wipe existing snapshot',
      );
    }

    const academicYear = rows[0]!.ACADEMIC_YEAR;
    const semester = rows[0]!.SEMESTER;
    this.runState = {
      academicYear,
      semester,
      fetchedAt: new Date(),
      fetchedCount: rows.length,
      byCountry: {},
      derivedLevelCount: 0,
      unhashableRows: 0,
    };
    for (const r of rows) {
      const c = r.GRAD_COUNTRY_ID ?? '∅';
      this.runState.byCountry[c] = (this.runState.byCountry[c] ?? 0) + 1;
    }
    ctx.log.info(`DS2003 fetched ${rows.length} rows for AY ${academicYear} sem ${semester}`);

    const ts = this.runState.fetchedAt;
    return rows.map((r) => ({
      externalId: `${r.CITIZEN_ID}|${r.GRAD_CURR ?? ''}|${r.GRAD_UNIV ?? ''}|${r.GRAD_YEAR ?? ''}`,
      data: r,
      sourceTimestamp: ts,
    }));
  }

  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    const r = raw.data as RawDs2003Row;
    const hash = hashCitizenId(r.CITIZEN_ID);
    if (!hash) {
      if (this.runState) this.runState.unhashableRows += 1;
      return [];
    }

    let levelId: string | null = r.GRAD_LEV_ID && r.GRAD_LEV_ID !== '-' ? r.GRAD_LEV_ID : null;
    let levelName: string | null = null;
    if (!levelId) {
      levelName = deriveLevelFromCurriculum(r.GRAD_CURR);
      if (levelName && this.runState) this.runState.derivedLevelCount += 1;
    }

    const payload: NormalizedPayload = {
      citizenIdHash: hash,
      academicYear: r.ACADEMIC_YEAR,
      semester: r.SEMESTER,
      univId: r.UNIV_ID,
      gradYear: r.GRAD_YEAR ?? null,
      gradLevelId: levelId,
      gradLevelName: levelName,
      gradCurriculum: r.GRAD_CURR,
      gradIscedId: r.GRAD_ISCED_ID && r.GRAD_ISCED_ID !== '--' ? r.GRAD_ISCED_ID : null,
      gradProgram: r.GRAD_PROG,
      gradInstitute: r.GRAD_UNIV,
      gradCountryId: r.GRAD_COUNTRY_ID,
    };

    return [
      {
        target: 'staff_education_history',
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

    // Snapshot replace: delete the current AY+sem rows for this source,
    // then insert fresh. Older AY snapshots are preserved.
    const deleted = await prisma.staffEducationHistory.deleteMany({
      where: { source: this.slug, academicYear, semester },
    });
    ctx.log.info(`deleted ${deleted.count} prior rows for AY ${academicYear} sem ${semester}`);

    let inserted = 0;
    const CHUNK = 1000;
    for (let i = 0; i < normalized.length; i += CHUNK) {
      const slice = normalized.slice(i, i + CHUNK);
      const data = slice.map((n) => {
        const p = n.payload as unknown as NormalizedPayload;
        return {
          citizenIdHash: p.citizenIdHash,
          source: this.slug,
          academicYear: p.academicYear,
          semester: p.semester,
          univId: p.univId,
          gradYear: p.gradYear,
          gradLevelId: p.gradLevelId,
          gradLevelName: p.gradLevelName,
          gradCurriculum: p.gradCurriculum,
          gradIscedId: p.gradIscedId,
          gradProgram: p.gradProgram,
          gradInstitute: p.gradInstitute,
          gradCountryId: p.gradCountryId,
          ingestionRunId: ctx.runId,
        };
      });
      const result = await prisma.staffEducationHistory.createMany({ data, skipDuplicates: true });
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
        academicYear,
        semester,
        unhashableRows: this.runState.unhashableRows,
        derivedLevelCount: this.runState.derivedLevelCount,
        distinctStaff,
        topCountries: Object.entries(this.runState.byCountry)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 8)
          .map(([k, v]) => ({ country: k, count: v })),
      },
    };
  }
}
