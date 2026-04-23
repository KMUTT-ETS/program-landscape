import { z } from 'zod';
import {
  Prisma,
  type DecisionStatus,
  type DecisionType,
  type DecisionMilestoneStatus,
  type OutcomeReviewHorizon,
} from '@prisma/client';
import { prisma } from './index';
import { computeHealthScores } from './health-score';
import { computeRisks, computeSkillGap } from './gap-analysis';

// ═══════════════════════════════════════════════════════════════════════
// Decision Workspace (prompt 12)
//
// Reads + the specific narrow writes (snapshot capture, milestone
// updates, outcome review creation). General CRUD happens in the API
// service layer using Prisma directly — only functions that carry
// meaningful semantics live here.
// ═══════════════════════════════════════════════════════════════════════

export const DECISION_WORKSPACE_VERSION = 'decision-workspace.v1';

// ── List + get ───────────────────────────────────────────────────────
export const DecisionListFilterSchema = z.object({
  status: z.nativeEnum({ PROPOSED: 'PROPOSED', COUNCIL_REVIEWED: 'COUNCIL_REVIEWED', APPROVED: 'APPROVED', IN_IMPLEMENTATION: 'IN_IMPLEMENTATION', IMPLEMENTED: 'IMPLEMENTED', COMPLETED: 'COMPLETED', REJECTED: 'REJECTED', SUPERSEDED: 'SUPERSEDED', ARCHIVED: 'ARCHIVED' } as const).optional(),
  decisionType: z.string().optional(),
  facultyId: z.string().optional(),
  affectedProgramId: z.string().optional(),
  includeAmended: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(50),
});
export type DecisionListFilter = z.infer<typeof DecisionListFilterSchema>;

export interface DecisionListRow {
  id: string;
  title: string;
  decisionType: DecisionType;
  status: DecisionStatus;
  affectedProgramIds: string[];
  facultyId: string | null;
  effectiveDate: Date | null;
  councilSessionRef: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  milestoneCount: number;
  approverCount: number;
  hasSnapshot: boolean;
  hasSupersedingDecision: boolean;
  owner: { id: string; name: string | null; email: string } | null;
}

