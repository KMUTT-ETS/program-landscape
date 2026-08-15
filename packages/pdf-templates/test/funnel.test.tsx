import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Funnel } from '../src/charts/funnel';

const PROV = { source: 'kku-registry', runDate: '12 Aug 2026', method: 'demand-funnel.v1' };

const STAGES = [
  { label: 'Applied', value: 2400 },
  { label: 'Admitted', value: 1200 },
  { label: 'Enrolled', value: 980 },
  { label: 'Graduated', value: 820 },
];

function bandWidths(html: string): number[] {
  return [...html.matchAll(/class="funnel-band[^"]*"[^>]*width="([\d.]+)"/g)].map((m) => Number(m[1]));
}

describe('Funnel', () => {
  it('draws one band per stage', () => {
    const html = renderToStaticMarkup(<Funnel stages={STAGES} provenance={PROV} title="Demand funnel" />);
    expect(html.match(/class="funnel-band/g) ?? []).toHaveLength(4);
  });

  it('labels every stage and prints its value', () => {
    const html = renderToStaticMarkup(<Funnel stages={STAGES} provenance={PROV} title="Demand funnel" />);
    for (const s of STAGES) {
      expect(html).toContain(s.label);
      expect(html).toContain(String(s.value));
    }
  });

  it('renders a narrower band for a smaller value', () => {
    const html = renderToStaticMarkup(<Funnel stages={STAGES} provenance={PROV} title="Demand funnel" />);
    const widths = bandWidths(html);
    expect(widths).toHaveLength(4);
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);
    expect(widths[2]).toBeGreaterThan(widths[3]);
  });

  it('renders the empty state for an empty stage set rather than an axis with nothing on it', () => {
    const html = renderToStaticMarkup(
      <Funnel stages={[]} provenance={PROV} title="Demand funnel" emptyNote="No enrollment funnel rows" />,
    );
    expect(html).toContain('No enrollment funnel rows');
    expect(html).not.toContain('class="funnel-band');
  });

  // A zero-only series must not divide by zero and produce NaN widths.
  it('survives an all-zero series', () => {
    const html = renderToStaticMarkup(
      <Funnel
        stages={[
          { label: 'a', value: 0 },
          { label: 'b', value: 0 },
        ]}
        provenance={PROV}
        title="Demand funnel"
      />,
    );
    expect(html).not.toContain('NaN');
  });

  it('matches the golden snapshot', () => {
    expect(renderToStaticMarkup(<Funnel stages={STAGES} provenance={PROV} title="Demand funnel" />)).toMatchSnapshot();
  });

  // Real possibility in this data: a later stage (transfers, re-entries, or
  // a provenance error) exceeds an earlier one. The primitive must NEVER
  // silently reorder or clamp — it must present stages in the exact order
  // given and mark the anomalous one visibly.
  it('marks an increasing stage rather than reordering it', () => {
    const anomalous = [
      { label: 'Admit', value: 100 },
      { label: 'Enrol', value: 40 },
      { label: 'Exit', value: 60 },
    ];
    const html = renderToStaticMarkup(<Funnel stages={anomalous} provenance={PROV} title="Demand funnel" />);

    // Still presented in input order — labels appear in the document in the
    // same sequence they were given, not sorted by value.
    const admitAt = html.indexOf('Admit');
    const enrolAt = html.indexOf('Enrol');
    const exitAt = html.indexOf('Exit');
    expect(admitAt).toBeGreaterThanOrEqual(0);
    expect(enrolAt).toBeGreaterThan(admitAt);
    expect(exitAt).toBeGreaterThan(enrolAt);

    // The band widths themselves stay honest — Exit (60) renders WIDER than
    // Enrol (40), the increase is visible in the geometry, not hidden.
    const widths = bandWidths(html);
    expect(widths[2]).toBeGreaterThan(widths[1]);

    // And the third stage (the anomalous one) carries a distinct warning
    // treatment — not the same rendering as a normal declining stage.
    expect(html.match(/class="funnel-band anomalous"/g) ?? []).toHaveLength(1);
    expect(html).toContain('#A15C00'); // SEMANTIC.warning
  });

  // Conversion percentages are computed against the immediately preceding
  // stage, not the first stage or any other baseline.
  it('computes conversion percentage against the previous stage', () => {
    const html = renderToStaticMarkup(
      <Funnel
        stages={[
          { label: 'Admit', value: 100 },
          { label: 'Enrol', value: 40 },
        ]}
        provenance={PROV}
        title="Demand funnel"
      />,
    );
    expect(html).toContain('40%');
  });
});
