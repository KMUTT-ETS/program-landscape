import { z } from 'zod';
import type { AiMessage } from '../types';
import { getInstitution } from '../../institution';

// ═════════════════════════════════════════════════════════════════════
// Scenario insights (prompt 09)
//
// Five modes, one template:
//   1. suggest-assumptions  — AI proposes rationale-backed assumption
//      overrides based on scenario type + affected programs.
//   2. identify-risks       — AI enumerates hidden risks (faculty
//      resistance, brand, regulatory, student disruption) the engine
//      can't capture.
//   3. compare-narrative    — 2–4 scenario comparison with trade-offs
//      and priority-framed recommendations ("best if X; worst if Y").
//   4. devils-advocate      — Argues AGAINST the apparent best scenario.
//      Forces the Council to see where recommendation logic breaks.
//   5. what-would-change-my-mind — Surfaces the conditions under which
//      a recommended decision would be wrong.
//
// v2 (2026-08-17, docs/prompt-standard.md): English-only output across
// all five modes (v1 was Thai-primary throughout — audit #8). Adds the
// CONFIDENCE RUBRIC + BANNED PHRASES + CHANNEL MANIFEST markers.
//
// Channel fix in this bump: identify-risks now receives a summary of
// each affected program's latest RiskAssessment row (composite score,
// tier, top likelihood driver) when one exists. v1 asked the model to
// "enumerate hidden risks the engine can't capture" with NO visibility
// into risks the platform's own risk-scoring methodology already
// measured — the model had no way to avoid restating a risk the
// deterministic engine had already scored, or to build on it. Same
// pattern program-strategic-narrative-run.ts uses for its RISK channel.
//
// Also fixed at the caller (scenarios.controller.ts): `affectedProgramNames`
// was hard-coded to `[]` with a "pulled via join in a future iteration"
// comment — every mode's grounding was silently missing the one piece of
// scenario-specific context (which programs this scenario actually
// touches) that every mode's system prompt already assumed it had.
// ═════════════════════════════════════════════════════════════════════

export const SCENARIO_INSIGHTS_VERSION = 'scenario-insights.v2';

const CONFIDENCE_RUBRIC_BLOCK = `CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95.`;

const BANNED_PHRASES_BLOCK = `BANNED PHRASES (do not use these words/phrases or their close paraphrases):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — "the competitive landscape" — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"
Also: do not open two bullets/items with the same sentence structure; do not force a rounder item count than the data supports.`;

const GROUNDING_BLOCK = `GROUNDING RULES:
- Numbers in your output must be traceable to a value in the input snapshot below. Never invent or estimate a figure you were not given.
- When a listed channel says "data not available" below, do not guess its value or silently skip acknowledging the gap where it matters to your answer.
- Causal claims are hypotheses, not facts, unless the input states the mechanism. Use "consistent with" or "may reflect" — never assert "because X" when the input only shows X and Y are both true.`;

