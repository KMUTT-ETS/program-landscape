import { z } from 'zod';
import type { AiMessage } from '../types';

// ═════════════════════════════════════════════════════════════════════
// Benchmarking insights (prompt 10)
//
// Four modes:
//   1. suggest-peers       — AI proposes additional peers for a KKU
//      program given subject + country + ranking context.
//   2. curriculum-gap      — narrative comparing KKU program's skill
//      coverage against peer set's aggregate coverage.
//   3. distinctiveness     — Thai explanation of what makes this program
//      unique in the peer set (or whether it's undifferentiated).
//   4. positioning-brief   — 1-page Thai competitive-positioning note
//      for a subject area.
// ═════════════════════════════════════════════════════════════════════

export const BENCHMARKING_INSIGHTS_VERSION = 'benchmarking-insights.v1';

// ── Output schemas ───────────────────────────────────────────────────
const PeerSuggestionSchema = z.object({
  institution: z.string(),
  country: z.string(),
  subjectArea: z.string(),
  programLevel: z.string(),
  rationaleTh: z.string(),
  confidence: z.number().min(0).max(1),
});

const CurriculumGapSchema = z.object({
  programId: z.string(),
  whatPeersHaveTh: z.array(z.string()),
  whatKkuHasTh: z.array(z.string()),
  bridgingOpportunitiesTh: z.array(
    z.object({
      titleTh: z.string(),
      rationaleTh: z.string(),
      urgency: z.enum(['low', 'medium', 'high']),
    }),
  ),
  summaryTh: z.string(),
  confidence: z.number().min(0).max(1),
});

const DistinctivenessNarrativeSchema = z.object({
  programId: z.string(),
  distinctivenessScore: z.number().min(0).max(100),
  narrativeTh: z.string(),
  uniqueStrengthsTh: z.array(z.string()),
  undifferentiatedAreasTh: z.array(z.string()),
  recommendationTh: z.string(),
  confidence: z.number().min(0).max(1),
});

const PositioningBriefSchema = z.object({
  subjectArea: z.string(),
  narrativeTh: z.string(), // 300–500 Thai words
  kkuStrategicPositionTh: z.string(),
  rivalsToWatchTh: z.array(z.string()),
  opportunitiesTh: z.array(z.string()),
  threatsTh: z.array(z.string()),
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

export interface CurriculumGapInput {
  mode: 'curriculum-gap';
  programId: string;
  programName: { en: string; th: string };
  kkuSkills: Array<{ nameEn: string; nameTh: string }>;
  peerSkillCoverage: Array<{ nameEn: string; nameTh: string; peerCount: number }>;
  peerInstitutions: string[];
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
  const systemBase = `You are a strategic benchmarking advisor for Khon Kaen University. Output STRICT JSON (no prose, no markdown fences). All user-facing text fields (titleTh, rationaleTh, narrativeTh, summaryTh) are natural Thai prose, not machine translation.`;

  if (input.mode === 'suggest-peers') {
    const system = `${systemBase}

Match this output:
{
  "mode": "suggest-peers",
  "suggestions": [
    { "institution": "...", "country": "...", "subjectArea": "...", "programLevel": "BACHELOR|MASTER|DOCTORAL", "rationaleTh": "<why this peer>", "confidence": 0.0-1.0 }
  ],
  "confidence": 0.0-1.0
}

Rubric: propose 3–6 peers not in existingPeerInstitutions. Match region constraint. Prefer peers with comparable subject focus + program level. Do NOT invent institutions you don't know.`;

    const user = `[KKU program] ${input.programName.en} / ${input.programName.th} (level: ${input.programLevel})
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
    "whatPeersHaveTh": ["..."],
    "whatKkuHasTh": ["..."],
    "bridgingOpportunitiesTh": [
      { "titleTh": "...", "rationaleTh": "...", "urgency": "low|medium|high" }
    ],
    "summaryTh": "<2-3 sentence Thai summary>",
    "confidence": 0.0-1.0
  }
}

Focus on concrete, actionable gaps. Urgency "high" only for skills with strong peer consensus (>half the peers teach it) that KKU lacks.`;

    const user = `[Program] ${input.programName.en} / ${input.programName.th}
[KKU skills]
${input.kkuSkills.map((s) => `- ${s.nameEn} / ${s.nameTh}`).join('\n')}

[Peer skill coverage — how many peer institutions teach each]
${input.peerSkillCoverage.map((s) => `- ${s.nameEn} / ${s.nameTh} (${s.peerCount} peers)`).join('\n')}

[Peer institutions]
${input.peerInstitutions.join(', ')}

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
    "narrativeTh": "<2-3 paragraph Thai narrative>",
    "uniqueStrengthsTh": ["..."],
    "undifferentiatedAreasTh": ["..."],
    "recommendationTh": "<one paragraph>",
    "confidence": 0.0-1.0
  }
}

A low score (say <30) means the program is undifferentiated — don't dress it up. A Council member needs to hear "you're teaching the same thing as 5 peers; consider reshape or reposition" if that's the truth.`;

    const user = `[Program] ${input.programName.en} / ${input.programName.th}
[Engine distinctiveness score] ${input.distinctivenessScore}/100
[Unique KKU skills vs peers] ${input.distinctiveSkills.map((s) => `${s.nameEn}`).join(', ')}
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
    "narrativeTh": "<300-500 Thai words>",
    "kkuStrategicPositionTh": "<one paragraph>",
    "rivalsToWatchTh": ["..."],
    "opportunitiesTh": ["..."],
    "threatsTh": ["..."],
    "confidence": 0.0-1.0
  }
}

Council-facing. Acknowledge data gaps where relevant. Avoid hype — Council members notice.`;

  const user = `[Subject area] ${input.subjectArea}
[KKU program count] ${input.kkuProgramCount}
[Peer program count] ${input.peerProgramCount}
[KKU latest percentile] ${input.kkuPercentileLatest ?? 'n/a'}

[Ranking trends]
${input.rankingTrends.map((r) => `- ${r.institution} (${r.source}): ${r.trend}, latest rank ${r.latestRank}`).join('\n')}

Return the JSON.`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
