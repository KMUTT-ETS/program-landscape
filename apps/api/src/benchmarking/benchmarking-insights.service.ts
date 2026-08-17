import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaAiInferenceRecorder, getAiModelOverrideStore } from '@kku/db';
import {
  BENCHMARKING_INSIGHTS_VERSION,
  BenchmarkingInsightsOutputSchema,
  buildBenchmarkingInsightsMessages,
  createAiService,
  extractStructuredWithParseRetry,
  lintBannedTells,
  type AiMessage,
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
    const extractionParams = {
      ctx: { module: 'benchmarking', kind: input.mode, userId },
      methodVersion: BENCHMARKING_INSIGHTS_VERSION,
      maxOutputTokens: input.mode === 'positioning-brief' ? 2500 : 1800,
    };

    let response = await extractStructuredWithParseRetry(
      this.ai,
      { ...extractionParams, messages },
      BenchmarkingInsightsOutputSchema,
      `benchmarking-insights.${input.mode}`,
    );

    // Banned-tell lint + one corrective retry over the free-text fields —
    // mirrors program-strategic-narrative-run.ts's pattern, adapted for a
    // multi-field structured payload instead of one markdown string.
    const violations = lintBannedTells(collectFreeText(response.parsed));
    if (violations.length > 0) {
      const correctionMessages: AiMessage[] = [
        ...messages,
        { role: 'assistant', content: response.rawText },
        {
          role: 'user',
          content: `Your draft used banned phrase(s): ${violations
            .map((v) => `"${v.phrase}"`)
            .join(', ')}. Rewrite the ENTIRE JSON without any of these words or their close paraphrases — keep the same structure and grounding rules. Return the corrected JSON in the same format as before.`,
        },
      ];
      const retry = await extractStructuredWithParseRetry(
        this.ai,
        { ...extractionParams, messages: correctionMessages },
        BenchmarkingInsightsOutputSchema,
        `benchmarking-insights.${input.mode}`,
      );
      const retryViolations = lintBannedTells(collectFreeText(retry.parsed));
      if (retryViolations.length > 0) {
        this.logger.warn(
          `benchmarking-insights banned-tell lint still failing after retry (mode=${input.mode}): ${retryViolations.map((v) => v.phrase).join(', ')}`,
        );
      }
      response = retry;
    }

    return {
      output: response.parsed,
      rawText: response.rawText,
      model: response.model,
      aiInferenceId: response.aiInferenceId,
      tokens: response.tokens,
      cost: response.cost,
      methodologyVersion: BENCHMARKING_INSIGHTS_VERSION,
      confidence: response.confidence,
    };
  }

  private placeholder(mode: BenchmarkingInsightsInput['mode']) {
    return {
      output: null,
      rawText: `No AI provider configured — set GOOGLE_AI_API_KEY or ANTHROPIC_API_KEY to generate ${mode} insights.`,
      model: 'none',
      aiInferenceId: null,
      tokens: { input: 0, output: 0 },
      cost: { usd: 0, model: 'none' },
      methodologyVersion: BENCHMARKING_INSIGHTS_VERSION,
      confidence: 0,
    };
  }
}

/** Free-text prose fields per mode, joined for the banned-tell lint. */
function collectFreeText(output: BenchmarkingInsightsOutput): string {
  if (output.mode === 'suggest-peers') {
    return output.suggestions.map((s) => s.rationale).join(' ');
  }
  if (output.mode === 'curriculum-gap') {
    return [
      output.result.summary,
      ...output.result.bridgingOpportunities.map((b) => `${b.title} ${b.rationale}`),
    ].join(' ');
  }
  if (output.mode === 'distinctiveness') {
    return [output.result.narrative, output.result.recommendation].join(' ');
  }
  return [
    output.result.narrative,
    output.result.kkuStrategicPosition,
    output.result.opportunities.join(' '),
    output.result.threats.join(' '),
  ].join(' ');
}
