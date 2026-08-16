import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderCohortDistributionSection } from '../../src/templates/program-detail/sections/cohort-distribution';
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

describe('renderCohortDistributionSection', () => {
  it('renders the section title, a Thai lede and one bar per entry year', () => {
    const data = parse({
      cohortDistribution: {
        totalActive: 300,
        currentAcademicYearBE: 2569,
        programDurationYears: 4,
        summary: [],
        summaryValues: [],
        rows: [
          { cohortBE: 2569, cohortCE: 2026, yearInProgram: 0, status: 'Incoming', students: 100, share: 33.3 },
          { cohortBE: 2567, cohortCE: 2024, yearInProgram: 2, status: 'On track', students: 120, share: 40 },
          { cohortBE: 2563, cohortCE: 2020, yearInProgram: 6, status: 'Delayed', students: 80, share: 26.7 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderCohortDistributionSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).toContain('Cohort distribution');
    const lede = /class="chart-lede"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(lede.length).toBeGreaterThan(0);
    expect(/[฀-๿]/.test(lede)).toBe(true);
    // Each entry year in this fixture carries exactly one status, so its
    // stack has exactly one non-zero segment — a zero-value segment
    // renders no <rect> (BarsStacked's own rule) — so 3 years -> 3 rects.
    expect(html.match(/class="segment"/g) ?? []).toHaveLength(3);
    // Every category is zero-filled at all 3 status indices (segment
    // order/labels must stay consistent across categories, even though
    // each year only has a real value at one of them) — the legend shows
    // all three statuses regardless of which one a given bar lit up.
    expect(html).toContain('Incoming');
    expect(html).toContain('On track');
    expect(html).toContain('Delayed');
    // The x-axis category labels are the entry years themselves.
    expect(html).toContain('2569');
    expect(html).toContain('2567');
    expect(html).toContain('2563');
  });

  it('returns null — not a placeholder chart — when cohortDistribution was never computed (no real cohort rows)', () => {
    const data = parse({ cohortDistribution: null });
    expect(renderCohortDistributionSection(data)).toBeNull();
  });

  it('renders the explained empty block, not a zero-valued chart, when cohortDistribution is present but rows is empty', () => {
    const data = parse({
      cohortDistribution: {
        totalActive: 0,
        currentAcademicYearBE: 2569,
        programDurationYears: 4,
        summary: [],
        summaryValues: [],
        rows: [],
      },
    });
    const html = renderToStaticMarkup(renderCohortDistributionSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).not.toContain('class="segment"');
    expect(html).toContain('class="chart-empty"');
    expect(html).toMatch(/registrar|kku-registry|link-cohorts/i);
  });

  it('carries real provenance — kku-registry and the report date', () => {
    const data = parse({
      dateLabel: '12 Aug 2026',
      cohortDistribution: {
        totalActive: 100,
        currentAcademicYearBE: 2569,
        programDurationYears: 4,
        summary: [],
        summaryValues: [],
        rows: [
          { cohortBE: 2569, cohortCE: 2026, yearInProgram: 0, status: 'Incoming', students: 100, share: 100 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderCohortDistributionSection(data) as React.ReactElement);
    expect(html).toContain('kku-registry');
    expect(html).toContain('12 Aug 2026');
  });

  // The real captured fixture (KKU-SEQ-0065) has no real cohort rows —
  // this is the section's genuine "no data at all" case, not a
  // constructed one, and confirms the section skips entirely rather than
  // rendering an empty chart with a header nobody asked for.
  it('renders null against the real captured fixture, which has no cohort data', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(data.cohortDistribution).toBeNull();
    expect(renderCohortDistributionSection(data)).toBeNull();
  });
});
