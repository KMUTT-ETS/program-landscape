import { describe, expect, it, vi } from 'vitest';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

// ────────────────────────────────────────────────────────────────────────────
// "Where these publications come from" must agree with what actually builds
// the list.
//
// It did not. The strip labelled the KKU library index "primary source" and
// Google Scholar "— added on request" unconditionally, while the operator's
// requirement — and, since 2026-09-09, the server — is the reverse once a
// Scholar import exists: Scholar becomes the source the list is built from and
// the library index is kept as failover.
//
// The badge is derived from the SAME test the server applies (`googleScholar`
// count > 0 ≡ `hasScholarImport`), so these assertions fail if the badge is
// pinned back to one row, if the qualifier stops following it, or if the rows
// stop being ordered by precedence.
//
// Static markup, no jsdom — same constraint as the panel render test next door.
// ────────────────────────────────────────────────────────────────────────────

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => undefined, push: () => undefined }),
}));

vi.mock('sonner', () => ({
  toast: Object.assign(() => undefined, {
    success: () => undefined,
    error: () => undefined,
    message: () => undefined,
  }),
}));

vi.mock('@/lib/actions/scholar', () => ({
  getScholarStatusAction: async () => ({ ok: false, message: 'not called in this test' }),
  bindScholarProfileAction: async () => ({
    ok: false,
    message: 'not called in this test',
    rateLimited: false,
  }),
  startScholarFetchAction: async () => ({ ok: false, message: 'not called in this test' }),
}));

import { ScholarPanel, type ScholarSourceCounts } from '../app/profile/scholar-panel';
import type { ScholarStatus } from '../src/lib/scholar-status';

function statusOf(): ScholarStatus {
  return {
    userId: 'u1',
    staffRecord: {
      linked: true,
      facultyMemberId: 'fm-1',
      nameEn: 'Somchai Example',
      nameTh: 'สมชาย ตัวอย่าง',
    },
    profile: {
      bound: true,
      scholarProfileId: 'ABC123',
      scholarProfileUrl: 'https://scholar.google.com/citations?user=ABC123',
      boundAt: '2026-08-01T03:00:00.000Z',
    },
    lastRun: null,
    nextEligibleAt: null,
    quotaReason: null,
    needsBinding: false,
    fetchQueued: false,
    bind: {
      attemptsToday: 0,
      maxPerDay: 5,
      retryAt: null,
      creditsPerSearch: 75,
      creditsPerPastedCheck: 15,
      creditsAtRisk: 375,
    },
  };
}

function render(sources: ScholarSourceCounts | null): string {
  return renderToStaticMarkup(
    <ScholarPanel initialStatus={statusOf()} sources={sources} />,
  );
}

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * The composition rows as `term → definition` pairs.
 *
 * Split on the `<dt>`/`<dd>` boundary rather than flattening the whole list,
 * because those are separate elements: a reader announces them apart and the
 * layout sets them at opposite ends of the row, so the absence of literal
 * whitespace between the two tags is a serialisation artefact rather than a
 * run-together. WITHIN a `<dt>` it is not — label and qualifier are one text
 * flow, and `dt` below is the string that would read as "Google Scholarprimary
 * source" if the explicit space between them were ever removed.
 */
function compositionRows(markup: string): Array<{ dt: string; dd: string }> {
  const dl = /<dl[^>]*>([\s\S]*?)<\/dl>/.exec(markup);
  if (!dl) throw new Error('the source-composition list is not in the markup at all');
  return [...dl[1]!.matchAll(/<dt[^>]*>([\s\S]*?)<\/dt>[\s\S]*?<dd[^>]*>([\s\S]*?)<\/dd>/g)].map(
    (m) => ({ dt: stripTags(m[1]!), dd: stripTags(m[2]!) }),
  );
}

// The real record the defect was reported on, measured 2026-09-09: 22 Scholar
// rows against 6 library rows.
const AFTER_A_SYNC: ScholarSourceCounts = { googleScholar: 22, libraryIndex: 6 };
const NEVER_SYNCED: ScholarSourceCounts = { googleScholar: 0, libraryIndex: 184 };

describe('source composition — after a Scholar import', () => {
  const rows = compositionRows(render(AFTER_A_SYNC));

  it('names Google Scholar the primary source, and only it', () => {
    expect(rows.filter((r) => r.dt.includes('primary source')).map((r) => r.dt)).toEqual([
      'Google Scholar primary source',
    ]);
  });

  it('says what the library index is now for, rather than dropping it', () => {
    expect(rows.map((r) => r.dt)).toContain('University library index — kept as failover');
  });

  it('leads with the primary source', () => {
    expect(rows[0]!.dt).toContain('Google Scholar');
    expect(rows[1]!.dt).toContain('University library index');
  });

  it('keeps each count on its own source', () => {
    expect(rows).toEqual([
      { dt: 'Google Scholar primary source', dd: '22 papers' },
      { dt: 'University library index — kept as failover', dd: '6 papers' },
    ]);
  });

  it('explains that precedence changed the list and removed nothing', () => {
    const text = stripTags(render(AFTER_A_SYNC));
    expect(text).toContain('the library index is no longer looked up live');
    expect(text).toContain('it never removes a paper');
  });
});

describe('source composition — no Scholar import yet', () => {
  const rows = compositionRows(render(NEVER_SYNCED));

  it('leaves the library index as the primary source, leading', () => {
    expect(rows).toEqual([
      { dt: 'University library index primary source', dd: '184 papers' },
      { dt: 'Google Scholar — not fetched yet', dd: '0 papers' },
    ]);
  });

  it('withholds the precedence explanation until it is true', () => {
    expect(stripTags(render(NEVER_SYNCED))).not.toContain(
      'the library index is no longer looked up live',
    );
  });
});

describe('source composition — counts unavailable', () => {
  // A record whose Scholar status could not be resolved has no counts. Which
  // source is primary is a claim about the data; with no data, neither row may
  // carry the badge and neither may carry a qualifier that implies one.
  const rows = compositionRows(render(null));

  it('marks neither source primary and asserts nothing about either', () => {
    expect(rows).toEqual([
      { dt: 'University library index', dd: 'count unavailable' },
      { dt: 'Google Scholar', dd: 'count unavailable' },
    ]);
  });
});
