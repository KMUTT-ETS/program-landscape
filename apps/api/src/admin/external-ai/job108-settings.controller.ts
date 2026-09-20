import { BadRequestException, Body, Controller, Get, Patch } from '@nestjs/common';
import { z } from 'zod';
import { readJob108Settings, writeJob108Settings, type Job108Settings } from '@kku/db';
import type { SessionUser } from '@kku/shared';
import { AuditLog, AuthSession, Authorized, Provenance, ZodValidationPipe } from '../../common';

// ─────────────────────────────────────────────────────────────────────────
// /admin/job108-settings — operator-editable fetch settings for the job-108
// connector (Task 17), living beside /admin/external-ai-sources because
// both back the same /admin/external/ai-search page. Gated on the same
// `pdf:admin` permission as ExternalAiController for the same reason: this
// is Phase-5's operator audience, not a distinct permission worth splitting
// out yet.
//
// GET returns the effective settings (defaults filled where nothing is
// stored). PATCH accepts a partial update; the underlying
// writeJob108Settings validates the MERGED result before writing anything,
// so a rejected field (an off-origin sitemap URL, a sub-1000ms spacing)
// never partially lands. A validation failure is surfaced as 400 with the
// db layer's exact message — the operator needs to read WHY a value was
// refused, not a generic "Internal server error".
// ─────────────────────────────────────────────────────────────────────────

const PatchBodySchema = z.object({
  sitemapUrl: z.string().min(1).optional(),
  requestSpacingMs: z.coerce.number().int().positive().optional(),
  maxAnnouncementsPerRun: z.coerce.number().int().positive().optional(),
  defaultWindowMonths: z.coerce.number().int().positive().optional(),
});
type PatchBody = z.infer<typeof PatchBodySchema>;

@Controller('/admin/job108-settings')
export class Job108SettingsController {
  @Get()
  @Authorized('pdf:admin')
  @Provenance({ sources: [{ id: 'platform', name: 'Platform runtime' }] })
  async get(): Promise<Job108Settings> {
    return readJob108Settings();
  }

  @Patch()
  @Authorized('pdf:admin')
  @AuditLog({ action: 'job108_settings.update', entityType: 'SystemSetting' })
  async update(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(PatchBodySchema)) body: PatchBody,
  ): Promise<Job108Settings> {
    try {
      return await writeJob108Settings(body, user.userId);
    } catch (err) {
      // writeJob108Settings validates the merged result and throws a plain
      // Error with a specific, readable reason (off-origin sitemap URL,
      // sub-1000ms spacing) — surface that message verbatim as a 400
      // rather than letting the global exception filter fall through to a
      // generic 500 "Internal server error". Same pattern as
      // ExternalAiService.runNow's catch (external-ai.service.ts).
      throw new BadRequestException((err as Error).message);
    }
  }
}
