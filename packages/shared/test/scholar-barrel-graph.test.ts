import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The scholar barrel must not reach the ScrapingBee transport.
 *
 * WHY THIS TEST EXISTS, measured rather than theorised. On 2026-09-09 a missing
 * `zod` import inside `scrapingbee.ts` returned HTTP 500 for the whole
 * `/profile` page in apps/web. The chain was:
 *
 *   apps/web/src/lib/profile-data.ts   imports ONE constant at runtime
 *     -> @kku/shared barrel
 *       -> scholar/index.ts
 *         -> credits.ts                (needed a price)
 *           -> scrapingbee.ts          (the broken module)
 *
 * A user's profile page could not render because of a defect in a Google
 * scraping client it never calls. The prices moved to `costs.ts`, which is
 * pure, and the transport came off the barrel.
 *
 * Asserting on the exported SYMBOLS would not catch a regression: re-adding
 * `export * from './scrapingbee'` is caught, but so is any new barrel member
 * that imports the transport for a constant — which is exactly how it happened
 * the first time. So this walks the actual import graph.
 */

const SCHOLAR_DIR = path.join(__dirname, '..', 'src', 'scholar');
const FORBIDDEN = 'scrapingbee.ts';

/** Every relative import in a module, resolved to a file on disk. */
function relativeImportsOf(file: string): string[] {
  const source = readFileSync(file, 'utf8');
  const out: string[] = [];
  // Covers `import … from './x'`, `export … from './x'` and `export * from './x'`.
  for (const m of source.matchAll(/(?:import|export)[\s\S]*?from\s+'(\.[^']+)'/g)) {
    const spec = m[1];
    if (!spec) continue;
    const resolved = path.resolve(path.dirname(file), spec);
    for (const candidate of [`${resolved}.ts`, path.join(resolved, 'index.ts')]) {
      if (existsSync(candidate)) {
        out.push(candidate);
        break;
      }
    }
  }
  return out;
}

/** Breadth-first walk of the barrel's transitive relative imports. */
function reachableFrom(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined || seen.has(next)) continue;
    seen.add(next);
    queue.push(...relativeImportsOf(next));
  }
  return seen;
}

describe('scholar barrel import graph', () => {
  it('cannot reach the ScrapingBee transport, at any depth', () => {
    const reached = [...reachableFrom(path.join(SCHOLAR_DIR, 'index.ts'))].map((f) =>
      path.basename(f),
    );

    // Sanity: the walk really did traverse, and through the module that used to
    // be the culprit. Without this a broken walker would pass vacuously.
    expect(reached).toContain('credits.ts');
    expect(reached).toContain('costs.ts');
    expect(reached.length).toBeGreaterThan(5);

    expect(reached).not.toContain(FORBIDDEN);
  });

  it('keeps the prices reachable without the transport', async () => {
    // The split is only worth anything if a caller can still price a run from
    // the barrel — otherwise every consumer goes back to importing the client.
    const barrel = await import('../src/scholar/index');
    expect(barrel.GOOGLE_PAGE_CREDIT_COST).toBe(15);
    expect(barrel.GOOGLE_SEARCH_CREDIT_COST).toBe(75);
    expect(typeof barrel.creditCostForRequestKind).toBe('function');
    expect('fetchScrapingBeePage' in barrel).toBe(false);
  });

  it('costs.ts stays pure — no fetch, no zod, no env reads', () => {
    // The whole point of the split. If any of these appear, the module has
    // become the thing it was extracted from.
    const source = readFileSync(path.join(SCHOLAR_DIR, 'costs.ts'), 'utf8');
    expect(source).not.toMatch(/\bfetch\s*\(/);
    expect(source).not.toMatch(/from\s+'zod'/);
    expect(source).not.toMatch(/process\.env/);
  });
});
