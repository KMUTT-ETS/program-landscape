import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  addProgramJobField,
  bulkApproveJobFields,
  bulkApproveProgramJobFields,
  JOB_FIELDS_BULK_APPROVE_MAX,
  PROGRAM_JOB_FIELDS_BULK_APPROVE_MAX,
  jobThaiLinkState,
  latestDemandRunId,
  listJobFields,
  listProgramJobFields,
  mergeJobFields,
  Prisma,
  renameJobField,
  setJobFieldStatus,
  setProgramJobFieldStatus,
  synonymSourcesForAllFields,
  synonymSourcesForField,
} from '@kku/db';
import { ApiError, type SessionUser } from '@kku/shared';
import { AuditLog, AuthSession, Authorized, ZodValidationPipe } from '../common';
import { CacheService } from '../common/cache.service';
import { AiJobsQueueService } from '../ai-jobs/ai-jobs-queue.service';

// Review API for the field-of-study taxonomy (spec §3.3). Every mutation is
// audit-logged and purges the Gap Analyzer's map cache.

export const GAP_MAP_CACHE_PATTERN = 'gap:map:*';

export const RenameBody = z.object({ nameTh: z.string().min(1).max(200), nameEn: z.string().min(1).max(200) });
export const MergeBody = z.object({ intoId: z.string().min(1) });
export const AddAssignmentBody = z.object({ programId: z.string().min(1), fieldId: z.string().min(1) });
const AssignmentsQuery = z.object({ fieldId: z.string().optional() });
export const BulkApproveBody = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1, 'select at least one field')
    .max(JOB_FIELDS_BULK_APPROVE_MAX, `at most ${JOB_FIELDS_BULK_APPROVE_MAX} fields per bulk approval`),
});
export const BulkApproveAssignmentsBody = z.object({
  ids: z
    .array(z.string().min(1))
    .min(1, 'select at least one assignment')
    .max(PROGRAM_JOB_FIELDS_BULK_APPROVE_MAX, `at most ${PROGRAM_JOB_FIELDS_BULK_APPROVE_MAX} assignments per bulk approval`),
});

@Controller('/admin/job-fields')
export class JobFieldsController {
  constructor(
    private readonly cache: CacheService,
    private readonly aiJobs: AiJobsQueueService,
  ) {}

  private async invalidate(): Promise<void> {
    await this.cache.purge(GAP_MAP_CACHE_PATTERN);
  }

