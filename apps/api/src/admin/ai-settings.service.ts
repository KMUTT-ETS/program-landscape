import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  getAiModelOverrideStore,
  prisma,
  listSelectableModels,
  findCatalogModel,
  getModelCatalogStatus,
  refreshAiModelCatalog,
} from '@kku/db';
import { AI_METHOD_CATALOG, findAiMethodEntry, type AiMethodEntry } from '@kku/shared';
import { planModelSwap, type SwapCandidate, type SwapPlan } from './ai-settings-swap';

// ─────────────────────────────────────────────────────────────────────────
// Admin AI-settings service — read the method catalog joined with current
// overrides + per-method 30-day spend rollup, write/delete overrides, and
// invalidate the in-process resolver cache so changes take effect within
// one TTL window (60s) without needing a restart.
//
// Permission gate (`ai_models:configure`) is applied at the controller.
// ─────────────────────────────────────────────────────────────────────────

export interface MethodSettingRow {
  methodPrefix: string;
  currentVersion: string;
  label: string;
  description: string;
  module: AiMethodEntry['module'];
  tier: AiMethodEntry['tier'];
  defaultModel: string;
  effectiveModel: string;
  override: null | {
    modelId: string;
    setByUserId: string | null;
    setByUserName: string | null;
    updatedAt: string;
  };
  /** When non-null this method is hard-locked to `lockedModel` — runtime
   *  ignores any admin override; the UI hides the model picker. */
  lockedModel: string | null;
  lockReason: string | null;
  thirtyDayCost: number;
  thirtyDayCalls: number;
}

/** A model the admin can pick — sourced from the ai_model_catalog table
 *  (Gemini rows refreshed daily from OpenRouter; Anthropic rows static). */
export interface ModelOption {
  id: string;
  label: string;
  provider: string;
  tier: string;
  description: string;
  costInputPer1m: number;
  costOutputPer1m: number;
  legacy: boolean;
  source: string;
}

export interface AiSettingsListResult {
  methods: MethodSettingRow[];
  models: ModelOption[];
  /** Freshness of the OpenRouter-sourced model rows. */
  modelCatalog: {
    lastFetchedAt: string | null;
    openrouterCount: number;
    staticCount: number;
  };
}

@Injectable()
export class AiSettingsService {
  async list(): Promise<AiSettingsListResult> {
    const overrides = await prisma.aiModelOverride.findMany({
      include: { setBy: { select: { id: true, name: true, email: true } } },
    });
    const overrideByPrefix = new Map(overrides.map((o) => [o.methodPrefix, o]));

    // Per-method 30-day spend — group by module/kind isn't enough because
    // multiple kinds share a promptVersion. Group by promptVersion exactly.
    const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const byVersion = await prisma.aiInference.groupBy({
      by: ['promptVersion'],
      where: { createdAt: { gte: since } },
      _sum: { costEstimateUsd: true },
      _count: { _all: true },
    });
    const spendByPrefix = new Map<string, { cost: number; calls: number }>();
    for (const row of byVersion) {
      if (!row.promptVersion) continue;
      const entry = AI_METHOD_CATALOG.find((e) => row.promptVersion!.startsWith(e.methodPrefix));
      if (!entry) continue;
      const cur = spendByPrefix.get(entry.methodPrefix) ?? { cost: 0, calls: 0 };
      cur.cost += Number(row._sum.costEstimateUsd ?? 0);
      cur.calls += row._count._all;
      spendByPrefix.set(entry.methodPrefix, cur);
    }

    const methods: MethodSettingRow[] = AI_METHOD_CATALOG.map((entry) => {
      const override = overrideByPrefix.get(entry.methodPrefix);
      // Locked methods ignore any admin override at runtime — surface
      // the locked model as the effective one so the UI doesn't show a
      // misleading "Override" value that isn't actually in use.
      const effectiveModel =
        entry.lockedModel ?? override?.modelId ?? entry.defaultModel;
      const spend = spendByPrefix.get(entry.methodPrefix);
      return {
        methodPrefix: entry.methodPrefix,
        currentVersion: entry.currentVersion,
        label: entry.label,
        description: entry.description,
        module: entry.module,
        tier: entry.tier,
        defaultModel: entry.defaultModel,
        effectiveModel,
        override: override
          ? {
              modelId: override.modelId,
              setByUserId: override.setByUserId,
              setByUserName: override.setBy?.name ?? override.setBy?.email ?? null,
              updatedAt: override.updatedAt.toISOString(),
            }
          : null,
        lockedModel: entry.lockedModel ?? null,
        lockReason: entry.lockReason ?? null,
        thirtyDayCost: spend?.cost ?? 0,
        thirtyDayCalls: spend?.calls ?? 0,
      };
    });

    const [catalog, catalogStatus] = await Promise.all([
      listSelectableModels(),
      getModelCatalogStatus(),
    ]);
    const models: ModelOption[] = catalog.map((m) => ({
      id: m.id,
      label: m.label,
      provider: m.provider,
      tier: m.tier,
      description: m.description,
      costInputPer1m: m.costInputPer1m,
      costOutputPer1m: m.costOutputPer1m,
      legacy: m.legacy,
      source: m.source,
    }));

    return {
      methods,
      models,
      modelCatalog: {
        lastFetchedAt: catalogStatus.lastFetchedAt?.toISOString() ?? null,
        openrouterCount: catalogStatus.openrouterCount,
        staticCount: catalogStatus.staticCount,
      },
    };
  }

