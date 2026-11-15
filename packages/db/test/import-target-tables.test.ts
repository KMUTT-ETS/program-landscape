import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { IMPORT_DATASETS } from '../src/import/registry';

// The admin page for each importable dataset names the database tables an
// upload writes into. That list is hand-declared (`targetTables`), so it is
// checked here against two authorities: the schema (every name is a real
// table) and the dataset's own source (every model its load writes to is
// named). A new write in a `load` fails this test until the page says so.

const SCHEMA = path.join(__dirname, '..', 'prisma', 'schema.prisma');
const DATASETS_DIR = path.join(__dirname, '..', 'src', 'import', 'datasets');

/** Prisma model name (camelCase accessor) -> PostgreSQL table name. */
function modelTables(): Map<string, string> {
  const source = readFileSync(SCHEMA, 'utf8');
  const out = new Map<string, string>();
  for (const match of source.matchAll(/^model (\w+) \{([\s\S]*?)^\}/gm)) {
    const name = match[1];
    const body = match[2];
    if (!name || body === undefined) continue;
    const mapped = /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? name;
    out.set(name.charAt(0).toLowerCase() + name.slice(1), mapped);
  }
  return out;
}

describe('import dataset target tables', () => {
  const tables = modelTables();
  const allTables = new Set(tables.values());

  it.each(IMPORT_DATASETS.map((d) => [d.slug, d] as const))(
    '%s declares real tables',
    (_slug, dataset) => {
      expect(dataset.targetTables?.length ?? 0).toBeGreaterThan(0);
      for (const t of dataset.targetTables ?? []) expect(allTables).toContain(t);
    },
  );

  const files = readdirSync(DATASETS_DIR).filter((f) => f.endsWith('.ts'));

  it.each(files)('%s names every table its uploads write to', (file) => {
    const source = readFileSync(path.join(DATASETS_DIR, file), 'utf8');
    const slugs = [...source.matchAll(/^ {2}slug: '([^']+)'/gm)].map((m) => m[1]);
    if (slugs.length === 0) return; // helper module, not a dataset

    const declared = new Set(
      IMPORT_DATASETS.filter((d) => slugs.includes(d.slug)).flatMap((d) => d.targetTables ?? []),
    );
    // Only inserts/updates — `deleteMany` also appears in `clear` and in
    // programmes' tidy-up of cubes it does not load.
    const written = new Set(
      [...source.matchAll(/\btx\.(\w+)\.(?:create|createMany|update|updateMany|upsert)\(/g)].map(
        (m) => m[1],
      ),
    );
    for (const model of written) {
      const table = tables.get(model ?? '');
      expect(table, `unknown model ${model}`).toBeDefined();
      expect(declared, `${file} writes ${table} but no dataset declares it`).toContain(table);
    }
  });
});
