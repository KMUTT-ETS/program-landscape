# Health score methodology

**Version:** `health-score.v5.4`
**Reviewed:** 2026-10-03
**Owner:** KKU Data Office

**v5.4 (2026-10-03): external grants become an award on Financial.** The
`external_grant_engagement` driver and its 30-day gate are removed, so
Capability is back to four drivers at 25 % each. Financial gains an award of up
to +10 points, added after the Financial drivers are averaged. The measure is
grant baht per active teaching staff member per year over the last three
complete Thai fiscal years (1 Oct start, `[currentFy - 3, currentFy - 1]` in BE,
Bangkok time): `0` at or below baht 100,000, and
`min(10, 10 * ln(x / 100,000) / ln(30))` above it, so baht 3 M or more earns the
full +10 (baht 300k gives +3.2, baht 1 M gives +6.8). The rationale is revenue
diversification: external money means a programme relies less on tuition fees
and public funding. It is an award, not a penalty: it can only raise a score,
and grants do not measure the quality of teaching, so a programme without one
loses nothing. A project counts once per programme (or once per scope), however
many of its staff are on it, and a project's budget is a whole-project figure
that is never split across members. Completeness is unchanged (the award is not
a driver), a programme whose base Financial score is null earns no award, and
the award never creates a Financial score on its own. The only source check
left is that `kku-research-services` has synced successfully at least once on
the server; there is no history gate, by owner decision on 2026-10-03 (see
`docs/readiness-checklist.md`, gate 11). **Disclosed undercount:** about 30 % of
co-investigator identifiers match no HR record, so some programmes' figures are
understated and every figure is a lower bound; for an award that error can only
withhold points. Spec
`docs/superpowers/specs/2026-10-03-external-grant-financial-award-design.md`.

**Programme awards and scope awards count shared projects differently, by
design.** A programme's award counts a project in *every* programme whose
teaching staff are on its team, so one project shared by three programmes
raises all three. A faculty, department or university award counts that project
once, over the *distinct* active staff of the scope's programmes. Programme
awards can therefore run above their faculty's award, and the
faculty-vs-programme consistency check (see "Cross-scope consistency") will show
a wider Financial gap than before v5.4. That gap is expected and is not a
defect.

**Measured basis (development, 2026-10-03, window FY 2567-2569).** 253
programmes have a Financial score. Their award has p25 +2.0, median +6.2,
p75 +8.3 and p90 +10.0; 26 programmes (10 %) sit at the +10 cap and 23 have no
project in the window, so their award is +0. Grant baht per active teaching staff
member per year: p25 0.36 M, median 0.93 M, p75 1.94 M, p90 3.74 M.

> **Superseded by v5.4 (2026-10-03).** The v5.3 paragraphs below describe a
> Capability driver that no longer exists.

**v5.3 (2026-10-02): external grant engagement joins the Capability
dimension.** A fifth driver, `external_grant_engagement`, is the share of a
programme's active teaching staff on at least one externally funded research or
academic-service project in the last three complete Thai fiscal years, scored
60 % -> 100. It measures breadth, not volume: projects and budgets are not
counted (a prolific investigator or a stream of small service contracts must not
carry a programme, and the source never splits a project budget across its
members). Capability drivers are equal-weighted inside the dimension, so each
of the five now carries **20 %** instead of 25 %; dimension weights and the
overall mean are unchanged. The driver is **gated on 30 days of green sync
history** (see "External grant engagement" below) and is null until the gate
opens, so on a server without that history Capability is the mean of its other
four drivers: scores do not move, but data completeness drops by one
capability driver (capability completeness is capped at 80 %) until the gate
opens. Spec
`docs/superpowers/specs/2026-10-02-grant-engagement-driver-design.md`.

**Measured basis (development, 2026-10-02, window FY 2567-2569).** 285
programmes have active teaching staff and 260 of them have at least one funded
member. The share of a programme's staff on at least one project has p25 22 %,
median 36 %, p75 56 %, so under the 60 % target a median programme scores about
60 and the top quarter about 93-100.

**v5.2 (2026-09-13): the JobThai signal corrected, and labour-market demand
weighted domestic 75 : global 25.** v5.1 was superseded the same day, before
any deployment; its measured impact below is kept as the record of what was
wrong.

