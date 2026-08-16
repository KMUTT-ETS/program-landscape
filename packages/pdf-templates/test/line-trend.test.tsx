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

  // Radar marks a null axis with a hollow dashed marker; Matrix hatches a
  // null cell. LineTrend's break-the-path treatment is legible on close
  // inspection but wasn't part of that same visual vocabulary — a missing
  // year previously rendered as simply an absent point and a gap, with no
  // mark AT the missing x telling the reader "there was a year here with no
  // data" as opposed to "this chart skips that year entirely" (e.g. a
  // biennial survey). A dashed LINE across the gap was rejected: this file's
  // own subpaths logic exists specifically so a null is "never bridged by a
  // line segment — that would draw a value nobody observed" (see the `runs`
  // comment above), and a connector line would silently violate that same
  // rule this fix is meant to reinforce. A hollow marker sitting ON the axis
  // (not at any y, since no y is known) cannot be misread as a value the way
  // a connector line could.
  it('marks a null point with a hollow marker on the axis, not a bridging line', () => {
    const html = renderToStaticMarkup(
      <LineTrend
        points={[
          { x: 1, y: 10 },
          { x: 2, y: 20 },
          { x: 3, y: null },
          { x: 4, y: 40 },
        ]}
        provenance={PROV}
        title="Outcomes"
      />,
    );
    const nullMarkers = [...html.matchAll(/<circle class="linetrend-null-marker"[^>]*cx="([\d.]+)"[^>]*cy="([\d.]+)"/g)];
    expect(nullMarkers).toHaveLength(1);
    // Sits at the null point's own x — same x scale as the real markers.
    const realMarkerCx = [...html.matchAll(/<circle class="point"[^>]*cx="([\d.]+)"/g)].map((m) => Number(m[1]));
    const nullCx = Number(nullMarkers[0]?.[1]);
    // x=3 is exactly between x=2 and x=4's real markers on a linear x scale.
    expect(nullCx).toBeGreaterThan(realMarkerCx[1] ?? NaN);
    expect(nullCx).toBeLessThan(realMarkerCx[2] ?? NaN);
    // Hollow (surface fill), not a filled data mark — same "hollow = not
    // observed" vocabulary as Radar's null-axis marker and this file's own
    // projected-point treatment.
    expect(html).toMatch(/<circle class="linetrend-null-marker"[^>]*fill="#F6F4F0"/);
  });

  // A leftGutterMm wide enough to eat the whole plot area must fail loudly,
  // not render a line squeezed into (or past) negative width.
  it('throws when leftGutterMm leaves no room to plot', () => {
    expect(() =>
      renderToStaticMarkup(<LineTrend points={POINTS} provenance={PROV} title="Outcomes" leftGutterMm={200} />),
    ).toThrow(RangeError);
  });

  // Opt-in tick formatting — added for series with large magnitudes (e.g.
  // cohort population in the millions), where a raw tick value like
  // '3500000' is unreadable on paper. Default (no formatTick) must stay
  // byte-identical to the pre-existing behaviour — see the golden snapshot
  // test above, which passes formatTick undefined.
  it('formats y-axis ticks through formatTick when supplied', () => {
    const html = renderToStaticMarkup(
      <LineTrend
        points={POINTS}
        provenance={PROV}
        title="Outcomes"
        formatTick={(v) => `${v}!!`}
      />,
    );
    const yValues = POINTS.map((p) => p.y);
    const expectedTicks = niceTicks(Math.min(...yValues), Math.max(...yValues), 5);
    for (const t of expectedTicks) expect(html).toContain(`>${t}!!<`);
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
