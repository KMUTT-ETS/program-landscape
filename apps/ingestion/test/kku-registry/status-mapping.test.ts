import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  bucketForStatusCode,
  STATUS_BUCKET_MAP,
} from '../../src/connectors/sources/kku-registry/status-mapping';
import {
  buddhistToCommonEra,
  buildBreakdown,
  normaliseMappingKey,
  rollupFunnel,
  Q1RowSchema,
  Q2RowSchema,
  type Q1Row,
} from '../../src/connectors/sources/kku-registry/transforms';

describe('buddhistToCommonEra', () => {
  it('subtracts 543', () => {
    expect(buddhistToCommonEra(2563)).toBe(2020);
    expect(buddhistToCommonEra(2488)).toBe(1945); // earliest legacy alumni
    expect(buddhistToCommonEra(2569)).toBe(2026);
  });

  it('rejects out-of-range years', () => {
    expect(() => buddhistToCommonEra(2020)).toThrow(/Buddhist-Era range/); // CE leak
    expect(() => buddhistToCommonEra(2399)).toThrow(/Buddhist-Era range/); // below floor
    expect(() => buddhistToCommonEra(2701)).toThrow(/Buddhist-Era range/);
    expect(() => buddhistToCommonEra(2.5)).toThrow();
  });
});

describe('normaliseMappingKey', () => {
  it('trims trailing whitespace from MAJOR', () => {
    expect(
      normaliseMappingKey({
        FACULTY_NAME: 'คณะวิศวกรรมศาสตร์',
        PROGRAM_NAME: 'วิศวกรรมคอมพิวเตอร์',
        PROGRAM_LEVEL: 'ปริญญาตรี',
        MAJOR: 'วิศวกรรมคอมพิวเตอร์ ',
      }),
    ).toEqual({
      registryFacultyName: 'คณะวิศวกรรมศาสตร์',
      registryProgramName: 'วิศวกรรมคอมพิวเตอร์',
      registryLevel: 'ปริญญาตรี',
      registryMajor: 'วิศวกรรมคอมพิวเตอร์',
    });
  });

  it('coalesces null PROGRAM_LEVEL and MAJOR to empty string', () => {
    const k = normaliseMappingKey({
      FACULTY_NAME: 'X',
      PROGRAM_NAME: 'Y',
      PROGRAM_LEVEL: null,
      MAJOR: null,
    });
    expect(k.registryLevel).toBe('');
    expect(k.registryMajor).toBe('');
  });
});

describe('bucketForStatusCode', () => {
  it('uses GRADUATED for code 40 (สำเร็จการศึกษา)', () => {
    expect(bucketForStatusCode(40)).toBe('GRADUATED');
  });

  it('uses ACTIVE for code 10 (current student normal)', () => {
    expect(bucketForStatusCode(10)).toBe('ACTIVE');
  });

  it('uses NEVER_ENROLLED for code 51 (never reported)', () => {
    expect(bucketForStatusCode(51)).toBe('NEVER_ENROLLED');
  });

  it('uses DROPOUT for code 50 (resigned)', () => {
    expect(bucketForStatusCode(50)).toBe('DROPOUT');
  });

  it('returns UNCATEGORISED for unknown codes', () => {
    expect(bucketForStatusCode(9999)).toBe('UNCATEGORISED');
    expect(bucketForStatusCode(null)).toBe('UNCATEGORISED');
    expect(bucketForStatusCode(undefined)).toBe('UNCATEGORISED');
  });
});

describe('STATUS_BUCKET_MAP coverage of captured fixture', () => {
  // Asserts every distinct STATUS_CODE in the captured aggregated.json
  // is mapped — UNCATEGORISED is OK if explicitly mapped (e.g. code 41
  // for null status text), but a code that's missing from the map at
  // all (returns UNCATEGORISED via fallback) is a regression.

  const fixturePath = path.resolve(
    __dirname,
    '../fixtures/kku-registry/aggregated.json',
  );

  it.skipIf(!existsSync(fixturePath))(
    'every captured STATUS_CODE has an explicit map entry',
    () => {
      const data = JSON.parse(readFileSync(fixturePath, 'utf8')) as {
        statusCounts: { STATUS_CODE: number | null }[];
      };
      const distinct = new Set<number>();
      for (const row of data.statusCounts) {
        if (row.STATUS_CODE !== null) distinct.add(row.STATUS_CODE);
      }
      const missing = [...distinct].filter((c) => !STATUS_BUCKET_MAP.has(c));
      expect(missing).toEqual([]);
    },
  );
});

