# Revision-Aware Regeneration — Tier 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the phaseRE and phaseCR skip-if-exists guards compare against the revision the run is analysing, so a revised curriculum regenerates its research-expertise and curriculum-revision analyses instead of keeping the previous curriculum's forever.

**Architecture:** Resolve the programme's post-adoption `activeRevisionId` once per programme, then add it to both guards' `findFirst` where-clauses. Prisma translates `{ programRevisionId: null }` to `IS NULL`, so unrevised programmes (299 of 301) keep matching their NULL-provenance rows and skip exactly as today.

**Tech Stack:** TypeScript, Prisma, Vitest, pnpm monorepo.

**Spec:** `docs/superpowers/specs/2026-09-03-revision-aware-regeneration-design.md`

---

## Why this is small

The whole fix is one resolved variable plus one `where` key in each of two guards. It looks trivial, and it is — but only because three properties already hold. **Verify each before changing anything; if any is false, stop and report.**

1. **`adoptPendingRevision()` runs before every phase** — `programs-pipeline.ts:320`, phaseRE is at 592 and phaseCR at 638. So `activeRevisionId` is already this run's revision when the guards evaluate. If adoption ever moves after the phases, this fix silently inverts and skips exactly when it should regenerate.
2. **All four readers order by `generatedAt: 'desc'`** — `program-curriculum-revision.ts:436,610,652` and `program-deep-dive.ts:799`. The runners are insert-only (`prisma.programResearchExpertise.create`), so regenerating leaves the old row behind; readers taking the newest is what makes that harmless.
3. **`NULL === NULL` keeps the cost flat.** 299 of 301 programmes have `activeRevisionId = NULL`, and all 254 `ProgramResearchExpertise` rows carry `programRevisionId = NULL`. They match and skip. A full `--all` re-run must cost no more than today — this is the property that makes the change safe to ship unattended.

## File structure

| File | Responsibility |
|---|---|
| `apps/ingestion/src/scripts/programs-pipeline.ts` | **Modify** — resolve the run's revision id; both guards filter on it |
| `apps/ingestion/test/programs-pipeline-revision-guard.test.ts` | **Create** — the guard predicate, tested directly |

## Scope boundary

Tier 2 (the phase-1 digest/faculty/skills/pedagogy family, which guards on `AiExtraction` and needs a new column) is **explicitly not in this plan**. Do not add `programRevisionId` to `AiExtraction`. Do not touch `runProgramDigest` or its siblings. Do not change `force` semantics.

---

### Task 1: Resolve the run's revision id

**Files:**
- Modify: `apps/ingestion/src/scripts/programs-pipeline.ts`

- [ ] **Step 1: Confirm the ordering property before editing**

```bash
cd /home/denpong/projects/program-landscape
grep -n "adoptPendingRevision\|shouldRun('phaseRE')\|shouldRun('phaseCR')\|markRevisionAnalysed" apps/ingestion/src/scripts/programs-pipeline.ts
```

Expected: `adoptPendingRevision` at ~320, `phaseRE` at ~592, `phaseCR` at ~638, `markRevisionAnalysed` at ~728 — adoption strictly **before** both guards. If it is not, STOP and report; the rest of this plan is unsound.

- [ ] **Step 2: Add the import**

`activeRevisionIdFor` is exported from `packages/db/src/program-revision.ts` and re-exported by the barrel (`packages/db/src/index.ts:61`). Add it to the existing `@kku/db` import block (~line 125-133), which already pulls `adoptPendingRevision` and `markRevisionAnalysed`:

```ts
import {
  prisma,
  PrismaAiInferenceRecorder,
  getAiModelOverrideStore,
  generateProgramResearchExpertise,
  generateProgramCurriculumRevision,
  activeRevisionIdFor,
  adoptPendingRevision,
  markRevisionAnalysed,
} from '@kku/db';
```

- [ ] **Step 3: Resolve it once, immediately after adoption**

The in-scope `program` object selects only `{ id, code, nameEn }` (see `programs-pipeline.ts:250`), so it does **not** carry `activeRevisionId`. And `adoptedRevisionId` is not a substitute: `adoptPendingRevision()` returns `null` when nothing is pending, while the programme may still have a previously-set `activeRevisionId`. Resolve it explicitly.

