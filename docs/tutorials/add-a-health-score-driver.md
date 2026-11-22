# Tutorial: add a health-score driver

> **ภาษาไทย:** มีฉบับภาษาไทยของหน้านี้ที่ [ฉบับภาษาไทย](../th/tutorials/add-a-health-score-driver.md)

**Outcome.** A new driver, `employer_satisfaction`, is computed from the
Employer Feedback dataset you already load. It shows in the Outcomes drawer of
the Program Deep-Dive with its year, respondents and mean, it rolls up to
faculty and university scope, every score carries your own methodology
version, and the health-score tests pass.

**Starting point.** A running dev stack with a mock university loaded
(`pnpm workshop:mock`, uploaded on `/admin/data-setup`), including the
Employer Feedback sheet. Check it: open any programme's Deep-Dive and look for
the Top employers list. Every command below runs from the repository root.

**Time.** About 80 minutes. No AI spend.

The same seven edits work for any dataset your institution already loads. The
folder map behind them is `packages/db/src/health-score/README.md`; keep it
open in another tab.

## Before you start

Work on a practice branch. The anchors below (0.60 and 0.95) are invented for
this tutorial, and the revision `workshop.1` must never reach a production
installation. When you do this for real, pick anchors from your own data and
use your own revision prefix (Step 6).

Answer one question first: the Deep-Dive already shows employer satisfaction,
so does it change the health score? It does not. The Employer Feedback sheet
only feeds the Top employers list; no health-score driver reads it. This
tutorial makes it a driver, in the Outcomes dimension: it judges graduates,
like `employment_rate` and `job_relevance`. Relevance asks a different
question (does the curriculum match demand).

## How a driver works

A driver turns dataset rows into one score from 0 to 100, or null.

| Stage | What happens | Where |
|---|---|---|
| 1. Rows | Only uploaded, real rows count: every query spreads `...realDataWhere()` | the dimension file |
| 2. Raw figure | The figure you compute, with its year and sample size | the driver's `raw` field, shown in the Deep-Dive drawer |
| 3. Curve | Two anchors: at or below the lower one scores 0, at or above the upper one scores 100, linear between | `tuning.ts` |
| 4. Driver | A number from 0 to 100, or null when the data cannot support a verdict | `{ label, value, raw }` |

A dimension's score is the mean of its **non-null** drivers. The overall score
is the mean of the five dimensions.

### The driver object

Every driver returns the same shape, defined by the Zod schema in
`packages/db/src/health-score/schema.ts`:

```ts
drivers: z.array(
  z.object({
    label: z.string(),
    value: z.number().min(0).max(100).nullable(),
    raw: z.unknown(),
  }),
),

// HealthScore['drivers'][number] =
//   { label: string; value: number | null; raw: unknown }
```

| Key | Meaning |
|---|---|
| `label` | Must match an entry in `DIMENSION_DRIVERS`, or the driver counts as not computed |
| `value` | The 0–100 score after the curve. `null` means no data: left out of the mean, never counted as 0 |
| `raw` | Evidence for the drawer: year, respondents, mean, and a `reason` when `value` is null |

The type does not check the 0–100 range or the label spelling. Call `clamp()`
and copy the label from `drivers.ts`. A misspelt label such as
`employer_satisfication` passes the typecheck, but the driver drops out of
Outcomes and completeness falls.

### The null rule

Suppose a programme has no employer survey yet. Should the driver score 0, or
not count at all?

| | `employment_rate` | `student_satisfaction` | `employer_satisfaction` | Outcomes |
|---|---|---|---|---|
| A: score it 0 | 80 | 70 | 0 | 50 |
| B: leave it out | 80 | 70 | null | 75, completeness 67% |

B is the rule. Card A docks the programme 25 points for a survey nobody ran, and
a Council member reads it as "employers are unhappy with our graduates". Card B
leaves the driver out of the mean, and the drop in completeness tells the
reader what is missing. A driver returns null with a reason in `raw`, never 0
and never 50.

## The seven edits

