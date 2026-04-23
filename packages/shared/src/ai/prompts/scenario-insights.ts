import { z } from 'zod';
import type { AiMessage } from '../types';

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
// ═════════════════════════════════════════════════════════════════════

export const SCENARIO_INSIGHTS_VERSION = 'scenario-insights.v1';

// ── Output schemas ───────────────────────────────────────────────────
const AssumptionSuggestionSchema = z.object({
  key: z.string(),
  suggestedValue: z.number(),
  rationaleTh: z.string(),
  source: z.string().optional(),
  confidence: z.number().min(0).max(1),
});

const RiskSchema = z.object({
  category: z.enum(['financial', 'academic', 'faculty', 'brand', 'regulatory', 'political']),
  severity: z.enum(['low', 'medium', 'high']),
  titleTh: z.string(),
  descriptionTh: z.string(),
  mitigation: z.string().optional(),
});

const CompareEntrySchema = z.object({
  scenarioId: z.string(),
  summaryTh: z.string(),
  strengthsTh: z.array(z.string()),
  weaknessesTh: z.array(z.string()),
  bestFor: z.string(), // priority description, e.g. "ต้องการสถานะการเงินระยะสั้นมั่นคง"
});

const DevilsAdvocateSchema = z.object({
  targetScenarioId: z.string(),
  counterArgumentsTh: z.array(z.string()),
  weakestAssumptionKey: z.string().optional(),
  whenThisIsWrongTh: z.string(),
});

const ChangeMyMindSchema = z.object({
  scenarioId: z.string(),
  conditionsTh: z.array(
    z.object({
      conditionTh: z.string(),
      ifThisHappens: z.string(),
    }),
  ),
});

export const ScenarioInsightsOutputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('suggest-assumptions'), suggestions: z.array(AssumptionSuggestionSchema), confidence: z.number().min(0).max(1) }),
  z.object({ mode: z.literal('identify-risks'), risks: z.array(RiskSchema), confidence: z.number().min(0).max(1) }),
  z.object({ mode: z.literal('compare-narrative'), comparisons: z.array(CompareEntrySchema), recommendationTh: z.string(), confidence: z.number().min(0).max(1) }),
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

export type ScenarioInsightsInput =
  | { mode: 'suggest-assumptions'; scenario: Omit<ScenarioContext, 'totalNetContribution' | 'totalRevenue' | 'totalCost' | 'monteCarloCi80' | 'topSensitivityAssumptions'>; currentAssumptions: Record<string, number> }
  | { mode: 'identify-risks'; scenario: ScenarioContext }
  | { mode: 'compare-narrative'; scenarios: ScenarioContext[] }
  | { mode: 'devils-advocate'; scenario: ScenarioContext; apparentBestReason: string }
  | { mode: 'what-would-change-my-mind'; scenario: ScenarioContext };

// ── Prompt builder ──────────────────────────────────────────────────
export function buildScenarioInsightsMessages(input: ScenarioInsightsInput): AiMessage[] {
  const systemBase = `You are a strategic advisor for Khon Kaen University Council. You produce Council-grade analysis — direct, defensible, and honest about uncertainty. All user-facing text (titleTh, summaryTh, rationaleTh, descriptionTh) is natural Thai prose, not translated-from-English. Output STRICT JSON (no prose, no markdown fences) matching the requested schema.`;

  if (input.mode === 'suggest-assumptions') {
    const system = `${systemBase}

Match this output shape exactly:
{
  "mode": "suggest-assumptions",
  "suggestions": [
    { "key": "<assumption key>", "suggestedValue": <number>, "rationaleTh": "<why>", "source": "<NESDC, WEF, internal, etc.>", "confidence": 0.0-1.0 }
  ],
  "confidence": 0.0-1.0
}

Available assumption keys (use EXACTLY these names):
- tuitionGrowthPct, costInflationPct, demandGrowthPct, retentionRate, demographicShockPct, financialShockPct, aiDisplacementPct

Only suggest overrides that make sense for the scenario type. Cite the source in the Thai rationale (NESDC, WEF, internal KKU data, etc.). Do NOT invent numbers without a rationale.`;

    const user = `[Scenario] ${input.scenario.name}
[Type] ${input.scenario.scenarioType}
[Horizon] ${input.scenario.horizonYears} years
[Affected programs] ${input.scenario.affectedProgramNames.join(', ')}

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
    { "category": "financial|academic|faculty|brand|regulatory|political", "severity": "low|medium|high", "titleTh": "...", "descriptionTh": "...", "mitigation": "..." }
  ],
  "confidence": 0.0-1.0
}

Focus on risks the engine CANNOT capture numerically — faculty morale, student transition disruption, brand reputation, regulatory scrutiny (MHESI / OHEC), political optics, alumni blowback. Return 3–6 risks. Ordered by severity.`;

    const user = `[Scenario] ${input.scenario.name} (type: ${input.scenario.scenarioType}, horizon ${input.scenario.horizonYears}y)
[Affected programs] ${input.scenario.affectedProgramNames.join(', ')}
[Assumptions] ${Object.entries(input.scenario.assumptions).map(([k, v]) => `${k}=${v}`).join(', ')}
${input.scenario.totalNetContribution != null ? `[Engine projection] total net contribution = ${input.scenario.totalNetContribution.toFixed(0)}` : ''}

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
    { "scenarioId": "...", "summaryTh": "...", "strengthsTh": ["..."], "weaknessesTh": ["..."], "bestFor": "<priority description in Thai>" }
  ],
  "recommendationTh": "<Thai paragraph framing trade-offs by strategic priority, NOT a single 'best'>",
  "confidence": 0.0-1.0
}

Rubric: do NOT pick a winner. Frame each scenario in terms of WHICH strategic priority it serves best. Council members weight priorities differently; your job is to make those weights explicit.`;

    const user = `[Scenarios to compare]
${input.scenarios.map((s) =>
`- id=${s.id} name="${s.name}" type=${s.scenarioType} horizon=${s.horizonYears}y netContrib=${s.totalNetContribution?.toFixed(0) ?? 'n/a'} ci80=[${s.monteCarloCi80?.[0].toFixed(0) ?? '?'}, ${s.monteCarloCi80?.[1].toFixed(0) ?? '?'}]`
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
    "counterArgumentsTh": ["...", "..."],
    "weakestAssumptionKey": "<assumption key>",
    "whenThisIsWrongTh": "<Thai paragraph on the conditions where this scenario fails>"
  },
  "confidence": 0.0-1.0
}`;

    const user = `[Target scenario] ${input.scenario.name} (id=${input.scenario.id})
[Apparent reason it looks best] ${input.apparentBestReason}
[Assumptions] ${Object.entries(input.scenario.assumptions).map(([k, v]) => `${k}=${v}`).join(', ')}
[Top sensitivities] ${input.scenario.topSensitivityAssumptions?.map((s) => `${s.key} (impact ${s.impact.toFixed(0)})`).join(', ') ?? 'n/a'}

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
    "conditionsTh": [
      { "conditionTh": "<observable condition in Thai>", "ifThisHappens": "<what it would change in Thai>" }
    ]
  },
  "confidence": 0.0-1.0
}

Return 3–5 conditions. Each condition should be observable (not "if AI gets good") and tied to a specific assumption or intervention.`;

  const user = `[Scenario] ${input.scenario.name} (id=${input.scenario.id})
[Assumptions] ${Object.entries(input.scenario.assumptions).map(([k, v]) => `${k}=${v}`).join(', ')}
[Horizon] ${input.scenario.horizonYears} years

Return the JSON.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
