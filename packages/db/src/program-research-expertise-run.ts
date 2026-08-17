import {
  buildProgramResearchExpertiseMessages,
  ProgramResearchExpertiseSchema,
  PROGRAM_RESEARCH_EXPERTISE_VERSION,
  researchExpertiseConfidenceCeiling,
  lintBannedTells,
  type AiService,
  type ExpertiseReadiness,
  extractStructuredWithParseRetry,
} from '@kku/shared';
import { prisma } from './index';
import { assembleResearchExpertiseInput } from './program-research-expertise';

// ─────────────────────────────────────────────────────────────────────────────
// Generates the demonstrated-research-expertise brief for one program, from
// its curated faculty roster's last-10-years publications.
//
// Mirrors program-strategic-narrative-run.ts deliberately (same three
// post-generation disciplines):
//   1. extractStructuredWithParseRetry at every extract call — one
//      corrective retry on schema-validation failure.
//   2. lintBannedTells over the output's free-text fields, one corrective
//      retry on violation, persist-anyway-and-warn on a second violation.
//   3. Confidence clamp to researchExpertiseConfidenceCeiling(readiness,
//      totalDistinct), warn when engaged.
//
// UNLIKE the narrative runner, this is NOT an upsert — every successful run
// INSERTs a new program_research_expertise row (see the schema comment on
// the model), so history accretes rather than being overwritten.
//
// `readiness === 'no-roster'` short-circuits before any AI call: a program
// without a curated ProgramFaculty roster cannot be analysed at all, and
// spending a call to say so would be pure waste (see readinessFor() in
// program-research-expertise.ts).
// ─────────────────────────────────────────────────────────────────────────────

export interface RunResearchExpertiseParams {
  programId: string;
  ai: AiService;
  triggeredByUserId?: string | null;
}

export type ResearchExpertiseOutcome =
  | {
      status: 'SUCCEEDED';
      readiness: ExpertiseReadiness;
      aiInferenceId: string | null;
      /** The PERSISTED confidence — i.e. after the deterministic ceiling
       *  clamp, never the model's raw self-report if it exceeded the
       *  ceiling. */
      confidence: number;
      /** True when the model's self-reported confidence exceeded the
       *  deterministic ceiling and was clamped down before persisting. */
      confidenceClamped: boolean;
      /** True when the first draft tripped the banned-tell lint and a
       *  corrective retry was issued (regardless of whether the retry
       *  itself came back clean). */
      lintRetried: boolean;
      tokensInput: number;
      tokensOutput: number;
      costUsd: number;
      themeCount: number;
      totalDistinct: number;
    }
  | { status: 'SKIPPED'; reason: string; readiness: ExpertiseReadiness | null }
  | { status: 'FAILED'; reason: string };

/**
 * Joins the payload's free-text fields into one string for banned-tell
 * linting: theme names + evidence notes, every recommendation's action +
 * rationale (across all three lanes), and the caveats. Deliberately a pure
 * function over a minimal structural shape (not the full Zod-inferred
 * type) so it is trivially unit-testable without constructing a complete
 * schema-valid payload.
 */
export function buildLintableText(payload: {
  themes: Array<{ name: string; evidenceNote: string }>;
  recommendations: {
    curriculum: Array<{ action: string; rationale: string }>;
    positioning: Array<{ action: string; rationale: string }>;
    research: Array<{ action: string; rationale: string }>;
  };
  caveats: string[];
}): string {
  const themeText = payload.themes.map((t) => `${t.name}\n${t.evidenceNote}`).join('\n');
  const allRecommendations = [
    ...payload.recommendations.curriculum,
    ...payload.recommendations.positioning,
    ...payload.recommendations.research,
  ];
  const recommendationText = allRecommendations
    .map((r) => `${r.action}\n${r.rationale}`)
    .join('\n');
  const caveatText = payload.caveats.join('\n');
  return [themeText, recommendationText, caveatText].filter((block) => block.length > 0).join('\n');
}