All paths are under `packages/db/src/` unless they say otherwise.

| Step | File | What you change |
|---|---|---|
| 2 | `health-score/drivers.ts` | Register the label |
| 3 | `health-score/tuning.ts` | Put every number in one place |
| 4 | `health-score/outcomes.ts`, `scoreOutcomesProgram` | Compute it for one programme |
| 5 | `health-score/outcomes.ts`, `scoreOutcomesScope` | Roll it up to faculty and university |
| 6 | `health-score/tuning.ts`, `INSTITUTION_REVISION` | Stamp a new methodology version |
| 7 | `packages/db/test/` | Pin, parity and checklist tests |
| 8 | `program-setup-checklist.ts`, the docs site, the methodology | Say where the figure comes from |

Steps 4 and 5 are in the same dimension file. Every dimension has a programme
scorer and a scope scorer, and you change both. Before v5.0 the scope scorers
lagged by two to four drivers, which put every faculty about 12 points below
its own programmes; the parity test now catches that.

## Step 1: Design the driver on paper

Write a driver card before any code. The Employer Feedback sheet
(`employer-feedback` in [Importing from spreadsheets](../data-import.md)) has
these columns:

| Programme Code | Survey Year | Employer | Satisfaction (0–1) | Respondents |
|---|---|---|---|---|
| ENG-ME-BSC | 2024 | blank = All employers | 0.87 | 12 |

One row per programme, survey year and employer, or one row with Employer
blank meaning all employers together. The import refuses rows with fewer than
5 respondents.

Fill in six lines: the label, the dimension, which rows make the raw figure,
which value scores 0 and which scores 100, when it is null, and how a faculty
rolls up. Then compare with this card:

| Line | Our answer |
|---|---|
| Label | `employer_satisfaction` |
| Dimension | Outcomes, next to `employment_rate` and `job_relevance` |
| Raw figure | The latest survey year. Use the "All employers" row when there is one; otherwise the respondent-weighted mean of that year's rows |
| Curve | 0.60 → 0, 0.95 → 100, linear |
| Null when | No survey, or fewer than 10 respondents |
| Faculty roll-up | The mean of the programme driver values |

Why each line:

- **Latest year only**, so a good past survey cannot hide a bad recent one.
- **The All employers row wins.** When the institution supplies an overall
  figure, trust it rather than rebuilding it from an incomplete employer list.
- **Respondent-weighted**, so an employer with 5 respondents does not weigh the
  same as one with 40.
- **Anchors 0.60 and 0.95** are invented for this tutorial. For real, look at
  your institution's distribution and place them so programmes separate.
- **At least 10 respondents.** The import already refuses fewer than 5, for
  privacy; 10 is the threshold for a stable score.
- **Mean of programme values at faculty level.** Programmes survey in different
  years. Pooling raw rows would mix years; averaging programme values keeps each
  programme's own calibration.

No card is the single right one, but every line must be defensible in front of
the University Council.

## Step 2: Register the label

In `packages/db/src/health-score/drivers.ts`, add the label to the Outcomes
list of `DIMENSION_DRIVERS`:

```ts
export const DIMENSION_DRIVERS = {
  // …attractiveness, financial, capability…
  outcomes: [
    'tcas_min_score_percentile',
    'employment_rate',
    'job_relevance',
    'average_salary',
    'further_study_rate',
    'student_satisfaction',
    'dq_digital_competency',
    'employer_satisfaction', // new
  ],
```

This list is the registry. `summariseDrivers` pads any label a scorer did not
build with a null marked "not computed at this scope" and counts it against
completeness. So if you stop here nothing breaks: Outcomes simply reports one
more missing driver. A scorer you forget to update shows up as lower
completeness instead of vanishing silently.

You should see the label in the list. Copy and paste it from here on: Steps 4,
5 and 8 use the same string.

## Step 3: Put the numbers in tuning.ts

In `packages/db/src/health-score/tuning.ts`, inside the `outcomes` block, add:

