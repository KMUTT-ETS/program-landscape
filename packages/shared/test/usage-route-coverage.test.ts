import { readdirSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { normalisePath } from '../src/usage';

// A new page that lands in `other` is invisible in the usage dashboard.
// This walks the web app's top-level route folders and fails until each
// is classified — the cost of adding a page is one entry in MODULE_BY_SEGMENT.

const APP_DIR = path.join(__dirname, '..', '..', '..', 'apps', 'web', 'app');
// Not recorded: API handlers, the pages a signed-out visitor sees, and
// `brand` — the /brand/<asset> logo and favicon route, an asset, not a page.
const IGNORED = new Set(['api', 'brand', 'signin', 'no-access', 'styleguide']);

// A route group — `(legal)` — is not a URL segment: its children ARE the
// top-level routes. Recurse through it rather than skipping it, or the three
// legal pages stay unclassified; and a NEW group would otherwise fail this
// test for something that can never be classified.
function routeFolders(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('@'))
    .flatMap((e) => (e.name.startsWith('(') ? routeFolders(path.join(dir, e.name)) : [e.name]))
    .filter((name) => !IGNORED.has(name));
}

describe('every web route folder maps to a usage module', () => {
  const folders = [...new Set(routeFolders(APP_DIR))];
  it('has route folders to check', () => expect(folders.length).toBeGreaterThan(10));
  for (const f of folders) {
    it(`/${f} is classified`, () => {
      expect(normalisePath(`/${f}/x`).module).not.toBe('other');
    });
  }
});

function routes(dir: string, url: string[]): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isFile() && e.name === 'page.tsx') out.push('/' + url.join('/'));
    if (!e.isDirectory() || e.name.startsWith('_') || e.name === 'api') continue;
    out.push(...routes(path.join(dir, e.name), e.name.startsWith('(') ? url : [...url, e.name]));
  }
  return out;
}

describe('normalisePath against every real page route', () => {
  it('keeps every real route literal and collapses every dynamic segment', () => {
    const all = routes(APP_DIR, []);
    expect(all.length).toBeGreaterThan(80);
    for (const route of all) {
      const probe = route.replace(/\[\w+\]/g, 'cmtzdam3m0001fd72f65igks4');
      const expected = route.replace(/\[\w+\]/g, '[id]') || '/';
      expect(normalisePath(probe).path, route).toBe(expected);
    }
  });
});
