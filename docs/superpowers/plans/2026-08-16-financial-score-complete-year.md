# Score the financial dimension on the last COMPLETE academic year

> Date: 2026-08-16 · Status: plan, not yet implemented
> Raised by the user: the current year's tuition is still being collected, so scoring on it
> understates every affected program.

## FIRST — a naming hazard that has to be stated before anything else

In Thailand these are **different periods**:

- **Fiscal year** — 1 Oct to 30 Sep
- **Academic year** — ~Jun to May

`FinancialMetric.fiscalYear` is named for the first and **actually contains the second**. Verified in
the connector, not inferred:

| column | actual calendar | written from |
|---|---|---|
| `FinancialMetric.fiscalYear` | **academic** (Jun–May) | `f.ACADYEAR AS COHORT_YEAR_BE` → `kku-finance/connector.ts:79` → `:317`; also `link-program-financials.ts:123` → `:342` |
| `FacultyBudget.fiscalYear` | **fiscal** (Oct–Sep) | `q2.FISCAL_YEAR_BE` → `kku-finance/connector.ts:340` |

The same connector writes both, 23 lines apart, under the same column name. Anyone reading
`fiscalYear` will reasonably assume Oct–Sep and be wrong for tuition and right for budget.

Two pieces of corroboration that this is a naming problem and not a data problem:

- `EnrollmentMetric.academicYear` (`schema.prisma:1311`) already uses the **correct** name for the
  **same** calendar. The two tables describe the same period under different names.
- The materialized views already union `financial_metrics.fiscal_year` with
  `enrollment_metrics.academic_year` onto one `year` axis and join on it
  (`20260505010000_canonical_programs_in_mvs/migration.sql:34, 74, 99`). Every rollup in the product
  therefore *already assumes* these are the same calendar — correctly, but silently.

**This is why the fix below is allowed to use the academic-year calendar** — not because the two
calendars are interchangeable, but because the tuition year genuinely *is* an academic year. Had it
been a true fiscal year, `academic-year.ts` would have been the wrong authority entirely and the rule
would need an Oct–Sep completeness test instead.

Two related observations, recorded rather than silently carried:

- `allocatedFacultyCost` is a **point-in-time salary snapshot** (`SUM(SALARY) FROM EmployeeDetail`,
  `link-program-financials.ts:11-13`) with no year dimension at all — the same figure is written
  against every year row. It is deliberately **excluded from `netContribution`** (`:327-330`, salary
  is government-funded and not netted), so it does not corrupt the score. But it is not a
  year-specific cost and should not be read as one.
- `directCost` is what `netContribution` actually subtracts. Its calendar basis should be confirmed
  before anyone treats `netContribution` as a same-period figure.

## How tuition actually accrues — and why 47% is exactly what it should be

An academic year's tuition **straddles two fiscal years**:

| AY 2026 (Jun 2026 – May 2027) | billed | falls in |
|---|---|---|
| Semester 1 | ~Jun 2026 | **FY2026** (Oct 2025 – Sep 2026) |
| Semester 2 | ~Nov 2026 | **FY2027** (Oct 2026 – Sep 2027) |
| Summer term | ~Apr 2027 | FY2027 |

Today is Aug 2026. AY2026 has therefore billed **only semester 1**, which is why its tuition reads
~47% of AY2025. **That is not an anomaly — it is exactly one semester of two.** A ratio-based
"partial year" test is trying to detect, statistically, something the calendar already tells us
deterministically.

Measured against the 184 programs carrying both AY2025 and AY2026 rows:

| statistic | AY2026 ÷ AY2025 |
|---|---|
| median | **0.437** — one semester of two, as predicted |
| mean | 0.789 — pulled up by outliers |

The median confirms the mechanism. **The gap between median and mean is the argument against any
ratio rule:** a substantial tail of programs already reads near or above 100% of last year while
still being only one semester billed — growing intakes, fee changes, a partial prior year. A
threshold test waves every one of those through as "complete", and no choice of threshold fixes it,
because the ratio simply does not carry the information.

**This also defines when an academic year is revenue-complete:** not when it begins, and not when
recruitment for it closes, but only after its final term has been billed — roughly a **full year
after it starts**. AY2025 (Jun 2025 – May 2026) finished billing by ~Apr 2026 and is complete now;
AY2026 will not be complete until ~mid-2027.

**Consequence for the rule — read this before implementing.**
`AcademicYearContext.latestCompleteEntryYearBE` means *recruitment* is finished, which happens at the
**start** of an academic year. That is roughly a year earlier than *revenue* completeness. Using it
directly would still select a half-billed year. The rule must therefore be expressed in terms of the
in-flight year: **score on the latest academic year strictly before `currentAcademicYearBE`** — i.e.
skip the year currently being taught. Today that yields AY2025, which is fully billed. Encode this
reasoning in the helper's doc comment so nobody later "optimises" it back to the current year once it
looks nearly full in May.

## The problem, measured

`financial_metrics.fiscalYear` holds the **academic** year (see above). The current academic year is
therefore *in flight*, and its tuition row only contains what has been collected so far.

