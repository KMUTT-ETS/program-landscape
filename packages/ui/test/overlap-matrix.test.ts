import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { OverlapMatrix, bandOpacity, contiguousSpan } from '../src/viz/overlap-matrix';

describe('bandOpacity', () => {
  it('steps by band', () => {
    expect(bandOpacity(10)).toBeLessThan(bandOpacity(30));
    expect(bandOpacity(30)).toBe(bandOpacity(49));
    expect(bandOpacity(49)).toBeLessThan(bandOpacity(50));
    expect(bandOpacity(50)).toBe(bandOpacity(69));
    expect(bandOpacity(69)).toBeLessThan(bandOpacity(70));
    expect(bandOpacity(70)).toBe(bandOpacity(100));
  });
});

describe('contiguousSpan', () => {
  const order = ['a', 'b', 'c', 'd', 'e'];
  it('returns the span of contiguous members in any order', () => {
    expect(contiguousSpan(order, ['d', 'b', 'c'])).toEqual({ start: 1, end: 3 });
  });
  it('rejects non-contiguous, missing and empty groups', () => {
    expect(contiguousSpan(order, ['a', 'c'])).toBeNull();
    expect(contiguousSpan(order, ['a', 'z'])).toBeNull();
    expect(contiguousSpan(order, [])).toBeNull();
  });
  it('ignores duplicate members', () => {
    expect(contiguousSpan(order, ['a', 'b', 'a'])).toEqual({ start: 0, end: 1 });
  });
});

describe('OverlapMatrix', () => {
  const programmes = [
    { id: 'p1', label: 'Physics' },
    { id: 'p2', label: 'Applied Physics' },
    { id: 'p3', label: 'Law' },
  ];

  it('renders the empty state below two programmes', () => {
    const html = renderToStaticMarkup(createElement(OverlapMatrix, { programmes: programmes.slice(0, 1), cells: [] }));
    expect(html).toContain('No programmes to compare at this level.');
  });

  it('draws both triangles of a stored pair and hides cells under threshold', () => {
    const html = renderToStaticMarkup(
      createElement(OverlapMatrix, {
        programmes,
        cells: [
          { a: 'p1', b: 'p2', value: 72, title: 'Physics × Applied Physics: 72' },
          { a: 'p1', b: 'p3', value: 20, title: 'Physics × Law: 20' },
        ],
        threshold: 30,
        groups: [{ members: ['p1', 'p2'] }],
      }),
    );
    expect(html.match(/Physics × Applied Physics: 72/g)).toHaveLength(2);
    expect(html).not.toContain('Physics × Law: 20');
    expect(html).toContain('aria-label="Programme overlap matrix"');
  });
});
