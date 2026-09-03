# Program revision staging — foundation (Project 1 of 3)

**Date:** 2026-09-03
**Status:** approved for planning
**Surface:** backend + two admin banners. No new page.

## Why this exists

A programme's curriculum document (มคอ.2) gets revised. Today, uploading the revised file at
`/admin/programs/[id]?tab=files` does **not** re-analyse anything, and nothing anywhere says so.

Traced definitively on 2026-09-03:

- `attachDocument()` (`apps/api/src/programs/programs.service.ts:620-671`) is a pure transaction —
  demote the prior current document, upsert the new `ProgramDocument`. It never touches
  `this.aiJobs`. The only `enqueue` calls in that service are inside `enqueueDigest*` /
  `enqueuePipeline*`, reachable solely from the explicit `run-digest` / `run-pipeline` endpoints.
- The PDF-intake runner chains follow-on work only for `POLICY`/`REPORT` categories
  (`apps/ingestion/src/pdf-intake/pipeline/runner.ts:250`). A `CURRICULUM` PDF chains nothing.
- The toast the operator sees — *"Extraction is running in the background"* — refers only to a
  header-field `CURRICULUM_SPEC` extraction (degree names, credits, majors). It produces no
  `AiExtraction`, no skills, no narrative, no readiness, no peers.

**So every AI section of the deep-dive keeps rendering analysis of the superseded PDF, silently,
until somebody happens to click "Run pipeline".** The toast actively reinforces the false
impression that re-analysis occurred.

And it cannot be detected after the fact: **no generated analysis records which document produced
it.** `AiExtraction.sourceEntityId` is the *programme* id, not the PDF id
(`apps/ingestion/src/program-digest/run.ts:184-186`). There is no FK anywhere from a generated
analysis back to its source document. You cannot ask "was this narrative built from the 2024
มคอ.2 or the 2019 one?" — only compare timestamps heuristically.

This project makes a revision a first-class thing, gives every generated analysis a pointer to the
document it came from, surfaces staleness, and stops a second silent-damage bug on the way past.

## Scope: this is Project 1 of 3

| | Delivers |
|---|---|
| **Project 1 — this spec** | Revision entity, source-document provenance on all generated output, staleness visible, metadata overwrite made auditable, one upload bug fixed |
| Project 2 | Submission page (new + revision), "Analyse revision" trigger, field-by-field metadata diff, AI sections side-by-side, skills/courses delta, approve → promote. **Includes the four `programId @unique` migrations** that let a draft coexist with live |
| Project 3 | Full draft deep-dive at `?revision=<id>` across ~20 read endpoints |

The four unique-key migrations are deliberately **not** in Project 1. They are the riskiest change
in the whole programme of work and are only needed once a draft must physically coexist with a live
row — which is Project 2's feature. Project 1 records provenance; it does not yet support two
concurrent versions.

