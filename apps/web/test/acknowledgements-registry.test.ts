import { existsSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

import { ACKNOWLEDGEMENTS } from '../app/docs/acknowledgements/registry';
import { DATA_SOURCE_MARKS } from '../src/components/data-source-mark';

// The registry is the only place a contributor is recorded. These invariants
// are what let the page render any future entry without further code.

const GITHUB_DOCS = 'https://github.com/khon-kaen-university/program-landscape/blob/main/docs/acknowledgements/';

describe('ACKNOWLEDGEMENTS registry', () => {
  it('has at least JobThai', () => {
    expect(ACKNOWLEDGEMENTS.some((a) => a.slug === 'jobthai')).toBe(true);
  });

  it('every entry carries both languages, non-empty', () => {
    for (const a of ACKNOWLEDGEMENTS) {
      expect(a.contributes.en.trim().length, `${a.slug} contributes.en`).toBeGreaterThan(0);
      expect(a.contributes.th.trim().length, `${a.slug} contributes.th`).toBeGreaterThan(0);
      expect(renderToStaticMarkup(a.body.en).length, `${a.slug} body.en`).toBeGreaterThan(50);
      expect(renderToStaticMarkup(a.body.th).length, `${a.slug} body.th`).toBeGreaterThan(50);
      expect(a.contributes.th).not.toBe(a.contributes.en);
      expect(renderToStaticMarkup(a.body.th)).not.toBe(renderToStaticMarkup(a.body.en));
      expect(renderToStaticMarkup(a.body.th), `${a.slug} body.th has no Thai`).toMatch(/[฀-๿]/);
    }
  });

  it('slugs are unique and URL-safe (they are anchor ids)', () => {
    const slugs = ACKNOWLEDGEMENTS.map((a) => a.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9-]+$/);
  });

  it('a logo, when set, exists in DATA_SOURCE_MARKS', () => {
    for (const a of ACKNOWLEDGEMENTS) {
      if (a.logo) expect(Object.keys(DATA_SOURCE_MARKS), `${a.slug} logo`).toContain(a.logo);
    }
  });

  it('a detailUrl, when set, points into this repo’s docs/acknowledgements/', () => {
    for (const a of ACKNOWLEDGEMENTS) {
      if (a.detailUrl) expect(a.detailUrl.startsWith(GITHUB_DOCS), `${a.slug} detailUrl`).toBe(true);
    }
  });

  it('a detailUrl, when set, names a file that exists in docs/acknowledgements/', () => {
    for (const a of ACKNOWLEDGEMENTS) {
      if (!a.detailUrl) continue;
      const file = a.detailUrl.slice(GITHUB_DOCS.length);
      const filePath = path.join(__dirname, '..', '..', '..', 'docs', 'acknowledgements', file);
      expect(existsSync(filePath), `${a.slug} detailUrl target ${filePath}`).toBe(true);
    }
  });

  it('every mark is reachable at its own anchor — acknowledgementHref depends on it', () => {
    const slugs = ACKNOWLEDGEMENTS.map((a) => a.slug);
    for (const key of Object.keys(DATA_SOURCE_MARKS)) {
      expect(slugs, `DATA_SOURCE_MARKS.${key} has no acknowledgement entry`).toContain(key);
    }
    for (const a of ACKNOWLEDGEMENTS) {
      if (a.logo) expect(a.logo, `${a.slug} logo`).toBe(a.slug);
    }
  });

  it('is ordered most recent first', () => {
    const dates = ACKNOWLEDGEMENTS.map((a) => a.since);
    for (const d of dates) {
      expect(d).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(Number.isNaN(Date.parse(`${d}T00:00:00Z`)), d).toBe(false);
    }
    const sorted = [...dates].sort((x, y) => (x < y ? 1 : x > y ? -1 : 0));
    expect(dates).toEqual(sorted);
  });
});
