import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { DotRange } from '../src/charts/dot-range';

const PROV = { source: 'tcas-connector', runDate: '12 Aug 2026', method: 'peer-score-range.v1' };

const ROWS = [
  { label: 'Computer Engineering', value: 68, min: 60, max: 75 },
  { label: 'Civil Engineering', value: 55, min: 50, max: 65 },
  { label: 'Electrical Engineering', value: 62, min: 58, max: 70 },
];

function rangeLabel(row: { value: number; min: number; max: number }): string {
  return `${row.value} (peer ${row.min}–${row.max})`;
}

interface DotMatch {
  cx: number;
  cy: number;
  fill: string;
}

function valueDots(html: string): DotMatch[] {
  return [
    ...html.matchAll(
      /<circle class="dotrange-value" cx="([\d.-]+)" cy="([\d.-]+)" r="[\d.-]+" fill="([^"]+)"/g,
    ),
  ].map((m) => ({ cx: Number(m[1]), cy: Number(m[2]), fill: m[3] as string }));
}

interface CapMatch {
  x1: number;
  x2: number;
}

function capLines(html: string): CapMatch[] {
  return [...html.matchAll(/<line class="dotrange-cap" x1="([\d.-]+)" y1="[\d.-]+" x2="([\d.-]+)"/g)].map(
    (m) => ({ x1: Number(m[1]), x2: Number(m[2]) }),
  );
}

describe('DotRange', () => {
  it('draws one range and one value dot per row', () => {
    const html = renderToStaticMarkup(<DotRange rows={ROWS} provenance={PROV} title="TCAS3 vs peer range" />);
    expect(html.match(/class="dotrange-range"/g) ?? []).toHaveLength(3);
    expect(html.match(/class="dotrange-value"/g) ?? []).toHaveLength(3);
  });

  it('labels every row and prints its value against its peer range', () => {
    const html = renderToStaticMarkup(<DotRange rows={ROWS} provenance={PROV} title="TCAS3 vs peer range" />);
    for (const r of ROWS) {
      expect(html).toContain(r.label);
      expect(html).toContain(rangeLabel(r));
    }
  });

  it('places a larger value at a larger x on the shared axis', () => {
    const html = renderToStaticMarkup(<DotRange rows={ROWS} provenance={PROV} title="TCAS3 vs peer range" />);
    const dots = valueDots(html);
    expect(dots).toHaveLength(3);
    // Row order: Computer Eng (68), Civil Eng (55), Electrical Eng (62).
    // Value order is 68 > 62 > 55, so cx order must follow: dots[0] > dots[2] > dots[1].
    const compEng = dots[0];
    const civilEng = dots[1];
    const elecEng = dots[2];
    if (!compEng || !civilEng || !elecEng) throw new Error('fixture bug: missing dot');
    expect(compEng.cx).toBeGreaterThan(elecEng.cx);
    expect(elecEng.cx).toBeGreaterThan(civilEng.cx);
  });

  it('renders the empty state for an empty row set rather than an axis with nothing on it', () => {
    const html = renderToStaticMarkup(
      <DotRange rows={[]} provenance={PROV} title="TCAS3 vs peer range" emptyNote="No TCAS3 score rows" />,
    );
    expect(html).toContain('No TCAS3 score rows');
    expect(html).not.toContain('class="dotrange-value"');
  });

  // A degenerate all-zero domain must not divide by zero and produce NaN
  // coordinates.
  it('survives an all-zero series', () => {
    const html = renderToStaticMarkup(
      <DotRange
        rows={[
          { label: 'a', value: 0, min: 0, max: 0 },
          { label: 'b', value: 0, min: 0, max: 0 },
        ]}
        provenance={PROV}
        title="TCAS3 vs peer range"
      />,
    );
    expect(html).not.toContain('NaN');
  });

  it('matches the golden snapshot', () => {
    expect(
      renderToStaticMarkup(<DotRange rows={ROWS} provenance={PROV} title="TCAS3 vs peer range" />),
    ).toMatchSnapshot();
  });

  // The critical behaviour: a value outside its own [min, max] is a real
  // data-quality signal (a program admitting below or above its peer band)
  // and must be rendered honestly on the shared axis — not clamped into the
  // range, which would erase the evidence, and not dropped, which would
  // hide it entirely.
  it('renders an out-of-range value unclamped and marks it', () => {
    const rows = [
      { label: 'Normal Program', value: 65, min: 60, max: 75 },
      { label: 'Overachiever Program', value: 90, min: 60, max: 75 },
    ];
    const html = renderToStaticMarkup(<DotRange rows={rows} provenance={PROV} title="TCAS3 vs peer range" />);
    const dots = valueDots(html);
    const caps = capLines(html);
    expect(dots).toHaveLength(2);
    expect(caps).toHaveLength(4); // 2 rows x (min cap + max cap)

    const normalDot = dots[0];
    const overachieverDot = dots[1];
    const overachieverCaps = caps.slice(2, 4); // this row's [minCap, maxCap]
    const maxCap = overachieverCaps[1];
    if (!normalDot || !overachieverDot || !maxCap) throw new Error('fixture bug: missing element');

    // Not clamped: the dot sits strictly past the range's own max-cap x,
    // proving the value (90) rendered at its true position rather than
    // snapping back to the range ceiling (75).
    expect(overachieverDot.cx).toBeGreaterThan(maxCap.x1);

    // Marked: warning fill on the anomalous dot only, plus an explicit note.
    expect(overachieverDot.fill).toBe('#A15C00'); // SEMANTIC.warning
    expect(normalDot.fill).not.toBe('#A15C00');
    expect(html.match(/class="dotrange-anomaly-note"/g) ?? []).toHaveLength(1);
    expect(html).toContain('outside peer range');
  });

  // The comparability guarantee: two rows with different peer ranges must
  // still map the SAME value to the SAME x pixel — a per-row scale would
  // make the chart lie by comparison (a dot at "the same visual position"
  // could mean two different underlying values).
  it('shares one x domain across rows with different peer ranges', () => {
    const rows = [
      { label: 'Wide range', value: 50, min: 0, max: 100 },
      { label: 'Narrow range', value: 50, min: 20, max: 80 },
    ];
    const html = renderToStaticMarkup(<DotRange rows={rows} provenance={PROV} title="TCAS3 vs peer range" />);
    const dots = valueDots(html);
    expect(dots).toHaveLength(2);
    const wide = dots[0];
    const narrow = dots[1];
    if (!wide || !narrow) throw new Error('fixture bug: missing dot');
    expect(wide.cx).toBeCloseTo(narrow.cx, 6);
  });

  // A range with min > max would map to a negative-width bar that SVG drops
  // silently — a genuine data bug, not a state this chart should visualise.
  it('throws when a row has min greater than max', () => {
    expect(() =>
      renderToStaticMarkup(
        <DotRange
          rows={[{ label: 'Broken', value: 10, min: 80, max: 20 }]}
          provenance={PROV}
          title="TCAS3 vs peer range"
        />,
      ),
    ).toThrow(RangeError);
  });

  // A labelWidthMm wide enough to eat the whole plot area must fail loudly,
  // not silently render every dot at the same collapsed x.
  it('throws when labelWidthMm leaves no room to plot', () => {
    expect(() =>
      renderToStaticMarkup(<DotRange rows={ROWS} provenance={PROV} title="TCAS3 vs peer range" labelWidthMm={170} />),
    ).toThrow(RangeError);
  });
});
