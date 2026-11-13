import { describe, expect, it } from 'vitest';

import type { ConnectorContext, SourceCatalogEntry } from '@kku/shared';

import type { ApiClient } from '../../src/connectors/base/api-client';
import {
  DatasetApiConnector,
  type DatasetRows,
} from '../../src/connectors/base/dataset-api-connector';
import type { ConnectorEntry } from '../../src/connectors/registry';
import { runChecks } from '../../src/scripts/connector-verify/checks';
import { exitCodeFor, formatReport } from '../../src/scripts/connector-verify/format';
import type {
  CheckResult,
  RowCounts,
  RunSummary,
  VerifyReader,
} from '../../src/scripts/connector-verify/types';

class DemoConnector extends DatasetApiConnector {
  readonly slug = 'api-demo';
  readonly displayName = 'Demo';
  readonly datasets = ['enrollment-metrics', 'faculties'] as const;
  protected fetchAll(_ctx: ConnectorContext, _api: ApiClient): Promise<readonly unknown[]> {
    return Promise.resolve([]);
  }
  protected toRows(): DatasetRows {
    return {};
  }
}

const ENTRIES: ConnectorEntry[] = [
  { slug: 'api-demo', mock: () => new DemoConnector(), real: () => new DemoConnector() },
];
const CATALOG = [
  { slug: 'api-demo', name: 'Demo', kind: 'API', inputFormat: 'JSON', mocked: false },
] as unknown as SourceCatalogEntry[];

const GOOD_ENV = {
  CONNECTOR_API_DEMO_BASE_URL: 'https://x.example/abc',
  CONNECTOR_API_DEMO_TOKEN: 's3cr3t-value',
};

const ALL_SOURCES = ['api-demo', 'xlsx-enrollment-metrics', 'xlsx-faculties'];

function loadedMeta(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    datasets: {
      'enrollment-metrics': { importRunId: 'r1', rows: 10, inserted: 10, updated: 0, deleted: 0, status: 'LOADED' },
      faculties: { importRunId: 'r2', rows: 2, inserted: 2, updated: 0, deleted: 0, status: 'LOADED' },
    },
    warnings: [],
    errors: [],
    totalErrors: 0,
    ...over,
  };
}

function run(over: Partial<RunSummary> = {}): RunSummary {
  return {
    id: 'run-1',
    status: 'SUCCEEDED',
    startedAt: new Date('2026-11-12T00:00:00Z'),
    errorCode: null,
    errorMessage: null,
    recordsFetched: 12,
    recordsLoaded: 12,
    recordsFailed: 0,
    metadata: loadedMeta(),
    ...over,
  };
}

interface FakeOpts {
  sources?: { slug: string; mocked: boolean; baseUrl: string | null }[];
  latest?: RunSummary | null;
  counts?: Record<string, RowCounts | null>;
}

function fakeReader(opts: FakeOpts = {}): VerifyReader {
  const sources = opts.sources ?? ALL_SOURCES.map((slug) => ({ slug, mocked: false, baseUrl: null }));
  const counts: Record<string, RowCounts | null> = opts.counts ?? {
    r1: { stamped: 10, visible: 10, linked: 10 },
    r2: { stamped: 2, visible: 2, linked: null },
  };
  return {
    dataSources: (slugs) => Promise.resolve(sources.filter((s) => slugs.includes(s.slug))),
    latestRun: () => Promise.resolve(opts.latest === undefined ? run() : opts.latest),
    rowCounts: (_dataset, runId) => Promise.resolve(counts[runId] ?? null),
  };
}

function check(
  slug: string,
  opts: FakeOpts = {},
  env: Record<string, string | undefined> = GOOD_ENV,
): Promise<CheckResult[]> {
  return runChecks(slug, { entries: ENTRIES, catalog: CATALOG, env, reader: fakeReader(opts) });
}

function find(results: CheckResult[], id: CheckResult['id'], dataset?: string): CheckResult {
  const hit = results.find((r) => r.id === id && (dataset === undefined || r.dataset === dataset));
  if (!hit) throw new Error(`no result ${id} ${dataset ?? ''}`);
  return hit;
}

