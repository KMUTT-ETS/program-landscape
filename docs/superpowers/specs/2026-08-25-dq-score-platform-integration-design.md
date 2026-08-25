# DQ score across the platform — design

**Date:** 2026-08-25
**Status:** approved for planning
**Surfaces:** health score (`outcomes` dimension) · `/programs/[id]` deep-dive · gap analyzer

## Goal

KKU's Digital Intelligence (DQ) test is a competency every undergraduate takes. How a
programme's students score is evidence of what that programme develops in them — so it
should inform the programme's health score, appear on its deep-dive, and be visible in
the skill-gap picture.

This spec turns the `/education/student-dq` cubes (already live) into a programme-level
signal used in three places. It does not change how DQ data is collected.

## What the data supports — measured, not assumed

Measured against the loaded cubes on 2026-08-25:

| fact | value |
|---|---|
| bachelor programmes at KKU | 102 |
| …with any DQ data | 87 (85%) |
| …with ≥5 scored students | **81** |
| …with ≥20 scored students | 74 |
| non-bachelor programmes carrying DQ rows | 30, totalling **10 students** |
| programme-level DQ mean — range | **75.1 – 90.7** |
| …median / IQR | 85.0 / 82.5 – 86.3 |
| programmes below the pass mark of 70 | **0** |

Two consequences drive the design.

**DQ is an undergraduate instrument.** The 30 graduate programmes holding DQ rows total
ten students — undergraduates who sat the test and later enrolled in a master's, caught
by the current-enrolment join. A DQ score on a master's programme would be an artefact of
that join, not a measurement of the programme. **Non-bachelor programmes are excluded
everywhere in this feature**, including on the existing dashboard, which today shows
those 30 programmes.

**The spread is narrow and sits high.** Half of all programmes fall within 3.8 points of
each other, and none is below the pass mark. A raw pass-through into a 0–100 driver would
put every programme between 75 and 91 and differentiate almost nothing — the same failure
the radar had on a 0–100 axis.

## The programme DQ score

`dqProgramScore(programId)` = the respondent-weighted mean across **theory modules 1–12**,
read from `dq_module_cube` as `SUM(score_sum) / SUM(taken_count)` at programme scope.

- **Module 13 (Generative AI) is excluded**, for the reason it is already excluded from
  the dashboard's Overall column: uptake ranges 48.7%–96.7% between faculties, so
  including it would score programmes on how far the rollout happened to have reached
  them. It keeps its own place on the deep-dive radar, where it is labelled.
- **Zeros are excluded as "not taken"**, inherited from the cube.
- **Eligibility:** `level = 'BACHELOR'` AND ≥ `DQ_MIN_CELL_STUDENTS` (5) scored students.
  Otherwise the score is **null** — excluded from any average, never scored as zero, per
  the health-score null rule.

