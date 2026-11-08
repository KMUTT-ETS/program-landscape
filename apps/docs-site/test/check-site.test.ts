import { describe, expect, it } from 'vitest';
import {
  checkPageShape,
  checkThaiLinks,
  checkSidebarCoverage,
  checkTwinPair,
  fencedBlocks,
  structuralHeadings,
  collectSidebarLinks,
  findRetiredNames,
  htmlRoute,
} from '../src/check-site';
import { needsPageShape } from '../src/manifest';

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

describe('page shape', () => {
  it('applies to tutorials, guides and workshop pages, not to overviews or reference pages', () => {
    expect(needsPageShape('guides/deploy.md')).toBe(true);
    expect(needsPageShape('th/workshop/01-environment-and-ai-tools.md')).toBe(true);
    expect(needsPageShape('th/workshop/troubleshooting.md')).toBe(false);
    expect(needsPageShape('workshop/facilitator.md')).toBe(false);
    expect(needsPageShape('tutorials/README.md')).toBe(false);
    expect(needsPageShape('architecture.md')).toBe(false);
  });

  it('passes a page with an outcome and a next step', () => {
    expect(checkPageShape('guides/x.md', '# X\n\n**Outcome.** You can.\n\n## Next step\n')).toEqual([]);
    expect(checkPageShape('th/guides/x.md', '# X\n\n**ผลลัพธ์** ได้\n\n## ขั้นต่อไป\n')).toEqual([]);
  });

  it('names each missing marker', () => {
    const p = checkPageShape('guides/x.md', '# X\n');
    expect(p).toHaveLength(2);
    expect(p.every((x) => x.kind === 'page-shape')).toBe(true);
    expect(p.map((x) => x.detail).join()).toContain('**Outcome.**');
    expect(p.map((x) => x.detail).join()).toContain('## Next step');
  });

  it('only accepts an outcome near the top, and the English markers on English pages', () => {
    const late = '# X\n' + '\n'.repeat(25) + '**Outcome.** late\n## Next step\n';
    expect(checkPageShape('guides/x.md', late)).toHaveLength(1);
    expect(checkPageShape('guides/x.md', '# X\n**ผลลัพธ์** ได้\n## ขั้นต่อไป\n')).toHaveLength(2);
  });
});

describe('Thai pages link Thai pages', () => {
  const exists = (rel: string): boolean => ['th/data-import.md', 'data-import.md', 'th/guides/x.md', 'guides/x.md', 'pdpa.md'].includes(rel);

  it('flags a link to an English page whose Thai twin exists', () => {
    const p = checkThaiLinks('th/adopters/README.md', 'See [import](../../data-import.md#a).', exists);
    expect(p).toHaveLength(1);
    expect(p[0]?.kind).toBe('wrong-language');
    expect(p[0]?.detail).toContain('th/data-import.md');
  });

  it('allows the banner link to its own English twin, English-only pages and Thai links', () => {
    const md = ['# x', '> **English:** [English](../../guides/x.md)', '[pdpa](../../pdpa.md) [ok](../data-import.md)'].join('\n');
    expect(checkThaiLinks('th/guides/x.md', md, exists)).toEqual([]);
  });

  it('ignores links inside code blocks', () => {
    expect(checkThaiLinks('th/adopters/README.md', '```\n[a](../../data-import.md)\n```', exists)).toEqual([]);
  });
});
