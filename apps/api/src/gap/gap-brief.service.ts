import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  getAiModelOverrideStore,
  PrismaAiInferenceRecorder,
  type GapMapResult,
  type GapMapRow,
  type GapMapScope,
  type GapThresholds,
  type GapVerdict,
} from '@kku/db';
import {
  buildGapBriefMessages,
  createAiService,
  extractStructuredWithParseRetry,
  GAP_BRIEF_VERSION,
  GapBriefOutputSchema,
  lintBannedTells,
  type AiMessage,
  type AiProviderId,
  type AiService,
  type GapBriefInput,
  type GapBriefOutput,
} from '@kku/shared';
import { GapService } from './gap.service';

// The Council brief over the gap map. One call, over exactly the rows the
// reader has on screen — same scope, same verdict filter, same faculty
// filter, same thresholds — so every number in the brief is one the reader
// can point at in the table.

export type BriefVerdictFilter = 'all' | GapVerdict;

export interface GapBriefParams {
  scope: GapMapScope;
  scopeId: string | null;
  verdict: BriefVerdictFilter;
  facultyId: string | null;
  thresholds: GapThresholds;
  userId: string;
}

export interface GapBriefResponse {
  output: GapBriefOutput | null;
  rawText: string;
  model: string;
  aiInferenceId: string | null;
  tokens: { input: number; output: number };
  cost: { usd: number; model: string };
  methodologyVersion: string;
  confidence: number;
  /** Sources the panel lists — the same ids the map endpoint declares. */
  sources: Array<{ id: string; name: string }>;
  rowsBriefed: number;
}

export const GAP_MAP_SOURCES = [
  { id: 'jobthai', name: 'JobThai job postings (fields of study, occupations, provinces)' },
  { id: 'job-field-taxonomy', name: 'Field-of-study taxonomy (AI-clustered, admin-reviewed)' },
  { id: 'alumni-cohort-statuses', name: 'Registrar alumni cohorts (graduates per year)' },
  { id: 'student-cohort-distributions', name: 'Registrar active cohorts (pipeline)' },
  {
    id: 'kmitl-skill-mapping',
    name: 'LinkedIn labour-market skill growth · subscribed by MHESI (API hosted by KMITL)',
  },
  { id: 'trend-signals', name: 'Trends Radar signals' },
];

/** The rows the reader has on screen, in the order the page shows them. */
export function visibleRows(map: GapMapResult, verdict: BriefVerdictFilter, facultyId: string | null): GapMapRow[] {
  return map.rows.filter(
    (r) => (verdict === 'all' || r.verdict === verdict) && (!facultyId || r.facultyIds.includes(facultyId)),
  );
}

@Injectable()
export class GapBriefService implements OnModuleInit {
  private readonly logger = new Logger(GapBriefService.name);
  private ai!: AiService;

  constructor(
    private readonly config: ConfigService,
    private readonly gap: GapService,
  ) {}

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
          intelSphereUrl && intelSphereKey ? { url: intelSphereUrl, apiKey: intelSphereKey } : undefined,
      },
      modelOverrideResolver: getAiModelOverrideStore(),
    });
  }

  private hasProvider(): boolean {
    return Boolean(this.config.get<string>('GOOGLE_AI_API_KEY') || this.config.get<string>('ANTHROPIC_API_KEY'));
  }

  async generate(params: GapBriefParams): Promise<GapBriefResponse> {
    const map = await this.gap.map({ scope: params.scope, scopeId: params.scopeId, thresholds: params.thresholds });
    const rows = visibleRows(map, params.verdict, params.facultyId).slice(0, 60);
    const base = { methodologyVersion: GAP_BRIEF_VERSION, sources: GAP_MAP_SOURCES, rowsBriefed: rows.length };
    if (!this.hasProvider() || rows.length === 0) {
      return {
        ...base,
        output: null,
        rawText:
          rows.length === 0
            ? 'No rows in this view to brief.'
            : 'No AI provider configured — set GOOGLE_AI_API_KEY or ANTHROPIC_API_KEY to generate a brief.',
        model: 'none',
        aiInferenceId: null,
        tokens: { input: 0, output: 0 },
        cost: { usd: 0, model: 'none' },
        confidence: 0,
      };
    }
    const facultyLabel = params.facultyId
      ? (map.facultyStrip.find((f) => f.facultyId === params.facultyId)?.nameEn ?? null)
      : null;
    const input: GapBriefInput = {
      view: {
        scopeLabel: map.scope.label ?? 'KKU (all faculties)',
        verdict: params.verdict,
        facultyLabel,
        thresholds: params.thresholds,
      },
      rows: rows.map((r) => ({
        nameEn: r.nameEn,
        nameTh: r.nameTh,
        verdict: r.verdict,
        demandSharePct: r.demandShare * 100,
        supplySharePct: r.supplyShare * 100,
        ratio: r.ratio,
        gradsPerYear: r.gradsPerYear,
        pipelineArrow: r.pipelineArrow,
        postings: r.postings,
        topOccupations: r.occupations.slice(0, 3).map((o) => o.subcategory),
        risingSkills: r.globalSignal.skills.map((s) => `${s.nameEn} ↑ ${s.growthPct.toFixed(0)} %`),
        trendSignalTitles: r.trendSignals.map((s) => s.title),
      })),
      reconciliation: {
        fieldPostings: map.reconciliation.fieldPostings,
        anyFieldPostings: map.reconciliation.anyFieldPostings,
        otherMentions: map.reconciliation.otherMentions,
        proposedFields: map.taxonomy.proposed,
        approvedFields: map.taxonomy.approved,
      },
    };
    const messages = buildGapBriefMessages(input);
    const extractionParams = {
      ctx: { module: 'gap-analysis', kind: 'gap-brief', userId: params.userId },
      methodVersion: GAP_BRIEF_VERSION,
      maxOutputTokens: 2500,
    };
    let response = await extractStructuredWithParseRetry(
      this.ai,
      { ...extractionParams, messages },
      GapBriefOutputSchema,
      'gap-brief',
    );
    const violations = lintBannedTells(freeText(response.parsed));
    if (violations.length > 0) {
      const correction: AiMessage[] = [
        ...messages,
        { role: 'assistant', content: response.rawText },
        {
          role: 'user',
          content: `Your draft used banned phrase(s): ${violations
            .map((v) => `"${v.phrase}"`)
            .join(', ')}. Rewrite the ENTIRE JSON without any of these words or their close paraphrases — same structure, same grounding rules.`,
        },
      ];
      const retry = await extractStructuredWithParseRetry(
        this.ai,
        { ...extractionParams, messages: correction },
        GapBriefOutputSchema,
        'gap-brief',
      );
      const still = lintBannedTells(freeText(retry.parsed));
      if (still.length > 0) {
        this.logger.warn(`gap-brief banned-tell lint still failing after retry: ${still.map((v) => v.phrase).join(', ')}`);
      }
      response = retry;
    }
    return {
      ...base,
      output: response.parsed,
      rawText: response.rawText,
      model: response.model,
      aiInferenceId: response.aiInferenceId,
      tokens: response.tokens,
      cost: response.cost,
      confidence: response.confidence,
    };
  }
}

function freeText(o: GapBriefOutput): string {
  return [...o.findings.flatMap((f) => [f.title, f.evidence, f.implication]), ...o.cannotTell, o.reasoning].join(' ');
}
