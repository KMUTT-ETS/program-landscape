import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BarsH } from '../src/charts/bars-h';

const PROV = { source: 'kku-registry', runDate: '12 Aug 2026', method: 'skills.v1' };

const ROWS = [
  { label: 'Data engineering', value: 82 },
  { label: 'Machine learning', value: 64 },
  { label: 'Embedded systems', value: 31 },
];

describe('BarsH', () => {
  it('draws one bar per row', () => {
    const html = renderToStaticMarkup(<BarsH rows={ROWS} provenance={PROV} title="Skills" />);
    expect(html.match(/<rect[^>]*class="bar"/g) ?? []).toHaveLength(3);
  });

  it('labels every row and prints its value', () => {
    const html = renderToStaticMarkup(<BarsH rows={ROWS} provenance={PROV} title="Skills" />);
    for (const r of ROWS) {
      expect(html).toContain(r.label);
      expect(html).toContain(String(r.value));
    }
  });

  it('scales bar widths proportionally to the largest value', () => {
    const html = renderToStaticMarkup(<BarsH rows={ROWS} provenance={PROV} title="Skills" />);
    const widths = [...html.matchAll(/class="bar"[^>]*width="([\d.]+)"/g)].map((m) => Number(m[1]));
    expect(widths).toHaveLength(3);
    expect(widths[0]).toBeGreaterThan(widths[1]);
    expect(widths[1]).toBeGreaterThan(widths[2]);
  });

  it('renders the empty state for an empty row set rather than an axis with nothing on it', () => {
    const html = renderToStaticMarkup(
      <BarsH rows={[]} provenance={PROV} title="Skills" emptyNote="No ProgramSkill rows" />,
    );
    expect(html).toContain('No ProgramSkill rows');
    expect(html).not.toContain('class="bar"');
  });

  // A zero-only series must not divide by zero and produce NaN widths.
  it('survives an all-zero series', () => {
    const html = renderToStaticMarkup(
      <BarsH rows={[{ label: 'a', value: 0 }, { label: 'b', value: 0 }]}
             provenance={PROV} title="Skills" />,
    );
    expect(html).not.toContain('NaN');
  });

  it('matches the golden snapshot', () => {
    expect(renderToStaticMarkup(<BarsH rows={ROWS} provenance={PROV} title="Skills" />))
      .toMatchSnapshot();
  });

  // A labelWidthMm wide enough to eat the whole plot area must fail loudly,
  // not render bars with negative width that SVG silently drops — that would
  // read to a Council viewer as "every row scored zero."
  it('throws when labelWidthMm leaves no room to plot', () => {
    expect(() =>
      renderToStaticMarkup(<BarsH rows={ROWS} provenance={PROV} title="Skills" labelWidthMm={170} />),
    ).toThrow(RangeError);
  });

  it('renders three bars with a non-default but valid labelWidthMm', () => {
    const html = renderToStaticMarkup(
      <BarsH rows={ROWS} provenance={PROV} title="Skills" labelWidthMm={90} />,
    );
    expect(html.match(/<rect[^>]*class="bar"/g) ?? []).toHaveLength(3);
  });
});
