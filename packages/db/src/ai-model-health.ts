import {
  assessModelHealth,
  AVAILABLE_AI_MODELS,
  AI_METHOD_CATALOG,
  type MethodModelHealth,
} from '@kku/shared';
import { prisma } from './index';

const WINDOW_DAYS = 7;

/**
 * The ONE function every model-health surface reads — both admin banners and
 * the daily notifier. Three surfaces computing this independently is how they
 * drift, which this codebase has been bitten by repeatedly.
 *
 * Fail-open: if the failure-stats query fails we still return catalog-derived
 * verdicts. A monitoring feature must never be the reason a page is down.
 */
export async function aiModelHealth(): Promise<MethodModelHealth[]> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [overrides, catalogRows, failureRows] = await Promise.all([
    prisma.aiModelOverride.findMany({ select: { methodPrefix: true, modelId: true } }),
    // The ai_model_catalog TABLE, not AVAILABLE_AI_MODELS — this is what
    // findCatalogModel() gates pins against, so it is what "known" must mean.
    prisma.aiModelCatalog.findMany({ select: { id: true } }),
    prisma.aiInference
      .groupBy({
        by: ['model', 'promptVersion'],
        where: { kind: 'ai_model_invalid', createdAt: { gte: since } },
        _count: { _all: true },
        _max: { createdAt: true },
      })
      .catch(() => []),
  ]);

  // promptVersion is the runtime methodVersion (e.g. "program-digest.v3"),
  // not a methodPrefix. Resolve it via the same `startsWith` convention
  // ai-settings.service.ts already uses for its 30-day spend rollup — NOT a
  // regex strip, which would drift from that convention the moment a prefix
  // shape changes (e.g. "program-peer-review.v2.1").
  const recentFailures = failureRows.flatMap((r) => {
    if (!r.promptVersion) return [];
    const entry = AI_METHOD_CATALOG.find((m) => r.promptVersion!.startsWith(m.methodPrefix));
    if (!entry) return [];
    return [
      {
        methodPrefix: entry.methodPrefix,
        modelId: r.model,
        count: r._count._all,
        lastAt: r._max.createdAt ?? since,
      },
    ];
  });

  return assessModelHealth({
    overrides,
    knownModelIds: new Set(catalogRows.map((r) => r.id)),
    deprecatedModels: new Map(
      AVAILABLE_AI_MODELS.filter((m) => m.deprecated).map((m) => [m.id, m.deprecatedNote]),
    ),
    methods: AI_METHOD_CATALOG.map((m) => ({
      methodPrefix: m.methodPrefix,
      defaultModel: m.defaultModel,
    })),
    recentFailures,
  });
}
