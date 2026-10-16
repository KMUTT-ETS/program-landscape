import { describe, expect, it } from 'vitest';
import {
  checkSidebarCoverage,
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
