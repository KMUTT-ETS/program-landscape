import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Radar } from '../src/charts/radar';

const PROV = { source: 'kku-registry', runDate: '12 Aug 2026', method: 'health-score.v1' };

// Mirrors the real health-score dimensions: relevance + capability are
// deliberately null (methodology excludes missing metrics, never zero-fills).
const AXES = [
  { label: 'Demand', value: 78, max: 100 },
  { label: 'Financial', value: 55, max: 100 },
  { label: 'Quality', value: 90, max: 100 },
  { label: 'Relevance', value: null, max: 100 },
  { label: 'Capability', value: null, max: 100 },
];

describe('Radar', () => {
  it('draws one spoke per axis', () => {
    const html = renderToStaticMarkup(<Radar axes={AXES} provenance={PROV} title="Health score" />);
    expect(html.match(/class="radar-spoke"/g) ?? []).toHaveLength(5);
  });

  it('labels every axis', () => {
    const html = renderToStaticMarkup(<Radar axes={AXES} provenance={PROV} title="Health score" />);
    for (const a of AXES) expect(html).toContain(a.label);
  });

  it('plots a vertex farther from centre for a larger value', () => {
    // Two axes, same max, different values — the vertex for the larger
    // value must sit at a larger radius (farther from the shared centre).
    const html = renderToStaticMarkup(
      <Radar
        axes={[
          { label: 'Low', value: 10, max: 100 },
          { label: 'High', value: 90, max: 100 },
          { label: 'Third', value: 50, max: 100 },
        ]}
        provenance={PROV}
        title="Health score"
      />,
    );
    const vertices = [...html.matchAll(/class="radar-vertex"[^>]*cx="([\d.-]+)" cy="([\d.-]+)"/g)].map(
      (m) => ({ cx: Number(m[1]), cy: Number(m[2]) }),
    );
    expect(vertices).toHaveLength(3);
    // Centre is equidistant from all outer ring points; compare distance
    // from the first vertex's own axis line is fiddly, so instead compare
    // against the chart centre directly, which every vertex is a straight
    // radius away from along its own axis.
    const cxMatch = /<circle class="radar-centre" cx="([\d.-]+)" cy="([\d.-]+)"/.exec(html);
    if (!cxMatch?.[1] || !cxMatch[2]) throw new Error('fixture bug: no centre marker found');
    const centre = { x: Number(cxMatch[1]), y: Number(cxMatch[2]) };
    const dist = (p: { cx: number; cy: number }) => Math.hypot(p.cx - centre.x, p.cy - centre.y);
    const low = vertices[0];
    const high = vertices[1];
    if (!low || !high) throw new Error('fixture bug: missing vertex');
    expect(dist(high)).toBeGreaterThan(dist(low));
  });

  it('renders the empty state for fewer than 3 axes', () => {
    const html = renderToStaticMarkup(
      <Radar
        axes={[
          { label: 'a', value: 10, max: 100 },
          { label: 'b', value: 20, max: 100 },
        ]}
        provenance={PROV}
        title="Health score"
        emptyNote="Need at least 3 dimensions"
      />,
    );
    expect(html).toContain('Need at least 3 dimensions');
    expect(html).not.toContain('class="radar-spoke"');
  });

  it('survives an all-zero series', () => {
    const html = renderToStaticMarkup(
      <Radar
        axes={[
          { label: 'a', value: 0, max: 100 },
          { label: 'b', value: 0, max: 100 },
          { label: 'c', value: 0, max: 100 },
        ]}
        provenance={PROV}
        title="Health score"
      />,
    );
    expect(html).not.toContain('NaN');
  });

  it('matches the golden snapshot', () => {
    expect(renderToStaticMarkup(<Radar axes={AXES} provenance={PROV} title="Health score" />)).toMatchSnapshot();
  });

  // A radar needs at least a triangle — two axes would render a degenerate
  // line, not a recognisable polygon web.
  it('renders the empty state for exactly 2 axes (below the triangle minimum)', () => {
    const html = renderToStaticMarkup(
      <Radar
        axes={[
          { label: 'a', value: 10, max: 100 },
          { label: 'b', value: 20, max: 100 },
        ]}
        provenance={PROV}
        title="Health score"
      />,
    );
    expect(html).not.toContain('class="radar-value"');
  });

  // The value polygon must close — first and last point coincide, either via
  // an explicit repeated coordinate or a closing path command.
  it('closes the value polygon', () => {
    const html = renderToStaticMarkup(<Radar axes={AXES} provenance={PROV} title="Health score" />);
    const match = /class="radar-value"[^>]*\sd="([^"]+)"/.exec(html);
    if (!match?.[1]) throw new Error('fixture bug: no radar-value path found');
    expect(match[1].trim().toUpperCase().endsWith('Z')).toBe(true);
  });

  // The single most important behaviour in this primitive: a null axis
  // (no data) must never look like a zero-valued axis (a real, bad score).
  // Rendering both charts and diffing markup for the axis under test proves
  // the distinction actually shows up, not just that the code has an if.
  it('renders a null axis distinctly from a zero-valued axis', () => {
    const withZero = renderToStaticMarkup(
      <Radar
        axes={[
          { label: 'Demand', value: 50, max: 100 },
          { label: 'Financial', value: 50, max: 100 },
          { label: 'Relevance', value: 0, max: 100 },
        ]}
        provenance={PROV}
        title="Health score"
      />,
    );
    const withNull = renderToStaticMarkup(
      <Radar
        axes={[
          { label: 'Demand', value: 50, max: 100 },
          { label: 'Financial', value: 50, max: 100 },
          { label: 'Relevance', value: null, max: 100 },
        ]}
        provenance={PROV}
        title="Health score"
      />,
    );
    expect(withZero).not.toEqual(withNull);

    // The zero-valued axis contributes a normal plotted vertex...
    expect(withZero.match(/class="radar-vertex"/g) ?? []).toHaveLength(3);
    // ...but the null axis is excluded from the plotted vertices and instead
    // gets a distinct "no data" marker, so the value polygon only spans the
    // two axes that actually have data.
    expect(withNull.match(/class="radar-vertex"/g) ?? []).toHaveLength(2);
    expect(withNull).toContain('radar-null-marker');
    expect(withZero).not.toContain('radar-null-marker');
  });
});
