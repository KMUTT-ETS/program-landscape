import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BarsStacked } from '../src/charts/bars-stacked';

const PROV = { source: 'kku-registry', runDate: '12 Aug 2026', method: 'cohort.v1' };

// One category ('2568') carries a zero-value segment — deliberately, to
// exercise the "zero renders no rect" rule alongside the normal path rather
// than needing a separate fixture for it.
const CATEGORIES = [
  {
    category: '2567',
    segments: [
      { label: 'Active', value: 40 },
      { label: 'Graduated', value: 10 },
      { label: 'Dropout', value: 5 },
    ],
  },
  {
    category: '2568',
    segments: [
      { label: 'Active', value: 55 },
      { label: 'Graduated', value: 0 },
      { label: 'Dropout', value: 8 },
    ],
  },
  {
    category: '2569',
    segments: [
      { label: 'Active', value: 30 },
      { label: 'Graduated', value: 2 },
      { label: 'Dropout', value: 3 },
    ],
  },
];

/** Pull the inner markup of one category's <g data-category="..."> block. */
function categoryBlock(html: string, category: string): string {
  const match = new RegExp(`<g[^>]*data-category="${category}"[^>]*>(.*?)</g>`).exec(html);
  if (!match?.[1]) throw new Error(`fixture bug: no <g data-category="${category}"> found`);
  return match[1];
}

function segmentRects(html: string): { y: number; height: number }[] {
  return [...html.matchAll(/<rect class="segment"[^>]*y="([\d.]+)"[^>]*height="([\d.]+)"/g)].map(
    (m) => ({ y: Number(m[1]), height: Number(m[2]) }),
  );
}

describe('BarsStacked', () => {
  it('draws one segment rect per non-zero segment across all categories', () => {
    const html = renderToStaticMarkup(<BarsStacked categories={CATEGORIES} provenance={PROV} title="Cohort" />);
    // 3 + 2 + 3: 2568's zero-value 'Graduated' segment contributes no rect.
    expect(html.match(/<rect class="segment"/g) ?? []).toHaveLength(8);
  });

  it('labels every category and every segment', () => {
    const html = renderToStaticMarkup(<BarsStacked categories={CATEGORIES} provenance={PROV} title="Cohort" />);
    for (const cat of CATEGORIES) expect(html).toContain(cat.category);
    for (const label of ['Active', 'Graduated', 'Dropout']) expect(html).toContain(label);
  });

  it('renders a taller column for a taller total', () => {
    const html = renderToStaticMarkup(<BarsStacked categories={CATEGORIES} provenance={PROV} title="Cohort" />);
    // 2568 totals 63 (tallest), 2569 totals 35 (shortest) — the tallest
    // column's topmost segment must reach a smaller (higher up) SVG y than
    // the shortest column's, since both share the same baseline.
    const tallTop = Math.min(...segmentRects(categoryBlock(html, '2568')).map((r) => r.y));
    const shortTop = Math.min(...segmentRects(categoryBlock(html, '2569')).map((r) => r.y));
    expect(tallTop).toBeLessThan(shortTop);
  });

  it('renders the empty state for an empty category set rather than an axis with nothing on it', () => {
    const html = renderToStaticMarkup(
      <BarsStacked categories={[]} provenance={PROV} title="Cohort" emptyNote="No cohort rows" />,
    );
    expect(html).toContain('No cohort rows');
    expect(html).not.toContain('class="segment"');
  });

  // An all-zero series must not divide by zero and produce NaN coordinates.
  it('survives an all-zero series', () => {
    const html = renderToStaticMarkup(
      <BarsStacked
        categories={[
          { category: 'a', segments: [{ label: 'x', value: 0 }] },
          { category: 'b', segments: [{ label: 'x', value: 0 }] },
        ]}
        provenance={PROV}
        title="Cohort"
      />,
    );
    expect(html).not.toContain('NaN');
  });

  it('matches the golden snapshot', () => {
    expect(
      renderToStaticMarkup(<BarsStacked categories={CATEGORIES} provenance={PROV} title="Cohort" />),
    ).toMatchSnapshot();
  });

  // The classic stacked-bar bug: segment n must start exactly where n-1
  // ended. Checked precisely, not just "looks about right".
  it('accumulates segment offsets so stacked segments touch with no gap or overlap', () => {
    const html = renderToStaticMarkup(<BarsStacked categories={CATEGORIES} provenance={PROV} title="Cohort" />);
    const rects = segmentRects(categoryBlock(html, '2567'));
    expect(rects).toHaveLength(3);
    // rects[0] is the bottom (first-stacked) segment; rects[1] sits above it.
    // SVG y grows downward, so the lower segment's y must equal the upper
    // segment's y + height.
    expect(rects[0]?.y).toBeCloseTo((rects[1]?.y ?? NaN) + (rects[1]?.height ?? NaN), 6);
    expect(rects[1]?.y).toBeCloseTo((rects[2]?.y ?? NaN) + (rects[2]?.height ?? NaN), 6);
  });

  // A zero-value segment must render no <rect> at all — not a zero-height
  // one, which would be invisible but still pollute the mark count.
  it('renders no rect for a zero-value segment', () => {
    const html = renderToStaticMarkup(<BarsStacked categories={CATEGORIES} provenance={PROV} title="Cohort" />);
    const rects = segmentRects(categoryBlock(html, '2568'));
    // 2568 has 3 segments in the fixture (Active, Graduated=0, Dropout) —
    // only the 2 non-zero ones may render.
    expect(rects).toHaveLength(2);
  });

  // A columnWidthMm wide enough that categories don't fit within widthMm
  // must fail loudly, not silently overflow the page width.
  it('throws when columnWidthMm leaves no room for all categories', () => {
    expect(() =>
      renderToStaticMarkup(
        <BarsStacked categories={CATEGORIES} provenance={PROV} title="Cohort" columnWidthMm={100} />,
      ),
    ).toThrow(RangeError);
  });

  // Segment order must be consistent across categories, because colour and
  // legend are both keyed by array index. A caller that drops a missing
  // status instead of zero-filling it (rather than the correct discipline
  // the CATEGORIES fixture follows) would silently paint one year's
  // 'Dropout' in another year's 'Active' colour — the exact
  // confidently-wrong failure mode this library exists to prevent.
  it('throws when two categories disagree on the label at the same segment index', () => {
    const mismatched = [
      {
        category: '2567',
        segments: [
          { label: 'Active', value: 40 },
          { label: 'Graduated', value: 10 },
          { label: 'Dropout', value: 5 },
        ],
      },
      {
        // 'Dropout' dropped instead of zero-filled — index 1 is now
        // 'Active' here but 'Graduated' in 2567.
        category: '2568',
        segments: [
          { label: 'Dropout', value: 55 },
          { label: 'Active', value: 8 },
        ],
      },
    ];
    expect(() =>
      renderToStaticMarkup(<BarsStacked categories={mismatched} provenance={PROV} title="Cohort" />),
    ).toThrow(RangeError);
  });
});
