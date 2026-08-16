import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderOutcomesSection } from '../../src/templates/program-detail/sections/outcomes';
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

const OUTCOMES_BASE = {
  surveyYear: 2023,
  methodologyVersion: 'graduate-employment-survey.v1',
  freshnessDate: '2026-05-04',
  sampleSize: 439,
  employmentRatePct: 67.43,
  averageSalary: 24716,
  jobRelevanceScorePct: 72.3,
  furtherStudyRatePct: 10.71,
  topEmployers: [],
};

describe('renderOutcomesSection', () => {
  it('renders the section title and a Thai lede', () => {
    const data = parse({
      outcomes: {
        ...OUTCOMES_BASE,
        salaryTrajectory: [
          { year: 2023, salary: 20000 },
          { year: 2024, salary: 25000 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderOutcomesSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).toContain('Outcomes');
    const lede = /class="chart-lede"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(lede.length).toBeGreaterThan(0);
    expect(/[฀-๿]/.test(lede)).toBe(true);
  });

  // The four named numeric fields Task 2 added must be readable at a
  // glance, not just present somewhere in an appendix — displayed as
  // rounded/percent-formatted headline stats, never a full-precision float
  // (fixture carries seniorRankSharePct-style long decimals elsewhere in
  // this schema; these four fields must not repeat that mistake).
  it('renders the four headline outcome stats, formatted, not as raw floats', () => {
    const data = parse({
      outcomes: {
        ...OUTCOMES_BASE,
        employmentRatePct: 67.42596810933941,
        jobRelevanceScorePct: 72.34567891234,
        furtherStudyRatePct: 10.714285714285714,
        salaryTrajectory: [],
      },
    });
    const html = renderToStaticMarkup(renderOutcomesSection(data) as React.ReactElement);
    expect(html).not.toMatch(/67\.42596810933941/);
    expect(html).not.toMatch(/72\.34567891234/);
    expect(html).not.toMatch(/10\.714285714285714/);
    expect(html).toContain('67%');
    expect(html).toContain('72%');
    expect(html).toContain('11%');
  });

  it('plots a line point for every salary trajectory year with a known year', () => {
    const data = parse({
      outcomes: {
        ...OUTCOMES_BASE,
        salaryTrajectory: [
          { year: 2019, salary: 0 },
          { year: 2023, salary: 22000 },
          { year: 2024, salary: 25000 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderOutcomesSection(data) as React.ReactElement);
    expect(html.match(/class="point"/g) ?? []).toHaveLength(3);
  });

  it('returns null — not a placeholder chart — when outcomes was never computed', () => {
    const data = parse({ outcomes: null });
    expect(renderOutcomesSection(data)).toBeNull();
  });

  it('renders the explained empty block, not a flat zero line, when there is no salary trajectory', () => {
    const data = parse({
      outcomes: { ...OUTCOMES_BASE, salaryTrajectory: [] },
    });
    const html = renderToStaticMarkup(renderOutcomesSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).not.toContain('class="point"');
    expect(html).toContain('class="chart-empty"');
  });

  it('formats large salary axis ticks compactly rather than printing raw digit runs', () => {
    const data = parse({
      outcomes: {
        ...OUTCOMES_BASE,
        salaryTrajectory: [
          { year: 2023, salary: 22000 },
          { year: 2024, salary: 3500000 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderOutcomesSection(data) as React.ReactElement);
    expect(html).not.toContain('3500000');
  });

  it('carries real provenance — the graduate-employment-survey methodology and the report date', () => {
    const data = parse({
      dateLabel: '12 Aug 2026',
      outcomes: {
        ...OUTCOMES_BASE,
        methodologyVersion: 'graduate-employment-survey.v1',
        salaryTrajectory: [{ year: 2023, salary: 20000 }],
      },
    });
    const html = renderToStaticMarkup(renderOutcomesSection(data) as React.ReactElement);
    expect(html).toContain('graduate-employment-survey.v1');
    expect(html).toContain('12 Aug 2026');
  });

  it('renders from the real captured fixture (KKU-SEQ-0065) without throwing', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(() => renderToStaticMarkup(renderOutcomesSection(data) as React.ReactElement)).not.toThrow();
  });
});
