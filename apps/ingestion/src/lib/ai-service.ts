import { createAiService, type AiProviderId, type AiService } from '@kku/shared';
import { getAiModelOverrideStore, PrismaAiInferenceRecorder } from '@kku/db';

/**
 * The ONLY way an ingestion script should build an AiService.
 *
 * 20 of 35 createAiService callers used to omit modelOverrideResolver, so they
 * ran on the catalog default while /admin/app/ai-settings claimed a different
 * model was in effect. That divergence is how the 2026-08-03 gemini-3.6-flash
 * incident stayed hidden for five weeks: the pipeline honoured the override and
 * was failing, while `pnpm programs:extract-courses` ignored it and succeeded —
 * and that command is what the on-screen empty state tells operators to run.
 *
 * Making the omission impossible beats documenting that it is discouraged.
 */
export function createIngestionAiService(): AiService {
  const intelSphereUrl = process.env.KKU_INTELSPHERE_URL;
  const intelSphereKey = process.env.KKU_INTELSPHERE_API_KEY;
  return createAiService({
    recorder: new PrismaAiInferenceRecorder(),
    providerId: (process.env.AI_PROVIDER ?? 'google') as AiProviderId,
    apiKeys: {
      google: process.env.GOOGLE_AI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      openrouter: process.env.OPENROUTER_API_KEY,
      intelSphere:
        intelSphereUrl && intelSphereKey ? { url: intelSphereUrl, apiKey: intelSphereKey } : undefined,
    },
    // Per-deployment default-model override (docs/ai-governance.md). Distinct
    // from modelOverrideResolver below: this sets the provider's baseline
    // model; the resolver layers a per-method pin on top of it.
    models: {
      google: {
        completion: process.env.AI_GOOGLE_COMPLETION_MODEL,
        embedding: process.env.AI_GOOGLE_EMBEDDING_MODEL,
      },
      anthropic: {
        completion: process.env.AI_ANTHROPIC_COMPLETION_MODEL,
      },
    },
    modelOverrideResolver: getAiModelOverrideStore(),
  });
}
