import { z } from 'zod';
import type { AiMessage } from '../types';

// ═════════════════════════════════════════════════════════════════════
// Gap insights (prompt 08)
//
// Three callsites share this template:
//   1. /gap-analysis/insights/generate — top-5 strategic gaps for KKU
//   2. /programs/:id — "skills this program should add" (per-program)
//   3. Sector deep-dive brief (1-page analysis per sector)
//
// Which mode is driven by `GapInsightsInput.mode`. The output schema is
// a discriminated union so callers get narrowed types.
//
// v2 (2026-08-17, docs/prompt-standard.md): English-only output across
// all three modes (v1 was Thai-primary throughout — audit #7). Adds the
// CONFIDENCE RUBRIC + BANNED PHRASES + CHANNEL MANIFEST markers. Skill
// identity fields (nameEn/nameTh) stay bilingual — they are catalog
// data labels the model echoes from its input, not generated analysis
// prose (see the standard's `nameTh`-class exemption).
//
// Channel fix in this bump: sector-brief's demand snapshot used to hand
// the model permanently-empty `topSkills` / `topEmployers` arrays (the
// caller never populated them — see gap-insights.service.ts's git
// history). The service now derives both from computeSkillGap() rows
// scoped to the sector's member skills before calling the builder, so
// the brief has the same grounding its own rubric already claimed to
// use ("cite specific skills/employers" was previously unfollowable).
// ═════════════════════════════════════════════════════════════════════

export const GAP_INSIGHTS_VERSION = 'gap-insights.v2';

// ── Shared rubric/ban text (kept as string constants so all three
//    per-mode system prompts embed them verbatim — the conformance
//    test greps the file text, not a specific mode). ────────────────
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
Also: do not open two bullets/items with the same sentence structure (e.g. every gap rationale starting "This gap..."); do not force a rounder item count than the data supports.`;

const GROUNDING_BLOCK = `GROUNDING RULES:
- Numbers in your output must be traceable to a value in the input snapshot below. Never invent or estimate a figure you were not given.
- When a listed input is empty (e.g. no recent policy signals, no top employers), do not invent a plausible-sounding one — omit that point or say the channel has nothing to report.
- Causal claims are hypotheses, not facts, unless the input states the mechanism. Use "consistent with" or "may reflect" — never assert "because X" when the input only shows X and Y are both true.
- Write in English. Skill/program/sector names given with both an English and Thai form (nameEn/nameTh) are catalog identity labels — echo them as given, do not translate analysis prose into Thai.`;

// ── Output schemas ───────────────────────────────────────────────────
const StrategicGapSchema = z.object({
  rank: z.number().int().min(1).max(5),
  title: z.string(),
  rationale: z.string(),
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
      /** Must reference a skillId offered in topDemandedSkillsMissing —
       *  closed-world (per the standard's Classification addendum):
       *  the model may only choose from candidates it was shown. */
      skillId: z.string().optional(),
      nameEn: z.string(),
      nameTh: z.string(),
      evidence: z.string(),
      demandIntensity: z.enum(['low', 'medium', 'high']),
    }),
  ),
  confidence: z.number().min(0).max(1),
});

const SectorBriefSchema = z.object({
  sectorCode: z.string(),
  title: z.string(),
  body: z.string(), // ~400-600 words
  headlineMetrics: z.array(z.object({ label: z.string(), value: z.string() })),
  strategicImplications: z.array(z.string()),
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
    const system = `You are a strategic advisor for Khon Kaen University. You produce Council-grade analysis — direct, defensible, honest about uncertainty. Write in English. Skill names carry both nameEn and nameTh in the input — those are catalog identity labels, echo them as given; do not write any other analysis prose in Thai.

${GROUNDING_BLOCK}

${CONFIDENCE_RUBRIC_BLOCK}

${BANNED_PHRASES_BLOCK}

