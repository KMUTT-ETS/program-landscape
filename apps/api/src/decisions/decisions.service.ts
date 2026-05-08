import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import {
  addApprover,
  assertTransitionAllowed,
  assertTransitionAllowedForRole,
  captureSnapshot,
  createMilestone,
  dueOutcomeReviewHorizons,
  getDecisionWithEverything,
  listDecisions,
  patchMilestone,
  prisma,
  searchLessonsLearned,
  type DecisionListFilter,
  type OutcomeReviewHorizon,
} from '@kku/db';
import type {
  DecisionMilestoneStatus,
  DecisionStatus,
  DecisionType,
} from "@kku/db";

// Core CRUD + workflow for the Decision Workspace. Thin layer over
// @kku/db helpers. Role-gating happens here; Prisma writes happen
// inline because the mutations are simple.

// Privilege tiers, post legacy-removal (2026-05-09):
//   COUNCIL_TIER = roles in the approval/amendment loop. Maps the legacy
//                  COUNCIL/EXECUTIVE/ADMIN trio onto v2: admin-grade +
//                  UNIVERSITY_USER (which absorbed legacy
//                  COUNCIL/EXECUTIVE).
//   ARCHIVE_TIER = SUPER_ADMIN only. ARCHIVED decisions are immutable
//                  except via super-admin override (matches the legacy
//                  ADMIN gate; SYSTEM_ADMIN intentionally excluded
//                  because archival is a record-of-truth concern).
const COUNCIL_TIER_ROLES = new Set(['SUPER_ADMIN', 'SYSTEM_ADMIN', 'UNIVERSITY_USER']);
const ARCHIVE_TIER_ROLES = new Set(['SUPER_ADMIN']);

function isCouncilTier(role: string): boolean {
  return COUNCIL_TIER_ROLES.has(role);
}
function isArchiveTier(role: string): boolean {
  return ARCHIVE_TIER_ROLES.has(role);
}

@Injectable()
export class DecisionsService {
  // ── List + get ───────────────────────────────────────────────────
  async list(filter: DecisionListFilter) {
    return listDecisions(filter);
  }

  async get(id: string) {
    const row = await getDecisionWithEverything(id);
    if (!row) throw new NotFoundException();
    return row;
  }

  // ── Create ───────────────────────────────────────────────────────
  async create(params: {
    userId: string;
    title: string;
    decisionType: DecisionType;
    scenarioId?: string;
    affectedProgramIds: string[];
    facultyId?: string;
    rationaleTh?: string;
    rationaleEn?: string;
    dissentingViewsTh?: string;
    effectiveDate?: Date;
    councilSessionRef?: string;
  }) {
    const row = await prisma.councilDecision.create({
      data: {
        userId: params.userId,
        title: params.title,
        decisionType: params.decisionType,
        scenarioId: params.scenarioId,
        affectedProgramIds: params.affectedProgramIds,
        facultyId: params.facultyId,
        rationaleTh: params.rationaleTh,
        rationaleEn: params.rationaleEn,
        dissentingViewsTh: params.dissentingViewsTh,
        effectiveDate: params.effectiveDate,
        councilSessionRef: params.councilSessionRef,
        status: 'PROPOSED',
      },
    });
    return row;
  }

  // ── Status transitions ───────────────────────────────────────────
  async updateStatus(params: {
    decisionId: string;
    userId: string;
    userRole: string;
    toStatus: DecisionStatus;
  }) {
    const existing = await prisma.councilDecision.findUnique({
      where: { id: params.decisionId },
      select: { id: true, status: true, userId: true },
    });
    if (!existing) throw new NotFoundException();
    assertTransitionAllowed(existing.status, params.toStatus);
    assertTransitionAllowedForRole(params.toStatus, params.userRole);

    // Auto-capture snapshot on COUNCIL_REVIEWED (once).
    if (params.toStatus === 'COUNCIL_REVIEWED') {
      await captureSnapshot(params.decisionId, /* force */ false);
    }
    return prisma.councilDecision.update({
      where: { id: params.decisionId },
      data: { status: params.toStatus },
    });
  }

