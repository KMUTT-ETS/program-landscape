import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaAiInferenceRecorder, getAiModelOverrideStore } from '@kku/db';
import {
  buildScenarioInsightsMessages,
  createAiService,
  extractStructuredWithParseRetry,
  lintBannedTells,
  SCENARIO_INSIGHTS_VERSION,
  ScenarioInsightsOutputSchema,
  type AiMessage,
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
      modelOverrideResolver: getAiModelOverrideStore(),
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
    const extractionParams = {
      ctx: { module: 'scenarios', kind: input.mode, userId },
      methodVersion: SCENARIO_INSIGHTS_VERSION,
      maxOutputTokens: input.mode === 'compare-narrative' ? 2500 : 1800,
    };

    let response = await extractStructuredWithParseRetry(
      this.ai,
      { ...extractionParams, messages },
      ScenarioInsightsOutputSchema,
      `scenario-insights.${input.mode}`,
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
        ScenarioInsightsOutputSchema,
        `scenario-insights.${input.mode}`,
      );
      const retryViolations = lintBannedTells(collectFreeText(retry.parsed));
      if (retryViolations.length > 0) {
        this.logger.warn(
          `scenario-insights banned-tell lint still failing after retry (mode=${input.mode}): ${retryViolations.map((v) => v.phrase).join(', ')}`,
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
      methodologyVersion: SCENARIO_INSIGHTS_VERSION,
      confidence: response.confidence,
    };
  }

  private placeholder(mode: ScenarioInsightMode) {
    return {
      output: null,
      rawText: `No AI provider configured — set GOOGLE_AI_API_KEY or ANTHROPIC_API_KEY to generate ${mode} insights.`,
      model: 'none',
      aiInferenceId: null,
      tokens: { input: 0, output: 0 },
      cost: { usd: 0, model: 'none' },
      methodologyVersion: SCENARIO_INSIGHTS_VERSION,
      confidence: 0,
    };
  }
}

/** Free-text prose fields per mode, joined for the banned-tell lint. */
function collectFreeText(output: ScenarioInsightsOutput): string {
  if (output.mode === 'suggest-assumptions') {
    return output.suggestions.map((s) => s.rationale).join(' ');
  }
  if (output.mode === 'identify-risks') {
    return output.risks.map((r) => `${r.title} ${r.description}`).join(' ');
  }
  if (output.mode === 'compare-narrative') {
    return [
      output.recommendation,
      ...output.comparisons.map((c) => `${c.summary} ${c.strengths.join(' ')} ${c.weaknesses.join(' ')}`),
    ].join(' ');
  }
  if (output.mode === 'devils-advocate') {
    return [output.result.whenThisIsWrong, ...output.result.counterArguments].join(' ');
  }
  return output.result.conditions.map((c) => `${c.condition} ${c.ifThisHappens}`).join(' ');
}
