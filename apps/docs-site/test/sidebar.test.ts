import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { dataSourceItems } from '../.vitepress/sidebar';

describe('dataSourceItems', () => {
  it('lists every per-source spec except README and the template, sorted', () => {
    const docs = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-site-sidebar-'));
    fs.mkdirSync(path.join(docs, 'data-sources'));
    for (const f of ['README.md', '_template.md', 'tcas.md', 'kku-hr.md', 'notes.txt']) {
      fs.writeFileSync(path.join(docs, 'data-sources', f), '# x\n');
    }
    expect(dataSourceItems(docs)).toEqual([
      { text: 'kku-hr', link: '/data-sources/kku-hr' },
      { text: 'tcas', link: '/data-sources/tcas' },
    ]);
  });
});
