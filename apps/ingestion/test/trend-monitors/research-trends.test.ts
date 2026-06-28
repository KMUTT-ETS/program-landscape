import { describe, expect, it } from 'vitest';
import {
  detectResearchTrends,
  type FacultyResearchRow,
} from '../../src/trend-monitors/research-trends';

const row = (over: Partial<FacultyResearchRow>): FacultyResearchRow => ({
  facultyId: 'f1',
  facultyNameEn: 'Faculty of Medicine',
  facultyNameTh: 'คณะแพทยศาสตร์',
  yCount: 0,
  prevCount: 0,
  ...over,
});

describe('detectResearchTrends', () => {
  const year = 2025;

  it('emits a rise above both thresholds (+41%, +97 abs)', () => {
    const out = detectResearchTrends([row({ yCount: 332, prevCount: 235 })], year);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ year: 2025, yCount: 332, prevCount: 235, pct: 41 });
  });

  it('does NOT emit when ratio is below RISE_RATIO (1.20)', () => {
    // +10% — above abs-delta but below the 20% ratio
    expect(detectResearchTrends([row({ yCount: 110, prevCount: 100 })], year)).toHaveLength(0);
  });

  it('does NOT emit a small-faculty rise below MIN_ABS_DELTA (10)', () => {
    // +200% ratio but only +6 papers — noise
    expect(detectResearchTrends([row({ yCount: 9, prevCount: 3 })], year)).toHaveLength(0);
  });

  it('does NOT emit a decline', () => {
    expect(detectResearchTrends([row({ yCount: 207, prevCount: 230 })], year)).toHaveLength(0);
  });

  it('does NOT emit when flat', () => {
    expect(detectResearchTrends([row({ yCount: 100, prevCount: 100 })], year)).toHaveLength(0);
  });

  it('emits for a faculty rising from zero prior (pct null, abs-delta met)', () => {
    const out = detectResearchTrends([row({ yCount: 15, prevCount: 0 })], year);
    expect(out).toHaveLength(1);
    expect(out[0].pct).toBeNull();
  });

  it('respects custom thresholds', () => {
    const out = detectResearchTrends([row({ yCount: 110, prevCount: 100 })], year, {
      riseRatio: 1.05,
      minAbsDelta: 5,
    });
    expect(out).toHaveLength(1);
  });

  it('filters a mixed batch to only the qualifying rises', () => {
    const out = detectResearchTrends(
      [
        row({ facultyId: 'med', yCount: 332, prevCount: 235 }), // rise ✓
        row({ facultyId: 'sci', yCount: 207, prevCount: 230 }), // decline ✗
        row({ facultyId: 'agr', yCount: 95, prevCount: 58 }), // rise ✓
        row({ facultyId: 'tiny', yCount: 9, prevCount: 3 }), // small ✗
      ],
      year,
    );
    expect(out.map((t) => t.facultyId).sort()).toEqual(['agr', 'med']);
  });
});
