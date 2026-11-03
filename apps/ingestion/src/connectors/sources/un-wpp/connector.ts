import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';

import { prisma } from '@kku/db';
import {
  outboundUserAgent,
  type ConnectorContext,
  type HealthStatus,
  type LoadResult,
  type NormalizedRecord,
  type RawRecord,
} from '@kku/shared';
import { ApiConnector } from '../../base/api-connector';
import { NonRetryableError } from '../../base/base-connector';
import {
  UN_WPP_SOURCE,
  WppSchemaError,
  aggregateWppLines,
  gunzipLines,
  type WppCohortRow,
} from './transforms';

// ─────────────────────────────────────────────────────────────────────────────
// UN World Population Prospects 2024 — national population projection.
//
// One public bulk CSV (no credential, ~68 MB gzipped), streamed through
// gunzip and read line by line, so the file is never held in memory. Keeps one
// country (UN_WPP_COUNTRY_ISO3, default THA), the Medium variant, and the
// current year through +25, summed into the 15-17, 18-22 and 23-29 cohorts.
//
// Writes region 'TH' only: the UN publishes national figures, so a regional
// score driver needs the Population Projections spreadsheet instead (the
// source picker, projection-source.ts, prefers a spreadsheet over this).
//
// SNAPSHOT semantics: each run replaces its own previous rows (same source,
// stamped with a run of this data source) in one transaction, and nothing
// else. Rows from the NESDC seed or a spreadsheet are never touched.
// ─────────────────────────────────────────────────────────────────────────────

export const UN_WPP_DEFAULT_URL =
  'https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_Population1JanuaryBySingleAgeSex_Medium_2024-2100.csv.gz';
const SLUG = 'un-wpp';
const HORIZON_YEARS = 25;
const HEALTH_TIMEOUT_MS = 10_000;
const DOWNLOAD_TIMEOUT_MS = 15 * 60_000;

function csvUrl(): string {
  return process.env.UN_WPP_CSV_URL?.trim() || UN_WPP_DEFAULT_URL;
}
function countryIso3(): string {
  return process.env.UN_WPP_COUNTRY_ISO3?.trim().toUpperCase() || 'THA';
}

export class UnWppConnector extends ApiConnector {
  readonly slug = SLUG;
  readonly mocked = false;

  override async healthCheck(_ctx: ConnectorContext): Promise<HealthStatus> {
    const start = Date.now();
    try {
      const res = await fetch(csvUrl(), {
        method: 'HEAD',
        signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
        headers: { 'user-agent': outboundUserAgent() },
      });
      return {
        ok: res.ok,
        message: res.ok ? 'UN WPP file reachable' : `HTTP ${res.status}`,
        latencyMs: Date.now() - start,
      };
    } catch (err) {
      return {
        ok: false,
        message: err instanceof Error ? err.message : String(err),
        latencyMs: Date.now() - start,
      };
    }
  }

  async fetch(ctx: ConnectorContext, _since?: Date): Promise<RawRecord[]> {
    const nowYear = new Date().getUTCFullYear();
    const iso3 = countryIso3();
    const res = await fetch(csvUrl(), {
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
      headers: { 'user-agent': outboundUserAgent() },
    });
    if (!res.ok || !res.body) {
      throw new Error(`UN WPP download failed: HTTP ${res.status}`);
    }
    let rows: WppCohortRow[];
    try {
      const body = Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
      rows = await aggregateWppLines(gunzipLines(body), {
        iso3,
        fromYear: nowYear,
        toYear: nowYear + HORIZON_YEARS,
      });
    } catch (err) {
      if (err instanceof WppSchemaError) {
        throw new NonRetryableError('SCHEMA_DRIFT', err.message);
      }
      throw err;
    }
    if (rows.length === 0) {
      throw new NonRetryableError(
        'NO_ROWS',
        `The UN WPP file held no Medium-variant rows for ${iso3} in ${nowYear}-${nowYear + HORIZON_YEARS}. ` +
          'Check UN_WPP_COUNTRY_ISO3.',
      );
    }
    ctx.log.info('UN WPP aggregated', { iso3, rows: rows.length });
    const fetchedAt = new Date();
    return rows.map((row) => ({
      externalId: `${UN_WPP_SOURCE}-${iso3}-${row.year}-${row.ageCohort}`,
      sourceTimestamp: fetchedAt,
      data: row,
    }));
  }

  async transform(_ctx: ConnectorContext, raw: RawRecord): Promise<NormalizedRecord[]> {
    const row = raw.data as WppCohortRow;
    return [
      {
        target: 'demographic_projections',
        externalId: raw.externalId,
        payload: { region: 'TH', year: row.year, ageCohort: row.ageCohort, population: row.population },
        freshnessDate: raw.sourceTimestamp,
      },
    ];
  }

  async load(ctx: ConnectorContext, normalized: NormalizedRecord[]): Promise<LoadResult> {
    const freshnessDate = new Date();
    const deleted = await prisma.$transaction(async (tx) => {
      const runs = await tx.ingestionRun.findMany({
        where: { dataSource: { slug: SLUG } },
        select: { id: true },
      });
      const removed = await tx.demographicProjection.deleteMany({
        where: { source: UN_WPP_SOURCE, ingestionRunId: { in: runs.map((r) => r.id) } },
      });
      for (const n of normalized) {
        const p = n.payload as { region: string; year: number; ageCohort: string; population: number };
        const key = { region: p.region, year: p.year, ageCohort: p.ageCohort, source: UN_WPP_SOURCE };
        await tx.demographicProjection.upsert({
          where: { region_year_ageCohort_source: key },
          create: { ...key, population: p.population, freshnessDate, ingestionRunId: ctx.runId },
          update: { population: p.population, freshnessDate, ingestionRunId: ctx.runId },
        });
      }
      return removed.count;
    });
    return {
      recordsFetched: normalized.length,
      recordsLoaded: normalized.length,
      recordsFailed: 0,
      metadata: { country: countryIso3(), source: UN_WPP_SOURCE, replacedPreviousRows: deleted },
    };
  }
}
