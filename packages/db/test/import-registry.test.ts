import * as fs from 'node:fs';
import * as path from 'node:path';

import { describe, expect, it } from 'vitest';

import { IMPORT_DATASETS, getImportDataset, listImportDatasets } from '../src/import';

// Structural invariants over the declaration registry.
//
// A declaration is data, so the ways it can be wrong are the ways data can
// be wrong: a key named in `match` that no column defines, a reference to a
// dataset that does not exist, an enum column with no values. None of those
// are type errors — they would surface as a confusing upload failure in
// front of an operator. These assert them at build time instead.

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkTsFiles(full));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('import registry', () => {
  it('has unique slugs', () => {
    const slugs = IMPORT_DATASETS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('has unique column keys and headers within each dataset', () => {
    for (const d of IMPORT_DATASETS) {
      expect(new Set(d.columns.map((c) => c.key)).size, `${d.slug} keys`).toBe(d.columns.length);
      expect(new Set(d.columns.map((c) => c.header)).size, `${d.slug} headers`).toBe(d.columns.length);
    }
  });

  it('only names match columns that exist', () => {
    for (const d of IMPORT_DATASETS) {
      const keys = new Set(d.columns.map((c) => c.key));
      for (const k of d.strategy.match.columns) {
        expect(keys, `${d.slug}.match → ${k}`).toContain(k);
      }
    }
  });

  it('only references datasets that exist, on a column that exists there', () => {
    for (const d of IMPORT_DATASETS) {
      for (const c of d.columns) {
        if (!c.references) continue;
        const target = IMPORT_DATASETS.find((x) => x.slug === c.references?.dataset);
        expect(target, `${d.slug}.${c.key} → ${c.references.dataset}`).toBeDefined();
        expect(target?.columns.map((x) => x.key)).toContain(c.references.column);
      }
    }
  });

  it('gives every enum column its values', () => {
    for (const d of IMPORT_DATASETS) {
      for (const c of d.columns) {
        if (c.type === 'enum') {
          expect(c.enumValues?.length ?? 0, `${d.slug}.${c.key}`).toBeGreaterThan(0);
        }
      }
    }
  });

  it('gives every column guide text and an example', () => {
    for (const d of IMPORT_DATASETS) {
      for (const c of d.columns) {
        expect(c.guide.length, `${d.slug}.${c.key} guide`).toBeGreaterThan(10);
        expect(c.example.length, `${d.slug}.${c.key} example`).toBeGreaterThan(0);
      }
    }
  });

  it('only names dependents that exist', () => {
    const slugs = new Set(IMPORT_DATASETS.map((d) => d.slug));
    for (const d of IMPORT_DATASETS) {
      for (const dep of d.dependents ?? []) {
        expect(slugs, `${d.slug}.dependents → ${dep}`).toContain(dep);
      }
    }
  });

  it('lists the same datasets it holds', () => {
    expect(listImportDatasets().map((d) => d.slug)).toEqual(IMPORT_DATASETS.map((d) => d.slug));
  });

  it('throws for an unknown slug, naming it', () => {
    expect(() => getImportDataset('definitely-not-a-dataset')).toThrow(/definitely-not-a-dataset/);
  });

  it('never imports xlsx into packages/db', () => {
    // packages/db is imported by apps/web. `xlsx` is a large server-only
    // parser; packages/shared/src/jobthai/index.ts keeps its own parser off
    // the barrel for exactly this reason. Pulling it in here would be
    // invisible until a bundle broke.
    const dir = path.join(__dirname, '..', 'src', 'import');
    for (const file of walkTsFiles(dir)) {
      expect(fs.readFileSync(file, 'utf8'), file).not.toMatch(/from ['"]xlsx['"]/);
    }
  });
});