1. **The programme links were wrong** (`jobthai-bridge.v2`). The skill-overlap
   path compared a programme's taught skills with every skill that even ONE
   posting in an occupation mentioned, and transferable skills carried it.
   Doctor of Medicine was linked to Sales/AE, QC/QA and electrical engineering
   on Communication, Critical thinking, Teamwork and Leadership, and
   Professional ethics. Overlap-only links carried 120,251 of the 132,902
   postings behind all links. Now:
   - an occupation *demands* a skill only when at least 5% of its postings name
     it (`OCCUPATION_SKILL_DEMAND_FLOOR`; measured share p50 0.013, p90 0.10);
   - a skill demanded by more than 20% of the 240 occupations is *generic* and
     cannot create a link (`GENERIC_SKILL_OCCUPATION_SHARE`; Communication 227,
     Management 195, Accounting 52 versus Mechanical engineering 27,
     Programming 24, Medicine 5);
   - the field-of-study score is the share of the occupation's eligible
     postings asking for the field, counted per posting. It had been matched
     fields over distinct fields: Mechanical Engineering to mechanical engineer
     read 0.04 against a posting share of 0.57.

   Links at score >= 0.1: 835 -> 673; overlap-only links 365 -> 1;
   programmes with a link at >= 0.1: 54, of which 42 clear the 20-posting floor.

2. **The driver was circular.** A skill-overlap link exists exactly when a
   programme's taught skills are demanded, so every overlap-linked programme
   scored at least 50 by construction; 37 of the 64 scored under v5.1 took at
   least 80% of their postings from such links. The driver now reads only
   field-of-study and corroborated links.

3. **Exact skill matching could not see the curriculum.** With honest links,
   exact skill-ID overlap read 0 for 29 of 41 programmes — curricula say "Legal
   Drafting" and "Thermodynamics", postings say "Litigation" and "Mechanical
   engineering". The driver now uses the AI curriculum check that
   `demand_match_filled` already uses: JobThai-demanded skills join the same
   `programs:match-demand` call, each row tagged in `demand_sources`, and the
   driver is the share of **relevant** JobThai-demanded skills the curriculum
   covers. Generic skills are not checked. **Null below 5 relevant skills**
   (`JOBTHAI_MIN_RELEVANT_SKILLS`): two identical AI runs gave BBA Marketing 33
   then 67 on three skills, while programmes resting on 9-19 skills moved 7-11
   points.

4. **Relevance became profession-aware (`demand-match.v4`).** v3 asked "would a
   graduate plausibly need this?" and called Electrical engineering and
   Industrial engineering relevant gaps for Mechanical Engineering. They are
   other professions — and in the JobThai data those strings come from
   qualification lines listing accepted degrees (41 of the 45
   mechanical-engineer postings tagged "Electrical engineering" mention it only
   there). v4 gives the model the programme's target careers (its JobThai
   occupations and LinkedIn careers) and each skill's demand context, and asks
   for a closed-world fit — `core`, `supporting`, `other-profession`,
   `not-relevant` or `uncertain` — with a one-sentence reason. `relevant` is
   derived from the fit (core or supporting) and is **no longer implied by
   `matched`**: a Mechanical programme's electrical service course does not make
   electrical engineering a skill its graduates are hired for. This applies to
   LinkedIn rows too, so `demand_match_filled` also becomes profession-aware as
   each programme is re-run.

5. **Domestic 75 : global 25.** `jobthai_demand_alignment` (JobThai, domestic)
   and `labour_market_alignment` (LinkedIn via MHESI, global) keep their
   combined weight of two drivers in the Relevance mean; only the split between
   them is 75:25 (`LABOUR_MARKET_DEMAND_WEIGHTS`). When one has no data the
   other takes the whole share. Both stay visible and both count toward
   completeness. Other dimensions are unchanged.

`demand_match_filled` and every other reader of `program_demand_matches`
(strategic narrative, Gap Analyzer, benchmarking) are scoped to LinkedIn rows,
so adding JobThai skills to the AI check does not change what they measure.

**Measured on dev, 2026-09-13, and partial by design.** The AI check (v4) has
run for 5 sample programmes; the full run belongs on production. Three carry the
driver: Law 83, Statistics and Data Science 83, Mechanical Engineering 67
(LinkedIn alignment 14, 8, 10). Under v3 Mechanical read 44, with Electrical and
Industrial engineering among its gaps; under v4 its gaps are Preventive
Maintenance and Continuous Improvement, and those two disciplines appear as
degrees employers also accept. Accountancy and BBA Marketing show no figure
(3 and 2 relevant skills). Portfolio relevance 74.9 under the v3 sample (74.0
under v5.1). **Figures move again once the production run completes; re-measure
then.**

---

**v5.1 (2026-09-13, superseded by v5.2 before deployment): the Relevance
dimension gains `jobthai_demand_alignment`.**

The share of a programme's taught skills that its linked JobThai occupations
demand — the direct analogue of `labour_market_alignment`, which reads the
LinkedIn-via-MHESI feed, so the two are comparable and can visibly disagree.

Source: 47,631 Thai job postings delivered as spreadsheets (see
`docs/data-sources/jobthai.md`), linked to programmes by two independent paths —
the field of study a posting states, and skill overlap.

