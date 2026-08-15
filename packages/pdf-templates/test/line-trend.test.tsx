import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LineTrend } from '../src/charts/line-trend';
import { niceTicks } from '../src/charts/scale';

const PROV = { source: 'kku-registry', runDate: '12 Aug 2026', method: 'forecasting.v1' };

const POINTS = [
  { x: 2020, y: 100 },
  { x: 2021, y: 150 },
  { x: 2022, y: 90 },
  { x: 2023, y: 200 },
];

function markerCyValues(html: string): number[] {
  return [...html.matchAll(/<circle class="point"[^>]*cy="([\d.]+)"/g)].map((m) => Number(m[1]));
}

function pathTags(html: string): string[] {
  return [...html.matchAll(/<path[^>]*>/g)].map((m) => m[0]);
}

describe('LineTrend', () => {
  it('draws one marker per non-null point', () => {
    const html = renderToStaticMarkup(<LineTrend points={POINTS} provenance={PROV} title="Outcomes" />);
    expect(html.match(/<circle class="point"/g) ?? []).toHaveLength(4);
  });

  it('renders x and y axis tick labels, the y ticks from niceTicks', () => {
    const html = renderToStaticMarkup(<LineTrend points={POINTS} provenance={PROV} title="Outcomes" />);
    for (const p of POINTS) expect(html).toContain(String(p.x));
    const yValues = POINTS.map((p) => p.y);
    const expectedTicks = niceTicks(Math.min(...yValues), Math.max(...yValues), 5);
    for (const t of expectedTicks) expect(html).toContain(`>${t}<`);
  });

  it('places a higher y value at a smaller SVG y coordinate', () => {
    const html = renderToStaticMarkup(<LineTrend points={POINTS} provenance={PROV} title="Outcomes" />);
    const cys = markerCyValues(html);
    expect(cys).toHaveLength(4);
    // POINTS[2].y = 90 (lower), POINTS[3].y = 200 (higher). SVG y grows
    // downward, so the higher value's marker must sit at a SMALLER y.
    expect(cys[3]).toBeLessThan(cys[2] ?? NaN);
  });

  it('renders the empty state for an empty point set rather than an axis with nothing on it', () => {
    const html = renderToStaticMarkup(
      <LineTrend points={[]} provenance={PROV} title="Outcomes" emptyNote="No forecast rows" />,
    );
    expect(html).toContain('No forecast rows');
    expect(html).not.toContain('class="point"');
  });

  // An all-zero series must not divide by zero and produce NaN coordinates.
  it('survives an all-zero series', () => {
    const html = renderToStaticMarkup(
      <LineTrend
        points={[{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 3, y: 0 }]}
        provenance={PROV}
        title="Outcomes"
      />,
    );
    expect(html).not.toContain('NaN');
  });

  it('matches the golden snapshot', () => {
    expect(renderToStaticMarkup(<LineTrend points={POINTS} provenance={PROV} title="Outcomes" />))
      .toMatchSnapshot();
  });

  // A null y is a data gap, not a zero — interpolating a line across it would
  // invent a number nobody observed. The path must break into two elements.
  it('breaks the path into two <path> elements around a null y', () => {
    const html = renderToStaticMarkup(
      <LineTrend
        points={[
          { x: 1, y: 10 },
          { x: 2, y: 20 },
          { x: 3, y: null },
          { x: 4, y: 40 },
          { x: 5, y: 50 },
        ]}
        provenance={PROV}
        title="Outcomes"
      />,
    );
    expect(pathTags(html)).toHaveLength(2);
  });

  it('renders the portion at/after projectedFrom dashed, and the actual portion solid', () => {
    const html = renderToStaticMarkup(
      <LineTrend
        points={[
          { x: 2020, y: 100 },
          { x: 2021, y: 150 },
          { x: 2022, y: 90 },
          { x: 2023, y: 200 },
          { x: 2024, y: 210 },
        ]}
        projectedFrom={2023}
        provenance={PROV}
        title="Outcomes"
      />,
    );
    const paths = pathTags(html);
    expect(paths).toHaveLength(2);
    const dashed = paths.filter((p) => p.includes('stroke-dasharray'));
    const solid = paths.filter((p) => !p.includes('stroke-dasharray'));
    expect(dashed).toHaveLength(1);
    expect(solid).toHaveLength(1);
  });

  // A leftGutterMm wide enough to eat the whole plot area must fail loudly,
  // not render a line squeezed into (or past) negative width.
  it('throws when leftGutterMm leaves no room to plot', () => {
    expect(() =>
      renderToStaticMarkup(<LineTrend points={POINTS} provenance={PROV} title="Outcomes" leftGutterMm={200} />),
    ).toThrow(RangeError);
  });

  // Every point present but every y null: genuinely nothing to plot — same
  // "data gap, not zero" posture as the empty-array case, not a flat line at 0.
  it('renders the empty state when every y is null', () => {
    const html = renderToStaticMarkup(
      <LineTrend
        points={[{ x: 1, y: null }, { x: 2, y: null }]}
        provenance={PROV}
        title="Outcomes"
        emptyNote="No observed values"
      />,
    );
    expect(html).toContain('No observed values');
    expect(html).not.toContain('class="point"');
  });
});
