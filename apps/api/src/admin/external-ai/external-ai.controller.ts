import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import { Prisma } from '@kku/db';
import type { SessionUser } from '@kku/shared';
import { AuditLog, AuthSession, Authorized, Provenance, ZodValidationPipe } from '../../common';
import { ExternalAiService } from './external-ai.service';

// ─────────────────────────────────────────────────────────────────────────
// /admin/external-ai-sources — Phase-5 admin surface backing the
// /admin/external/ai-search page. Gated on `pdf:admin` for now since
// Phase 5 reuses the same operator audience as the PDF library + AI
// cost dashboards; can split out a dedicated `external_ai:configure`
// permission if Council wants tighter gating later.
// ─────────────────────────────────────────────────────────────────────────

const KindEnum = z.enum(['URL_LIST', 'WEB_SEARCH']);
const StatusEnum = z.enum(['ACTIVE', 'PAUSED', 'DISABLED']);
const SignalTypeEnum = z.enum(['POLICY', 'RESEARCH', 'MARKET', 'TECH', 'NEWS']);

const SlugRegex = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/;

const CreateBodySchema = z.object({
  slug: z.string().regex(SlugRegex, 'slug must be lowercase kebab-case'),
  name: z.string().min(1).max(120),
  description: z.string().max(2000).optional(),
  kind: KindEnum,
  configJson: z.record(z.string(), z.unknown()),
  cadenceCron: z.string().max(80).optional(),
  signalType: SignalTypeEnum.optional(),
  defaultImpact: z.number().min(0).max(1).optional(),
});
type CreateBody = z.infer<typeof CreateBodySchema>;

const UpdateBodySchema = z.object({
  name: z.string().min(1).max(120).optional(),
  description: z.string().max(2000).nullable().optional(),
  configJson: z.record(z.string(), z.unknown()).optional(),
  cadenceCron: z.string().max(80).nullable().optional(),
  signalType: SignalTypeEnum.optional(),
  defaultImpact: z.number().min(0).max(1).optional(),
});
type UpdateBody = z.infer<typeof UpdateBodySchema>;

const StatusBodySchema = z.object({ status: StatusEnum });
type StatusBody = z.infer<typeof StatusBodySchema>;

@Controller('/admin/external-ai-sources')
export class ExternalAiController {
  constructor(private readonly service: ExternalAiService) {}

  @Get()
  @Authorized('pdf:admin')
  @Provenance({ sources: [{ id: 'platform', name: 'Platform runtime' }] })
  async list() {
    return this.service.list();
  }

  @Post()
  @Authorized('pdf:admin')
  @AuditLog({ action: 'external_ai_source.create', entityType: 'ExternalAiSource' })
  async create(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(CreateBodySchema)) body: CreateBody,
  ) {
    return this.service.create({
      slug: body.slug,
      name: body.name,
      description: body.description,
      kind: body.kind,
      configJson: body.configJson as Prisma.InputJsonValue,
      cadenceCron: body.cadenceCron,
      signalType: body.signalType,
      defaultImpact: body.defaultImpact,
      createdById: user.userId,
    });
  }

  @Patch(':id')
  @Authorized('pdf:admin')
  @AuditLog({ action: 'external_ai_source.update', entityType: 'ExternalAiSource' })
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(UpdateBodySchema)) body: UpdateBody,
  ) {
    return this.service.update(id, {
      name: body.name,
      description: body.description ?? undefined,
      configJson: body.configJson as Prisma.InputJsonValue | undefined,
      cadenceCron: body.cadenceCron === null ? null : body.cadenceCron,
      signalType: body.signalType,
      defaultImpact: body.defaultImpact,
    });
  }

  @Patch(':id/status')
  @Authorized('pdf:admin')
  @AuditLog({ action: 'external_ai_source.set_status', entityType: 'ExternalAiSource' })
  async setStatus(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(StatusBodySchema)) body: StatusBody,
  ) {
    return this.service.setStatus(id, body.status);
  }

  @Delete(':id')
  @Authorized('pdf:admin')
  @AuditLog({ action: 'external_ai_source.delete', entityType: 'ExternalAiSource' })
  async remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post(':id/run-now')
  @Authorized('pdf:admin')
  @AuditLog({ action: 'external_ai_source.run_now', entityType: 'ExternalAiSource' })
  async runNow(@AuthSession() user: SessionUser, @Param('id') id: string) {
    return this.service.runNow(id, user.userId);
  }

  @Get(':id/recent-signals')
  @Authorized('pdf:admin')
  @Provenance({ sources: [{ id: 'platform', name: 'Platform runtime' }] })
  async recentSignals(@Param('id') id: string, @Query('limit') limit?: string) {
    const n = limit ? Math.min(parseInt(limit, 10) || 20, 50) : 20;
    return this.service.recentSignals(id, n);
  }
}