**Caveats, which travel with every figure derived from this source.** 37.0% of
postings are Bangkok and 3.3% the 20 Northeast provinces, Khon Kaen 304: this
is the national labour market, not KKU's region. No salary, employer or posting
date exists in the source.

**Null, never 0 — and for postgraduate programmes that is the normal case, not
an edge case.** Only 41 of 47,631 postings state a postgraduate qualification as
their minimum, so 0 of 110 master's and 2 of 68 doctoral programmes receive a
score. 82% of doctoral programmes *do* match a field of study named in a
posting, but those postings want a bachelor's. Scoring a doctorate from
undergraduate vacancies would have produced a healthy-looking number that meant
nothing, so the driver reports nothing instead. That gate is enforced on the
**posting's** stated education floor, not on whether a field matched.

**Measured impact.** 64 of 297 programmes scored, values 44–100, median 71.
Portfolio relevance 73.9 → 74.0; faculty-scope relevance 72.6 → 72.9;
cross-scope relevance divergence −1.5 → −1.0. Dimension weights unchanged.

**Every threshold is measured, not assumed** — see
`packages/db/src/jobthai-bridge.ts` for the distributions behind each:
`JOBTHAI_MIN_POSTINGS_FOR_SIGNAL = 20` (observed 25th percentile of the
per-programme distribution), `MIN_SKILL_OVERLAP_SHARE = 0.5` with at least 3
shared skills, `MAX_PROGRAMMES_PER_FIELD = 15` (a field matching more carries no
discriminating power — "Science" matched 135 of 297 programmes), and
`JOBTHAI_MIN_LINK_SCORE = 0.1`.

**v5.0 (2026-09-12): scope driver parity, and a completeness figure that
can see a missing driver.**

Faculty, department and university scores are computed by a different set
of scorers than programme scores. Those scope scorers were written at
v3.0 and never kept up as drivers were added through v3.6, v3.7 and v4.0,
so they had quietly been scoring on 2-4 of the 5-7 drivers their
programme counterparts use. Nothing surfaced it, because
`dataCompletenessPct` was computed over the drivers a scorer *constructed*
— so a scorer that simply never built a driver reported 100% complete
while missing half its inputs.

Measured 2026-09-12, every one of 24 faculties scored **below** its
programme mean: 11.6 pts on average, 28.5 at worst. Relevance alone ran
-56.4, because two of its drivers were hardcoded to null at scope level
and a third was never implemented there. Capability, the only dimension
already carrying identical drivers at both scopes, was also the only one
that agreed — +0.4.

v5.0 brings the sets to parity. A driver whose calibration is
per-programme rolls up as the mean of its programme values; a driver
whose scale is scope-invariant is computed as ratio-of-sums, which
weights by programme size. `dataCompletenessPct` now counts a driver a
scorer never built, so three dimensions that claimed 100% now report
honestly. **Composites above programme scope move**, generally upward.
See the "Cross-scope consistency" note below for the measured before and
after, and
`docs/superpowers/plans/2026-09-12-health-score-scope-driver-parity.md`
for the per-driver decisions.

**v4.0 (2026-08-25): the Outcomes dimension gains `dq_digital_competency`.**

KKU's Digital Intelligence (DQ) test is a competency instrument every
undergraduate sits. How a programme's students score is evidence of what
that programme develops in them, so it joins the Outcomes dimension as a
sixth driver, sourced from the `dq_module_cube` / `dq_student_cube` cubes
written by the `kku-dq` connector.

**What it measures.** The respondent-weighted mean across **theory
modules 1–12**, computed as `SUM(score_sum) / SUM(taken_count)` **at the
scope being scored** — never an average of programme means. The cubes
store sums and counts precisely so a 900-student programme cannot be
weighted the same as a 12-student one; the DQ work measured that error at
0.8 points on module 1 at university scope (86.708 weighted against
87.544 mean-of-means). Faculty and university figures are therefore
computed directly from the cube at that scope, not rolled up from
programme scores.

**Module 13 (Generative AI) is excluded**, for the same reason it is
excluded from the DQ dashboard's Overall column: measured uptake runs
48.7%–96.7% across the faculties with more than 200 scored students,
because the module arrived after most students had already sat the test.
Including it would score a programme on how far the rollout happened to
have reached it rather than on what its students can do. It keeps its own
column, its own radar axis and its own place on the deep-dive, so nothing
is hidden — it is only kept out of the number programmes are compared by.
Revisit when uptake is uniform.

**Eligibility — two gates, both hard:**

- `level = 'BACHELOR'`. DQ is an undergraduate instrument. The 30
  non-bachelor programmes carrying DQ rows hold **ten students between
  them** — undergraduates who sat the test and later enrolled in a
  master's, caught by the current-enrolment join. A score there would
  describe the join, not the programme.