Output STRICT JSON (no prose, no fences) matching:
{
  "mode": "strategic-top-5",
  "gaps": [
    { "rank": 1, "title": "...", "rationale": "...", "affectedSkillIds": [...], "affectedSectorCodes": [...], "recommendedAction": "new-program|new-track|new-course|expand-intake|reduce-intake|repurpose|consolidate", "confidence": 0.0-1.0 }
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
    const system = `You advise a specific KKU program's curriculum committee on which skills to add. Be concrete — name the specific skill, cite evidence from demanded-but-missing signals, rank by intensity. Write in English; skill nameEn/nameTh fields are catalog identity labels, echo them as given.

${GROUNDING_BLOCK}
- Closed-world only: every recommended skill must come from the topDemandedSkillsMissing list below. Do not propose a skill that isn't in that list.

${CONFIDENCE_RUBRIC_BLOCK}

${BANNED_PHRASES_BLOCK}

Output STRICT JSON matching:
{
  "mode": "program-skills-to-add",
  "result": {
    "programId": "...",
    "skillsToAdd": [
      { "skillId": "...", "nameEn": "...", "nameTh": "...", "evidence": "...", "demandIntensity": "low|medium|high" }
    ],
    "confidence": 0.0-1.0
  }
}

Return at most 6 skills, ordered by intensity. Skip skills already in currentSkills. "evidence" is 1-2 sentences in English citing the market signal from the input.`;
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
  const system = `You write a 1-page English sector brief for the KKU University Council. Structure: opening context (2-3 sentences), 3-4 headline metrics, a body paragraph on supply/demand dynamics, then 3 concrete strategic implications for KKU.

${GROUNDING_BLOCK}
- Top skills and top employers, when present below, come from the same skill-gap computation the Gap Analyzer module uses — cite them by name rather than writing generically about "in-demand skills."
- When topSkills or topEmployers is empty, say so plainly ("no employer-level signal available for this sector yet") rather than describing the sector's demand in vague terms.

${CONFIDENCE_RUBRIC_BLOCK}

${BANNED_PHRASES_BLOCK}

Output STRICT JSON matching:
{
  "mode": "sector-brief",
  "brief": {
    "sectorCode": "...",
    "title": "...",
    "body": "<400-600 words English prose>",
    "headlineMetrics": [{"label": "...", "value": "..."}],
    "strategicImplications": ["...", "...", "..."],
    "confidence": 0.0-1.0
  }
}

Natural prose, not a bullet list disguised as paragraphs. Avoid hype — Council members notice.`;
  const user = `[Sector] ${input.sectorCode} — ${input.sectorNames.en} / ${input.sectorNames.th} (family: ${input.family})

[Demand snapshot]
Total demand signal: ${input.demandSnapshot.totalDemand.toFixed(1)}
Top skills: ${input.demandSnapshot.topSkills.length > 0 ? input.demandSnapshot.topSkills.join(', ') : 'data not available'}
Top employers: ${input.demandSnapshot.topEmployers.length > 0 ? input.demandSnapshot.topEmployers.join(', ') : 'data not available'}

[Supply snapshot]
Total supply signal: ${input.supplySnapshot.totalSupply.toFixed(1)}
Top KKU programs: ${input.supplySnapshot.topPrograms.length > 0 ? input.supplySnapshot.topPrograms.join(', ') : 'data not available'}

[Recent policy signals]
${input.recentPolicySignals.length > 0 ? input.recentPolicySignals.map((p) => `- ${p}`).join('\n') : '(none on file)'}

Return the JSON.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// strategic-top-5 consumes:
//   - topSkillGaps        — computeSkillGap() top 10 rows at the requested
//     scope (@kku/db gap-analysis.ts), demand/supply/gap already computed.
//   - sectorSnapshot       — computeSectorGap() rows (@kku/db gap-analysis.ts).
//   - demographicNote      — a fixed strategic-context string (Thailand cohort
//     shrinkage), not per-request data.
//   Omitted, with reason: per-program detail — this mode is a portfolio-level
//   top-5, individual program rows would dilute a 5-item ranked output.
//
// program-skills-to-add consumes:
//   - currentSkills             — ProgramSkill rows for the program (Prisma).
//   - topDemandedSkillsMissing  — computeSkillGap() rows filtered to
//     gap > 0 AND not already in currentSkills (gap-insights.service.ts).
//   Omitted, with reason: TCAS/enrollment trend — this mode answers "which
//   skills," not "should this program grow," a different question the
//   Cockpit/Gap Analyzer modules answer separately.
//
// sector-brief consumes:
//   - demandSnapshot.totalDemand / supplySnapshot.totalSupply — from the
//     matching computeSectorGap() row.
//   - demandSnapshot.topSkills / topEmployers — NEW in v2: derived by the
//     caller from computeSkillGap() rows restricted to the sector's member
//     skills (SkillSector join), sorted by demand, capped at 5 skills / 5
//     employers. v1 always sent empty arrays here — a channel the prompt's
//     own rubric referenced but the caller never filled.
//   - supplySnapshot.topPrograms — contributingProgramIds off the sector-gap
//     row, resolved to program names by the caller.
//   - recentPolicySignals — TrendSignal rows tagged POLICY whose title
//     contains the sector's name (best-effort keyword match; the audit's
//     "real sector tagging" gap from prompt 07 still applies here).
//   Omitted, with reason: peer-institution sector coverage — Benchmarking
//   module's job (white-spaces / subject leadership), not Gap Analyzer's;
//   mixing modules would blur which surface a Council reader should act on.
// ─────────────────────────────────────────────────────────────────────────────
