import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  AdminProgramListQuerySchema,
  ApplyExtractionSchema,
  AttachProgramDocumentSchema,
  CheckCollisionSchema,
  CreateProgramSchema,
  PatchProgramDocumentSchema,
  PatchProgramSchema,
  type AdminProgramListQuery,
  type ApplyExtractionInput,
  type AttachProgramDocumentInput,
  type CheckCollisionInput,
  type CreateProgramInput,
  type PatchProgramInput,
  type PatchProgramDocumentInput,
} from '@kku/shared';
import {
  AuditLog,
  Authorized,
  AuthSession,
  Provenance,
  ZodValidationPipe,
} from '../common';
import type { SessionUser } from '@kku/shared';
import { ProgramsService } from './programs.service';

// ═════════════════════════════════════════════════════════════════════
// Admin Programs API — separate path prefix (/admin/programs) to keep
// NestJS route matching crisp alongside the public `/programs/:id` route.
//
// Every mutation is @AuditLog'd (AuditLog table) and gated on
// programs:manage:all; the service additionally honors
// programs:manage:own_faculty for DEAN/DEPT_HEAD by checking the target
// program's facultyId post-load.
//
// Endpoints:
//   GET    /admin/programs                            — rich list
//   GET    /admin/programs/:id                        — detail w/ docs
//   POST   /admin/programs                            — create shell
//   PATCH  /admin/programs/:id                        — update headers
//   DELETE /admin/programs/:id                        — soft sunset
//   POST   /admin/programs/:id/documents              — attach
//   PATCH  /admin/programs/:id/documents/:docId       — edit
//   POST   /admin/programs/:id/documents/:docId/promote
//                                                     — promote current
//   DELETE /admin/programs/:id/documents/:docId       — detach
//   POST   /admin/programs/:id/apply-extraction/:extractionId
//                                                     — materialize
// ═════════════════════════════════════════════════════════════════════

@Controller('/admin/programs')
export class ProgramsAdminController {
  constructor(private readonly svc: ProgramsService) {}

  @Get()
  @Authorized('programs:manage:all')
  @Provenance({ sources: [{ id: 'kku-reg', name: 'KKU Registration' }] })
  async list(
    @Query(new ZodValidationPipe(AdminProgramListQuerySchema))
    q: AdminProgramListQuery,
  ) {
    return this.svc.list(q);
  }

  @Get(':id')
  @Authorized('programs:manage:all')
  @Provenance({ sources: [{ id: 'kku-reg', name: 'KKU Registration' }] })
  async getOne(@Param('id') id: string) {
    return this.svc.getOne(id);
  }

  @Post()
  @Authorized('programs:manage:all')
  @AuditLog({ action: 'program.create', entityType: 'Program' })
  async create(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(CreateProgramSchema)) body: CreateProgramInput,
  ) {
    return this.svc.create(user, body);
  }

  // Collision dry-run — called from the create-from-PDF wizard before the
  // admin commits. Does not mutate; not audit-logged.
  @Post('check-collision')
  @Authorized('programs:manage:all')
  async checkCollision(
    @Body(new ZodValidationPipe(CheckCollisionSchema)) body: CheckCollisionInput,
  ) {
    return this.svc.checkCollision(body);
  }

  @Patch(':id')
  @Authorized('programs:manage:all')
  @AuditLog({ action: 'program.patch', entityType: 'Program' })
  async patch(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(PatchProgramSchema)) body: PatchProgramInput,
  ) {
    return this.svc.patch(user, id, body);
  }

  @Delete(':id')
  @HttpCode(200)
  @Authorized('programs:manage:all')
  @AuditLog({ action: 'program.sunset', entityType: 'Program' })
  async sunset(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
  ) {
    return this.svc.sunset(user, id);
  }

  @Post(':id/documents')
  @Authorized('programs:manage:all')
  @AuditLog({ action: 'program.document.attach', entityType: 'ProgramDocument' })
  async attachDocument(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(AttachProgramDocumentSchema))
    body: AttachProgramDocumentInput,
  ) {
    return this.svc.attachDocument(user, id, body);
  }

  @Patch(':id/documents/:docId')
  @Authorized('programs:manage:all')
  @AuditLog({ action: 'program.document.patch', entityType: 'ProgramDocument' })
  async patchDocument(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Param('docId') docId: string,
    @Body(new ZodValidationPipe(PatchProgramDocumentSchema))
    body: PatchProgramDocumentInput,
  ) {
    return this.svc.patchDocument(user, id, docId, body);
  }

  @Post(':id/documents/:docId/promote')
  @Authorized('programs:manage:all')
  @AuditLog({ action: 'program.document.promote', entityType: 'ProgramDocument' })
  async promoteDocument(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Param('docId') docId: string,
  ) {
    return this.svc.promoteDocument(user, id, docId);
  }

  @Delete(':id/documents/:docId')
  @HttpCode(204)
  @Authorized('programs:manage:all')
  @AuditLog({ action: 'program.document.detach', entityType: 'ProgramDocument' })
  async detachDocument(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Param('docId') docId: string,
  ) {
    await this.svc.detachDocument(user, id, docId);
  }

  @Post(':id/apply-extraction/:extractionId')
  @Authorized('programs:manage:all')
  @AuditLog({ action: 'program.apply_extraction', entityType: 'Program' })
  async applyExtraction(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Param('extractionId') extractionId: string,
    @Body(new ZodValidationPipe(ApplyExtractionSchema))
    body: ApplyExtractionInput,
  ) {
    return this.svc.applyExtraction(user, id, extractionId, body);
  }

  // ─── Curriculum pipeline (admin/programs/pipeline page) ──────────────
  // Under /pipeline/* sub-path so the static routes don't collide with
  // the parametric @Get(':id') above.

  @Get('pipeline/stats')
  @Authorized('programs:manage:all')
  @Provenance({ sources: [{ id: 'kku-reg', name: 'KKU Registration' }] })
  async pipelineStats() {
    return this.svc.getPipelineStats();
  }

  @Get('pipeline/bucket/:bucket')
  @Authorized('programs:manage:all')
  @Provenance({ sources: [{ id: 'kku-reg', name: 'KKU Registration' }] })
  async pipelineBucket(
    @Param('bucket') bucket: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ) {
    const allowed = ['missing-pdf', 'need-digest', 'pending-review', 'approved'] as const;
    if (!(allowed as readonly string[]).includes(bucket)) {
      throw new Error(`unknown bucket: ${bucket} (valid: ${allowed.join(', ')})`);
    }
    return this.svc.listPipelineBucket(
      bucket as (typeof allowed)[number],
      {
        limit: limitRaw ? Number(limitRaw) : undefined,
        offset: offsetRaw ? Number(offsetRaw) : undefined,
      },
    );
  }

  @Post('pipeline/run-digest-bulk')
  @Authorized('programs:manage:all')
  @AuditLog({ action: 'program.run_digest_bulk', entityType: 'Program' })
  async runDigestBulk(
    @AuthSession() user: SessionUser,
    @Body() body: { limit?: number } = {},
  ) {
    return this.svc.enqueueDigestBulk(user, { limit: body.limit });
  }

  @Post(':id/run-digest')
  @Authorized('programs:manage:all')
  @AuditLog({ action: 'program.run_digest', entityType: 'Program' })
  async runDigest(
    @AuthSession() user: SessionUser,
    @Param('id') id: string,
    @Body() body: { force?: boolean } = {},
  ) {
    return this.svc.enqueueDigest(user, id, { force: !!body.force });
  }
}
