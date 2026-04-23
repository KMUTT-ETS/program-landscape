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
    if (existing.status === 'ARCHIVED' && params.userRole !== 'ADMIN') {
      throw new ForbiddenException('Archived decisions can only be edited by ADMIN');
    }
    // Owners + ADMIN can always edit; COUNCIL / EXECUTIVE can edit post-
    // COUNCIL_REVIEWED (they're part of the approval loop).
    if (
      existing.userId !== params.userId &&
      !['ADMIN', 'COUNCIL', 'EXECUTIVE'].includes(params.userRole)
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
    if (!['COUNCIL', 'EXECUTIVE', 'ADMIN'].includes(params.userRole)) {
      throw new ForbiddenException('Only COUNCIL/EXECUTIVE/ADMIN can amend decisions');
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
    if (!['COUNCIL', 'EXECUTIVE', 'ADMIN'].includes(params.actingUserRole)) {
      throw new ForbiddenException('Only COUNCIL/EXECUTIVE/ADMIN can record approvers');
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
    // as COUNCIL+ roles); COUNCIL → COUNCIL+ roles.
    const isPrivileged = ['COUNCIL', 'EXECUTIVE', 'ADMIN'].includes(params.userRole);
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
    if (['COUNCIL', 'EXECUTIVE', 'ADMIN'].includes(role)) return;
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
