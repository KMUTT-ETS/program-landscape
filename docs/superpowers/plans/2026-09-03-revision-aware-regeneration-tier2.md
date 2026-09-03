# Revision-Aware Regeneration, Tier 2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the phase-1 extraction family (digest, faculty list, detailed skills) and the pedagogy assessment regenerate when a programme's curriculum has been revised, instead of keeping the previous curriculum's output forever behind a `--force`-only escape hatch.

**Architecture:** Add a nullable `programRevisionId` to `AiExtraction`, stamp it on the three programme-scoped extraction kinds, then scope each runner's skip-if-exists guard to it. Pedagogy needs no schema change — its table already carries the column. No backfill: existing rows stay NULL, unrevised programmes resolve to NULL, and `NULL === NULL` keeps them skipping at $0.

**Tech Stack:** TypeScript, Prisma 5.22, PostgreSQL, Vitest, pnpm monorepo.

**Spec:** `docs/superpowers/specs/2026-09-03-revision-aware-regeneration-tier2-design.md`

---

## ⚠ Task ordering is load-bearing — read before starting

**Task 2 (stamp on write) MUST land before Task 3 (compare on read).**

If the guards start comparing while the writers still insert NULL, then on a revised programme: the guard sees a mismatch → regenerates → the new row is *also* NULL → the next run mismatches again → **it regenerates on every single run, forever**. On an `--all` that is ~300 digests per run at roughly $0.04 each, silently, with no error.

The reverse order is harmless: stamping without comparing changes nothing observable.

Do not reorder these tasks. Do not run the pipeline between Task 2 and Task 3.

## What this does NOT touch

Confirmed by reading the source — do not "fix" these:

- **`runProgramCoursesExtract` (phase2b)** has no skip-if-exists guard and takes no `force`. It re-extracts every run already.
- **`PROPOSED_SKILL`** (4,167 rows) carries `sourceEntityType: 'program'` but is a downstream artifact of a digest, not a curriculum extraction. Nothing guards on it.
- **`PROGRAM_COURSES_EXTRACT`**, `COURSE_SKILLS`, `JOB_POSTING_SKILLS`, `POLICY_DOC_ANALYSIS`, and the IMD rankings kind — all keep `programRevisionId` NULL forever.
- **`force` semantics.** Unchanged everywhere.

Filter writers by explicit `extractionKind`, never by `sourceEntityType === 'program'` alone.

## File structure

| File | Responsibility |
|---|---|
| `packages/db/prisma/schema.prisma` | **Modify** — column, index, relation, back-relation |
| `packages/db/prisma/migrations/20260903150000_ai_extraction_program_revision/migration.sql` | **Create** — hand-written DDL |
| `apps/ingestion/src/program-digest/run.ts` | **Modify** — stamp, then guard |
| `apps/ingestion/src/program-faculty/run.ts` | **Modify** — stamp, then guard |
| `apps/ingestion/src/program-skills/run.ts` | **Modify** — stamp, then guard |
| `apps/ingestion/src/program-pedagogy/run.ts` | **Modify** — guard only (already stamps) |
| `apps/ingestion/test/phase1-revision-guard.test.ts` | **Create** — guard predicate tests |

---

### Task 1: Schema + migration

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260903150000_ai_extraction_program_revision/migration.sql`

`prisma migrate dev` needs a TTY this environment does not have. The convention here is a hand-written `migration.sql` applied with `prisma migrate deploy`.

- [ ] **Step 1: Add the field to the model**

In `model AiExtraction`, after `goldLabelledByUserId` and before `createdAt`:

```prisma
  // Which curriculum revision this extraction was taken from. NULL means the
  // pre-feature baseline — and stays NULL for every non-programme kind
  // (COURSE_SKILLS, JOB_POSTING_SKILLS, POLICY_DOC_ANALYSIS, IMD rankings)
  // and for PROPOSED_SKILL, which is a downstream artifact of a digest
  // rather than an extraction of the curriculum.
  programRevisionId    String?      @map("program_revision_id")
