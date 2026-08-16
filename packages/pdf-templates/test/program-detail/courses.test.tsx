import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { renderCoursesSection } from '../../src/templates/program-detail/sections/courses';
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

const COURSES_BASE = {
  methodVersion: 'program-courses-extract.v1',
  yearsObserved: [2566, 2567, 2568],
  windowYearsBE: { start: 2565, end: 2568 },
  semestersApplied: [1, 2],
};

describe('renderCoursesSection', () => {
  it('renders the section title and a Thai lede', () => {
    const data = parse({
      courses: {
        ...COURSES_BASE,
        total: 1,
        extractedCount: 1,
        rows: [
          {
            courseCode: 'EN001200',
            courseNameTh: 'สถิตยศาสตร์',
            courseNameEn: 'Statics',
            credits: 3,
            classCount: 43,
            gradedCount: 2229,
            classGpa: 1.8822341857335128,
            byYear: {},
          },
        ],
      },
    });
    const html = renderToStaticMarkup(renderCoursesSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).toContain('Course list');
    const lede = /class="chart-lede"[^>]*>([^<]*)</.exec(html)?.[1] ?? '';
    expect(lede.length).toBeGreaterThan(0);
    expect(/[฀-๿]/.test(lede)).toBe(true);
  });

  // The one assertion this section exists to make true: course codes and
  // names actually render. Today's PDF drops this content entirely despite
  // receiving it — this test makes that regression impossible again.
  it('renders every course code and name as a real table row', () => {
    const data = parse({
      courses: {
        ...COURSES_BASE,
        total: 2,
        extractedCount: 2,
        rows: [
          {
            courseCode: 'EN001200',
            courseNameTh: 'สถิตยศาสตร์',
            courseNameEn: 'Statics',
            credits: 3,
            classCount: 43,
            gradedCount: 2229,
            classGpa: 1.8822341857335128,
            byYear: {},
          },
          {
            courseCode: 'EN112303',
            courseNameTh: 'กำลังวัสดุ',
            courseNameEn: 'Strength of Materials',
            credits: 4,
            classCount: 9,
            gradedCount: 241,
            classGpa: 2.08298755186722,
            byYear: {},
          },
        ],
      },
    });
    const html = renderToStaticMarkup(renderCoursesSection(data) as React.ReactElement);
    expect(html).toContain('<table');
    expect(html).toContain('EN001200');
    expect(html).toContain('สถิตยศาสตร์');
    expect(html).toContain('Statics');
    expect(html).toContain('EN112303');
    expect(html).toContain('กำลังวัสดุ');
    expect(html).toContain('Strength of Materials');
    expect((html.match(/<tr>/g) ?? []).length).toBeGreaterThanOrEqual(2);
  });

  it('formats the class GPA to two decimal places, never a raw full-precision float', () => {
    const data = parse({
      courses: {
        ...COURSES_BASE,
        total: 1,
        extractedCount: 1,
        rows: [
          {
            courseCode: 'EN112402',
            courseNameTh: 'การสำรวจ',
            courseNameEn: 'Surveying',
            credits: 3,
            classCount: 5,
            gradedCount: 333,
            classGpa: 3.3363363363363367,
            byYear: {},
          },
        ],
      },
    });
    const html = renderToStaticMarkup(renderCoursesSection(data) as React.ReactElement);
    expect(html).not.toMatch(/3\.3363363363363367/);
    expect(html).toContain('3.34');
  });

  it('surfaces the coverage note distinguishing shown vs extracted course counts', () => {
    const data = parse({
      courses: {
        ...COURSES_BASE,
        total: 8,
        extractedCount: 45,
        rows: [
          {
            courseCode: 'EN001200',
            courseNameTh: 'สถิตยศาสตร์',
            courseNameEn: 'Statics',
            credits: 3,
            classCount: 43,
            gradedCount: 2229,
            classGpa: 1.88,
            byYear: {},
          },
        ],
      },
    });
    const html = renderToStaticMarkup(renderCoursesSection(data) as React.ReactElement);
    expect(html).toContain('8');
    expect(html).toContain('45');
  });

  it('returns null — not an empty page — when courses were never extracted', () => {
    const data = parse({ courses: null });
    expect(renderCoursesSection(data)).toBeNull();
  });

  it('renders the explained empty block when courses is present but no rows have graded GPA data', () => {
    const data = parse({
      courses: { ...COURSES_BASE, total: 0, extractedCount: 12, rows: [] },
    });
    const html = renderToStaticMarkup(renderCoursesSection(data) as React.ReactElement);
    expect(html).toContain('class="section-title"');
    expect(html).not.toContain('<table');
    expect(html).toContain('12');
  });

  it('carries real provenance — the extraction method version and the report date', () => {
    const data = parse({
      dateLabel: '12 Aug 2026',
      courses: {
        ...COURSES_BASE,
        methodVersion: 'program-courses-extract.v2',
        total: 1,
        extractedCount: 1,
        rows: [
          {
            courseCode: 'EN001200',
            courseNameTh: 'สถิตยศาสตร์',
            courseNameEn: 'Statics',
            credits: 3,
            classCount: 43,
            gradedCount: 2229,
            classGpa: 1.88,
            byYear: {},
          },
        ],
      },
    });
    const html = renderToStaticMarkup(renderCoursesSection(data) as React.ReactElement);
    expect(html).toContain('program-courses-extract.v2');
    expect(html).toContain('12 Aug 2026');
  });

  // The real fixture (KKU-SEQ-0065) carries 8 real courses — the exact
  // content the pre-rebuild template dropped despite receiving it.
  it('renders from the real captured fixture (KKU-SEQ-0065) without throwing, and shows real course codes', () => {
    const data = ProgramDetailDataSchema.parse(FIXTURE);
    expect(data.courses).not.toBeNull();
    expect(data.courses?.rows.length).toBeGreaterThan(0);
    expect(() => renderToStaticMarkup(renderCoursesSection(data) as React.ReactElement)).not.toThrow();
    const html = renderToStaticMarkup(renderCoursesSection(data) as React.ReactElement);
    for (const row of data.courses?.rows ?? []) {
      expect(html).toContain(row.courseCode);
    }
  });
});
