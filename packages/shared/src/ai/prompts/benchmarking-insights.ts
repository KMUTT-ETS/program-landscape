import { z } from 'zod';
import type { AiMessage } from '../types';
import { getInstitution } from '../../institution';

// ═════════════════════════════════════════════════════════════════════
// Benchmarking insights (prompt 10)
//
// Four modes:
//   1. suggest-peers       — AI proposes additional peers for a KKU
//      program given subject + country + ranking context. LIVE — the
//      only mode with a controller endpoint before this bump
//      (POST /benchmarking/programs/:id/peers/suggest).
//   2. curriculum-gap      — narrative comparing KKU program's skill
//      coverage against peer set's aggregate coverage. NEW endpoint in
//      this bump — see below.
//   3. distinctiveness     — explanation of what makes this program
//      unique in the peer set (or whether it's undifferentiated).
//   4. positioning-brief   — 1-page competitive-positioning note for a
//      subject area.
//
// v2 (2026-08-17, docs/prompt-standard.md): English-only output across
// all four modes (v1 was Thai-primary throughout — audit #9). Adds the
// CONFIDENCE RUBRIC + BANNED PHRASES + CHANNEL MANIFEST markers.
//
// Channel fix in this bump: curriculum-gap — the mode that specifically
// argues KKU-vs-peer curriculum gaps — previously argued from skill
// coverage counts alone, with no visibility into whether KKU's existing
// skills actually translate into graduate outcomes or labour-market
// traction. It now optionally receives GRADUATE OUTCOMES (latest survey)
// and KMITL DEMAND MATCH (matched/unmatched demanded skills) so a
// "bridge this gap" recommendation can be weighed against "is the
// current curriculum even landing graduates" rather than argued on
// curriculum coverage in isolation.
//
// Wiring note: curriculum-gap had NO controller endpoint prior to this
// bump (only suggest-peers was reachable from apps/api/src/benchmarking/
// benchmarking.controller.ts — confirmed via a full grep of apps/ + docs
// for the mode literal). This bump adds
// `POST /benchmarking/programs/:id/curriculum-gap`, mirroring the
// existing suggest-peers endpoint, so the channel fix has somewhere to
// run rather than sitting on an unreachable input type.
// ═════════════════════════════════════════════════════════════════════

export const BENCHMARKING_INSIGHTS_VERSION = 'benchmarking-insights.v2';

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

function groundingBlock(): string {
  const inst = getInstitution();
  return `GROUNDING RULES:
- Numbers in your output must be traceable to a value in the input snapshot below. Never invent or estimate a figure you were not given.
- When a listed channel says "data not available" below, acknowledge the gap rather than writing around it as if the data existed.
- Causal claims are hypotheses, not facts, unless the input states the mechanism. Use "consistent with" or "may reflect" — never assert "because X" when the input only shows X and Y are both true.
- Peer-institution curriculum claims come from your general knowledge of these institutions, not from a ${inst.shortNameEn}-held snapshot — that is a legitimate use of external context for a benchmarking prompt, but keep such claims general (what a subject area typically covers at a peer of that caliber) rather than asserting specific unverified facts about a named peer's current course list.`;
}

// ── Output schemas ───────────────────────────────────────────────────
const PeerSuggestionSchema = z.object({
  institution: z.string(),
  country: z.string(),
  subjectArea: z.string(),
  programLevel: z.string(),
  rationale: z.string(),
  confidence: z.number().min(0).max(1),
});

const CurriculumGapSchema = z.object({
  programId: z.string(),
  /** Skill names peers teach that KKU's program doesn't — echoed from
   *  peerSkillCoverage's nameEn (closed-world, per the standard's
   *  Classification addendum: candidates offered in the input only). */
  whatPeersHave: z.array(z.string()),
  /** Skill names KKU's program covers — echoed from kkuSkills' nameEn. */
  whatKkuHas: z.array(z.string()),
  bridgingOpportunities: z.array(
    z.object({
      title: z.string(),
      rationale: z.string(),
      urgency: z.enum(['low', 'medium', 'high']),
    }),
  ),
  summary: z.string(),
  confidence: z.number().min(0).max(1),
});