// ── Output schemas ───────────────────────────────────────────────────
const AssumptionSuggestionSchema = z.object({
  key: z.string(),
  suggestedValue: z.number(),
  rationale: z.string(),
  source: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

const RiskSchema = z.object({
  category: z.enum(['financial', 'academic', 'faculty', 'brand', 'regulatory', 'political']),
  severity: z.enum(['low', 'medium', 'high']),
  title: z.string(),
  description: z.string(),
  /** True when this risk builds on (rather than duplicates) a risk the
   *  deterministic risk-scoring methodology already measured for one of
   *  the affected programs — see the EXISTING RISK ASSESSMENTS channel. */
  groundedInExistingAssessment: z.boolean().default(false),
  mitigation: z.string().optional(),
});

const CompareEntrySchema = z.object({
  scenarioId: z.string(),
  summary: z.string(),
  strengths: z.array(z.string()),
  weaknesses: z.array(z.string()),
  bestFor: z.string(), // priority description, e.g. "prioritises short-term financial stability"
});

const DevilsAdvocateSchema = z.object({
  targetScenarioId: z.string(),
  counterArguments: z.array(z.string()),
  weakestAssumptionKey: z.string().optional(),
  whenThisIsWrong: z.string(),
});

const ChangeMyMindSchema = z.object({
  scenarioId: z.string(),
  conditions: z.array(
    z.object({
      condition: z.string(),
      ifThisHappens: z.string(),
    }),
  ),
});

export const ScenarioInsightsOutputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('suggest-assumptions'), suggestions: z.array(AssumptionSuggestionSchema), confidence: z.number().min(0).max(1) }),
  z.object({ mode: z.literal('identify-risks'), risks: z.array(RiskSchema), confidence: z.number().min(0).max(1) }),
  z.object({ mode: z.literal('compare-narrative'), comparisons: z.array(CompareEntrySchema), recommendation: z.string(), confidence: z.number().min(0).max(1) }),
  z.object({ mode: z.literal('devils-advocate'), result: DevilsAdvocateSchema, confidence: z.number().min(0).max(1) }),
  z.object({ mode: z.literal('what-would-change-my-mind'), result: ChangeMyMindSchema, confidence: z.number().min(0).max(1) }),
]);
export type ScenarioInsightsOutput = z.infer<typeof ScenarioInsightsOutputSchema>;

// ── Input types ─────────────────────────────────────────────────────
export interface ScenarioContext {
  id: string;
  name: string;
  scenarioType: string;
  horizonYears: number;
  assumptions: Record<string, number>;
  affectedProgramNames: string[];
  totalNetContribution?: number;
  totalRevenue?: number;
  totalCost?: number;
  monteCarloCi80?: [number, number];
  topSensitivityAssumptions?: Array<{ key: string; impact: number }>;
}

/** Latest RiskAssessment summary for one program affected by the
 *  scenario — the NEW channel identify-risks reads (see the file
 *  header). Null fields mean the assessment exists but that specific
 *  driver/dimension was itself a data gap, not that the row is absent. */
export interface ExistingRiskAssessmentSummary {
  programName: string;
  compositeScore: number | null;
  tier: string;
  topLikelihoodDriver: string | null;
  narrative: string | null;
}

export type ScenarioInsightsInput =
  | { mode: 'suggest-assumptions'; scenario: Omit<ScenarioContext, 'totalNetContribution' | 'totalRevenue' | 'totalCost' | 'monteCarloCi80' | 'topSensitivityAssumptions'>; currentAssumptions: Record<string, number> }
  | { mode: 'identify-risks'; scenario: ScenarioContext; existingRiskAssessments: ExistingRiskAssessmentSummary[] }
  | { mode: 'compare-narrative'; scenarios: ScenarioContext[] }
  | { mode: 'devils-advocate'; scenario: ScenarioContext; apparentBestReason: string }
  | { mode: 'what-would-change-my-mind'; scenario: ScenarioContext };

