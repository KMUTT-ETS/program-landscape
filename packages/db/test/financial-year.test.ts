import { describe, it, expect } from 'vitest';
import { pickFinancialYear } from '../src/financial-year';

interface Row {
  fiscalYear: number;
  tuitionRevenue: number;
}

const tuitionOf = (r: Row): number => r.tuitionRevenue;

describe('pickFinancialYear', () => {
  it('never selects the in-progress year, even at 95% of the prior year', () => {
    const rows: Row[] = [
      { fiscalYear: 2024, tuitionRevenue: 1_000_000 },
      { fiscalYear: 2025, tuitionRevenue: 950_000 }, // in progress, looks nearly full
    ];
    const pick = pickFinancialYear(rows, 2025, tuitionOf);
    expect(pick.row).toBe(rows[0]);
    expect(pick.reason).toBe('only-row');
    expect(pick.excludedInProgressYear).toBe(2025);
  });

  it('selects the latest complete year when present', () => {
    const rows: Row[] = [
      { fiscalYear: 2023, tuitionRevenue: 900_000 },
      { fiscalYear: 2024, tuitionRevenue: 1_000_000 },
      { fiscalYear: 2025, tuitionRevenue: 1_100_000 },
    ];
    const pick = pickFinancialYear(rows, 2026, tuitionOf);
    expect(pick.row).toBe(rows[2]);
    expect(pick.reason).toBe('latest-complete');
    expect(pick.excludedInProgressYear).toBeNull();
  });

  it('falls back one year when the latest complete year is obviously truncated (<30% of prior)', () => {
    const rows: Row[] = [
      { fiscalYear: 2023, tuitionRevenue: 1_000_000 },
      { fiscalYear: 2024, tuitionRevenue: 150_000 }, // 15% of prior — truncated ingestion, not a real year
    ];
    const pick = pickFinancialYear(rows, 2026, tuitionOf);
    expect(pick.row).toBe(rows[0]);
    expect(pick.reason).toBe('fell-back-truncated');
  });

  it('does NOT treat a genuine 50% decline in a complete year as partial — this is the regression a raised ratio threshold would introduce', () => {
    const rows: Row[] = [
      { fiscalYear: 2023, tuitionRevenue: 1_000_000 },
      { fiscalYear: 2024, tuitionRevenue: 500_000 }, // real collapse, both years fully billed
    ];
    const pick = pickFinancialYear(rows, 2026, tuitionOf);
    expect(pick.row).toBe(rows[1]);
    expect(pick.reason).toBe('latest-complete');
  });

  it('returns the single row when only one exists', () => {
    const rows: Row[] = [{ fiscalYear: 2023, tuitionRevenue: 500_000 }];
    const pick = pickFinancialYear(rows, 2026, tuitionOf);
    expect(pick.row).toBe(rows[0]);
    expect(pick.reason).toBe('only-row');
    expect(pick.excludedInProgressYear).toBeNull();
  });

  it('returns null, never throws, on empty input', () => {
    const pick = pickFinancialYear([], 2026, tuitionOf);
    expect(pick.row).toBeNull();
    expect(pick.reason).toBe('none');
    expect(pick.excludedInProgressYear).toBeNull();
  });

  it('returns none (not a false pick) when every row is in progress', () => {
    const rows: Row[] = [
      { fiscalYear: 2025, tuitionRevenue: 100_000 },
      { fiscalYear: 2026, tuitionRevenue: 200_000 },
    ];
    const pick = pickFinancialYear(rows, 2025, tuitionOf);
    expect(pick.row).toBeNull();
    expect(pick.reason).toBe('none');
    expect(pick.excludedInProgressYear).toBe(2026);
  });

  it('treats a row exactly at currentAcademicYearCE as in progress (boundary is inclusive of "in progress")', () => {
    const rows: Row[] = [{ fiscalYear: 2025, tuitionRevenue: 100_000 }];
    const pick = pickFinancialYear(rows, 2025, tuitionOf);
    expect(pick.row).toBeNull();
    expect(pick.reason).toBe('none');
    expect(pick.excludedInProgressYear).toBe(2025);
  });

  it('skips the truncation check when the prior year is zero (nothing to compare against)', () => {
    const rows: Row[] = [
      { fiscalYear: 2023, tuitionRevenue: 0 },
      { fiscalYear: 2024, tuitionRevenue: 100_000 },
    ];
    const pick = pickFinancialYear(rows, 2026, tuitionOf);
    expect(pick.row).toBe(rows[1]);
    expect(pick.reason).toBe('latest-complete');
  });

  it('the truncation fallback never reaches into an in-progress year — it is bounded by the complete-year set', () => {
    const rows: Row[] = [
      { fiscalYear: 2023, tuitionRevenue: 1_000_000 },
      { fiscalYear: 2024, tuitionRevenue: 100_000 }, // truncated complete year
      { fiscalYear: 2025, tuitionRevenue: 5_000_000 }, // in progress, huge but excluded regardless
    ];
    const pick = pickFinancialYear(rows, 2025, tuitionOf);
    expect(pick.row).toBe(rows[0]);
    expect(pick.reason).toBe('fell-back-truncated');
    expect(pick.excludedInProgressYear).toBe(2025);
  });
});
