# DQ Score Platform Integration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make each programme's Digital Intelligence (DQ) score a first-class signal — a health-score driver inside `outcomes`, a section on the programme deep-dive, and a separate attainment lens in the gap analyzer.

**Architecture:** One shared programme-scope query in `packages/db` feeds all three. The health driver follows the `studentSatisfactionDriver` precedent exactly (scope-aware, awaited inline in the outcomes drivers array). The deep-dive gets one section endpoint. The gap lens rests on a hand-curated 13-row module→skill mapping and never alters existing gap figures.

**Tech Stack:** TypeScript strict (`noUncheckedIndexedAccess`, no `any`), Prisma raw SQL, NestJS, Next.js 14, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-25-dq-score-platform-integration-design.md` — read it before Task 1.

---

## Facts you will need throughout

- Cubes already exist and are loaded: `dq_student_cube`, `dq_module_cube` (see `packages/db/src/student-dq.ts`).
- **Programme DQ score** = `SUM(score_sum)/SUM(taken_count)` over `module_kind='THEORY' AND module_no <= 12` at programme scope. Module 13 is excluded — its uptake varies 48.7%–96.7% between faculties.
- **Eligibility:** `programs.level = 'BACHELOR'` AND ≥ 5 scored students (`DQ_MIN_CELL_STUDENTS`). Otherwise **null**, never 0.
- Measured today: **81 eligible programmes**, means spanning **75.1–90.7**, median 85.0, **none below the pass mark of 70**. 30 non-bachelor programmes hold DQ rows totalling **10 students** — an artefact of the enrolment join, excluded everywhere.
- Health score is currently `health-score.v3.9`; this work takes it to **v4.0**.

---

## Task 1: The shared programme-scope query and the scoring band

**Files:** Modify `packages/db/src/student-dq.ts`; create `packages/db/test/dq-health-driver.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/test/dq-health-driver.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { DQ_ELIGIBLE_LEVEL, dqDriverScore, dqIsEligible } from '../src/student-dq';

describe('dqDriverScore — anchored on the pass mark, not on the observed spread', () => {
  it('puts the pass mark at the middle of the scale', () => {
    // The whole point of the anchor: 50 means "the average student just passes".
    expect(dqDriverScore(70)).toBe(50);
  });

  it('maps the working range 70-90 across the upper half', () => {
    expect(dqDriverScore(80)).toBe(75);
    expect(dqDriverScore(90)).toBe(100);
  });

  it('maps below-pass scores across the lower half', () => {
    expect(dqDriverScore(50)).toBe(0);
    expect(dqDriverScore(60)).toBe(25);
  });

  it('clamps rather than extrapolating outside the band', () => {
    expect(dqDriverScore(95)).toBe(100);
    expect(dqDriverScore(100)).toBe(100);
    expect(dqDriverScore(20)).toBe(0);
    expect(dqDriverScore(0)).toBe(0);
  });

  it('differentiates the real programme range', () => {
    // Measured: programmes span 75.1 (weakest) to 90.7 (strongest),
    // median 85.0. A raw pass-through would put them all in the top
    // quarter; the band spreads them from ~63 to 100.
    expect(dqDriverScore(75.1)).toBeCloseTo(62.75, 2);
    expect(dqDriverScore(85.0)).toBeCloseTo(87.5, 2);
    expect(dqDriverScore(90.7)).toBe(100);
  });

  it('returns null for a null mean — never 0', () => {
    // A programme with no DQ evidence is not a programme that scored
    // zero. The health score excludes nulls from its average.
    expect(dqDriverScore(null)).toBeNull();
  });
});