const DistinctivenessNarrativeSchema = z.object({
  programId: z.string(),
  distinctivenessScore: z.number().min(0).max(100),
  narrative: z.string(),
  uniqueStrengths: z.array(z.string()),
  undifferentiatedAreas: z.array(z.string()),
  recommendation: z.string(),
  confidence: z.number().min(0).max(1),
});

const PositioningBriefSchema = z.object({
  subjectArea: z.string(),
  narrative: z.string(), // 300-500 words
  kkuStrategicPosition: z.string(),
  rivalsToWatch: z.array(z.string()),
  opportunities: z.array(z.string()),
  threats: z.array(z.string()),
  confidence: z.number().min(0).max(1),
});

export const BenchmarkingInsightsOutputSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('suggest-peers'), suggestions: z.array(PeerSuggestionSchema), confidence: z.number().min(0).max(1) }),
  z.object({ mode: z.literal('curriculum-gap'), result: CurriculumGapSchema }),
  z.object({ mode: z.literal('distinctiveness'), result: DistinctivenessNarrativeSchema }),
  z.object({ mode: z.literal('positioning-brief'), result: PositioningBriefSchema }),
]);
export type BenchmarkingInsightsOutput = z.infer<typeof BenchmarkingInsightsOutputSchema>;

// ── Input types ─────────────────────────────────────────────────────
export interface SuggestPeersInput {
  mode: 'suggest-peers';
  programId: string;
  programName: { en: string; th: string };
  subjectArea: string | null;
  programLevel: string;
  existingPeerInstitutions: string[];
  region: 'TH' | 'ASEAN' | 'GLOBAL';
}

/** NEW channels (benchmarking-insights.v2) — see file header. Both null
 *  when the program has no rows yet (a data gap, never rendered as a
 *  zero/negative signal). */
export interface GraduateOutcomesSummary {
  surveyYear: number;
  employmentRatePct: number;
  averageSalaryThb: number | null;
  sampleSize: number;
}

export interface KmitlDemandMatchSummary {
  matchedDemanded: number;
  relevantDemanded: number;
  topUnmatchedSkills: string[];
}

export interface CurriculumGapInput {
  mode: 'curriculum-gap';
  programId: string;
  programName: { en: string; th: string };
  kkuSkills: Array<{ nameEn: string; nameTh: string }>;
  peerSkillCoverage: Array<{ nameEn: string; nameTh: string; peerCount: number }>;
  peerInstitutions: string[];
  graduateOutcomes: GraduateOutcomesSummary | null;
  kmitlDemandMatch: KmitlDemandMatchSummary | null;
}

export interface DistinctivenessInput {
  mode: 'distinctiveness';
  programId: string;
  programName: { en: string; th: string };
  distinctivenessScore: number;
  distinctiveSkills: Array<{ nameEn: string; nameTh: string }>;
  sharedSkills: Array<{ nameEn: string; count: number }>;
  peerSetName: string;
}

export interface PositioningBriefInput {
  mode: 'positioning-brief';
  subjectArea: string;
  kkuPercentileLatest: number | null;
  rankingTrends: Array<{ institution: string; source: string; trend: 'rising' | 'falling' | 'stable'; latestRank: number }>;
  kkuProgramCount: number;
  peerProgramCount: number;
}

export type BenchmarkingInsightsInput =
  | SuggestPeersInput
  | CurriculumGapInput
  | DistinctivenessInput
  | PositioningBriefInput;

