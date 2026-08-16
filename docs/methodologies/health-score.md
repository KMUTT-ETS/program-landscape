# Health score methodology

**Version:** `health-score.v3.9`
**Reviewed:** 2026-08-16
**Owner:** KKU Data Office

**v3.9 (2026-08-16): score financials on the last COMPLETE academic year.**

`FinancialMetric.fiscalYear` is named for the fiscal year (Oct–Sep) but
actually holds the **academic** year (Jun–May) — verified in the
connector (`f.ACADYEAR AS COHORT_YEAR_BE`, `kku-finance/connector.ts`).
`FacultyBudget.fiscalYear`, on the same connector, 23 lines away, holds
the true fiscal year. Same column name, two different calendars.

An academic year's tuition is billed across **two** fiscal-year cycles —
semester 1 lands in the fiscal year the academic year starts in,
semester 2 (+ any summer term) lands in the next one. So the
currently-running academic year has, by construction, only ever
collected semester 1's tuition, no matter how late in the year you
check and no matter how healthy the program is.

**The old rule:** drop the latest financial row only if its tuition was
below 30% of the prior row (`PARTIAL = 0.3`, duplicated identically in
`health-score.ts` and `program-deep-dive.ts`). This was meant to catch
"obviously partial" years but was applied as the *only* test.

**Why the ratio failed.** Measured across the 184 programs carrying
both the in-progress year and the prior complete year: the in-progress
year reads a **median of 0.437** of the prior year (one semester of
two, exactly as the billing calendar predicts) — comfortably above the
30% guard. But the **mean is 0.789**, pulled up by a substantial tail of
programs that already read near or above 100% of the prior year while
still only one semester billed (growing intake, a fee change, a weak
prior year). **No ratio threshold separates "half-billed" from
"genuinely healthy/declining"** — raising it to catch the median would
wave the entire tail through as "complete"; the ratio simply does not
carry the information needed to make this call. A ratio-based fix was
considered and rejected for this reason.

**The new rule: ask the calendar, not the ratio.** Score on the latest
academic year strictly before the currently-running one
(`AcademicYearContext.currentAcademicYearBE`, `packages/db/src/
academic-year.ts`) — i.e. the in-progress year is **never** selected,
regardless of its ratio to the prior year. The 30% ratio guard is
retained, but demoted to a **secondary** sanity check that can only
ever pull the picked year *further into the past* (catching a
truncated/failed ingestion of an otherwise-complete year) — it can
never promote a year the calendar says is in progress. A genuine
revenue decline in a complete year, even a steep one, is left alone and
scored as-is: that is the signal this dimension exists to surface, not
an artefact to explain away.

Implemented once in `packages/db/src/financial-year.ts`
(`pickFinancialYear()`) and called from both scorers — `health-score.ts`
for head selection AND (after filtering the series to complete years)
for `tuition_trend_slope`; `program-deep-dive.ts` for the deep-dive's
headline figures. The enrolment-based drivers
(`enrollment_trend_slope`, `kku_intake_policy`) are **deliberately
unchanged** — recruitment for an academic year finishes at that year's
START, a different calendar question from tuition completeness, which
isn't settled until roughly a year *after* the year starts.

**Measured impact (263 programs with real financial rows, run under
`currentAcademicYearBE=2569`/CE 2026, `isStale=false`):**

| | financial dimension | overall composite |
|---|---|---|
| rose | 147 | 150 |
| fell | 5 | 5 |
| unchanged | 108 | 108 |
| newly unscored (no complete year exists yet) | 3 | 0 |
| mean Δ (scored-both-sides subset) | +9.5 | +2.0 |
| median Δ | +4.0 | +0.9 |
| min Δ | −8.2 | −1.6 |
| max Δ | +51.9 | +10.4 |

