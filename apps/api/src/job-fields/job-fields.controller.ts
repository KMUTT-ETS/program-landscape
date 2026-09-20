import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  addProgramJobField,
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
import { ApiError } from '@kku/shared';
import { AuditLog, Authorized, ZodValidationPipe } from '../common';
import { CacheService } from '../common/cache.service';

// Review API for the field-of-study taxonomy (spec §3.3). Every mutation is
// audit-logged and purges the Gap Analyzer's map cache.

export const GAP_MAP_CACHE_PATTERN = 'gap:map:*';

export const RenameBody = z.object({ nameTh: z.string().min(1).max(200), nameEn: z.string().min(1).max(200) });
export const MergeBody = z.object({ intoId: z.string().min(1) });
export const AddAssignmentBody = z.object({ programId: z.string().min(1), fieldId: z.string().min(1) });
const AssignmentsQuery = z.object({ fieldId: z.string().optional() });

@Controller('/admin/job-fields')
export class JobFieldsController {
  constructor(private readonly cache: CacheService) {}

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

  @Post('assignments')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'program_job_field.add', entityType: 'ProgramJobField' })
  async addAssignment(@Body(new ZodValidationPipe(AddAssignmentBody)) body: z.infer<typeof AddAssignmentBody>) {
    const runId = await latestDemandRunId();
    const id = await this.db(() => addProgramJobField(body.programId, body.fieldId, runId));
    await this.invalidate();
    return { id, ...body, reviewStatus: 'APPROVED' };
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
