# Risk Scoring Methodology — `risk-scoring.v1.9`

> Current version: `risk-scoring.v1.9` · First shipped: 2026-05-08 · Maintainer: VP Education + Digital
> Locked reference: `packages/db/src/risk-scoring.ts`

## Purpose

Per-program risk profile with three independent **Likelihood** drivers and two
**Impact** dimensions. Output is a composite tier (LOW / MODERATE / HIGH /
CRITICAL) plus revenue-at-risk numbers in raw THB. Scope: undergraduate
programs only (`Program.level = BACHELOR`).

## Risk equation

```
Risk = Likelihood × Impact
Composite = max(L1, L2 × 0.7, L3)   // over non-null drivers; L2 discounted
```

`max(L)` is deliberate — a single critical driver should not be diluted by
two healthier ones.

**L2 carries a 0.7 discount in the composite (v1.6).** AI-disruption
mitigation typically requires large multi-year investment that creates
new operational risks (faculty turnover, curriculum churn, lock-in to a
tech wave that shifts). A single high L2 should not alone push composite
into CRITICAL. The discount applies **only** to the composite calculation
— L2's raw score drives the AI prompt, the L2 component breakdown UI,
the KKU 5×5 cell placement, and the readiness-deficit + disruption-signal
panels at full strength. What's discounted is only its weight in the
tier-classifying max.

## Likelihood drivers

### L1 — Recruitment / TCAS competition decay (0–100)

Signal that demand for the program is collapsing. **Computed off the latest
fully-completed TCAS cycle only** — the in-progress cycle (whose application
counts are partial because rounds 3–4 are still running) is filtered out by
`latestCompleteEntryYearBE()`. The filter rolls forward each January 1
automatically.

Weighted average of:

| Component | Weight | Source | Formula |
|---|---|---|---|
| Competition ratio | 0.35 | TCAS funnel (latest year) | `applicants / planPerYear`. Score: `(3 − ratio) × 50`, clamped 0–100. ratio<1 ⇒ 100; ratio≥3 ⇒ 0. |
| Fill rate | 0.35 | TCAS funnel (latest year) | `regReported / planPerYear`. Score: `(1 − fill) × 100/0.6`. KKU intake-floor breach (BACHELOR < 30) lifts the score to ≥80 regardless. |
| Trend decay | 0.20 | TCAS funnel 5y | CAGR of total applicants. Score: `50 − cagr × 500`. −10%/yr CAGR ⇒ 100; +10% ⇒ 0. |
| Late-round dependency | 0.10 | TCAS funnel (latest year) | Share of `regReported` from rounds 3–4. Score = share × 100. |

Confidence = sum of weights for components that had data. A program with TCAS
funnel for the latest year only and no trend data scores at confidence 0.80.

### L2 — AI-disruption (0–100, three-component blend)

Three independent signals, each normalised 0–100, blended with fixed weights:

| Component | Weight | Source |
|---|---|---|
| **Skill pressure** | 0.35 | weighted `Skill.automationRisk` × `ProgramSkill.weight` |
| **Readiness deficit** | 0.35 | `100 − ProgramAiReadinessAssessment.relevanceScore` (program-ai-readiness.v2) |
| **Disruption signal** | 0.30 | severity-weighted gaps + priority-weighted recommendations from program-ai-readiness.v2 |

```
L2 = 0.35 × skill_pressure + 0.35 × readiness_deficit + 0.30 × disruption_signal
```

When a signal is missing the blend collapses to the available components
(e.g. skill-only fallback when no AI readiness assessment exists).
Confidence reflects which signals were present.

#### 1. Skill pressure (0–100)

```
high_share    = Σ weight (skill = HIGH)    / Σ weight
medium_share  = Σ weight (skill = MEDIUM)  / Σ weight
raw           = high_share × 0.7 + 0.5 × medium_share × 0.3
skill_pressure = clamp(0, 100, raw × 100 × 1.5)
```

`automationRisk` is set on the `Skill` taxonomy. Heuristic seed
(Frey-Osborne + WEF Future of Jobs 2023) populates LOW/MEDIUM/HIGH for
~14% of skills; the remainder picks up an AI sweep tier or stays UNKNOWN.

#### 2. Readiness deficit (0–100)

```
readiness_deficit = 100 − relevanceScore
```

