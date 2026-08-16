import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderFacultySection } from '../../src/templates/program-detail/sections/faculty';
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

const FACULTY_BASE = {
  rosterScope: 'program-specific roster',
  visibility: 'full detail',
  kpis: [],
  roster: [],
};

describe('renderFacultySection', () => {
  it('renders the section title and a Thai lede', () => {
    const data = parse({
      faculty: {
        ...FACULTY_BASE,
        seniorRankCount: 16,
        totalRankedCount: 18,
        seniorRankSharePct: 88.88888888888889,
        rankDistribution: [
          { rank: 'Associate Professor', count: 13, share: 72.22222222222221 },
          { rank: 'Professor', count: 3, share: 16.666666666666664 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderFacultySection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).toContain('Faculty capability');
    const lede = /class="chart-lede"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(lede.length).toBeGreaterThan(0);
    expect(/[฀-๿]/.test(lede)).toBe(true);
  });

  it('renders one bar per rank with a real headcount', () => {
    const data = parse({
      faculty: {
        ...FACULTY_BASE,
        seniorRankCount: 16,
        totalRankedCount: 18,
        seniorRankSharePct: 88.9,
        rankDistribution: [
          { rank: 'Associate Professor', count: 13, share: 72.2 },
          { rank: 'Professor', count: 3, share: 16.7 },
          { rank: 'Assistant Professor', count: 2, share: 11.1 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderFacultySection(data) as React.ReactElement);
    expect(html.match(/class="bar"/g) ?? []).toHaveLength(3);
    expect(html).toContain('Associate Professor');
    expect(html).toContain('Professor');
    expect(html).toContain('Assistant Professor');
  });

  // The three companion figures Task 2 added must be readable at a glance,
  // formatted, never as raw full-precision floats — the exact class of bug
  // this batch's fix commit addresses (the fixture's own
  // seniorRankSharePct is 88.88888888888889).
  it('renders the senior-share KPIs formatted, not as raw floats', () => {
    const data = parse({
      faculty: {
        ...FACULTY_BASE,
        seniorRankCount: 16,
        totalRankedCount: 18,
        seniorRankSharePct: 88.88888888888889,
        rankDistribution: [{ rank: 'Associate Professor', count: 13, share: 72.22222222222221 }],
      },
    });
    const html = renderToStaticMarkup(renderFacultySection(data) as React.ReactElement);
    expect(html).not.toMatch(/88\.88888888888889/);
    expect(html).not.toMatch(/72\.22222222222221/);
    expect(html).toContain('89%');
  });

  it('returns null — not a placeholder chart — when faculty was never computed', () => {
    const data = parse({ faculty: null });
    expect(renderFacultySection(data)).toBeNull();
  });

  it('renders the explained empty block, not a zero-valued chart, when there is no rank distribution', () => {
    const data = parse({
      faculty: {
        ...FACULTY_BASE,
        seniorRankCount: null,
        totalRankedCount: null,
        seniorRankSharePct: null,
        rankDistribution: [],
      },
    });
    const html = renderToStaticMarkup(renderFacultySection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).not.toContain('class="bar"');
    expect(html).toContain('class="chart-empty"');
  });

  it('carries real provenance and the report date', () => {
    const data = parse({
      dateLabel: '12 Aug 2026',
      faculty: {
        ...FACULTY_BASE,
        seniorRankCount: 16,
        totalRankedCount: 18,
        seniorRankSharePct: 88.9,
        rankDistribution: [{ rank: 'Professor', count: 3, share: 16.7 }],
      },
    });
    const html = renderToStaticMarkup(renderFacultySection(data) as React.ReactElement);
    expect(html).toContain('kku-hr');
    expect(html).toContain('12 Aug 2026');
  });

  // The load-bearing constraint from the brief: under COUNCIL visibility,
  // faculty member names are stripped upstream at the Prisma select layer
  // — this component reads only rankDistribution + the three aggregate
  // counts, never `faculty.roster[].name`, so there is no path here that
  // could print one even if a name were present in the payload.
  it('never prints a faculty member name — only aggregate rank counts', () => {
    const data = parse({
      faculty: {
        ...FACULTY_BASE,
        visibility: 'aggregates-only',
        roster: [
          { rank: 'Professor', name: 'ผศ.ดร. สมชาย ทดสอบ', specialization: '', retires: '' },
        ],
        seniorRankCount: 1,
        totalRankedCount: 1,
        seniorRankSharePct: 100,
        rankDistribution: [{ rank: 'Professor', count: 1, share: 100 }],
      },
    });
    const html = renderToStaticMarkup(renderFacultySection(data) as React.ReactElement);
    expect(html).not.toContain('สมชาย');
  });

  it('renders from the real captured fixture (KKU-SEQ-0065) without throwing', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(() => renderToStaticMarkup(renderFacultySection(data) as React.ReactElement)).not.toThrow();
    const html = renderToStaticMarkup(renderFacultySection(data) as React.ReactElement);
    expect(html.match(/class="bar"/g) ?? []).toHaveLength(3);
  });
});
