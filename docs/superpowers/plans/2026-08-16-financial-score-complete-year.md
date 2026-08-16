# Score the financial dimension on the last COMPLETE academic year

> Date: 2026-08-16 · Status: plan, not yet implemented
> Raised by the user: the current year's tuition is still being collected, so scoring on it
> understates every affected program.

## The problem, measured

`financial_metrics.fiscalYear` is the **academic** year (the kku-finance connector aggregates tuition
per `ACADYEAR`, BE→CE converted). The current academic year is therefore *in flight*, and its tuition
row only contains what has been collected so far.

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

## Task 5: Surface the choice to the reader

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