// ── Prompt builder ──────────────────────────────────────────────────
export function buildBenchmarkingInsightsMessages(input: BenchmarkingInsightsInput): AiMessage[] {
  const inst = getInstitution();
  const systemBase = `You are a strategic benchmarking advisor for ${inst.nameEn}. Output STRICT JSON (no prose, no markdown fences). Write in English throughout — all user-facing text fields (rationale, narrative, summary) are analysis prose, not data labels, so they stay English even though program/skill names may be given in Thai alongside English.

${groundingBlock()}

${CONFIDENCE_RUBRIC_BLOCK}

${BANNED_PHRASES_BLOCK}`;

  if (input.mode === 'suggest-peers') {
    const system = `${systemBase}

Match this output:
{
  "mode": "suggest-peers",
  "suggestions": [
    { "institution": "...", "country": "...", "subjectArea": "...", "programLevel": "BACHELOR|MASTER|DOCTORAL", "rationale": "<why this peer>", "confidence": 0.0-1.0 }
  ],
  "confidence": 0.0-1.0
}

Rubric: propose 3-6 peers not in existingPeerInstitutions. Match region constraint. Prefer peers with comparable subject focus + program level. Do NOT invent institutions you don't know.`;

    const user = `[${inst.shortNameEn} program] ${input.programName.en} / ${input.programName.th} (level: ${input.programLevel})
[Subject] ${input.subjectArea ?? 'unspecified'}
[Region] ${input.region}
[Existing peers] ${input.existingPeerInstitutions.join(', ') || '(none yet)'}

Return the JSON.`;
    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
  }

  if (input.mode === 'curriculum-gap') {
    const system = `${systemBase}

Match this output:
{
  "mode": "curriculum-gap",
  "result": {
    "programId": "...",
    "whatPeersHave": ["..."],
    "whatKkuHas": ["..."],
    "bridgingOpportunities": [
      { "title": "...", "rationale": "...", "urgency": "low|medium|high" }
    ],
    "summary": "<2-3 sentence summary>",
    "confidence": 0.0-1.0
  }
}

Focus on concrete, actionable gaps. Urgency "high" only for skills with strong peer consensus (>half the peers teach it) that ${inst.shortNameEn} lacks. whatPeersHave/whatKkuHas must be skill names copied from the input's peerSkillCoverage / kkuSkills lists — do not invent skill names not offered there.

When GRADUATE OUTCOMES and/or LABOUR-MARKET DEMAND below are present, weigh them into your bridgingOpportunities and summary: a curriculum gap matters more when it lines up with weak employment outcomes or unmatched demanded skills, and matters less when ${inst.shortNameEn}'s current skill set is already landing strong outcomes. When either channel is "data not available," argue from skill coverage alone and say so — do not imply an outcomes/demand signal you were not given.`;

    const outcomesLine = input.graduateOutcomes
      ? `Survey year ${input.graduateOutcomes.surveyYear}: employment rate ${input.graduateOutcomes.employmentRatePct.toFixed(1)}%, average salary ${input.graduateOutcomes.averageSalaryThb === null ? 'n/d' : `THB ${input.graduateOutcomes.averageSalaryThb.toFixed(0)}`}, sample size ${input.graduateOutcomes.sampleSize}`
      : 'data not available';
    const demandLine = input.kmitlDemandMatch
      ? `Matched ${input.kmitlDemandMatch.matchedDemanded} of ${input.kmitlDemandMatch.relevantDemanded} relevant demanded skills. Top unmatched: ${input.kmitlDemandMatch.topUnmatchedSkills.length > 0 ? input.kmitlDemandMatch.topUnmatchedSkills.join(', ') : 'none'}`
      : 'data not available';

    const user = `[Program] ${input.programName.en} / ${input.programName.th}
[${inst.shortNameEn} skills]
${input.kkuSkills.map((s) => `- ${s.nameEn} / ${s.nameTh}`).join('\n')}

[Peer skill coverage — how many peer institutions teach each]
${input.peerSkillCoverage.map((s) => `- ${s.nameEn} / ${s.nameTh} (${s.peerCount} peers)`).join('\n')}

[Peer institutions]
${input.peerInstitutions.join(', ')}

[Graduate outcomes]
${outcomesLine}

[Labour-market demand match]
${demandLine}

Return the JSON.`;
    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
  }

  if (input.mode === 'distinctiveness') {
    const system = `${systemBase}

Match this output:
{
  "mode": "distinctiveness",
  "result": {
    "programId": "...",
    "distinctivenessScore": 0-100,
    "narrative": "<2-3 paragraph narrative>",
    "uniqueStrengths": ["..."],
    "undifferentiatedAreas": ["..."],
    "recommendation": "<one paragraph>",
    "confidence": 0.0-1.0
  }
}

A low score (say <30) means the program is undifferentiated — don't dress it up. A Council member needs to hear "you're teaching the same thing as 5 peers; consider reshape or reposition" if that's the truth.`;

    const user = `[Program] ${input.programName.en} / ${input.programName.th}
[Engine distinctiveness score] ${input.distinctivenessScore}/100
[Unique ${inst.shortNameEn} skills vs peers] ${input.distinctiveSkills.map((s) => `${s.nameEn}`).join(', ')}
[Shared skills + peer count] ${input.sharedSkills.map((s) => `${s.nameEn}×${s.count}`).join(', ')}
[Peer set] ${input.peerSetName}

Return the JSON.`;
    return [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ];
  }

  // positioning-brief
  const system = `${systemBase}

Match this output:
{
  "mode": "positioning-brief",
  "result": {
    "subjectArea": "...",
    "narrative": "<300-500 words>",
    "kkuStrategicPosition": "<one paragraph>",
    "rivalsToWatch": ["..."],
    "opportunities": ["..."],
    "threats": ["..."],
    "confidence": 0.0-1.0
  }
}

Council-facing. Acknowledge data gaps where relevant. Avoid hype — Council members notice.`;

  const user = `[Subject area] ${input.subjectArea}
[${inst.shortNameEn} program count] ${input.kkuProgramCount}
[Peer program count] ${input.peerProgramCount}
[${inst.shortNameEn} latest percentile] ${input.kkuPercentileLatest ?? 'n/a'}

[Ranking trends]
${input.rankingTrends.map((r) => `- ${r.institution} (${r.source}): ${r.trend}, latest rank ${r.latestRank}`).join('\n')}

Return the JSON.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// suggest-peers consumes:
//   - programName / subjectArea / programLevel / existingPeerInstitutions
//     — Program row + PeerProgram.institution distinct list
//     (benchmarking.controller.ts's suggestPeers handler).
//   Omitted, with reason: KKU skill list — this mode proposes institutions
//   to compare against, not a curriculum judgement; curriculum-gap is
//   where skill-level detail belongs.
//
// curriculum-gap consumes:
//   - kkuSkills / peerSkillCoverage / peerInstitutions — computeProgramPeers()
//     (@kku/db benchmarking.ts) peer set + skill overlap.
//   - graduateOutcomes — NEW in v2: latest GraduateOutcome row for the
//     program (realDataWhere()-filtered), the same source
//     program-strategic-narrative-run.ts's GRADUATE OUTCOMES channel uses.
//   - kmitlDemandMatch — NEW in v2: ProgramDemandMatch rows where
//     relevant=true (realDataWhere()-filtered), the same source
//     program-strategic-narrative-run.ts's LABOUR-MARKET DEMAND channel
//     and health-score.ts's scoreRelevanceProgram() driver use.
//   Omitted, with reason: peer curriculum structure (credits, capstone) —
//   peers don't publish this uniformly; skill-coverage is the documented
//   v1 substitute (see prompt 10's session notes in CLAUDE.md).
//
// distinctiveness consumes:
//   - distinctivenessScore / distinctiveSkills / sharedSkills / peerSetName
//     — computeDistinctiveness() (@kku/db benchmarking.ts).
//   Omitted, with reason: outcomes/demand — this mode answers "how unique
//   is this curriculum," a comparative-uniqueness question, not a
//   labour-market-fit question; mixing them would blur which axis a
//   Council reader should act on. curriculum-gap is the mode that
//   combines skill coverage with outcomes/demand.
//
// positioning-brief consumes:
//   - rankingTrends / kkuPercentileLatest / program counts —
//     computeSubjectLeadership() (@kku/db benchmarking.ts), THE/QS/SCImago
//     rankings (mocked connectors as of this bump).
//   Omitted, with reason: per-program skill detail — this is a
//   subject-area-level brief, not a per-program one.
// ─────────────────────────────────────────────────────────────────────────────
