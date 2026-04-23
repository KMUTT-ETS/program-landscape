import { z } from 'zod';
import type { AiMessage } from '../types';

// ═════════════════════════════════════════════════════════════════════
// Gap insights (prompt 08)
//
// Three callsites share this template:
//   1. /gap-analysis/insights/generate — top-5 strategic gaps for KKU
//   2. /programs/:id — "skills this program should add" (per-program)
//   3. Sector deep-dive brief (1-page Thai analysis per sector)
//
// Which mode is driven by `GapInsightsInput.mode`. The output schema is
// a discriminated union so callers get narrowed types.
// ═════════════════════════════════════════════════════════════════════

export const GAP_INSIGHTS_VERSION = 'gap-insights.v1';

// ── Output schemas ───────────────────────────────────────────────────
const StrategicGapSchema = z.object({
  rank: z.number().int().min(1).max(5),
  titleTh: z.string(),
  titleEn: z.string(),
  rationaleTh: z.string(),
  affectedSkillIds: z.array(z.string()).default([]),
  affectedSectorCodes: z.array(z.string()).default([]),
  recommendedAction: z.enum([
    'new-program',
    'new-track',
    'new-course',
    'expand-intake',
    'reduce-intake',
    'repurpose',
    'consolidate',
  ]),
  confidence: z.number().min(0).max(1),
});

const ProgramSkillsToAddSchema = z.object({
  programId: z.string(),
  skillsToAdd: z.array(
    z.object({
      skillId: z.string().optional(),
      nameEn: z.string(),
      nameTh: z.string(),
      evidenceTh: z.string(),
      demandIntensity: z.enum(['low', 'medium', 'high']),
    }),
  ),
  confidence: z.number().min(0).max(1),
});

const SectorBriefSchema = z.object({
  sectorCode: z.string(),
  titleTh: z.string(),
  bodyTh: z.string(), // ~400-600 words
  headlineMetrics: z.array(z.object({ labelTh: z.string(), value: z.string() })),
  strategicImplicationsTh: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const GapInsightsOutputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('strategic-top-5'), gaps: z.array(StrategicGapSchema) }),
  z.object({ mode: z.literal('program-skills-to-add'), result: ProgramSkillsToAddSchema }),
  z.object({ mode: z.literal('sector-brief'), brief: SectorBriefSchema }),
]);
export type GapInsightsOutput = z.infer<typeof GapInsightsOutputSchema>;

// ── Input types ─────────────────────────────────────────────────────
export interface StrategicTop5Input {
  mode: 'strategic-top-5';
  scopeLabel: string; // "KKU University", "Faculty of Engineering", etc.
  topSkillGaps: Array<{ skillId: string; nameEn: string; nameTh: string; gap: number; demand: number; supply: number }>;
  sectorSnapshot: Array<{ sectorCode: string; nameEn: string; family: string; demand: number; supply: number; trend: string }>;
  demographicNote: string;
}

export interface ProgramSkillsInput {
  mode: 'program-skills-to-add';
  programId: string;
  programName: { en: string; th: string };
  currentSkills: Array<{ id: string; nameEn: string; nameTh: string }>;
  topDemandedSkillsMissing: Array<{ id?: string; nameEn: string; nameTh: string; demandEvidence: string }>;
}

export interface SectorBriefInput {
  mode: 'sector-brief';
  sectorCode: string;
  sectorNames: { en: string; th: string };
  family: 'BCG' | 'SCURVE' | 'CUSTOM';
  demandSnapshot: { totalDemand: number; topSkills: string[]; topEmployers: string[] };
  supplySnapshot: { totalSupply: number; topPrograms: string[] };
  recentPolicySignals: string[];
}

export type GapInsightsInput = StrategicTop5Input | ProgramSkillsInput | SectorBriefInput;