  /** Refresh the Google Gemini model rows from OpenRouter (manual button
   *  on the AI-settings page; also runs daily via the ingestion cron). */
  async refreshModels(): Promise<{
    ok: boolean;
    count: number;
    error?: string;
    refreshedModels: { id: string; tier: string; label: string }[];
    lastFetchedAt: string | null;
  }> {
    const result = await refreshAiModelCatalog();
    const status = await getModelCatalogStatus();
    return {
      ok: result.ok,
      count: result.count,
      error: result.error,
      refreshedModels: result.models,
      lastFetchedAt: status.lastFetchedAt?.toISOString() ?? null,
    };
  }

  async setOverride(methodPrefix: string, modelId: string, userId: string): Promise<MethodSettingRow> {
    const entry = findAiMethodEntry(methodPrefix);
    if (!entry) throw new NotFoundException(`Unknown method prefix: ${methodPrefix}`);
    if (entry.lockedModel) {
      throw new BadRequestException(
        `Method "${entry.label}" is locked to ${entry.lockedModel} and cannot be overridden. ${entry.lockReason ?? ''}`.trim(),
      );
    }
    const model = await findCatalogModel(modelId);
    if (!model) throw new BadRequestException(`Unknown model id: ${modelId}`);

    await prisma.aiModelOverride.upsert({
      where: { methodPrefix },
      create: { methodPrefix, modelId, setByUserId: userId },
      update: { modelId, setByUserId: userId },
    });
    await getAiModelOverrideStore().invalidate();
    return this.findOne(methodPrefix);
  }

  async clearOverride(methodPrefix: string): Promise<MethodSettingRow> {
    const entry = findAiMethodEntry(methodPrefix);
    if (!entry) throw new NotFoundException(`Unknown method prefix: ${methodPrefix}`);
    await prisma.aiModelOverride.deleteMany({ where: { methodPrefix } });
    await getAiModelOverrideStore().invalidate();
    return this.findOne(methodPrefix);
  }

  /** Preview (apply: false) or execute (apply: true) a bulk model swap:
   *  "every method currently resolving to fromModelId should resolve to
   *  toModelId instead." Deliberately includes methods that reach
   *  fromModelId through the catalog default, not only explicit pins — see
   *  ai-settings-swap.ts for why that's in scope, not a footnote. */
  async swapModel(
    fromModelId: string,
    toModelId: string,
    userId: string,
    apply: boolean,
  ): Promise<{ plan: SwapPlan; applied: boolean }> {
    // Same catalog-table check as setOverride — necessary, not sufficient:
    // ai_model_catalog is refreshed daily from OpenRouter and only proves
    // the model is *listed*, not that it actually works on the provider we
    // call at runtime. That gap is exactly how the August pin got in.
    const model = await findCatalogModel(toModelId);
    if (!model) throw new BadRequestException(`Unknown model id: ${toModelId}`);

    const { methods } = await this.list();
    const candidates: SwapCandidate[] = methods.map((row) => ({
      methodPrefix: row.methodPrefix,
      effectiveModel: row.effectiveModel,
      isPinned: row.override != null,
      lockedModel: row.lockedModel,
    }));
    const plan = planModelSwap(candidates, fromModelId, toModelId);

    if (!apply) return { plan, applied: false };

    const targets = [...plan.rewrite, ...plan.create];
    if (targets.length > 0) {
      // One transaction for all 23-ish rows — a half-applied swap is worse
      // than none, so either every target lands or none do.
      await prisma.$transaction(
        targets.map((t) =>
          prisma.aiModelOverride.upsert({
            where: { methodPrefix: t.methodPrefix },
            create: { methodPrefix: t.methodPrefix, modelId: toModelId, setByUserId: userId },
            update: { modelId: toModelId, setByUserId: userId },
          }),
        ),
      );
      await getAiModelOverrideStore().invalidate();
    }

    return { plan, applied: true };
  }

  private async findOne(methodPrefix: string): Promise<MethodSettingRow> {
    const { methods } = await this.list();
    const row = methods.find((m) => m.methodPrefix === methodPrefix);
    if (!row) throw new NotFoundException(`Method prefix not in catalog: ${methodPrefix}`);
    return row;
  }
}