describe('runChecks', () => {
  it('all good exits 0', async () => {
    const results = await check('api-demo');
    expect(results.filter((r) => r.status === 'FAIL')).toEqual([]);
    expect(find(results, 'visible', 'enrollment-metrics').status).toBe('PASS');
    expect(exitCodeFor(results)).toBe(0);
  });

  it('unknown slug fails registered and skips the rest', async () => {
    const results = await check('api-nope');
    expect(results[0]).toMatchObject({ id: 'registered', status: 'FAIL' });
    expect(results.slice(1).every((r) => r.status === 'SKIP')).toBe(true);
    expect(results.length).toBeGreaterThan(1);
    expect(exitCodeFor(results)).toBe(1);
  });

  it('suggests the api- prefix', async () => {
    const results = await check('demo');
    expect(find(results, 'registered').status).toBe('FAIL');
    expect(find(results, 'registered').reason).toContain('api-demo');
  });

  it('never prints env values', async () => {
    const results = await check('api-demo', {}, { ...GOOD_ENV });
    const text = formatReport('api-demo', results) + JSON.stringify(results);
    expect(text).not.toContain('s3cr3t-value');
    expect(text).not.toContain('https://x.example/abc');
    expect(text).toContain('CONNECTOR_API_DEMO_BASE_URL');
  });

  it('missing base url fails env, missing token warns', async () => {
    const noUrl = await check('api-demo', {}, { CONNECTOR_API_DEMO_TOKEN: 't' });
    expect(find(noUrl, 'env').status).toBe('FAIL');
    expect(find(noUrl, 'env').next).toContain('CONNECTOR_API_DEMO_BASE_URL');

    const noToken = await check('api-demo', {}, { CONNECTOR_API_DEMO_BASE_URL: 'u' });
    expect(find(noToken, 'env').status).toBe('WARN');
    expect(find(noToken, 'env').reason).toContain('CONNECTOR_API_DEMO_TOKEN');
  });

  it('base url from the data source row satisfies env', async () => {
    const results = await check(
      'api-demo',
      {
        sources: ALL_SOURCES.map((slug) => ({
          slug,
          mocked: false,
          baseUrl: slug === 'api-demo' ? 'https://row.example' : null,
        })),
      },
      { CONNECTOR_API_DEMO_TOKEN: 't' },
    );
    expect(find(results, 'env').status).toBe('PASS');
  });

  it('missing xlsx source points to data-sources:sync', async () => {
    const results = await check('api-demo', {
      sources: ['api-demo', 'xlsx-enrollment-metrics'].map((slug) => ({ slug, mocked: false, baseUrl: null })),
    });
    const sources = find(results, 'sources');
    expect(sources.status).toBe('FAIL');
    expect(sources.reason).toContain('xlsx-faculties');
    expect(sources.next).toBe('pnpm data-sources:sync --apply');
    expect(find(results, 'latest-run').status).toBe('SKIP');
  });

  it('mocked source fails sources', async () => {
    const results = await check('api-demo', {
      sources: ALL_SOURCES.map((slug) => ({ slug, mocked: slug === 'xlsx-faculties', baseUrl: null })),
    });
    expect(find(results, 'sources').status).toBe('FAIL');
    expect(find(results, 'sources').reason).toContain('xlsx-faculties');
  });

  it('no run yet points to connector:run and skips 5-7', async () => {
    const results = await check('api-demo', { latest: null });
    expect(find(results, 'latest-run')).toMatchObject({
      status: 'FAIL',
      next: 'pnpm connector:run api-demo',
    });
    for (const r of results.filter((x) => ['provenance', 'visible', 'reaches-programme'].includes(x.id))) {
      expect(r.status).toBe('SKIP');
    }
  });

  it('run in progress is a warning', async () => {
    const results = await check('api-demo', { latest: run({ status: 'RUNNING', metadata: null }) });
    expect(find(results, 'latest-run').status).toBe('WARN');
    for (const r of results.filter((x) => ['provenance', 'visible', 'reaches-programme'].includes(x.id))) {
      expect(r.status).toBe('SKIP');
    }
    expect(exitCodeFor(results)).toBe(0);
  });

  it('reports each dataset separately', async () => {
    const results = await check('api-demo', {
      latest: run({
        status: 'FAILED',
        errorCode: 'VALIDATION',
        errorMessage: '1 problems in Faculties.',
        metadata: loadedMeta({
          datasets: {
            'enrollment-metrics': { importRunId: 'r1', rows: 10, inserted: 10, updated: 0, deleted: 0, status: 'LOADED' },
            faculties: { rows: 2, inserted: 0, updated: 0, deleted: 0, status: 'REFUSED' },
          },
          errors: [{ dataset: 'faculties', record: 3, column: 'Faculty Code', message: 'unknown code' }],
          totalErrors: 1,
        }),
      }),
    });
    expect(find(results, 'latest-run').status).toBe('FAIL');
    expect(find(results, 'latest-run').reason).toContain('VALIDATION');
    expect(find(results, 'provenance', 'enrollment-metrics').status).toBe('PASS');
    const refused = find(results, 'provenance', 'faculties');
    expect(refused.status).toBe('FAIL');
    expect(refused.reason).toContain('record 3');
    expect(refused.reason).toContain('Faculty Code');
  });

  it('metadata not from a dataset API connector fails latest-run', async () => {
    const results = await check('api-demo', { latest: run({ metadata: { foo: 1 } }) });
    expect(find(results, 'latest-run').status).toBe('FAIL');
    expect(find(results, 'latest-run').reason).toContain('not from a dataset API connector');
  });

  it('hidden rows fail visible', async () => {
    const results = await check('api-demo', {
      counts: { r1: { stamped: 10, visible: 0, linked: 0 }, r2: { stamped: 2, visible: 2, linked: null } },
    });
    expect(find(results, 'visible', 'enrollment-metrics').status).toBe('FAIL');
    expect(find(results, 'visible', 'enrollment-metrics').next).toContain('pnpm data-sources:audit');
    expect(find(results, 'reaches-programme', 'enrollment-metrics').status).toBe('SKIP');
  });

  it('unstamped rows fail provenance', async () => {
    const results = await check('api-demo', {
      counts: { r1: { stamped: 0, visible: 0, linked: 0 }, r2: { stamped: 2, visible: 2, linked: null } },
    });
    expect(find(results, 'provenance', 'enrollment-metrics').status).toBe('FAIL');
  });

  it('empty dataset warns', async () => {
    const results = await check('api-demo', {
      latest: run({
        metadata: loadedMeta({
          datasets: {
            'enrollment-metrics': { importRunId: 'r1', rows: 0, inserted: 0, updated: 0, deleted: 0, status: 'LOADED' },
            faculties: { importRunId: 'r2', rows: 2, inserted: 2, updated: 0, deleted: 0, status: 'LOADED' },
          },
        }),
      }),
    });
    expect(find(results, 'provenance', 'enrollment-metrics').status).toBe('WARN');
  });

  it('unsupported dataset skips', async () => {
    const results = await check('api-demo', {
      counts: { r1: null, r2: { stamped: 2, visible: 2, linked: null } },
    });
    expect(find(results, 'provenance', 'enrollment-metrics').status).toBe('SKIP');
    expect(find(results, 'provenance', 'enrollment-metrics').reason).toContain('no visibility check');
  });

  it('non-programme dataset skips reaches-programme', async () => {
    const results = await check('api-demo');
    expect(find(results, 'reaches-programme', 'faculties').status).toBe('SKIP');
  });

  it('zero linked rows warn', async () => {
    const results = await check('api-demo', {
      counts: { r1: { stamped: 10, visible: 10, linked: 0 }, r2: { stamped: 2, visible: 2, linked: null } },
    });
    expect(find(results, 'reaches-programme', 'enrollment-metrics').status).toBe('WARN');
    expect(exitCodeFor(results)).toBe(0);
  });
});