// ── Prompt builder ──────────────────────────────────────────────────
export function buildScenarioInsightsMessages(input: ScenarioInsightsInput): AiMessage[] {
  const inst = getInstitution();
  const systemBase = `You are a strategic advisor for ${inst.nameEn} Council. You produce Council-grade analysis — direct, defensible, and honest about uncertainty. Write in English throughout — all user-facing text (title, summary, rationale, description) is analysis prose, not a data label, so it stays English even though program/scenario names may be Thai. Output STRICT JSON (no prose, no markdown fences) matching the requested schema.

${GROUNDING_BLOCK}

${CONFIDENCE_RUBRIC_BLOCK}

${BANNED_PHRASES_BLOCK}`;

  const affectedProgramsLine = (names: string[]): string =>
    names.length > 0 ? names.join(', ') : 'data not available';

  if (input.mode === 'suggest-assumptions') {
    const system = `${systemBase}

Match this output shape exactly:
{
  "mode": "suggest-assumptions",
  "suggestions": [
    { "key": "<assumption key>", "suggestedValue": <number>, "rationale": "<why>", "source": "<NESDC, WEF, internal, etc.>", "confidence": 0.0-1.0 }
  ],
  "confidence": 0.0-1.0
}

Available assumption keys (use EXACTLY these names):
- tuitionGrowthPct, costInflationPct, demandGrowthPct, retentionRate, demographicShockPct, financialShockPct, aiDisplacementPct

Only suggest overrides that make sense for the scenario type. Cite the source in the rationale (NESDC, WEF, internal ${inst.shortNameEn} data, etc.). Do NOT invent numbers without a rationale.`;

    const user = `[Scenario] ${input.scenario.name}
[Type] ${input.scenario.scenarioType}
[Horizon] ${input.scenario.horizonYears} years
[Affected programs] ${affectedProgramsLine(input.scenario.affectedProgramNames)}

[Current assumption values]
${Object.entries(input.currentAssumptions).map(([k, v]) => `- ${k} = ${v}`).join('\n')}

Return the JSON.`;
    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
  }

  if (input.mode === 'identify-risks') {
    const system = `${systemBase}

Output shape:
{
  "mode": "identify-risks",
  "risks": [
    { "category": "financial|academic|faculty|brand|regulatory|political", "severity": "low|medium|high", "title": "...", "description": "...", "groundedInExistingAssessment": true|false, "mitigation": "..." }
  ],
  "confidence": 0.0-1.0
}

Focus on risks the engine CANNOT capture numerically — faculty morale, student transition disruption, brand reputation, regulatory scrutiny (MHESI / OHEC), political optics, alumni blowback. Return 3-6 risks. Ordered by severity.

EXISTING RISK ASSESSMENTS below (when present) are this platform's own deterministic risk-scoring output for the affected programs — do not re-derive or restate a number already given there. Set "groundedInExistingAssessment": true on any risk you raise that sharpens, extends, or draws a scenario-specific implication from one of those rows (e.g. "the L1 recruitment risk already flagged for Program X would compound under this scenario's demand shock"). Set it false for a genuinely new risk this scenario introduces that the existing assessments don't cover.`;

    const riskRows =
      input.existingRiskAssessments.length > 0
        ? input.existingRiskAssessments
            .map(
              (r) =>
                `  - ${r.programName}: tier=${r.tier}, composite=${r.compositeScore ?? 'n/d'}, top likelihood driver=${r.topLikelihoodDriver ?? 'n/d'}${r.narrative ? `, narrative: ${r.narrative}` : ''}`,
            )
            .join('\n')
        : '  data not available (no risk assessment on file for the affected programs)';

    const user = `[Scenario] ${input.scenario.name} (type: ${input.scenario.scenarioType}, horizon ${input.scenario.horizonYears}y)
[Affected programs] ${affectedProgramsLine(input.scenario.affectedProgramNames)}
[Assumptions] ${Object.entries(input.scenario.assumptions).map(([k, v]) => `${k}=${v}`).join(', ')}
${input.scenario.totalNetContribution != null ? `[Engine projection] total net contribution = ${input.scenario.totalNetContribution.toFixed(0)}` : ''}

[Existing risk assessments for the affected programs]
${riskRows}

Return the JSON.`;
    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
  }

  if (input.mode === 'compare-narrative') {
    const system = `${systemBase}

Output shape:
{
  "mode": "compare-narrative",
  "comparisons": [
    { "scenarioId": "...", "summary": "...", "strengths": ["..."], "weaknesses": ["..."], "bestFor": "<priority description>" }
  ],
  "recommendation": "<paragraph framing trade-offs by strategic priority, NOT a single 'best'>",
  "confidence": 0.0-1.0
}

Rubric: do NOT pick a winner. Frame each scenario in terms of WHICH strategic priority it serves best. Council members weight priorities differently; your job is to make those weights explicit.`;

    const user = `[Scenarios to compare]
${input.scenarios.map((s) =>
`- id=${s.id} name="${s.name}" type=${s.scenarioType} horizon=${s.horizonYears}y affected=[${affectedProgramsLine(s.affectedProgramNames)}] netContrib=${s.totalNetContribution?.toFixed(0) ?? 'n/a'} ci80=[${s.monteCarloCi80?.[0].toFixed(0) ?? '?'}, ${s.monteCarloCi80?.[1].toFixed(0) ?? '?'}]`
).join('\n')}

Return the JSON.`;
    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
  }

  if (input.mode === 'devils-advocate') {
    const system = `${systemBase}

You are arguing AGAINST the apparent-best scenario. Be specific; cite the weakest assumption by name. This is not cynicism — Council members need the strongest counter-argument in the room.

Output shape:
{
  "mode": "devils-advocate",
  "result": {
    "targetScenarioId": "...",
    "counterArguments": ["...", "..."],
    "weakestAssumptionKey": "<assumption key>",
    "whenThisIsWrong": "<paragraph on the conditions where this scenario fails>"
  },
  "confidence": 0.0-1.0
}`;

    const user = `[Target scenario] ${input.scenario.name} (id=${input.scenario.id})
[Apparent reason it looks best] ${input.apparentBestReason}
[Affected programs] ${affectedProgramsLine(input.scenario.affectedProgramNames)}
[Assumptions] ${Object.entries(input.scenario.assumptions).map(([k, v]) => `${k}=${v}`).join(', ')}
[Top sensitivities] ${input.scenario.topSensitivityAssumptions?.map((s) => `${s.key} (impact ${s.impact.toFixed(0)})`).join(', ') ?? 'data not available'}

Return the JSON.`;
    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
  }

  // what-would-change-my-mind
  const system = `${systemBase}

Output shape:
{
  "mode": "what-would-change-my-mind",
  "result": {
    "scenarioId": "...",
    "conditions": [
      { "condition": "<observable condition>", "ifThisHappens": "<what it would change>" }
    ]
  },
  "confidence": 0.0-1.0
}

Return 3-5 conditions. Each condition should be observable (not "if AI gets good") and tied to a specific assumption or intervention.`;

  const user = `[Scenario] ${input.scenario.name} (id=${input.scenario.id})
[Affected programs] ${affectedProgramsLine(input.scenario.affectedProgramNames)}
[Assumptions] ${Object.entries(input.scenario.assumptions).map(([k, v]) => `${k}=${v}`).join(', ')}
[Horizon] ${input.scenario.horizonYears} years

Return the JSON.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed by every mode:
//   - scenario.assumptions / scenarioType / horizonYears / name — the
//     Scenario row itself (scenarios.controller.ts's `brief` handler).
//   - scenario.affectedProgramNames — NEW as a real value in this bump:
//     resolved from `Scenario.affectedProgramIds` (Prisma) via a Program
//     name lookup at the caller. v1 hard-coded this to `[]`.
//   - engine projection fields (totalNetContribution / totalRevenue /
//     totalCost / monteCarloCi80 / topSensitivityAssumptions) — the
//     scenario's latest ScenarioRun.projectionJson, when a run exists.
//
// identify-risks additionally consumes:
//   - existingRiskAssessments — NEW channel (this bump): the latest
//     RiskAssessment row per affected program (Prisma, ordered by
//     assessedAt desc), summarised to tier + compositeScore + top
//     likelihood driver + narrativeEn. Lets the model build on the
//     platform's own deterministic risk-scoring output instead of
//     re-deriving numeric risk from scratch or duplicating it.
//
// Deliberately omitted, with reason:
//   - Full Monte Carlo distribution (only the 80% CI is passed) — the
//     narrative modes need a defensible range, not the raw sample set;
//     the numeric detail lives in the Simulation tab of the UI, not the
//     AI narrative.
//   - Program-level financial/health detail for affected programs — this
//     is a SCENARIO-level brief, not a per-program deep-dive; pulling in
//     each program's full health-score/financial snapshot would blow
//     the context budget for scenarios that touch 10+ programs and dilute
//     the scenario-specific question each mode answers.
// ─────────────────────────────────────────────────────────────────────────────
