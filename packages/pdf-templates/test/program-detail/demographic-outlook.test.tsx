import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderDemographicOutlookSection } from '../../src/templates/program-detail/sections/demographic-outlook';
import {
  ProgramDetailDataSchema,
  type ProgramDetailData,
} from '../../src/templates/program-detail/schema';
import FIXTURE from './fixture.json';

const MINIMAL_BASE = {
  programCode: 'KKU-SEQ-9999',
  nameTh: 'หลักสูตรทดสอบวิศวกรรมทดสอบ',
  nameEn: 'Test Program in Testing Engineering',
  level: 'Bachelor',
  status: 'ACTIVE',
  facultyTh: 'คณะทดสอบ',
  facultyEn: 'Faculty of Testing',
  dateLabel: '2026-01-01',
  generatedAtLabel: 'January 1, 2026 at 9:00 AM',
  methodologyVersion: 'health-score.v3.8',
};

function parse(overrides: Record<string, unknown> = {}): ProgramDetailData {
  return ProgramDetailDataSchema.parse({ ...MINIMAL_BASE, ...overrides });
}

const DEMOGRAPHIC_BASE = {
  catchment: 'Thailand',
  ageCohort: '18-22',
  source: 'NESDC-PopProj-2010-2040',
  baselineYearOneIntake: null,
  fifteenYearContraction: 27.07,
  riskLevel: 'LOW',
};

describe('renderDemographicOutlookSection', () => {
  it('renders the section title, a Thai lede and one point per projection year', () => {
    const data = parse({
      demographic: {
        ...DEMOGRAPHIC_BASE,
        projections: [
          { year: 2026, isCurrentYear: true, cohortPopulation: 3_982_000, decline: 0, shareNeeded: null },
          { year: 2031, isCurrentYear: false, cohortPopulation: 3_554_000, decline: 10.7, shareNeeded: null },
        ],
      },
    });
    const html = renderToStaticMarkup(renderDemographicOutlookSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).toContain('Demographic outlook');
    const lede = /class="chart-lede"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(lede.length).toBeGreaterThan(0);
    expect(/[฀-๿]/.test(lede)).toBe(true);
    expect(html.match(/class="point"/g) ?? []).toHaveLength(2);
  });

  // Regression target for the fix earlier in this batch: cohort population
  // is in the millions, and the y-axis must read a compact '3.5M', never
  // the raw seven-digit tick value.
  it('formats y-axis ticks compactly instead of as raw seven-digit numbers', () => {
    const data = parse({
      demographic: {
        ...DEMOGRAPHIC_BASE,
        projections: [
          { year: 2026, isCurrentYear: true, cohortPopulation: 3_982_000, decline: 0, shareNeeded: null },
          { year: 2031, isCurrentYear: false, cohortPopulation: 3_554_000, decline: 10.7, shareNeeded: null },
          { year: 2036, isCurrentYear: false, cohortPopulation: 3_190_000, decline: 19.9, shareNeeded: null },
          { year: 2041, isCurrentYear: false, cohortPopulation: 2_904_000, decline: 27.1, shareNeeded: null },
        ],
      },
    });
    const html = renderToStaticMarkup(renderDemographicOutlookSection(data) as React.ReactElement);
    expect(html).not.toMatch(/>\d{6,}</);
    expect(html).toMatch(/>\d+(\.\d+)?M</);
  });

  // Years at/after the current-year anchor are forward NESDC projections,
  // not observed history — LineTrend's dashed treatment exists precisely
  // for this "actual vs projected" distinction.
  it('renders years after the current-year anchor as a dashed projection', () => {
    const data = parse({
      demographic: {
        ...DEMOGRAPHIC_BASE,
        projections: [
          { year: 2026, isCurrentYear: true, cohortPopulation: 3_982_000, decline: 0, shareNeeded: null },
          { year: 2031, isCurrentYear: false, cohortPopulation: 3_554_000, decline: 10.7, shareNeeded: null },
        ],
      },
    });
    const html = renderToStaticMarkup(renderDemographicOutlookSection(data) as React.ReactElement);
    expect(html).toContain('stroke-dasharray');
  });

  it('returns null — not a placeholder chart — when demographic was never computed for this program', () => {
    const data = parse({ demographic: null });
    expect(renderDemographicOutlookSection(data)).toBeNull();
  });

  it('renders the explained empty block, not a zero-valued chart, when demographic is present but projections is empty', () => {
    const data = parse({
      demographic: { ...DEMOGRAPHIC_BASE, projections: [] },
    });
    const html = renderToStaticMarkup(renderDemographicOutlookSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).not.toContain('class="point"');
    expect(html).toContain('class="chart-empty"');
    expect(html).toMatch(/nesdc|demographic/i);
  });

  it('carries real provenance — the NESDC source on the payload and the report date, never a placeholder', () => {
    const data = parse({
      dateLabel: '12 Aug 2026',
      demographic: {
        ...DEMOGRAPHIC_BASE,
        source: 'NESDC-PopProj-2010-2040',
        projections: [
          { year: 2026, isCurrentYear: true, cohortPopulation: 3_982_000, decline: 0, shareNeeded: null },
        ],
      },
    });
    const html = renderToStaticMarkup(renderDemographicOutlookSection(data) as React.ReactElement);
    expect(html).toContain('NESDC-PopProj-2010-2040');
    expect(html).toContain('12 Aug 2026');
  });

  it('renders from the real captured fixture (KKU-SEQ-0065) without throwing', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(data.demographic?.projections.length).toBeGreaterThan(0);
    expect(() =>
      renderToStaticMarkup(renderDemographicOutlookSection(data) as React.ReactElement),
    ).not.toThrow();
    const html = renderToStaticMarkup(renderDemographicOutlookSection(data) as React.ReactElement);
    expect(html).not.toMatch(/>\d{6,}</);
  });
});