```

Add the relation alongside the existing `goldLabelledBy` relation:

```prisma
  programRevision ProgramRevision? @relation(fields: [programRevisionId], references: [id], onDelete: SetNull)
```

And an index, next to the existing `@@index` lines:

```prisma
  @@index([sourceEntityType, sourceEntityId, extractionKind, programRevisionId])
```

- [ ] **Step 2: Add the back-relation on `ProgramRevision`**

`model ProgramRevision` already lists ten back-relations (`strategicNarratives`, `skills`, `courses`, …). Add an eleventh in the same style:

```prisma
  aiExtractions          AiExtraction[]
```

Prisma will not validate without it.

- [ ] **Step 3: Write the migration**

Create `packages/db/prisma/migrations/20260903150000_ai_extraction_program_revision/migration.sql`. Match the style of `20260903130000_program_revision_provenance/migration.sql` — read it first.

```sql
-- AlterTable: which curriculum revision an extraction was taken from.
-- Nullable with NO backfill, deliberately. Existing rows stay NULL, and an
-- unrevised programme resolves its run revision to NULL too, so `NULL = NULL`
-- matches and the phase-1 guards keep skipping at $0. Backfilling to anything
-- else — or treating "missing" as "stale" — would regenerate 332 digests,
-- 283 faculty lists and 309 skill extractions on the next --all run.
ALTER TABLE "ai_extractions" ADD COLUMN "program_revision_id" TEXT;

-- CreateIndex: the guard's lookup is
-- (source_entity_type, source_entity_id, extraction_kind, program_revision_id).
CREATE INDEX "ai_extractions_source_entity_type_source_entity_id_extract_idx"
  ON "ai_extractions"("source_entity_type", "source_entity_id", "extraction_kind", "program_revision_id");

-- AddForeignKey: SET NULL, matching the ten provenance FKs — deleting a
-- revision degrades its extractions to the pre-feature baseline rather than
-- cascading away real audit rows.
ALTER TABLE "ai_extractions" ADD CONSTRAINT "ai_extractions_program_revision_id_fkey"
  FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
