import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaAiInferenceRecorder, getAiModelOverrideStore } from '@kku/db';
import {
  BENCHMARKING_INSIGHTS_VERSION,
  BenchmarkingInsightsOutputSchema,
  buildBenchmarkingInsightsMessages,
  createAiService,
  type AiProviderId,
  type AiService,
  type BenchmarkingInsightsInput,
  type BenchmarkingInsightsOutput,
} from '@kku/shared';

// Wraps AiService for the four benchmarking-insights modes. Same
// factory-at-OnModuleInit pattern as cockpit / gap / scenarios services.

@Injectable()
export class BenchmarkingInsightsService implements OnModuleInit {
  private readonly logger = new Logger(BenchmarkingInsightsService.name);
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
      modelOverrideResolver: getAiModelOverrideStore(),
    });
  }

  private hasProvider(): boolean {
    return Boolean(
      this.config.get<string>('GOOGLE_AI_API_KEY') ||
        this.config.get<string>('ANTHROPIC_API_KEY'),
    );
  }

  async generate(input: BenchmarkingInsightsInput, userId: string) {
    if (!this.hasProvider()) return this.placeholder(input.mode);

    const messages = buildBenchmarkingInsightsMessages(input);
    const resp = await this.ai.complete({
      ctx: { module: 'benchmarking', kind: input.mode, userId },
      messages,
      temperature: input.mode === 'positioning-brief' ? 0.45 : 0.35,
      maxOutputTokens: input.mode === 'positioning-brief' ? 2500 : 1800,
    });

    const cleaned = resp.text.trim().replace(/^```(?:json)?\s*|\s*```$/g, '');
    let parsed: BenchmarkingInsightsOutput | null = null;
    try {
      parsed = BenchmarkingInsightsOutputSchema.parse(JSON.parse(cleaned));
    } catch (err) {
      this.logger.warn(`benchmarking-insights parse failed (mode=${input.mode}): ${(err as Error).message}`);
    }
    return {
      output: parsed,
      rawText: resp.text,
      model: resp.model,
      aiInferenceId: resp.aiInferenceId,
      tokens: resp.tokens,
      cost: resp.cost,
      methodologyVersion: BENCHMARKING_INSIGHTS_VERSION,
      confidence: parsed ? 0.7 : 0.2,
    };
  }

  private placeholder(mode: BenchmarkingInsightsInput['mode']) {
    return {
      output: null,
      rawText:
        'ไม่พบการตั้งค่า AI provider — กรุณากำหนด GOOGLE_AI_API_KEY หรือ ANTHROPIC_API_KEY เพื่อสร้าง benchmarking insights\n\n' +
        `(No AI provider configured — set GOOGLE_AI_API_KEY or ANTHROPIC_API_KEY to generate ${mode} insights.)`,
      model: 'none',
      aiInferenceId: null,
      tokens: { input: 0, output: 0 },
      cost: { usd: 0, model: 'none' },
      methodologyVersion: BENCHMARKING_INSIGHTS_VERSION,
      confidence: 0,
    };
  }
}
