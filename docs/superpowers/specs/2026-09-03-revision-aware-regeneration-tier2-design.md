# Revision-aware regeneration, Tier 2 — design

**Date:** 2026-09-03
**Status:** approved for planning
**Surface:** `AiExtraction` (new column), the three phase-1 extraction runners, and the pedagogy runner's guard.

## Why this exists

Tier 1 (shipped `0e89605`) made phaseRE and phaseCR regenerate when a programme's curriculum is revised. The phase-1 family still does not.

On **KKU-SEQ-0019** — whose มคอ.2 was replaced พ.ศ. 2565 → 2570 — a full pipeline run reported:

```
✓ phase1 PDF extraction   digest=skip faculty=skip skills=skip pedagogy=skip
```

Each of those guards asks *"does an extraction of this kind exist for this programme?"* with no reference to which PDF produced it. So the programme carries 2570 curriculum metadata alongside a digest, faculty list and skill set extracted from the 2565 document. The only escape is `--force`, and the admin UI's "Run pipeline" button sends `force: false`.

This is the more consequential half of the problem. `PROGRAM_DIGEST` does not stay in its own table: approving it runs `materialiseProgramDigest()`, which writes Program columns (nameEn, degree fields, totalCredits, durationYears, language, recruitmentSummaryTh) and creates `ProgramSkill` rows. A stale digest therefore propagates into the programme record that every Council-facing surface reads.

## What the investigation changed

The Tier 1 spec assumed all four phase-1 runners needed the same migration. Reading them says otherwise, and the corrected scope is roughly half the work:

| Runner | Guard reads | Provenance today | Needs the migration? |
|---|---|---|---|
| `runProgramDigest` | `AiExtraction` / `PROGRAM_DIGEST` | none | **yes** |
| `runProgramFacultyExtraction` | `AiExtraction` / `PROGRAM_FACULTY_LIST` | none | **yes** |
| `runProgramSkillsDetailed` | `AiExtraction` / `PROGRAM_SKILLS_DETAILED` | none | **yes** |
| `runProgramPedagogy` | `ProgramPedagogyAssessment` | **already has `programRevisionId`** | no |
| `runProgramCoursesExtract` (phase2b) | — no guard at all | n/a | no — nothing to fix |

**Pedagogy is a Tier 1-shaped fix that was mis-scoped.** It guards on `programPedagogyAssessment.findUnique({ where: { programId } })` comparing `methodVersion`, and that table already carries `programRevisionId`. It also `upsert`s on a `@unique` programId and — verified — re-stamps `programRevisionId` in the **update** branch, not only on create, so it converges. It should ship with the three, but it needs no schema change.

**phase2b has no skip-if-exists guard and takes no `force`.** It re-extracts on every run, guarded only by whether the `รายวิชา` section can be located. It was never part of this problem.

## The change

### Schema

Add one nullable column to `AiExtraction`:

```prisma
programRevisionId String? @map("program_revision_id")
```

with an index on `(sourceEntityType, sourceEntityId, extractionKind, programRevisionId)` to keep the guard's lookup cheap, and **no backfill**.

No-backfill is the load-bearing choice, exactly as in Tier 1. Existing rows stay NULL; unrevised programmes resolve `runRevisionId` to NULL; `NULL === NULL` matches and they skip. Backfilling to anything else — or treating "missing provenance" as "stale" — would regenerate 332 digests, 283 faculty lists and 309 skill extractions on the next `--all`, at roughly $0.04 per digest alone.

### Guards

In each of the three runners, add `programRevisionId: runRevisionId` to the existing `findFirst` where-clause, leaving the `if (!params.force)` wrapper untouched. Each runner already receives `programId`; it resolves the value with `activeRevisionIdFor(programId)`, the same helper Tier 1 used.

Pedagogy's guard gains the same comparison against its existing column: regenerate when `existing.programRevisionId !== runRevisionId`, in addition to the current `methodVersion` check.

### Which writers stamp the column

Only the three program-sourced extraction kinds above. Explicitly **not**:

