import { describe, expect, it } from 'vitest';
import {
  checkSidebarCoverage,
  checkTwinPair,
  fencedBlocks,
  structuralHeadings,
  collectSidebarLinks,
  findRetiredNames,
  htmlRoute,
} from '../src/check-site';

describe('collectSidebarLinks', () => {
  it('walks nested groups', () => {
    expect(
      collectSidebarLinks([{ link: '/a' }, { items: [{ link: '/b' }, { items: [{ link: '/c' }] }] }]),
    ).toEqual(['/a', '/b', '/c']);
  });
});

describe('checkSidebarCoverage', () => {
  it('passes when routes and links match, ignoring the landing page', () => {
    expect(checkSidebarCoverage(['/', '/a', '/b'], ['/a', '/b'])).toEqual([]);
    expect(checkSidebarCoverage(['/', '/th/', '/a'], ['/a'])).toEqual([]);
  });

  it('reports a rendered page missing from the sidebar, naming where to fix it', () => {
    const problems = checkSidebarCoverage(['/a', '/new-doc'], ['/a']);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.kind).toBe('missing-from-sidebar');
    expect(problems[0]?.detail).toContain('/new-doc');
    expect(problems[0]?.detail).toContain('sidebar.ts');
  });

  it('reports a sidebar entry with no page', () => {
    const problems = checkSidebarCoverage(['/a'], ['/a', '/gone']);
    expect(problems).toEqual([{ kind: 'sidebar-without-page', detail: 'sidebar links /gone but no such page exists' }]);
  });
});

describe('htmlRoute', () => {
  it('maps built files to routes', () => {
    expect(htmlRoute('index.html')).toBe('/');
    expect(htmlRoute('adopters/README.html')).toBe('/adopters/README');
  });
});

describe('findRetiredNames', () => {
  it('flags a retired name outside the allowlist and skips allowlisted pages', () => {
    const html = new Map([
      ['/architecture', '<p>Welcome to Curriculum Compass</p>'],
      ['/glossary-th-en', '<td>Curriculum Compass</td>'],
      ['/ok', '<p>Program Landscape</p>'],
    ]);
    expect(findRetiredNames(html)).toEqual([
      { kind: 'retired-name', detail: '/architecture contains retired name "Curriculum Compass"' },
    ]);
  });

  it('flags the Thai retired codename and the former title', () => {
    const html = new Map([
      ['/a', '<p>ทักษทัศน์ platform</p>'],
      ['/b', '<p>KKU Curriculum Landscape</p>'],
    ]);
    const details = findRetiredNames(html).map((p) => p.detail);
    expect(details).toContain('/a contains retired name "ทักษทัศน์"');
    expect(details).toContain('/b contains retired name "KKU Curriculum Landscape"');
  });
});

describe('bilingual twin check', () => {
  const en = ['# T', '[ไทย](../th/a/A.md)', '## One', '### Two', '```bash', 'pnpm x', '```', '#### skipped'].join('\n');
  const th = ['# ท', '[English](../../a/A.md)', '## หนึ่ง', '### สอง', '```bash', 'pnpm x', '```'].join('\n');

  it('counts only ## and ### headings outside code', () => {
    expect(structuralHeadings(en + '\n```\n## not a heading\n```')).toEqual(['## One', '### Two']);
    expect(fencedBlocks(en)).toEqual(['pnpm x']);
  });

  it('passes a faithful twin', () => {
    expect(checkTwinPair('a/A.md', en, th)).toEqual([]);
  });

  it('reports a missing twin', () => {
    expect(checkTwinPair('a/A.md', en, null)[0]?.detail).toContain('th/a/A.md is missing');
  });

  it('reports heading drift', () => {
    const p = checkTwinPair('a/A.md', en, th.replace('### สอง\n', ''));
    expect(p.map((x) => x.detail).join()).toContain('heading drift');
  });

  it('reports code drift', () => {
    const p = checkTwinPair('a/A.md', en, th.replace('pnpm x', 'pnpm y'));
    expect(p.map((x) => x.detail).join()).toContain('code drift');
  });

  it('reports missing links in either direction', () => {
    const a = checkTwinPair('a/A.md', en.replace('../th/a/A.md', '../th/a/B.md'), th);
    expect(a[0]?.detail).toContain('must link to th/a/A.md');
    const b = checkTwinPair('a/A.md', en, th.replace('../../a/A.md', '../../a/B.md'));
    expect(b[0]?.detail).toContain('must link back to a/A.md');
  });

  it('resolves links, so a same-named page in another folder does not count', () => {
    const wrongDir = th.replace('../../a/A.md', './A.md');
    expect(checkTwinPair('a/A.md', en, wrongDir)[0]?.detail).toContain('must link back');
  });

  it('accepts the docs/th layout and rejects a link back to the wrong page', () => {
    expect(checkTwinPair('tutorials/a.md', '# A\n[ไทย](../th/tutorials/a.md)', '# A\n[English](../../tutorials/a.md)')).toEqual([]);
    const p = checkTwinPair('tutorials/a.md', '# A\n[ไทย](../th/tutorials/a.md)', '# A\n[English](../../tutorials/b.md)');
    expect(p).toHaveLength(1);
    expect(p[0]?.kind).toBe('bilingual-twin');
    expect(p[0]?.detail).toContain('must link back');
  });
});