Directly after the existing adoption block (~line 320-323, ending with the `if (adoptedRevisionId) { console.log(...) }`), add:

```ts
  // The revision every row written by this run will carry. Resolved AFTER
  // adoption on purpose — adoptPendingRevision() returns null when nothing
  // was pending, but the programme may still have an activeRevisionId from
  // an earlier run, and the guards below must compare against THAT.
  //
  // For the 299 programmes that have never been revised this is null, which
  // Prisma renders as `IS NULL` and which matches their existing
  // null-provenance rows — so they skip exactly as they did before.
  const runRevisionId = await activeRevisionIdFor(program.id);
```

- [ ] **Step 4: Typecheck**

Run: `cd /home/denpong/projects/program-landscape/apps/ingestion && npx tsc --noEmit`
Expected: clean. (`runRevisionId` is unused until Task 2 — if the repo's lint flags unused locals as an error, complete Task 2 before linting.)

- [ ] **Step 5: Commit**

```bash
cd /home/denpong/projects/program-landscape
git add apps/ingestion/src/scripts/programs-pipeline.ts
git commit -m "refactor(ingestion): resolve the run's revision id once per programme"
```

---

### Task 2: Make both guards revision-aware

**Files:**
- Modify: `apps/ingestion/src/scripts/programs-pipeline.ts`

- [ ] **Step 1: phaseRE**

At ~line 594 the guard reads:

```ts
    const existing = await prisma.programResearchExpertise.findFirst({
      where: { programId: program.id },
      select: { id: true },
    });
```

Change the where-clause to:

```ts
    const existing = await prisma.programResearchExpertise.findFirst({
      // Scoped to THIS run's revision, not merely "a row exists". A revised
      // curriculum leaves the previous row stamped with the superseded
      // revision (or null, pre-feature), so it no longer matches and the
      // analysis regenerates against the new มคอ.2. Unrevised programmes
      // resolve runRevisionId to null, which matches their existing null
      // rows and skips at $0 exactly as before.
      where: { programId: program.id, programRevisionId: runRevisionId },
      select: { id: true },
    });
```

- [ ] **Step 2: phaseCR**

At ~line 640 apply the identical change to `prisma.programCurriculumRevision.findFirst`. Keep the comment shorter here and point back to phaseRE rather than duplicating the full rationale — the two guards must not drift.

- [ ] **Step 3: Update the two stale header comments**

Both phases carry comments asserting there is no way to re-analyse. phaseRE (~line 587-591) says *"No --force override for this phase — re-analysis is an explicit `pnpm expertise:generate --only <code>` operator action."* and phaseCR (~line 630-633) says *"there is no --force override. Re-analysis is an explicit operator action."*

Those are now wrong in a way that matters: a reader who believes them will not know a revision regenerates these. Amend both to state the actual rule — still no `--force`, still no accretion on an unchanged programme, but a changed `activeRevisionId` regenerates. Leave the `force` semantics themselves untouched.

- [ ] **Step 4: Typecheck and lint**

```bash
cd /home/denpong/projects/program-landscape/apps/ingestion
npx tsc --noEmit
npx eslint 'src/scripts/programs-pipeline.ts'
```
Expected: both clean.

- [ ] **Step 5: Commit**

```bash
cd /home/denpong/projects/program-landscape
git add apps/ingestion/src/scripts/programs-pipeline.ts
git commit -m "fix(ingestion): phaseRE/phaseCR regenerate when the revision changed"
```

---

### Task 3: Test the guard predicate

**Files:**
- Create: `apps/ingestion/test/programs-pipeline-revision-guard.test.ts`

The pipeline script is a long CLI not worth importing wholesale. Test the decision itself — "is an existing row current for this run?" — against a mocked Prisma, which is what the guard reduces to.

- [ ] **Step 1: Check the existing test conventions**

```bash
ls /home/denpong/projects/program-landscape/apps/ingestion/test | head -20
```

Read one neighbouring test and match its import style and mock shape.

**⚠ Do NOT write `vi.mock('@kku/db', async () => ({ ...await vi.importActual('@kku/db'), prisma: mock }))`.** The `importActual` spread pre-loads the real module graph bound to the real `prisma`, the cached instance wins, and the test silently queries the live development database. That exact bug was found in `packages/db/test/health-score.test.ts` on 2026-09-02 — five tests had been passing against real data. Mock with a plain object literal.

- [ ] **Step 2: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({ reFindFirst: vi.fn(), crFindFirst: vi.fn() }));

