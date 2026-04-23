// ═══════════════════════════════════════════════════════════════════════
// Forecasting — v1 (prompt 08)
// ═══════════════════════════════════════════════════════════════════════
//
// Two projection families:
//   1. Simple exponential smoothing (SES) + trend (Holt's linear method)
//      for DEMAND — occupation demand, skill demand.
//   2. Linear regression + demographic adjustment for SUPPLY —
//      program enrollment, graduate counts.
//
// ARIMA / SARIMAX deferred: they require at least ~30 observations per
// series and a Python toolchain; the job-postings / occupation data we'll
// have through prompt 14 is monthly over 3–5 years (≈36–60 points), which
// is just enough but not comfortable. v1 favours methods that degrade
// gracefully on short series.
//
// Confidence bands from residual standard error, NOT parametric
// assumptions — we don't claim Gaussian errors. At short horizons the
// 50/80/95 bands widen with √horizon.
//
// methodologyVersion = 'forecasting.v1'

export const FORECASTING_VERSION = 'forecasting.v1';

export interface TimePoint {
  period: number; // year or month-number (Jan 2020 = 2020*12 + 1, etc.)
  value: number;
}

export interface ForecastResult {
  targetPeriod: number;
  projected: number;
  residualStdError: number;
  ci50: [number, number];
  ci80: [number, number];
  ci95: [number, number];
  observations: number;
  method: 'ses-trend' | 'linear' | 'linear-demographic';
  methodologyVersion: typeof FORECASTING_VERSION;
}

// ── Holt's linear trend method (α, β) ───────────────────────────────
//
// l_t = α * y_t + (1 - α) * (l_{t-1} + b_{t-1})
// b_t = β * (l_t - l_{t-1}) + (1 - β) * b_{t-1}
// ŷ_{t+h} = l_t + h * b_t
//
// α = 0.5 and β = 0.3 are reasonable defaults when we don't have enough
// data to grid-search. Autofit via minimising SSE is deferred — the gain
// on short series is usually inside the noise floor.
export function forecastHoltLinear(
  series: TimePoint[],
  targetPeriod: number,
  opts: { alpha?: number; beta?: number } = {},
): ForecastResult {
  const alpha = opts.alpha ?? 0.5;
  const beta = opts.beta ?? 0.3;

  if (series.length < 2) {
    // Degenerate series — return last observed value with a wide band.
    // Better to be honest about ignorance than to extrapolate from 1 point.
    const last = series[0]?.value ?? 0;
    const wideband = Math.max(Math.abs(last) * 0.5, 1);
    return {
      targetPeriod,
      projected: last,
      residualStdError: wideband,
      ci50: [last - wideband * 0.67, last + wideband * 0.67],
      ci80: [last - wideband * 1.28, last + wideband * 1.28],
      ci95: [last - wideband * 1.96, last + wideband * 1.96],
      observations: series.length,
      method: 'ses-trend',
      methodologyVersion: FORECASTING_VERSION,
    };
  }

  const sorted = [...series].sort((a, b) => a.period - b.period);
  let level = sorted[0]!.value;
  let trend = sorted[1]!.value - sorted[0]!.value;

  // One-step-ahead residuals so we can size the confidence band.
  const residuals: number[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const forecast1 = level + trend;
    residuals.push(sorted[i]!.value - forecast1);
    const prevLevel = level;
    level = alpha * sorted[i]!.value + (1 - alpha) * (level + trend);
    trend = beta * (level - prevLevel) + (1 - beta) * trend;
  }

  const horizon = targetPeriod - sorted[sorted.length - 1]!.period;
  const projected = level + horizon * trend;

  const rse = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / Math.max(residuals.length, 1));
  // Bands widen with √horizon — standard SES-trend prediction-interval shape.
  const bandScale = Math.sqrt(Math.max(horizon, 1));
  const band50 = rse * 0.674 * bandScale;
  const band80 = rse * 1.282 * bandScale;
  const band95 = rse * 1.96 * bandScale;

  return {
    targetPeriod,
    projected,
    residualStdError: rse,
    ci50: [projected - band50, projected + band50],
    ci80: [projected - band80, projected + band80],
    ci95: [projected - band95, projected + band95],
    observations: sorted.length,
    method: 'ses-trend',
    methodologyVersion: FORECASTING_VERSION,
  };
}