Measured on the dev database today:

| fiscal year | programs with rows | mean tuition |
|---|---|---|
| 2026 | 187 | **2,190,459** |
| 2025 | 241 | 4,632,077 |
| 2024 | 236 | 4,527,120 |

FY2026 is running at **~47% of FY2025** — it is roughly half-collected, exactly as the user
described.

Both scorers already try to skip a partial year, with the same rule in two places:

- `packages/db/src/health-score.ts` — `const PARTIAL = 0.3`
- `packages/db/src/program-deep-dive.ts` — `const PARTIAL_YEAR_RATIO = 0.3`

Identical logic, duplicated: *drop the latest year if its tuition is below 30% of the prior year.*

**That threshold is far too lenient.** A half-collected year sits at ~47%, sails past the 30% gate,
and is used as if complete. Distribution of latest-year tuition as a share of the prior year, across
the 263 programs with real financial rows:

| band | programs | outcome today |
|---|---|---|
| < 30% | 34 | correctly dropped |
| **30–60%** | **129** | **kept — almost certainly partial** |
| **60–90%** | **39** | **kept — likely partial** |
| ≥ 90% | 50 | kept, looks genuinely complete |
| no prior year | 11 | nothing to compare |

**168 of 263 programs (64%) are scored on a year that clears the guard but looks partial.** Their
financial dimension — and therefore their overall health score — is understated.

## Why raising the threshold is the wrong fix

The obvious patch is `0.3 → 0.85`. Reject it.

A ratio cannot distinguish *"this year is half-collected"* from *"this program's revenue genuinely
halved"*. Raising the threshold would silently reclassify real collapse as a data artefact and score
the program on its healthier prior year — **hiding exactly the signal this document exists to
surface**. For a report used to decide programme closures, a false healthy reading is worse than a
false weak one.

## The fix: ask the calendar, not the ratio

The codebase already knows which academic year is finished. `packages/db/src/academic-year.ts`
exposes an operator-configurable context (`academic_year.next_start_date`, surfaced in the admin UI
with a staleness prompt):

```ts
interface AcademicYearContext {
  currentAcademicYearBE: number;       // in flight
  latestCompleteEntryYearBE: number;   // finished
  inProgressEntryYearBE: number;
  isStale: boolean;
}
```

So the rule becomes deterministic and explainable:

> **Score the financial dimension on the most recent academic year that has completed.**
> A year still in progress is never used for scoring, regardless of how much revenue it has
> collected.

`fiscalYear` is CE and the context is BE, so the conversion is `CE = BE − 543`. Today
`currentAcademicYearBE = 2569` (CE 2026) is in flight → score on CE 2025. That matches the measured
data exactly.

**The ratio heuristic is retained as a secondary sanity check only** — for the case where a connector
has written a year the calendar thinks is complete but which is obviously truncated (a failed or
half-finished ingestion). It never *promotes* a year the calendar says is in flight.

### The one thing this must not do

Skipping the in-progress year must not make a currently-collapsing programme look fine. The deep-dive
already carries `partialCurrentYearAvailable`; the in-flight year stays **visible as clearly-labelled
informational data** next to the scored year. The score uses the complete year; the reader still sees
that a partial year exists and what it currently holds.

## File structure

| File | Change |
|---|---|
| `packages/db/src/financial-year.ts` | **NEW** — the single shared rule. Pure, testable. |
| `packages/db/src/health-score.ts` | Delete local `PARTIAL`; call the shared helper. Bump version. |
| `packages/db/src/program-deep-dive.ts` | Delete local `PARTIAL_YEAR_RATIO`; call the shared helper. |
| `packages/db/test/financial-year.test.ts` | **NEW** — the rule's tests. |
| `docs/methodologies/health-score.md` | Document the change under a new version heading. |

---

## Task 1: The shared rule

**Files:** create `packages/db/src/financial-year.ts`, `packages/db/test/financial-year.test.ts`

- [ ] **Step 1: Write the failing test.** Cover, at minimum:
  - the in-progress academic year is never selected, even when its tuition is 95% of prior;
  - the latest complete year IS selected when present;
  - a *complete* year that is obviously truncated (< 30% of the year before it) falls back one
    further, and the result says it did;
  - a genuine 50% decline in a **complete** year is NOT treated as partial — it is scored as-is.
    This is the regression that a raised ratio threshold would have introduced;
  - a single-row history returns that row;
  - an empty list returns null rather than throwing.

- [ ] **Step 2: Run it, watch it fail for the right reason.**

- [ ] **Step 3: Implement.** Signature roughly:

```ts
export interface FinancialYearPick<T> {
  /** The row to score on. Null when there is nothing scoreable. */
  row: T | null;
  /** Why this row was chosen — surfaced in provenance and the UI note. */
  reason: 'latest-complete' | 'fell-back-truncated' | 'only-row' | 'none';
  /** Present when a more recent, in-flight year exists but was excluded. */
  excludedInProgressYear: number | null;
}

export function pickFinancialYear<T extends { fiscalYear: number; tuitionRevenue: unknown }>(
  rowsAscending: readonly T[],
  ctx: AcademicYearContext,
): FinancialYearPick<T>;
```

