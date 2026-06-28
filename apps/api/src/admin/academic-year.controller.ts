import { Body, Controller, Get, Put } from '@nestjs/common';
import { z } from 'zod';
import { AuditLog, AuthSession, Authorized, Provenance, ZodValidationPipe } from '../common';
import type { SessionUser } from '@kku/shared';
import { AcademicYearService } from './academic-year.service';

const SetSchema = z.object({
  nextStartDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD')
    // Reject non-calendar dates. `new Date('2026-06-31')` silently rolls over
    // to July 1, so a not-NaN check isn't enough — require the parsed UTC date
    // to round-trip back to the exact input (this is an org-wide setting).
    .refine((s) => new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s, 'invalid calendar date'),
});
type SetBody = z.infer<typeof SetSchema>;

@Controller('/admin/academic-year')
export class AcademicYearController {
  constructor(private readonly service: AcademicYearService) {}

  @Get()
  @Authorized('settings:configure')
  @Provenance({ sources: [{ id: 'platform', name: 'Platform runtime' }] })
  async get() {
    return this.service.get();
  }

  @Put()
  @Authorized('settings:configure')
  @AuditLog({ action: 'academic_year.set', entityType: 'SystemSetting' })
  async set(
    @Body(new ZodValidationPipe(SetSchema)) body: SetBody,
    @AuthSession() user: SessionUser,
  ) {
    return this.service.set(body.nextStartDate, user.userId);
  }
}
