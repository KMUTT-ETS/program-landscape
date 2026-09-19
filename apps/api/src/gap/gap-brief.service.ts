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
  GAP_BRIEF_MAX_ROWS,
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
  /** Rows actually put in front of the model — `totalVisible` capped at
   *  `GAP_BRIEF_MAX_ROWS`. */
  rowsBriefed: number;
  /** Rows the reader has on screen, before the cap. `rowsBriefed` below
   *  this number is the whole story a "covered 60 of 74" line tells; with
   *  only the post-cap count no surface could say it. */
  totalVisible: number;
  /** Findings removed because they named a field this view does not carry,
   *  or because their verdict corrected to `supply-unknown`. */
  findingsDropped: number;
  /** Findings kept but whose verdict was reset to the row's own. */
  findingsCorrected: number;
  /** Why there is no `output`. `'ok'` whenever the model ran — a UI must
   *  never tell the two empty paths apart by matching English prose. */
  reason: 'ok' | 'empty-view' | 'no-provider';
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
    // Filtered once: the pre-cap count is what the reader sees, the sliced
    // array is what the model sees, and the response carries both.
    const allVisible = visibleRows(map, params.verdict, params.facultyId);
    const rows = allVisible.slice(0, GAP_BRIEF_MAX_ROWS);
    const base = {
      methodologyVersion: GAP_BRIEF_VERSION,
      sources: GAP_MAP_SOURCES,
      rowsBriefed: rows.length,
      totalVisible: allVisible.length,
    };
    if (!this.hasProvider() || rows.length === 0) {
      return {
        ...base,
        output: null,
        reason: rows.length === 0 ? 'empty-view' : 'no-provider',
        rawText:
          rows.length === 0
            ? 'No rows in this view to brief.'
            : 'No AI provider configured — set GOOGLE_AI_API_KEY or ANTHROPIC_API_KEY to generate a brief.',
        model: 'none',
        aiInferenceId: null,
        tokens: { input: 0, output: 0 },
        cost: { usd: 0, model: 'none' },
        confidence: 0,
        findingsDropped: 0,
        findingsCorrected: 0,
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
    const complaints = draftComplaints(response.parsed);
    if (complaints.length > 0) {
      const correction: AiMessage[] = [
        ...messages,
        { role: 'assistant', content: response.rawText },
        {
          role: 'user',
          content: `Your draft has problems. ${complaints.join(' ')} Rewrite the ENTIRE JSON with these fixed — same structure, same grounding rules.`,
        },
      ];
      const retry = await extractStructuredWithParseRetry(
        this.ai,
        { ...extractionParams, messages: correction },
        GapBriefOutputSchema,
        'gap-brief',
      );
      const still = draftComplaints(retry.parsed);
      if (still.length > 0) {
        this.logger.warn(`gap-brief draft still failing after retry: ${still.join(' ')}`);
      }
      response = retry;
    }
    const reconciled = this.reconcileFindings(response.parsed, rows);
    return {
      ...base,
      output: reconciled.output,
      reason: 'ok',
      rawText: response.rawText,
      model: response.model,
      aiInferenceId: response.aiInferenceId,
      tokens: response.tokens,
      cost: response.cost,
      confidence: response.confidence,
      findingsDropped: reconciled.dropped,
      findingsCorrected: reconciled.corrected,
    };
  }

  /** Every finding must be about a row the reader can point at, wearing that
   *  row's own verdict. The schema only checks the verdict is one of the six
   *  legal strings — nothing stops the model from naming a `supply-unknown`
   *  field and tagging it `under-served`, which manufactures a shortfall out
   *  of a missing registrar figure. That is the exact reading `supply-unknown`
   *  exists to prevent, and prompt rule 4 alone has no teeth.
   *
   *  Runs after the model calls, not as another one — like the banned-tell
   *  pass, this is deterministic bookkeeping over text we already paid for. */
  private reconcileFindings(
    output: GapBriefOutput,
    rows: GapMapRow[],
  ): { output: GapBriefOutput; dropped: number; corrected: number } {
    const byName = new Map(rows.map((r) => [normaliseFieldName(r.nameEn), r]));
    let dropped = 0;
    let corrected = 0;
    const findings: GapBriefOutput['findings'] = [];
    for (const f of output.findings) {
      const row = byName.get(normaliseFieldName(f.fieldNameEn));
      if (!row) {
        dropped += 1;
        this.logger.warn(`gap-brief finding dropped: "${f.fieldNameEn}" is not a row in this view`);
        continue;
      }
      if (row.verdict === f.verdict) {
        findings.push(f);
        continue;
      }
      if (row.verdict === 'supply-unknown') {
        // The prose was written as a shortfall; relabelling it would leave a
        // finding whose text asserts a shortage its own label denies. There
        // is no salvageable half, so the whole finding goes.
        dropped += 1;
        this.logger.warn(
          `gap-brief finding dropped: "${f.fieldNameEn}" claimed ${f.verdict} but the row is supply-unknown`,
        );
        continue;
      }
      // The prose and the numbers still belong to this row — only the label
      // was wrong, so the label is what gets fixed.
      corrected += 1;
      this.logger.warn(
        `gap-brief finding corrected: "${f.fieldNameEn}" claimed ${f.verdict}, the row is ${row.verdict}`,
      );
      findings.push({ ...f, verdict: row.verdict });
    }
    return { output: { ...output, findings }, dropped, corrected };
  }
}

/** Case- and whitespace-insensitive: the prompt asks for the name verbatim,
 *  and dropping an otherwise-sound finding over "Logistics" vs "logistics"
 *  would cost the reader a finding to punish a typo. Distinct field names
 *  cannot collide under this. */
function normaliseFieldName(name: string): string {
  return name.trim().toLowerCase();
}

/** Deterministic faults worth one corrective call: banned tells, and a
 *  `cannotTell` list shorter than prompt rule 5's two entries.
 *
 *  Rule 5's minimum is enforced here rather than as `.min(2)` on the schema
 *  because the schema is the contract the map's own tests pin — a one-entry
 *  `cannotTell` is a weak brief, not an unparseable one, and failing the
 *  parse would spend the parse-retry on a response that is otherwise sound
 *  and then throw. A correction turn asks for the missing entry instead, at
 *  the same cost as the banned-tell retry and sharing its single call. */
function draftComplaints(o: GapBriefOutput): string[] {
  const complaints: string[] = [];
  const tells = lintBannedTells(freeText(o));
  if (tells.length > 0) {
    complaints.push(
      `You used banned phrase(s): ${tells.map((v) => `"${v.phrase}"`).join(', ')} — remove them and their close paraphrases.`,
    );
  }
  if (o.cannotTell.length < 2) {
    complaints.push(`"cannotTell" has ${o.cannotTell.length} entr${o.cannotTell.length === 1 ? 'y' : 'ies'}; rule 5 requires at least two.`);
  }
  return complaints;
}

function freeText(o: GapBriefOutput): string {
  return [...o.findings.flatMap((f) => [f.title, f.evidence, f.implication]), ...o.cannotTell, o.reasoning].join(' ');
}
