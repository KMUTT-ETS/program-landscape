import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

// ────────────────────────────────────────────────────────────────────────────
// The two readers of `staff_publications_cache` must compute the same list.
//
// `buildStaffProfile` (the profile page and the external API) and
// `getStaffPublicationsSnapshot` (the home-page sparkline) both call
// `loadPublicationsWithCache` with the SAME key — the staff-record id — so
// they write the same row. While each carried its own copy
// of the compute body, a source-precedence rule added to one and not the other
// would not fail anywhere: the two would take turns overwriting the row, and
// the profile list would show Scholar or not depending on which page had been
// loaded last. A cache is exactly where a duplicated implementation stops
// being duplication and starts being a race.
//
// So there is one `computePublications`, and this asserts it stays that way.
// A source scan because the module imports Prisma at load time and the
// pipeline it drives makes live HTTP calls; what is being pinned is a
// structural property of the file, which is the thing a scan can actually
// establish.
// ────────────────────────────────────────────────────────────────────────────

const SOURCE = readFileSync(
  path.join(__dirname, '..', 'src', 'staff-profile', 'profile.ts'),
  'utf8',
);

/** Occurrences of `needle` outside comment lines. */
function countInCode(needle: string): number {
  return SOURCE.split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .filter((line) => line.includes(needle)).length;
}

describe('staff_publications_cache readers', () => {
  it('has exactly two callers, matching the two entry points', () => {
    expect(countInCode('loadPublicationsWithCache(')).toBe(3); // 2 calls + the definition
  });

  it('routes both of them through the one compute implementation', () => {
    expect(countInCode('computePublications(')).toBe(3); // 2 calls + the definition
  });

  // The precedence flag is what makes the two agree. Passed at BOTH call sites
  // or the shared row is written two different ways.
  it('applies the source-precedence rule at both call sites', () => {
    expect(countInCode('hasScholarImport(')).toBe(2);
  });

  it('takes the rule from publication-source-precedence rather than re-deriving it here', () => {
    expect(SOURCE).toContain('hasScholarImport');
    expect(SOURCE).toContain("from '../publication-source-precedence'");
    // A local re-implementation would be a second definition of the rule and
    // would drift from the one the provenance drawer counts against.
    expect(SOURCE).not.toMatch(/function\s+hasScholarImport/);
    expect(SOURCE).not.toContain("'google-scholar'");
  });

  // The invalidation branch lives in publication-source-precedence too, for
  // the same reason: it is tested there against the runner's own sentinel.
  // The loader is the only freshness decision. The home snapshot used to make
  // a second one to report `isStale`; it now reads the status the loader
  // returns, so the two cannot disagree about an invalidated row.
  it('defers every cache freshness decision to the shared rule', () => {
    expect(countInCode('decidePublicationsCacheAction(')).toBe(1);
    expect(SOURCE).not.toMatch(/fetchedAt\.getTime\(\)\s*[<>]/);
  });
});
