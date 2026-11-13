import { importDataSourceSlug } from '@kku/db';
import type { SourceCatalogEntry } from '@kku/shared';
import { z } from 'zod';

import { DatasetApiConnector } from '../../connectors/base/dataset-api-connector';
import type { ConnectorEntry } from '../../connectors/registry';
import type { CheckId, CheckResult, RunSummary, VerifyReader, VerifyTarget } from './types';

export interface VerifyDeps {
  entries: readonly ConnectorEntry[];
  catalog: readonly SourceCatalogEntry[];
  env: Readonly<Record<string, string | undefined>>;
  reader: VerifyReader;
}

const PER_DATASET: readonly CheckId[] = ['provenance', 'visible', 'reaches-programme'];

/** The run metadata `DatasetApiConnector.load` writes. */
const RunMetadata = z.object({
  datasets: z.record(
    z.object({
      importRunId: z.string().optional(),
      rows: z.number(),
      status: z.enum(['LOADED', 'REFUSED', 'FAILED', 'NOT_RUN']),
    }),
  ),
  errors: z
    .array(
      z.object({
        dataset: z.string(),
        record: z.number(),
        column: z.string().nullable(),
        message: z.string(),
      }),
    )
    .default([]),
});
type RunMetadata = z.infer<typeof RunMetadata>;

function envName(slug: string, name: string): string {
  return `CONNECTOR_${slug.toUpperCase().replace(/-/g, '_')}_${name}`;
}

function skip(id: CheckId, why: string, dataset?: string): CheckResult {
  return { id, status: 'SKIP', reason: `skipped: ${why}`, ...(dataset ? { dataset } : {}) };
}

/**
 * Finds the dataset API connector for `slug`, or a FAIL `registered` result
 * that says why not (and names `api-<slug>` when that would have matched).
 */
export function resolveTarget(
  slug: string,
  entries: readonly ConnectorEntry[],
  catalog: readonly SourceCatalogEntry[],
): VerifyTarget | CheckResult {
  const entry = entries.find((e) => e.slug === slug);
  const catalogued = catalog.some((c) => c.slug === slug);
  if (!entry || !catalogued) {
    const alt = `api-${slug}`;
    const hint = entries.some((e) => e.slug === alt) ? ` Did you mean ${alt}?` : '';
    const where = !entry
      ? 'is not in INSTITUTION_CONNECTORS (apps/ingestion/src/connectors/sources/institution/index.ts)'
      : 'is not in INSTITUTION_SOURCES (packages/shared/src/ingestion/institution-catalog.ts)';
    return {
      id: 'registered',
      status: 'FAIL',
      reason: `${slug} ${where}.${hint}`,
      next: hint ? `pnpm connector:verify ${alt}` : 'pnpm connector:new --list',
    };
  }
  const connector = (entry.real ?? entry.mock)();
  if (!(connector instanceof DatasetApiConnector)) {
    return {
      id: 'registered',
      status: 'FAIL',
      reason: `${slug} is not a dataset API connector; connector:verify checks only those.`,
    };
  }
  return { slug, datasets: [...connector.datasets] };
}

function checkEnv(
  slug: string,
  env: VerifyDeps['env'],
  rowBaseUrl: string | null,
): CheckResult {
  const base = envName(slug, 'BASE_URL');
  const token = envName(slug, 'TOKEN');
  if (!env[base] && !rowBaseUrl) {
    return {
      id: 'env',
      status: 'FAIL',
      reason: `No base URL: neither ${base} nor the data source's base URL is set.`,
      next: `set ${base} in .env`,
    };
  }
  if (!env[token]) {
    return {
      id: 'env',
      status: 'WARN',
      reason: `${token} is not set — fine only if the API needs no token.`,
    };
  }
  return { id: 'env', status: 'PASS', reason: `${env[base] ? base : 'data source base URL'} and ${token} are set.` };
}

function checkSources(
  target: VerifyTarget,
  rows: ReadonlyArray<{ slug: string; mocked: boolean }>,
): CheckResult {
  const wanted = [target.slug, ...target.datasets.map(importDataSourceSlug)];
  const missing = wanted.filter((s) => !rows.some((r) => r.slug === s));
  if (missing.length > 0) {
    return {
      id: 'sources',
      status: 'FAIL',
      reason: `No data source row for: ${missing.join(', ')}.`,
      next: 'pnpm data-sources:sync --apply',
    };
  }
  const mocked = rows.filter((r) => wanted.includes(r.slug) && r.mocked).map((r) => r.slug);
  if (mocked.length > 0) {
    return {
      id: 'sources',
      status: 'FAIL',
      reason: `Marked mocked, so their rows are hidden: ${mocked.join(', ')}. Set mocked: false in the catalogue entry.`,
      next: 'pnpm data-sources:sync --apply',
    };
  }
  return { id: 'sources', status: 'PASS', reason: `${wanted.length} data sources exist and are real.` };
}