  // A bad id from the URL/body is a caller mistake, not a server fault:
  // Prisma's "record to update/delete not found" (P2025) becomes a 404, and
  // a foreign-key miss on a create/upsert (P2003) becomes a 400. Anything
  // else re-throws untouched (the global filter maps it to 500).
  private async db<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') throw new ApiError('NOT_FOUND', 'no such field or assignment');
        if (err.code === 'P2003') throw new ApiError('VALIDATION_FAILED', 'unknown programme or field id');
      }
      throw err;
    }
  }

  @Get()
  @Authorized('data_sources:read')
  async list() {
    return listJobFields();
  }

  @Get('assignments')
  @Authorized('data_sources:read')
  async assignments(@Query(new ZodValidationPipe(AssignmentsQuery)) q: z.infer<typeof AssignmentsQuery>) {
    return listProgramJobFields(q.fieldId);
  }

  // Which demand source(s) contributed each synonym of a field — see
  // synonymSourcesForField's doc comment (packages/db/src/job-fields.ts) for
  // why a reviewer needs this before approving. With no fieldId, returns the
  // bulk attribution for every field in one query, which is what the review
  // page loads (the "government-only" warning has to hold for every row, not
  // only whichever one is selected).
  @Get('synonym-sources')
  @Authorized('data_sources:read')
  async synonymSources(@Query(new ZodValidationPipe(AssignmentsQuery)) q: z.infer<typeof AssignmentsQuery>) {
    if (q.fieldId) {
      const rows = await synonymSourcesForField(q.fieldId);
      return rows.map((r) => ({ fieldId: q.fieldId as string, ...r }));
    }
    return synonymSourcesForAllFields();
  }

  // ── Derived-layer rebuild triggers ─────────────────────────────────────
  //
  // Approving a field or an assignment changes nothing visible on its own —
  // both feed the JobThai programme-link bridge, which is only rebuilt by a
  // CLI script today. These two POSTs let an operator trigger that rebuild
  // from the page instead. Same shape as
  // EducationController's class-offerings/refresh: enqueue a BullMQ ai-jobs
  // job, ingestion's worker does the work, GET reports freshness + whether a
  // job is currently in flight.
  //
  // Audited as two DISTINCT actions on purpose — a free, deterministic link
  // rebuild and a full refresh that spends real AI money must never look the
  // same to someone reading the audit log later.

  @Post('rebuild-links')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'job_field.rebuild_links', entityType: 'ProgramJobThaiLink' })
  async rebuildLinks(@AuthSession() user: SessionUser) {
    const jobId = await this.aiJobs.enqueue({
      kind: 'RUN_JOBTHAI_LINK_REBUILD',
      // entityId is an unused sentinel — the rebuild is portfolio-wide.
      entityId: '__all__',
      trigger: 'MANUAL',
      triggeredByUserId: user.userId,
    });
    return { jobId };
  }

  @Post('refresh-all')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'job_field.refresh_all', entityType: 'ProgramJobThaiLink' })
  async refreshAll(@AuthSession() user: SessionUser) {
    const jobId = await this.aiJobs.enqueue({
      kind: 'RUN_JOBTHAI_FULL_REFRESH',
      entityId: '__all__',
      trigger: 'MANUAL',
      triggeredByUserId: user.userId,
    });
    return { jobId };
  }

  @Get('refresh-status')
  @Authorized('data_sources:read')
  async refreshStatus() {
    const [linkRebuildRunning, fullRefreshRunning, lastLinkRebuild, lastFullRefresh, linkState] = await Promise.all([
      this.aiJobs.countRunning('RUN_JOBTHAI_LINK_REBUILD').then((n) => n > 0),
      this.aiJobs.countRunning('RUN_JOBTHAI_FULL_REFRESH').then((n) => n > 0),
      this.aiJobs.latestOutcome('RUN_JOBTHAI_LINK_REBUILD'),
      this.aiJobs.latestOutcome('RUN_JOBTHAI_FULL_REFRESH'),
      jobThaiLinkState(),
    ]);
    return { linkRebuildRunning, fullRefreshRunning, lastLinkRebuild, lastFullRefresh, linkState };
  }

  @Post(':id/approve')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'job_field.approve', entityType: 'JobFieldTaxonomy' })
  async approve(@Param('id') id: string) {
    await this.db(() => setJobFieldStatus(id, 'APPROVED'));
    await this.invalidate();
    return { id, reviewStatus: 'APPROVED' };
  }

  @Post(':id/reject')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'job_field.reject', entityType: 'JobFieldTaxonomy' })
  async reject(@Param('id') id: string) {
    await this.db(() => setJobFieldStatus(id, 'REJECTED'));
    await this.invalidate();
    return { id, reviewStatus: 'REJECTED' };
  }

  @Patch(':id')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'job_field.rename', entityType: 'JobFieldTaxonomy' })
  async rename(@Param('id') id: string, @Body(new ZodValidationPipe(RenameBody)) body: z.infer<typeof RenameBody>) {
    await this.db(() => renameJobField(id, body));
    await this.invalidate();
    return { id, ...body };
  }

  @Post(':id/merge')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'job_field.merge', entityType: 'JobFieldTaxonomy' })
  async merge(@Param('id') id: string, @Body(new ZodValidationPipe(MergeBody)) body: z.infer<typeof MergeBody>) {
    // mergeJobFields also guards this, but a validation error should read
    // as a 400 (caller mistake), not the 500 a bare `throw new Error` maps to.
    if (id === body.intoId) throw new ApiError('VALIDATION_FAILED', 'cannot merge a field into itself');
    const result = await this.db(() => mergeJobFields(id, body.intoId));
    await this.invalidate();
    // The audit interceptor reads entityId from result.id — after a merge
    // the from-row (id) no longer exists, so id here must be the survivor.
    return { id: body.intoId, from: id, into: body.intoId, ...result };
  }

  // Bulk approve. Atomic — see bulkApproveJobFields's doc comment — and
  // logged as ONE audit event carrying every id in the payload, not one
  // event per field, so a reviewer scanning the audit log sees the batch as
  // the single decision it was, not noise. Deliberately no bulk-reject: this
  // page's guidance is "approve narrow fields first", and rejection has a
  // different risk profile nobody asked to bulk.
  @Post('bulk-approve')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'job_field.bulk_approve', entityType: 'JobFieldTaxonomy' })
  async bulkApprove(@Body(new ZodValidationPipe(BulkApproveBody)) body: z.infer<typeof BulkApproveBody>) {
    const ids = [...new Set(body.ids)];
    const result = await this.db(() => bulkApproveJobFields(ids));
    await this.invalidate();
    return { ids, approved: result.approved };
  }

  @Post('assignments')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'program_job_field.add', entityType: 'ProgramJobField' })
  async addAssignment(@Body(new ZodValidationPipe(AddAssignmentBody)) body: z.infer<typeof AddAssignmentBody>) {
    const runId = await latestDemandRunId();
    const id = await this.db(() => addProgramJobField(body.programId, body.fieldId, runId));
    await this.invalidate();
    return { id, ...body, reviewStatus: 'APPROVED' };
  }

  // Bulk approve — the assignment-level sibling of `bulkApprove` above. Same
  // atomicity + one-audit-event contract (bulkApproveProgramJobFields's own
  // comment has the details). Deliberately no cap tied to a single field:
  // enforcement here is a flat batch-size cap only — the UI is what keeps a
  // submission scoped to one field's visible rows (see
  // apps/web/app/admin/job-fields/client.tsx's selectedByField map).
  @Post('assignments/bulk-approve')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'program_job_field.bulk_approve', entityType: 'ProgramJobField' })
  async bulkApproveAssignments(@Body(new ZodValidationPipe(BulkApproveAssignmentsBody)) body: z.infer<typeof BulkApproveAssignmentsBody>) {
    const ids = [...new Set(body.ids)];
    const result = await this.db(() => bulkApproveProgramJobFields(ids));
    await this.invalidate();
    return { ids, approved: result.approved };
  }

  @Post('assignments/:id/approve')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'program_job_field.approve', entityType: 'ProgramJobField' })
  async approveAssignment(@Param('id') id: string) {
    await this.db(() => setProgramJobFieldStatus(id, 'APPROVED'));
    await this.invalidate();
    return { id, reviewStatus: 'APPROVED' };
  }

  @Post('assignments/:id/reject')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'program_job_field.reject', entityType: 'ProgramJobField' })
  async rejectAssignment(@Param('id') id: string) {
    await this.db(() => setProgramJobFieldStatus(id, 'REJECTED'));
    await this.invalidate();
    return { id, reviewStatus: 'REJECTED' };
  }
}