`relevanceScore` is the discipline-aware AI readiness score from
`program-ai-readiness.v2` — a deep-dive AI analysis already running for
75% of undergraduate programs. **Anchored relative to what AI readiness
MEANS for the discipline**, not generic ML coverage. A music program with
strong AI music-tech coverage scores 80 (low deficit); a logistics program
that ignores supply-chain optimisation AI scores 20 (high deficit).

#### 3. Disruption signal (0–100)

How much external pressure is the discipline under to adopt AI? Read off
the deep-dive's `gaps` array (severities) and `recommendations` array
(priorities):

```
gap_axis  = clamp(0, 100, (3·major + 2·moderate + 1·minor) / 18 × 100)
rec_axis  = clamp(0, 100, (3·high  + 2·medium  + 1·low  ) / 18 × 100)
disruption_signal = 0.6 × gap_axis + 0.4 × rec_axis
```

A program in an AI-distant discipline produces few gaps; one in a heavily
AI-affected discipline produces many. The denominator (18) maps the
observed top of the gap-volume distribution (~6 gaps × max severity 3) to
~100. Recalibrate when the gap-emission distribution shifts.

#### Confidence

Sum of weights for components that had data — naturally 0..1. A program
with skills classified but no AI readiness assessment lands at confidence
≈ 0.35; with both available, ≈ 1.0.

#### Why this matters

