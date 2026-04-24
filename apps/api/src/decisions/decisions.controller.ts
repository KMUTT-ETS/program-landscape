import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import type { SessionUser } from '@kku/shared';
import {
  AiCall,
  AuditLog,
  AuthSession,
  Authorized,
  Provenance,
  ZodValidationPipe,
  AiQuota,
} from '../common';
import { DecisionsService } from './decisions.service';
import { DecisionReviewService } from './decision-review.service';

// ═════════════════════════════════════════════════════════════════════
// Decision Workspace API (prompt 12)
//
// 11 endpoints (9 decision endpoints + annotations listing + create):
//   GET    /decisions                                — list
//   POST   /decisions                                — create
//   GET    /decisions/:id                            — detail
//   PATCH  /decisions/:id                            — patch fields
//   POST   /decisions/:id/status                     — status transition
//   POST   /decisions/:id/amend                      — amend (new version)
//   POST   /decisions/:id/milestones                 — create milestone
//   PATCH  /decisions/:id/milestones/:milestoneId    — patch milestone
//   POST   /decisions/:id/approvers                  — record approver
//   POST   /decisions/:id/outcome-review             — trigger AI review
//   GET    /decisions/lessons-learned?topic=         — search
//   GET    /annotations                              — list
//   POST   /annotations                              — create
// ═════════════════════════════════════════════════════════════════════

const DecisionTypeEnum = z.enum(['CLOSE', 'MERGE', 'LAUNCH', 'RESTRUCTURE', 'KEEP_AS_IS', 'OTHER']);
const StatusEnum = z.enum([
  'PROPOSED',
  'COUNCIL_REVIEWED',
  'APPROVED',
  'IN_IMPLEMENTATION',
  'IMPLEMENTED',
  'COMPLETED',
  'REJECTED',
  'SUPERSEDED',
  'ARCHIVED',
]);
const MilestoneStatusEnum = z.enum(['PLANNED', 'IN_PROGRESS', 'DONE', 'BLOCKED', 'CANCELLED']);
const HorizonEnum = z.enum(['SIX_MONTHS', 'ONE_YEAR', 'THREE_YEARS']);