Return the *reason*, not just the row — the UI and the PDF both need to explain the choice, and
`health-score`'s driver provenance should record it.

- [ ] **Step 4: Run, expect pass. Commit** — `feat(db): pick the latest complete academic year for financial scoring`

---

## Task 2: Use it in both scorers

**Files:** `packages/db/src/health-score.ts`, `packages/db/src/program-deep-dive.ts`

- [ ] **Step 1:** Replace `scoreFinancialProgram`'s local `PARTIAL` block with `pickFinancialYear`.
- [ ] **Step 2:** Replace `programFinancials`' `PARTIAL_YEAR_RATIO` block with the same call, mapping
      `excludedInProgressYear` onto the existing `partialCurrentYearAvailable` field so the UI note
      keeps working.
- [ ] **Step 3:** Delete both local constants. Two copies of one rule is how they drift.
- [ ] **Step 4:** `pnpm --filter @kku/db test` and `pnpm typecheck`.
- [ ] **Step 5: Commit** — `refactor(db): one shared partial-year rule for both financial scorers`

---

## Task 3: Measure the impact before shipping it

This changes the score of roughly two-thirds of programs. Do not ship it blind.

- [ ] **Step 1:** Write a throwaway script that computes, for every program, the financial dimension
      and overall score **before and after**, and prints the distribution of deltas plus the ten
      largest movers in each direction.
- [ ] **Step 2:** Sanity-check the direction. Scores should mostly **rise**, since a half-collected
      year was dragging them down. **A large fall is a red flag** — investigate before proceeding.
- [ ] **Step 3:** Record the summary in the methodology doc. Council will ask why scores moved, and
      "we stopped scoring on half-finished years, here is the distribution" is the answer.
- [ ] **Step 4:** Delete the script; it is evidence-gathering, not a deliverable.

---

## Task 4: Version bump and documentation

Project rule: a formula change bumps the methodology version, and the doc is versioned in git.

- [ ] **Step 1:** `HEALTH_SCORE_VERSION` `health-score.v3.8` → `v3.9`.
- [ ] **Step 2:** Add a section to `docs/methodologies/health-score.md` stating the old rule, the new
      rule, why the ratio approach was rejected, and the measured impact from Task 3.
- [ ] **Step 3:** Old `AiInference` / snapshot rows stay stamped v3.8 — that is the point of the
      version, so historical scores remain interpretable.
- [ ] **Step 4: Commit** — `feat(db): health-score.v3.9 — score financials on the last complete academic year`

---

## Task 5: Remove the fiscal-vs-academic ambiguity

The bug above was possible because a column named `fiscalYear` holds an academic year. Leaving that
in place guarantees someone re-derives the same wrong assumption — including a future session of
mine, which is exactly how this plan's first draft got it right only by luck.

Pick one, in order of preference:

- [ ] **Preferred — rename the field to what it is.** `FinancialMetric.fiscalYear` →
      `academicYear`, matching `EnrollmentMetric.academicYear` which already uses the correct name
      for the same calendar. This is an additive-then-cutover migration touching the Prisma model,
      the connector, `link-program-financials.ts`, both scorers, the MVs (`mv_*_metrics` select
      `fiscal_year AS year`), the PDF schema and the deep-dive. Non-trivial — size it before
      committing to it.
- [ ] **Minimum — document it at every read site.** A doc comment on the Prisma field and on
      `FacultyBudget.fiscalYear` stating which calendar each holds and that they differ. Cheap, and
      strictly better than the current silence.

Do **not** rename `FacultyBudget.fiscalYear` — that one is correctly named.

- [ ] **Commit** — `refactor(db): name the academic-year column for the calendar it holds`

---

## Task 6: Surface the choice to the reader

- [ ] **Step 1:** Deep-dive financials section: state which academic year the figures are from and,
      when one exists, that a later year is still in progress with its collected-so-far figure shown
      as informational.
- [ ] **Step 2:** The PDF's financials section provenance should name the scored year explicitly
      rather than implying "latest".
- [ ] **Step 3: Commit** — `feat(web,pdf): say which academic year the financial score is based on`

---

## Risks

- **The academic-year context can go stale.** `AcademicYearContext.isStale` is true when the
  configured `next_start_date` has passed and nobody bumped it — the admin UI prompts, but if it is
  ignored the "current" year is wrong and scoring silently follows it. Task 1 should treat a stale
  context as a reason to log loudly, and the impact script in Task 3 should print the context it ran
  under.
- **Programs whose latest complete year is old.** 19 programs' most recent row predates 2025
  entirely. They are already scored on stale data; this change does not worsen it, but the reason
  code (`only-row`, `latest-complete`) makes it visible for the first time.
- **Two-thirds of scores will move.** That is the point, but it needs to be announced rather than
  discovered — hence Task 3's distribution and the methodology note.