Direction confirms the hypothesis: a large majority of programs **rise**
because the half-billed in-progress year was dragging their financial
score down. The **5 fell cases** (max −8.2 on the financial dimension,
max −1.6 overall) are members of the long tail described above — cases
where the old rule's partial year happened to read close to or above
the prior complete year, inflating the old score; the new rule corrects
that inflation rather than introducing a new problem. The **3 newly
unscored** programs (`KKU-SEQ-0058`, `KKU-SEQ-0066`, `KKU-SEQ-0231`)
have exactly one financial row, dated the in-progress year — i.e. they
are new programs with no billing history yet. Financial correctly
returns `null` (no complete year exists) rather than fabricating a
score from a single half-billed semester; their overall composite is
unaffected because `combineDimensions` already excludes null
dimensions from the average. No large or widespread fall occurred —
the 108 "unchanged" programs are ones without an in-progress-year row
yet, where old and new head selection necessarily coincide.

Old rows stay stamped `health-score.v3.8` — the version is what keeps
historical Council-facing scores interpretable after this change.

**v3.8 (2026-06-01):** Re-sources the recruitment funnel that feeds the
Attractiveness dimension from the campaign-grain `POWERBI.ADMISSION_STAT`
feed (`admission_campaign_stats`, via the `kku-admission-campaigns`
connector), replacing the curriculum-grain `POWERBI.ADMISSION_STAT_CURRID`
/ `tcas_admission_funnels`. The new feed is a richer superset — one row
per recruitment track (competency / language / exam option / quota type
/ branch-campus intake) within a program × round × year — and carries
correct per-intake plan quotas (Σ over each recruitment program of its
annual plan, no longer collapsing majors that share a curriculum code).
The Attractiveness drivers, formulas, and weights are **unchanged**; only
the underlying source moved. Companion bumps: `program-recruitment.v2`,
`recruitment-rollup.v2`. The `scopeFunnelLatestYear` / `programFunnelYears`
adapters (`packages/db/src/program-funnel.ts`) are the single access point.

**v3.7 (2026-05-19):** Outcomes dimension gains the `student_satisfaction`
driver, sourced from POWERBI.EVALUATE_INSTRUCTOR via the new
`kku-evaluations` connector. Aggregates the scope's surveyed-course
cells (semesters 1+2, all observed years) into a respondent-weighted
mean rating on the 1-5 likert scale, then normalises via anchored
linear `[3.5, 5.0] → [0, 100]`. The narrow band is chosen because 87%
of source cells score ≥ 4.0 (per `docs/methodologies/evaluations.md`
§"Score scale") — a naive `[1, 5] → [0, 100]` would compress every
program into the 75-100 band. See the `student_satisfaction` row in
the Outcomes table below.

