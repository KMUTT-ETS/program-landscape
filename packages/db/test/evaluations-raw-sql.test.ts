import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// In Next.js dev, @prisma/client is bundled once per server-component
// context. A `Prisma.sql` / `Prisma.empty` fragment built in one context
// fails `instanceof Sql` inside `$queryRaw` running in another, so Prisma
// binds it as a parameter and Postgres rejects the query with
// `syntax error at or near "$1"` (same failure fixed in dashboard-overview.ts,
// commit 668dd46). instructorPersonal is called from the /profile server
// component, so its query must use plain parameters only — no nested
// fragments.
const src = readFileSync(join(__dirname, '..', 'src', 'evaluations.ts'), 'utf8');

function body(name: string): string {
  const start = src.indexOf(`export async function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  const next = src.indexOf('\nexport ', start + 1);
  // Code only: the function's own comment names the fragments it avoids.
  return src
    .slice(start, next === -1 ? undefined : next)
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line))
    .join('\n');
}

describe('instructorPersonal raw SQL', () => {
  it('nests no Prisma.sql / Prisma.empty fragments (they break inside Next.js)', () => {
    const fn = body('instructorPersonal');
    expect(fn).not.toMatch(/Prisma\.sql`/);
    expect(fn).not.toMatch(/Prisma\.empty/);
    expect(fn).not.toMatch(/Prisma\.join/);
  });
});
