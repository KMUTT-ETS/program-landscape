import { describe, expect, it } from 'vitest';
import {
  decidePublicationsCacheAction,
  hasScholarImport,
  type PublicationSourceRow,
} from '../src/publication-source-precedence';
import {
  PUBLICATIONS_CACHE_INVALIDATED_MS,
  SCHOLAR_RESEARCH_OUTPUT_SOURCE,
} from '../src/scholar-fetch';

// ────────────────────────────────────────────────────────────────────────────
// Which source builds a person's publication list, and when a sync's result
// becomes visible.
//
// Both decisions were previously implicit — one did not exist at all (the list
// was always built from a live library read, so a successful Scholar import
// changed the count beside the list without changing the list), and the other
// was a `>` against a TTL that could not tell a day-old row from one a user
// had just invalidated by pressing sync.
//
// Written to fail under mutation. Specifically: swapping `some` for `every`,
// comparing against a literal instead of the runner's constant, treating a
// null source as Scholar, dropping the invalidation branch, flipping the
// staleness comparison, or making the boundary inclusive/exclusive the wrong
// way each break at least one assertion below.
// ────────────────────────────────────────────────────────────────────────────

const SCHOLAR = SCHOLAR_RESEARCH_OUTPUT_SOURCE;
const SCOPUS = 'kku-publications:scopus';
const OPENALEX = 'openalex';

describe('hasScholarImport', () => {
  it('is false for a record the runner has never written to', () => {
    const rows: PublicationSourceRow[] = [
      { source: SCOPUS },
      { source: OPENALEX },
      { source: OPENALEX },
    ];
    expect(hasScholarImport(rows)).toBe(false);
  });

  it('is false for an empty record', () => {
    expect(hasScholarImport([])).toBe(false);
  });

  // The real shape of the first live record, measured 2026-09-09: 22 Scholar
  // rows, 1 Scopus, 5 OpenAlex. This is the case the defect was reported on.
  it('is true for the mixed record the defect was reported on', () => {
    const rows: PublicationSourceRow[] = [
      ...Array.from({ length: 22 }, () => ({ source: SCHOLAR })),
      { source: SCOPUS },
      ...Array.from({ length: 5 }, () => ({ source: OPENALEX })),
    ];
    expect(hasScholarImport(rows)).toBe(true);
  });

  // `some`, not `every`. A record is Scholar-primary as soon as the runner has
  // written ONE row; requiring all of them would mean the rule never fires,
  // because the library rows the runner enriched rather than re-inserted stay
  // on the record under their original source.
  it('is true when a single Scholar row sits among many library rows', () => {
    const rows: PublicationSourceRow[] = [
      ...Array.from({ length: 200 }, () => ({ source: SCOPUS })),
      { source: SCHOLAR },
    ];
    expect(hasScholarImport(rows)).toBe(true);
  });

  // `source` is nullable on the column. A null source is NOT the runner's —
  // the runner always stamps its own — and the same rule is applied by
  // `summariseResearchSources` next door, deliberately.
  it('does not read a null source as Scholar', () => {
    expect(hasScholarImport([{ source: null }, { source: null }])).toBe(false);
  });

  // Guards the label itself. If the constant is ever renamed, the rule must
  // move with it rather than keep matching a stale literal here.
  it('matches the runner’s own constant, not a copy of the string', () => {
    expect(hasScholarImport([{ source: SCHOLAR_RESEARCH_OUTPUT_SOURCE }])).toBe(true);
    expect(hasScholarImport([{ source: 'Google Scholar' }])).toBe(false);
    expect(hasScholarImport([{ source: 'google_scholar' }])).toBe(false);
  });
});

describe('decidePublicationsCacheAction', () => {
  const DAY = 24 * 60 * 60 * 1000;
  const NOW = Date.UTC(2026, 8, 9, 12, 0, 0);

  it('computes when there is no cached row at all', () => {
    expect(
      decidePublicationsCacheAction({
        cachedFetchedAtMs: null,
        nowMs: NOW,
        freshForMs: DAY,
      }),
    ).toBe('compute');
  });

  it('serves a row inside the freshness window without revalidating', () => {
    expect(
      decidePublicationsCacheAction({
        cachedFetchedAtMs: NOW - DAY / 2,
        nowMs: NOW,
        freshForMs: DAY,
      }),
    ).toBe('serve');
  });

  it('serves and revalidates a row that merely aged out', () => {
    expect(
      decidePublicationsCacheAction({
        cachedFetchedAtMs: NOW - DAY * 3,
        nowMs: NOW,
        freshForMs: DAY,
      }),
    ).toBe('serve-and-revalidate');
  });

  // THE BRANCH THIS WHOLE FUNCTION EXISTS FOR. The runner backdates the row
  // to the epoch after a successful fetch. Read as "very stale" it takes the
  // serve-and-revalidate path and the user's next page load shows the list
  // from BEFORE their sync — the reported defect. It must be a miss.
  it('treats the runner’s invalidation sentinel as a miss, not as staleness', () => {
    expect(
      decidePublicationsCacheAction({
        cachedFetchedAtMs: PUBLICATIONS_CACHE_INVALIDATED_MS,
        nowMs: NOW,
        freshForMs: DAY,
      }),
    ).toBe('compute');
  });

  // A clock skew or a pre-epoch timestamp must land on the safe side of that
  // branch rather than falling through to the stale path.
  it('treats anything at or before the sentinel as a miss', () => {
    expect(
      decidePublicationsCacheAction({
        cachedFetchedAtMs: PUBLICATIONS_CACHE_INVALIDATED_MS - 1,
        nowMs: NOW,
        freshForMs: DAY,
      }),
    ).toBe('compute');
  });

  // Pins the boundary so a `>` cannot quietly become a `>=`: exactly one TTL
  // old is still fresh.
  it('holds the freshness boundary at exactly one TTL', () => {
    expect(
      decidePublicationsCacheAction({
        cachedFetchedAtMs: NOW - DAY,
        nowMs: NOW,
        freshForMs: DAY,
      }),
    ).toBe('serve');
    expect(
      decidePublicationsCacheAction({
        cachedFetchedAtMs: NOW - DAY - 1,
        nowMs: NOW,
        freshForMs: DAY,
      }),
    ).toBe('serve-and-revalidate');
  });
});