describe('rollupFunnel', () => {
  it('sums into the right buckets', () => {
    const rows: Q1Row[] = [
      makeQ1({ STATUS_CODE: 40, N: 100 }), // GRADUATED
      makeQ1({ STATUS_CODE: 10, N: 50 }),  // ACTIVE
      makeQ1({ STATUS_CODE: 50, N: 20 }),  // DROPOUT
      makeQ1({ STATUS_CODE: 51, N: 10 }),  // NEVER_ENROLLED
    ];
    const r = rollupFunnel(rows);
    expect(r.graduatedTotal).toBe(100);
    expect(r.active).toBe(50);
    expect(r.dropouts).toBe(20);
    expect(r.neverEnrolled).toBe(10);
    expect(r.cohortTotal).toBe(180);
    expect(r.enrolled).toBe(170); // cohort - never_enrolled
    expect(r.uncategorised).toBe(0);
    expect(r.unknownStatusCodes).toEqual([]);
  });

  it('captures unknown status codes for analyst review', () => {
    const r = rollupFunnel([
      makeQ1({ STATUS_CODE: 9999, N: 7 }),
      makeQ1({ STATUS_CODE: 8888, N: 3 }),
      makeQ1({ STATUS_CODE: 40, N: 1 }),
    ]);
    expect(r.uncategorised).toBe(10);
    expect(r.unknownStatusCodes).toEqual([8888, 9999]);
    expect(r.graduatedTotal).toBe(1);
  });
});

describe('buildBreakdown', () => {
  it('aggregates gender / province / nationality histograms', () => {
    const breakdown = buildBreakdown(
      [
        { ...stubQ2(), GENDER: 'M', HOME_PROVINCE: 'ขอนแก่น', NATION: 'ไทย', N: 30 },
        { ...stubQ2(), GENDER: 'F', HOME_PROVINCE: 'ขอนแก่น', NATION: 'ไทย', N: 40 },
        { ...stubQ2(), GENDER: 'F', HOME_PROVINCE: 'อุดรธานี', NATION: 'ไทย', N: 10 },
        { ...stubQ2(), GENDER: 'M', HOME_PROVINCE: '-',     NATION: null,    N: 5 },
      ],
      '2026-04-27T12:00:00.000Z',
    );
    expect(breakdown.cohortSize).toBe(85);
    expect(breakdown.gender).toEqual({ M: 35, F: 50 });
    expect(breakdown.homeProvince).toEqual({ 'ขอนแก่น': 70, 'อุดรธานี': 10, '(unknown)': 5 });
    expect(breakdown.nationality).toEqual({ 'ไทย': 80, '(unknown)': 5 });
    expect(breakdown.source.rowCount).toBe(4);
  });
});

describe('row schemas', () => {
  it('Q1 schema accepts realistic row', () => {
    expect(() =>
      Q1RowSchema.parse({
        FACULTY_NAME: 'F',
        PROGRAM_NAME: 'P',
        PROGRAM_LEVEL: null,
        MAJOR: ' ',
        COHORT_YEAR_BE: 2563,
        STATUS: 'นักศึกษาปัจจุบัน สถานะปกติ',
        STATUS_CODE: 10,
        N: '50',
      }),
    ).not.toThrow();
  });

  it('Q2 schema accepts realistic row', () => {
    expect(() =>
      Q2RowSchema.parse({
        FACULTY_NAME: 'F',
        PROGRAM_NAME: 'P',
        PROGRAM_LEVEL: 'ปริญญาตรี',
        MAJOR: 'X ',
        COHORT_YEAR_BE: 2563,
        GENDER: 'M',
        HOME_PROVINCE: '-',
        NATION: 'ไทย',
        N: 7,
      }),
    ).not.toThrow();
  });
});

// ── helpers ──────────────────────────────────────────────────────────

function makeQ1(over: Partial<Q1Row>): Q1Row {
  return {
    FACULTY_NAME: 'F',
    PROGRAM_NAME: 'P',
    PROGRAM_LEVEL: 'ปริญญาตรี',
    MAJOR: '',
    COHORT_YEAR_BE: 2563,
    STATUS: 'X',
    STATUS_CODE: 10,
    N: 1,
    ...over,
  };
}

function stubQ2() {
  return {
    FACULTY_NAME: 'F',
    PROGRAM_NAME: 'P',
    PROGRAM_LEVEL: 'ปริญญาตรี',
    MAJOR: '',
    COHORT_YEAR_BE: 2563,
    GENDER: 'M',
    HOME_PROVINCE: 'ขอนแก่น',
    NATION: 'ไทย',
    N: 1,
  };
}
