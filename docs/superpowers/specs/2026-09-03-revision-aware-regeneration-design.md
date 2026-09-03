# Revision-aware regeneration — design

**Date:** 2026-09-03
**Status:** approved for planning
**Surface:** the skip-if-exists guards in `apps/ingestion/src/scripts/programs-pipeline.ts` and the phase-1 runners.

## Why this exists

The curriculum-submission flow can now attach a revised มคอ.2 to an existing programme and fire the pipeline. Verified end to end on **KKU-SEQ-0019** (บัญชีบัณฑิต นานาชาติ, พ.ศ. 2565 → 2570) on 2026-09-03: the document was attached, the revision adopted, the previous one marked `SUPERSEDED`, and the staleness banner cleared.

**But the analyses did not refresh.** The same run reported:

```
✓ phase1  PDF extraction   digest=skip faculty=skip skills=skip pedagogy=skip
✓ phaseRE research expertise   skipped: row already exists
✓ phaseCR curriculum revision  skipped: row already exists
```

Every one of those skipped on a programme whose curriculum had just been replaced. Measured afterwards on that programme:

| Row | Generated | Provenance |
|---|---|---|
| `ProgramResearchExpertise` | 2026-08-17 | `programRevisionId = NULL` (pre-revision baseline) |
| `ProgramCurriculumRevision` | 2026-09-03 08:45 | the now-**superseded** revision |

So the programme presents 2570 curriculum metadata alongside analyses derived from the 2565 document, and `programRevisionStaleness()` returns `stale: false` — because staleness tracks the *document*, not the analyses. Nothing anywhere says the analysis is out of date.

This defeats the point of the revision feature: the output most likely to change when a curriculum changes is precisely the output that is pinned to the old one.

## The rule

A skip-if-exists guard currently asks **"does a row exist?"**. It should ask **"does a row exist *for the revision this run is analysing*?"**

```
skip   when  existingRow.programRevisionId === program.activeRevisionId
regenerate  otherwise
```

Everything the rule needs already exists. `adoptPendingRevision()` runs at line 320 of `programs-pipeline.ts`, **before every phase**, so by the time any guard evaluates, `activeRevisionId` is already the revision this run is analysing. It returns `null` and writes nothing when there is no pending revision, so unrevised programmes are untouched.

### Why this is nearly free today

Measured 2026-09-03:

- **2** programmes have `activeRevisionId` set; **299** have `NULL`.
- All **254** `ProgramResearchExpertise` rows carry `programRevisionId = NULL`.
- **6** `ProgramCurriculumRevision` rows: 5 NULL, 1 superseded.

For the 299 unrevised programmes the comparison is `NULL === NULL` → skip, exactly as today. **A full `--all` re-run costs no more than it does now.** Only genuinely revised programmes regenerate, and only once per revision. The cost grows in step with real curriculum revisions, which is the correct shape.

This is the load-bearing property: a naive "regenerate when provenance is missing" rule would instead re-run 254 research-expertise analyses on the next `--all`.

## Scope: two tiers, split by whether provenance exists

Ten tables carry `programRevisionId` (`ProgramCourse`, `ProgramFaculty`, `ProgramSkill`, `ProgramPeerSelection`, `ProgramPeerReview`, `ProgramAiReadinessAssessment`, `ProgramPedagogyAssessment`, `ProgramStrategicNarrative`, `ProgramResearchExpertise`, `ProgramCurriculumRevision`). `AiExtraction` does **not**, and it has no PDF reference either — only `sourceEntityType` / `sourceEntityId` / `extractionKind`. That split decides the work.

### Tier 1 — phaseRE and phaseCR (no migration)

Both guards read tables that already carry `programRevisionId`. Change each `findFirst` to filter on the current `activeRevisionId` and regenerate on mismatch.

These two are also the only phases in the pipeline with **no `--force` escape hatch at all** — the code comments state *"there is no --force override. Re-analysis is an explicit operator action."* Today that operator action does not exist, so these rows are unreachable by any pipeline invocation once written. Tier 1 restores a path to regeneration without reintroducing the accretion the insert-only posture was protecting against, because the guard still skips whenever the revision is unchanged.

Blast radius today: 2 programmes.

### Tier 2 — the phase-1 family (needs a migration)

`runProgramDigest`, `runProgramFacultyExtraction`, `runProgramSkillsDetailed`, `runProgramPedagogy` all guard on an `AiExtraction` row and accept `force`. Their skip is on the existence of *any* extraction of that kind for the programme, regardless of which PDF produced it — so a revised programme keeps its old digest unless someone passes `--force`, and the admin UI's "Run pipeline" button sends `force: false`.

This is the more consequential half: `PROGRAM_DIGEST` materialises into Program columns and `ProgramSkill`, so a stale digest propagates into the programme record itself.

Fixing it properly means adding `programRevisionId` to `AiExtraction` and stamping it on the program-sourced kinds. Current volumes: `PROGRAM_DIGEST` 332, `PROGRAM_SKILLS_DETAILED` 309, `PROGRAM_FACULTY_LIST` 283, `PROGRAM_COURSES_EXTRACT` 42, plus 4,167 `PROPOSED_SKILL` rows that are not program-revision-scoped and should be left alone.

**Tier 2 is deliberately not bundled with Tier 1.** It touches a shared table with non-programme writers, needs a backfill decision for 966 existing program rows, and carries real regeneration cost once enabled. Tier 1 is a two-line change with a 2-programme blast radius and should not wait for it.

### Explicitly out of scope

- **`force: true` semantics.** Unchanged. It remains the operator's "regenerate regardless" override.
- **Per-analysis staleness in the UI.** Once Tier 1 lands, a mismatched row regenerates on the next run rather than lingering, so a per-section "this analysis predates the current curriculum" badge is a separate question. Worth revisiting only if a surface needs to warn *before* the pipeline runs.
- **Retro-fixing existing stale rows.** KKU-SEQ-0019's two rows regenerate on its next pipeline run once Tier 1 lands. No backfill script.
- **`ProgramCourse` (phase2b).** All 3,922 rows carry NULL provenance, and phase2b skipped on KKU-SEQ-0019 for an unrelated content reason (could not locate the `รายวิชา` section). Its guard should be reviewed under Tier 2, not assumed.

## Risks

**The adopt-before-phases ordering is load-bearing.** If `adoptPendingRevision()` ever moves after the phases, every guard silently compares against the *previous* revision and skips exactly when it should regenerate — reproducing today's bug with no error. The call site needs a comment saying so, and the pipeline's phase ordering is already documented as "source order IS execution order".

**`markRevisionAnalysed()` at the end (line 728) is unaffected** — it closes out the revision the run adopted, which is the same one the guards compared against.

**A failed mid-run leaves mixed provenance.** If a run regenerates phaseRE and then fails before phaseCR, the programme holds one row at the new revision and one at the old. The next run regenerates only the stale one, which is correct and self-healing.

## Verification

- On a programme with no pending revision, a full run still reports `skipped: row already exists` for phaseRE/phaseCR and makes no AI call. Confirm cost is unchanged.
- On KKU-SEQ-0019 (already revised, both rows stale): a run regenerates both, and afterwards each row's `programRevisionId` equals the programme's `activeRevisionId`.
- Immediately re-running the same programme skips both again at $0 — proving the guard converges rather than regenerating every run.
- A unit test that a row whose `programRevisionId` differs from `activeRevisionId` is treated as absent, and one where they match is treated as present. Mock the counts; do **not** use `vi.importActual` on `../src/index` (it binds the real prisma and the test silently hits the live database).