export async function listDecisions(filter: DecisionListFilter): Promise<DecisionListRow[]> {
  const f = DecisionListFilterSchema.parse(filter);
  const where: Prisma.CouncilDecisionWhereInput = {};
  if (f.status) where.status = f.status;
  if (f.decisionType) where.decisionType = f.decisionType as DecisionType;
  if (f.facultyId) where.facultyId = f.facultyId;
  if (f.affectedProgramId) where.affectedProgramIds = { has: f.affectedProgramId };
  if (!f.includeAmended) where.supersededById = null;

  const rows = await prisma.councilDecision.findMany({
    where,
    take: f.limit,
    orderBy: [{ updatedAt: 'desc' }],
    include: {
      user: { select: { id: true, name: true, email: true } },
      _count: { select: { milestones: true, approvers: true, amendments: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    decisionType: r.decisionType,
    status: r.status,
    affectedProgramIds: r.affectedProgramIds,
    facultyId: r.facultyId,
    effectiveDate: r.effectiveDate,
    councilSessionRef: r.councilSessionRef,
    version: r.version,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    milestoneCount: r._count.milestones,
    approverCount: r._count.approvers,
    hasSnapshot: r.snapshotJson != null,
    hasSupersedingDecision: r._count.amendments > 0,
    owner: r.user,
  }));
}

// Full get — everything the detail page needs.
export async function getDecisionWithEverything(decisionId: string) {
  const decision = await prisma.councilDecision.findUnique({
    where: { id: decisionId },
    include: {
      user: { select: { id: true, name: true, email: true, role: true } },
      scenario: { select: { id: true, name: true, scenarioType: true, workflowStatus: true } },
      milestones: { orderBy: { orderIdx: 'asc' }, include: { owner: { select: { id: true, name: true, email: true } } } },
      approvers: { orderBy: { approvedAt: 'asc' }, include: { user: { select: { id: true, name: true, email: true, role: true } } } },
      outcomeReviews: { orderBy: { generatedAt: 'desc' } },
      supersededBy: { select: { id: true, title: true, status: true } },
      amendments: { select: { id: true, title: true, status: true, version: true } },
      resolutionPdf: { select: { id: true, originalFilename: true, storageUrl: true } },
    },
  });
  if (!decision) return null;
  return decision;
}

// ── Snapshot capture ────────────────────────────────────────────────
//
// Called when status transitions to COUNCIL_REVIEWED. Freezes the
// cockpit/gap/trend state so the future outcome review can diff against
// it. Idempotent: once captured, refuses to overwrite.
export interface DecisionSnapshot {
  capturedAt: string;
  scope: { affectedProgramIds: string[]; facultyId: string | null };
  health: unknown;
  risks: unknown;
  topSkillGaps: unknown;
  recentTrendCount: number;
  methodologyVersion: typeof DECISION_WORKSPACE_VERSION;
}

export async function captureSnapshot(decisionId: string, force = false): Promise<DecisionSnapshot> {
  const decision = await prisma.councilDecision.findUniqueOrThrow({
    where: { id: decisionId },
    select: { affectedProgramIds: true, facultyId: true, snapshotJson: true },
  });
  if (decision.snapshotJson && !force) {
    // Immutable — keep the existing snapshot. Returning the current
    // persisted snapshot rather than silently computing a new one.
    return decision.snapshotJson as unknown as DecisionSnapshot;
  }

  // Pull current state at the decision's scope.
  const scope = decision.facultyId ? 'faculty' : 'university';
  const scopeId = decision.facultyId ?? undefined;
  const [health, risks, topSkillGaps, recentTrendCount] = await Promise.all([
    computeHealthScores(scope, scopeId ?? null),
    computeRisks({ scope, scopeId, region: 'TH', horizon: 5, comparison: 'absolute', limit: 20 }),
    computeSkillGap({ scope, scopeId, region: 'TH', horizon: 0, comparison: 'absolute', limit: 10 }),
    prisma.trendSignal.count({
      where: {
        detectedDate: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
        OR: decision.affectedProgramIds.length > 0
          ? [{ affectedProgramIds: { hasSome: decision.affectedProgramIds } }]
          : undefined,
      },
    }),
  ]);

  const snapshot: DecisionSnapshot = {
    capturedAt: new Date().toISOString(),
    scope: { affectedProgramIds: decision.affectedProgramIds, facultyId: decision.facultyId },
    health,
    risks,
    topSkillGaps,
    recentTrendCount,
    methodologyVersion: DECISION_WORKSPACE_VERSION,
  };

  await prisma.councilDecision.update({
    where: { id: decisionId },
    data: {
      snapshotJson: snapshot as unknown as Prisma.InputJsonValue,
      snapshotCapturedAt: new Date(),
    },
  });
  return snapshot;
}

// ── Milestones ───────────────────────────────────────────────────────
export interface CreateMilestoneInput {
  decisionId: string;
  title: string;
  descriptionTh?: string;
  ownerId?: string;
  targetDate?: Date;
  orderIdx?: number;
}

export async function createMilestone(input: CreateMilestoneInput) {
  const max = await prisma.decisionMilestone.aggregate({
    where: { decisionId: input.decisionId },
    _max: { orderIdx: true },
  });
  return prisma.decisionMilestone.create({
    data: {
      decisionId: input.decisionId,
      title: input.title,
      descriptionTh: input.descriptionTh,
      ownerId: input.ownerId,
      targetDate: input.targetDate,
      orderIdx: input.orderIdx ?? ((max._max.orderIdx ?? 0) + 1),
    },
  });
}

export interface PatchMilestoneInput {
  status?: DecisionMilestoneStatus;
  title?: string;
  descriptionTh?: string;
  ownerId?: string | null;
  targetDate?: Date | null;
  completedDate?: Date | null;
  evidenceUrl?: string | null;
  orderIdx?: number;
}

export async function patchMilestone(milestoneId: string, patch: PatchMilestoneInput) {
  const data: Prisma.DecisionMilestoneUpdateInput = {};
  if (patch.status != null) {
    data.status = patch.status;
    // Auto-stamp completedDate when status flips to DONE.
    if (patch.status === 'DONE' && patch.completedDate === undefined) {
      data.completedDate = new Date();
    }
  }
  if (patch.title !== undefined) data.title = patch.title;
  if (patch.descriptionTh !== undefined) data.descriptionTh = patch.descriptionTh;
  if (patch.ownerId !== undefined) data.owner = patch.ownerId ? { connect: { id: patch.ownerId } } : { disconnect: true };
  if (patch.targetDate !== undefined) data.targetDate = patch.targetDate;
  if (patch.completedDate !== undefined) data.completedDate = patch.completedDate;
  if (patch.evidenceUrl !== undefined) data.evidenceUrl = patch.evidenceUrl;
  if (patch.orderIdx !== undefined) data.orderIdx = patch.orderIdx;
  return prisma.decisionMilestone.update({ where: { id: milestoneId }, data });
}

// ── Approvers ────────────────────────────────────────────────────────
export async function addApprover(decisionId: string, userId: string, role: string = 'approver', noteTh?: string) {
  return prisma.decisionApprover.upsert({
    where: { decisionId_userId: { decisionId, userId } },
    update: { role, noteTh, approvedAt: new Date() },
    create: { decisionId, userId, role, noteTh },
  });
}

// ── Outcome review horizon calculation ───────────────────────────────
//
// Given a decision's effectiveDate, which horizons are due?
// Returns horizons that have passed AND don't yet have a review row.
export function dueOutcomeReviewHorizons(
  effectiveDate: Date | null,
  existingHorizons: OutcomeReviewHorizon[],
  now: Date = new Date(),
): OutcomeReviewHorizon[] {
  if (!effectiveDate) return [];
  const existing = new Set(existingHorizons);
  const due: OutcomeReviewHorizon[] = [];
  const ms6mo = 182 * 24 * 60 * 60 * 1000;
  const ms1yr = 365 * 24 * 60 * 60 * 1000;
  const ms3yr = 365 * 3 * 24 * 60 * 60 * 1000;
  const age = now.getTime() - effectiveDate.getTime();
  if (age >= ms6mo && !existing.has('SIX_MONTHS')) due.push('SIX_MONTHS');
  if (age >= ms1yr && !existing.has('ONE_YEAR')) due.push('ONE_YEAR');
  if (age >= ms3yr && !existing.has('THREE_YEARS')) due.push('THREE_YEARS');
  return due;
}

// ── Lessons learned search ───────────────────────────────────────────
export interface LessonHit {
  decisionId: string;
  decisionTitle: string;
  decisionType: DecisionType;
  horizon: OutcomeReviewHorizon;
  generatedAt: Date;
  lessonsTh: string[];
  lessonsEn: string[];
}

export async function searchLessonsLearned(topic?: string, limit = 30): Promise<LessonHit[]> {
  const where: Prisma.DecisionOutcomeReviewWhereInput = {};
  if (topic) {
    where.OR = [
      { narrativeTh: { contains: topic } },
      { narrativeEn: { contains: topic, mode: 'insensitive' } },
    ];
  }
  const rows = await prisma.decisionOutcomeReview.findMany({
    where,
    take: limit,
    orderBy: { generatedAt: 'desc' },
    include: {
      decision: { select: { id: true, title: true, decisionType: true } },
    },
  });
  return rows.map((r) => {
    const raw = r.lessonsJson as unknown as { th?: string[]; en?: string[] } | null;
    return {
      decisionId: r.decision.id,
      decisionTitle: r.decision.title,
      decisionType: r.decision.decisionType,
      horizon: r.horizon,
      generatedAt: r.generatedAt,
      lessonsTh: raw?.th ?? [],
      lessonsEn: raw?.en ?? [],
    };
  });
}

// ── Status transition validation ─────────────────────────────────────
//
// Expresses the allowed graph. Attempting an invalid transition throws;
// the API service catches and returns a 400.
const ALLOWED_TRANSITIONS: Record<DecisionStatus, DecisionStatus[]> = {
  PROPOSED: ['COUNCIL_REVIEWED', 'REJECTED', 'ARCHIVED'],
  COUNCIL_REVIEWED: ['APPROVED', 'REJECTED', 'ARCHIVED'],
  APPROVED: ['IN_IMPLEMENTATION', 'SUPERSEDED', 'ARCHIVED'],
  IN_IMPLEMENTATION: ['IMPLEMENTED', 'COMPLETED', 'SUPERSEDED', 'ARCHIVED'],
  IMPLEMENTED: ['COMPLETED', 'SUPERSEDED', 'ARCHIVED'],
  COMPLETED: ['ARCHIVED'],
  REJECTED: ['ARCHIVED'],
  SUPERSEDED: ['ARCHIVED'],
  ARCHIVED: [],
};

export function assertTransitionAllowed(from: DecisionStatus, to: DecisionStatus): void {
  if (from === to) return;
  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid decision status transition: ${from} → ${to}. Allowed: ${allowed.join(', ') || '(none)'}`);
  }
}

// Which roles can perform which transitions. Enforced in the service.
export const TRANSITION_ROLE_GATE: Partial<Record<DecisionStatus, Array<string>>> = {
  // Moving from PROPOSED → COUNCIL_REVIEWED is EXECUTIVE/ADMIN only.
  COUNCIL_REVIEWED: ['EXECUTIVE', 'ADMIN'],
  // Approving or rejecting is Council/Executive/Admin territory.
  APPROVED: ['COUNCIL', 'EXECUTIVE', 'ADMIN'],
  REJECTED: ['COUNCIL', 'EXECUTIVE', 'ADMIN'],
  // Archival can only be done by ADMIN.
  ARCHIVED: ['ADMIN'],
};

export function assertTransitionAllowedForRole(to: DecisionStatus, role: string): void {
  const gate = TRANSITION_ROLE_GATE[to];
  if (gate && !gate.includes(role)) {
    throw new Error(`Transition to ${to} requires one of: ${gate.join(', ')}. Got: ${role}`);
  }
}
