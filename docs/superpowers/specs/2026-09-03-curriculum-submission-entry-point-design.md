# Curriculum submission entry point — design (Project 1.5)

**Date:** 2026-09-03
**Status:** approved for planning
**Surface:** `/admin/programs/from-pdf` reworked into one submission page; three buttons collapse to one; one new Group 1 tile.

## Why this exists

`/admin/programs` currently shows **three buttons that all add a programme**, pointing at only **two** destinations:

| Where | Label | Destination |
|---|---|---|
| Page header | New from PDF | `/admin/programs/from-pdf` |
| Page header | New blank | `/admin/programs/new` |
| Toolbar above the table | Add new program | `/admin/programs/new` ← same page |
| Empty state (conditional) | New program | `/admin/programs/new` ← same page |

Three labels, two things, nothing indicating that two of them are identical.

Meanwhile **there is no entry point at all for revising an existing programme**. A revision means: find the programme in the list, open it, go to the Files tab, attach, then run the pipeline. Nothing in the UI names that as an operation.

And every programme requires a มคอ.2 — the entire analysis pipeline reads it. So "New blank" is not a peer option; it creates a canonical, pipeline-eligible programme with no document, which the pipeline then skips. **21 programmes currently have no curriculum document.**

## What this project does

One page, entered from two places, handling both operations:

- **New programme** — upload the มคอ.2, review the extracted identity, create, analyse.
- **Revision** — pick the existing programme, upload the new มคอ.2, attach it as current, analyse.

Plus: delete blank-create, collapse the duplicate buttons, add a Group 1 tile, and fix four defects found while mapping this.

## The decision that shapes everything: the branch is declared, not inferred

An obvious design would be to let the existing collision panel drive the branch — it already lists matching programmes with links, and turning each row into "attach as a revision of this one" looks like the smallest change.

**It does not work.** Verified against `checkCollision` in `apps/api/src/programs/programs.service.ts`:

- A revised มคอ.2 normally carries a **different code** (the curriculum year changes, e.g. `…-2565` → `…-2570`), so the `same_code` rule never fires.
- The `same_name_th` / `same_name_en` rules both require `facultyId && level` to be set server-side.
- `facultyId` is auto-populated in the wizard only by `faculties.find(f => f.nameTh.includes(payload.facultyNameTh))` — a substring match on an AI-extracted faculty name.

When that substring match misses, `facultyId` is empty, the name clauses are dropped, and **a genuine revision renders a green "no collisions — safe to create" panel**. Inferring the branch from collisions would therefore fail precisely on the case this project exists to serve, and fail silently, in the direction that creates a duplicate programme.

So: **step 1 asks.** New programme, or revision of an existing one. Choosing revision opens a programme picker. Everything after that is shared.

**Two signals already extracted and currently invisible in the UI** are used as a cross-check, not as the decision: `payload.isRevision` and `payload.previousCurriculumYearBE` both flow into `Program` via `applyExtractionId` today but are never shown. If the operator declares "new programme" and the extraction says `isRevision: true`, the page says so and asks them to confirm. It never switches the mode by itself.

## Flow

### Shared: upload and extract
Unchanged from the existing wizard, which handles this well and should be preserved rather than rewritten:
- `POST /api/admin-pdfs/upload` with `sourceCategoryHint: 'CURRICULUM'`, `language: 'TH'`.
- Poll `GET /api/admin-pdfs-detail/:id` every 1.5 s to a 60 s ceiling, accepting only a `CURRICULUM_SPEC` extraction at `methodVersion === 'gemini-v1'` with `confidence > 0` — the version gate is what stops stub/heuristic payloads pre-filling the form.
- Dedup short-circuit: a re-uploaded known PDF arrives `ready` with no polling.
- Retry via `POST /api/admin-pdfs-re-extract/:id`.
- The existing "you can start filling the form; anything you type will be kept" behaviour, and the late-arrival re-seed that never clobbers typed input, are both preserved.

### New-programme mode
Identity form (code, names, faculty, department, level, year established), live collision panel with the force checkbox, then `POST /api/admin-programs` with `attachPdfId` + `applyExtractionId`. Unchanged from today except for the fixes below.

### Revision mode
Programme picker → upload → confirm → **`POST /api/admin-programs/:id/documents`** with `{ pdfDocumentId, role: 'CURRENT_CURRICULUM', promoteToCurrent: true, curriculumYearBE }`.

**Deliberately NOT `apply-extraction`.** That endpoint is a superset — it attaches *and* overwrites the programme's header columns from the payload. In this project a revision attaches the document only; the metadata update happens when the pipeline re-digests the new PDF, which is now *recorded* (`metadataProposalJson` on the revision plus a `program.metadata.ai_overwrite` audit row). Using `apply-extraction` here would overwrite curated fields at attach time with no record and no diff — exactly what Project 2's approval gate exists to prevent. Attaching only keeps this project honest and defers nothing that matters.

`attachDocument()` already opens a DRAFT revision, is idempotent on `(programId, pdfDocumentId)`, and demotes the prior current document to `PREVIOUS_CURRICULUM`.

### Both modes: fire the pipeline
`POST /api/admin-programs/:id/run-pipeline` with `{ force: false }` — full run, no `phases`.