- **≥ 5 scored students** (`DQ_MIN_CELL_STUDENTS`), the same suppression
  floor the DQ dashboard already applies, so one rule governs the whole
  feature. It is deliberately low, and its cost is volatility: a
  five-student mean moves on one student. The mitigation is that the
  driver's `raw` carries `scoredStudents`, and every surface that renders
  the score renders `n` beside it — a thin score is visibly thin rather
  than silently equal to a robust one.

A programme that fails either gate is **never scored `0`** — it has no DQ
evidence, which is not the same as having scored nothing. But the two
gates fail differently, and the difference is visible in
`dataCompletenessPct`:

- **Not applicable → the driver is omitted entirely.** A non-bachelor
  programme carries the six Outcomes drivers it carried at v3.9, not
  seven-with-a-null. DQ is an undergraduate instrument: a doctoral
  programme is not *missing* a DQ score, the question does not apply to
  it. Appending a null would place a driver that can never apply into its
  denominator and report it as having less complete data than before
  purely because an undergraduate instrument exists — measured at 2.4 to
  14.3 points of false loss across all 199 before this was corrected.
  `dataCompletenessPct` is Council-facing (the cockpit bands it at 75/50,
  the deep-dive header prints it, verdict snapshots store it), so this is
  a reported fact, not an internal detail. It is the same distinction the
  deep-dive's Digital-competency section draws between `not-applicable`
  and `no-data`.
- **Applicable but unmeasured → the driver is present with a `null`
  value.** A bachelor programme with no DQ rows, or one under the
  5-student floor, genuinely lacks evidence we would expect to have. Per
  the null-handling rule below it is excluded from the dimension's mean
  **and** counts against `dataCompletenessPct` — which is the honest
  reading: we ought to know this and do not.

Faculty, department and university scopes always carry the driver: they
legitimately contain bachelor programmes, and the level gate is applied
inside the aggregate by the cube's join to `programs`.

**The band, anchored on KKU's own pass mark:**

| raw DQ mean | driver score |
|---|---|
| ≤ 50 | 0 |
| 50 → 70 | 0 → 50 (linear) |
| **70 (pass mark)** | **50** |
| 70 → 90 | 50 → 100 (linear) |
| ≥ 90 | 100 |

Not a raw pass-through: programme means span only 75.1–90.7 (median 85.0,
half of all programmes within 3.8 points of each other) and **no
programme is below the pass mark**, so passing the raw value through would
put every programme in the top quarter of the driver and differentiate
almost nothing — the same failure the DQ radar had against a 0–100 axis.

Not fitted to the observed spread either, which is the more important
choice: a band fitted to today's min and max would move **one programme's
score when a different programme's data changed**, and would shift on
every refresh. Anchoring on 70 fixes the scale to an external, stable,
institutionally-meaningful point and makes the number readable — **50
means the average student just passes**. The lower half of the band is
unused today; it exists so that a genuinely failing programme is visible
rather than clipped at the floor, and so the scale does not have to change
the day one appears.

Chosen as a driver inside Outcomes rather than as a sixth dimension: a
sixth dimension would re-weight the composite for all 301 programmes (each
dimension falling from ⅕ to ⅙) and assert that digital competency ranks
alongside finance and capability. As a driver it moves one dimension, for
bachelor programmes only.

**Measured impact at v4.0 (2026-08-25, all 301 programmes).** 81
programmes receive a driver — the bachelor programmes clearing the
5-student floor; 21 bachelor programmes and all 199 non-bachelor
programmes receive `null`, and no non-bachelor programme receives a value.
The change reconciles exactly: **every programme whose Outcomes score
moved has a DQ driver (81 of 81), and no programme without one moved.**
Outcomes rises for 78 and falls for 3; mean change +3.27 points, median
+3.24, range −1.21 to +13.36. Driver values run 62.8 (raw mean 75.1) to
100 (raw ≥ 90) with a median of 87.4, and no programme sits in the band's
lower half. Composites move by at most 2.67 points. `dataCompletenessPct`
is **unchanged for all 199 non-bachelor programmes** (verified identical
to the v3.9 value, not merely close) and falls only for the 21 bachelor
programmes whose evidence is genuinely absent. The three fallers are
programmes whose other Outcomes drivers already scored above their DQ
result — the driver pulling a strong dimension down slightly is the band
working, not a defect. Old rows stay stamped `health-score.v3.9` — the
version is what keeps them readable.

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
> | **Financial** | Q2: Does it pay for itself? | net_contribution_per_student · revenue_coverage_program_direct · tuition_trend_slope + external-grant award (≤ +10) | `financial_metrics` (REAL via link-financials) · `enrollment_metrics` (REAL) |
> | **Capability** | Q6: Is the teaching team strong + sustainable? | senior_rank_share · publications_per_faculty · retirement_horizon_5y · student_faculty_ratio | `program_faculties` × `faculty_members` (REAL via kku-hr) · `research_outputs` (REAL via kku-research) |
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
| `kku_intake_policy` | Latest intake against this installation's floor. Bachelor is strict: at the floor 50, at twice the floor 100, below it falling linearly to 0 (`breach`). Postgraduate is a watch list: at the floor 60, below it 30 and up (`watch`). **Null when no floor is configured** — never a default | `enrollment_metrics` + the floors on `organization_profile` |