```ts
  outcomes: {
    // …tcasPercentileMinPeers, averageSalary, furtherStudy…
    studentSatisfaction: { zeroAtRating: 3.5, fullAtRating: 5.0 },
    /** `employer_satisfaction` — employer satisfaction (0–1), latest
     *  survey year. zeroAt → 0, fullAt → 100, linear.
     *  Null under minRespondents. */
    employerSatisfaction: { zeroAt: 0.6, fullAt: 0.95, minRespondents: 10 },
  },
```

Every number that turns a raw figure into a score lives in `tuning.ts`, grouped
by dimension and named after the driver. Never hard-code a threshold in a
scorer: an adopter tunes numbers here without reading scorer code, and the
tuning-pin test fingerprints this object so any change is caught. The block is
declared `as const`, so the new key is typed automatically.

Choosing anchors: `student_satisfaction` uses 3.5 to 5.0 rather than 1 to 5
because 95% of ratings sit in that band; 1 to 5 would put every programme
between 75 and 100. Ask the same of your data: query `satisfaction_score` per
programme and place the anchors where they separate programmes.

## Step 4: Compute the driver for one programme

Open `packages/db/src/health-score/outcomes.ts`. It already imports `prisma`,
`realDataWhere`, `HealthScore`, `clamp` and `T` (`HEALTH_SCORE_TUNING.outcomes`).

1. Add the import at the top, with the others:

   ```ts
   import { ALL_EMPLOYERS } from '../import/datasets/employer-feedback';
   ```

2. Add the function near `studentSatisfactionDriver`. First read the rows and
   pick the latest survey:

   ```ts
   async function employerSatisfactionDriver(
     programId: string,
   ): Promise<HealthScore['drivers'][number]> {
     const label = 'employer_satisfaction';
     const rows = await prisma.employerFeedback.findMany({
       where: { programId, ...realDataWhere() },
       orderBy: { year: 'desc' },
     });
     const year = rows[0]?.year ?? null;
     const latest = rows.filter((r) => r.year === year);
     const all = latest.find((r) => r.employerName === ALL_EMPLOYERS);
     const used = all ? [all] : latest;
   ```

   - `realDataWhere()` keeps only rows whose ingestion run came from a
     non-mock data source. Without it, seed or mock data reaches figures shown
     to the Council. The Employer Feedback import tags every row with its run,
     so uploaded rows pass.
   - Sorting by `year` descending makes `rows[0]` the latest survey.
   - `ALL_EMPLOYERS` is the constant the import writes when Employer is blank.
     Use it rather than typing the string.

3. Then write the null case, and only then the score:

   ```ts
     const n = used.reduce((s, r) => s + r.sampleSize, 0);
     if (n < T.employerSatisfaction.minRespondents) {
       const reason = n === 0 ? 'no-survey' : 'too-few-respondents';
       return { label, value: null, raw: { year, respondents: n, reason } };
     }
     const mean = used.reduce((s, r) => s + r.satisfactionScore * r.sampleSize, 0) / n;
     const { zeroAt, fullAt } = T.employerSatisfaction;
     const value = clamp(((mean - zeroAt) / (fullAt - zeroAt)) * 100);
     const basis = all ? 'all-employers' : 'respondent-weighted';
     return { label, value, raw: { year, respondents: n, mean, basis } };
   }
   ```

   The reason string goes into `raw`, where the Setup checklist and the
   Deep-Dive drawer show it, so an administrator can tell "no survey uploaded"
   from "too few respondents". Everything a reader needs to check the number
   goes into `raw` too.

4. Call it from `scoreOutcomesProgram`, in the `drivers` array after
   `studentSatisfactionDriver`:

   ```ts
       await employerSatisfactionDriver(programId), // new
   ```

   Order in the array does not matter: `summariseDrivers` sorts by the order in
   `drivers.ts`.

Run `pnpm typecheck` now if you have time; it catches a misspelt field name.

## Step 5: Roll it up to faculty and university

Programmes in a faculty survey in different years, so a faculty cannot pool
raw rows. It takes the mean of its programmes' driver values instead. In
`scoreOutcomesScope`, `programIds` and `index` are already declared above the
existing `drivers.push`. Add one line:

