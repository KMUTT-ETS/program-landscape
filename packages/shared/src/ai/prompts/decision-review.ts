import { z } from 'zod';
import type { AiMessage } from '../types';
import { getInstitution } from '../../institution';

// ═════════════════════════════════════════════════════════════════════
// Decision outcome review (prompt 12)
//
// AI generates a comparison between the frozen snapshot (captured at
// decision time) and the current state, at 6mo / 1yr / 3yr horizons.
// Output is structured (what worked / what didn't / lessons) so the
// lessons-learned search page has clean grouping.
// ═════════════════════════════════════════════════════════════════════

export const DECISION_REVIEW_VERSION = 'outcome-review.v1';

export const DecisionReviewOutputSchema = z.object({
  narrativeTh: z.string(), // 3-5 paragraph Thai review
  narrativeEn: z.string().optional(),
  whatWorkedTh: z.array(z.string()),
  whatDidntWorkTh: z.array(z.string()),
  lessonsTh: z.array(z.string()),
  // Numeric deltas the analyst can cite in Council.
  projectedVsActualDeltas: z.array(
    z.object({
      metric: z.string(),
      projected: z.number().nullable(),
      actual: z.number().nullable(),
      deltaPct: z.number().nullable(),
    }),
  ).default([]),
  confidence: z.number().min(0).max(1),
});
export type DecisionReviewOutput = z.infer<typeof DecisionReviewOutputSchema>;

export interface DecisionReviewInput {
  decisionTitle: string;
  decisionType: string;
  horizon: 'SIX_MONTHS' | 'ONE_YEAR' | 'THREE_YEARS';
  effectiveDate: string; // ISO
  affectedPrograms: Array<{ id: string; code: string; nameEn: string; nameTh: string }>;
  // Frozen at decision time.
  snapshot: {
    healthSummary: string;
    riskSummary: string;
    topSkillGapsSummary: string;
    recentTrendCount: number;
  };
  // Current state as of now.
  current: {
    healthSummary: string;
    riskSummary: string;
    topSkillGapsSummary: string;
    recentTrendCount: number;
  };
  // Milestones (optional — may be empty for the 6-month review).
  milestones: Array<{
    title: string;
    status: string;
    targetDate: string | null;
    completedDate: string | null;
  }>;
}

export function buildDecisionReviewMessages(input: DecisionReviewInput): AiMessage[] {
  const horizonLabel =
    input.horizon === 'SIX_MONTHS' ? '6 เดือน' : input.horizon === 'ONE_YEAR' ? '1 ปี' : '3 ปี';

  const inst = getInstitution();
  const system = `You are writing a post-decision outcome review for the ${inst.shortNameEn} University Council.

Your job: compare what was projected at decision time vs what actually happened. Do NOT speculate beyond the data given. When a comparison isn't possible (e.g. a metric moved for reasons unrelated to this decision), say so explicitly.

Output STRICT JSON (no markdown, no fences) matching:
{
  "narrativeTh": "<3-5 paragraph Thai review>",
  "narrativeEn": "<optional — only if the review is likely to be shared internationally>",
  "whatWorkedTh": ["..."],
  "whatDidntWorkTh": ["..."],
  "lessonsTh": ["..."],
  "projectedVsActualDeltas": [
    { "metric": "...", "projected": <number|null>, "actual": <number|null>, "deltaPct": <number|null> }
  ],
  "confidence": 0.0-1.0
}

Rubric:
- Council needs honesty over optimism. If the decision failed to produce the projected outcome, say so plainly.
- Keep the narrative grounded in the specific numbers above. Don't generalise.
- Lessons are the ONLY prescriptive part — what would you do differently next time a similar decision comes up?
- Confidence should be lower when the horizon is short (6 months usually hasn't produced enough signal).`;

  const user = `[Decision] ${input.decisionTitle} (type: ${input.decisionType})
[Horizon] ${horizonLabel} post-implementation
[Effective date] ${input.effectiveDate}
[Affected programs]
${input.affectedPrograms.map((p) => `- ${p.code} — ${p.nameEn} / ${p.nameTh}`).join('\n')}

[Snapshot at decision time]
- Health: ${input.snapshot.healthSummary}
- Risks: ${input.snapshot.riskSummary}
- Top skill gaps: ${input.snapshot.topSkillGapsSummary}
- Recent trend signals: ${input.snapshot.recentTrendCount}

[Current state (as of now)]
- Health: ${input.current.healthSummary}
- Risks: ${input.current.riskSummary}
- Top skill gaps: ${input.current.topSkillGapsSummary}
- Recent trend signals: ${input.current.recentTrendCount}

[Milestones]
${input.milestones.length === 0 ? '(none recorded)' : input.milestones.map((m) => `- ${m.title}: ${m.status}${m.targetDate ? ` (target ${m.targetDate})` : ''}${m.completedDate ? ` (done ${m.completedDate})` : ''}`).join('\n')}

Return the JSON.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