The 5-student floor is the operator's decision, taken over a proposed 20 so that one rule
(the dashboard's existing suppression floor) governs the whole feature. Its cost is
volatility: a 5-student mean moves on one student. The mitigation is that **the driver
carries its own `n`**, and every surface that renders the score renders the sample size
beside it, so a thin score is visibly thin rather than silently equal to a robust one.

## 1. Health score — a driver inside `outcomes`

`outcomes` already holds `tcas_min_score_percentile`, `employment_rate`, `job_relevance`,
`average_salary`, `further_study_rate`. DQ joins them as `dq_digital_competency`.

Chosen over a sixth dimension because a sixth would re-weight the composite for every
bachelor programme (each dimension falling from ⅕ to ⅙) and assert that digital
competency ranks with finance and capability. As a driver it changes one dimension, and
the 199 non-bachelor programmes are untouched — a null driver is excluded from its
dimension's mean, exactly as missing metrics already are.

### Scoring band

Drivers in this codebase map raw values through bands, not linear pass-through (see
`scoreFurtherStudyRate`, `scoreStudentFacultyRatio`). The DQ band is anchored on KKU's
own pass mark rather than on the observed spread:

| raw DQ mean | driver score |
|---|---|
| ≤ 50 | 0 |
| 50 → 70 | 0 → 50 (linear) |
| **70 (pass mark)** | **50** |
| 70 → 90 | 50 → 100 (linear) |
| ≥ 90 | 100 |

Today's programmes therefore land between **62.8** (the weakest, 75.1) and **100**
(90.7), with the median at 87.5 — real differentiation from a 15-point raw spread.

The lower half of the band is currently unused: no programme is below 70. It exists so
that a genuinely failing programme is *visible* rather than clipped at the floor, and so
the scale does not have to change the day one appears. Anchoring on the pass mark also
makes the number interpretable — **50 means the average student just passes** — where a
band fitted to the observed min/max would be arbitrary, unstable across refreshes, and
would move one programme's score when a different programme's data changed.

### Rollups

Faculty and university figures come from `SUM(score_sum) / SUM(taken_count)` **at that
scope**, never from averaging programme scores. This is the same rule the cube exists to
support, and the DQ work has already demonstrated the size of the error: at university
level, the weighted mean of module 1 is 86.708 against 87.544 for the mean-of-means.

### Versioning

`HEALTH_SCORE_VERSION` goes **`health-score.v3.9` → `v4.0`**, and
`docs/methodologies/health-score.md` gains the driver, the band and the eligibility rule.
Every stored health score is recomputed. The expected direction is upward for programmes
that score well and neutral elsewhere; the plan requires a **before/after drift report**
across all 301 programmes, presented, not buried — the discipline used for every previous
verdict-moving change.

## 2. Deep-dive — a "Digital competency" section

New section on `/programs/[id]`, backed by `GET /programs/:id/dq` alongside the existing
section endpoints (`skills`, `outcomes`, `research-expertise`, …).

Renders for **bachelor programmes only**:
- the programme's DQ score and its health-driver value, with **n scored students** stated;
- the 13-module radar against the university, reusing `RadarChartSmall` and the adaptive
  floor built for the dashboard (axis floor at the plotted data's decade, capped at 60,
  computed across both series, with the truncation stated in words);
- pass rate — DQ's own `allPassed` flag, passed through, with the source's inconsistency
  noted as it is on the dashboard;
- the programme's weakest modules named, since "which competency is weak" is the
  actionable part;
- a link through to `/education/student-dq` filtered to that programme.

Empty states, distinct and honest: a bachelor programme with no DQ rows says so and
points at the connector; one below the 5-student floor says the figure is withheld and
shows the count; a non-bachelor programme renders **nothing at all** — no empty box —
because DQ does not apply to it.

## 3. Gap analyzer — a separate digital-competency lens

The gap analyzer computes supply as `ProgramSkill weight × graduate count`: it assumes
that a skill taught is a skill acquired. DQ is the only evidence in the platform that
measures whether students **actually acquired** a competency. That makes it genuinely new
information rather than a second opinion on the same signal.

It enters as a **separate lens**, not as a modifier on the existing numbers:

- A `dq_module_skills` mapping table — 13 rows, hand-curated, each pairing a DQ module
  with the skill-taxonomy row it evidences, with a confidence note. Hand-curated because
  the taxonomy holds 5,152 skills with four separate "Digital Literacy" entries; fuzzy
  matching would produce a mapping nobody could defend in a Council meeting.
- A view answering: for the digital skills the labour market demands (KMITL demand data),
  what do KKU students actually score, and which programmes are weakest on them?

Existing gap figures are **unchanged**. Nothing on that page silently moves; the lens
sits beside it and is labelled as attainment evidence, a different axis from demand and
supply.

## Non-goals

- **No change to how DQ is collected or aggregated.** The cubes, the connector and the
  dashboard stay as they are, apart from the non-bachelor exclusion.
- **No per-student anything.** The cubes hold no student rows and this work does not add
  any.
- **DQ does not enter the lifecycle or risk verdicts** in this piece. It moves the health
  score, which those consume; propagating it further is a separate decision with its own
  drift report.

## Testing

Pure functions in `packages/db` (no database):
- the band — 50 → 0, 70 → 50, 90 → 100, 75.1 → 62.75, values outside the range clamped
  rather than extrapolated, and a null raw mean returning a null driver (never 0);
- eligibility — non-bachelor excluded whatever its data, below-floor excluded, exactly-5
  included;
- rollup — a faculty score built from two programmes' sums equals the direct weighted
  mean and *differs* from the mean of their scores (the same property the DQ query layer
  already proves).

Live verification: the 81 eligible programmes all receive a driver; the 21 other bachelor
programmes and all 199 non-bachelor programmes receive `null`, not `0`; and the drift
report reconciles — every programme whose outcomes score moved has a DQ driver, and none
without one moved.

## Deferred

- **Cohort trend.** The cube carries `cohortYearBe`, so "is this programme's digital
  competency improving?" is answerable in principle — but the export is a current-state
  dump with no test date, so a trend needs retained snapshots. Revisit after several
  refreshes.
- **Module 13 in the score**, once its rollout is complete enough that uptake no longer
  varies two-fold between faculties.
- **Propagating DQ into lifecycle / risk verdicts.**
- **Reconciling the 15 bachelor programmes with no DQ data at all** — worth asking LTIC
  whether those cohorts were tested.