  // Patch free-text fields. Status changes go through updateStatus().
  async patch(params: {
    decisionId: string;
    userId: string;
    userRole: string;
    patch: {
      title?: string;
      rationaleTh?: string;
      rationaleEn?: string;
      dissentingViewsTh?: string;
      effectiveDate?: Date | null;
      councilSessionRef?: string | null;
      facultyId?: string | null;
      resolutionPdfId?: string | null;
    };
  }) {
    const existing = await prisma.councilDecision.findUnique({
      where: { id: params.decisionId },
      select: { id: true, status: true, userId: true },
    });
    if (!existing) throw new NotFoundException();
    if (existing.status === 'ARCHIVED' && !isArchiveTier(params.userRole)) {
      throw new ForbiddenException('Archived decisions can only be edited by SUPER_ADMIN');
    }
    // Owners can always edit. Council-tier (admin-grade + UNIVERSITY_USER)
    // can edit post-COUNCIL_REVIEWED — they're part of the approval loop.
    if (
      existing.userId !== params.userId &&
      !isCouncilTier(params.userRole)
    ) {
      throw new ForbiddenException('Not authorised to edit this decision');
    }
    return prisma.councilDecision.update({
      where: { id: params.decisionId },
      data: params.patch,
    });
  }

  // ── Amend (new version, supersedes original) ─────────────────────
  async amend(params: {
    decisionId: string;
    userId: string;
    userRole: string;
    newFields: {
      title?: string;
      rationaleTh?: string;
      effectiveDate?: Date;
    };
  }) {
    const original = await prisma.councilDecision.findUnique({
      where: { id: params.decisionId },
    });
    if (!original) throw new NotFoundException();
    if (!isCouncilTier(params.userRole)) {
      throw new ForbiddenException(
        'Only admin-grade or University-level users can amend decisions',
      );
    }
    const [newDecision] = await prisma.$transaction([
      prisma.councilDecision.create({
        data: {
          userId: params.userId,
          title: params.newFields.title ?? `${original.title} (v${original.version + 1})`,
          decisionType: original.decisionType,
          scenarioId: original.scenarioId,
          affectedProgramIds: original.affectedProgramIds,
          facultyId: original.facultyId,
          rationaleTh: params.newFields.rationaleTh ?? original.rationaleTh,
          rationaleEn: original.rationaleEn,
          effectiveDate: params.newFields.effectiveDate ?? original.effectiveDate,
          councilSessionRef: original.councilSessionRef,
          status: 'PROPOSED',
          version: original.version + 1,
        },
      }),
      prisma.councilDecision.update({
        where: { id: original.id },
        data: { status: 'SUPERSEDED' },
      }),
    ]);
    // Link the superseded-by pointer after insert (the newDecision id is
    // only known post-insert).
    await prisma.councilDecision.update({
      where: { id: original.id },
      data: { supersededById: newDecision.id },
    });
    return newDecision;
  }

  // ── Milestones ───────────────────────────────────────────────────
  async createMilestone(params: {
    decisionId: string;
    userId: string;
    userRole: string;
    title: string;
    descriptionTh?: string;
    ownerId?: string;
    targetDate?: Date;
  }) {
    await this.assertOwnerOrCouncil(params.decisionId, params.userId, params.userRole);
    return createMilestone(params);
  }

