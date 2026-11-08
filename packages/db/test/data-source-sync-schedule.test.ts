import { describe, expect, it, vi } from 'vitest';
import { SOURCE_CATALOG } from '@kku/shared';

import { syncDataSourcesFromCatalog } from '../src/data-source-sync';

type Row = Record<string, unknown>;

function fakeClient(existing: Row[]) {
  const create = vi.fn(async (_args: { data: Row }) => ({}));
  const update = vi.fn(async (_args: { where: { slug: string }; data: Row }) => ({}));
  const findMany = vi.fn(async () => existing);
  return { client: { dataSource: { findMany, create, update } } as never, create, update };
}

/** Rows exactly as a fresh sync would write them (the catalog's own columns). */
async function freshRows(): Promise<Row[]> {
  const { client, create } = fakeClient([]);
  await syncDataSourcesFromCatalog(client);
  return create.mock.calls.map(([args]) => args.data);
}

describe('syncDataSourcesFromCatalog — scheduleEnabled ownership (D1)', () => {
  it('creates new rows with schedule off', async () => {
    const { client, create } = fakeClient([]);
    await syncDataSourcesFromCatalog(client);
    expect(create).toHaveBeenCalledTimes(SOURCE_CATALOG.length);
    for (const [args] of create.mock.calls) expect(args.data.scheduleEnabled).toBe(false);
  });

  it("keeps an existing row's scheduleEnabled", async () => {
    const rows = await freshRows();
    const existing = rows.map((r) => ({ ...r, scheduleEnabled: r.slug === 'kku-registry' }));
    const { client, create, update } = fakeClient(existing);
    const result = await syncDataSourcesFromCatalog(client);
    expect(create).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(result.unchanged).toBe(SOURCE_CATALOG.length);
  });

  it('forces a deprecated source off', async () => {
    const rows = await freshRows();
    const existing = rows.map((r) => ({
      ...r,
      scheduleEnabled: r.slug === 'kku-tcas-funnel',
    }));
    const { client, update } = fakeClient(existing);
    const result = await syncDataSourcesFromCatalog(client);
    expect(update).toHaveBeenCalledTimes(1);
    const [args] = update.mock.calls[0];
    expect(args.where.slug).toBe('kku-tcas-funnel');
    expect(args.data.scheduleEnabled).toBe(false);
    expect(result.updated).toEqual([{ slug: 'kku-tcas-funnel', changes: ['scheduleEnabled'] }]);
  });
});