The intake floors are **council policy, not a property of this software**:
each installation sets them at `/admin/organization`, defaulting to 30 for
bachelor and 8 for postgraduate. They were formerly two constants in
`health-score.ts`, copied into `risk-scoring.ts`; both now read
`@kku/shared`'s `intake-policy` module. The driver keeps its historic label
because it is written into stored assessments — renaming it would be a
versioned change, not a tidy-up.

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
| `publications_per_faculty` | `total_research_outputs / total_active_faculty`. 5/year → 100 | `program_faculties` × `research_outputs` (year >= currentYear-3), `realDataWhere()`-filtered — see §"Mixed-source research data" |
| `retirement_horizon_5y` | `100 - (retiring_5y / total × 100)`. Inverted: more retiring soon = lower score | `program_faculties` × `faculty_members.retirementDate` |

#### External grant engagement (`external_grant_engagement`, v5.3)

> **Superseded by v5.4 (2026-10-03).** This driver and its gate were removed;
> external grants are now an award on Financial (see the v5.4 paragraph at the
> top). Kept for the audit trail.

A staff member is *funded* when a `research_service_project_members` row (role
LEAD or CO_INVESTIGATOR) carries their `facultyMemberId` on a project whose
`fiscalYearBe` is in the window, research or academic service, any project type
and status. Staff are the programme's active `ProgramFaculty` rows, the same set
the other capability drivers use. At faculty and university scope the same
formula runs over the **distinct** active staff of the scope's programmes, so a
person teaching in two programmes counts once. `pmu_okr = 'ซ้ำPMU'` is an
external parameter and is ignored.

**Green-history gate (readiness gate 11, enforced in code).** The driver is
computed only when, for `kku-research-services` runs with `status = SUCCEEDED`:
(1) the first success completed at least 30 days ago; (2) at least 25 of the
last 30 Bangkok calendar days have a success; (3) the latest success is within
72 hours. When several conditions fail the reported reason is the first of
`source-not-synced`, `source-stale`, `awaiting-green-history`. The gate is a
pure function of the run timestamps and `now` (`greenHistoryGate` in
`packages/db/src/grant-engagement.ts`) and is cached per process for five
minutes.

**Disclosed undercount.** About 30 % of co-investigator identifiers match no HR
record, so those people can read as unfunded and the share is a **lower bound**.
The driver's `raw` carries the same statement (`lowerBound: true` and a `caveat` string), shown beside the value in the deep-dive.

### Outcomes

| Driver | Formula | Data source | Status |
|---|---|---|---|
| `tcas_min_score_percentile` | KKU's TCAS3 min-score percentile within same-subject peer set | `tcas_admission_stats` | REAL |
| `employment_rate` | `clamp(rate × 100)` | `graduate_outcomes` | REAL (kku-alumni PDF/XLSX intake) |
| `job_relevance` | `clamp(jobRelevanceScore × 100)` — share with "ตรงสาขา" job (program-level only) | `graduate_outcomes` | REAL |
| `average_salary` | Anchored: ฿15k → 0, ฿20k → 40, ฿25k → 70, ฿35k+ → 100 (`(salary − 15_000) / 200`) | `graduate_outcomes` | REAL |
| `further_study_rate` | Sweet-spot scoring: 0% → 50, 5-15% → 100, 30%+ → 30. Both extremes are negative signals (program-level only) | `graduate_outcomes` | REAL |
| `student_satisfaction` (v3.7) | `clamp(((rating − 3.5) / 1.5) × 100)` — weighted-mean rating across the scope's courses' surveyed cells (semesters 1+2, all observed years), anchored linear to [3.5, 5.0]. Captures the ceiling-biased distribution: 87% of cells score ≥ 4.0, so a naive [1, 5] → [0, 100] would compress every program into 75-100. See `docs/methodologies/evaluations.md` §"Score scale" | `evaluation_response_summaries` (POWERBI.EVALUATE_INSTRUCTOR via `kku-evaluations` connector) | REAL |
| `dq_digital_competency` (v4.0) | Respondent-weighted mean over DQ **theory modules 1–12** at the scope being scored (`SUM(score_sum) / SUM(taken_count)`, never a mean of programme means), banded on KKU's pass mark: ≤50 → 0, 70 → 50, ≥90 → 100, linear between. **Bachelor only**, and only with ≥5 scored students; otherwise null, never 0. Module 13 excluded (uneven rollout — uptake 48.7%–96.7% by faculty). See §v4.0 above | `dq_module_cube` + `dq_student_cube` (`kku-dq` connector; `student-dq.v1`) | REAL |

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