describe('formatReport', () => {
  it('says a run in progress is not verified yet', async () => {
    const results = await check('api-demo', { latest: run({ status: 'QUEUED', metadata: null }) });
    expect(formatReport('api-demo', results)).toContain('not verified yet');
  });

  it('never prints a token even when the run failed with a message and metadata', async () => {
    const results = await check(
      'api-demo',
      {
        latest: run({
          status: 'FAILED',
          errorCode: 'HTTP_401',
          errorMessage: 'GET /intake returned 401',
          metadata: loadedMeta({
            errors: [{ dataset: 'faculties', record: 1, column: 'Faculty Code', message: 'unknown code' }],
            totalErrors: 1,
          }),
        }),
      },
      { CONNECTOR_API_DEMO_BASE_URL: 'https://x.example/abc', CONNECTOR_API_DEMO_TOKEN: 's3cr3t-token-value' },
    );
    const text = formatReport('api-demo', results) + JSON.stringify({ slug: 'api-demo', results });
    expect(text).not.toContain('s3cr3t-token-value');
    expect(text).not.toContain('https://x.example/abc');
  });

  it('prints one line per result, next steps and a summary', () => {
    const text = formatReport('api-demo', [
      { id: 'registered', status: 'PASS', reason: 'ok' },
      { id: 'latest-run', status: 'FAIL', reason: 'no run', next: 'pnpm connector:run api-demo' },
      { id: 'provenance', status: 'SKIP', dataset: 'faculties', reason: 'skipped' },
    ]);
    expect(text).toContain('PASS');
    expect(text).toContain('→ pnpm connector:run api-demo');
    expect(text).toContain('(faculties)');
    expect(text).toContain('1 passed, 1 failed, 0 warnings, 1 skipped');
  });
});