// ── Prompt builder ──────────────────────────────────────────────────
export function buildGapInsightsMessages(input: GapInsightsInput): AiMessage[] {
  if (input.mode === 'strategic-top-5') {
    const system = `You are a strategic advisor for Khon Kaen University. You produce Council-grade analysis — direct, defensible, honest about uncertainty. Write Thai primary (rationaleTh, titleTh). English titles are labels for dashboards, not translations.

Output STRICT JSON (no prose, no fences) matching:
{
  "mode": "strategic-top-5",
  "gaps": [
    { "rank": 1, "titleTh": "...", "titleEn": "...", "rationaleTh": "...", "affectedSkillIds": [...], "affectedSectorCodes": [...], "recommendedAction": "new-program|new-track|new-course|expand-intake|reduce-intake|repurpose|consolidate", "confidence": 0.0-1.0 }
  ]
}

Ranking rubric (top 5 only): choose gaps that combine (a) largest absolute opportunity at KKU's scope, (b) alignment with BCG/S-curve national priorities, (c) plausibility of KKU execution given its current strengths. Prefer concrete over vague. Distinguish between "demand exists nationally but not locally" and "demand is universal."`;
    const user = `[Scope] ${input.scopeLabel}

[Top skill gaps]
${input.topSkillGaps.map((g) => `- ${g.nameEn} / ${g.nameTh}: demand=${g.demand.toFixed(1)} supply=${g.supply.toFixed(1)} gap=${g.gap.toFixed(1)} (skill:${g.skillId})`).join('\n')}

[Sector snapshot]
${input.sectorSnapshot.map((s) => `- ${s.sectorCode} (${s.family}) ${s.nameEn}: demand=${s.demand.toFixed(1)} supply=${s.supply.toFixed(1)} trend=${s.trend}`).join('\n')}

[Context]
${input.demographicNote}

Return the JSON.`;
    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
  }

  if (input.mode === 'program-skills-to-add') {
    const system = `You advise a specific KKU program's curriculum committee on which skills to add. Be concrete — name the specific skill, cite evidence from demanded-but-missing signals, rank by intensity.

Output STRICT JSON matching:
{
  "mode": "program-skills-to-add",
  "result": {
    "programId": "...",
    "skillsToAdd": [
      { "skillId": "...", "nameEn": "...", "nameTh": "...", "evidenceTh": "...", "demandIntensity": "low|medium|high" }
    ],
    "confidence": 0.0-1.0
  }
}

Return at most 6 skills, ordered by intensity. Skip skills already in currentSkills. evidenceTh is 1–2 sentences Thai citing market signals.`;
    const user = `[Program] ${input.programName.en} / ${input.programName.th} (id: ${input.programId})

[Current skills]
${input.currentSkills.map((s) => `- ${s.nameEn} / ${s.nameTh} (${s.id})`).join('\n')}

[Top demanded skills this program is missing]
${input.topDemandedSkillsMissing.map((s) => `- ${s.nameEn} / ${s.nameTh}${s.id ? ` (${s.id})` : ''}: ${s.demandEvidence}`).join('\n')}

Return the JSON.`;
    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
  }

  // sector-brief
  const system = `You write a 1-page Thai sector brief for the KKU University Council. Structure: opening context (2–3 sentences), 3–4 headline metrics, a body paragraph on supply/demand dynamics, then 3 concrete strategic implications for KKU.

Output STRICT JSON matching:
{
  "mode": "sector-brief",
  "brief": {
    "sectorCode": "...",
    "titleTh": "...",
    "bodyTh": "<400-600 words Thai prose>",
    "headlineMetrics": [{"labelTh": "...", "value": "..."}],
    "strategicImplicationsTh": ["...", "...", "..."],
    "confidence": 0.0-1.0
  }
}

Thai natural prose, not machine translation. Avoid hype — Council members notice.`;
  const user = `[Sector] ${input.sectorCode} — ${input.sectorNames.en} / ${input.sectorNames.th} (family: ${input.family})

[Demand snapshot]
Total demand signal: ${input.demandSnapshot.totalDemand.toFixed(1)}
Top skills: ${input.demandSnapshot.topSkills.join(', ')}
Top employers: ${input.demandSnapshot.topEmployers.join(', ')}

[Supply snapshot]
Total supply signal: ${input.supplySnapshot.totalSupply.toFixed(1)}
Top KKU programs: ${input.supplySnapshot.topPrograms.join(', ')}

[Recent policy signals]
${input.recentPolicySignals.map((p) => `- ${p}`).join('\n')}

Return the JSON.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
