// Processed-HR salary aggregator. Source: mysql://202.28.117.84:3306/person.vw_history.
//
// PII gate: aggregate-at-source via GROUP BY + HAVING n>=5 in the SQL
// itself — per-person salary never crosses the wire. Single grain:
// (fiscalYear × faculty × isAcademic × level × salType). Snapshot
// replace by fiscalYear on every refresh.

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

interface RawCompRow extends Record<string, unknown> {
  faculty: string;
  is_academic: number;
  level: string | null;
  sal_type: string | null;
  headcount: number;
  mean_salary: number;
  min_salary: number;
  max_salary: number;
  sum_salary: number;
}

interface RawLifecycleRow extends Record<string, unknown> {
  // Server-side hashing (SHA2) isn't available on this old MySQL build,
  // so the raw identification briefly enters our process during fetch.
  // We immediately drop it in transform() and persist only the hash.
  identification: string;
  birth_year_be: number | null;
  retire_year_be: number | null;
  sixty_year_be: number | null;
}

interface RunState {
  fiscalYear: number;
  fetchedAt: Date;
  fetchedCount: number;
  lifecycleCount: number;
}

const SOURCE_TABLE = 'vw_history';

export class KkuHrProcessedRealConnector extends ApiConnector implements Connector {
  readonly slug = 'kku-hr-processed';
  readonly mocked = false;