const ListQuerySchema = z.object({
  status: StatusEnum.optional(),
  decisionType: DecisionTypeEnum.optional(),
  facultyId: z.string().optional(),
  affectedProgramId: z.string().optional(),
  includeAmended: z
    .union([z.literal('true'), z.literal('false')])
    .transform((v) => v === 'true')
    .default('false'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
type ListQuery = z.infer<typeof ListQuerySchema>;

const CreateBodySchema = z.object({
  title: z.string().min(1),
  decisionType: DecisionTypeEnum,
  scenarioId: z.string().optional(),
  affectedProgramIds: z.array(z.string()).default([]),
  facultyId: z.string().optional(),
  rationaleTh: z.string().optional(),
  rationaleEn: z.string().optional(),
  dissentingViewsTh: z.string().optional(),
  effectiveDate: z.coerce.date().optional(),
  councilSessionRef: z.string().optional(),
});
type CreateBody = z.infer<typeof CreateBodySchema>;

const PatchBodySchema = z.object({
  title: z.string().optional(),
  rationaleTh: z.string().optional(),
  rationaleEn: z.string().optional(),
  dissentingViewsTh: z.string().optional(),
  effectiveDate: z.coerce.date().nullable().optional(),
  councilSessionRef: z.string().nullable().optional(),
  facultyId: z.string().nullable().optional(),
  resolutionPdfId: z.string().nullable().optional(),
});
type PatchBody = z.infer<typeof PatchBodySchema>;

const StatusBodySchema = z.object({ toStatus: StatusEnum });
type StatusBody = z.infer<typeof StatusBodySchema>;

const AmendBodySchema = z.object({
  title: z.string().optional(),
  rationaleTh: z.string().optional(),
  effectiveDate: z.coerce.date().optional(),
});
type AmendBody = z.infer<typeof AmendBodySchema>;

const MilestoneBodySchema = z.object({
  title: z.string().min(1),
  descriptionTh: z.string().optional(),
  ownerId: z.string().optional(),
  targetDate: z.coerce.date().optional(),
});
type MilestoneBody = z.infer<typeof MilestoneBodySchema>;

const MilestonePatchSchema = z.object({
  status: MilestoneStatusEnum.optional(),
  title: z.string().optional(),
  descriptionTh: z.string().optional(),
  ownerId: z.string().nullable().optional(),
  targetDate: z.coerce.date().nullable().optional(),
  completedDate: z.coerce.date().nullable().optional(),
  evidenceUrl: z.string().nullable().optional(),
  orderIdx: z.number().int().optional(),
});
type MilestonePatch = z.infer<typeof MilestonePatchSchema>;

const ApproverBodySchema = z.object({
  userId: z.string(),
  role: z.enum(['approver', 'observer', 'dissenter']).default('approver'),
  noteTh: z.string().optional(),
});
type ApproverBody = z.infer<typeof ApproverBodySchema>;

const OutcomeReviewBodySchema = z.object({ horizon: HorizonEnum });
type OutcomeReviewBody = z.infer<typeof OutcomeReviewBodySchema>;

const LessonsQuerySchema = z.object({ topic: z.string().optional() });
type LessonsQuery = z.infer<typeof LessonsQuerySchema>;

const AnnotationListSchema = z.object({
  entityType: z.string().optional(),
  entityId: z.string().optional(),
  kind: z.string().optional(),
});
type AnnotationList = z.infer<typeof AnnotationListSchema>;

const AnnotationCreateSchema = z.object({
  entityType: z.string(),
  entityId: z.string(),
  kind: z.string().optional(),
  sectionKey: z.string().optional(),
  aiInferenceId: z.string().optional(),
  bodyTh: z.string().optional(),
  bodyEn: z.string().optional(),
  visibility: z.enum(['PRIVATE', 'TEAM', 'COUNCIL']).default('PRIVATE'),
});
type AnnotationCreate = z.infer<typeof AnnotationCreateSchema>;

@Controller()
export class DecisionsController {
  constructor(
    private readonly decisions: DecisionsService,
    private readonly reviews: DecisionReviewService,
  ) {}

  // ── Lessons-learned first (more specific route beats :id) ─────────
  @Get('/decisions/lessons-learned')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'outcome-reviews', name: 'Decision outcome reviews' }] })
  async lessonsLearned(@Query(new ZodValidationPipe(LessonsQuerySchema)) q: LessonsQuery) {
    return this.decisions.lessonsLearned(q.topic);
  }

  // ── List + create ─────────────────────────────────────────────────
  @Get('/decisions')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'council-decisions', name: 'Council decisions' }] })
  async list(@Query(new ZodValidationPipe(ListQuerySchema)) q: ListQuery) {
    return this.decisions.list(q);
  }

  @Post('/decisions')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'decision.create', entityType: 'CouncilDecision' })
  async create(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(CreateBodySchema)) body: CreateBody,
  ) {
    return this.decisions.create({ userId: user.userId, ...body });
  }

  @Get('/decisions/:id')
  @Authorized('programs:read:all')
  @Provenance({ sources: [{ id: 'council-decisions', name: 'Council decisions' }] })
  async get(@Param('id') id: string) {
    return this.decisions.get(id);
  }

  @Patch('/decisions/:id')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'decision.patch', entityType: 'CouncilDecision' })
  async patch(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PatchBodySchema)) body: PatchBody,
  ) {
    return this.decisions.patch({
      decisionId: id,
      userId: user.userId,
      userRole: user.role,
      patch: body,
    });
  }

  @Post('/decisions/:id/status')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'decision.status', entityType: 'CouncilDecision' })
  async updateStatus(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(StatusBodySchema)) body: StatusBody,
  ) {
    return this.decisions.updateStatus({
      decisionId: id,
      userId: user.userId,
      userRole: user.role,
      toStatus: body.toStatus,
    });
  }

  @Post('/decisions/:id/amend')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'decision.amend', entityType: 'CouncilDecision' })
  async amend(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AmendBodySchema)) body: AmendBody,
  ) {
    return this.decisions.amend({
      decisionId: id,
      userId: user.userId,
      userRole: user.role,
      newFields: body,
    });
  }

  // ── Milestones ────────────────────────────────────────────────────
  @Post('/decisions/:id/milestones')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'milestone.create', entityType: 'DecisionMilestone' })
  async createMilestone(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(MilestoneBodySchema)) body: MilestoneBody,
  ) {
    return this.decisions.createMilestone({
      decisionId: id,
      userId: user.userId,
      userRole: user.role,
      ...body,
    });
  }

  @Patch('/decisions/:id/milestones/:milestoneId')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'milestone.patch', entityType: 'DecisionMilestone' })
  async patchMilestone(
    @AuthSession() user: SessionUser,
    @Param('milestoneId') milestoneId: string,
    @Body(new ZodValidationPipe(MilestonePatchSchema)) body: MilestonePatch,
  ) {
    return this.decisions.patchMilestone({
      milestoneId,
      userId: user.userId,
      userRole: user.role,
      patch: body,
    });
  }

  // ── Approvers ─────────────────────────────────────────────────────
  @Post('/decisions/:id/approvers')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'decision.approver', entityType: 'DecisionApprover' })
  async addApprover(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(ApproverBodySchema)) body: ApproverBody,
  ) {
    return this.decisions.addApprover({
      decisionId: id,
      targetUserId: body.userId,
      actingUserId: user.userId,
      actingUserRole: user.role,
      role: body.role,
      noteTh: body.noteTh,
    });
  }

  // ── Outcome review ────────────────────────────────────────────────
  @Post('/decisions/:id/outcome-review')
  @Authorized('programs:read:all')
  @Throttle({ ai_short: { limit: 10, ttl: 60_000 }, ai_hourly: { limit: 60, ttl: 60 * 60 * 1000 } })
  @AiQuota({ module: 'decisions' })
  @AiCall({ module: 'decisions' })
  async outcomeReview(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(OutcomeReviewBodySchema)) body: OutcomeReviewBody,
  ) {
    return this.reviews.generate({
      decisionId: id,
      horizon: body.horizon,
      userId: user.userId,
    });
  }

  // ── Annotations ───────────────────────────────────────────────────
  @Get('/annotations')
  @Authorized('programs:read:all')
  async listAnnotations(
    @AuthSession() user: SessionUser,
    @Query(new ZodValidationPipe(AnnotationListSchema)) q: AnnotationList,
  ) {
    return this.decisions.listAnnotations({
      userId: user.userId,
      userRole: user.role,
      entityType: q.entityType,
      entityId: q.entityId,
      kind: q.kind,
    });
  }

  @Post('/annotations')
  @Authorized('programs:read:all')
  @AuditLog({ action: 'annotation.create', entityType: 'Annotation' })
  async createAnnotation(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(AnnotationCreateSchema)) body: AnnotationCreate,
  ) {
    return this.decisions.createAnnotation({
      userId: user.userId,
      ...body,
    });
  }
}