**This closes an existing gap.** `/admin/programs/from-pdf` fires the pipeline **nowhere** — verified, its only network calls are upload, detail-poll, collision-check, re-extract and create. A programme created there today gets header fields and no analysis until somebody manually runs it. `/admin/programs/new` does fire it (`firePipeline`, called only when a PDF was attached), so deleting `new` without porting this would make the regression universal.

Failure is non-fatal, matching `new`'s existing posture: warn, keep the programme, let the operator retry from the detail page.

## Four defects fixed on the way past

**1. A new programme accuses itself of being stale.** `create()` now calls `openDraftRevision()`, so a freshly created programme immediately renders the amber banner: *"A revised curriculum file was attached … and has not been analysed. Every AI section still reflects the previous file."* For a programme with no previous file, that copy is nonsense. Firing the pipeline resolves it (the revision advances to `APPROVED`), but only if the pipeline actually runs — which today, via from-pdf, it does not. Fix both: fire the pipeline, and make the banner's copy distinguish "never analysed" from "analysed against an older document". The `unanalysed-revision` reason already carries `pendingCurriculumYearBE`; a programme whose revision is its *first* needs different wording.

**2. `HIGHER_GRAD_DIPLOMA` is missing from the from-pdf level select.** Verified: the value appears three times in `from-pdf/client.tsx` — all in *type unions* (the form-state type, the payload type, and the lazy initialiser cast) — while the `<select>` offers only `BACHELOR`, `MASTER`, `DOCTORAL`. So the type accepts it and an extraction can seed it, but the operator can neither choose it nor see it, and the select renders blank when seeded with it. `new/client.tsx` does offer it. Deleting `new` without adding the option is silent data loss for higher-graduate-diploma programmes.

**3. `curriculumYearBE` is displayed but not editable.** The wizard shows `totalCredits`, `durationYears` and `curriculumYear` as plain text. For a revision, `curriculumYearBE` is both the most likely to be wrong and the most consequential — it is written onto the `ProgramDocument` *and* the `ProgramRevision`. `AttachProgramDocumentSchema` accepts it explicitly (2400–2700). Make it an input in revision mode.

**4. The test added in the last project reads `new/client.tsx` off disk.** `apps/web/test/pdf-upload-response-shape.test.ts` `readFileSync`s that path; deleting the file throws ENOENT. Remove that entry in the same commit.

## Removals

- `/admin/programs/new` — the page and its client. Blank-create dies with it; see below.
- The two header buttons on `/admin/programs`, replaced by one.
- The "Add new program" toolbar button — the `showing N of M programs` count beside it must survive.
- The empty-state "New program" action, or repointed at the new page.

**Blank-create is removed deliberately.** A programme without a มคอ.2 cannot be analysed, and creating one produced a row that looked complete in every list while being permanently unanalysable. The API keeps supporting it (`attachPdfId` is optional on `POST /api/admin-programs`), so the capability survives for scripts and for a future deliberate escape hatch — it simply stops being a peer button that operators reach for by accident.

The 21 existing document-less programmes are unaffected and remain visible through the existing `missing-pdf` pipeline bucket.

## The Group 1 tile

Group 1's caption states the principle: *"one tile, one destination."* It has one tile today, and its code comment says the list page "owns the 'Add new program' affordance … instead of a separate tile" — a decision this project reverses, so that comment must be updated or the next reader will re-collapse it.

Second tile, matching the existing `ConsoleTile` shape (`href`, `label`, `description`, `icon` required; `meta`, `badge`, `tone`, `roles` optional):

- **Submit curriculum file** → the unified page.
- Badge: `${dataStats.programs.missingCurriculumPdf} missing` with `tone: 'warning'` — the number is **already fetched on that page**, no new round-trip. Keep badge labels short; the tile's own comment records that badge and hover-arrow used to collide.

## Also worth fixing while in these files

The copy says **297 programmes** in three places (`programs/page.tsx` subtitle, `admin/page.tsx` tile description, and the pipeline confirm text). The real count is **301**.

## Non-goals

- **No metadata diff, no per-field accept/reject, no approve→promote.** Project 2.
- **No draft deep-dive at `?revision=<id>`.** Project 3.
- **No `programId @unique` migrations.** Project 2, with the feature that needs them.
- **No change to `checkCollision`.** Its blindness to revisions is documented above and routed around by declaring the branch; making it revision-aware is a separate question.
- **No resume-after-refresh.** The 60 s poll ceiling and lost-state-on-navigate-away are pre-existing and unchanged; worth revisiting if operators hit them on larger files.

## Verification

- `/admin/programs` shows exactly **one** create button; the `showing N of M` count still renders.
- `/admin/programs/new` returns 404 and is linked from nowhere; the upload-response test passes.
- New-programme mode: creates the programme, attaches the PDF as `CURRENT_CURRICULUM`, opens a DRAFT revision, **fires the pipeline**, and the resulting detail page does **not** show a nonsensical "revised file" banner.
- Revision mode: attaches to the chosen programme, demotes the prior document to `PREVIOUS_CURRICULUM`, opens exactly one DRAFT revision (re-attaching the same PDF opens none), fires the pipeline, and the staleness banner clears once it completes.
- `HIGHER_GRAD_DIPLOMA` is selectable and round-trips.
- `curriculumYearBE` entered in revision mode lands on both the `ProgramDocument` and the `ProgramRevision`.
- The Group 1 tile renders with the missing-curriculum badge and navigates correctly.
- A programme with 0 documents is still reachable through the `missing-pdf` bucket.
