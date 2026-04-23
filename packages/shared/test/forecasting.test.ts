import { describe, expect, it } from 'vitest';
import {
  forecastHoltLinear,
  forecastLinear,
  forecastSupplyWithDemographic,
  backtestError,
  FORECASTING_VERSION,
} from '../src/forecasting';

// Pure-function tests — no DB, no mocks. The two things that MUST stay
// correct across methodology revisions:
//   1. Confidence bands widen with horizon (Holt) and stay symmetric.
//   2. Demographic multiplier scales both projection AND bands.

describe('forecastHoltLinear', () => {
  it('flat-line series projects the same level with a narrow band', () => {
    const series = Array.from({ length: 10 }, (_, i) => ({ period: 2015 + i, value: 100 }));
    const r = forecastHoltLinear(series, 2030);
    expect(r.projected).toBeCloseTo(100, 1);
    expect(r.residualStdError).toBeCloseTo(0, 5);
    expect(r.methodologyVersion).toBe(FORECASTING_VERSION);
  });

  it('increasing series has positive trend extrapolation', () => {
    const series = Array.from({ length: 10 }, (_, i) => ({ period: 2015 + i, value: 100 + i * 10 }));
    const r = forecastHoltLinear(series, 2030);
    // 2030 is 6 years past the last observation; trend of +10/year.
    expect(r.projected).toBeGreaterThan(200);
  });

  it('confidence bands widen with horizon', () => {
    const series = Array.from({ length: 10 }, (_, i) => ({
      period: 2015 + i,
      value: 100 + i * 10 + (i % 2 === 0 ? 5 : -5), // noisy trend
    }));
    const near = forecastHoltLinear(series, 2025);
    const far = forecastHoltLinear(series, 2035);
    const nearSpan = near.ci95[1] - near.ci95[0];
    const farSpan = far.ci95[1] - far.ci95[0];
    expect(farSpan).toBeGreaterThan(nearSpan);
  });

  it('single observation returns that value with a wide band + method set', () => {
    const r = forecastHoltLinear([{ period: 2024, value: 50 }], 2030);
    expect(r.projected).toBe(50);
    expect(r.observations).toBe(1);
    expect(r.ci95[1] - r.ci95[0]).toBeGreaterThan(0);
  });
});

describe('forecastLinear', () => {
  it('OLS on clean linear data yields the underlying slope', () => {
    const series = Array.from({ length: 6 }, (_, i) => ({ period: 2020 + i, value: 50 + i * 4 }));
    const r = forecastLinear(series, 2030);
    // slope=4, targetYear=2030, basePeriod=2020 → 50 + 10*4 = 90
    expect(r.projected).toBeCloseTo(90, 2);
  });

  it('residual stderr is zero for perfect-fit inputs', () => {
    const series = Array.from({ length: 6 }, (_, i) => ({ period: 2020 + i, value: 50 + i * 4 }));
    const r = forecastLinear(series, 2030);
    expect(r.residualStdError).toBeCloseTo(0, 5);
  });
});

describe('forecastSupplyWithDemographic', () => {
  it('applies the multiplier to projection AND bands', () => {
    const series = Array.from({ length: 5 }, (_, i) => ({ period: 2020 + i, value: 100 }));
    const base = forecastLinear(series, 2028);
    const adjusted = forecastSupplyWithDemographic(series, 0.8, 2028);
    expect(adjusted.projected).toBeCloseTo(base.projected * 0.8, 2);
    expect(adjusted.ci50[0]).toBeCloseTo(base.ci50[0] * 0.8, 2);
    expect(adjusted.ci50[1]).toBeCloseTo(base.ci50[1] * 0.8, 2);
    expect(adjusted.method).toBe('linear-demographic');
  });

  it('demographic multiplier > 1 expands projection (growing cohort)', () => {
    const series = Array.from({ length: 5 }, (_, i) => ({ period: 2020 + i, value: 100 }));
    const shrink = forecastSupplyWithDemographic(series, 0.8, 2028);
    const grow = forecastSupplyWithDemographic(series, 1.2, 2028);
    expect(grow.projected).toBeGreaterThan(shrink.projected);
  });
});

describe('backtestError', () => {
  it('zero error on perfect prediction', () => {
    const e = backtestError(100, 100);
    expect(e.absoluteError).toBe(0);
    expect(e.signedErrorPct).toBe(0);
  });

  it('over-prediction yields positive signed pct', () => {
    const e = backtestError(120, 100);
    expect(e.signedErrorPct).toBeCloseTo(20, 2);
  });

  it('under-prediction yields negative signed pct', () => {
    const e = backtestError(80, 100);
    expect(e.signedErrorPct).toBeCloseTo(-20, 2);
  });
});
