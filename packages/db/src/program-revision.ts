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
 * The complement of PENDING_REVISION_STATUSES — every status a revision
 * lands in once it has left the pending set. REJECTED is included alongside
 * APPROVED/SUPERSEDED: reaching IN_REVIEW (and being declined from there)
 * still means the revision WAS analysed, just not adopted. Only DRAFT /
 * ANALYSING / IN_REVIEW mean "not analysed yet".
 */
const COMPLETED_REVISION_STATUSES = ['APPROVED', 'REJECTED', 'SUPERSEDED'] as const;

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
  /** True when no revision for this programme has ever completed analysis —
   *  i.e. this is the programme's first. A brand-new programme opens a DRAFT
   *  revision at create time, and telling its operator "a revised file was
   *  attached" is nonsense when there is no previous file. */
  isFirstAnalysis: boolean;
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
    // Two independent signals, because neither is sufficient alone.
    //
    // A completed revision proves a prior analysis — but ProgramRevision is
    // new, so every programme analysed before it existed has none. Counting
    // only revisions reported isFirstAnalysis=true for ALL 301 programmes
    // (the whole DB held 2 completed revisions), which is precisely backwards:
    // attaching a revision to a long-analysed programme would have claimed it
    // had never been analysed. Caught by a live attach, not by the unit tests,
    // which mocked the count.
    //
    // A PREVIOUS_CURRICULUM document is the durable signal: attaching a
    // revision demotes the incumbent, so its presence means a prior file
    // existed regardless of when the programme was first analysed.
    const [completedCount, previousDocCount] = await Promise.all([
      prisma.programRevision.count({
        where: { programId, status: { in: [...COMPLETED_REVISION_STATUSES] } },
      }),
      prisma.programDocument.count({
        where: { programId, role: 'PREVIOUS_CURRICULUM' },
      }),
    ]);
    return {
      stale: true,
      reason: 'unanalysed-revision',
      pendingRevisionId: pending.id,
      pendingCurriculumYearBE: pending.curriculumYearBE,
      pendingAttachedAt: currentDoc?.attachedAt ?? pending.createdAt,
      isFirstAnalysis: completedCount === 0 && previousDocCount === 0,
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
        // A superseded document by definition means something was analysed
        // before — this can never be the programme's first analysis.
        isFirstAnalysis: false,
      };
    }
  }

  return {
    stale: false,
    reason: 'none',
    pendingRevisionId: null,
    pendingCurriculumYearBE: null,
    pendingAttachedAt: null,
    isFirstAnalysis: false,
  };
}

/**
 * Make the programme's newest pending revision its ACTIVE revision, so every
 * row the caller is about to write gets stamped with it.
 *
 * This is the only writer of `Program.activeRevisionId`. Without it the ten
 * provenance columns stamped via activeRevisionIdFor() would be NULL forever
 * and the 'superseded-document' staleness branch would be unreachable.
 *
 * Contract:
 *  - No pending revision → returns null and touches NOTHING. In particular
 *    it does NOT clear an existing activeRevisionId: a second pipeline run
 *    over an already-adopted programme must keep stamping the same revision.
 *    (This is also what keeps ~300 pre-feature programmes at NULL — the
 *    deliberate baseline, not a gap to retro-fit.)
 *  - Adopting → the previously-active revision, if any and if different,
 *    becomes SUPERSEDED so the history reads in order.
 *  - The adopted revision moves to ANALYSING, which is still inside the
 *    pending set: a run that dies mid-flight therefore leaves the programme
 *    visibly stale rather than silently half-analysed.
 *
 * Must be called BEFORE any writer runs — the stamp is read per-row at write
 * time, so a late adoption produces a run with half its rows unstamped.
 */
export async function adoptPendingRevision(programId: string): Promise<string | null> {
  const pending = await prisma.programRevision.findFirst({
    where: { programId, status: { in: [...PENDING_REVISION_STATUSES] } },
    orderBy: { createdAt: 'desc' },
    select: { id: true },
  });
  if (!pending) return null;

  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { activeRevisionId: true },
  });
  const previousId = program?.activeRevisionId ?? null;

  await prisma.$transaction(async (tx) => {
    if (previousId && previousId !== pending.id) {
      await tx.programRevision.update({
        where: { id: previousId },
        data: { status: 'SUPERSEDED' },
      });
    }
    await tx.program.update({
      where: { id: programId },
      data: { activeRevisionId: pending.id },
    });
    await tx.programRevision.update({
      where: { id: pending.id },
      data: { status: 'ANALYSING' },
    });
  });

  return pending.id;
}

/**
 * Close out the revision a completed run analysed.
 *
 * APPROVED here means "live", set by the ACT OF ANALYSIS — not by a human
 * review step. This project has no approval gate: running the pipeline IS the
 * operator's acceptance of the revision, so `approvedById` stays null on
 * purpose (nobody signed it off). Project 2 introduces the reviewer workflow
 * and will insert IN_REVIEW between ANALYSING and APPROVED, at which point
 * this transition becomes the reviewer's action instead of the runner's.
 *
 * Must be called AFTER the phases, and only on a run that got that far: the
 * revision has to leave the pending set or programRevisionStaleness() reports
 * the programme stale forever, but a crashed run should keep it pending.
 */
export async function markRevisionAnalysed(revisionId: string): Promise<void> {
  await prisma.programRevision.update({
    where: { id: revisionId },
    data: { status: 'APPROVED', approvedAt: new Date() },
  });
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