**Forward decision already taken** (applies in Project 2, recorded here so it isn't relitigated):
when a revision's metadata differs from curated values, the diff pre-selects **accept**, with
per-field opt-out. A new มคอ.2 is usually authoritative for degree names and credits.

## Component 1 — the revision entity

New model. **`Curriculum` is deliberately not reused** despite being already migrated with
`version`, `effectiveYear`, `sourcePdfId` and `status DRAFT|ACTIVE|ARCHIVED`
(`packages/db/prisma/schema.prisma:886-906`, written by nothing but `seed.ts`). Its status enum has
no `IN_REVIEW`/`REJECTED`, its `totalCredits` is non-null (wrong for a revision not yet analysed),
and its `courses` relation implies the course materialisation this project explicitly does not do.
Reusing an ill-fitting model because its migration exists is how the flat `ProgramCourse` table came
to shadow `Curriculum` in the first place. `Curriculum` stays untouched; removing it is separate
housekeeping.

```prisma
enum ProgramRevisionStatus {
  DRAFT       // file attached, not yet analysed
  ANALYSING   // pipeline running against it
  IN_REVIEW   // analysed, awaiting human approval        (Project 2)
  APPROVED    // promoted to live                          (Project 2)
  REJECTED    // reviewer declined                         (Project 2)
  SUPERSEDED  // a later revision was approved over it
}

model ProgramRevision {
  id                  String   @id @default(cuid())
  programId           String   @map("program_id")
  /// The มคอ.2 this revision analyses. Nullable so a revision can be
  /// opened before its file is attached.
  sourcePdfDocumentId String?  @map("source_pdf_document_id")
  curriculumYearBE    Int?     @map("curriculum_year_be")
  status              ProgramRevisionStatus @default(DRAFT)
  notes               String?
  /// Proposed Program-column values from this revision's digest, and the
  /// values they would replace. Written instead of a silent overwrite —
  /// see Component 4. Project 2 turns this into the approval diff.
  metadataProposalJson Json?   @map("metadata_proposal_json")
  createdById         String?  @map("created_by_id")
  createdAt           DateTime @default(now()) @map("created_at")
  approvedById        String?  @map("approved_by_id")
  approvedAt          DateTime? @map("approved_at")

  program        Program      @relation(fields: [programId], references: [id], onDelete: Cascade)
  sourcePdf      PdfDocument? @relation(fields: [sourcePdfDocumentId], references: [id], onDelete: SetNull)
  createdBy      User?        @relation("ProgramRevisionCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  approvedBy     User?        @relation("ProgramRevisionApprovedBy", fields: [approvedById], references: [id], onDelete: SetNull)

  @@index([programId, createdAt])
  @@index([status])
  @@map("program_revisions")
}
```

`Program` gains:

```prisma
  /// Which revision the currently-live analyses belong to. NULL means the
  /// pre-feature baseline (analyses generated before revisions existed).
  activeRevisionId String? @map("active_revision_id")
```

**Correction, made during implementation (2026-09-03):** an earlier draft of this spec said to make
this a plain nullable id with no relation and no FK, "to avoid a circular required-relation problem
at create time". That reasoning was wrong and two independent reviews caught it. Nobody needed a
*required* relation — an **optional** one is a standard Prisma pattern, and the insert order is
identical either way (create Program with NULL → create the revision → UPDATE the programme).

Leaving it a bare scalar had two real costs: `activeRevisionId` ended up with **no FK constraint at
all**, so nothing stopped it pointing at a nonexistent revision or one belonging to a different
programme; and a database FK that Prisma cannot see is reported by `migrate diff` as
`DROP CONSTRAINT` **permanently**, so anyone later running `prisma migrate dev` would generate a
migration silently deleting it. This repo already carries ~20 documented drift entries described as
work worth doing "before it causes a real incident" — deliberately adding more was the wrong
direction.

So: `activeRevisionId` is `@unique` (a revision belongs to one programme, so it can never be active
for two) with an optional `activeRevision` relation, and the ten provenance columns each carry an
optional relation too. Cost: eleven back-relation fields on `ProgramRevision`, which is unremarkable
in a schema where `Program` already carries dozens. Benefit: real referential integrity and **zero**
drift, both verified.

## Component 2 — provenance on generated output

A nullable `programRevisionId` column on every table the pipeline writes per programme:

**AI-generated analyses (7):** `ProgramStrategicNarrative`, `ProgramAiReadinessAssessment`,
`ProgramPedagogyAssessment`, `ProgramPeerReview`, `ProgramResearchExpertise`,
`ProgramCurriculumRevision`, `ProgramPeerSelection`.

**PDF-derived facts (3):** `ProgramSkill`, `ProgramCourse`, `ProgramFaculty`.

All nullable, no unique-key changes, no backfill. Existing rows keep `NULL`, which reads as *"the
pre-feature baseline"* — the same thing `Program.activeRevisionId = NULL` means. The two agree by
construction.

The pipeline stamps the programme's `activeRevisionId` onto everything it writes. In Project 1 that
is pure provenance: there is still exactly one live row per programme per table, so nothing about
read paths changes. What changes is that from now on **you can ask which document produced any
given analysis** — the question that is unanswerable today.

Adding the column to all ten tables now, rather than only where Project 1 strictly needs it, avoids
a second schema migration over the same tables in Project 2.

## Component 3 — attaching a curriculum PDF opens a DRAFT revision

`attachDocument()` gains one behaviour: when the attached document's role is `CURRENT_CURRICULUM`
and it is being promoted to current, create a `ProgramRevision` in `DRAFT` pointing at that
`PdfDocument`, carrying the document's `curriculumYearBE`.

It still does **not** run the pipeline — that is the "ask first, then run" posture chosen for this
design. The DRAFT row is what makes the staleness banner (Component 5) possible and what Project 2's
"Analyse revision" button will target.

Idempotency: attaching the same `PdfDocument` to the same programme twice must not open a second
DRAFT. Guard on `(programId, sourcePdfDocumentId)` having no existing non-terminal revision.

`create()` (`programs.service.ts:316`) gets the same treatment when a programme is created with a
PDF attached, so a new programme starts with a revision rather than a NULL baseline.

## Component 4 — make the metadata overwrite auditable

`materialiseProgramDigest()` (`packages/db/src/program-digest-materialize.ts:102-115`) writes nine
`Program` columns: `nameEn`, `degreeNameTh`, `degreeNameEn`, `degreeAbbrTh`, `degreeAbbrEn`,
`totalCredits`, `durationYears`, `language`, `recruitmentSummaryTh`.

Its guard is `if (payload.<field>)` — *"is the AI value non-empty"*. It is **not** "is the existing
value empty" and **not** "was this field human-edited". The function's own comment claims it avoids
overwriting human-curated values; what it actually does is overwrite them whenever the AI has an
opinion. Worse, it runs inside the ingestion worker with no HTTP request, so the `@AuditLog`
interceptor never fires — **the overwrite leaves no trace whatsoever.**

Compounding it: `AI_AUTO_APPROVE_THRESHOLD` defaults to `0`
(`apps/ingestion/src/program-digest/run.ts:175`), so digests auto-approve and materialise inline
with no human gate at all.

**Project 1's fix is visibility, not gating.** Gating without a diff UI would simply block every
digest. So:

- Before writing, capture the current value of each of the nine columns.
- Write `metadataProposalJson` onto the programme's revision: for each field, `{ field, current,
  proposed, applied: true }`.
- Write an `AuditLog` row explicitly (the interceptor cannot fire here — there is no request), with
  a distinct action such as `program.metadata.ai_overwrite`, `entityType: 'Program'`, and the
  before/after pairs in `payloadJson`. This is the first field-level delta recorded anywhere in the
  system.
- Keep applying the values, exactly as today. Behaviour is unchanged; what changes is that it is now
  recorded and reviewable.

Project 2 flips `applied` to a decision the reviewer makes.

**Note on `AuditLog.userId`:** it is nullable, and this write has no user. Leave it null and let the
action name carry the meaning — an AI-driven change genuinely has no human actor, and inventing one
would be worse than recording none.

## Component 5 — staleness becomes visible

A programme is **stale** when the `PdfDocument` behind its live analyses is not the document
currently marked `role='CURRENT_CURRICULUM', isCurrent=true`.

Concretely, stale when either holds:
- a `ProgramRevision` exists in `DRAFT` or `IN_REVIEW` for the programme, or
- `Program.activeRevisionId` is set and its `sourcePdfDocumentId` differs from the current document.

A programme whose analyses predate the feature (`activeRevisionId IS NULL`) with no draft revision
is **not** stale — it is simply un-revisioned, and flagging every programme on day one would train
operators to ignore the banner.

Surfaced in two places:
- `/admin/programs/[id]` — a banner naming the uploaded file, its date, and that analysis has not
  been re-run, with the existing "Run pipeline" affordance alongside it.
- The Deep-Dive — a quieter notice that the analysis reflects an earlier curriculum. This one is
  Council-facing, so it states the fact without implying the analysis is wrong.

A shared helper computes the verdict once so the two surfaces cannot disagree.

## Component 6 — fix the broken new-programme upload

`apps/web/app/admin/programs/new/client.tsx:161` reads `uploaded[0]?.pdfDocument?.id`. The API
returns `{ pdfDocumentId, deduplicated, enqueued }` (`apps/api/src/pdf-intake/pdf-intake.service.ts:61`).
There is no `pdfDocument` object, so the guard on the next line throws *"PDF upload returned no
document id"* — **after** the PDF has been uploaded and its row created. The programme is never
created and an orphan `PdfDocument` is left behind.

Two sibling call sites read the field correctly (`[id]/client.tsx:824` and
`from-pdf/client.tsx:225`), which is why the bug survived: the pattern is right everywhere except
here.

One-line fix, plus a regression test asserting the field name against the service's return type.

## Non-goals

- **No coexisting draft and live rows.** The four `programId @unique` migrations
  (`ProgramStrategicNarrative`, `ProgramAiReadinessAssessment`, `ProgramPedagogyAssessment`,
  `ProgramPeerReview`) belong to Project 2, with the feature that needs them.
- **No submission page, no diff UI, no approval gate, no `?revision=` deep-dive.**
- **No automatic pipeline run on upload.** Deliberate — "ask first, then run".
- **No backfill of `programRevisionId` on existing rows.** NULL is a meaningful value here.
- **No change to `Curriculum`.** Left untouched; its removal is separate housekeeping.
- **No per-field "human edited" provenance flag.** The chosen Project 2 default (accept-all,
  opt-out) does not need one.

## Verification

- Attaching a `CURRENT_CURRICULUM` PDF opens exactly one `DRAFT` revision; attaching the same
  document again opens none.
- Running the pipeline stamps `programRevisionId` on rows in all ten tables, and the stamped value
  matches the programme's `activeRevisionId`.
- A programme with a newly-attached, un-analysed file shows the staleness banner in admin and the
  notice on the deep-dive; a programme with no revision at all shows neither.
- A digest that changes a curated field writes both a `metadataProposalJson` entry and an
  `AuditLog` row carrying the before/after pair — verified by editing a field by hand, re-running
  the digest, and reading back the audit row.
- Creating a programme with a PDF attached succeeds and leaves no orphan `PdfDocument`.
- Existing programmes with no revision continue to render identically — all ten new columns NULL,
  no read path altered.