## Mixed-source research data

*Added 2026-09-08, when the Google Scholar on-demand fetch shipped. No version
bump — see "Does this bump `HEALTH_SCORE_VERSION`?" below.*

### The problem

`research_outputs` now has two writers.

| Writer | `source` | Trigger | Coverage |
|---|---|---|---|
| Library pipeline (`kku-research`) | `kku-publications:scopus` (64,294), `openalex` (57,444), `kku-publications:pubmed` (44,730) | Scheduled connector run | Everybody, uniformly |
| Google Scholar runner | `google-scholar` | **On demand** — a person, or an administrator acting for them, presses a button | Only whoever pressed it |

The second row is the whole difficulty. A faculty where three people ran the
import looks stronger than a faculty where nobody did, and **nothing about the
underlying research changed**. The distortion is not noise around a true value;
it is systematically upward, it lands on whoever is most engaged with the tool,
and it arrives between two Council meetings with no ingestion run to point at.

Two further asymmetries make it worse than a simple coverage gap:

1. **Scholar counts run higher than the library mirror, per person.** Scholar
   indexes preprints, theses, book chapters, working papers, conference
   abstracts and non-indexed regional venues; Scopus and PubMed do not. The
   gap is largest in the disciplines whose output is least journal-shaped —
   education, humanities, agricultural extension. **The size of the gap at KKU
   is not yet measured**: no staff member had run the import when this was
   written, so there is no paired Scholar-vs-mirror sample to quote. Measure it
   before anyone quotes a multiplier — including this document.
2. **Citation counts are not comparable either.** Scholar's citation graph
   includes citing documents Scopus excludes, so a Scholar-refreshed citation
   figure sitting in the same column as a Scopus one is a different
   measurement wearing the same label.

### What we do about it

**We state it. We do not correct for it in code.**

There is no defensible normalisation. A per-discipline "Scholar inflation
factor" would be a number invented to make two incomparable measurements agree,
and the moment it entered the health score it would be indistinguishable from a
real finding — a program's capability score would move because of a coefficient
nobody outside this file could interrogate. Suppressing Scholar rows from
Council views would be worse still: it would discard data a member of staff
supplied about their own work, on the grounds that too few of their colleagues
had done the same.

So the instrument is disclosure. Every Council-facing research roll-up carries,
in its provenance drawer, a **source-composition** statement:

> Google Scholar: **N of M** staff, **P of Q** papers.
> Staff counted out of *staff on this roster with at least one publication on
> file, from any source*.
> This figure includes Google Scholar records / excludes Google Scholar rows.

Both ratios are shown because they routinely disagree: one prolific importer
in a large roster is a small staff ratio and a large paper ratio, and it is
the paper ratio that says how much the figure moved.

`source` is nullable on `research_outputs` and the code treats a null as
library — the Scholar runner always stamps its own. **No row is actually null
today** (measured 2026-09-08: 64,294 + 57,444 + 44,730 across three sources,
zero null); the branch exists because the column permits it, not because a
legacy population is known to be there.

### The denominator, fixed

`M` is **staff in the set with at least one publication on file, from any
source**. This is `RESEARCH_COMPOSITION_DENOMINATOR` in
`packages/db/src/research-source-composition.ts`; it is carried alongside the
numbers so the drawer renders it verbatim and the two cannot drift apart.

The two rejected alternatives, and why:

- *Everyone in scope.* Most of a faculty's roster has no papers at all, so the
  ratio would report roster size more than it reported the mix.
- *Everyone with a `FacultyMember` row.* The 2026-05-07 `kkupub_*` backfill
  added 1,375 rows for people who publish but do not teach, and 419 of those
  are flagged inactive. The denominator would be dominated by a bookkeeping
  decision.

A staff member with no publications cannot shift the source mix, so they do not
belong in a ratio about the source mix. A ratio whose denominator is ambiguous
is worse than no ratio, which is why the denominator is rendered rather than
assumed.

### Which figures actually contain Scholar rows

Not all of them, and this is the part most likely to be misread.

`realDataWhere()` (`packages/db/src/data-quality.ts`) is STRICT: it requires a
non-null `ingestion_run_id` joining to a non-mocked `data_sources` row. The
Scholar runner writes `research_outputs` rows through
`packages/db/src/scholar-fetch.ts` **without an `ingestionRunId`** — it is not a
connector run, and inventing one would falsify provenance. So every roll-up
that filters through `realDataWhere()` / `realDataSql()` excludes Scholar rows
outright:

