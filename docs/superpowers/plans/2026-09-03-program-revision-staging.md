# Program Revision Staging — Implementation Plan (Project 1 of 3)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a curriculum revision a first-class entity, stamp every generated per-programme analysis with the document it came from, surface staleness that is currently invisible, make a silent metadata overwrite auditable, and fix an upload bug that orphans PDFs.

**Architecture:** One new `ProgramRevision` model plus a nullable `Program.activeRevisionId`. A nullable `programRevisionId` column on the ten tables the pipeline writes per programme, stamped at write time by a single shared helper so twelve call sites cannot drift. Attaching a curriculum PDF opens a DRAFT revision without running anything. No read path changes.

**Tech Stack:** TypeScript strict, Prisma/PostgreSQL, NestJS, Next.js 14, Vitest.

**Spec:** `docs/superpowers/specs/2026-09-03-program-revision-staging-design.md`

---

## Why this project exists (read before starting)

Uploading a revised มคอ.2 at `/admin/programs/[id]?tab=files` **does not re-analyse anything**, and nothing tells the operator. `attachDocument()` never touches the job queue; the PDF-intake runner only chains follow-on work for `POLICY`/`REPORT` categories. The toast that appears — *"Extraction is running in the background"* — refers only to a header-field extraction, which makes it worse: it implies re-analysis happened.

So every AI section of the deep-dive keeps rendering the superseded PDF's analysis, silently, forever. And it is undetectable after the fact because **no generated analysis records which document produced it**.

That last fact is what this project fixes first, because nothing else is possible without it.

---

## File structure

| File | Responsibility |
|---|---|
| `packages/db/prisma/schema.prisma` | `ProgramRevision`, `ProgramRevisionStatus`, `Program.activeRevisionId`, ten `programRevisionId` columns |
| `packages/db/prisma/migrations/20260903120000_program_revision/migration.sql` | The entity |
| `packages/db/prisma/migrations/20260903130000_program_revision_provenance/migration.sql` | The ten columns |
| `packages/db/src/program-revision.ts` | **Create** — `activeRevisionIdFor()`, `openDraftRevision()`, `programRevisionStaleness()`. The single owner of revision logic |
| `packages/db/test/program-revision.test.ts` | **Create** — unit tests for the above |
| `packages/db/test/program-revision-stamping.test.ts` | **Create** — the drift guard: every writer stamps |
| 7 analysis runners + 5 fact writers | **Modify** — one stamping line each |
| `packages/db/src/program-digest-materialize.ts` | **Modify** — metadata proposal + audit row |
| `apps/api/src/programs/programs.service.ts` | **Modify** — `attachDocument()` and `create()` open a DRAFT revision |
| `apps/api/src/programs/deep-dive.controller.ts` | **Modify** — staleness on the overview response |
| `apps/web/app/admin/programs/[id]/client.tsx` | **Modify** — admin banner |
| `apps/web/app/programs/[id]/client.tsx` | **Modify** — deep-dive notice |
| `apps/web/app/admin/programs/new/client.tsx` | **Modify** — the one-line upload bug |

---

### Task 1: The `ProgramRevision` entity

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260903120000_program_revision/migration.sql`

- [ ] **Step 1: Add the enum and model to the Prisma schema**

Place the enum next to the other program-related enums, and the model after `ProgramDocument`:

```prisma
enum ProgramRevisionStatus {
  DRAFT       // file attached, not yet analysed
  ANALYSING   // pipeline running against it
  IN_REVIEW   // analysed, awaiting human approval (Project 2)
  APPROVED    // promoted to live (Project 2)
  REJECTED    // reviewer declined (Project 2)
  SUPERSEDED  // a later revision was approved over it
}

/// One curriculum revision of a programme — the envelope a มคอ.2 and its
/// generated analyses belong to.
///
/// Deliberately NOT the existing `Curriculum` model: that one's status enum
/// has no IN_REVIEW/REJECTED, its totalCredits is non-null (wrong for a
/// revision not yet analysed), and its `courses` relation implies course
/// materialisation this project does not do. `Curriculum` is unused (seed
/// only) and is left alone.
model ProgramRevision {
  id                   String                @id @default(cuid())
  programId            String                @map("program_id")
  /// The มคอ.2 this revision analyses. Nullable so a revision can be opened
  /// before its file is attached.
  sourcePdfDocumentId  String?               @map("source_pdf_document_id")
  curriculumYearBE     Int?                  @map("curriculum_year_be")
  status               ProgramRevisionStatus @default(DRAFT)
  notes                String?
  /// Proposed Program-column values from this revision's digest, and the
  /// values they replaced. Written instead of a silent overwrite — see
  /// program-digest-materialize.ts. Project 2 turns this into the diff.
  metadataProposalJson Json?                 @map("metadata_proposal_json")
  createdById          String?               @map("created_by_id")
  createdAt            DateTime              @default(now()) @map("created_at")
  approvedById         String?               @map("approved_by_id")
  approvedAt           DateTime?             @map("approved_at")

  program    Program      @relation(fields: [programId], references: [id], onDelete: Cascade)
  sourcePdf  PdfDocument? @relation(fields: [sourcePdfDocumentId], references: [id], onDelete: SetNull)
  createdBy  User?        @relation("ProgramRevisionCreatedBy", fields: [createdById], references: [id], onDelete: SetNull)
  approvedBy User?        @relation("ProgramRevisionApprovedBy", fields: [approvedById], references: [id], onDelete: SetNull)

  @@index([programId, createdAt])
  @@index([status])
  @@map("program_revisions")
}
```

Add to `model Program`:

```prisma
  /// Which revision the currently-live analyses belong to. NULL means the
  /// pre-feature baseline (analyses generated before revisions existed).
  ///
  /// Deliberately a plain nullable id, NOT a Prisma relation: a required
  /// back-relation would create a circular dependency at create time
  /// (a Program needs a revision, a revision needs a Program). Resolved in
  /// code via activeRevisionIdFor(). Do not "fix" this into a relation.
  activeRevisionId String? @map("active_revision_id")

  revisions ProgramRevision[]
```

Add the two back-relations to `model User`:

```prisma
  programRevisionsCreated  ProgramRevision[] @relation("ProgramRevisionCreatedBy")
  programRevisionsApproved ProgramRevision[] @relation("ProgramRevisionApprovedBy")
```

And to `model PdfDocument`:

```prisma
  programRevisions ProgramRevision[]