```

**The index name must match what Prisma would generate**, or `migrate diff` reports permanent drift. Prisma truncates long generated names to 63 characters. After applying, Step 5 checks this — if it reports drift on the index, rename it to exactly what Prisma expects and re-apply.

- [ ] **Step 4: Apply and regenerate the client**

```bash
cd /home/denpong/projects/program-landscape/packages/db
npx prisma migrate deploy
npx prisma generate
```

Expected: one migration applied, client regenerated.

- [ ] **Step 5: Check for NEW drift**

```bash
cd /home/denpong/projects/program-landscape/packages/db
npx prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --script 2>&1 | head -40
```

This repo has **~20 pre-existing drift entries** documented since 2026-08-25 (`verdict_snapshots` enum types, `mv_refresh_log`, some dropped indexes). Those are expected. What must NOT appear is anything mentioning `ai_extractions` or `program_revision_id`. Report exactly what you see and whether any new entry references those.

- [ ] **Step 6: Typecheck**

```bash
cd /home/denpong/projects/program-landscape/packages/db && npx tsc --noEmit
cd ../../apps/ingestion && npx tsc --noEmit
```
Expected: both clean.

- [ ] **Step 7: Commit**

```bash
cd /home/denpong/projects/program-landscape
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260903150000_ai_extraction_program_revision/migration.sql
git commit -m "feat(db): revision provenance on ai_extractions"
```

---

### Task 2: Stamp the column on write

**MUST land before Task 3.** See the ordering warning above.

**Files:**
- Modify: `apps/ingestion/src/program-digest/run.ts`
- Modify: `apps/ingestion/src/program-faculty/run.ts`
- Modify: `apps/ingestion/src/program-skills/run.ts`

All three build their row with `prisma.aiExtraction.create({ data: { sourceEntityType: 'program', sourceEntityId: program.id, extractionKind: '…', … } })` — at roughly `program-digest/run.ts:183`, `program-faculty/run.ts:332`, `program-skills/run.ts:236`.

- [ ] **Step 1: Import the helper**

Each file already imports from `@kku/db`. Add `activeRevisionIdFor` to that import (the pedagogy runner already uses it — see `program-pedagogy/run.ts:159` for the reference call).

- [ ] **Step 2: Resolve and stamp, in all three**

Immediately before each `create`, resolve the value; then add the field to `data`. For `program-digest/run.ts`:

```ts
  // Stamp the revision this extraction was taken from, so the guard above
  // can tell a current extraction from one taken off a superseded มคอ.2.
  // Resolved here rather than passed in: these runners are also invoked
  // standalone from the CLI, not only from the pipeline.
  const programRevisionId = await activeRevisionIdFor(program.id);

  const created = await prisma.aiExtraction.create({
    data: {
      sourceEntityType: 'program',
      sourceEntityId: program.id,
      extractionKind: 'PROGRAM_DIGEST',
      programRevisionId,
      payloadJson: response.parsed as object,
      …unchanged…
    },
    select: { id: true },
```

Apply the same to `program-faculty/run.ts` (`PROGRAM_FACULTY_LIST`) and `program-skills/run.ts` (`PROGRAM_SKILLS_DETAILED`), keeping each file's existing field ordering and payload shape untouched. Shorten the comment in the second and third to a pointer rather than repeating it.

- [ ] **Step 3: Confirm you changed exactly three call sites**

```bash
cd /home/denpong/projects/program-landscape
grep -rn "programRevisionId" apps/ingestion/src/program-digest/run.ts apps/ingestion/src/program-faculty/run.ts apps/ingestion/src/program-skills/run.ts
grep -rn "aiExtraction.create" packages/db/src apps/ingestion/src | grep -v node_modules
```

The second command lists **nine** `aiExtraction.create` sites. Only the three above may have gained a stamp. Confirm the other six are untouched: `program-digest-materialize.ts` (PROPOSED_SKILL), `program-courses-extract/run.ts`, `imd-rankings-extract/run.ts`, and three in `ai-jobs/handlers.ts`.

- [ ] **Step 4: Verify**

```bash
cd /home/denpong/projects/program-landscape/apps/ingestion
npx tsc --noEmit
npx eslint 'src/program-digest/run.ts' 'src/program-faculty/run.ts' 'src/program-skills/run.ts'
```
Expected: clean.

- [ ] **Step 5: Commit**

```bash
cd /home/denpong/projects/program-landscape
git add apps/ingestion/src/program-digest/run.ts apps/ingestion/src/program-faculty/run.ts apps/ingestion/src/program-skills/run.ts
git commit -m "feat(ingestion): stamp the curriculum revision on programme extractions"
```

---

### Task 3: Scope the guards to the revision

**Only start once Task 2 is committed.**

**Files:**
- Modify: `apps/ingestion/src/program-digest/run.ts`
- Modify: `apps/ingestion/src/program-faculty/run.ts`
- Modify: `apps/ingestion/src/program-skills/run.ts`
- Modify: `apps/ingestion/src/program-pedagogy/run.ts`

- [ ] **Step 1: The three extraction guards**

Each currently reads (digest shown, at ~line 96):

```ts
  if (!params.force) {
    const existing = await prisma.aiExtraction.findFirst({
      where: {
        sourceEntityType: 'program',
        sourceEntityId: program.id,
        extractionKind: 'PROGRAM_DIGEST',
      },
      select: { id: true },
    });
    if (existing) {
      return { status: 'SKIPPED', reason: 'PROGRAM_DIGEST already exists; pass force=true to re-run' };
    }
  }
```

Change to:

```ts
  if (!params.force) {
    // Scoped to the revision this run is analysing. A revised curriculum
    // leaves the old extraction stamped with the superseded revision (or
    // NULL, pre-feature), so it no longer matches and the digest is retaken
    // from the new มคอ.2. An unrevised programme resolves to NULL, matches
    // its existing NULL row, and skips at $0 exactly as before.
    const existing = await prisma.aiExtraction.findFirst({
      where: {
        sourceEntityType: 'program',
        sourceEntityId: program.id,
        extractionKind: 'PROGRAM_DIGEST',
        programRevisionId: await activeRevisionIdFor(program.id),
      },
      select: { id: true },
    });
    if (existing) {
      return {
        status: 'SKIPPED',
        reason: 'PROGRAM_DIGEST already exists for the current curriculum revision; pass force=true to re-run',
      };
    }
  }
```

Prefer resolving `activeRevisionIdFor(program.id)` **once** into a local near the top and reusing it in both the guard and the Task 2 stamp, rather than calling it twice per run. Say which you did.

Apply the same shape to faculty (`PROGRAM_FACULTY_LIST`) and skills (`PROGRAM_SKILLS_DETAILED`), updating each SKIPPED reason string to match.

- [ ] **Step 2: The pedagogy guard**

`program-pedagogy/run.ts` at ~line 78 guards differently — on its own table, which already has the column:

```ts
  if (!params.force) {
    const existing = await prisma.programPedagogyAssessment.findUnique({
      where: { programId: program.id },
      select: { methodVersion: true },
    });
    if (existing && existing.methodVersion === PROGRAM_PEDAGOGY_VERSION) {
```

Add the revision to the select and the condition:

```ts
  if (!params.force) {
    const existing = await prisma.programPedagogyAssessment.findUnique({
      where: { programId: program.id },
      select: { methodVersion: true, programRevisionId: true },
    });
    // Two independent reasons to re-run: a newer prompt version, or a newer
    // curriculum. The row is unique per programme and the writer below
    // re-stamps programRevisionId in BOTH upsert branches, so this converges.
    const currentRevisionId = await activeRevisionIdFor(program.id);
    if (
      existing &&
      existing.methodVersion === PROGRAM_PEDAGOGY_VERSION &&
      existing.programRevisionId === currentRevisionId
    ) {
```

Update its SKIPPED reason string to mention the revision too. **Do not change the upsert** — it already re-stamps on update, which is what makes this converge.

- [ ] **Step 3: Verify**

```bash
cd /home/denpong/projects/program-landscape/apps/ingestion
npx tsc --noEmit
npx eslint 'src/program-digest/run.ts' 'src/program-faculty/run.ts' 'src/program-skills/run.ts' 'src/program-pedagogy/run.ts'
```
Expected: clean.

- [ ] **Step 4: Commit**

```bash
cd /home/denpong/projects/program-landscape
git add apps/ingestion/src/program-digest/run.ts apps/ingestion/src/program-faculty/run.ts apps/ingestion/src/program-skills/run.ts apps/ingestion/src/program-pedagogy/run.ts
git commit -m "fix(ingestion): phase-1 regenerates when the curriculum revision changed"
```

---

### Task 4: Tests

**Files:**
- Create: `apps/ingestion/test/phase1-revision-guard.test.ts`

Model it on `apps/ingestion/test/programs-pipeline-revision-guard.test.ts` (committed `cad7d9d`) — read that first and match its structure.

**⚠ Do NOT write `vi.mock('@kku/db', async () => ({ ...await vi.importActual('@kku/db'), prisma: mock }))`.** The `importActual` spread binds the real `prisma` and the test silently queries the live development database — the bug found in `packages/db/test/health-score.test.ts` on 2026-09-02, where five tests had been passing against real data. Use a plain object literal.

- [ ] **Step 1: Write the tests**

Cover four behaviours:

1. the guard passes the run's revision into the where-clause alongside `sourceEntityType` / `sourceEntityId` / `extractionKind`
2. an unrevised programme queries `programRevisionId: null` and finds its existing row → skip (the cost-neutrality property)
3. a row belonging to a superseded revision does not match → regenerate
4. **the writer stamps the same value the guard compares** — the round-trip. Assert `aiExtraction.create` is called with a `data.programRevisionId` equal to what `activeRevisionIdFor` returned. Without this, a stamp-on-write regression makes the phase regenerate on every run forever, which is the expensive failure mode.

Also assert the guard filters by explicit `extractionKind`, so a future change cannot widen it to all `sourceEntityType: 'program'` rows and sweep in `PROPOSED_SKILL`.

- [ ] **Step 2: Run**

```bash
cd /home/denpong/projects/program-landscape/apps/ingestion
npx vitest run test/phase1-revision-guard.test.ts
```
Expected: all pass. Paste actual output.

- [ ] **Step 3: Prove the tests are not vacuous**

Temporarily delete `programRevisionId` from your test helper's where-clause, re-run, confirm failures; restore. Then temporarily drop it from the helper's `create` data, re-run, confirm the round-trip test fails; restore. Report both. A guard test that passes with the guard removed is worthless — this project has shipped two such tests.

- [ ] **Step 4: Confirm the mock holds**

```bash
cd /home/denpong/projects/program-landscape/apps/ingestion
DATABASE_URL="postgresql://x:x@127.0.0.1:1/none" npx vitest run test/phase1-revision-guard.test.ts
```
Expected: still passing. If it hangs or errors on connection, the mock is bypassed — fix it rather than skipping.

- [ ] **Step 5: Full suite**

```bash
cd /home/denpong/projects/program-landscape/apps/ingestion && npx vitest run 2>&1 | tail -4
cd ../../packages/db && npx vitest run 2>&1 | tail -4
```

- [ ] **Step 6: Commit**

```bash
cd /home/denpong/projects/program-landscape
git add apps/ingestion/test/phase1-revision-guard.test.ts
git commit -m "test(ingestion): phase-1 guard scopes to the curriculum revision"
```

---

### Task 5: Verify against the real database

**Files:** none — operational.

The dev database is **shared**; another operator was working in it earlier today. Before starting:

```bash
cd /home/denpong/projects/program-landscape
docker exec program-landscape-redis redis-cli LLEN bull:ai-jobs:active
docker exec program-landscape-redis redis-cli LLEN bull:ai-jobs:wait
```

Both must be `0`. If not, wait — **do not kill workers.**

- [ ] **Step 1: Baseline**

```bash
cd /home/denpong/projects/program-landscape/packages/db
npx tsx -e "
import { prisma } from './src/index';
(async () => {
  const revd = await prisma.program.findMany({ where:{ activeRevisionId:{ not:null } }, select:{ id:true, code:true, activeRevisionId:true } });
  console.log('revised programmes:', revd.map(p=>p.code+' → '+p.activeRevisionId).join(' | '));
  for (const kind of ['PROGRAM_DIGEST','PROGRAM_FACULTY_LIST','PROGRAM_SKILLS_DETAILED']) {
    console.log(kind, 'total=', await prisma.aiExtraction.count({ where:{ sourceEntityType:'program', extractionKind:kind } }));
  }
  console.log('PROPOSED_SKILL total=', await prisma.aiExtraction.count({ where:{ extractionKind:'PROPOSED_SKILL' } }));
  await prisma.\$disconnect();
})();
"
```

Record every number. As of 2026-09-03: 2 revised programmes (`KKU-SEQ-0019`, `KKU-SEQ-0060`); digest 332, faculty 283, skills 309, PROPOSED_SKILL 4167.

- [ ] **Step 2: Regeneration on a revised programme**

```bash
cd /home/denpong/projects/program-landscape
pnpm programs:pipeline KKU-SEQ-0019 --only=phase1
```

Expected: digest, faculty, skills and pedagogy all **run and report a cost** — not `skip`.

- [ ] **Step 3: Convergence — the assertion that catches a runaway**

Re-run the identical command immediately.

Expected: **all four now `skip` at $0.** If they regenerate again, the stamp is not being written (Task 2 regressed or was skipped) — an `--all` would then re-analyse ~300 programmes every run. Revert and report rather than continuing.

- [ ] **Step 4: Cost neutrality on an unrevised programme**

Pick one with `activeRevisionId = NULL` that already has all three extraction kinds:

```bash
cd /home/denpong/projects/program-landscape/packages/db
npx tsx -e "
import { prisma } from './src/index';
(async () => {
  const ps = await prisma.program.findMany({ where:{ activeRevisionId:null }, select:{ id:true, code:true }, take:400 });
  for (const p of ps) {
    const n = await prisma.aiExtraction.count({ where:{ sourceEntityType:'program', sourceEntityId:p.id,
      extractionKind:{ in:['PROGRAM_DIGEST','PROGRAM_FACULTY_LIST','PROGRAM_SKILLS_DETAILED'] } } });
    if (n >= 3) { console.log('CODE=' + p.code); break; }
  }
  await prisma.\$disconnect();
})();
"
```

Run `--only=phase1` on that code. Expected: **all skip at $0.**

- [ ] **Step 5: Quantify the `--all` blast radius**

Count how many programmes would regenerate, rather than inferring it from two samples:

```bash
cd /home/denpong/projects/program-landscape/packages/db
npx tsx -e "
import { prisma } from './src/index';
(async () => {
  const progs = await prisma.program.findMany({ select:{ id:true, code:true, activeRevisionId:true } });
  for (const kind of ['PROGRAM_DIGEST','PROGRAM_FACULTY_LIST','PROGRAM_SKILLS_DETAILED']) {
    let skip=0, regen=0, absent=0; const codes:string[]=[];
    for (const p of progs) {
      const cur = await prisma.aiExtraction.findFirst({ where:{ sourceEntityType:'program', sourceEntityId:p.id, extractionKind:kind, programRevisionId:p.activeRevisionId }, select:{ id:true } });
      const any = await prisma.aiExtraction.count({ where:{ sourceEntityType:'program', sourceEntityId:p.id, extractionKind:kind } });
      if (cur) skip++; else if (any>0) { regen++; codes.push(p.code); } else absent++;
    }
    console.log(kind.padEnd(24), 'skip=' + skip, 'REGENERATE=' + regen, 'no-row=' + absent, JSON.stringify(codes));
  }
  await prisma.\$disconnect();
})();
"
```

Expected: `REGENERATE` is a small number naming only genuinely revised programmes. **If it is in the hundreds, the no-backfill assumption has broken — stop and report.**

- [ ] **Step 6: Confirm the blast radius stayed contained**

Re-run Step 1's counts. `PROPOSED_SKILL` must be **unchanged at 4167** (a digest regeneration adds proposals only for genuinely new skills; a large jump means the materialiser is duplicating). Then confirm the newest row of each kind on `KKU-SEQ-0019` carries `programRevisionId` equal to its `activeRevisionId`, and that a `program.metadata.ai_overwrite` audit row was written for the re-materialised digest.

- [ ] **Step 7: Report**

State plainly: what regenerated, what skipped, actual cost per run, whether Step 3's convergence and Step 4's cost-neutrality held, the Step 5 counts, and whether `PROPOSED_SKILL` moved. No commit.

---

## Self-Review

**Spec coverage:** the migration → Task 1; stamping the three kinds → Task 2; the three guards + pedagogy → Task 3; the "stamp on create but not update" risk → Task 3 Step 2 (pedagogy's upsert left alone, with the reason) and Task 4 Step 1 case 4; the `sourceEntityType` ≠ "curriculum extraction" risk → Task 2 Step 3 and Task 4 Step 1; every verification bullet → Task 5. The spec's non-goals (force semantics, backfill, per-analysis UI, phase2b, `PROPOSED_SKILL`, `PROGRAM_COURSES_EXTRACT`, auto-approve threshold) are each named as untouched.

**Placeholder scan:** no TBD/TODO. Every code step carries the real before/after. Line numbers are approximate with a grep to locate, since these files are edited by other work.

**Type consistency:** `programRevisionId` is `String?` in Prisma and `string | null` in TS — the exact return type of `activeRevisionIdFor(programId): Promise<string | null>` — so it is valid both as a `create` value and as a `findFirst` filter. The same name is used for the schema field, the migration column (`program_revision_id`), the stamp in Task 2 and the filter in Task 3.

**Ordering:** Task 1 → 2 → 3 is mandatory and the reason is stated at the top. Task 4 depends on 1-3. Task 5 must run last.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-03-revision-aware-regeneration-tier2.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
