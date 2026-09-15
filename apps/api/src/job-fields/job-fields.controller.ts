import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  addProgramJobField,
  latestJobThaiRunId,
  listJobFields,
  listProgramJobFields,
  mergeJobFields,
  renameJobField,
  setJobFieldStatus,
  setProgramJobFieldStatus,
} from '@kku/db';
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

  // Seam for the unit test; the real call is one line.
  private setStatus(id: string, reviewStatus: 'APPROVED' | 'REJECTED'): Promise<void> {
    return setJobFieldStatus(id, reviewStatus);
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

  @Post(':id/approve')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'job_field.approve', entityType: 'JobFieldTaxonomy' })
  async approve(@Param('id') id: string) {
    await this.setStatus(id, 'APPROVED');
    await this.invalidate();
    return { id, reviewStatus: 'APPROVED' };
  }

  @Post(':id/reject')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'job_field.reject', entityType: 'JobFieldTaxonomy' })
  async reject(@Param('id') id: string) {
    await this.setStatus(id, 'REJECTED');
    await this.invalidate();
    return { id, reviewStatus: 'REJECTED' };
  }

  @Patch(':id')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'job_field.rename', entityType: 'JobFieldTaxonomy' })
  async rename(@Param('id') id: string, @Body(new ZodValidationPipe(RenameBody)) body: z.infer<typeof RenameBody>) {
    await renameJobField(id, body);
    await this.invalidate();
    return { id, ...body };
  }

  @Post(':id/merge')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'job_field.merge', entityType: 'JobFieldTaxonomy' })
  async merge(@Param('id') id: string, @Body(new ZodValidationPipe(MergeBody)) body: z.infer<typeof MergeBody>) {
    const result = await mergeJobFields(id, body.intoId);
    await this.invalidate();
    return { from: id, into: body.intoId, ...result };
  }

  @Post('assignments')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'program_job_field.add', entityType: 'ProgramJobField' })
  async addAssignment(@Body(new ZodValidationPipe(AddAssignmentBody)) body: z.infer<typeof AddAssignmentBody>) {
    const id = await addProgramJobField(body.programId, body.fieldId, await latestJobThaiRunId());
    await this.invalidate();
    return { id, ...body, reviewStatus: 'APPROVED' };
  }

  @Post('assignments/:id/approve')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'program_job_field.approve', entityType: 'ProgramJobField' })
  async approveAssignment(@Param('id') id: string) {
    await setProgramJobFieldStatus(id, 'APPROVED');
    await this.invalidate();
    return { id, reviewStatus: 'APPROVED' };
  }

  @Post('assignments/:id/reject')
  @Authorized('data_sources:configure')
  @AuditLog({ action: 'program_job_field.reject', entityType: 'ProgramJobField' })
  async rejectAssignment(@Param('id') id: string) {
    await setProgramJobFieldStatus(id, 'REJECTED');
    await this.invalidate();
    return { id, reviewStatus: 'REJECTED' };
  }
}