  private runState: RunState | null = null;

  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    try {
      const cfg = configFromEnv('KKU_HR_PROCESSED_DB');
      await withConnection(cfg, async (conn) => query(conn, 'SELECT 1 AS ok'));
      return { ok: true, message: `${cfg.user}@${cfg.host}:${cfg.port}/${cfg.database}` };
    } catch (err) {
      return { ok: false, message: (err as Error).message };
    }
  }

  async fetch(ctx: ConnectorContext): Promise<RawRecord[]> {
    const cfg = configFromEnv('KKU_HR_PROCESSED_DB');
    const { compRows, lifecycleRows } = await withConnection(cfg, async (conn) => {
      // Q1 — salary aggregate (HAVING n≥5 server-side; per-person never crosses)
      const compRows = await query<RawCompRow>(
        conn,
        `SELECT
            COALESCE(NULLIF(TRIM(faculty), ''), '∅') AS faculty,
            CASE WHEN posi_academic IS NOT NULL AND posi_academic <> '' THEN 1 ELSE 0 END AS is_academic,
            COALESCE(NULLIF(TRIM(level), ''), '∅') AS level,
            COALESCE(NULLIF(TRIM(sal_type), ''), '∅') AS sal_type,
            COUNT(*) AS headcount,
            AVG(salary) AS mean_salary,
            MIN(salary) AS min_salary,
            MAX(salary) AS max_salary,
            SUM(salary) AS sum_salary
           FROM ${SOURCE_TABLE}
          WHERE salary IS NOT NULL AND salary > 0
          GROUP BY
            COALESCE(NULLIF(TRIM(faculty), ''), '∅'),
            CASE WHEN posi_academic IS NOT NULL AND posi_academic <> '' THEN 1 ELSE 0 END,
            COALESCE(NULLIF(TRIM(level), ''), '∅'),
            COALESCE(NULLIF(TRIM(sal_type), ''), '∅')
         HAVING COUNT(*) >= 5`,
      );

      // Q2 — per-person lifecycle dates. SHA2() isn't available on this
      // legacy MySQL build, so we pull raw identification + year-precision
      // dates only. Hashing happens at the connector boundary in transform();
      // raw identification never reaches the database. Names / salaries /
      // addresses are NEVER in this projection.
      const lifecycleRows = await query<RawLifecycleRow>(
        conn,
        `SELECT
            identification,
            YEAR(birthday)   AS birth_year_be,
            YEAR(retireday)  AS retire_year_be,
            YEAR(sixtyday)   AS sixty_year_be
           FROM ${SOURCE_TABLE}
          WHERE identification IS NOT NULL
            AND identification <> ''`,
      );

      return { compRows, lifecycleRows };
    });

    if (compRows.length === 0) {
      throw new NonRetryableError(
        'EMPTY_DATA',
        'processed-HR aggregate returned 0 rows — refusing to wipe',
      );
    }

    const fiscalYear = new Date().getFullYear() + 543;
    this.runState = {
      fiscalYear,
      fetchedAt: new Date(),
      fetchedCount: compRows.length,
      lifecycleCount: lifecycleRows.length,
    };
    ctx.log.info(
      `processed-HR: ${compRows.length} comp cells (n≥5) + ${lifecycleRows.length} lifecycle rows`,
    );

    const ts = this.runState.fetchedAt;
    const compRecords: RawRecord[] = compRows.map((r, i) => ({
      externalId: `comp|${fiscalYear}|${r.faculty}|${r.is_academic}|${r.level ?? '∅'}|${r.sal_type ?? '∅'}|${i}`,
      data: { ...r, __target: 'comp' as const },
      sourceTimestamp: ts,
    }));
    const lifecycleRecords: RawRecord[] = lifecycleRows.map((r) => ({
      externalId: `life|${r.citizen_id_hash}`,
      data: { ...r, __target: 'lifecycle' as const },
      sourceTimestamp: ts,
    }));
    return [...compRecords, ...lifecycleRecords];
  }

  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    if (!this.runState) return [];
    const data = raw.data as { __target: 'comp' | 'lifecycle' } & Record<string, unknown>;

    if (data.__target === 'lifecycle') {
      const r = data as unknown as RawLifecycleRow;
      // Hash at boundary; raw identification dropped from scope after this.
      const citizenIdHash = hashCitizenId(r.identification);
      if (!citizenIdHash) return [];
      function toAd(beYear: number | null | undefined): number | null {
        if (beYear === null || beYear === undefined) return null;
        const n = Number(beYear);
        if (!Number.isFinite(n) || n <= 0) return null;
        return n > 2400 ? n - 543 : n;
      }
      return [
        {
          target: 'staff_lifecycle_dates',
          externalId: `life|${citizenIdHash}`,
          payload: {
            citizenIdHash,
            birthYearAd: toAd(r.birth_year_be),
            retireYearAd: toAd(r.retire_year_be),
            sixtyYearAd: toAd(r.sixty_year_be),
          },
          freshnessDate: raw.sourceTimestamp,
        },
      ];
    }

    // Default: salary-aggregate cell
    const r = data as unknown as RawCompRow;
    return [
      {
        target: 'staff_compensation_cube',
        externalId: raw.externalId,
        payload: {
          fiscalYear: this.runState.fiscalYear,
          facultyName: r.faculty,
          isAcademic: r.is_academic === 1,
          level: r.level,
          salType: r.sal_type,
          headcount: Number(r.headcount),
          meanSalary: Number(r.mean_salary),
          minSalary: Number(r.min_salary),
          maxSalary: Number(r.max_salary),
          sumSalary: Number(r.sum_salary),
        },
        freshnessDate: raw.sourceTimestamp,
      },
    ];
  }

  async load(ctx: ConnectorContext, normalized: NormalizedRecord[]): Promise<LoadResult> {
    if (!this.runState) throw new Error('runState missing');
    const { fiscalYear } = this.runState;

    // Split by target
    const compRecords = normalized.filter((n) => n.target === 'staff_compensation_cube');
    const lifecycleRecords = normalized.filter((n) => n.target === 'staff_lifecycle_dates');

    // ── Compensation cube ──────────────────────────────────────────
    const facultyNames = [
      ...new Set(compRecords.map((n) => (n.payload as { facultyName: string }).facultyName)),
    ];
    const faculties = await prisma.faculty.findMany({
      where: { nameTh: { in: facultyNames } },
      select: { id: true, nameTh: true },
    });
    const nameToId = new Map(faculties.map((f) => [f.nameTh, f.id]));

    const deleted = await prisma.staffCompensationCube.deleteMany({ where: { fiscalYear } });
    ctx.log.info(`deleted ${deleted.count} prior comp rows for fiscal year ${fiscalYear}`);

    let compInserted = 0;
    const CHUNK = 500;
    for (let i = 0; i < compRecords.length; i += CHUNK) {
      const slice = compRecords.slice(i, i + CHUNK);
      const data = slice.map((n) => {
        const p = n.payload as {
          fiscalYear: number;
          facultyName: string;
          isAcademic: boolean;
          level: string | null;
          salType: string | null;
          headcount: number;
          meanSalary: number;
          minSalary: number;
          maxSalary: number;
          sumSalary: number;
        };
        return {
          fiscalYear: p.fiscalYear,
          facultyName: p.facultyName,
          facultyId: nameToId.get(p.facultyName) ?? null,
          isAcademic: p.isAcademic,
          level: p.level,
          salType: p.salType,
          headcount: p.headcount,
          meanSalary: p.meanSalary,
          minSalary: p.minSalary,
          maxSalary: p.maxSalary,
          sumSalary: p.sumSalary,
          ingestionRunId: ctx.runId,
        };
      });
      const result = await prisma.staffCompensationCube.createMany({ data, skipDuplicates: true });
      compInserted += result.count;
    }

    // ── Lifecycle dates ───────────────────────────────────────────
    // Snapshot replace: wipe everything tagged with this source, then
    // insert fresh. citizen_id_hash is the PK so we can't naively
    // createMany if any existed already.
    const lifeDeleted = await prisma.staffLifecycleDates.deleteMany({ where: { source: 'kku-hr-processed' } });
    ctx.log.info(`deleted ${lifeDeleted.count} prior lifecycle rows`);

    let lifeInserted = 0;
    for (let i = 0; i < lifecycleRecords.length; i += CHUNK) {
      const slice = lifecycleRecords.slice(i, i + CHUNK);
      const data = slice.map((n) => {
        const p = n.payload as {
          citizenIdHash: string;
          birthYearAd: number | null;
          retireYearAd: number | null;
          sixtyYearAd: number | null;
        };
        return {
          citizenIdHash: p.citizenIdHash,
          birthYearAd: p.birthYearAd,
          retireYearAd: p.retireYearAd,
          sixtyYearAd: p.sixtyYearAd,
          source: 'kku-hr-processed',
        };
      });
      const result = await prisma.staffLifecycleDates.createMany({ data, skipDuplicates: true });
      lifeInserted += result.count;
    }

    return {
      recordsFetched: this.runState.fetchedCount + this.runState.lifecycleCount,
      recordsLoaded: compInserted + lifeInserted,
      recordsFailed: 0,
      metadata: {
        fiscalYear,
        compensationCells: compInserted,
        lifecycleRows: lifeInserted,
        facultiesResolved: facultyNames.filter((n) => nameToId.has(n)).length,
        facultiesUnresolved: facultyNames.filter((n) => !nameToId.has(n)).length,
      },
    };
  }
}
