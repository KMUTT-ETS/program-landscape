import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSidebar, buildThaiSidebar, dataSourceGroups } from '../.vitepress/sidebar';
import { collectSidebarLinks } from '../src/check-site';
import { dataSourceTier } from '../src/data-source-tier';

const realDocs = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'docs');

describe('dataSourceTier', () => {
  it('reads the tier from the source catalogue', () => {
    expect(dataSourceTier('jobsdb')).toBe('deprecated');
    expect(dataSourceTier('kku-hr')).toBe('institution');
    expect(dataSourceTier('tcas')).toBe('public');
  });

  it('treats a spec with no catalogue entry as public, so it still appears', () => {
    expect(dataSourceTier('no-such-source')).toBe('public');
  });
});

describe('dataSourceGroups', () => {
  it('groups per-source specs by tier, skipping README and the template', () => {
    const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-site-sidebar-'));
    fs.mkdirSync(path.join(docs, 'data-sources'));
    for (const f of ['README.md', '_template.md', 'tcas.md', 'kku-hr.md', 'jobsdb.md', 'notes.txt']) {
      fs.writeFileSync(path.join(docs, 'data-sources', f), '# x\n');
    }
    const groups = dataSourceGroups(docs);
    expect(groups.map((g) => g.text)).toEqual(['Public and national', 'Per-institution (KKU examples)', 'Deprecated']);
    expect(groups.map((g) => g.items?.map((i) => i.link))).toEqual([
      ['/data-sources/tcas'],
      ['/data-sources/kku-hr'],
      ['/data-sources/jobsdb'],
    ]);
  });

  it('omits a tier with no specs', () => {
    const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-site-sidebar-'));
    fs.mkdirSync(path.join(docs, 'data-sources'));
    fs.writeFileSync(path.join(docs, 'data-sources', 'tcas.md'), '# x\n');
    expect(dataSourceGroups(docs).map((g) => g.text)).toEqual(['Public and national']);
  });
});

describe('buildSidebar', () => {
  it('follows the reader, in six groups', () => {
    expect(buildSidebar(realDocs).map((g) => g.text)).toEqual([
      'Start',
      'Tutorials',
      'Workshop',
      'Guides',
      'Concepts',
      'Reference',
    ]);
  });

  it('keeps Thai pages in the Thai sidebar only', () => {
    expect(collectSidebarLinks(buildSidebar(realDocs)).filter((l) => l.startsWith('/th/'))).toEqual([]);
    const th = collectSidebarLinks(buildThaiSidebar(realDocs));
    expect(th.length).toBeGreaterThan(0);
    expect(th.every((l) => l.startsWith('/th/'))).toBe(true);
  });
});
