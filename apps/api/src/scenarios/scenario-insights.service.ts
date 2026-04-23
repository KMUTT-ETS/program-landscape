import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaAiInferenceRecorder } from '@kku/db';
import {
  buildScenarioInsightsMessages,
  createAiService,
  SCENARIO_INSIGHTS_VERSION,
  ScenarioInsightsOutputSchema,
  type AiProviderId,
  type AiService,
  type ScenarioInsightsInput,
  type ScenarioInsightsOutput,
} from '@kku/shared';

// ═════════════════════════════════════════════════════════════════════
// Scenario AI insights — 5 modes wrapped around the AiService. Follows
// the same factory-at-OnModuleInit pattern as CockpitService and
// GapInsightsService. Graceful no-key fallback returns a placeholder.
// ═════════════════════════════════════════════════════════════════════

export type ScenarioInsightMode = ScenarioInsightsInput['mode'];

@Injectable()
export class ScenarioInsightsService implements OnModuleInit {
  private readonly logger = new Logger(ScenarioInsightsService.name);
  private ai!: AiService;

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    const recorder = new PrismaAiInferenceRecorder();
    const providerId = (this.config.get<string>('AI_PROVIDER') ?? 'google') as AiProviderId;
    const intelSphereUrl = this.config.get<string>('KKU_INTELSPHERE_URL');
    const intelSphereKey = this.config.get<string>('KKU_INTELSPHERE_API_KEY');
    this.ai = createAiService({
      recorder,
      providerId,
      apiKeys: {
        google: this.config.get<string>('GOOGLE_AI_API_KEY'),
        anthropic: this.config.get<string>('ANTHROPIC_API_KEY'),
        openrouter: this.config.get<string>('OPENROUTER_API_KEY'),
        intelSphere:
          intelSphereUrl && intelSphereKey
            ? { url: intelSphereUrl, apiKey: intelSphereKey }
            : undefined,
      },
    });
  }

  private hasProvider(): boolean {
    return Boolean(
      this.config.get<string>('GOOGLE_AI_API_KEY') ||
        this.config.get<string>('ANTHROPIC_API_KEY'),
    );
  }

  async generate(input: ScenarioInsightsInput, userId: string) {
    if (!this.hasProvider()) return this.placeholder(input.mode);

    const messages = buildScenarioInsightsMessages(input);
    const resp = await this.ai.complete({
      ctx: { module: 'scenarios', kind: input.mode, userId },
      messages,
      temperature: input.mode === 'devils-advocate' ? 0.5 : 0.35,
      maxOutputTokens: input.mode === 'compare-narrative' ? 2500 : 1800,
    });

    const cleaned = resp.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    let parsed: ScenarioInsightsOutput | null = null;
    try {
      parsed = ScenarioInsightsOutputSchema.parse(JSON.parse(cleaned));
    } catch (err) {
      this.logger.warn(`scenario-insights parse failed (mode=${input.mode}): ${(err as Error).message}`);
    }
    return {
      output: parsed,
      rawText: resp.text,
      model: resp.model,
      aiInferenceId: resp.aiInferenceId,
      tokens: resp.tokens,
      cost: resp.cost,
      methodologyVersion: SCENARIO_INSIGHTS_VERSION,
      confidence: parsed ? 0.7 : 0.2,
    };
  }

  private placeholder(mode: ScenarioInsightMode) {
    return {
      output: null,
      rawText:
        'ไม่พบการตั้งค่า AI provider — กรุณากำหนด GOOGLE_AI_API_KEY หรือ ANTHROPIC_API_KEY เพื่อสร้าง scenario insights ที่แท้จริง\n\n' +
        `(No AI provider configured — set GOOGLE_AI_API_KEY or ANTHROPIC_API_KEY to generate ${mode} insights.)`,
      model: 'none',
      aiInferenceId: null,
      tokens: { input: 0, output: 0 },
      cost: { usd: 0, model: 'none' },
      methodologyVersion: SCENARIO_INSIGHTS_VERSION,
      confidence: 0,
    };
  }
}
