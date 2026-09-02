import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  PrismaAiInferenceRecorder,
  getAiModelOverrideStore,
  generateProgramCurriculumRevision,
  type CurriculumRevisionOutcome,
} from '@kku/db';
import { createAiService, type AiProviderId, type AiService } from '@kku/shared';

// Owns the AiService for curriculum-revision regeneration. The deep-dive
// controller has no AI client of its own (it delegates narrative
// regeneration to CockpitService the same way) — building one per request
// would re-read config and re-create the provider on every call.
//
// Provider construction MIRRORS CockpitService.onModuleInit exactly,
// including the IntelSphere key pair and the model-override resolver: two
// clients in the same process that resolve providers differently would make
// "which model produced this row" depend on which endpoint was called, which
// the AiInference audit trail cannot express.
@Injectable()
export class CurriculumRevisionService implements OnModuleInit {
  private ai!: AiService;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const intelSphereUrl = this.config.get<string>('KKU_INTELSPHERE_URL');
    const intelSphereKey = this.config.get<string>('KKU_INTELSPHERE_API_KEY');
    this.ai = createAiService({
      recorder: new PrismaAiInferenceRecorder(),
      providerId: (this.config.get<string>('AI_PROVIDER') ?? 'google') as AiProviderId,
      apiKeys: {
        google: this.config.get<string>('GOOGLE_AI_API_KEY'),
        anthropic: this.config.get<string>('ANTHROPIC_API_KEY'),
        openrouter: this.config.get<string>('OPENROUTER_API_KEY'),
        intelSphere:
          intelSphereUrl && intelSphereKey
            ? { url: intelSphereUrl, apiKey: intelSphereKey }
            : undefined,
      },
      modelOverrideResolver: getAiModelOverrideStore(),
    });
  }

  async regenerate(programId: string, userId: string): Promise<CurriculumRevisionOutcome> {
    return generateProgramCurriculumRevision({
      programId,
      ai: this.ai,
      triggeredByUserId: userId,
    });
  }
}