  async patchMilestone(params: {
    milestoneId: string;
    userId: string;
    userRole: string;
    patch: {
      status?: DecisionMilestoneStatus;
      title?: string;
      descriptionTh?: string;
      ownerId?: string | null;
      targetDate?: Date | null;
      completedDate?: Date | null;
      evidenceUrl?: string | null;
      orderIdx?: number;
    };
  }) {
    const ms = await prisma.decisionMilestone.findUnique({
      where: { id: params.milestoneId },
      select: { decisionId: true, ownerId: true },
    });
    if (!ms) throw new NotFoundException();
    // Milestone owners can update status + completedDate on their own
    // milestones; other patches require owner-or-Council.
    const ownerOnly = params.patch.status || params.patch.completedDate || params.patch.evidenceUrl;
    const otherFields = params.patch.title || params.patch.ownerId !== undefined || params.patch.targetDate !== undefined;
    if (otherFields) {
      await this.assertOwnerOrCouncil(ms.decisionId, params.userId, params.userRole);
    } else if (!ownerOnly) {
      // No-op patch? Allowed.
    } else if (ms.ownerId !== params.userId) {
      await this.assertOwnerOrCouncil(ms.decisionId, params.userId, params.userRole);
    }
    return patchMilestone(params.milestoneId, params.patch);
  }

  // ── Approvers ────────────────────────────────────────────────────
  async addApprover(params: {
    decisionId: string;
    targetUserId: string;
    actingUserId: string;
    actingUserRole: string;
    role?: string;
    noteTh?: string;
  }) {
    if (!isCouncilTier(params.actingUserRole)) {
      throw new ForbiddenException(
        'Only admin-grade or University-level users can record approvers',
      );
    }
    return addApprover(params.decisionId, params.targetUserId, params.role, params.noteTh);
  }

  // ── Outcome reviews ──────────────────────────────────────────────
  async dueHorizons(decisionId: string): Promise<OutcomeReviewHorizon[]> {
    const d = await prisma.councilDecision.findUnique({
      where: { id: decisionId },
      include: { outcomeReviews: { select: { horizon: true } } },
    });
    if (!d) throw new NotFoundException();
    return dueOutcomeReviewHorizons(
      d.effectiveDate,
      d.outcomeReviews.map((r) => r.horizon),
    );
  }

  // ── Lessons learned ──────────────────────────────────────────────
  async lessonsLearned(topic?: string) {
    return searchLessonsLearned(topic);
  }

  // ── Annotations (visibility-filtered) ────────────────────────────
  async listAnnotations(params: {
    userId: string;
    userRole: string;
    entityType?: string;
    entityId?: string;
    kind?: string;
  }) {
    // PRIVATE → only author; TEAM → author + collaborators (approximated
    // as council-tier roles); COUNCIL → council-tier roles.
    const isPrivileged = isCouncilTier(params.userRole);
    return prisma.annotation.findMany({
      where: {
        entityType: params.entityType,
        entityId: params.entityId,
        kind: params.kind,
        OR: [
          { userId: params.userId },
          { visibility: 'TEAM' },
          ...(isPrivileged ? [{ visibility: 'COUNCIL' as const }] : []),
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, email: true } } },
      take: 100,
    });
  }

  async createAnnotation(params: {
    userId: string;
    entityType: string;
    entityId: string;
    kind?: string;
    sectionKey?: string;
    aiInferenceId?: string;
    bodyTh?: string;
    bodyEn?: string;
    visibility?: 'PRIVATE' | 'TEAM' | 'COUNCIL';
  }) {
    return prisma.annotation.create({
      data: {
        userId: params.userId,
        entityType: params.entityType,
        entityId: params.entityId,
        kind: params.kind ?? 'comment',
        sectionKey: params.sectionKey,
        aiInferenceId: params.aiInferenceId,
        bodyTh: params.bodyTh,
        bodyEn: params.bodyEn,
        visibility: params.visibility ?? 'PRIVATE',
      },
    });
  }

  // ── Internal auth helper ─────────────────────────────────────────
  private async assertOwnerOrCouncil(decisionId: string, userId: string, role: string) {
    if (isCouncilTier(role)) return;
    const d = await prisma.councilDecision.findUnique({
      where: { id: decisionId },
      select: { userId: true },
    });
    if (!d) throw new NotFoundException();
    if (d.userId !== userId) {
      throw new ForbiddenException('Not authorised');
    }
  }
}