// Plain literal — no vi.importActual spread. See Step 1.
vi.mock('@kku/db', () => ({
  prisma: {
    programResearchExpertise: { findFirst: mocks.reFindFirst },
    programCurriculumRevision: { findFirst: mocks.crFindFirst },
  },
}));

import { prisma } from '@kku/db';

// The guard, extracted verbatim in shape from programs-pipeline.ts.
async function hasCurrentExpertiseRow(programId: string, runRevisionId: string | null) {
  const existing = await prisma.programResearchExpertise.findFirst({
    where: { programId, programRevisionId: runRevisionId },
    select: { id: true },
  });
  return existing !== null;
}

describe('phaseRE revision-aware guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('passes the run revision into the where-clause so a stale row cannot match', async () => {
    mocks.reFindFirst.mockResolvedValue(null);
    await hasCurrentExpertiseRow('p1', 'revNEW');
    expect(mocks.reFindFirst).toHaveBeenCalledWith({
      where: { programId: 'p1', programRevisionId: 'revNEW' },
      select: { id: true },
    });
  });

  it('queries for null on an unrevised programme, matching its null-provenance row', async () => {
    // 299 of 301 programmes are in this state. Prisma renders
    // `programRevisionId: null` as IS NULL, so the existing row matches and
    // the phase skips at $0 — the property that keeps an --all run's cost
    // unchanged by this feature.
    mocks.reFindFirst.mockResolvedValue({ id: 'existing' });
    const found = await hasCurrentExpertiseRow('p1', null);
    expect(mocks.reFindFirst).toHaveBeenCalledWith({
      where: { programId: 'p1', programRevisionId: null },
      select: { id: true },
    });
    expect(found).toBe(true);
  });

  it('reports absent when the only row belongs to a superseded revision', async () => {
    // findFirst filtered on revNEW returns nothing even though a row exists
    // under revOLD — which is precisely what makes the phase regenerate.
    mocks.reFindFirst.mockResolvedValue(null);
    expect(await hasCurrentExpertiseRow('p1', 'revNEW')).toBe(false);
  });
});
```

- [ ] **Step 3: Run it**

Run: `cd /home/denpong/projects/program-landscape/apps/ingestion && npx vitest run test/programs-pipeline-revision-guard.test.ts`
Expected: 3 passing.

If the runner cannot resolve `@kku/db` in this package's vitest config, do **not** weaken the mock — check how neighbouring ingestion tests import it and follow that. Report if it cannot be made to work.

- [ ] **Step 4: Commit**

```bash
cd /home/denpong/projects/program-landscape
git add apps/ingestion/test/programs-pipeline-revision-guard.test.ts
git commit -m "test(ingestion): revision-aware guard passes the run revision to the query"
```

---

### Task 4: Verify against the real database

**Files:** none — operational. **This task writes nothing; it only runs the pipeline and reads.**

The dev database holds real data and is **shared** — another operator was working in it on 2026-09-03 while a verification run was in progress. Before starting, check nothing else is running:

```bash
cd /home/denpong/projects/program-landscape
docker exec program-landscape-redis redis-cli LLEN bull:ai-jobs:active
docker exec program-landscape-redis redis-cli LLEN bull:ai-jobs:wait
```

Both should be `0`. If not, someone else's job is in flight — wait, and do not kill workers.

- [ ] **Step 1: Baseline the two programmes that have a revision**

```bash
cd /home/denpong/projects/program-landscape/packages/db
npx tsx -e "
import { prisma } from './src/index';
(async () => {
  const ps = await prisma.program.findMany({ where: { activeRevisionId: { not: null } },
    select: { id:true, code:true, activeRevisionId:true } });
  for (const p of ps) {
    const re = await prisma.programResearchExpertise.findFirst({ where:{ programId:p.id }, orderBy:{ generatedAt:'desc' }, select:{ programRevisionId:true, generatedAt:true } });
    const cr = await prisma.programCurriculumRevision.findFirst({ where:{ programId:p.id }, orderBy:{ generatedAt:'desc' }, select:{ programRevisionId:true, generatedAt:true } });
    console.log(p.code, 'active=' + p.activeRevisionId);
    console.log('   RE:', re?.programRevisionId ?? 'NULL', re?.generatedAt.toISOString() ?? '-');
    console.log('   CR:', cr?.programRevisionId ?? 'NULL', cr?.generatedAt.toISOString() ?? '-');
  }
  await prisma.\$disconnect();
})();
"
```

Record the output. As of 2026-09-03 `KKU-SEQ-0019` has RE at `NULL` and CR at a superseded revision — both stale, both should regenerate.

- [ ] **Step 2: The regeneration case**

Run only the two phases on that programme, so the run is cheap and attributable:

```bash
cd /home/denpong/projects/program-landscape
pnpm --filter ingestion programs:pipeline KKU-SEQ-0019 --only=phaseRE,phaseCR
```

Expected: **both phases run and report a cost**, not `skipped: row already exists`.

If phaseCR reports `skipped: no-research`, that is its documented graceful degradation when phaseRE produced no themes — read its reason before treating it as a failure.

- [ ] **Step 3: Prove convergence — the step that catches a runaway**

Immediately re-run the identical command:

```bash
pnpm --filter ingestion programs:pipeline KKU-SEQ-0019 --only=phaseRE,phaseCR
```

Expected: **both now report `skipped: row already exists` at $0.** This is the most important assertion in the plan. If the phases regenerate on every run, the guard is not converging and every `--all` run would re-analyse the entire portfolio — revert and report rather than proceeding.

- [ ] **Step 4: Confirm the new rows carry the current revision**

Re-run the Step 1 script. Expected: for `KKU-SEQ-0019`, both `RE` and `CR` now print a `programRevisionId` equal to its `active=` value, with fresh `generatedAt` timestamps.

- [ ] **Step 5: The no-cost case — verify the 299 still skip**

Pick any programme with `activeRevisionId = NULL` that already has a phaseRE row:

```bash
cd /home/denpong/projects/program-landscape/packages/db
npx tsx -e "
import { prisma } from './src/index';
(async () => {
  const r = await prisma.programResearchExpertise.findFirst({
    where: { programRevisionId: null, program: { activeRevisionId: null } },
    select: { program: { select: { code: true } } } });
  console.log('unrevised programme with an existing RE row:', r?.program.code);
  await prisma.\$disconnect();
})();
"
```

Then run `--only=phaseRE,phaseCR` on that code. Expected: **`skipped: row already exists` at $0.** This is the cost-neutrality property from the spec; if this programme regenerates, an `--all` run would re-analyse all 254 and the change must not ship.

- [ ] **Step 6: Report**

State plainly: which programmes regenerated, which skipped, the actual cost of each run, and whether Step 3's convergence and Step 5's cost-neutrality both held. No commit — this task verifies work already committed.

---

## Self-Review

**Spec coverage:** the Tier 1 rule → Tasks 1-2; the three load-bearing properties → Task 1 Step 1 (ordering), plan preamble (reader ordering), Task 4 Step 5 (cost neutrality); the stale "no re-analysis possible" comments → Task 2 Step 3; verification bullets → Task 4. Tier 2, `force` semantics, per-analysis UI staleness, retro-fixing existing rows and `ProgramCourse`/phase2b are all listed as out of scope in the spec and none is touched here.

**Placeholder scan:** no TBD/TODO. Every code step shows the actual before/after. Line numbers are given as approximate (`~line N`) with a grep to locate them, because the file is edited by other work.

**Type consistency:** `runRevisionId` is `string | null` — the exact return type of `activeRevisionIdFor(programId): Promise<string | null>` — and `programRevisionId` is a nullable column, so both the `string` and `null` cases are valid Prisma filters. The variable is introduced in Task 1 Step 3 and consumed in Task 2 Steps 1-2 under that same name.

**Ordering:** Task 1 must precede Task 2 (the variable must exist). Task 2 must precede Task 4 (nothing to verify otherwise). Task 3 is independent of Task 4 and can run either side of it.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-03-revision-aware-regeneration-tier1.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