```ts
drivers.push(
  rolledUpDriver(index, programIds, 'outcomes', 'job_relevance'),
  rolledUpDriver(index, programIds, 'outcomes', 'further_study_rate'),
  rolledUpDriver(index, programIds, 'outcomes', 'tcas_min_score_percentile'),
  rolledUpDriver(index, programIds, 'outcomes', 'employer_satisfaction'), // new
);
```

`rolledUpDriver(index, programIds, dimension, label)` reads the memoised
programme scores and averages the non-null values; with none it returns null.

Pooling (a ratio of sums) is right for a driver that scales the same way at
every level, such as a plain proportion. It is wrong here: each programme picks
its own latest year, and pooling would mix a 2022 survey with a 2025 one. The
rule since v5.0: a driver calibrated per programme rolls up as the mean of its
programme values. Skip this step and the parity test fails, and faculty
completeness drops.

## Step 6: Stamp a new methodology version

A new formula needs a new version. In `packages/db/src/health-score/tuning.ts`:

```ts
// was: = null
export const INSTITUTION_REVISION: string | null = 'workshop.1';
```

Every score computed from now on is stamped `health-score.v5.6+workshop.1`
instead of `health-score.v5.6`.

Adding a driver changes the Outcomes mean and the overall score, so a Council
pack printed yesterday and one printed today must say which formula each used.
The system appends your revision to the upstream version, so your scores can
never be mistaken for KKU's upstream ones.

An adopter changes `INSTITUTION_REVISION` only, never
`UPSTREAM_HEALTH_SCORE_VERSION` in `version.ts`. At your institution use your
own prefix, for example `'kmutt.1'`, and bump it (`kmutt.2`) on every change to
tuning or logic. Never edit a published version in place. See
[Adapt a methodology to your institution](../guides/adapt-a-methodology.md).

## Step 7: Run the tests and fix each red line

```bash
pnpm --filter @kku/db test health-score
pnpm --filter @kku/db test program-setup-checklist
pnpm --filter @kku/db test deep-dive-data-map-doc
```

The `health-score` filter picks up every `health-score*.test.ts`. Expect some of
these failures; read the actual message, which can differ by branch:

| Failing test | Cause | Fix |
|---|---|---|
| `health-score-tuning-pin` | Tuning changed but `workshop.1` is not pinned | Copy the fingerprint the test prints into `PINNED` in `packages/db/test/health-score-tuning-pin.test.ts`; keep the existing lines |
| `health-score-driver-parity`, `health-score` | The Prisma mock has no `employerFeedback`, so it throws `Cannot read properties of undefined (reading 'findMany')` | See below |
| `program-setup-checklist` | The new label has no data source | Step 8a |
| `deep-dive-data-map-doc` | The docs-site data map does not list the new driver | Step 8b |

For the Prisma mock, in each failing test file:

1. In the `vi.hoisted` mocks, add `employerFeedbackFindMany: vi.fn()`.
2. In the `prisma` mock, add
   `employerFeedback: { findMany: mocks.employerFeedbackFindMany }`.
3. In `beforeEach`, add `mocks.employerFeedbackFindMany.mockResolvedValue([])`.

Then write one test of your own:

- Mock two rows from the same year: satisfaction 0.8 with 10 respondents, and
  0.9 with 30. Assert that `raw.mean` is 0.875 and `value` is about 78.6
  (`(0.875 − 0.60) / 0.35 × 100`).
- Mock `[]`. Assert that `value` is null and `raw.reason` is `'no-survey'`.

Compare the number of test files and tests before and after, not just the pass
line: a narrowed vitest `include` drops tests silently.

## Step 8: Say where the figure comes from

**a. The Setup checklist.** In `packages/db/src/program-setup-checklist.ts`,
add a row next to `driver.student_satisfaction`:

```ts
'driver.employer_satisfaction': [ds('employer-feedback', 'Employer feedback')],
```

