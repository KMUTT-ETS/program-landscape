import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Waterfall } from '../src/charts/waterfall';

const PROV = { source: 'kku-finance', runDate: '12 Aug 2026', method: 'cost-allocation.v0' };

const BARS = [
  { label: 'Revenue', delta: 120 },
  { label: 'Operating costs', delta: -45 },
  { label: 'Tax', delta: -15 },
  { label: 'Net margin', delta: 60, isTotal: true },
];

interface BarRect {
  kind: string;
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
}

function barRects(html: string): BarRect[] {
  return [
    ...html.matchAll(
      /<rect class="waterfall-bar (positive|negative|total)" x="([\d.-]+)" y="([\d.-]+)" width="([\d.-]+)" height="([\d.-]+)" fill="([^"]+)"/g,
    ),
  ].map((m) => ({
    kind: m[1] as string,
    x: Number(m[2]),
    y: Number(m[3]),
    width: Number(m[4]),
    height: Number(m[5]),
    fill: m[6] as string,
  }));
}

function zeroLineY(html: string): number {
  const match = /<line class="waterfall-zero-line" x1="[\d.-]+" y1="([\d.-]+)"/.exec(html);
  if (!match?.[1]) throw new Error('fixture bug: no waterfall-zero-line found');
  return Number(match[1]);
}

describe('Waterfall', () => {
  it('draws one bar per row', () => {
    const html = renderToStaticMarkup(<Waterfall bars={BARS} provenance={PROV} title="Revenue bridge" />);
    expect(html.match(/class="waterfall-bar/g) ?? []).toHaveLength(4);
  });

  it('labels every row and prints its value', () => {
    const html = renderToStaticMarkup(<Waterfall bars={BARS} provenance={PROV} title="Revenue bridge" />);
    for (const b of BARS) expect(html).toContain(b.label);
    expect(html).toContain('+120');
    expect(html).toContain('-45');
    expect(html).toContain('-15');
    expect(html).toContain('>60<'); // the total renders its absolute value, no '+'
  });

  it('renders a taller bar for a larger-magnitude delta', () => {
    const html = renderToStaticMarkup(<Waterfall bars={BARS} provenance={PROV} title="Revenue bridge" />);
    const rects = barRects(html);
    expect(rects).toHaveLength(4);
    const revenue = rects[0];
    const tax = rects[2];
    if (!revenue || !tax) throw new Error('fixture bug: missing bar');
    // Revenue spans the full 0->120 run; Tax only spans a 15-unit drop —
    // Revenue's rendered bar must be taller.
    expect(revenue.height).toBeGreaterThan(tax.height);
  });

  it('renders the empty state for an empty bar set rather than an axis with nothing on it', () => {
    const html = renderToStaticMarkup(
      <Waterfall bars={[]} provenance={PROV} title="Revenue bridge" emptyNote="No financial metric rows" />,
    );
    expect(html).toContain('No financial metric rows');
    expect(html).not.toContain('class="waterfall-bar');
  });

  // An all-zero series must not divide by zero and produce NaN coordinates —
  // the degenerate domainMin === domainMax case.
  it('survives an all-zero series', () => {
    const html = renderToStaticMarkup(
      <Waterfall
        bars={[
          { label: 'a', delta: 0 },
          { label: 'b', delta: 0 },
        ]}
        provenance={PROV}
        title="Revenue bridge"
      />,
    );
    expect(html).not.toContain('NaN');
  });

  it('matches the golden snapshot', () => {
    expect(
      renderToStaticMarkup(<Waterfall bars={BARS} provenance={PROV} title="Revenue bridge" />),
    ).toMatchSnapshot();
  });

  // Negative deltas must draw DOWNWARD from the running total established by
  // the bars before them — not from zero (that would be a plain signed bar
  // chart, not a waterfall) and not reordered/clamped. Verified precisely:
  // the negative bar's top edge lands exactly where the previous bar left
  // the running total (continuity, no gap), and its bottom edge — "the
  // bar's y is below (numerically greater than) the running total's y
  // before it" per the brief — reaches further down the page than any
  // bar rendered so far, proving it actually descends past that baseline
  // rather than floating at/above it.
  it('draws negative deltas below the running baseline in SEMANTIC.danger', () => {
    const rows = [
      { label: 'Opening', delta: 20 },
      { label: 'Big loss', delta: -50 },
    ];
    const html = renderToStaticMarkup(<Waterfall bars={rows} provenance={PROV} title="Revenue bridge" />);
    const rects = barRects(html);
    expect(rects).toHaveLength(2);
    const opening = rects[0];
    const bigLoss = rects[1];
    if (!opening || !bigLoss) throw new Error('fixture bug: missing bar');

    expect(opening.fill).toBe('#046C4E'); // SEMANTIC.success
    expect(bigLoss.fill).toBe('#B42318'); // SEMANTIC.danger

    // Big loss starts exactly where Opening's running total ended — same
    // top edge, no gap, no jump back to zero.
    expect(bigLoss.y).toBeCloseTo(opening.y, 6);

    // And its bottom edge — the running-total-before-it is Opening's own
    // top (y=20's pixel row) — sits strictly below (numerically greater
    // than) that reference, because the bar actually descends past it.
    expect(bigLoss.y + bigLoss.height).toBeGreaterThan(opening.y);
    // It also reaches further down the page than Opening's own bottom did,
    // which is the concrete "below the running baseline" claim: nothing
    // rendered before this bar went this far down.
    expect(bigLoss.y + bigLoss.height).toBeGreaterThan(opening.y + opening.height);
  });

  // The bug this test exists to catch: an isTotal bar silently drawn from
  // the running total instead of from zero. Net margin's delta (90) is
  // deliberately different from the running total at that point (60) so the
  // two interpretations land at visibly different heights — a buggy
  // "continue from running total" implementation would render a bar from
  // 60 to 150, not 0 to 90, and this test would fail against that bug.
  it('draws an isTotal bar from zero, not from the running total', () => {
    const rows = [
      { label: 'Revenue', delta: 100 },
      { label: 'Costs', delta: -40 }, // running total after this bar: 60
      { label: 'Net margin', delta: 90, isTotal: true }, // deliberately != 60
    ];
    const html = renderToStaticMarkup(<Waterfall bars={rows} provenance={PROV} title="Revenue bridge" />);
    const rects = barRects(html);
    expect(rects).toHaveLength(3);
    const total = rects[2];
    if (!total) throw new Error('fixture bug: missing total bar');
    expect(total.kind).toBe('total');

    const zeroY = zeroLineY(html);
    // The total's base (its edge at value 0) must sit exactly on the zero
    // line — not on the y=60 running-total line a buggy implementation
    // would use instead.
    expect(total.y + total.height).toBeCloseTo(zeroY, 6);
  });

  // A columnWidthMm wide enough that bars don't fit within widthMm must
  // fail loudly, not silently overflow the page width — same posture as
  // BarsStacked's identical guard.
  it('throws when columnWidthMm leaves no room for all bars', () => {
    expect(() =>
      renderToStaticMarkup(
        <Waterfall bars={BARS} provenance={PROV} title="Revenue bridge" columnWidthMm={100} />,
      ),
    ).toThrow(RangeError);
  });
});
