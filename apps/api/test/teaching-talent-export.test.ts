import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import type { TeachingTalentResult } from '@kku/db';
import { buildTalentWorkbook } from '../src/staff-dashboard/teaching-talent-workbook';

const YEARS = [2566, 2567, 2568];

function cell(ratingAvg: number | null, respondentCount = 100) {
  return { ratingAvg, respondentCount };
}

const FIXTURE: TeachingTalentResult = {
  methodologyVersion: 'teaching-talent.v1',
  years: YEARS,
  windowComplete: true,
  rows: [
    {
      facultyMemberId: 'fm-1',
      nameTh: 'สมชาย ใจดี',
      nameEn: 'Somchai Jaidi',
      rank: 'ASSOC_PROF',
      kkuEmail: 'somchai@kku.ac.th',
      facultyId: 'fac-1',
      facultyName: 'คณะแพทยศาสตร์',
      isActive: true,
      overallRating: 4.62,
      totalRespondents: 300,
      courseCount: 4,
      byYear: { '2566': cell(4.55), '2567': cell(4.6), '2568': cell(4.7) },
      yearsWithData: 3,
      minYearRating: 4.55,
    },
    {
      facultyMemberId: 'fm-2',
      nameTh: 'สมหญิง แสงทอง',
      nameEn: 'Somying Saengthong',
      rank: 'ASST_PROF',
      kkuEmail: 'somying@kku.ac.th',
      facultyId: 'fac-1',
      facultyName: 'คณะแพทยศาสตร์',
      isActive: true,
      overallRating: 4.3,
      totalRespondents: 300,
      courseCount: 2,
      byYear: { '2566': cell(4.1), '2567': cell(4.4), '2568': cell(4.4) },
      yearsWithData: 3,
      minYearRating: 4.1,
    },
    {
      facultyMemberId: 'fm-3',
      nameTh: 'มาลี',
      nameEn: 'Mali',
      rank: 'LECTURER',
      kkuEmail: null,
      facultyId: 'fac-2',
      facultyName: 'คณะวิศวกรรมศาสตร์',
      isActive: true,
      overallRating: 4.9,
      totalRespondents: 200,
      courseCount: 1,
      byYear: { '2567': cell(4.9), '2568': cell(4.9) },
      yearsWithData: 2,
      minYearRating: 4.9,
    },
  ],
  unmatched: {
    teachers: [
      {
        kkuEmail: 'ghost@kku.ac.th',
        facultyName: 'คณะวิทยาศาสตร์',
        overallRating: 4.8,
        totalRespondents: 150,
        byYear: { '2566': cell(4.8, 50), '2567': cell(4.8, 50), '2568': cell(4.8, 50) },
        yearsWithData: 3,
        minYearRating: 4.8,
      },
      {
        kkuEmail: 'weak@kku.ac.th',
        facultyName: null,
        overallRating: 3.5,
        totalRespondents: 60,
        byYear: { '2566': cell(3.5, 20), '2567': cell(3.5, 20), '2568': cell(3.5, 20) },
        yearsWithData: 3,
        minYearRating: 3.5,
      },
    ],
    unattributableRowCount: 34566,
  },
};

function read(buf: Buffer) {
  const wb = XLSX.read(buf, { type: 'buffer' });
  return {
    names: wb.SheetNames,
    rows: (sheet: string): unknown[][] =>
      XLSX.utils.sheet_to_json(wb.Sheets[sheet]!, { header: 1 }) as unknown[][],
  };
}