function checkRun(
  slug: string,
  run: RunSummary | null,
): { result: CheckResult; meta: RunMetadata | null } {
  if (!run) {
    return {
      result: { id: 'latest-run', status: 'FAIL', reason: 'The connector has never run.', next: `pnpm connector:run ${slug}` },
      meta: null,
    };
  }
  if (run.status === 'QUEUED' || run.status === 'RUNNING') {
    return {
      result: { id: 'latest-run', status: 'WARN', reason: `A run is in progress (${run.status}); verify again when it ends.` },
      meta: null,
    };
  }
  const parsed = RunMetadata.safeParse(run.metadata);
  const meta = parsed.success ? parsed.data : null;
  if (run.status !== 'SUCCEEDED') {
    const first = meta?.errors[0];
    const where = first
      ? ` First problem: ${first.dataset}, record ${first.record}, ${first.column ?? 'whole file'} — ${first.message}`
      : '';
    return {
      result: {
        id: 'latest-run',
        status: 'FAIL',
        reason: `Latest run ${run.status}${run.errorCode ? ` (${run.errorCode})` : ''}: ${run.errorMessage ?? 'no message'}.${where}`,
        next: `read the run's Log on /admin/data-sources/${slug}, fix, then pnpm connector:run ${slug}`,
      },
      meta,
    };
  }
  if (!meta) {
    return {
      result: {
        id: 'latest-run',
        status: 'FAIL',
        reason: 'Latest run metadata is not from a dataset API connector.',
      },
      meta: null,
    };
  }
  return {
    result: {
      id: 'latest-run',
      status: 'PASS',
      reason: `Latest run SUCCEEDED: ${run.recordsFetched} records fetched, ${run.recordsLoaded} rows loaded.`,
    },
    meta,
  };
}

async function checkDataset(
  dataset: string,
  meta: RunMetadata,
  reader: VerifyReader,
): Promise<CheckResult[]> {
  const outcome = meta.datasets[dataset];
  const d = { dataset };
  if (!outcome || outcome.status !== 'LOADED' || !outcome.importRunId) {
    const first = meta.errors.find((e) => e.dataset === dataset);
    const where = first
      ? ` First problem: record ${first.record}, ${first.column ?? 'whole file'} — ${first.message}`
      : '';
    return [
      {
        id: 'provenance',
        status: 'FAIL',
        ...d,
        reason: `Dataset was not loaded (${outcome?.status ?? 'not in run'}).${where}`,
      },
      skip('visible', 'provenance failed', dataset),
      skip('reaches-programme', 'provenance failed', dataset),
    ];
  }
  if (outcome.rows === 0) {
    return [
      { id: 'provenance', status: 'WARN', ...d, reason: 'The API returned no rows for this dataset.' },
      skip('visible', 'no rows', dataset),
      skip('reaches-programme', 'no rows', dataset),
    ];
  }
  const counts = await reader.rowCounts(dataset, outcome.importRunId);
  if (!counts) {
    return [
      skip('provenance', 'no visibility check for this dataset yet', dataset),
      skip('visible', 'no visibility check for this dataset yet', dataset),
      skip('reaches-programme', 'no visibility check for this dataset yet', dataset),
    ];
  }
  if (counts.stamped === 0) {
    return [
      {
        id: 'provenance',
        status: 'FAIL',
        ...d,
        reason: `The run reported ${outcome.rows} rows but none carry its import run id.`,
      },
      skip('visible', 'provenance failed', dataset),
      skip('reaches-programme', 'provenance failed', dataset),
    ];
  }
  const out: CheckResult[] = [
    { id: 'provenance', status: 'PASS', ...d, reason: `${counts.stamped} rows carry the import run id.` },
  ];
  if (counts.visible !== counts.stamped) {
    out.push(
      {
        id: 'visible',
        status: 'FAIL',
        ...d,
        reason: `${counts.stamped - counts.visible} of ${counts.stamped} rows are hidden by realDataWhere() (their data source is mocked).`,
        next: 'pnpm data-sources:audit, then pnpm data-sources:sync --apply',
      },
      skip('reaches-programme', 'visible failed', dataset),
    );
    return out;
  }
  out.push({ id: 'visible', status: 'PASS', ...d, reason: `${counts.visible} rows are visible to the app.` });
  if (counts.linked === null) {
    out.push(skip('reaches-programme', 'dataset is not keyed by programme or faculty', dataset));
  } else if (counts.linked === 0) {
    out.push({
      id: 'reaches-programme',
      status: 'WARN',
      ...d,
      reason: 'Loaded rows link to no programme or faculty — check the code mapping in toRows.',
    });
  } else {
    out.push({
      id: 'reaches-programme',
      status: 'PASS',
      ...d,
      reason: `${counts.linked} rows link to a programme or faculty.`,
    });
  }
  return out;
}

/** Runs every check in order; a check whose prerequisite failed is SKIP. */
export async function runChecks(slug: string, deps: VerifyDeps): Promise<CheckResult[]> {
  const target = resolveTarget(slug, deps.entries, deps.catalog);
  if (!('datasets' in target)) {
    return [
      target,
      skip('env', 'registered failed'),
      skip('sources', 'registered failed'),
      skip('latest-run', 'registered failed'),
    ];
  }
  const results: CheckResult[] = [{ id: 'registered', status: 'PASS', reason: `${slug} is registered and catalogued.` }];
  const wanted = [slug, ...target.datasets.map(importDataSourceSlug)];
  const rows = await deps.reader.dataSources(wanted);
  const own = rows.find((r) => r.slug === slug);

  const env = checkEnv(slug, deps.env, own?.baseUrl ?? null);
  const sources = checkSources(target, rows);
  results.push(env, sources);

  const perDatasetSkip = (why: string): CheckResult[] =>
    target.datasets.flatMap((ds) => PER_DATASET.map((id) => skip(id, why, ds)));

  if (sources.status === 'FAIL') {
    return [...results, skip('latest-run', 'sources failed'), ...perDatasetSkip('sources failed')];
  }

  const { result, meta } = checkRun(slug, await deps.reader.latestRun(slug));
  results.push(result);
  if (!meta) return [...results, ...perDatasetSkip(`latest-run ${result.status === 'WARN' ? 'in progress' : 'failed'}`)];

  for (const dataset of target.datasets) {
    results.push(...(await checkDataset(dataset, meta, deps.reader)));
  }
  return results;
}