export async function generateProgramResearchExpertise(
  params: RunResearchExpertiseParams,
): Promise<ResearchExpertiseOutcome> {
  const input = await assembleResearchExpertiseInput(params.programId);
  if (!input) {
    return {
      status: 'SKIPPED',
      reason: `program not found: ${params.programId}`,
      readiness: null,
    };
  }

  // Zero AI calls, nothing stored — see readinessFor() in
  // program-research-expertise.ts. researchExpertiseConfidenceCeiling
  // also returns 0 for this readiness, but that branch is defensive only;
  // this early return is what actually enforces "no generation at all".
  if (input.readiness === 'no-roster') {
    return { status: 'SKIPPED', reason: 'no-roster', readiness: 'no-roster' };
  }

  const messages = buildProgramResearchExpertiseMessages(input);

  const extractionParams = {
    ctx: {
      module: 'programs',
      kind: 'program-research-expertise',
      userId: params.triggeredByUserId ?? null,
      traceId: `research-expertise-${params.programId}`,
    },
    methodVersion: PROGRAM_RESEARCH_EXPERTISE_VERSION,
    // Same 50000 convention as program-strategic-narrative-run.ts and
    // every other structured-extraction runner in this codebase — see the
    // 2026-05-13 program-digest/run.ts note (4096 → 50000: thinking-mode
    // output was getting truncated mid-JSON at the old budget).
    maxOutputTokens: 50000,
  };

  let response = await extractStructuredWithParseRetry(
    params.ai,
    { ...extractionParams, messages },
    ProgramResearchExpertiseSchema,
    'program-research-expertise',
  );

  // Banned-tell lint (docs/prompt-standard.md `## Banned AI tells`) — the
  // prompt-level ban is not airtight. One corrective retry; if the retry
  // still violates, persist the retry's output anyway and log a warning
  // (same posture as program-strategic-narrative-run.ts).
  let lintRetried = false;
  const initialTellViolations = lintBannedTells(buildLintableText(response.parsed));
  if (initialTellViolations.length > 0) {
    lintRetried = true;
    const correctionMessages = [
      ...messages,
      { role: 'assistant' as const, content: response.rawText },
      {
        role: 'user' as const,
        content: `Your draft used banned phrase(s): ${initialTellViolations
          .map((v) => `"${v.phrase}"`)
          .join(', ')}. Rewrite the ENTIRE brief without any of these words or their close paraphrases — keep the same structure and grounding rules. Return the corrected JSON in the same format as before.`,
      },
    ];
    const retryResponse = await extractStructuredWithParseRetry(
      params.ai,
      { ...extractionParams, messages: correctionMessages },
      ProgramResearchExpertiseSchema,
      'program-research-expertise',
    );
    const retryViolations = lintBannedTells(buildLintableText(retryResponse.parsed));
    if (retryViolations.length > 0) {
      console.warn(
        `[program-research-expertise] banned-tell lint still failing after retry for program ${params.programId}: ${retryViolations.map((v) => v.phrase).join(', ')}`,
      );
    }
    response = retryResponse;
  }

  // Confidence clamp (docs/prompt-standard.md `## Confidence rubric`) — the
  // model's self-report is a floor-signal only; enforce the deterministic
  // ceiling computed from readiness + how much evidence actually backs it.
  const ceiling = researchExpertiseConfidenceCeiling(input.readiness, input.stats.totalDistinct);
  let confidence = response.parsed.confidence;
  let confidenceClamped = false;
  if (confidence > ceiling) {
    confidenceClamped = true;
    console.warn(
      `[program-research-expertise] confidence clamped for program ${params.programId}: reported=${confidence} ceiling=${ceiling} (readiness=${input.readiness}, totalDistinct=${input.stats.totalDistinct})`,
    );
    confidence = ceiling;
  }

  // payloadJson carries the PERSISTED (post-clamp) confidence, not the
  // model's raw self-report — a Council-facing reader of this JSON must
  // never see a number the runner itself judged too high to trust.
  const payload = { ...response.parsed, confidence };

  const created = await prisma.programResearchExpertise.create({
    data: {
      programId: params.programId,
      payloadJson: payload,
      // Spread (not a bare `input.stats`) — ExpertiseStats is a named
      // interface, and Prisma's JSON input type requires an explicit
      // index signature to accept a named-interface value directly; a
      // fresh object literal (via spread) satisfies it structurally
      // without a cast.
      inputStatsJson: { ...input.stats },
      methodVersion: PROGRAM_RESEARCH_EXPERTISE_VERSION,
      aiInferenceId: response.aiInferenceId,
    },
  });

  return {
    status: 'SUCCEEDED',
    readiness: input.readiness,
    aiInferenceId: created.aiInferenceId,
    confidence,
    confidenceClamped,
    lintRetried,
    tokensInput: response.tokens.input,
    tokensOutput: response.tokens.output,
    costUsd: response.cost.usd,
    themeCount: response.parsed.themes.length,
    totalDistinct: input.stats.totalDistinct,
  };
}
