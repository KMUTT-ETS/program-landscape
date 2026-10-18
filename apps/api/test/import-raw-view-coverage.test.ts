import { readFileSync } from 'node:fs';
import path from 'node:path';

import { listImportDatasets } from '@kku/db';
import { describe, expect, it } from 'vitest';

// Three list-drift bugs have now shipped from the same gap: a dataset is
// registered, uploads fine, and its page renders "Error loading dataset"
// because the raw-view fetcher or its title was never added. The raw view
// is the adopter's only confirmation that an upload landed — and after a
// term-scoped replace, the only way to see what it did.
//
// So the lists are checked against the registry instead of remembered.

const CONTROLLER = path.join(__dirname, '..', 'src', 'admin-data-setup', 'raw-data.controller.ts');
const TITLES = path.join(
  __dirname, '..', '..', 'web', 'app', 'admin', 'data-setup', 'raw', '[dataset]', 'page.tsx',
);

/** Slugs the raw-data controller can serve. */
function fetcherSlugs(): Set<string> {
  const source = readFileSync(CONTROLLER, 'utf8');
  const keys = [...source.matchAll(/^ {2}'?([a-z0-9-]+)'?: async/gm)].map((m) => m[1] ?? '');
  return new Set(keys);
}

/** Slugs the raw-view page will render rather than 404. */
function titleSlugs(): Set<string> {
  const source = readFileSync(TITLES, 'utf8');
  const block = source.split('DATASET_TITLES')[1]?.split('};')[0] ?? '';
  return new Set([...block.matchAll(/^ {2}'?([a-z0-9-]+)'?:/gm)].map((m) => m[1] ?? ''));
}

describe('every import dataset is reachable', () => {
  it('finds the controller’s fetchers at all', () => {
    // Guards the regex: without this every assertion below passes vacuously.
    const slugs = fetcherSlugs();
    expect(slugs.size).toBeGreaterThan(10);
    expect(slugs).toContain('faculties');
  });

  it('finds the page’s titles at all', () => {
    const slugs = titleSlugs();
    expect(slugs.size).toBeGreaterThan(10);
    expect(slugs).toContain('faculties');
  });

  it('gives every dataset a raw-view fetcher', () => {
    const fetchers = fetcherSlugs();
    const missing = listImportDatasets().map((d) => d.slug).filter((s) => !fetchers.has(s));
    expect(missing, 'datasets whose /admin/data-setup/raw page has no data').toEqual([]);
  });

  it('gives every dataset a page title', () => {
    const titles = titleSlugs();
    const missing = listImportDatasets().map((d) => d.slug).filter((s) => !titles.has(s));
    expect(missing, 'datasets whose raw page 404s').toEqual([]);
  });
});
