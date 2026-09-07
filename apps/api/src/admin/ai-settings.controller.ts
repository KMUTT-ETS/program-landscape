import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { z } from 'zod';
import { AuditLog, AuthSession, Authorized, Provenance, ZodValidationPipe } from '../common';
import type { SessionUser } from '@kku/shared';
import { AiSettingsService } from './ai-settings.service';

// ─────────────────────────────────────────────────────────────────────────
// GET /admin/ai-settings — list every method-prefix + effective model +
// override metadata + 30-day spend, plus the catalog of available models.
//
// PUT /admin/ai-settings/method/:prefix — set / replace the override for
// one method prefix. Body: { modelId }.
//
// DELETE /admin/ai-settings/method/:prefix — clear the override (fall
// back to MODEL_BY_METHOD_PREFIX / provider default).
//
// POST /admin/ai-settings/refresh-models — re-fetch the Google Gemini
// model list from OpenRouter (manual trigger; also runs daily via cron).
//
// All four gated by `ai_models:configure` (super-admin only).
// ─────────────────────────────────────────────────────────────────────────

const SetOverrideSchema = z.object({
  modelId: z.string().min(1, 'modelId required'),
});
type SetOverrideBody = z.infer<typeof SetOverrideSchema>;

const SwapSchema = z.object({
  fromModelId: z.string().min(1),
  toModelId: z.string().min(1),
  apply: z.boolean().default(false),
});
type SwapBody = z.infer<typeof SwapSchema>;

@Controller('/admin/ai-settings')
export class AiSettingsController {
  constructor(private readonly service: AiSettingsService) {}

  @Get()
  @Authorized('ai_models:configure')
  @Provenance({ sources: [{ id: 'platform', name: 'Platform runtime' }] })
  async list() {
    return this.service.list();
  }

  @Put('/method/:prefix')
  @Authorized('ai_models:configure')
  @AuditLog({ action: 'ai_model_override.set', entityType: 'AiModelOverride' })
  async setOverride(
    @AuthSession() user: SessionUser,
    @Param('prefix') prefix: string,
    @Body(new ZodValidationPipe(SetOverrideSchema)) body: SetOverrideBody,
  ) {
    return this.service.setOverride(prefix, body.modelId, user.userId);
  }

  @Delete('/method/:prefix')
  @Authorized('ai_models:configure')
  @AuditLog({ action: 'ai_model_override.clear', entityType: 'AiModelOverride' })
  async clearOverride(@Param('prefix') prefix: string) {
    return this.service.clearOverride(prefix);
  }

  @Post('/refresh-models')
  @Authorized('ai_models:configure')
  @AuditLog({ action: 'ai_model_catalog.refresh', entityType: 'AiModelCatalog' })
  async refreshModels() {
    return this.service.refreshModels();
  }

  // Bulk "replace every method using model X" action. apply:false previews
  // the plan without writing anything; apply:true writes it in one
  // transaction. One audit row names both models plus every affected
  // method — a client-side loop of per-method PUTs would write N rows and
  // could half-fail partway through.
  @Post('/swap')
  @Authorized('ai_models:configure')
  @AuditLog({ action: 'ai_model_override.swap', entityType: 'AiModelOverride' })
  async swap(
    @AuthSession() user: SessionUser,
    @Body(new ZodValidationPipe(SwapSchema)) body: SwapBody,
  ) {
    return this.service.swapModel(body.fromModelId, body.toModelId, user.userId, body.apply);
  }
}