describe('buildTalentWorkbook', () => {
  it('produces the three sheets in order', () => {
    const wb = read(buildTalentWorkbook(FIXTURE, { threshold: 4.0, facultyName: [] }));
    expect(wb.names).toEqual(['Talent', 'Unmatched', 'About']);
  });

  it('writes the agreed Talent columns in order', () => {
    const wb = read(buildTalentWorkbook(FIXTURE, { threshold: 4.0, facultyName: [] }));
    expect(wb.rows('Talent')[0]).toEqual([
      'Faculty',
      'Academic rank',
      'First name',
      'Last name',
      'Email',
      'Overall score',
      'Full name (EN)',
    ]);
  });

  it('exports only talents, splitting the Thai name', () => {
    const rows = read(buildTalentWorkbook(FIXTURE, { threshold: 4.0, facultyName: [] })).rows(
      'Talent',
    );
    // fm-3 has only 2 of 3 years — excluded however high the scores are.
    expect(rows).toHaveLength(3); // header + fm-1 + fm-2
    expect(rows[1]).toEqual([
      'คณะแพทยศาสตร์',
      'รองศาสตราจารย์',
      'ศิริลักษณ์',
      'อนันต์ณัฐศิริ',
      'somchai@kku.ac.th',
      4.62,
      'Somchai Jaidi',
    ]);
  });

  it('writes the score as a number, not a string', () => {
    const rows = read(buildTalentWorkbook(FIXTURE, { threshold: 4.0, facultyName: [] })).rows(
      'Talent',
    );
    expect(typeof rows[1]![5]).toBe('number');
  });

  it('raising the threshold shrinks the Talent sheet', () => {
    const rows = read(buildTalentWorkbook(FIXTURE, { threshold: 4.25, facultyName: [] })).rows(
      'Talent',
    );
    // fm-2's weakest year is 4.10 — below 4.25.
    expect(rows).toHaveLength(2); // header + fm-1
  });

  it('blanks the email cell rather than writing null', () => {
    // A talent whose HR record carries no email — the cell must be empty,
    // not the string "null".
    const noEmail: TeachingTalentResult = {
      ...FIXTURE,
      rows: [{ ...FIXTURE.rows[0]!, kkuEmail: null }],
    };
    const rows = read(buildTalentWorkbook(noEmail, { threshold: 4.0, facultyName: [] })).rows(
      'Talent',
    );
    expect(rows[1]![4]).toBe('');
  });

  it('splits a single-token name into first name only', () => {
    const oneToken: TeachingTalentResult = {
      ...FIXTURE,
      rows: [{ ...FIXTURE.rows[0]!, nameTh: 'มาลี' }],
    };
    const rows = read(buildTalentWorkbook(oneToken, { threshold: 4.0, facultyName: [] })).rows(
      'Talent',
    );
    expect(rows[1]![2]).toBe('มาลี');
    expect(rows[1]![3]).toBe('');
  });

  it('keeps unmatched teachers out of the Talent sheet', () => {
    const rows = read(buildTalentWorkbook(FIXTURE, { threshold: 4.0, facultyName: [] })).rows(
      'Talent',
    );
    const flat = rows.flat().join('|');
    expect(flat).not.toContain('ghost@kku.ac.th');
  });

  it('flags would-qualify on the Unmatched sheet and tracks the threshold', () => {
    const at40 = read(buildTalentWorkbook(FIXTURE, { threshold: 4.0, facultyName: [] })).rows(
      'Unmatched',
    );
    expect(at40[0]).toEqual([
      'Email',
      'Faculty (class owner)',
      'BE 2566',
      'BE 2567',
      'BE 2568',
      'Respondents',
      'Overall score',
      'Would qualify',
    ]);
    expect(at40[1]![0]).toBe('ghost@kku.ac.th');
    expect(at40[1]![7]).toBe('yes');
    expect(at40[2]![7]).toBe('no');

    const at49 = read(buildTalentWorkbook(FIXTURE, { threshold: 4.75, facultyName: [] })).rows(
      'Unmatched',
    );
    expect(at49[1]![7]).toBe('yes'); // 4.80 still clears 4.75
  });

  it('records window, threshold and both counts on About', () => {
    const about = read(buildTalentWorkbook(FIXTURE, { threshold: 4.25, facultyName: ['คณะแพทยศาสตร์'] })).rows(
      'About',
    );
    const flat = about.map((r) => r.join('=')).join('\n');
    expect(flat).toContain('teaching-talent.v1');
    expect(flat).toContain('BE 2566–2568');
    expect(flat).toContain('4.25');
    expect(flat).toContain('คณะแพทยศาสตร์');
    expect(flat).toContain('34566');
  });

  it('states the three-year rule and flags the shortfall on a thin window', () => {
    // Only two completed years carry data. classifyTalent badges nobody —
    // and the About sheet must not imply that nobody cleared the bar over
    // two years, which is a different and alarming claim.
    const thin: TeachingTalentResult = {
      ...FIXTURE,
      years: [2567, 2568],
      windowComplete: false,
      rows: [
        {
          ...FIXTURE.rows[0]!,
          byYear: { '2567': cell(4.6), '2568': cell(4.7) },
          yearsWithData: 2,
          minYearRating: 4.6,
        },
      ],
    };
    const wb = read(buildTalentWorkbook(thin, { threshold: 4.0, facultyName: [] }));
    const about = wb.rows('About').map((r) => r.join('='));
    expect(about.join('\n')).toContain('the last 3 completed academic years');
    expect(about.join('\n')).not.toContain('the last 2 completed academic years');
    const windowRow = about.find((r) => r.startsWith('Window complete='));
    expect(windowRow).toContain('no — only 2 of 3 completed years carry data');
    expect(wb.rows('Talent')).toHaveLength(1); // header only — nobody qualifies
  });

  it('returns header-only sheets rather than throwing when nobody qualifies', () => {
    const wb = read(buildTalentWorkbook(FIXTURE, { threshold: 4.75, facultyName: [] }));
    expect(wb.rows('Talent')).toHaveLength(1);
    expect(wb.names).toEqual(['Talent', 'Unmatched', 'About']);
  });
});
