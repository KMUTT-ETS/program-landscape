// ─────────────────────────────────────────────────────────────────────────────
// Unit tests for kku-hr rank parsing.
//
// `POSITION_LEVEL` is formatted `<rank>-<personnel_type>`. The map
// must collapse all known academic-rank variants to the four
// `FacultyRank` enum values, and return null for non-academic /
// administrative ranks so the connector skips them.
// ─────────────────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';

import {
  extractRankSegment,
  positionLevelToFacultyRank,
  rankSegmentToFacultyRank,
} from '../../src/connectors/sources/kku-hr/rank-mapping';

describe('extractRankSegment', () => {
  it('returns null for null/empty input', () => {
    expect(extractRankSegment(null)).toBeNull();
    expect(extractRankSegment('')).toBeNull();
    expect(extractRankSegment('   ')).toBeNull();
  });

  it('strips the personnel-type suffix', () => {
    expect(extractRankSegment('อาจารย์-พนักงานมหาวิทยาลัย')).toBe('อาจารย์');
    expect(extractRankSegment('รองศาสตราจารย์-ข้าราชการ')).toBe('รองศาสตราจารย์');
  });

  it('returns the whole string when no dash present', () => {
    expect(extractRankSegment('ผู้ช่วยศาสตราจารย์')).toBe('ผู้ช่วยศาสตราจารย์');
  });

  it('preserves multi-word rank text', () => {
    expect(extractRankSegment('อาจารย์ สอนและวิจัยต่ำกว่าอุดมศึกษา-พนักงานมหาวิทยาลัย')).toBe(
      'อาจารย์ สอนและวิจัยต่ำกว่าอุดมศึกษา',
    );
  });
});

describe('rankSegmentToFacultyRank', () => {
  it('maps the 4 standard academic ranks', () => {
    expect(rankSegmentToFacultyRank('อาจารย์')).toBe('LECTURER');
    expect(rankSegmentToFacultyRank('ผู้ช่วยศาสตราจารย์')).toBe('ASST_PROF');
    expect(rankSegmentToFacultyRank('รองศาสตราจารย์')).toBe('ASSOC_PROF');
    expect(rankSegmentToFacultyRank('ศาสตราจารย์')).toBe('PROF');
  });

  it('handles rank variants by prefix match', () => {
    // Title variants that prefix-match the standard ranks should
    // collapse to the same enum value.
    expect(rankSegmentToFacultyRank('ศาสตราจารย์เกียรติคุณ')).toBe('PROF');
    expect(rankSegmentToFacultyRank('ศาสตราจารย์วุฒิคุณ')).toBe('PROF');
    expect(
      rankSegmentToFacultyRank('อาจารย์ สอนและวิจัยต่ำกว่าอุดมศึกษา'),
    ).toBe('LECTURER');
  });

  it('disambiguates รองศาสตราจารย์ from ศาสตราจารย์', () => {
    // The ordering of prefixes matters — ASSOC_PROF must check first.
    expect(rankSegmentToFacultyRank('รองศาสตราจารย์')).toBe('ASSOC_PROF');
    expect(rankSegmentToFacultyRank('รองศาสตราจารย์ ดร.')).toBe('ASSOC_PROF');
  });

  it('disambiguates ผู้ช่วยศาสตราจารย์ from ศาสตราจารย์', () => {
    expect(rankSegmentToFacultyRank('ผู้ช่วยศาสตราจารย์')).toBe('ASST_PROF');
    expect(rankSegmentToFacultyRank('ผู้ช่วยศาสตราจารย์พิเศษ')).toBe('ASST_PROF');
  });

  it('returns null for non-academic ranks', () => {
    // Administrative / clerical / specialised ranks should NOT map to
    // FacultyRank — connector skips them.
    expect(rankSegmentToFacultyRank('แพทย์ผู้เชี่ยวชาญ')).toBeNull();
    expect(rankSegmentToFacultyRank('ปฏิบัติการ')).toBeNull();
    expect(rankSegmentToFacultyRank('ชำนาญการ')).toBeNull();
    expect(rankSegmentToFacultyRank('ปริญญาตรี')).toBeNull();
    expect(rankSegmentToFacultyRank(null)).toBeNull();
  });
});

describe('positionLevelToFacultyRank (composed)', () => {
  it('chains parse + map for the most common live values', () => {
    // The 6 highest-frequency POSITION_LEVEL values from the
    // workforce_hcm_actual probe (2026-04-28).
    expect(positionLevelToFacultyRank('อาจารย์-พนักงานมหาวิทยาลัย')).toBe('LECTURER');
    expect(positionLevelToFacultyRank('ผู้ช่วยศาสตราจารย์-พนักงานมหาวิทยาลัย')).toBe('ASST_PROF');
    expect(positionLevelToFacultyRank('รองศาสตราจารย์-พนักงานมหาวิทยาลัย')).toBe('ASSOC_PROF');
    expect(positionLevelToFacultyRank('ศาสตราจารย์-พนักงานมหาวิทยาลัย')).toBe('PROF');
    expect(positionLevelToFacultyRank('ผู้ช่วยศาสตราจารย์-ข้าราชการ')).toBe('ASST_PROF');
    expect(positionLevelToFacultyRank('รองศาสตราจารย์-ข้าราชการ')).toBe('ASSOC_PROF');
  });

  it('returns null for empty or unparseable input', () => {
    expect(positionLevelToFacultyRank(null)).toBeNull();
    expect(positionLevelToFacultyRank('')).toBeNull();
    expect(positionLevelToFacultyRank('-พนักงานมหาวิทยาลัย')).toBeNull();
    expect(positionLevelToFacultyRank('ปฏิบัติการ-พนักงานมหาวิทยาลัย')).toBeNull();
  });
});