```

- [ ] **Step 2: Write the migration by hand**

`prisma migrate dev` needs a TTY this environment lacks — this is the project's documented non-interactive workflow (CLAUDE.md). Create `packages/db/prisma/migrations/20260903120000_program_revision/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "ProgramRevisionStatus" AS ENUM ('DRAFT', 'ANALYSING', 'IN_REVIEW', 'APPROVED', 'REJECTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "program_revisions" (
    "id" TEXT NOT NULL,
    "program_id" TEXT NOT NULL,
    "source_pdf_document_id" TEXT,
    "curriculum_year_be" INTEGER,
    "status" "ProgramRevisionStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "metadata_proposal_json" JSONB,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_by_id" TEXT,
    "approved_at" TIMESTAMP(3),

    CONSTRAINT "program_revisions_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "programs" ADD COLUMN "active_revision_id" TEXT;

-- CreateIndex
CREATE INDEX "program_revisions_program_id_created_at_idx" ON "program_revisions"("program_id", "created_at");

-- CreateIndex
CREATE INDEX "program_revisions_status_idx" ON "program_revisions"("status");

-- AddForeignKey
ALTER TABLE "program_revisions" ADD CONSTRAINT "program_revisions_program_id_fkey" FOREIGN KEY ("program_id") REFERENCES "programs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_revisions" ADD CONSTRAINT "program_revisions_source_pdf_document_id_fkey" FOREIGN KEY ("source_pdf_document_id") REFERENCES "pdf_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_revisions" ADD CONSTRAINT "program_revisions_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_revisions" ADD CONSTRAINT "program_revisions_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

Verify the referenced table names against a recent migration before applying — `programs`, `pdf_documents`, `users` are the expected `@@map` names, but confirm rather than assume.

- [ ] **Step 3: Apply**

Run: `cd packages/db && npx prisma migrate deploy && npx prisma generate`
Expected: `Applied migration 20260903120000_program_revision`, client regenerated.

- [ ] **Step 4: Verify the shape live**

```bash
cd packages/db && npx tsx -e "
import { prisma } from './src/index';
(async () => {
  console.log('revisions:', await prisma.programRevision.count());
  const cols: any = await prisma.\$queryRaw\`SELECT column_name, is_nullable FROM information_schema.columns WHERE table_name='program_revisions' ORDER BY ordinal_position\`;
  console.table(cols);
  const p: any = await prisma.\$queryRaw\`SELECT column_name FROM information_schema.columns WHERE table_name='programs' AND column_name='active_revision_id'\`;
  console.log('programs.active_revision_id:', p);
  await prisma.\$disconnect();
})();
"
```
Expected: `revisions: 0`, 11 columns with `program_id`/`status`/`created_at` NOT NULL and the rest nullable, and `active_revision_id` present.

- [ ] **Step 5: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260903120000_program_revision
git commit -m "feat(db): add ProgramRevision entity"
```

---

### Task 2: Provenance columns on the ten generated tables

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/20260903130000_program_revision_provenance/migration.sql`

- [ ] **Step 1: Add the column to all ten models**

Add to each of `ProgramStrategicNarrative`, `ProgramAiReadinessAssessment`, `ProgramPedagogyAssessment`, `ProgramPeerReview`, `ProgramResearchExpertise`, `ProgramCurriculumRevision`, `ProgramPeerSelection`, `ProgramSkill`, `ProgramCourse`, `ProgramFaculty`:

```prisma
  /// Which curriculum revision produced this row. NULL is the pre-feature
  /// baseline — it agrees by construction with Program.activeRevisionId
  /// also being NULL. No unique key changes here: Project 1 records
  /// provenance only; making a draft coexist with a live row is Project 2.
  programRevisionId String? @map("program_revision_id")
```

**Do not add a Prisma relation field.** A relation on ten models means ten back-relations on `ProgramRevision` for no benefit — nothing reads them. Plain nullable id plus a database-level FK is enough, and keeps `ProgramRevision` readable. State that in the comment.

- [ ] **Step 2: Write the migration**

Create `packages/db/prisma/migrations/20260903130000_program_revision_provenance/migration.sql`. Confirm each table's real `@@map` name from `schema.prisma` before writing — several differ from the model name:

```sql
-- AlterTable: provenance column on every table the pipeline writes per programme.
ALTER TABLE "program_strategic_narratives"     ADD COLUMN "program_revision_id" TEXT;
ALTER TABLE "program_ai_readiness_assessments" ADD COLUMN "program_revision_id" TEXT;
ALTER TABLE "program_pedagogy_assessments"     ADD COLUMN "program_revision_id" TEXT;
ALTER TABLE "program_peer_reviews"             ADD COLUMN "program_revision_id" TEXT;
ALTER TABLE "program_research_expertise"       ADD COLUMN "program_revision_id" TEXT;
ALTER TABLE "program_curriculum_revisions"     ADD COLUMN "program_revision_id" TEXT;
ALTER TABLE "program_peer_selections"          ADD COLUMN "program_revision_id" TEXT;
ALTER TABLE "program_skills"                   ADD COLUMN "program_revision_id" TEXT;
ALTER TABLE "program_courses"                  ADD COLUMN "program_revision_id" TEXT;
ALTER TABLE "program_faculties"                ADD COLUMN "program_revision_id" TEXT;

-- Indexes: every read that filters by revision will pair it with programId.
CREATE INDEX "program_strategic_narratives_program_revision_id_idx"     ON "program_strategic_narratives"("program_revision_id");
CREATE INDEX "program_ai_readiness_assessments_program_revision_id_idx" ON "program_ai_readiness_assessments"("program_revision_id");
CREATE INDEX "program_pedagogy_assessments_program_revision_id_idx"     ON "program_pedagogy_assessments"("program_revision_id");
CREATE INDEX "program_peer_reviews_program_revision_id_idx"             ON "program_peer_reviews"("program_revision_id");
CREATE INDEX "program_research_expertise_program_revision_id_idx"       ON "program_research_expertise"("program_revision_id");
CREATE INDEX "program_curriculum_revisions_program_revision_id_idx"     ON "program_curriculum_revisions"("program_revision_id");
CREATE INDEX "program_peer_selections_program_revision_id_idx"          ON "program_peer_selections"("program_revision_id");
CREATE INDEX "program_skills_program_revision_id_idx"                   ON "program_skills"("program_revision_id");
CREATE INDEX "program_courses_program_revision_id_idx"                  ON "program_courses"("program_revision_id");
CREATE INDEX "program_faculties_program_revision_id_idx"                ON "program_faculties"("program_revision_id");

-- FKs: SET NULL, so deleting a revision degrades its rows to the
-- pre-feature baseline rather than cascading away real analysis.
ALTER TABLE "program_strategic_narratives"     ADD CONSTRAINT "program_strategic_narratives_program_revision_id_fkey"     FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_ai_readiness_assessments" ADD CONSTRAINT "program_ai_readiness_assessments_program_revision_id_fkey" FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_pedagogy_assessments"     ADD CONSTRAINT "program_pedagogy_assessments_program_revision_id_fkey"     FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_peer_reviews"             ADD CONSTRAINT "program_peer_reviews_program_revision_id_fkey"             FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_research_expertise"       ADD CONSTRAINT "program_research_expertise_program_revision_id_fkey"       FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_curriculum_revisions"     ADD CONSTRAINT "program_curriculum_revisions_program_revision_id_fkey"     FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_peer_selections"          ADD CONSTRAINT "program_peer_selections_program_revision_id_fkey"          FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_skills"                   ADD CONSTRAINT "program_skills_program_revision_id_fkey"                   FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_courses"                  ADD CONSTRAINT "program_courses_program_revision_id_fkey"                  FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "program_faculties"                ADD CONSTRAINT "program_faculties_program_revision_id_fkey"                FOREIGN KEY ("program_revision_id") REFERENCES "program_revisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: Apply and verify no existing data moved**

Run: `cd packages/db && npx prisma migrate deploy && npx prisma generate`

```bash
cd packages/db && npx tsx -e "
import { prisma } from './src/index';
(async () => {
  const t = ['program_strategic_narratives','program_ai_readiness_assessments','program_pedagogy_assessments','program_peer_reviews','program_research_expertise','program_curriculum_revisions','program_peer_selections','program_skills','program_courses','program_faculties'];
  for (const n of t) {
    const r: any = await prisma.\$queryRawUnsafe(\`SELECT count(*)::int AS total, count(program_revision_id)::int AS stamped FROM \"\${n}\"\`);
    console.log(n.padEnd(36), 'rows', String(r[0].total).padStart(6), 'stamped', r[0].stamped);
  }
  await prisma.\$disconnect();
})();
"
```
Expected: every table reports `stamped 0` and its existing row count unchanged. A nonzero `stamped` before Task 4 would mean the migration did something it shouldn't.

- [ ] **Step 4: Commit**

```bash
git add packages/db/prisma/schema.prisma packages/db/prisma/migrations/20260903130000_program_revision_provenance
git commit -m "feat(db): add programRevisionId provenance to generated tables"
```

---

### Task 3: The revision helper module

**Files:**
- Create: `packages/db/src/program-revision.ts`
- Create: `packages/db/test/program-revision.test.ts`
- Modify: `packages/db/src/index.ts`

This module is the single owner of revision logic. Twelve write sites will call `activeRevisionIdFor`; two surfaces will call `programRevisionStaleness`. Centralising them is deliberate — the phase-list bug in this codebase (five hand-kept copies, one of which silently went missing for its whole lifetime) is the failure mode being designed out.

- [ ] **Step 1: Write the failing test**

```typescript
// packages/db/test/program-revision.test.ts
import { describe, it, expect, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  programFindUnique: vi.fn(),
  revisionFindFirst: vi.fn(),
  revisionCreate: vi.fn(),
  documentFindFirst: vi.fn(),
}));

// NO vi.importActual spread — index.ts re-exports the module under test, so
// importActual would load the real graph bound to the real prisma and the
// mock would be bypassed. (That exact bug was found in health-score.test.ts
// on 2026-09-02: 5 tests were passing against the live DB.)
vi.mock('../src/index', () => ({
  prisma: {
    program: { findUnique: mocks.programFindUnique },
    programRevision: { findFirst: mocks.revisionFindFirst, create: mocks.revisionCreate },
    programDocument: { findFirst: mocks.documentFindFirst },
  },
}));

import { activeRevisionIdFor, programRevisionStaleness } from '../src/program-revision';

describe('activeRevisionIdFor', () => {
  it('returns the programme active revision id', async () => {
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: 'rev1' });
    expect(await activeRevisionIdFor('p1')).toBe('rev1');
  });

  it('returns null for a pre-feature programme', async () => {
    // NULL is meaningful — it is the baseline, not an error.
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: null });
    expect(await activeRevisionIdFor('p1')).toBeNull();
  });

  it('returns null rather than throwing when the programme is missing', async () => {
    // Callers are write paths mid-pipeline; a missing programme should not
    // abort a run that is about to fail on its own FK anyway.
    mocks.programFindUnique.mockResolvedValue(null);
    expect(await activeRevisionIdFor('nope')).toBeNull();
  });
});

describe('programRevisionStaleness', () => {
  it('is stale when an un-analysed DRAFT revision exists', async () => {
    mocks.revisionFindFirst.mockResolvedValue({
      id: 'rev2', status: 'DRAFT', createdAt: new Date('2026-09-01'),
      sourcePdfDocumentId: 'pdfNEW', curriculumYearBE: 2567,
    });
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: null });
    mocks.documentFindFirst.mockResolvedValue(null);
    const r = await programRevisionStaleness('p1');
    expect(r.stale).toBe(true);
    expect(r.reason).toBe('unanalysed-revision');
  });

  it('is stale when the live analyses came from a superseded document', async () => {
    mocks.revisionFindFirst.mockResolvedValue(null);
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: 'rev1' });
    mocks.documentFindFirst.mockResolvedValue({ pdfDocumentId: 'pdfNEW', attachedAt: new Date('2026-09-01') });
    const r = await programRevisionStaleness('p1', { activeRevisionSourcePdfId: 'pdfOLD' });
    expect(r.stale).toBe(true);
    expect(r.reason).toBe('superseded-document');
  });

  it('is NOT stale for a pre-feature programme with no revision at all', async () => {
    // Flagging all 301 programmes on day one would train operators to
    // ignore the banner. Un-revisioned is not the same as stale.
    mocks.revisionFindFirst.mockResolvedValue(null);
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: null });
    mocks.documentFindFirst.mockResolvedValue({ pdfDocumentId: 'pdfONLY', attachedAt: new Date('2026-01-01') });
    const r = await programRevisionStaleness('p1');
    expect(r.stale).toBe(false);
    expect(r.reason).toBe('none');
  });

  it('is NOT stale when the live revision matches the current document', async () => {
    mocks.revisionFindFirst.mockResolvedValue(null);
    mocks.programFindUnique.mockResolvedValue({ activeRevisionId: 'rev1' });
    mocks.documentFindFirst.mockResolvedValue({ pdfDocumentId: 'pdfSAME', attachedAt: new Date('2026-01-01') });
    const r = await programRevisionStaleness('p1', { activeRevisionSourcePdfId: 'pdfSAME' });
    expect(r.stale).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd packages/db && npx vitest run test/program-revision.test.ts`
Expected: FAIL — cannot resolve `../src/program-revision`.

- [ ] **Step 3: Write the module**

```typescript
// packages/db/src/program-revision.ts
import { prisma } from './index';

// ─────────────────────────────────────────────────────────────────────────────
// Single owner of curriculum-revision logic.
//
// Twelve write sites across packages/db and apps/ingestion call
// activeRevisionIdFor() to stamp provenance; two UI surfaces call
// programRevisionStaleness(). They are centralised here on purpose: this
// codebase has already been bitten by a hand-maintained list living in five
// files, one copy of which silently went missing for its entire lifetime.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The revision the programme's live analyses belong to, or null for the
 * pre-feature baseline.
 *
 * Returns null rather than throwing on a missing programme: every caller is
 * a write path mid-pipeline, and a run that references a nonexistent
 * programme will fail on its own foreign key with a better message than
 * anything this helper could raise.
 */
export async function activeRevisionIdFor(programId: string): Promise<string | null> {
  const p = await prisma.program.findUnique({
    where: { id: programId },
    select: { activeRevisionId: true },
  });
  return p?.activeRevisionId ?? null;
}

export type StalenessReason = 'none' | 'unanalysed-revision' | 'superseded-document';

export interface ProgramStaleness {
  stale: boolean;
  reason: StalenessReason;
  /** The revision awaiting analysis, when reason is 'unanalysed-revision'. */
  pendingRevisionId: string | null;
  /** BE year of the newer curriculum, for the banner copy. */
  pendingCurriculumYearBE: number | null;
  /** When the newer document was attached, for the banner copy. */
  pendingAttachedAt: Date | null;
}

/**
 * Is a programme's live analysis out of date with respect to its current
 * curriculum document?
 *
 * Stale when EITHER a revision is sitting un-analysed, OR the live analyses
 * were generated from a document that is no longer the current one.
 *
 * Deliberately NOT stale when a programme simply predates revisions
 * (activeRevisionId null, no draft): flagging every programme on day one
 * would train operators to ignore the banner entirely.
 *
 * `opts.activeRevisionSourcePdfId` is injected by callers that already
 * loaded the revision, to avoid a second query. When omitted it is fetched.
 */
export async function programRevisionStaleness(
  programId: string,
  opts: { activeRevisionSourcePdfId?: string | null } = {},
): Promise<ProgramStaleness> {
  const [pending, program, currentDoc] = await Promise.all([
    prisma.programRevision.findFirst({
      where: { programId, status: { in: ['DRAFT', 'ANALYSING', 'IN_REVIEW'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, curriculumYearBE: true, createdAt: true },
    }),
    prisma.program.findUnique({ where: { id: programId }, select: { activeRevisionId: true } }),
    prisma.programDocument.findFirst({
      where: { programId, role: 'CURRENT_CURRICULUM', isCurrent: true },
      select: { pdfDocumentId: true, attachedAt: true },
    }),
  ]);

  if (pending) {
    return {
      stale: true,
      reason: 'unanalysed-revision',
      pendingRevisionId: pending.id,
      pendingCurriculumYearBE: pending.curriculumYearBE,
      pendingAttachedAt: currentDoc?.attachedAt ?? pending.createdAt,
    };
  }

  // No pending revision. Stale only if we KNOW the live analyses came from a
  // different document — which requires an active revision to compare.
  if (program?.activeRevisionId && currentDoc) {
    const sourcePdfId =
      opts.activeRevisionSourcePdfId !== undefined
        ? opts.activeRevisionSourcePdfId
        : (
            await prisma.programRevision.findUnique({
              where: { id: program.activeRevisionId },
              select: { sourcePdfDocumentId: true },
            })
          )?.sourcePdfDocumentId ?? null;

    if (sourcePdfId && sourcePdfId !== currentDoc.pdfDocumentId) {
      return {
        stale: true,
        reason: 'superseded-document',
        pendingRevisionId: null,
        pendingCurriculumYearBE: null,
        pendingAttachedAt: currentDoc.attachedAt,
      };
    }
  }

  return {
    stale: false,
    reason: 'none',
    pendingRevisionId: null,
    pendingCurriculumYearBE: null,
    pendingAttachedAt: null,
  };
}

export interface OpenDraftRevisionInput {
  programId: string;
  sourcePdfDocumentId: string;
  curriculumYearBE?: number | null;
  createdById?: string | null;
}

/**
 * Open a DRAFT revision for a newly-attached curriculum document.
 *
 * Idempotent on (programId, sourcePdfDocumentId): re-attaching the same
 * document must not open a second draft. Returns the existing revision when
 * one is already open for that document.
 *
 * Does NOT run the pipeline — "ask first, then run" is the chosen posture.
 * The draft is what makes staleness visible and what Project 2's
 * "Analyse revision" action will target.
 */
export async function openDraftRevision(
  input: OpenDraftRevisionInput,
): Promise<{ id: string; created: boolean }> {
  const existing = await prisma.programRevision.findFirst({
    where: {
      programId: input.programId,
      sourcePdfDocumentId: input.sourcePdfDocumentId,
      status: { in: ['DRAFT', 'ANALYSING', 'IN_REVIEW'] },
    },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  const created = await prisma.programRevision.create({
    data: {
      programId: input.programId,
      sourcePdfDocumentId: input.sourcePdfDocumentId,
      curriculumYearBE: input.curriculumYearBE ?? null,
      createdById: input.createdById ?? null,
      status: 'DRAFT',
    },
    select: { id: true },
  });
  return { id: created.id, created: true };
}
```

- [ ] **Step 4: Export it**

In `packages/db/src/index.ts`:

```typescript
export * from './program-revision';
```

- [ ] **Step 5: Run tests**

Run: `cd packages/db && npx vitest run test/program-revision.test.ts && npx tsc --noEmit`
Expected: 8 tests pass, no type errors.

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/program-revision.ts packages/db/src/index.ts packages/db/test/program-revision.test.ts
git commit -m "feat(db): add revision helper — active id, staleness, open draft"
```

---

### Task 4: Stamp the seven analysis writers

**Files (each gets one stamping line):**
- `packages/db/src/program-strategic-narrative-run.ts:344` (`upsert`)
- `packages/db/src/program-research-expertise-run.ts:194` (`create`)
- `packages/db/src/program-curriculum-revision-run.ts:419` (`create`)
- `apps/ingestion/src/program-ai-readiness/run.ts:184` (`upsert`)
- `apps/ingestion/src/program-pedagogy/run.ts:157` (`upsert`)
- `apps/ingestion/src/program-peers/review.ts:245` (`upsert`)
- `apps/ingestion/src/program-peers/select.ts:137` (`createMany`)

- [ ] **Step 1: Apply the same change at each site**

In each file, import the helper and resolve the id before the write:

```typescript
import { activeRevisionIdFor } from '@kku/db';   // apps/ingestion/*
// or, inside packages/db:
import { activeRevisionIdFor } from './program-revision';
```

Immediately before the write call:

```typescript
  // Provenance: which curriculum revision produced this row. NULL is the
  // pre-feature baseline. See packages/db/src/program-revision.ts.
  const programRevisionId = await activeRevisionIdFor(programId);
```

Then add `programRevisionId` to the written data:
- For `create`: add to `data`.
- For `upsert`: add to **both** `create` and `update` — an upsert that only sets it on create leaves a re-run stamped with the *previous* revision, which is worse than not stamping at all.
- For `createMany` (`select.ts`): add to every row in the array being built.

Use the programme id variable already in scope at each site; do not add a parameter to the runner signatures.

- [ ] **Step 2: Typecheck both packages**

Run: `cd packages/db && npx tsc --noEmit && cd ../../apps/ingestion && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Verify a real write stamps**

Pick a programme with an existing curriculum-revision row and force a regeneration — this costs one AI call (~$0.02), which is acceptable to prove the wiring:

```bash
cd /home/denpong/projects/program-landscape
pnpm curriculum:revision-generate --program KKU-SEQ-0060
cd packages/db && npx tsx -e "
import { prisma } from './src/index';
(async () => {
  const p = await prisma.program.findFirst({ where:{code:'KKU-SEQ-0060'}, select:{id:true, activeRevisionId:true} });
  const r = await prisma.programCurriculumRevision.findFirst({ where:{programId:p!.id}, orderBy:{generatedAt:'desc'}, select:{programRevisionId:true} });
  console.log('program.activeRevisionId:', p!.activeRevisionId, '| row.programRevisionId:', r!.programRevisionId);
  await prisma.\$disconnect();
})();
"
```
Expected: both `null` (this programme has no revision yet — the baseline case) **and they agree**. Task 7 creates real revisions; the agreement is the invariant being checked here.

- [ ] **Step 4: Commit**

```bash
git add packages/db/src/program-strategic-narrative-run.ts packages/db/src/program-research-expertise-run.ts packages/db/src/program-curriculum-revision-run.ts apps/ingestion/src/program-ai-readiness/run.ts apps/ingestion/src/program-pedagogy/run.ts apps/ingestion/src/program-peers/review.ts apps/ingestion/src/program-peers/select.ts
git commit -m "feat(pipeline): stamp revision provenance on generated analyses"
```

---

### Task 5: Stamp the five fact writers

**Files:**
- `packages/db/src/program-digest-materialize.ts:174` (`programSkill.upsert`)
- `apps/ingestion/src/program-courses-extract/run.ts:311` (`programCourse.createMany`)
- `apps/ingestion/src/scripts/materialise-program-courses.ts:250` (`programCourse.createMany`)
- `apps/ingestion/src/program-faculty/run.ts:155` and `:284` (two `programFaculty.upsert` sites)

- [ ] **Step 1: Apply the same pattern**

Identical to Task 4: resolve `const programRevisionId = await activeRevisionIdFor(programId);` once per function, add it to the written data, and for upserts set it in **both** `create` and `update`.

For the two `programCourse.createMany` sites, add it to the row objects being built. Note both of these run inside a delete-and-replace transaction — resolve the id once outside the loop, not per row.

`program-faculty/run.ts` has **two** upsert sites; both must be stamped. Missing one leaves a programme's roster half-stamped, which is harder to diagnose than none at all.

- [ ] **Step 2: Typecheck**

Run: `cd packages/db && npx tsc --noEmit && cd ../../apps/ingestion && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add packages/db/src/program-digest-materialize.ts apps/ingestion/src/program-courses-extract/run.ts apps/ingestion/src/scripts/materialise-program-courses.ts apps/ingestion/src/program-faculty/run.ts
git commit -m "feat(pipeline): stamp revision provenance on extracted facts"
```

---

### Task 6: The drift guard test

**Files:**
- Create: `packages/db/test/program-revision-stamping.test.ts`

Twelve write sites, one helper, no compiler enforcement that a *new* writer remembers to stamp. This test is the enforcement. It follows the source-scanning pattern already used in this codebase by `packages/shared/test/prompt-standard-conformance.test.ts` and the course-code lockstep test.

- [ ] **Step 1: Write the test**

```typescript
// packages/db/test/program-revision-stamping.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

// ─────────────────────────────────────────────────────────────────────────────
// Every writer of a revision-scoped table must stamp programRevisionId.
//
// There is no compiler enforcement — programRevisionId is nullable, so an
// unstamped write compiles happily and silently produces a row that claims
// to be the pre-feature baseline. This test is the enforcement.
//
// Precedent: this codebase already lost a pipeline phase for its entire
// lifetime to five hand-maintained copies with no guard.
// ─────────────────────────────────────────────────────────────────────────────

const REPO = path.join(__dirname, '..', '..', '..');

/** Each writer: the file, and the prisma delegate it writes. */
const WRITERS: Array<{ file: string; delegate: string }> = [
  { file: 'packages/db/src/program-strategic-narrative-run.ts', delegate: 'programStrategicNarrative' },
  { file: 'packages/db/src/program-research-expertise-run.ts', delegate: 'programResearchExpertise' },
  { file: 'packages/db/src/program-curriculum-revision-run.ts', delegate: 'programCurriculumRevision' },
  { file: 'packages/db/src/program-digest-materialize.ts', delegate: 'programSkill' },
  { file: 'apps/ingestion/src/program-ai-readiness/run.ts', delegate: 'programAiReadinessAssessment' },
  { file: 'apps/ingestion/src/program-pedagogy/run.ts', delegate: 'programPedagogyAssessment' },
  { file: 'apps/ingestion/src/program-peers/review.ts', delegate: 'programPeerReview' },
  { file: 'apps/ingestion/src/program-peers/select.ts', delegate: 'programPeerSelection' },
  { file: 'apps/ingestion/src/program-courses-extract/run.ts', delegate: 'programCourse' },
  { file: 'apps/ingestion/src/scripts/materialise-program-courses.ts', delegate: 'programCourse' },
  { file: 'apps/ingestion/src/program-faculty/run.ts', delegate: 'programFaculty' },
];

describe('revision provenance stamping', () => {
  for (const w of WRITERS) {
    it(`${w.file} stamps programRevisionId`, () => {
      const full = path.join(REPO, w.file);
      expect(existsSync(full), `${w.file} not found — was it moved?`).toBe(true);
      const src = readFileSync(full, 'utf8');
      expect(src, `${w.file} writes ${w.delegate} but never mentions programRevisionId`)
        .toContain('programRevisionId');
      expect(src, `${w.file} must resolve the id via activeRevisionIdFor, not inline a query`)
        .toContain('activeRevisionIdFor');
    });
  }

  it('every revision-scoped model in the schema has a writer listed here', () => {
    // Catches the reverse drift: a new revision-scoped table added to the
    // schema whose writer nobody registered above.
    const schema = readFileSync(path.join(REPO, 'packages/db/prisma/schema.prisma'), 'utf8');
    const scoped = [...schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)]
      .filter(([, , body]) => body.includes('programRevisionId'))
      .map(([, name]) => name);
    // Model name → prisma delegate (lower-camel).
    const delegates = new Set(WRITERS.map((w) => w.delegate));
    const missing = scoped
      .map((m) => m.charAt(0).toLowerCase() + m.slice(1))
      .filter((d) => !delegates.has(d));
    expect(missing, `revision-scoped models with no registered writer: ${missing.join(', ')}`)
      .toEqual([]);
  });
});
```

- [ ] **Step 2: Run — it must pass now, and fail if a stamp is removed**

Run: `cd packages/db && npx vitest run test/program-revision-stamping.test.ts`
Expected: 12 tests pass.

Then prove it is not vacuous: temporarily delete the `programRevisionId` line from `apps/ingestion/src/program-pedagogy/run.ts`, re-run, confirm that one test fails, then restore it. Report both outcomes.

- [ ] **Step 3: Commit**

```bash
git add packages/db/test/program-revision-stamping.test.ts
git commit -m "test(db): guard that every revision-scoped writer stamps provenance"
```

---

### Task 7: A document becoming the current curriculum opens a DRAFT revision

**Files:**
- Modify: `apps/api/src/programs/programs.service.ts` — `attachDocument()` (~line 620), `create()` (~line 316), `promoteDocument()` (~line 750)

#### The paths that make a document current

There are **four** routes to "this document is now the programme's current curriculum". Three of them open a revision; the fourth is knowingly deferred. Any future route must be added here, or it ships a programme whose analyses are stale with no banner to say so.

All four are recognisable by the same tell: they call `demotePriorCurrent()` and then write `isCurrent: true`.

| # | Method | Opens a revision? | Condition |
|---|---|---|---|
| 1 | `attachDocument()` | yes | `role === 'CURRENT_CURRICULUM' && promoteToCurrent !== false` — the same `makeCurrent` boolean the upsert uses for `isCurrent`, hoisted out of the transaction so the two cannot drift |
| 2 | `create()` | yes | `input.attachPdfId` is set — `create()` always attaches as `CURRENT_CURRICULUM / isCurrent: true` |
| 3 | `promoteDocument()` | yes | unconditional — promote overwrites the row's role to `CURRENT_CURRICULUM` with no guard, so promoting a `COMMITTEE_ORDER` *makes* it the curriculum. Mirroring the condition governing `isCurrent` here means "always". Reads `pdfDocumentId` + `curriculumYearBE` off the row being promoted, since the caller supplies only a document id |
| 4 | `applyExtraction()` | **no — deferred** | would be `input.attachAsCurrent !== false`. See below |

**`applyExtraction()` is a known, deliberate gap.** It upserts the extraction's PDF with `role: 'CURRENT_CURRICULUM', isCurrent: true` (~line 927) and so leaves the programme with a new current curriculum and no revision — the staleness banner will read "not stale" after an apply-extraction. It was left alone in this task on purpose: it is the one path that *also* rewrites the `Program` header columns in the same transaction, so whether its revision should be `DRAFT` (awaiting analysis) or immediately `APPROVED` (the operator just reviewed the extraction by hand) is a Project 2 question about the approval gate, not a mechanical one. Closing it is a one-line call to the same helper once that is decided.

The three live call sites share `private openRevisionForCurrentCurriculum()`, which wraps `openDraftRevision` with the swallow-and-log posture described in Step 1. Add new paths through that helper, not by calling `openDraftRevision` directly.

- [ ] **Step 1: Open a draft in `attachDocument()`**

The method currently ends by returning the `tx.programDocument.upsert(...)` result inside a `$transaction`. Capture that result and open the draft after the transaction commits. Hoist `makeCurrent` out of the transaction callback too, so the revision condition is *literally the same boolean* the upsert uses for `isCurrent` — written out twice, the two would eventually drift:

```typescript
    const makeCurrent =
      input.role === 'CURRENT_CURRICULUM' && input.promoteToCurrent !== false;

    const doc = await prisma.$transaction(async (tx) => {
      /* ...existing body, minus its own `makeCurrent` line... */
    });

    if (makeCurrent) {
      await this.openRevisionForCurrentCurriculum({
        programId,
        pdfDocumentId: input.pdfDocumentId,
        curriculumYearBE: input.curriculumYearBE ?? null,
        createdById: user.userId,
      });
    }

    return doc;
```

Extract `private openRevisionForCurrentCurriculum({ programId, pdfDocumentId, curriculumYearBE, createdById })` rather than inlining — three call sites need it. It wraps `openDraftRevision` (imported from `@kku/db`) in a try/catch that logs via a Nest `Logger` and **swallows**.

Deliberately **outside** the transaction, and deliberately swallowing: opening a draft is bookkeeping, and failing it must not roll back a document attach the operator already saw succeed. A throw here would report a committed attach as a failure and invite a retry against state that already changed — the more misleading of the two failure modes. The loss is recoverable, since re-attaching the same document opens the draft that was missed.

Residual risk worth knowing: for a programme with a NULL `activeRevisionId` (all of them today), a silently-missed draft means no banner at all — `programRevisionStaleness()`'s `superseded-document` path needs an active revision to compare against and so cannot cover for it. The log line is the only signal.

- [ ] **Step 2: Do the same in `create()`**

`create()` attaches a `CURRENT_CURRICULUM` document when `attachPdfId` is supplied (~line 487-502). Capture the `$transaction` result, then call the helper when `input.attachPdfId` is set, with `createdById: user.userId`. A new programme should start with a revision rather than a NULL baseline.

Hoist the `curriculumYearBE` expression (`(extractionPayload?.curriculumYearBE as number | undefined) ?? null`) out of the `programDocument.create` so the document and the revision are guaranteed to record the same year.

- [ ] **Step 3: Do the same in `promoteDocument()`**

Promote is the third path to current-curriculum and needs the same treatment — an operator who attaches without promoting, then promotes from the files tab, would otherwise get a new current curriculum with no revision and therefore no staleness banner. Capture the `$transaction` result and call the helper **unconditionally** afterwards (see the table above for why), reading `pdfDocumentId` and `curriculumYearBE` off the `doc` row the method already fetched for its authorization check.

- [ ] **Step 4: Typecheck**

Run: `cd apps/api && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 5: Verify against real data, including idempotency**

Exercise the helper directly for the idempotency guard, **then exercise the real endpoints** — the endpoints are what this task changes, and reading the conditions is not the same as running them. Cover, at minimum: attach `PREVIOUS_CURRICULUM` (no revision), attach `CURRENT_CURRICULUM` with `promoteToCurrent: false` (no revision), attach `CURRENT_CURRICULUM` promoted (one revision), the same attach repeated (still one), attach a `SUPPLEMENTARY` then promote it (one revision, proving the unconditional promote path), and promote again (still one).

Attaching foreign PDFs to a real programme leaves genuinely wrong data behind — a dentistry curriculum attached to Chemical Engineering will quietly poison any later analysis of that programme, and promoting demotes the real curriculum document to `PREVIOUS_CURRICULUM`. **Revert every document you attach and restore the original current document**, keeping only the deliberate KKU-SEQ-0060 draft.

The helper check:

```bash
cd packages/db && npx tsx -e "
import { prisma, openDraftRevision } from './src/index';
(async () => {
  const p = await prisma.program.findFirst({ where:{ code:'KKU-SEQ-0060' }, select:{id:true} });
  const d = await prisma.programDocument.findFirst({ where:{ programId:p!.id, role:'CURRENT_CURRICULUM', isCurrent:true }, select:{pdfDocumentId:true, curriculumYearBE:true} });
  const a = await openDraftRevision({ programId:p!.id, sourcePdfDocumentId:d!.pdfDocumentId, curriculumYearBE:d!.curriculumYearBE });
  const b = await openDraftRevision({ programId:p!.id, sourcePdfDocumentId:d!.pdfDocumentId, curriculumYearBE:d!.curriculumYearBE });
  console.log('first:', a, 'second:', b);
  console.log('drafts for programme:', await prisma.programRevision.count({ where:{ programId:p!.id } }));
  await prisma.\$disconnect();
})();
"
```
Expected: `first: { id: ..., created: true }`, `second: { id: <same id>, created: false }`, and exactly **1** revision row. Two rows would mean the idempotency guard is wrong.

Note this leaves a real DRAFT revision on **KKU-SEQ-0060** — kept on purpose, since Task 9's staleness banner needs a non-baseline programme to render against. The dev DB is no longer all-baseline from this point on.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/programs/programs.service.ts
git commit -m "feat(api): attaching a curriculum PDF opens a draft revision"
```

As shipped this landed as two commits — `6c6fa3f` for `attachDocument()` + `create()`, then `37f7eb0` for `promoteDocument()` once the third path was spotted.

---

### Task 8: Make the metadata overwrite auditable

**Files:**
- Modify: `packages/db/src/program-digest-materialize.ts` (~lines 100-116)

Today this writes nine `Program` columns guarded by `if (payload.<field>)` — *"is the AI value non-empty"*, **not** *"is the existing value empty"*. Its own comment claims it avoids overwriting curated values; what it does is overwrite them whenever the AI has an opinion. It runs in the ingestion worker with no HTTP request, so the `@AuditLog` interceptor never fires and **the overwrite leaves no trace at all**.

Behaviour does not change here. What changes is that it becomes recorded.

- [ ] **Step 1: Capture before-values and record the proposal**

Replace the update block:

```typescript
  // 1. Update Program columns.
  //
  // NOTE the guard is "does the AI have a value", NOT "is the existing value
  // empty" — so a non-empty AI value DOES replace a human-curated one. That
  // is long-standing behaviour and is left intact here; what this block adds
  // is a record of it. Until now the overwrite was untraceable: this runs in
  // the ingestion worker with no HTTP request, so the @AuditLog interceptor
  // never fires. Project 2 turns this record into an approval gate.
  const FIELDS = [
    ['nameEn', payload.programNameEn],
    ['degreeNameTh', payload.degreeNameTh],
    ['degreeNameEn', payload.degreeNameEn],
    ['degreeAbbrTh', payload.degreeAbbrTh],
    ['degreeAbbrEn', payload.degreeAbbrEn],
    ['totalCredits', payload.totalCredits],
    ['durationYears', payload.durationYears],
    ['language', payload.language],
    ['recruitmentSummaryTh', payload.recruitmentSummaryTh],
  ] as const;

  const before = await prisma.program.findUnique({
    where: { id: programId },
    select: {
      nameEn: true, degreeNameTh: true, degreeNameEn: true, degreeAbbrTh: true,
      degreeAbbrEn: true, totalCredits: true, durationYears: true,
      language: true, recruitmentSummaryTh: true, activeRevisionId: true,
    },
  });

  const updates: Record<string, unknown> = {};
  const changes: Array<{ field: string; current: unknown; proposed: unknown; applied: boolean }> = [];
  for (const [field, proposed] of FIELDS) {
    const hasValue = field === 'totalCredits' || field === 'durationYears' ? proposed != null : Boolean(proposed);
    if (!hasValue) continue;
    updates[field] = proposed;
    const current = before ? (before as Record<string, unknown>)[field] : null;
    // Only record a CHANGE — a digest restating what is already there is noise.
    if (current !== proposed) {
      changes.push({ field, current, proposed, applied: true });
    }
  }

  if (Object.keys(updates).length > 0) {
    await prisma.program.update({ where: { id: programId }, data: updates });
  }
```

- [ ] **Step 2: Persist the record — on the revision and as an audit row**

Immediately after the update:

```typescript
  if (changes.length > 0) {
    // (a) On the revision, so Project 2's diff has something to render.
    if (before?.activeRevisionId) {
      await prisma.programRevision.update({
        where: { id: before.activeRevisionId },
        data: { metadataProposalJson: { fields: changes } },
      });
    }
    // (b) As an audit row. Written explicitly because the @AuditLog
    //     interceptor cannot fire here — there is no HTTP request. userId is
    //     left null: an AI-driven change genuinely has no human actor, and
    //     inventing one would be worse than recording none.
    await prisma.auditLog.create({
      data: {
        userId: null,
        action: 'program.metadata.ai_overwrite',
        entityType: 'Program',
        entityId: programId,
        payloadJson: { extractionId: extraction.id, methodVersion: extraction.methodVersion, fields: changes },
      },
    });
  }
```

- [ ] **Step 3: Add the changed-field count to the result**

Extend `MaterialiseProgramDigestResult` (line ~49) with:

```typescript
  /** Program columns whose value the digest actually changed (not merely
   *  restated). Zero on a re-run over unchanged content. */
  programFieldsChanged: number;
```

and return `programFieldsChanged: changes.length`. Keep the existing `programFieldsUpdated` — callers may rely on it, and "written" and "changed" are genuinely different numbers.

- [ ] **Step 4: Typecheck**

Run: `cd packages/db && npx tsc --noEmit`
Expected: clean. Fix any caller that destructures the result type.

- [ ] **Step 5: Verify the audit row appears on a real change**

```bash
cd packages/db && npx tsx -e "
import { prisma } from './src/index';
(async () => {
  const p = await prisma.program.findFirst({ where:{ code:'KKU-SEQ-0060' }, select:{id:true,degreeNameTh:true} });
  console.log('current degreeNameTh:', p!.degreeNameTh);
  console.log('recent ai_overwrite rows:', await prisma.auditLog.count({ where:{ action:'program.metadata.ai_overwrite' } }));
  await prisma.\$disconnect();
})();
"
```
Then hand-edit that programme's `degreeNameTh` via `/admin/programs/<id>` (overview tab), re-run its digest (`pnpm programs:digest KKU-SEQ-0060`), and re-run the query. Expected: the count increases by one and the row's `payloadJson.fields` contains a `degreeNameTh` entry with your hand-edited value as `current`. **That row is the first field-level delta ever recorded in this system.**

- [ ] **Step 6: Commit**

```bash
git add packages/db/src/program-digest-materialize.ts
git commit -m "feat(db): record metadata overwrites instead of applying them silently"
```

---

### Task 9: Surface staleness

**Files:**
- Modify: `apps/api/src/programs/deep-dive.controller.ts` — the `overview` handler (~line 126)
- Modify: `apps/web/app/admin/programs/[id]/client.tsx` — admin banner
- Modify: `apps/web/app/programs/[id]/client.tsx` — deep-dive notice

- [ ] **Step 1: Add staleness to the overview response**

In `deep-dive.controller.ts`, import `programRevisionStaleness` from `@kku/db` and extend the handler:

```typescript
  async overview(@AuthSession() user: SessionUser, @Param('programId') programId: string) {
    await assertProgramAccessible(programId, user);
    const [r, staleness] = await Promise.all([
      programOverview(programId),
      programRevisionStaleness(programId),
    ]);
    if (!r) throw new NotFoundException();
    // Rides on /overview rather than a new endpoint: it is one cheap query,
    // and /overview is the deep-dive's auth canary, so the banner can never
    // render on a page the reader is not allowed to see.
    return { ...r, staleness };
  }
```

Add the matching type to `apps/web/app/programs/[id]/types.ts` on the overview interface:

```typescript
  staleness?: {
    stale: boolean;
    reason: 'none' | 'unanalysed-revision' | 'superseded-document';
    pendingRevisionId: string | null;
    pendingCurriculumYearBE: number | null;
    pendingAttachedAt: string | null;
  };
```

Optional on the type so an older cached response cannot crash the page.

- [ ] **Step 2: Render the deep-dive notice**

In `apps/web/app/programs/[id]/client.tsx`, above the existing sections, render when `overview.staleness?.stale`:

```tsx
{overview.staleness?.stale && (
  <Card padding="sm" tone="quiet">
    <p className="text-xs text-text-secondary">
      {overview.staleness.reason === 'unanalysed-revision'
        ? `A newer curriculum document${
            overview.staleness.pendingCurriculumYearBE
              ? ` (พ.ศ. ${overview.staleness.pendingCurriculumYearBE})`
              : ''
          } has been attached to this programme but not yet analysed. The analysis below reflects the previous curriculum.`
        : 'The analysis below was generated from a curriculum document that is no longer the current one.'}
    </p>
  </Card>
)}
```

Council-facing, so it states the fact without implying the analysis is wrong. Design tokens only — ESLint bans literal colours.

- [ ] **Step 3: Render the admin banner**

In `apps/web/app/admin/programs/[id]/client.tsx`, fetch the same staleness (the admin page has its own data load — add a small `GET` to the existing program fetch, or call the deep-dive overview endpoint) and render above the tab strip, with the existing "Run pipeline" affordance beside it so the operator can act immediately:

```tsx
{staleness?.stale && (
  <Card padding="sm" tone="warning" className="mb-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-text-primary">
        A revised curriculum file was attached
        {staleness.pendingAttachedAt
          ? ` on ${new Date(staleness.pendingAttachedAt).toLocaleDateString()}`
          : ''}{' '}
        and has not been analysed. Every AI section still reflects the previous file.
      </p>
      <Button size="sm" onClick={runPipeline}>Run pipeline</Button>
    </div>
  </Card>
)}
```

Reuse the existing `runPipeline` handler on that page (~line 1139) rather than adding a second one.

- [ ] **Step 4: Typecheck and lint**

Run: `cd apps/api && npx tsc --noEmit && cd ../web && npx tsc --noEmit && npx eslint 'app/programs/[id]/client.tsx' 'app/admin/programs/[id]/client.tsx'`
Expected: clean, no `no-restricted-syntax` colour violations.

- [ ] **Step 5: See it**

With `pnpm dev` running, attach a curriculum PDF to a programme via `/admin/programs/<id>?tab=files` (any PDF — it need not be a real มคอ.2 for this check), then reload both that page and `/programs/<id>`.
Expected: the amber banner on admin, the quiet notice on the deep-dive. Then confirm a programme with no revision shows **neither**.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/programs/deep-dive.controller.ts 'apps/web/app/programs/[id]/types.ts' 'apps/web/app/programs/[id]/client.tsx' 'apps/web/app/admin/programs/[id]/client.tsx'
git commit -m "feat(web): surface curriculum staleness in admin and deep-dive"
```

---

### Task 10: Fix the new-programme upload bug

**Files:**
- Modify: `apps/web/app/admin/programs/new/client.tsx:161`
- Create: `apps/web/test/pdf-upload-response-shape.test.ts` — confirmed to exist as a test location (`apps/web/test/format-cohort.test.ts` lives there; the package's `test` script is `vitest run --passWithNoTests --exclude 'e2e/**'` and it uses the root vitest config)

- [ ] **Step 1: Fix the field name**

Line 161 currently reads:

```typescript
      attachPdfId = uploaded[0]?.pdfDocument?.id;
```

The API returns `{ pdfDocumentId, deduplicated, enqueued }` (`apps/api/src/pdf-intake/pdf-intake.service.ts:61`). There is no `pdfDocument` object, so the guard on the next line throws *"PDF upload returned no document id"* — **after** the PDF is uploaded, orphaning it and losing the programme. Replace with:

```typescript
      attachPdfId = uploaded[0]?.pdfDocumentId;
```

and fix the type annotation on the line above to match (`Array<{ pdfDocumentId?: string }>`).

Two sibling call sites already read it correctly — `[id]/client.tsx:824` and `from-pdf/client.tsx:225` — which is why this survived.

- [ ] **Step 2: Add a regression test pinning the field name**

```typescript
// Asserts the client reads the field the API actually returns. This broke
// because three call sites read the same response and only one was wrong.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('PDF upload response field name', () => {
  it('the API returns pdfDocumentId', () => {
    const svc = readFileSync(
      path.join(__dirname, '..', '..', '..', 'apps/api/src/pdf-intake/pdf-intake.service.ts'),
      'utf8',
    );
    expect(svc).toMatch(/Promise<\{\s*pdfDocumentId: string/);
  });

  it('every client call site reads pdfDocumentId, not pdfDocument.id', () => {
    const files = [
      'apps/web/app/admin/programs/new/client.tsx',
      'apps/web/app/admin/programs/[id]/client.tsx',
      'apps/web/app/admin/programs/from-pdf/client.tsx',
    ];
    for (const f of files) {
      const src = readFileSync(path.join(__dirname, '..', '..', '..', f), 'utf8');
      expect(src, `${f} reads a pdfDocument object that the API never returns`)
        .not.toMatch(/pdfDocument\?\.\s*id/);
    }
  });
});
```

The three `..` segments walk from `apps/web/test/` to the repo root. Verify by running the test — a wrong path shows up immediately as ENOENT, not as a false pass.

- [ ] **Step 3: Run and verify it catches the bug**

Run the test; it passes. Then temporarily restore `pdfDocument?.id` on line 161, re-run, confirm the second test fails, and restore the fix. Report both outcomes.

- [ ] **Step 4: Verify end-to-end**

With `pnpm dev` running, go to `/admin/programs/new`, fill the form, attach a PDF, submit.
Expected: the programme is created, the PDF is attached as `CURRENT_CURRICULUM`, a DRAFT revision exists for it (Task 7), and the pipeline fires. Before this fix the submission threw and left an orphan PDF.

- [ ] **Step 5: Commit**

```bash
git add 'apps/web/app/admin/programs/new/client.tsx' apps/web/test/pdf-upload-response-shape.test.ts
git commit -m "fix(web): new-programme upload read the wrong response field"
```

---

### Task 11: Whole-project verification

**Files:** none — operational.

- [ ] **Step 1: Everything typechecks and passes**

```bash
cd /home/denpong/projects/program-landscape
for p in packages/shared packages/db apps/api apps/web apps/ingestion; do
  (cd $p && npx tsc --noEmit >/dev/null 2>&1 && echo "  OK  $p" || echo "  FAIL $p")
done
(cd packages/db && npx vitest run 2>&1 | tail -3)
(cd packages/shared && npx vitest run 2>&1 | tail -3)
```
Expected: all five OK, both suites green.

- [ ] **Step 2: The provenance invariant holds**

```bash
cd packages/db && npx tsx -e "
import { prisma } from './src/index';
(async () => {
  // Every stamped row's revision must belong to the same programme.
  const bad: any = await prisma.\$queryRaw\`
    SELECT count(*)::int AS n FROM program_curriculum_revisions x
    JOIN program_revisions r ON r.id = x.program_revision_id
    WHERE x.program_revision_id IS NOT NULL AND r.program_id <> x.program_id\`;
  console.log('cross-programme stamps (must be 0):', bad[0].n);
  const revs = await prisma.programRevision.groupBy({ by:['status'], _count:true });
  console.log('revisions by status:', revs);
  await prisma.\$disconnect();
})();
"
```
Expected: `0` cross-programme stamps.

- [ ] **Step 3: A pre-feature programme is unaffected**

Open a programme that has never had a document attached since this work. Expected: no banner on admin, no notice on the deep-dive, every section renders exactly as before, and all its generated rows still have `programRevisionId = NULL`. This is the no-regression check for the other ~300 programmes.

- [ ] **Step 4: The full loop, on one programme**

Attach a curriculum PDF → confirm a DRAFT revision opens and both banners appear → run the pipeline from the admin button → confirm generated rows are stamped → confirm any metadata change produced an `audit_logs` row with action `program.metadata.ai_overwrite` carrying before/after values.

No commit — verification of work already committed.

---

## Self-Review

**Spec coverage:** Component 1 → Task 1. Component 2 → Tasks 2, 4, 5, plus Task 6's guard. Component 3 → Task 7. Component 4 → Task 8. Component 5 → Task 9. Component 6 → Task 10. Verification section → Task 11. Every spec non-goal is respected: no unique-key migrations, no submission page, no diff UI, no approval gate, no `?revision=` deep-dive, no backfill, no change to `Curriculum`, no per-field human-edited flag.

**Placeholder scan:** no TBD/TODO. Every code step carries complete code or an exact before/after. Where a path or table name could differ from my reading (the web test location, the `@@map` names in Task 2, the admin page's data-loading shape in Task 9), the step says to confirm it against the source rather than assuming.

**Type consistency:** `activeRevisionIdFor(programId) → Promise<string | null>` is defined in Task 3 and called identically in Tasks 4 and 5. `ProgramStaleness` (Task 3) is returned by the API in Task 9 Step 1 and consumed by both UI surfaces in Steps 2–3, with the same four fields; the web type mirrors it with `pendingAttachedAt` as `string` because it crosses JSON. `openDraftRevision` returns `{ id, created }` in Task 3 and is destructured that way in Task 7's verification. `MaterialiseProgramDigestResult` gains `programFieldsChanged` in Task 8 and nothing else reads it.

**Ordering:** Tasks 1 → 2 are migrations and must precede everything. Task 3's helper is required by 4, 5, 7 and 9. Task 6's guard must come after 4 and 5 or it fails legitimately. Tasks 8, 9, 10 are independent of each other.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-09-03-program-revision-staging.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?
