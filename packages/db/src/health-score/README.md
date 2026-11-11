# Health score

Five dimensions and an overall composite, each 0–100 where 100 is healthy.
The methodology (what each driver means and why) is
`docs/methodologies/health-score.md`. This folder is how it is computed.

## Changing a number → `tuning.ts`

Every threshold, curve point, weight and target that turns a raw figure into
a driver score is in `tuning.ts`, grouped by dimension and named after the
driver label you see in the app. Most adaptations touch only that file.

When you change it:

1. Set or bump `INSTITUTION_REVISION` in `tuning.ts` (e.g. `'kmutt.1'`). Every
   score your installation computes is then stamped
   `health-score.v5.6+kmutt.1`, so it can't be mistaken for an upstream score.
2. Run `pnpm --filter @kku/db test health-score-tuning-pin`. It fails and
   prints the fingerprint to pin for your new version. Add that line to
   `PINNED` in `packages/db/test/health-score-tuning-pin.test.ts`.
3. Update the anchors in `packages/db/test/health-score-curves.test.ts` if you
   changed a curve.
4. Record the change in your copy of `docs/methodologies/health-score.md`.

Settings that need no code at all: intake floors and the institution's region
(organisation profile), and each faculty's teaching-mode band for the
student–staff ratio (faculty settings). All three are in the admin UI.

## Changing how a driver is computed → the dimension file

| Dimension | File | Drivers |
|---|---|---|
| Attractiveness | `attractiveness.ts` | `tcas_competition_ratio`, `tcas_fill_rate`, `tcas_registration_yield`, `tcas_competition_vs_peers`, `enrollment_trend_slope`, `kku_intake_policy` |
| Financial | `financial.ts` | `net_contribution_per_student`, `revenue_coverage_program_direct`, `revenue_coverage_ratio`, `net_contribution_per_program`, `tuition_trend_slope`, `revenue_scale`, plus the grant award |
| Capability | `capability.ts` | `senior_rank_share`, `publications_per_faculty`, `retirement_horizon_5y`, `student_faculty_ratio` |
| Outcomes | `outcomes.ts` | `tcas_min_score_percentile`, `employment_rate`, `job_relevance`, `average_salary`, `further_study_rate`, `student_satisfaction`, `dq_digital_competency` |
| Relevance | `relevance.ts` | `labour_market_alignment`, `demand_match_filled`, `demographic_resilience`, `strategic_sector_alignment`, `pedagogical_fit`, `jobthai_demand_alignment` |

Each dimension file has two scorers: `score<Dimension>Program` (one programme)
and `score<Dimension>Scope` (a faculty, department or the university). **Change
both.** At scope level many drivers are the mean of the programme values
(`rolledUpDriver`), and the parity test fails if the two scorers drift apart.

Adding or removing a driver also means editing `DIMENSION_DRIVERS` in
`drivers.ts`. A logic change needs a new `INSTITUTION_REVISION`, just like a
number change. The pin test cannot detect a logic change, so check for it in
review.

## The rest of the folder

| File | What it does |
|---|---|
| `index.ts` | Public exports; import from `@kku/db`, not from the files |
| `compute.ts` | `computeHealthScores` — runs the five scorers for every child of a scope |
| `version.ts` | The stamped methodology version and its change history |
| `curves.ts` | Pure score curves (no database), tested in `health-score-curves.test.ts` |
| `summarise.ts` | Drivers → dimension score (null rule, completeness, weighted pair); dimensions → overall |
| `drivers.ts` | The canonical driver list per dimension |
| `schema.ts` | Zod schemas for a score and a row |
| `series.ts` | Trend helpers: partial-year drop, in-progress-year exclusion, slope |
| `scope-tree.ts` | Which programmes and child rows sit under a scope |
| `program-index.ts` | Every programme scored once (memoised) for roll-ups and radar averages |
| `relevance-inputs.ts` | LinkedIn skill alignment and the 10-year cohort share |
| `subject-signature.ts` | Thai programme-name key used to find TCAS peer programmes |
| `intake-policy.ts` | Intake-floor verdict helper for the app's badges |