Enumerate CONSUMERS of the figure, not analysis modules. `programFaculty().
totalPublications` is one computation with four renderings, three of which
leave the building.

| Surface | Filter | Contains Scholar rows |
|---|---|---|
| `publications_per_faculty` (this metric, program + rollup scopes) | `realDataWhere()` | **No** |
| Research expertise (`program-research-expertise.v1`) | `realDataWhere()` | **No** — but see §"Excluding the rows does not exclude the effect" |
| Research-expertise readiness / distinct paper count | `realDataSql('ro')` | **No** |
| AI research presence (deep-dive) | `realDataWhere()` | **No** |
| Curriculum revision advice | derived from research expertise | **No** — same footnote as research expertise |
| Deep-dive **Publications** card (`programFaculty().totalPublications`) | none | **Yes** |
| Print view, faculty-capability tile (`programs/[id]/print`) | none — same figure | **Yes** |
| **AUN-QA evidence pack**, "Publications on record" (`aunqa-evidence.ts` → `teaching-learning/[programId]`) | none — same figure | **Yes** |
| Gotenberg `program-detail` PDF, faculty KPI (`program-detail-data.ts` builds `faculty.kpis`) | none — same figure | **Yes, in the payload — but see below** |
| Gap-analysis staff-research lens (`gap-lenses.ts`) | none | **Yes** |
| Benchmarking `researchOutputGap` | hard-coded `null` | n/a |

The print view and the AUN-QA pack are the two that matter most, and they were
the easiest to miss because they are read **away from any screen that could
explain them**. An assessor reads "Publications on record" in an accreditation
pack as an audited figure. Neither has a provenance drawer to open, so each
prints the disclosure sentence itself — `scholarDisclosureLine()` in
`@kku/shared/scholar/disclosure`, the same wording the drawer shows, returning
`null` when there is genuinely nothing to disclose so the ordinary case stays
quiet.

> **The Gotenberg row is a payload, not a rendering.**
> `program-detail-data.ts` builds `faculty.kpis`, but
> `packages/pdf-templates/.../sections/faculty.tsx` never reads it — that
> section renders only `rankDistribution` and the three senior-rank
> aggregates. Verified 2026-09-08: `.kpis` has **zero** references anywhere in
> `packages/pdf-templates/src`. So the unfiltered publications figure does not
> currently reach the PDF at all, and there is no exposure there today. The
> disclosure was wired into the payload anyway, because the alternative is a
> figure that becomes wrong the day somebody renders it. The same pass
> corrected its label from "Publications (3 yr)" to "Publications (all
> years)" — `totalPublications` sums every row on the roster; the 3-year
> window belongs to the `publications_per_faculty` health driver, which is a
> different number computed elsewhere.

What the `program-detail` PDF **does** render, and what is therefore wired
there, is the citation-weighted pair: the **Research expertise** and
**Curriculum revision** sections both carry a `caveats` list, and both now
receive the citation-effect sentence described below.

### Excluding the rows does not exclude the effect

A surface that filters Scholar-sourced rows out is **not** insulated from a
Scholar import, and a drawer that says only "excludes Google Scholar" is
row-accurate and reader-wrong.

`applyMergePlan` (`packages/db/src/scholar-fetch.ts`) does two things. It
inserts papers the library does not have — those are the `google-scholar`
rows, and the filters do exclude them. It also **raises the citation count on
existing library rows it matched**, stamping `scholar_paper_id` and leaving
`source` and `ingestion_run_id` alone. Those rows keep passing
`realDataWhere()`.

`program-research-expertise.scoreOf()` is citation-weighted:
`recency × log2(citations + 2) × quartileBoost`. So:

> A professor imports her profile. Her most-cited paper goes from a Scopus 40
> to a Scholar 210 — `log2(42) = 5.39` becomes `log2(212) = 7.73`, a 43% score
> increase on that paper. It displaces another group's paper out of
> `topPapers`, and the AI theme narrative shifts. All of this happens on the
> surface whose provenance drawer says Scholar is excluded.

The disclosure therefore has two shapes, chosen at the call site because only
the call site knows whether its figure is citation-weighted
(`ScholarFigureKind` in `@kku/shared/scholar/disclosure`):

- `counts-scholar-rows` — the figure counts Scholar rows; the caveat states
  the upward distortion.
- `excludes-rows-citation-weighted` — the figure excludes Scholar rows and
  weights papers by citations; the caveat says the exclusion is of rows, not
  of the effect, and quantifies it from
  `libraryPapersTouchedByScholar` (library rows carrying a `scholar_paper_id`).

That count is part of the composition precisely so this is a measurement
rather than a warning about something hypothetical. It is 0 across the whole
database today.