The checklist (`/admin/programs/<id>?tab=checklist`) has one row per driver and
tells an administrator what to upload. `'employer-feedback'` is the dataset
slug, so the row links to the right upload.

**b. The Deep-Dive data map.** In
`apps/docs-site/.vitepress/theme/deep-dive-data-map/data.ts`, add a row next to
`student_satisfaction`:

```ts
{ dimension: 'outcomes', key: 'employer_satisfaction', name: 'Employer satisfaction',
  how: 'Respondent-weighted employer satisfaction: 0.60 gives 0, 0.95 gives 100.',
  in: ['employer'] },
```

`'employer'` is the id of the Employer feedback sheet, already declared in that
file.

**c. The methodology.** In your copy of `docs/methodologies/health-score.md`,
add a short section for `+workshop.1`: the formula, the anchors and why, when
it is null, and the roll-up rule. This page is the version of record shown to
the Council. The project rule is to write the methodology first when a formula
changes; this tutorial writes it last so you see the code first. Then run:

```bash
pnpm docs:build
```

It fails on a dead link.

Run the three test commands from Step 7 again. All should pass.

## Step 9: Check it in the app

1. **Restart the api.** `nest start --watch` only watches `apps/api/src`, and
   every edit here is under `packages/db`, so a running api still has the old
   code. Stop and start `pnpm dev` (or just the api). The restart also clears the
   memoised programme score index that `rolledUpDriver` reads.
2. **Deep-Dive.** Open a programme that has Employer Feedback rows (its Top
   employers list is not empty). In the Outcomes drawer you should see
   `employer_satisfaction` with a value, and `raw` showing year, respondents,
   mean and basis.
3. **A programme with no employer data.** The driver is null with reason
   `no-survey`, and Outcomes completeness drops accordingly.
4. **Setup checklist.** On `/admin/programs/<id>?tab=checklist` the driver row is
   green, or shows the null reason.
5. **Faculty scope.** Switch the scope selector to that programme's faculty. The
   driver has a value, not "not computed".

## When the driver does not show

| What you see | Cause | Fix |
|---|---|---|
| You changed code and nothing changed | The api still runs the old `packages/` code | Restart the api and check the process start time |
| The driver is missing and Outcomes completeness dropped | The label is registered but no scorer builds it | Step 4, part 4: add the call to the `drivers` array |
| Null `no-survey` although the sheet is uploaded | The rows do not count as real data | Run `pnpm data-sources:sync --apply`, then upload again |
| Faculty scope shows "not computed" | The scope scorer has no roll-up | Step 5: the `rolledUpDriver` line |
| Every programme scores about the same | The anchors sit outside your data's spread | Pick new anchors in `tuning.ts` and bump the revision |

The third row is the silent-empty-UI trap: `realDataWhere()` counts only rows
whose ingestion run came from a data source with `mocked = false`, and every
XLSX dataset needs its catalogue entry (here `xlsx-employer-feedback`).
`pnpm data-sources:sync --apply` repairs a dev database that has drifted from the
catalogue.

For the fifth row: if every programme's satisfaction sits between 0.85 and
0.95, the 0.60–0.95 anchors squeeze them all into the top third. Query the
distribution, move the anchors, and bump `INSTITUTION_REVISION`, because the
formula changed.

## Your exercise: your next driver

A driver is one query, one curve and an honest null. The other edits (registry,
scope roll-up, version, tests, checklist, docs) make it safe and visible.

Pick a dataset your institution already loads, from the 26 import datasets
(for example class offerings, cohorts, compensation, staff salary by funding or
external grants), and fill in a driver card: the dataset, the label and
dimension, and when it is null. Then repeat Steps 2–9 with your own revision
prefix and anchors taken from your own data.

## Next step

- [Adapt a methodology to your institution](../guides/adapt-a-methodology.md)
  for the rules on versions, docs and the null rule.
- [Importing from spreadsheets](../data-import.md) for what each dataset holds.
- The health-score methodology, `docs/methodologies/health-score.md`, and the
  folder map, `packages/db/src/health-score/README.md`.