> **v3 redesign (2026-05-02):** Five dimensions, all with real-data backing in
> 2026-05. Replaces the v1/v2 set in which `relevance` and `capability` were
> placeholder-null. Each dimension now maps directly to one of the 8 Council
> strategic questions and has 2–4 drivers with explicit data sources.
>
> **Dimension map:**
>
> | Dimension | Council question | Drivers | Source tables (status) |
> |---|---|---|---|
> | **Attractiveness** | Q1: Do students choose this program? | tcas_competition_vs_peers · tcas_fill_rate · enrollment_trend_slope | `admission_campaign_stats` (REAL, KKU funnel via kku-admission-campaigns) · `tcas_admission_stats` (REAL, peer rows) · `enrollment_metrics` (REAL via kku-registry) |
> | **Financial** | Q2: Does it pay for itself? | net_contribution_per_student · revenue_coverage_program_direct · tuition_trend_slope | `financial_metrics` (REAL via link-financials) · `enrollment_metrics` (REAL) |
> | **Capability** | Q6: Is the teaching team strong + sustainable? | senior_rank_share · publications_per_faculty · retirement_horizon_5y | `program_faculties` × `faculty_members` (REAL via kku-hr) · `research_outputs` (REAL via kku-research) |
> | **Outcomes** | Q1+Q6: Do graduates thrive? | tcas_min_score_percentile · employment_rate · average_salary | `tcas_admission_stats` (REAL) · `graduate_outcomes` (PENDING kku-alumni) · `employer_feedback` (PENDING) |
> | **Relevance** | Q1+Q3+Q7: 10y forward-looking strategic fit? | labour_market_alignment · demand_match_filled · demographic_resilience · strategic_sector_alignment | LinkedIn labour-market data (MHESI subscription, KMITL-hosted API; tables `kmitl_career_skill_demands` + `kmitl_careers` are technical handles) · `program_demand_matches` (REAL) · `demographic_projections` (REAL) |
>
> **What changed from v2:**
>
> * `demand` → `attractiveness` — repurposed to TCAS-anchored signals (the v2 demand
>   drivers `admission_yield`/`retention_year2` were null for SEQ-0062 because the
>   registry connector doesn't fill applications/admitted/retainedYear2). Real TCAS3
>   data from `tcas_admission_stats` makes this a Council-grade signal.
> * `quality` → `outcomes` — broader name; adds `tcas_min_score_percentile` so the
>   dimension has live data even before kku-alumni.
> * `relevance` and `capability` are no longer placeholders — both have real scorers
>   backed by real data flips (kku-hr, kku-research, kmitl-skill-mapping, KKU
>   demographics seed, link-financials, link-cohorts, programs:extract-faculty,
>   programs:extract-skills).
> * Driver `labor_market_alignment_kmitl` from v2 (LinkedIn-via-MHESI) is preserved
>   under `relevance`, with the same 4-quadrant fallback chain introduced in v2.1.
>
> **What stayed the same:**
>
> * Equal-weighting across the 5 dimensions (no weighted formulation — the simplest
>   defensible default).
> * Null-handling rule: missing data → `null`, never `0`. `dataCompletenessPct` on
>   every score reports the fraction of non-null drivers.
> * 0–100 scale; <40 "danger zone", 40–65 "needs attention", ≥65 "healthy".
> * Two-reviewer Council approval for any closure/merger/launch decision —
>   regardless of computed score.
>
> v1 + v2 + v2.1 rows are retained for audit; new computations stamp `v3.0`.

## v3.0 driver specifications

### Attractiveness

| Driver | Formula | Data source |
|---|---|---|
| `tcas_competition_vs_peers` | `clamp((kku_ratio / peer_median_ratio) × 50)` — score 50 means parity, 100 means 2× peer median | `admission_campaign_stats` for KKU + `tcas_admission_stats` same-subject peer rows |
| `tcas_fill_rate` | `clamp(((admittedPass1 + admittedPass2) / quota) × 100)` | `admission_campaign_stats` (latest complete year, summed across rounds) |
| `enrollment_trend_slope` | Slope of `enrolled` per year over last 5 years; `clamp(50 + slope/maxSlope × 50)` | `enrollment_metrics` |

### Financial

| Driver | Formula | Data source |
|---|---|---|
| `net_contribution_per_student` | `(net_contribution / enrolled)`. 100K THB/student → 100; 0 → 50; negative scales toward 0 | `financial_metrics` + `enrollment_metrics` (v3.9: last COMPLETE academic year only — see §v3.9 above) |
| `revenue_coverage_program_direct` | `tuition / (direct + facility + overhead)` (gov salary subsidy excluded). 1.0 → 80, 1.2+ → 100 | `financial_metrics` (v3.9: last COMPLETE academic year only) |
| `tuition_trend_slope` | Linear-regression slope of tuition over the available history; positive = growing | `financial_metrics` (v3.9: in-progress academic year excluded from the series before the trend is computed — see §v3.9 above) |

### Capability

| Driver | Formula | Data source |
|---|---|---|
| `senior_rank_share` | `(prof + assoc_prof) / total_active`. 50% → 100. Floor at 0 | `program_faculties` × `faculty_members.rank` |
| `publications_per_faculty` | `total_research_outputs / total_active_faculty`. 5/year → 100 | `program_faculties` × `research_outputs` (year >= currentYear-3) |
| `retirement_horizon_5y` | `100 - (retiring_5y / total × 100)`. Inverted: more retiring soon = lower score | `program_faculties` × `faculty_members.retirementDate` |

### Outcomes

| Driver | Formula | Data source | Status |
|---|---|---|---|
| `tcas_min_score_percentile` | KKU's TCAS3 min-score percentile within same-subject peer set | `tcas_admission_stats` | REAL |
| `employment_rate` | `clamp(rate × 100)` | `graduate_outcomes` | REAL (kku-alumni PDF/XLSX intake) |
| `job_relevance` | `clamp(jobRelevanceScore × 100)` — share with "ตรงสาขา" job (program-level only) | `graduate_outcomes` | REAL |
| `average_salary` | Anchored: ฿15k → 0, ฿20k → 40, ฿25k → 70, ฿35k+ → 100 (`(salary − 15_000) / 200`) | `graduate_outcomes` | REAL |
| `further_study_rate` | Sweet-spot scoring: 0% → 50, 5-15% → 100, 30%+ → 30. Both extremes are negative signals (program-level only) | `graduate_outcomes` | REAL |
| `student_satisfaction` (v3.7) | `clamp(((rating − 3.5) / 1.5) × 100)` — weighted-mean rating across the scope's courses' surveyed cells (semesters 1+2, all observed years), anchored linear to [3.5, 5.0]. Captures the ceiling-biased distribution: 87% of cells score ≥ 4.0, so a naive [1, 5] → [0, 100] would compress every program into 75-100. See `docs/methodologies/evaluations.md` §"Score scale" | `evaluation_response_summaries` (POWERBI.EVALUATE_INSTRUCTOR via `kku-evaluations` connector) | REAL |

### Relevance

| Driver | Formula | Data source |
|---|---|---|
| `labour_market_alignment` | % of program skills matching LinkedIn-demanded set, with 4-quadrant fallback (Thailand/Job → Global/Job → Thailand/Profiles → Global/Profiles) | `program_skills` × `kmitl_career_skill_demands` |
| `demand_match_filled` | `100 × (matched_demanded / relevant_demanded)` — share of *relevant* demanded skills the curriculum already teaches | `program_demand_matches` |
| `demographic_resilience` | `100 - clamp((required_share_at_+10y × 100000) × 100)` — inverted required cohort share. <0.05% → ~100, >0.2% → ~0 | `programDemographicOutlook` (`demographic_projections`) |
| `strategic_sector_alignment` | 100 if any career mapped to the program (via the labour-market career taxonomy used by the LinkedIn-derived data) maps to a BCG/S-curve target sector; 50 otherwise | Career taxonomy from the labour-market data source × `Program` career mappings × strategic-sector heuristic |



> **v2 changes (2026-05-01):** Demand dimension extended with a fourth driver
> `labor_market_alignment_kmitl`. The first three drivers (admission yield,
> retention year 2, on-time graduation) are unchanged — they remain internal-
> KKU proxies for demand. The new driver pulls real external labour-market
> signal from **LinkedIn**, sourced via the **MHESI subscription** to the
> labour-market-insights API hosted at KMITL (`KmitlCareerSkillDemand`,
> scope=THAILAND, source=JOB_POSTINGS, percentage ≥ 5%). Computation: per-
> program, the share of ProgramSkill rows whose skill_id is in the demanded
> set (skills with ≥5% prevalence in any career), ×100. Faculty/department
> aggregates average across child programs. Returns null (data gap) when no
> labour-market rows have been loaded yet, NOT zero.
>
> The driver-name `labor_market_alignment_kmitl` and table-prefix `Kmitl*`
> are technical handles that match the API endpoint name; the underlying
> data source is LinkedIn (via MHESI). The `_kmitl` suffix is preserved as
> a stable code identifier — it does not imply that KMITL is the data
> owner.
>
> Per `docs/readiness-checklist.md` gate 11, this driver is preview-quality
> until **2026-05-31** (30-day green-history countdown started 2026-05-01).
> Until then, Council-facing Cockpit views should surface "preview" framing
> on the demand dimension.
>
> Old `health-score.v1` rows are retained for audit; new computations stamp
> `v2`. The connector behind the new driver is `kmitl-skill-mapping`, which
> replaces the original prompt-14 plan to ingest JobThai + JobsDB.

Every program has five health dimensions plus an overall composite. Scores
run 0–100 where 100 is healthiest. Below 40 is "danger zone"; 40–65 is
"needs attention"; above 65 is "healthy".

**This score informs, it does not decide.** Council decisions on program
closure/merger/launch require two-reviewer approval regardless of the
computed score (see `docs/ai-governance.md` §human-in-the-loop).

## The five dimensions

| Dimension | What it measures | Primary signals |
|---|---|---|
| **Demand** | Is there real demand for the program's outputs? | Applications per seat, admission yield, labour-market demand for primary skill cluster (from JobThai/JobsDB), demographic ceiling |
| **Financial** | Does it cover its costs? | Net contribution per graduate, cost/revenue ratio, trend over 3 years |
| **Quality** | Is curriculum + teaching strong? | Graduate employment rate, average salary, employer satisfaction, accreditation status |
| **Relevance** | Does what's taught match what matters? | Skill coverage vs demand, policy alignment (MHESI / NESDC mentions), research output alignment |
| **Capability** | Can the faculty actually deliver this? | Faculty-member-to-student ratio, faculty seniority distribution, retirement horizon, active research |

Each dimension score is computed from 3–5 underlying metrics, weighted
equally within the dimension. The overall composite is an equal-weighted
average of the five. Why equal weighting:

- Equal weights are the least-arguable default. Council members can
  read an unweighted score and form their own mental bias without the
  tool having already applied one.
- Any weighted formulation encodes a value judgement that should be
  visible. When (if) we move to weighted composites, the weights MUST
  appear in the chart tooltip, not just in this doc.

## Data completeness

Every score carries a `dataCompletenessPct` field — the fraction of
underlying metrics that had non-null values in the current scope. A
score computed from 2 of 5 underlying metrics has `completeness=40`.

**Display rules (non-negotiable):**
- Completeness < 50%: score is rendered in `text-tertiary` + flagged
  "low data" in tooltip. Never displayed without a data-completeness
  indicator.
- Completeness 0%: no score; cell shows "—" with "no data" tooltip.
- Council brief MUST mention completeness explicitly for any score it cites.

## Null handling

Null metric values are **excluded from the average**, not substituted
with 0 or 50. Rationale:

- Substituting 0 would punish programs for missing data — "we don't
  know your employment rate" would become "employment rate 0".
- Substituting 50 would pretend we have neutral information when we
  have none.
- Excluding + flagging completeness lets the reader see the real signal
  and make their own judgement about how much to trust it.

## Scope aggregation

- **Program scope:** score is computed directly from that program's
  metric rows.
- **Department scope:** weighted average across the department's
  programs, weighted by enrolled headcount (a 500-student program
  moves the score more than a 12-student program).
- **Faculty scope:** weighted across departments, same headcount weight.
- **University scope:** weighted across faculties.

The weighted-by-enrolment rule is the same as `queryMetricByScope`'s
`outcome`-family rollups — see `packages/db/src/scope.ts`.

## Version bumping

When the formula changes (weights, dimensions, null-handling, completeness
thresholds):

1. Bump the version constant (`HEALTH_SCORE_VERSION` in
   `packages/db/src/health-score.ts`).
2. Update this doc's "Version:" and "Reviewed:" lines.
3. Never edit an existing version's logic in place — historical scores
   on past Council Packs must remain reproducible.

Historical scores are not backfilled. The version that computed a
score at the time it was displayed stays stamped on it.

## Known limitations of v1

- **Demand signal is synthetic today.** Real JobThai/JobsDB feeds are
  mocked (prompt 03). Demand scoring uses `job_postings` rows as
  available, falling back to enrolled-per-applications-ratio only.
  Flip to real when connectors are wired (prompt 14).
- **Capability signal is coarse.** Faculty-member-to-student ratio is
  the strongest signal; retirement-horizon + active-research terms
  need per-faculty-member detail we'll get from the real KKU-HR
  connector.
- **No longitudinal comparison.** v1 scores are point-in-time.
  Trend-over-time comes with the scenario planner in prompt 09 where
  users actually want it.
- **Cross-scope consistency not asserted.** A faculty's composite
  score is NOT mathematically guaranteed to equal the weighted average
  of its departments' composites (they're each computed independently
  from the MV rollups at that level). For this v1 the divergence is
  typically small; a future version may enforce bottom-up consistency
  explicitly.

## Sanity checks the scoring service enforces at compute time

- Every score output clamped to [0, 100].
- `dataCompletenessPct` ∈ [0, 100].
- If every underlying metric is null, returns `null` — never 0.
- `methodologyVersion` stamped on every returned row.
