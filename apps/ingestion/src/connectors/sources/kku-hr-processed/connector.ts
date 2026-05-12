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
  // Full dates from vw_history (added 2026-05-12). The connector
  // computes year-AD locally for backward compat with the year columns.
  birthday: Date | string | null;
  putday: Date | string | null;
  retireday: Date | string | null;
  sixtyday: Date | string | null;
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
      // legacy MySQL build, so we pull raw identification + dates only.
      // Hashing happens at the connector boundary in transform(); raw
      // identification never reaches the database. Names / salaries /
      // addresses are NEVER in this projection.
      //
      // 2026-05-12: full-date precision (was YEAR(...)). Powers
      // FacultyMember.retirementDate / hireDate enrichment (deep-dive
      // bug fix) + month-precision workforce viz.
      //   putday    = date the person joined KKU (authoritative hire date)
      //   retireday = scheduled mandatory-retirement date
      //   sixtyday  = date the person turns 60 (= retireday for most)
      const lifecycleRows = await query<RawLifecycleRow>(
        conn,
        `SELECT
            identification,
            birthday,
            putday,
            retireday,
            sixtyday
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

      // Normalise dates. vw_history stores dates in CE (Gregorian) by
      // observation — older rows may also carry BE-era years. Detect
      // and convert if the year ≥ 2400 (impossible for a real birth/
      // hire date in CE).
      function toAdDate(v: Date | string | null | undefined): Date | null {
        if (v === null || v === undefined) return null;
        const d = v instanceof Date ? v : new Date(v);
        if (Number.isNaN(d.getTime())) return null;
        const year = d.getUTCFullYear();
        // Sanity: anything 2400+ must be BE — shift by 543 years.
        if (year >= 2400) {
          return new Date(Date.UTC(year - 543, d.getUTCMonth(), d.getUTCDate()));
        }
        // Anything < 1900 is corrupt (vw_history sometimes has 0001-01-01
        // placeholders for missing dates).
        if (year < 1900) return null;
        return new Date(Date.UTC(year, d.getUTCMonth(), d.getUTCDate()));
      }
      const birthDate = toAdDate(r.birthday);
      const hireDate = toAdDate(r.putday);
      const retireDate = toAdDate(r.retireday);
      const sixtyDate = toAdDate(r.sixtyday);

      return [
        {
          target: 'staff_lifecycle_dates',
          externalId: `life|${citizenIdHash}`,
          payload: {
            citizenIdHash,
            birthYearAd: birthDate?.getUTCFullYear() ?? null,
            retireYearAd: retireDate?.getUTCFullYear() ?? null,
            sixtyYearAd: sixtyDate?.getUTCFullYear() ?? null,
            birthDate,
            hireDate,
            retireDate,
            sixtyDate,
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
          birthDate: Date | null;
          hireDate: Date | null;
          retireDate: Date | null;
          sixtyDate: Date | null;
        };
        return {
          citizenIdHash: p.citizenIdHash,
          birthYearAd: p.birthYearAd,
          retireYearAd: p.retireYearAd,
          sixtyYearAd: p.sixtyYearAd,
          birthDate: p.birthDate,
          hireDate: p.hireDate,
          retireDate: p.retireDate,
          sixtyDate: p.sixtyDate,
          source: 'kku-hr-processed',
        };
      });
      const result = await prisma.staffLifecycleDates.createMany({ data, skipDuplicates: true });
      lifeInserted += result.count;
    }

    // ── FacultyMember enrichment (2026-05-12 bug fix) ────────────────
    // MSSQL HCMEmployee.RESIGNDATE is null for active staff — only
    // filled post-resignation. The processed-HR vw_history.retireday
    // is the authoritative scheduled-retirement source. Sync it (plus
    // hireDate from putday) back to FacultyMember via citizenIdHash
    // match. Updates are NOT destructive: we ALWAYS update retirementDate
    // (lifecycle is authoritative), but only fill hireDate when it's
    // currently null (preserve the HR-connector's value when the
    // processed-HR putday is missing or has the same date).
    let enrichedRetirement = 0;
    let enrichedHire = 0;
    const lifecycleByHash = new Map<string, { retireDate: Date | null; hireDate: Date | null }>();
    for (const n of lifecycleRecords) {
      const p = n.payload as { citizenIdHash: string; retireDate: Date | null; hireDate: Date | null };
      lifecycleByHash.set(p.citizenIdHash, { retireDate: p.retireDate, hireDate: p.hireDate });
    }
    // Only consider FacultyMembers that have a citizenIdHash (the link key).
    const matchedMembers = await prisma.facultyMember.findMany({
      where: { citizenIdHash: { in: [...lifecycleByHash.keys()] } },
      select: { id: true, citizenIdHash: true, hireDate: true },
    });
    for (const fm of matchedMembers) {
      const life = lifecycleByHash.get(fm.citizenIdHash!);
      if (!life) continue;
      const updates: { retirementDate?: Date | null; hireDate?: Date | null } = {};
      if (life.retireDate) {
        updates.retirementDate = life.retireDate;
        enrichedRetirement += 1;
      }
      // Hire date: only fill when currently null. Don't overwrite — the
      // MSSQL HCM STARTDATE has been observed reliable for most rows
      // and we don't want a vw_history quirk to clobber it.
      if (life.hireDate && !fm.hireDate) {
        updates.hireDate = life.hireDate;
        enrichedHire += 1;
      }
      if (Object.keys(updates).length > 0) {
        await prisma.facultyMember.update({ where: { id: fm.id }, data: updates });
      }
    }
    ctx.log.info(
      `FacultyMember enrichment: ${enrichedRetirement} retirementDate, ${enrichedHire} hireDate (of ${matchedMembers.length} matched by citizenIdHash)`,
    );

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