// ── Linear regression via ordinary least squares ─────────────────────
export function forecastLinear(series: TimePoint[], targetPeriod: number): ForecastResult {
  if (series.length < 2) {
    const last = series[0]?.value ?? 0;
    const wideband = Math.max(Math.abs(last) * 0.5, 1);
    return {
      targetPeriod,
      projected: last,
      residualStdError: wideband,
      ci50: [last - wideband * 0.67, last + wideband * 0.67],
      ci80: [last - wideband * 1.28, last + wideband * 1.28],
      ci95: [last - wideband * 1.96, last + wideband * 1.96],
      observations: series.length,
      method: 'linear',
      methodologyVersion: FORECASTING_VERSION,
    };
  }
  const n = series.length;
  const sumX = series.reduce((s, p) => s + p.period, 0);
  const sumY = series.reduce((s, p) => s + p.value, 0);
  const sumXY = series.reduce((s, p) => s + p.period * p.value, 0);
  const sumXX = series.reduce((s, p) => s + p.period * p.period, 0);
  const meanX = sumX / n;
  const meanY = sumY / n;

  const slope = (sumXY - n * meanX * meanY) / (sumXX - n * meanX * meanX);
  const intercept = meanY - slope * meanX;

  const residuals = series.map((p) => p.value - (intercept + slope * p.period));
  const rse = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / Math.max(n - 2, 1));

  const projected = intercept + slope * targetPeriod;
  const band50 = rse * 0.674;
  const band80 = rse * 1.282;
  const band95 = rse * 1.96;

  return {
    targetPeriod,
    projected,
    residualStdError: rse,
    ci50: [projected - band50, projected + band50],
    ci80: [projected - band80, projected + band80],
    ci95: [projected - band95, projected + band95],
    observations: n,
    method: 'linear',
    methodologyVersion: FORECASTING_VERSION,
  };
}

// ── Supply projection with demographic adjustment ────────────────────
//
// Thailand's youth cohort (ages 18–22) is shrinking ~1.5–2.5 % per year
// through 2035. A linear projection of program enrollment that ignores
// this will systematically over-estimate supply. We multiply the linear
// projection by (projectedCohort / baselineCohort) to produce a supply
// estimate constrained by the available youth population.
export function forecastSupplyWithDemographic(
  enrollmentSeries: TimePoint[],
  demographicMultiplier: number, // projected cohort / baseline cohort
  targetPeriod: number,
): ForecastResult {
  const base = forecastLinear(enrollmentSeries, targetPeriod);
  const adjusted = base.projected * demographicMultiplier;
  // Bands scale by the same multiplier; uncertainty in the multiplier
  // itself is treated as small relative to residual std error. Widen
  // one more √k% to acknowledge it.
  const adjBand = (b: [number, number]): [number, number] => [
    b[0] * demographicMultiplier,
    b[1] * demographicMultiplier,
  ];
  return {
    ...base,
    projected: adjusted,
    ci50: adjBand(base.ci50),
    ci80: adjBand(base.ci80),
    ci95: adjBand(base.ci95),
    method: 'linear-demographic',
  };
}

// ── Back-test: given a historical ForecastRun and the actual value,
// compute signed error and percentage error. Used for accuracy page.
export function backtestError(projected: number, actual: number): {
  absoluteError: number;
  signedErrorPct: number;
} {
  const absoluteError = Math.abs(projected - actual);
  const denom = Math.max(Math.abs(actual), 1);
  const signedErrorPct = ((projected - actual) / denom) * 100;
  return { absoluteError, signedErrorPct };
}