- `COURSE_SKILLS`, `JOB_POSTING_SKILLS`, `POLICY_DOC_ANALYSIS` (`ai-jobs/handlers.ts`) and the IMD rankings kind — none is programme-scoped; they keep NULL forever.
- **`PROPOSED_SKILL`** (4,167 rows, written by `program-digest-materialize.ts`). It carries `sourceEntityType: 'program'`, so a naive "stamp everything program-sourced" rule would sweep it in. It is a downstream artifact of a digest rather than an extraction of the curriculum, nothing guards on it, and it already records lineage via `methodVersion`. Leave it alone.
- `PROGRAM_COURSES_EXTRACT` (42 rows). Programme-sourced, but phase2b has no guard, so a stamp would be informational only. Out of scope; revisit if phase2b ever gains one.

## Consequences worth stating plainly

**A regenerated digest rewrites the programme record, automatically.** `AI_AUTO_APPROVE_THRESHOLD` defaults to `0`, so every extraction auto-approves and materialises inline. On a revised programme the new digest will therefore update Program columns and add `ProgramSkill` rows without a human step. That is the intended mechanism for a revised curriculum to reach the programme record, and it is recorded — `materialiseProgramDigest()` writes `metadataProposalJson` on the revision plus a `program.metadata.ai_overwrite` audit row. It is still a real behavioural change and should be called out at rollout rather than discovered.

**Accretion is safe.** `AiExtraction` is insert-only, so regenerating leaves the previous row behind. Both consumers in `programs.service.ts` (lines ~1141 and ~1294) rank with `ROW_NUMBER() OVER (PARTITION BY source_entity_id ORDER BY created_at DESC) … WHERE rn = 1`, so the newest wins — the same property that made Tier 1 safe.

**Blast radius today is 2 programmes.** Only `KKU-SEQ-0019` and `KKU-SEQ-0060` have `activeRevisionId` set. Each holds 3 rows per kind (6 across the two), all NULL-provenance, so each kind regenerates once per programme. The other 299 skip. Cost grows only as real curricula are revised.

## Risks

**A writer that stamps on create but not on update never converges.** Pedagogy already gets this right and says so in a comment. The three extraction writers use `create` only, so they cannot hit it — but any later move to `upsert` must re-stamp in both branches. This failure mode is silent: the phase regenerates on every run forever, and an `--all` would re-analyse the portfolio each time.

**`sourceEntityType: 'program'` is not the same set as "programme curriculum extraction".** `PROPOSED_SKILL` proves it. Any implementation that filters writers by `sourceEntityType` alone rather than by explicit `extractionKind` will stamp the wrong rows.

**The column is nullable and mostly NULL, so a wrong guard fails silently toward skipping** — the current bug — rather than erroring. Verification must prove regeneration happens, not merely that nothing broke.

## Verification

- A revised programme (`KKU-SEQ-0019`) runs `--only=phase1`: digest, faculty, skills and pedagogy all **regenerate** rather than reporting `skip`.
- Re-running the identical command immediately: all four **skip at $0**. Convergence — without this, an `--all` re-analyses everything every run.
- An unrevised programme with existing rows: all four still skip at $0. Cost neutrality.
- After regeneration, the newest row of each kind carries `programRevisionId` equal to the programme's `activeRevisionId`.
- Counted across all 301 programmes, the number that would regenerate on `--all` is **2**, not ~300.
- `PROPOSED_SKILL` rows still have `programRevisionId IS NULL` and their count is unchanged by a regeneration run.
- `prisma migrate diff` reports no drift after the migration is applied.
- A programme whose digest regenerates shows an updated Program record **and** a matching `program.metadata.ai_overwrite` audit row.

## Non-goals

- **No change to `force` semantics.** It remains "regenerate regardless".
- **No backfill of existing rows**, and no retro-regeneration of the 2 affected programmes beyond their next ordinary pipeline run.
- **No per-analysis staleness UI.** Once this lands, a mismatched row regenerates on the next run instead of lingering.
- **No guard for phase2b**, and no stamp on `PROGRAM_COURSES_EXTRACT` or `PROPOSED_SKILL`.
- **No change to the auto-approve threshold**, whose interaction with regeneration is documented above rather than altered.