This split is **not** a designed feature; it is what the code does today, and it
is recorded here rather than quietly repaired because changing either half
would move Council numbers without a methodology review. Two coherent futures
exist — stamp Scholar imports with a synthetic ingestion run so every surface
sees them, or filter the two unfiltered surfaces so no surface does — and
picking one is a decision for whoever next revises this document, not a side
effect of shipping the fetch button. Until then the provenance drawer's
`countedInFigure` flag says, per surface, which side of the line the reader is
on.

### Does this bump `HEALTH_SCORE_VERSION`?

**No.** A Google Scholar coverage change does not move the version. (The
version did later move to `health-score.v5.0`, for an unrelated reason —
the scope driver-parity fix, which *is* a formula change. The reasoning
below is about coverage, and still applies.)

The case *for* bumping is real and worth stating: the score's inputs can now
change without any formula change, purely because someone pressed a button, so
two `v4.0` scores computed a month apart may not be comparable. If the version
is meant to answer "can I compare these two numbers", it should move.

It does not move, for four reasons.

1. **The version identifies the formula, and the formula is unchanged.** The
   "Version bumping" section below scopes a bump to weights, dimensions,
   null-handling and completeness thresholds. Every historical bump in
   `health-score.ts` — v3.5 `revenue_scale`, v3.6 `pedagogical_fit`, v3.7
   `student_satisfaction`, v3.9 financial-year selection, v4.0
   `dq_digital_competency` — is a formula change. None is a data-source change.
2. **Precedent, and the cost of breaking it.** The `kku-research` connector
   pivoted from OpenAlex to the kku-publications mirror on 2026-05-07 and the
   underlying corpus went from 57,444 to 81,237 rows — a far larger movement in
   this exact driver than Scholar will plausibly produce — with no version bump.
   If a data-source change bumps the version, the version stops meaning
   "formula" and every stored `methodologyVersion` stamp becomes ambiguous
   about which kind of change it recorded.
3. **A bump would not do the job anyway.** A version is a one-time event;
   Scholar coverage changes every time anyone presses the button. No static
   version string can encode how much Scholar is in a particular number. The
   per-read, per-scope composition ratio can, and does.
4. **`publications_per_faculty` does not contain Scholar rows today** (see the
   table above). Bumping a formula version for a source the formula filters out
   would be actively misleading.

If the `realDataWhere()` split is ever resolved in the direction of letting
Scholar rows into the score, that *is* a methodology change and it bumps the
version at that point.


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

> **Superseded by v5.4 (2026-10-03).** The grant driver no longer exists; the
> award never creates or lowers a score.

**External grant engagement (v5.3) follows the same rule, with one distinction:**
a staff team with no grant is a real 0 (the source view covers all external
grants, so absence means no grant), whereas a closed gate (source not synced,
stale, or under 30 days of green history) is null and the driver is left out of
the Capability mean.

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
- **Cross-scope consistency not asserted.** A faculty's composite score
  is NOT mathematically guaranteed to equal the weighted average of its
  programmes' composites — each is computed at its own scope.

  This caveat was materially understated before `health-score.v5.0`. The
  scope scorers had drifted 2-4 drivers behind the programme scorers
  since v3.0, so the gap was not "typically small" but large and
  one-sided: measured 2026-09-12, **all 24 faculties scored BELOW their
  programme mean**, by 11.6 pts on average and up to 28.5. The relevance
  dimension alone ran -56.4, because two of its drivers were hardcoded
  to null at scope level and a third was never implemented there.
  Capability — the one dimension already carrying the same drivers at
  both scopes — was also the only one that agreed, at +0.4.

  v5.0 brings the driver sets to parity. Drivers whose calibration is
  per-programme (absolute THB/yr slopes, per-level revenue targets,
  intake floors, peer-subject percentiles) roll up as the mean of their
  programme values. Drivers whose scale is scope-invariant stay
  ratio-of-sums. After the change 1 of 24 faculties exceeds a 10-pt
  divergence, the mean gap is ~3.9, and the direction is no longer
  uniform — 7 faculties now score above their bottom-up mean.

  **The residual divergence is intended and should not be driven to
  zero.** Ratio-of-sums weights by programme size: a faculty whose total
  tuition covers 61.7% of its total cost reads exactly that, even where
  the mean of its per-programme coverage ratios reads 80.0, because a
  7-student programme should not count as much as a 700-student one.

  Run `pnpm consistency:check` for the current per-faculty position; it
  writes `CrossScopeDivergenceSnapshot` rows so the trend is visible over
  time. Snapshots written before v5.0 describe the old methodology and
  carry the bundle tag that says so.

## Sanity checks the scoring service enforces at compute time

- Every score output clamped to [0, 100].
- `dataCompletenessPct` ∈ [0, 100].
- If every underlying metric is null, returns `null` — never 0.
- `methodologyVersion` stamped on every returned row.
