import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderRecruitmentSection } from '../../src/templates/program-detail/sections/recruitment';
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

const RECRUITMENT_BASE = {
  methodologyVersion: 'program-recruitment.v2',
  inProgressNote: '',
};

describe('renderRecruitmentSection', () => {
  it('renders the section title and a Thai lede', () => {
    const data = parse({
      recruitment: {
        ...RECRUITMENT_BASE,
        byYear: [
          {
            yearBE: 2569, status: 'complete', planPerYear: 80, seats: 80, overAllocation: 1,
            applicants: 1200, competition: 15, passed: 135, confirmCh: 83, reported: 80, vsPlan: 100,
          },
        ],
        latestRoundsYear: 2569,
        latestRounds: [
          { round: '1', seats: 28, applicants: 302, passed: 63, confirmCh: 29, reported: 29 },
          { round: '2', seats: 40, applicants: 716, passed: 44, confirmCh: 27, reported: 26 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderRecruitmentSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).toContain('Recruitment');
    const lede = /class="chart-lede"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(lede.length).toBeGreaterThan(0);
    expect(/[฀-๿]/.test(lede)).toBe(true);
  });

  it('renders one stacked column per TCAS round in the latest cycle', () => {
    const data = parse({
      recruitment: {
        ...RECRUITMENT_BASE,
        byYear: [],
        latestRoundsYear: 2569,
        latestRounds: [
          { round: '1', seats: 28, applicants: 302, passed: 63, confirmCh: 29, reported: 29 },
          { round: '2', seats: 40, applicants: 716, passed: 44, confirmCh: 27, reported: 26 },
          { round: '3', seats: 12, applicants: 182, passed: 28, confirmCh: 27, reported: 25 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderRecruitmentSection(data) as React.ReactElement);
    expect(html.match(/data-category="/g) ?? []).toHaveLength(3);
  });

  // Round 3 in the fixture-shaped data below reports MORE registrants (25)
  // than its own seat allocation (12) — a real over-fill, not a data bug.
  // The unfilled segment must floor at 0, never go negative, and must not
  // silently shrink the Reported segment to hide the over-fill.
  it('floors the unfilled segment at zero for a round whose reported count exceeds its seat allocation', () => {
    const data = parse({
      recruitment: {
        ...RECRUITMENT_BASE,
        byYear: [],
        latestRoundsYear: 2569,
        latestRounds: [
          { round: '3', seats: 12, applicants: 182, passed: 28, confirmCh: 27, reported: 25 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderRecruitmentSection(data) as React.ReactElement);
    expect(html).not.toContain('NaN');
    // Only the Reported segment renders a <rect> — the (floored) zero
    // Unfilled segment renders no rect at all, per BarsStacked's own rule.
    expect(html.match(/class="segment"/g) ?? []).toHaveLength(1);
  });

  it('returns null — not a placeholder chart — when recruitment was never computed', () => {
    const data = parse({ recruitment: null });
    expect(renderRecruitmentSection(data)).toBeNull();
  });

  it('renders the explained empty block, not a zero-valued stack, when latestRounds is empty but recruitment is present', () => {
    const data = parse({
      recruitment: {
        ...RECRUITMENT_BASE,
        byYear: [
          {
            yearBE: 2569, status: 'complete', planPerYear: 80, seats: 80, overAllocation: 1,
            applicants: 1200, competition: 15, passed: 135, confirmCh: 83, reported: 80, vsPlan: 100,
          },
        ],
        latestRoundsYear: null,
        latestRounds: [],
      },
    });
    const html = renderToStaticMarkup(renderRecruitmentSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).not.toContain('class="segment"');
    expect(html).toContain('class="chart-empty"');
  });

  // overAllocation is a real nullable number (Task 2) — 'measured but
  // unremarkable' (e.g. exactly 1, no over-allocation) must not be
  // collapsed together with 'never measured' (null, e.g. no enrollment
  // plan recorded that year). A null year is named explicitly, not
  // dropped or displayed as though it were a measured value.
  it('names, rather than drops, a year whose over-allocation was never measured', () => {
    const data = parse({
      recruitment: {
        ...RECRUITMENT_BASE,
        byYear: [
          {
            yearBE: 2569, status: 'complete', planPerYear: 80, seats: 80, overAllocation: 1,
            applicants: 1200, competition: 15, passed: 135, confirmCh: 83, reported: 80, vsPlan: 100,
          },
          {
            yearBE: 2565, status: 'complete', planPerYear: null, seats: 80, overAllocation: null,
            applicants: 1382, competition: 17.275, passed: 103, confirmCh: 80, reported: 78, vsPlan: null,
          },
        ],
        latestRoundsYear: 2569,
        latestRounds: [
          { round: '1', seats: 28, applicants: 302, passed: 63, confirmCh: 29, reported: 29 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderRecruitmentSection(data) as React.ReactElement);
    expect(html).toMatch(/2565/);
    expect(html).toMatch(/not measured|never measured|no enrollment plan/i);
  });

  it('surfaces an in-progress cycle note when the recruitment cycle is still partial', () => {
    const data = parse({
      recruitment: {
        ...RECRUITMENT_BASE,
        inProgressNote: 'BE 2569 cycle is in progress — figures partial.',
        byYear: [],
        latestRoundsYear: 2569,
        latestRounds: [
          { round: '1', seats: 28, applicants: 302, passed: 63, confirmCh: 29, reported: 29 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderRecruitmentSection(data) as React.ReactElement);
    expect(html).toContain('BE 2569 cycle is in progress — figures partial.');
  });

  it('carries real provenance — the recruitment methodology version and the report date', () => {
    const data = parse({
      dateLabel: '12 Aug 2026',
      recruitment: {
        ...RECRUITMENT_BASE,
        methodologyVersion: 'program-recruitment.v2',
        byYear: [],
        latestRoundsYear: 2569,
        latestRounds: [
          { round: '1', seats: 28, applicants: 302, passed: 63, confirmCh: 29, reported: 29 },
        ],
      },
    });
    const html = renderToStaticMarkup(renderRecruitmentSection(data) as React.ReactElement);
    expect(html).toContain('program-recruitment.v2');
    expect(html).toContain('12 Aug 2026');
  });

  it('renders from the real captured fixture (KKU-SEQ-0065) without throwing', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(() => renderToStaticMarkup(renderRecruitmentSection(data) as React.ReactElement)).not.toThrow();
    const html = renderToStaticMarkup(renderRecruitmentSection(data) as React.ReactElement);
    expect(html.match(/data-category="/g) ?? []).toHaveLength(3);
  });
});
