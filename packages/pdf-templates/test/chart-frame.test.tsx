import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ChartFrame } from '../src/charts/chart-frame';

const PROV = {
  source: 'kku-registry',
  runDate: '12 Aug 2026',
  table: 'student_cohort_distributions',
  method: 'academic-year-rollover.v1',
};

describe('ChartFrame', () => {
  it('renders title, Thai lede and every provenance field', () => {
    const html = renderToStaticMarkup(
      <ChartFrame title="Cohort distribution" ledeTh="นักศึกษาชั้นปีที่ 1 ลดลงต่อเนื่อง"
                  provenance={PROV} heightMm={60}>
        <rect x="0" y="0" width="10" height="10" />
      </ChartFrame>,
    );
    expect(html).toContain('Cohort distribution');
    expect(html).toContain('นักศึกษาชั้นปีที่ 1 ลดลงต่อเนื่อง');
    expect(html).toContain('kku-registry');
    expect(html).toContain('12 Aug 2026');
    expect(html).toContain('student_cohort_distributions');
    expect(html).toContain('academic-year-rollover.v1');
  });

  it('sizes the canvas in millimetres and defaults to the 180mm text measure', () => {
    const html = renderToStaticMarkup(
      <ChartFrame title="t" provenance={PROV} heightMm={45}><g /></ChartFrame>,
    );
    expect(html).toContain('width="180mm"');
    expect(html).toContain('height="45mm"');
    expect(html).toContain('viewBox="0 0 180 45"');
  });

  it('avoids splitting across a page break', () => {
    const html = renderToStaticMarkup(
      <ChartFrame title="t" provenance={PROV} heightMm={45}><g /></ChartFrame>,
    );
    expect(html).toContain('avoid-break');
  });

  // Empty must never be drawn as zero — a flat line reads as "the value is 0",
  // which is a different and much worse claim than "we have no data".
  it('renders the empty note instead of the chart when empty is set', () => {
    const html = renderToStaticMarkup(
      <ChartFrame title="Outcomes" provenance={PROV} heightMm={45}
                  empty emptyNote="No graduate survey rows pass realDataWhere()">
        <rect id="should-not-appear" x="0" y="0" width="1" height="1" />
      </ChartFrame>,
    );
    expect(html).toContain('No graduate survey rows pass realDataWhere()');
    expect(html).not.toContain('should-not-appear');
    // Provenance still shows — the reader must know which source came back empty.
    expect(html).toContain('kku-registry');
  });
});
