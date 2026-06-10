import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// trend-signal-analysis.v1
//
// Given one trend signal (policy / research / market / tech / news) and the
// list of KKU's canonical academic programs, the model identifies:
//   • affectedProgramIds — which KKU programs this trend touches (grounded:
//     ids MUST come from the supplied program list)
//   • affectedSkills — the skills the trend implicates (named; the runner
//     resolves names → Skill ids by exact match, drops the rest)
//   • recommendedActions — concrete, prioritised actions KKU should take
//
// Thai-primary content (per the language strategy) with English mirror.
// ─────────────────────────────────────────────────────────────────────────────

export const TREND_SIGNAL_ANALYSIS_VERSION = 'trend-signal-analysis.v1';

export const TrendSignalAnalysisSchema = z.object({
  /** Program ids affected by the signal — must be from the supplied list. */
  affectedProgramIds: z.array(z.string()).max(20),
  /** Affected skills, by name (EN or TH). Resolved to Skill ids downstream. */
  affectedSkills: z.array(z.string().min(2).max(120)).max(25),
  /** Prioritised, concrete actions for KKU. */
  recommendedActions: z
    .array(
      z.object({
        priority: z.enum(['high', 'medium', 'low']),
        actionTh: z.string().min(5).max(400),
        actionEn: z.string().min(5).max(400),
      }),
    )
    .min(1)
    .max(6),
  /** 1-2 sentence Thai rationale tying the picks to the signal. */
  rationaleTh: z.string().min(10).max(800),
  confidence: z.number().min(0).max(1),
});
export type TrendSignalAnalysis = z.infer<typeof TrendSignalAnalysisSchema>;

export interface TrendSignalAnalysisInput {
  signal: {
    signalType: string;
    title: string;
    summaryTh: string | null;
    summaryEn: string | null;
    sourceUrl: string | null;
    impactScore: number;
  };
  /** Canonical KKU programs the model may pick from. */
  programs: Array<{ id: string; nameEn: string; nameTh: string; faculty: string }>;
}

export function buildTrendSignalAnalysisMessages(input: TrendSignalAnalysisInput): AiMessage[] {
  const system = `You are a strategic curriculum analyst for Khon Kaen University (KKU) Council. Given an external TREND SIGNAL and the list of KKU's academic programs, decide which programs the trend affects, which skills it implicates, and what KKU should DO about it.

RULES:
1. Ground every program pick in the supplied list — \`affectedProgramIds\` MUST contain only ids that appear in PROGRAMS below. Pick only programs genuinely affected (0 is valid if none are); do not pad.
2. \`affectedSkills\`: name the concrete skills the trend implicates (e.g. "Machine learning", "Battery chemistry", "Health data privacy"). Use widely-recognised skill names; the system resolves them to KKU's taxonomy.
3. \`recommendedActions\`: 1-6 concrete, prioritised actions KKU could take in response (e.g. add a module, launch a track, re-skill faculty, partner with industry). Each action in Thai (actionTh) + English (actionEn). Be specific and actionable — no platitudes.
4. Output STRICT JSON, no markdown fences, no prose outside the JSON.

OUTPUT JSON SHAPE:
{
  "affectedProgramIds": ["<id from PROGRAMS>", ...],
  "affectedSkills": ["<skill name>", ...],
  "recommendedActions": [
    { "priority": "high|medium|low", "actionTh": "<≤60 words Thai>", "actionEn": "<≤60 words English>" }
  ],
  "rationaleTh": "<1-2 sentence Thai rationale>",
  "confidence": 0.0-1.0
}`;

  const s = input.signal;
  const signalBlock = `TREND SIGNAL
  Type:        ${s.signalType}
  Title:       ${s.title}
  Impact:      ${s.impactScore}/100
  Summary (TH): ${s.summaryTh ?? '(none)'}
  Summary (EN): ${s.summaryEn ?? '(none)'}
  Source:      ${s.sourceUrl ?? '(none)'}`;

  const programBlock =
    'PROGRAMS (id — name — faculty):\n' +
    input.programs.map((p) => `  ${p.id} — ${p.nameEn || p.nameTh} — ${p.faculty}`).join('\n');

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `${signalBlock}\n\n${programBlock}\n\nProduce the JSON analysis. Pick only genuinely-affected programs (by id), name the implicated skills, and recommend concrete prioritised actions.`,
    },
  ];
}
