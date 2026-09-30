import { describe, expect, it } from 'vitest';
import { SOURCE_CATALOG } from '@kku/shared';

import { formatDataSourceSync, syncDataSourcesFromCatalog } from '../src/data-source-sync';

/* deploy.sh runs `prisma migrate deploy` but has never seeded, so a connector
 * declared in the catalog reached production with no `data_sources` row and
 * every script resolving it by slug died. These cover the reconciliation that
 * closes that, and the one invariant that matters more than any of it: `status`
 * and `mocked` must move together, because a connector running real while the
 * row reads mocked=true writes rows that realDataWhere() silently hides. */

type Row = Record<string, unknown> & { slug: string };

/** Minimal stand-in for the slice of PrismaClient the function uses. It has no
 *  `delete`, so a regression that started deleting orphans fails here rather
 *  than in production against rows that ingestion_runs still point at. */
function fakeClient(initial: Row[] = []) {
  const rows = new Map(initial.map((r) => [r.slug, { ...r }]));
  const calls = { create: 0, update: 0 };
  return {
    rows,
    calls,
    client: {
      dataSource: {
        findMany: async () => [...rows.values()],
        create: async ({ data }: { data: Row }) => {
          calls.create += 1;
          rows.set(data.slug, { ...data });
          return data;
        },
        update: async ({ where, data }: { where: { slug: string }; data: Record<string, unknown> }) => {
          calls.update += 1;
          rows.set(where.slug, { ...rows.get(where.slug)!, ...data });
          return data;
        },
      },
    } as never,
  };
}

describe('syncDataSourcesFromCatalog', () => {
  it('creates a row for every catalog entry against an empty table', async () => {
    const { client, rows } = fakeClient();
    const result = await syncDataSourcesFromCatalog(client);

    expect(result.created).toHaveLength(SOURCE_CATALOG.length);
    expect(rows.size).toBe(SOURCE_CATALOG.length);
    expect(result.updated).toHaveLength(0);
    expect(result.unchanged).toBe(0);
  });

  it('creates job-108 specifically — the connector whose absence stalled the v1.9.8 rollout', async () => {
    const { client, rows } = fakeClient();
    const result = await syncDataSourcesFromCatalog(client);

    expect(result.created).toContain('job-108');
    const row = rows.get('job-108')!;
    // Not mocked, and therefore active: the pair that decides whether every
    // posting this connector writes is visible to realDataWhere().
    expect(row.mocked).toBe(false);
    expect(row.status).toBe('active');
  });

  it('is idempotent — a second run against its own output writes nothing', async () => {
    const { client } = fakeClient();
    await syncDataSourcesFromCatalog(client);
    const second = await syncDataSourcesFromCatalog(client);

    expect(second.created).toHaveLength(0);
    expect(second.updated).toHaveLength(0);
    expect(second.unchanged).toBe(SOURCE_CATALOG.length);
  });

  it('corrects a row whose mocked flag has drifted away from the catalog', async () => {
    const { client, calls } = fakeClient();
    await syncDataSourcesFromCatalog(client);
    // Simulate the drift this repository has hit three times: the connector
    // runs real, the row still says mocked.
    const rowsAfterSeed = await client.dataSource.findMany();
    const target = rowsAfterSeed.find((r: Row) => r.mocked === false)!;
    await client.dataSource.update({
      where: { slug: target.slug },
      data: { mocked: true, status: 'mocked' },
    });
    const before = calls.update;

    const result = await syncDataSourcesFromCatalog(client);

    const fixed = result.updated.find((u) => u.slug === target.slug);
    expect(fixed).toBeDefined();
    // Both columns named, never one: they are corrected as a pair.
    expect(fixed!.changes).toContain('mocked');
    expect(fixed!.changes).toContain('status');
    expect(calls.update).toBe(before + 1);
  });

  it('reports a row absent from the catalog without deleting it', async () => {
    const { client, rows } = fakeClient([
      { slug: 'retired-connector', name: 'Retired', kind: 'API', status: 'active', mocked: false },
    ]);
    const result = await syncDataSourcesFromCatalog(client);

    expect(result.orphaned).toEqual(['retired-connector']);
    // Still present: deleting it would orphan the ingestion_runs pointing at it.
    expect(rows.has('retired-connector')).toBe(true);
  });

  it('never derives a status that contradicts the mocked flag', async () => {
    const { client, rows } = fakeClient();
    await syncDataSourcesFromCatalog(client);

    for (const row of rows.values()) {
      if (row.mocked === true) expect(row.status).toBe('mocked');
      else expect(['active', 'deprecated']).toContain(row.status);
    }
  });

  it('disables the schedule for a deprecated source', async () => {
    const { client, rows } = fakeClient();
    await syncDataSourcesFromCatalog(client);

    for (const entry of SOURCE_CATALOG) {
      if (!entry.deprecated) continue;
      const row = rows.get(entry.slug)!;
      expect(row.scheduleEnabled).toBe(false);
      expect(row.status).toBe(entry.mocked ? 'mocked' : 'deprecated');
    }
  });
});

describe('formatDataSourceSync', () => {
  it('mentions orphans only when there are some', async () => {
    const quiet = formatDataSourceSync({ created: [], updated: [], unchanged: 40, orphaned: [] });
    expect(quiet.join('\n')).not.toContain('orphaned');

    const loud = formatDataSourceSync({ created: [], updated: [], unchanged: 39, orphaned: ['gone'] });
    expect(loud.join('\n')).toContain('gone');
    expect(loud.join('\n')).toContain('NOT deleted');
  });
});
