import { describe, expect, it } from 'vitest';

import { main } from '../../src/scripts/connector-verify/verify';
import type { RowCounts, VerifyReader } from '../../src/scripts/connector-verify/types';
import type { SourceCatalogEntry } from '@kku/shared';
import type { ConnectorContext } from '@kku/shared';
import type { ApiClient } from '../../src/connectors/base/api-client';
import { DatasetApiConnector, type DatasetRows } from '../../src/connectors/base/dataset-api-connector';

function io(): { out: string[]; err: string[]; sink: { out(s: string): void; err(s: string): void } } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, sink: { out: (s) => out.push(s), err: (s) => err.push(s) } };
}

const emptyReader: VerifyReader = {
  dataSources: () => Promise.resolve([]),
  latestRun: () => Promise.resolve(null),
  rowCounts: (): Promise<RowCounts | null> => Promise.resolve(null),
};

describe('connector:verify CLI', () => {
  it('no slug prints usage and exits 3', async () => {
    const t = io();
    expect(await main([], t.sink, { reader: emptyReader })).toBe(3);
    expect(t.err.join('\n')).toContain('Usage: pnpm connector:verify <slug>');
  });

  it('--help prints usage and exits 3', async () => {
    const t = io();
    expect(await main(['--help'], t.sink, { reader: emptyReader })).toBe(3);
  });

  it('exits 3 when the database is unreachable', async () => {
    const down = Object.assign(new Error("Can't reach database server at localhost:5432"), {
      name: 'PrismaClientInitializationError',
    });
    const reader: VerifyReader = {
      dataSources: () => Promise.reject(down),
      latestRun: () => Promise.reject(down),
      rowCounts: () => Promise.reject(down),
    };
    // A registered slug is needed to reach the database at all; the CLI
    // must refuse cleanly whichever slug it is given.
    const t = io();
    const code = await main(['api-anything'], t.sink, { reader, entries: [{ slug: 'api-anything', mock: fakeConnector, real: fakeConnector }], catalog: [catalogEntry('api-anything')] });
    expect(code).toBe(3);
    expect(t.err).toHaveLength(1);
    expect(t.err[0]).toContain('could not reach the database');
    expect(t.err.join('\n')).not.toContain('    at ');
  });

  it('--json prints parseable results', async () => {
    const t = io();
    const code = await main(['api-nope', '--json'], t.sink, { reader: emptyReader });
    const parsed = JSON.parse(t.out.join('\n')) as { slug: string; results: unknown[] };
    expect(parsed.slug).toBe('api-nope');
    expect(parsed.results.length).toBeGreaterThan(0);
    expect(code).toBe(1);
  });

  it('exit code follows results', async () => {
    const t = io();
    expect(await main(['api-nope'], t.sink, { reader: emptyReader })).toBe(1);
    expect(t.out.join('\n')).toContain('FAIL');
  });
});

// ── helpers ────────────────────────────────────────────────────────────────

class AnyConnector extends DatasetApiConnector {
  readonly slug = 'api-anything';
  readonly displayName = 'Anything';
  readonly datasets = ['faculties'] as const;
  protected fetchAll(_ctx: ConnectorContext, _api: ApiClient): Promise<readonly unknown[]> {
    return Promise.resolve([]);
  }
  protected toRows(): DatasetRows {
    return {};
  }
}

function fakeConnector(): AnyConnector {
  return new AnyConnector();
}

function catalogEntry(slug: string): SourceCatalogEntry {
  return { slug, name: slug, kind: 'API', inputFormat: 'JSON', mocked: false } as SourceCatalogEntry;
}