describe('dqIsEligible', () => {
  it('accepts a bachelor programme at exactly the floor', () => {
    expect(dqIsEligible('BACHELOR', 5)).toBe(true);
  });

  it('rejects below the floor', () => {
    expect(dqIsEligible('BACHELOR', 4)).toBe(false);
    expect(dqIsEligible('BACHELOR', 0)).toBe(false);
  });

  it('rejects every non-bachelor level whatever its data', () => {
    // The 30 graduate programmes holding DQ rows total 10 students —
    // undergraduates who later enrolled, caught by the current-enrolment
    // join. Scoring them would report the join, not the programme.
    for (const level of ['MASTER', 'DOCTORAL', 'HIGHER_GRAD_DIPLOMA']) {
      expect(dqIsEligible(level, 500)).toBe(false);
    }
    expect(DQ_ELIGIBLE_LEVEL).toBe('BACHELOR');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

`pnpm --filter @kku/db exec vitest run test/dq-health-driver.test.ts`
Expected: the three symbols do not exist.

- [ ] **Step 3: Implement — append to `packages/db/src/student-dq.ts`**

```ts
/** DQ is an undergraduate instrument. See dqIsEligible. */
export const DQ_ELIGIBLE_LEVEL = 'BACHELOR';

/** Raw DQ means below this score 0; the band's lower half exists so a
 *  failing programme is visible rather than clipped at the floor. */
const DQ_BAND_FLOOR = 50;
/** KKU's own pass mark, and the middle of the driver scale. */
const DQ_BAND_PASS = 70;
/** Above this the driver saturates. */
const DQ_BAND_CEILING = 90;

/**
 * Convert a raw programme DQ mean (0-100) into a health-driver score.
 *
 * Anchored on the pass mark rather than on the observed spread:
 *   ≤50 → 0 · 70 → 50 · ≥90 → 100, linear between.
 *
 * Why not pass the raw mean straight through: programme means span only
 * 75.1-90.7 (median 85.0, half within 3.8 points) and NO programme is
 * below the pass mark, so a raw value would put every programme in the
 * top quarter of the driver and differentiate almost nothing — the same
 * failure the DQ radar had against a 0-100 axis.
 *
 * Why not fit the band to the observed min/max: that moves one
 * programme's score when a DIFFERENT programme's data changes, and it
 * shifts on every refresh. Anchoring on 70 also makes the number
 * readable — 50 means the average student just passes.
 *
 * Returns null for a null mean. A programme with no DQ evidence has not
 * scored zero, and the health score excludes nulls from its average.
 */
export function dqDriverScore(rawMean: number | null): number | null {
  if (rawMean === null || !Number.isFinite(rawMean)) return null;
  if (rawMean <= DQ_BAND_FLOOR) return 0;
  if (rawMean >= DQ_BAND_CEILING) return 100;
  if (rawMean <= DQ_BAND_PASS) {
    return ((rawMean - DQ_BAND_FLOOR) / (DQ_BAND_PASS - DQ_BAND_FLOOR)) * 50;
  }
  return 50 + ((rawMean - DQ_BAND_PASS) / (DQ_BAND_CEILING - DQ_BAND_PASS)) * 50;
}

/**
 * Whether a programme may carry a DQ score at all.
 *
 * Two gates. The level gate is absolute: the 30 non-bachelor programmes
 * holding DQ rows total 10 students between them — undergraduates who
 * sat the test and later enrolled in a master's, caught by the
 * current-enrolment join. A score there would describe the join.
 *
 * The 5-student floor matches the dashboard's suppression floor so one
 * rule governs the whole feature. It is deliberately low, so every
 * surface that renders the score must render `n` beside it.
 */
export function dqIsEligible(level: string, scoredStudents: number): boolean {
  return level === DQ_ELIGIBLE_LEVEL && scoredStudents >= DQ_MIN_CELL_STUDENTS;
}
```

- [ ] **Step 4: Run the tests — expect 10 passing**

- [ ] **Step 5: Add the scope-aware query**

Also in `student-dq.ts`, add `dqCompetencyByScope`, returning the raw mean plus the evidence a caller needs to render `n`:

```ts
export interface DqCompetencyScope {
  /** Respondent-weighted mean across theory modules 1-12, or null. */
  rawMean: number | null;
  /** Scored students behind it — rendered beside the score everywhere. */
  scoredStudents: number;
  /** Eligible programmes contributing, for faculty/university scopes. */
  programCount: number;
}

export async function dqCompetencyByScope(args: {
  scope: 'program' | 'department' | 'faculty' | 'university';
  scopeId: string;
}): Promise<DqCompetencyScope>;
```

**Use `$queryRawUnsafe` with positional parameters, not `Prisma.sql`.** The
`studentSatisfactionDriver` in `health-score.ts:1500-1549` documents why: under
concurrent `Promise.all` execution a `Prisma.Sql` fragment intermittently mis-binds and
throws `syntax error at or near "$1"`. Copy that function's approach exactly.

The query joins `dq_module_cube` → `programs` and filters `module_kind='THEORY' AND
module_no <= 12` and `programs.level = 'BACHELOR'`, aggregating `SUM(score_sum) /
SUM(taken_count)` at the requested scope. Scored students come from `dq_student_cube`
under the same scope filter.

**Rollups must aggregate at the requested scope**, never average programme scores — the
DQ work already measured that error at 0.8 points on module 1 (86.708 weighted vs 87.544
mean-of-means).

- [ ] **Step 6: Verify against live data**

Scratch script under the scratchpad (not the repo). Print and report:

- the university-scope raw mean, one faculty's, and three programmes';
- the university figure cross-checked against direct SQL — they must agree exactly;
- **the rollup property, both numbers**: the faculty's weighted mean
  (`SUM(score_sum)/SUM(taken_count)` at faculty scope) alongside the mean of its
  programmes' scores. They will differ, and showing both is what proves the query
  aggregates rather than averaging averages. The DQ query layer measured this gap at 0.8
  points on module 1; report whatever it is here;
- a non-bachelor programme returning `rawMean: null`;
- a bachelor programme with 1-4 scored students returning `rawMean: null` from
  `dqIsEligible`, not a computed mean.

Delete the script afterwards.

- [ ] **Step 7: Commit** — `feat(db): DQ competency scope query + health-driver band`

---

## Task 2: The health-score driver

**Files:** Modify `packages/db/src/health-score.ts`, `docs/methodologies/health-score.md`.

- [ ] **Step 1: Add the driver function**

Model it on `studentSatisfactionDriver` (`health-score.ts:1493`) — same signature shape,
same `$queryRawUnsafe` discipline, returning `HealthScore['drivers'][number]`:

```ts
async function dqCompetencyDriver(args: {
  scope: ScopeLevel;
  scopeId: string;
}): Promise<HealthScore['drivers'][number]> {
  const dq = await dqCompetencyByScope({ scope: args.scope, scopeId: args.scopeId });
  // `raw` carries the evidence, including n — the 5-student floor is low
  // by decision, so every surface must be able to show how thin a score is.
  return {
    label: 'dq_digital_competency',
    value: dqDriverScore(dq.rawMean),
    raw:
      dq.rawMean === null
        ? null
        : {
            rawMean: dq.rawMean,
            scoredStudents: dq.scoredStudents,
            programCount: dq.programCount,
            passMark: DQ_PASS_MARK,
            modulesCounted: 'theory 1-12 (module 13 excluded — uneven rollout)',
          },
  };
}
```

- [ ] **Step 2: Wire it into both outcomes scorers**

In `scoreOutcomesProgram`, append to the drivers array beside the existing
`await studentSatisfactionDriver(...)` call:

```ts
    await dqCompetencyDriver({ scope: 'program', scopeId: programId }),
```

Do the same in `scoreOutcomesScope` with that function's scope/scopeId. Change nothing
else about either function — the other five drivers keep their behaviour.

- [ ] **Step 3: Bump the version**

`HEALTH_SCORE_VERSION` → `'health-score.v4.0'` (`health-score.ts:111`). Follow the
instruction in the comment above it about updating the methodology doc first.

- [ ] **Step 4: Update `docs/methodologies/health-score.md`**

Add the driver under the outcomes dimension: what it measures, the band table
(≤50→0, 70→50, ≥90→100), the eligibility rule (bachelor only, ≥5 scored students), why
module 13 is excluded, and why the band is anchored on the pass mark rather than fitted
to the observed spread. Record the v4.0 entry in the doc's version history in whatever
form the file already uses.

- [ ] **Step 5: Verify — and produce the drift report**

This is the step that matters. Write a scratch script that computes, for **all 301
programmes**, the outcomes score and the composite before and after, and reports:

- how many programmes have a non-null DQ driver (expect **81**);
- how many bachelor programmes have a null driver (expect 21) and how many non-bachelor
  (expect 199) — **none of the 199 may have a value**;
- the distribution of the outcomes-score change, and the largest movers in both directions;
- **the reconciliation: every programme whose outcomes score moved has a DQ driver, and
  no programme without one moved.** If a programme without a DQ driver moved, something
  else changed and you must stop and explain it.

Print the report in your task report. Delete the script afterwards.

- [ ] **Step 6: Commit** — `feat(db): DQ digital-competency driver in the outcomes dimension (health-score.v4.0)`

---

## Task 3: The deep-dive section — API

**Files:** Modify `packages/db/src/program-deep-dive.ts`, `apps/api/src/programs/deep-dive.controller.ts`.

- [ ] **Step 1: The data function**

Add `programDigitalCompetency(programId)` to `program-deep-dive.ts`, following the shape
of its neighbours (explicit return interface — this package builds with
`declaration: true`, so an inferred type referencing Prisma internals breaks portability):

```ts
export interface ProgramDigitalCompetency {
  /** 'not-applicable' for non-bachelor programmes: the section does not
   *  render at all, which is different from having no data. */
  status: 'ok' | 'below-floor' | 'no-data' | 'not-applicable';
  rawMean: number | null;
  driverScore: number | null;
  scoredStudents: number;
  passRatePct: number | null;
  /** All 13 theory modules for the radar, plus the university series. */
  modules: Array<{
    moduleKey: string; moduleNo: number;
    mean: number | null; coveragePct: number | null;
    universityMean: number | null;
  }>;
  /** Named weakest modules — the actionable part. */
  weakest: Array<{ moduleKey: string; mean: number }>;
  methodologyVersion: string;
}
```

- [ ] **Step 2: The endpoint**

Add to `deep-dive.controller.ts`, matching its siblings exactly (`@Authorized('programs:read:all')`,
`assertProgramAccessible`, and a `@Provenance` block naming the DQ source):

```ts
  @Get('dq')
  @Authorized('programs:read:all')
  @Provenance({
    sources: [{ id: 'kku-dq', name: 'KKU Digital Intelligence competency test' }],
  })
  async digitalCompetency(
    @AuthSession() user: SessionUser,
    @Param('programId') programId: string,
  ) {
    await assertProgramAccessible(programId, user);
    return programDigitalCompetency(programId);
  }
```

- [ ] **Step 3: Verify**

`pnpm --filter api typecheck`; with the API running, curl the route unauthenticated and
expect `UNAUTHORIZED` (404 = not registered). Then, with a minted session (see how the
Student DQ tasks did it), fetch it for: a well-covered bachelor programme, a bachelor
programme below the 5-student floor, a bachelor programme with no DQ rows, and a master's
programme. Confirm the four distinct `status` values. Report all four.

- [ ] **Step 4: Commit** — `feat(api): programme digital-competency deep-dive section`

---

## Task 4: The deep-dive section — UI

**Files:** Modify `apps/web/app/programs/[id]/client.tsx` (and its server page if the section needs a new fetch).

- [ ] **Step 1: Render the section**

Follow the existing deep-dive sections' structure. Content:
- the DQ score and its health-driver value, **with `n` scored students stated beside it** —
  the 5-student floor is low by decision, so a thin score must look thin;
- the 13-module radar via `RadarChartSmall`, with the university as `comparisons` and
  **the adaptive floor** built for the dashboard (floor at the plotted data's decade,
  computed across BOTH series, capped at 60, with the truncation stated in words —
  see `apps/web/app/education/student-dq/client.tsx`, `radarDomain`);
- pass rate, labelled as DQ's own flag with its known inconsistency noted;
- the weakest modules named;
- a link to `/education/student-dq` filtered to this programme.

Status handling, all four distinct:
- `ok` → the full section;
- `below-floor` → "withheld, fewer than 5 scored students", with the count;
- `no-data` → the honest empty state pointing at the connector;
- `not-applicable` → **render nothing at all**. No empty card. DQ does not apply to a
  master's programme and an empty box would imply it should.

- [ ] **Step 2: Verify**

`pnpm --filter web typecheck` and eslint on the changed files. Then render the deep-dive
for each of the four programmes from Task 3 Step 3 and confirm what appears. **Report
what you actually saw**; if you could not verify something in a browser, say so plainly.

Watch the class traps: bare `rounded` emits nothing (radius map has no `DEFAULT`);
semantic families use the bare class (`text-warning`), `mapColor` families take `-default`
(`text-accent-default`); it is `border-subtle`.

- [ ] **Step 3: Commit** — `feat(web): digital-competency section on the programme deep-dive`

---

## Task 5: The module→skill mapping

**Files:** Create `packages/shared/src/dq/module-skills.ts` + its test.

- [ ] **Step 1: Confirm the mapping — most of it is a deliberate `null`**

I queried the taxonomy for all 13 modules. **The result is mostly gaps, and that is the
finding, not a failure of searching.** The 5,152-skill taxonomy is built from curriculum
extraction — discipline skills like "Digital Media Production" — and carries almost no
digital-competency vocabulary. Candidates found:

| # | module | best candidate in the taxonomy | verdict |
|---|---|---|---|
| 1 | Computer Basics | *nothing* | `none` → null |
| 2 | Internet | only "Internet of Things", "Internet Protocol Suite" | `none` → null |
| 3 | Online Collaboration | only generic teamwork ("Collaboration and Leadership") | `none` → null |
| 4 | Operating System | **Operating Systems** `cmoo0dzo500kz2qd6nbewxgyy` | `exact` |
| 5 | Word Processing | *nothing* | `none` → null |
| 6 | Spreadsheet | only "Excel Dashboards" — an advanced BI skill, not spreadsheet literacy | `none` → null |
| 7 | Presentation | "Academic Presentation" `cmoqi5dfy00e22nlfaemrgtic` — the ACT of presenting, where the module tests presentation SOFTWARE | `near` |
| 8 | Digital Media | **Digital Media Production** `cmoqia2ud00oj2nlf8f3w8ulk` | `near` |
| 9 | Social Media | **Social Media Communication** `cmoqi6yld00gz2nlfks0zgbo6` | `near` |
| 10 | Information Literacy | **Information Literacy** `cmoo1dif702um2qd6d6mzh7bz` | `exact` |
| 11 | Career Search Skills | "Career and Learning Skills" `cmoo2uikl06wk2qd6r7f2kra4` | `near` |
| 12 | Digital Footprint | **Digital Citizenship** `cmoo2jzkh06462qd613cnuiur` | `near` |
| 13 | Generative AI | **Generative AI Application** `cmoqi6yee00gq2nlfks0zgbo6`… verify the id | `exact` |

So roughly **3 exact, 5 near, 5 with no defensible counterpart**. Two consequences you
must carry into the implementation rather than paper over:

- **A `null` mapping is a first-class outcome.** Record it with `confidence: 'none'` and
  render those modules in the lens as *unmapped* — never silently dropped, and never
  stretched onto an approximate skill so the table looks complete.
- **`near` is not `exact`, and the lens must say which it is.** Module 7 is the clearest
  case: DQ tests whether a student can drive presentation software; the taxonomy skill is
  about presenting academically. Pairing them without a visible caveat would put a
  comparison on a Council page that a domain expert would immediately dispute.

Before writing the file, re-run each candidate query to confirm the ids (several skills
are duplicated in the taxonomy — "Information Literacy" and "Operating Systems" each
appear more than once; pick one and note the duplicate). **Verify every id exists**:

```bash
docker exec program-landscape-postgres psql -U kku -d program_landscape -c \
  "SELECT id, name_en FROM skills WHERE id IN ('cmoo0dzo500kz2qd6nbewxgyy', ...);"
```

Then write `packages/shared/src/dq/module-skills.ts` as a 13-row table of
`{ moduleNo, skillId: string | null, skillNameEn: string | null, confidence: 'exact' | 'near' | 'none', note: string }`,
with the note carrying the caveat for every `near` row.

**This mapping needs an analyst's sign-off before the lens ships to Council** — flag that
in your report; it is a judgement about vocabulary, not a lookup.

- [ ] **Step 2: Test it**

Assert: exactly 13 rows, one per theory module 1–12 plus 13; every non-null `skillId`
exists in the taxonomy (this test may hit the DB, or assert against a fixture captured
from it — say which you chose); no skill is mapped twice; and every row carries a
confidence note.

- [ ] **Step 3: Commit** — `feat(shared): curated DQ module → skill-taxonomy mapping`

---

## Task 6: The gap-analyzer lens

**Files:** Create `packages/db/src/dq-skill-lens.ts`; modify the gap-analysis API + a page under `apps/web/app/gap-analysis/`.

- [ ] **Step 1: The query**

For each mapped skill: the demand signal the gap analyzer already uses (KMITL), and
against it the **measured attainment** — the university-wide DQ mean for that module, and
the programmes weakest on it. Return unmapped modules explicitly so the view can say
which competencies have no taxonomy counterpart.

- [ ] **Step 2: The view**

A distinct lens beside the existing gap output — **not a modifier on it**. Nothing on the
existing gap pages may change: this is attainment evidence, a different axis from demand
and supply, and the spec is explicit that no existing Council-facing number moves
silently. Label it as such on screen.

- [ ] **Step 3: Verify**

Confirm by diffing before/after that the existing `/gap-analysis` figures are byte-identical.
Report that check explicitly.

- [ ] **Step 4: Commit** — `feat(gap): digital-competency attainment lens`

---

## Task 7: Dashboard exclusion, changelog, verification

**Files:** Modify `packages/db/src/student-dq.ts` (or the connector), `apps/web/app/changelog/page.tsx`.

- [ ] **Step 1: Exclude non-bachelor programmes from the Student DQ dashboard**

Today the drill shows 30 graduate programmes holding 10 students between them. Those rows
are artefacts of the enrolment join. Exclude them from the programme level of the drill —
their students should fall into the faculty's "Program not identified" bucket, which is
what they are: tested students we cannot attribute to a current undergraduate programme.
**Confirm the totals still reconcile at 24,777 / 19,601 after the change** — students must
move between buckets, not disappear.

- [ ] **Step 2: Changelog**

New first entry, house voice, from the MEASURED numbers: DQ now contributes to programme
health as one driver inside outcomes; it covers 81 bachelor programmes; graduate
programmes are excluded and why; the score is anchored on the pass mark so 50 means the
average student just passes; the deep-dive gains a digital-competency section; the gap
analyzer gains an attainment lens that changes no existing figure. Include the drift
report's headline from Task 2.

- [ ] **Step 3: Full verification**

```bash
pnpm typecheck   # expect 8/8
pnpm test        # previous total + the new tests
```
`pnpm lint` is repo-wide with a known backlog — only failures in files this plan touched
are yours, and CI lints changed files, so a pre-existing error in a file you touch becomes
yours to fix.

- [ ] **Step 4: Report, do not deploy.** Summarise files, the drift report, measured
  numbers and anything deferred. **Do not run `pnpm build:release`.**

---

## Done criteria

- [ ] 81 bachelor programmes carry a `dq_digital_competency` driver; 21 bachelor and all
      199 non-bachelor programmes carry `null`, never `0`.
- [ ] The drift report reconciles: every programme whose outcomes score moved has a DQ
      driver, and no programme without one moved.
- [ ] Faculty and university DQ figures are weighted means at their own scope, not means
      of programme means.
- [ ] The deep-dive renders four distinct states, and renders **nothing** for a
      non-bachelor programme.
- [ ] Existing `/gap-analysis` figures are unchanged, verified by diff.
- [ ] `docs/methodologies/health-score.md` documents v4.0 before the constant was bumped.
