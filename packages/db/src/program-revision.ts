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

/** Revision states that mean "opened, not yet resolved by a reviewer". */
const PENDING_REVISION_STATUSES = ['DRAFT', 'ANALYSING', 'IN_REVIEW'] as const;

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
 * would train operators to ignore the banner entirely. Equally NOT stale
 * when there is no current curriculum document — absence of something to
 * compare against is not evidence of staleness.
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
      where: { programId, status: { in: [...PENDING_REVISION_STATUSES] } },
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
      status: { in: [...PENDING_REVISION_STATUSES] },
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