The deep-dive's `program-ai-readiness.v2` already produced a discipline-
grounded analysis for each program — naming concrete gaps ("AI in music
information retrieval", "generative design for architecture"), specific
recommendations, and peer institutions to learn from. L2 v1.3 routes that
analysis directly into the score AND surfaces the gaps + recommendations
into the AI prompt's risk-mitigation measures so they cite the deep-dive's
named items rather than inventing generic AI guidance.

### L3 — Demographic vulnerability (0–100, v1.11 — present + past + future)

The v1.x universal-cohort baseline was wrong: every program got the same
~43 score regardless of whether they had a real demographic problem. A
program with 8 applicants per seat is *insulated* from cohort decline —
their ratio can absorb years of shrinkage and still stay over-subscribed.
Only programs near the **1:1 cliff** are demographically at risk.

L3 blends three program-specific signals — the present, the past, and
(since v1.11) the future:

| Component | Weight | Formula |
|---|---|---|
| **Buffer score** | 0.50 | Piecewise function of latest applicants/seat ratio (see below). Council policy: < 1.5 = critical (no buffer left). |
| **Demographic projection** | 0.30 | Forward signal from `programDemographicOutlook` — applicants scaled by the NESDC national-cohort decline, scored by the horizon until the pool falls below 1.5 applicants/seat (`superCriticalYear`). Already super-critical ⇒ 100; +5y ⇒ 77; +10y ⇒ 53; +15y ⇒ 30; never within +15y ⇒ 0. |
| **Trend score** | 0.20 | 5-year applicant CAGR. Negative trend amplifies vulnerability. CAGR of −10%/yr ⇒ 50; CAGR of −20%/yr ⇒ 100; CAGR ≥ 0 ⇒ 0. |

The v1.11 demographic-projection component is discriminating (gated by
each program's current ratio — a healthy pool never crosses 1.5/seat
within the horizon), so it does **not** reintroduce the non-program-
specific universal baseline that v1.9 removed.

#### Buffer score piecewise

```
ratio ≤ 1.0  → 100  (already at the cliff)
ratio ≤ 1.5  → 75–100  (Council "critical" band)
ratio ≤ 3.0  → 25–75   (moderate buffer — eroding)
ratio ≤ 5.0  → 0–25    (strong buffer)
ratio > 5.0  → 0       (insulated)
```

#### Why this works

The Thai 18–22 cohort decline (~1.8%/yr per NESDC) is real, but it doesn't
threaten programs with strong applicant pools. A 5:1 ratio could survive
~50 years of cohort decline before falling below 1:1. A 1.2:1 ratio could
fall below 1:1 in a single bad year. The buffer score quantifies that
distance from the cliff; the trend score catches programs that are losing
ground faster than the cohort.

#### Empirical fit

In the BACHELOR portfolio (89 programs with TCAS data): 78 programs
(88%) sit at ≥5:1 → L3 ≈ 0; 9 programs in 3:1–5:1 → L3 = 0–25; 1 program
in 1.5–3.0 → L3 ≈ 25; **zero programs** in the critical < 1.5 band. This
matches the qualitative observation that KKU's brand sustains demand for
most undergrad programs even as the national cohort shrinks. The previous
v1.8 L3 incorrectly flagged the same 78 insulated programs at L3 ≈ 43,
inflating composite tiers across the portfolio.

## Impact dimensions

### I1 — Direct revenue at risk (THB)

```
I1 = annual_tuition_revenue × 5
```

Annual tuition is `FinancialMetric.tuitionRevenue` for the most recent
fiscal year. Treats a 5y projection as a flat extrapolation — a deliberate
simplification; the Scenario Planner is the right tool for cohort-aware
projections with policy interventions.

### I2 — Stranded structural cost (THB)

```
I2 = (allocatedFacultyCost + allocatedFacilityCost + allocatedOverhead) × 5
```

Captures the cost that does **not** fall away if the program closes. Direct
course-specific cost (`directCost`) does fall away, so it's excluded.

### Total impact + 0–100 normalisation

```
totalThb = I1 + I2
impactScore = log10-normalised totalThb across the population
```

Log scale because revenue distribution is right-skewed — without log, a few
large faculty programs would max out the scale and squash everyone else
into 0–5. Recomputed at the end of every `pnpm risks:assess` batch.

## KKU 5×5 institutional risk matrix

KKU's enterprise risk-management policy expresses every risk via a 5×5
likelihood × impact matrix. Risk Management module surfaces this view
**alongside** the composite tier — both representations live on every
assessment row and both render in the UI. They answer different questions:

- **Composite tier** — analytic verdict on a 0–100 scale, threshold-banded
- **KKU 5-level** — institutional matrix score (1–25) for ERM templates

### Binning rule (equal-width 0–100 → 1–5)

```
[0, 20)   → 1   (rare / minor / insignificant)
[20, 40)  → 2
[40, 60)  → 3
[60, 80)  → 4
[80, 100] → 5   (almost certain / catastrophic)
```

### Matrix score

```
likelihoodBin = bin5(composite)
impactBin     = bin5(impactScore)
matrixScore   = likelihoodBin × impactBin   // 1..25
```

### KKU colour rule

| Matrix score | KKU level | Colour |
|---|---|---|
| 1–4 | ต่ำ (Low) | สีเขียว (green) |
| 5–9 | ปานกลาง (Moderate) | สีเหลือง (yellow) |
| 10–15 | สูง (High) | สีส้ม (orange) |
| 16–25 | สูงมาก (Very high) | สีแดง (red) |

Programs whose `composite` or `impactScore` is null fall to KKU level
`NEEDS_DATA` (slate) — not LOW. Matches the same posture as the
composite tier's NEEDS_DATA bucket.

The KKU level + matrix score + likelihood-bin + impact-bin are persisted
on every `RiskAssessment` (computed in the same pass as `impactScore`
normalisation). The portfolio page renders a 5×5 cell-occupancy heatmap
showing how programs distribute across the matrix.

## Tier mapping

| Condition | Tier |
|---|---|
| L1 AND L2 both null | **NEEDS_DATA** |
| All three drivers null | **NEEDS_DATA** |
| composite < 35 | LOW |
| 35 ≤ composite < 60 | MODERATE |
| 60 ≤ composite < 80 | HIGH |
| composite ≥ 80 | CRITICAL |

**The NEEDS_DATA gate is structural, not numeric.** L3 alone fires the
universal Thai cohort decline and contains zero program-specific signal.
A program where only L3 is available has insufficient evidence for any
verdict — the cleanest answer is "go acquire L1 funnel and/or classify
L2 skills first."

## Null handling

- **Missing inputs return `null`, never imputed zeros.** A program without
  a TCAS funnel scores L1 = null; it does not score L1 = 0 (clean bill of
  health) or L1 = 50 (median).
- The **composite** is the max over non-null drivers. If L1 is null but L2
  and L3 score, composite = max(L2, L3).
- If **all three** drivers are null (rare — usually means the program has
  neither funnel data nor enrollment data nor any classifiable skills), the
  pipeline still creates an assessment row with composite = null and tier =
  LOW so the absence is visible in the audit.
- The `dataGapsJson` column on every `RiskAssessment` enumerates which
  inputs were missing and why.

## Key Risk Indicators (KRIs)

| Slug | Trigger (latest year only) | Warn | Critical |
|---|---|---|---|
| `application_seat_ratio` | applicants / plan | < 1.5 | < 1.0 |
| `enrollment_fill_rate` | regReported / plan | < 0.7 | < 0.5 |
| `late_round_dependency` | round 3+ share of admits | > 0.5 | > 0.7 |
| `skill_automation_index` | HIGH-tagged share of skills | > 0.3 | > 0.6 |
| `bachelor_intake_floor` | regReported (latest year) | < 36 | < 30 |

KRI breaches are stored per `(program × indicator × evaluation moment)` so
the UI can plot breach history as a series. The bachelor intake floor is
KKU Council policy, not a statistical threshold.

## AI assessment — `risk-assessment.v1`

Runs **on top of** the deterministic scores — does not re-score. The AI:

1. Sanity-checks the deterministic L1/L2/L3 against qualitative context the
   formula misses (e.g. "L2 is high because Office software is HIGH-tagged,
   but it's not the program's core teaching" ⇒ caveat).
2. Writes a 200–300 word Thai narrative for Council consumption.
3. Proposes 2–4 **specific** measures — named courses to add/drop, named
   peers to merge with, named marketing channels — not generic categories.

The deterministic scores are the audit anchor; the AI output adds narrative
layer. Both are versioned (`risk-scoring.v1` + `risk-assessment.v1`) so the
audit chain is reproducible.

## Data quality posture

Following the user's directive (2026-05-08): **use real data; if missing,
state it.** No 30-day green-history gate before this surface goes live.

Each `RiskAssessment` row carries an explicit `dataGapsJson` array. The UI
program-profile page renders this in an "amber" callout. The Council Pack
PDF (when wired) will surface the same gaps in the provenance appendix.

The methodology is intentionally simple in v1 — every formula is in this
doc, in the locked reference file, and in the per-program "drivers" panel.
v2 directions: weighted L composite (when there's calibration data),
program-specific cohort projections (NESDC has province-level data), and
fuzzy-match peer benchmarking pulled into L1 as a competitive-intensity
component.

## Change log

| Version | Date | Change |
|---|---|---|
| v1 | 2026-05-08 | Initial release. Three L drivers, two I dimensions, max(L) composite, log-normalised impact score, 5 KRIs. |
| v1.1 | 2026-05-08 | (a) **NEEDS_DATA tier** added — programs whose L1 and L2 are both null no longer receive a misleading LOW/MODERATE verdict. (b) **L2 program-specific** — weighted by `ProgramSkill.weight` so fringe HIGH-risk skills can't outweigh LOW-risk core skills; the program's own top HIGH-risk skills are surfaced to the AI prompt for named recommendations. |
| v1.2 | 2026-05-08 | **In-progress TCAS cycle excluded** from L1, KRIs, and L3 competitiveness percentile. Rule: only `entry_year_be ≤ currentCalendarYear + 543 − 1` participates in scoring. The in-progress year stays visible in the program profile sparkline (rendered dashed + asterisked) but doesn't drive numbers. Removes a class of false-CRITICAL flags that came from reading partial round 1–2 counts as if they were full-year totals. |
| v1.3 | 2026-05-08 | **L2 redesigned** — instead of just counting weighted automation tags, L2 now blends three components: (1) skill pressure (35%, kept from v1.2), (2) readiness deficit from `program-ai-readiness.v2`'s discipline-aware `relevanceScore` (35%), (3) disruption signal from severity-weighted gaps + priority-weighted recommendations in the same deep-dive analysis (30%). The deep-dive's top gaps + recommendations also flow into the AI prompt + program profile UI so risk-mitigation measures cite specific deep-dive items by name instead of inventing generic AI guidance. NEEDS_DATA contracts (20→14) because L2 can now resolve from AI readiness even when skills are unclassified. HIGH expands (19→32) as legitimate AI-disruption risk surfaces in disciplines with high gap volume. |
| v1.4 | 2026-05-08 | **KKU 5×5 institutional matrix added** — alongside the composite tier, every assessment now carries a `likelihoodBin` (1–5), `impactBin` (1–5), `kkuMatrixScore` (1–25), and `kkuRiskLevel` (LOW/MODERATE/HIGH/VERY_HIGH/NEEDS_DATA) per the university's ERM policy. Equal-width 0–100 → 1–5 binning. Colour rule: 1–4 green / 5–9 yellow / 10–15 orange / 16–25 red. The KKU level is computed inside `normaliseImpactScores()` in the same pass as the 0-100 impact normalisation. Portfolio page shows a 5×5 cell-occupancy heatmap; program profile shows a `KkuScoreBadge` alongside the composite-tier banner; tier-grouped table gains a "KKU score" column. |
| v1.5 | 2026-05-08 | **In-progress fiscal-year filter on impact + university averages.** `computeImpact()` now applies the same `latestCompleteEntryYearBE()` filter to `FinancialMetric` that L1/KRIs/L3 already use — partial-year revenue no longer skews the 5y projection. Excluded years bubble up to `dataGaps`. New `getUniversityAverages(level)` returns the mean L1/L2/L3/composite/impact/KKU score across the latest assessments at the given level; surfaced on `/risks/portfolio` and `/risks/programs/:id` so the per-program radar can overlay the institutional baseline. NEEDS_DATA tier override: when the analytic verdict is suspended, the KKU columns are forced to null + NEEDS_DATA instead of producing a misleading numeric score from the universal-only L3 cohort signal. |
| v1.6 | 2026-05-08 | **L2 discounted by 0.7 in the composite.** AI-mitigation investments are large, multi-year, and introduce new operational risks — a single high L2 should not alone push composite into CRITICAL. Raw L2 stays at full strength everywhere except composite calculation (UI display, KKU matrix cell, AI prompt, recommendations). Operational drivers (L1 recruitment, L3 demographic) carry full weight because they reflect realised performance the program has direct levers on. **Recommended measures gain a `horizon` field** (`SHORT_TERM` 0–12mo / `MEDIUM_TERM` 1–3y / `LONG_TERM` 3–5y) — the AI prompt requires measures spread across all three horizons when feasible. Program profile UI groups measures into three lanes by horizon. New `pnpm risks:seed-measures` rule-based fallback generates 2–4 horizon-balanced measures per assessment based on driver signals when AI is unavailable. New `--skip-ai-done` flag on `pnpm risks:assess --all` enables chunked AI sweeps. |
| v1.7 | 2026-05-08 | **In-progress fiscal-year filter unit fix.** v1.5 added a filter to exclude in-progress FY from impact, but compared `FinancialMetric.fiscalYear` (CE) against `latestCompleteEntryYearBE()` (BE) — making the filter a no-op (CE 2026 ≤ BE 2568 is always true). Partial CE 2026 numbers were leaking in and deflating revenue projections (CE 2026 had ~50M baht across 72 programs vs CE 2025's ~1.08B for the same cohort — clearly mid-year). Added sibling helper `latestCompleteFiscalYearCE()` and switched `computeImpact()` to use it. |
| v1.8 | 2026-05-08 | **Financial-missing → NEEDS_DATA.** Risk = Likelihood × Impact. Programs without `FinancialMetric` data (no tuition baseline, ~30% of undergrads due to incomplete `RegistryProgramMapping`) were getting a composite tier based on L scores alone, then sitting at impactScore=0 in the matrix → misleading "low impact, low priority" placement. Now `scoreProgramRisk` overrides the tier to `NEEDS_DATA` whenever `impact.totalThb` is null. Comparative viz (bubble chart, composite histogram, ERM 5×5 cell counts) filter out NEEDS_DATA programs; faculty heatmap + tier-grouped table still show them so the data-acquisition worklist stays visible. |
| v1.9 | 2026-05-08 | **L3 redesigned around entry competitiveness + trend.** The v1–v1.8 L3 fired a universal cohort-shrinkage baseline (~43) for every program with TCAS data, regardless of whether they had real demographic exposure. A program with 8:1 applicants/seat is genuinely insulated from cohort decline; only programs near the 1:1 cliff face real risk. New L3 = 0.75×buffer + 0.25×trend, where `buffer` is a piecewise function of apps/seat (Council critical threshold: <1.5) and `trend` is the 5y applicant CAGR. Universal-cohort and peer-percentile components removed. Result: 78 of 89 BACHELOR programs (88%) drop from L3≈43 to L3≈0, correctly reflecting that strong applicant pools insulate them from cohort decline. |
| v1.11 | 2026-05-20 | **L3 gains a forward demographic-projection component.** L3 v1.9 was present + past only (current applicants/seat buffer + 5y CAGR). v1.11 adds a third component — weight 0.30, with buffer 0.75→0.50 and trend 0.25→0.20: `programDemographicOutlook` scales the program's applicants by the NESDC national-cohort decline and reports `superCriticalYear`, the horizon at which the pool drops below 1.5 applicants/seat. Score: already super-critical→100, +5y→77, +10y→53, +15y→30, never within +15y→0. The component is discriminating (gated by each program's current ratio), so it does not reintroduce the v1.8 universal baseline. `programDemographicOutlook` becomes an input to `ProgramRiskInputs`. |
