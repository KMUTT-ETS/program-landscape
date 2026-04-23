# Forecasting methodology — v1

**Version:** `forecasting.v1`  
**Introduced:** 2026-04-23 (Prompt 08, Gap Analyzer)  
**Owner:** Analyst team

---

## Scope

This document describes how the Gap Analyzer projects **labor-market demand** and **KKU graduate supply** forward in time. All forecast values carry `methodologyVersion = 'forecasting.v1'`; when the formulas change, bump to v2 and leave v1 rows untouched.

## Two projection families

| Quantity | Source | Method | Rationale |
|---|---|---|---|
| **Demand** per occupation / skill | `OccupationDemand.postingsCount` monthly series; `JobPostingSkill` roll-up | Holt's linear trend (SES + trend) | Demand series are short (36–60 months after prompt 14) and noisy; Holt degrades gracefully and doesn't require autocorrelation structure. |
| **Supply** per program | `EnrollmentMetric.graduated` yearly series | Linear regression + demographic multiplier | Enrollment trends are smooth but constrained by the shrinking youth cohort; a plain linear projection overshoots systematically. |

ARIMA / SARIMAX are **not used in v1.** They require ≥30 observations per series with stable autocorrelation; most of our series are shorter. Upgrade path: once we have ≥5 years of real monthly data (post prompt 14), re-benchmark against SARIMAX and switch if it wins on held-out periods.

## Demand: Holt's linear trend

Smoothing equations:

```
l_t = α · y_t + (1 − α) · (l_{t−1} + b_{t−1})
b_t = β · (l_t − l_{t−1}) + (1 − β) · b_{t−1}
ŷ_{t+h} = l_t + h · b_t
```

- `l_t` is the current level; `b_t` is the current trend.
- `α` (level smoothing) = **0.5**, `β` (trend smoothing) = **0.3** by default. Grid-search auto-fit is deferred — the marginal accuracy gain on short series is typically inside the noise floor.
- `h` is forecast horizon in periods.

### Confidence bands

Residual standard error on one-step-ahead forecasts:

```
RSE = sqrt( Σ (y_t − ŷ_t)² / (n − 1) )
```

Bands widen with `√h`:

| Band | Multiplier |
|---|---|
| 50 % | ±0.674 · RSE · √h |
| 80 % | ±1.282 · RSE · √h |
| 95 % | ±1.96 · RSE · √h |

**We do not assume Gaussian errors.** The z-score multipliers approximate bands for the typical case; they are *not* guaranteed coverage percentages. Treat them as visual uncertainty indicators, not statistical guarantees.

### Degenerate inputs

- **0 observations** → refuse to forecast (return `null`, mark `lowConfidence: true`).
- **1 observation** → return that observation as the projection, with a ±50 % wide band and `observations = 1` so the UI can surface "insufficient data."

## Supply: linear + demographic adjustment

Step 1 — OLS fit on yearly enrollment:

```
slope = (n · Σxy − Σx · Σy) / (n · Σx² − (Σx)²)
intercept = meanY − slope · meanX
baselineProjection = intercept + slope · targetYear
```

Step 2 — demographic multiplier from `DemographicProjection`:

```
multiplier = cohort(targetYear, region) / cohort(baselineYear, region)
supplyProjection = baselineProjection · multiplier
```

`cohort` is the 18–22 age-band population for the region. Thailand's NESDC projects this cohort shrinking ~1.8 %/year through 2035; a program currently graduating 40 students/year projects to ~35 by 2030 under a purely demographic ceiling, regardless of recruitment effort. The adjustment is visible in the UI as "Before / After demographic adjustment" so Council members see the counterfactual.

### Confidence bands

Residual std error from OLS:

```
RSE = sqrt( Σ (y_i − ŷ_i)² / (n − 2) )
```

Then:

| Band | Multiplier |
|---|---|
| 50 % | ±0.674 · RSE |
| 80 % | ±1.282 · RSE |
| 95 % | ±1.96 · RSE |

Multiplied by the same demographic factor. We acknowledge but do not currently compound uncertainty in the multiplier itself — NESDC projections carry their own error. Flagged as a known limit below.

## Back-testing

Every forecast is persisted to `forecast_runs` with the projected value and the three CIs. When the `targetYear` elapses, an operator (or a future nightly job) fills `actualValue` and the system computes:

```
signedErrorPct = (projected − actual) / max(|actual|, 1) · 100
absoluteError  = |projected − actual|
```

The Gap Analyzer's `/gap-analysis/forecast-accuracy` page shows recent back-tests grouped by kind × horizon. A methodology change is warranted when MAPE (mean absolute percentage error) exceeds **25 %** for three consecutive quarters at the same horizon.

## Known limits

1. **No seasonality.** Monthly demand series have quarterly hiring cycles we don't model. Once prompt 14 wires real data, evaluate seasonal naïve and SARIMA as baselines.
2. **Single region per forecast.** Cross-region substitution effects (Northeast grads taking Bangkok jobs) aren't modelled. The regional filter in the UI is a view filter, not a flow model.
3. **Demographic multiplier is scalar.** Doesn't account for regional variation in migration or within-cohort skill distribution.
4. **Confidence bands under-covered on non-Gaussian errors.** Empirical bootstrap intervals would be more honest but cost ~5× compute; deferred until we see real accuracy data from back-tests.
5. **No structural breaks.** A policy change (say, MHESI restructuring a whole faculty) isn't captured. Trend Radar signals can flag such events; the forecast methodology stays naïve.

## Deferred

- [ ] Autofit α, β via SSE minimisation when `observations ≥ 18`
- [ ] Seasonal Holt-Winters for monthly demand with ≥24 observations
- [ ] SARIMA comparison on real data (post prompt 14)
- [ ] Bootstrap prediction intervals
- [ ] Regional-flow model (graduates → job location)
- [ ] Structural-break detection tied to TrendSignal records

## Change log

- **2026-04-23 — v1** — initial methodology. Holt's linear trend for demand, linear + demographic for supply.
