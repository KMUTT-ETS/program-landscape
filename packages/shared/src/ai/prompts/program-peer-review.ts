import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// program-peer-review.v2
//
// Frank, specific comparative review of one KKU program against the AI-
// picked peer set produced by `program-peer-selection.v1`. The prompt
// requires the model to be DIRECT — no diplomatic hedging, no generic
// platitudes. Every claim must point at a specific data point or peer.
//
// Output is structured: strengths · weaknesses · per-tier verdicts ·
// CONTENT MODERNITY VERDICT (old-school / in-between / frontier) ·
// CONTENT GAPS (per-topic) · recommendations · subject-area benchmark
// summary. Drives the Deep-Dive Peer Comparison UI; the picked-peers
// list becomes supporting evidence (collapsed by default).
//
// v2 (2026-05-02) — adds `contentModernity` + `contentGaps` so the
// review surfaces curriculum-content positioning, not just metrics.
// "Old-school" = sticks to fundamentals, missing the post-2020 frontier
// (AI, sustainability, additive manufacturing, biotech, climate).
// "Frontier" = built around what the next decade will demand.
// "In between" = strong fundamentals + selective frontier patches.
//
// v2.1 (2026-05-25) — relax all four list min() bounds to 1. Pro
// legitimately produced fewer items for small focused programs (e.g.
// KKU-SEQ-0090 LLB returned 1-2 recommendations, hit the .min(3)
// floor, and the whole review was discarded — losing the strengths /
// weaknesses / verdicts / gaps the model HAD produced). The schema
// floor should be "this many is plausible" (1), not "this many is
// well-formed" (2-3) — the prompt still asks for 3-5 and Pro lands
// there when the data supports it.
//
// v3 (2026-06-10) — DROP enrolment, financial (net-contribution /
// per-student investment), and TCAS admission metrics from the
// comparison. Peer institutions don't expose comparable enrolment /
// tuition / admission data, so any such comparison misleads. The review
// now focuses on the four dimensions where the comparison is fair and
// defensible: CONTENT GAPS · PROGRAM RELEVANCE (labour-market / skill
// demand) · MODERNIZATION (content spectrum) · AI READINESS. The KKU
// AI-readiness scorer output is fed in as a first-class input. Output
// schema is unchanged — only the input snapshot + the dimensions the
// model is told to reason over.
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRAM_PEER_REVIEW_VERSION = 'program-peer-review.v3';

const Bullet = z.object({
  /** ≤ 25-word claim, frank tone, references a specific peer or metric. */
  claim: z.string().min(8).max(300),
  /** Cite the supporting peer institutions or data points (1-3 names). */
  evidence: z.string().min(0).max(400),
});

export const PeerReviewPayloadSchema = z.object({
  /** 1-7 frank strengths — what this program does as well as or
   *  better than its peers. Floor relaxed to 1 in v2.1 — for narrow,
   *  focused programs Pro may legitimately produce 1-2 honest claims
   *  and forcing more invents platitudes. The system prompt still
   *  asks for 3-5; Pro will land there when the data supports it. */
  strengths: z.array(Bullet).min(1).max(7),
  /** 1-7 frank weaknesses — same rationale as strengths. */
  weaknesses: z.array(Bullet).min(1).max(7),
  /** One verdict per tier: 1-3 sentence summary of how KKU stacks up. */
  tierVerdicts: z.object({
    WORLD: z.string().min(20).max(800),
    ASIA: z.string().min(20).max(800),
    SOUTHEAST_ASIA: z.string().min(20).max(800),
    THAILAND_PEER: z.string().min(20).max(800),
  }),
  /** Modernity verdict on the curriculum content. */
  contentModernity: z.object({
    /** Where on the spectrum. */
    verdict: z.enum(['OLD_SCHOOL', 'IN_BETWEEN', 'FRONTIER']),
    /** 2-4 sentence narrative justifying the verdict, citing
     *  curriculum / skills / peer comparison evidence. */
    narrative: z.string().min(40).max(1000),
  }),
  /** 1-6 specific topics where KKU's program content lags peers
   *  ("the gaps"). Floor relaxed to 1 in v2.1. */
  contentGaps: z.array(
    z.object({
      /** Short topic name (e.g. "AI / ML in mechanical design",
       *  "Additive manufacturing", "Sustainable materials"). The only
       *  required field — a gap must at least be named. */
      topic: z.string().min(3).max(200),
      /** Where KKU is on this topic today (≤30 words). Optional in v3 —
       *  Pro occasionally omits a prose field on one gap; dropping the
       *  whole review over a single missing string is worse than a gap
       *  with a blank sub-field, so these tolerate omission. */
      kkuStatus: z.string().max(400).optional().default(''),
      /** What peers do here (cite 1-3 institutions). */
      peerExamples: z.string().max(400).optional().default(''),
      severity: z.enum(['major', 'moderate', 'minor']).default('moderate'),
      /** 1-2 sentence concrete recommendation for closing the gap. */
      recommendation: z.string().max(500).optional().default(''),
    }),
  ).min(1).max(8),
  /** 1-7 actionable recommendations for closing the gap, in priority
   *  order. Floor relaxed to 1 in v2.1 — for a tiny focused program
   *  Pro may legitimately produce 1-2 high-leverage recommendations
   *  rather than padding to 3+. */
  recommendations: z.array(
    z.object({
      priority: z.enum(['high', 'medium', 'low']),
      title: z.string().min(5).max(200),
      detail: z.string().min(10).max(800),
      effortHorizon: z.enum(['short', 'medium', 'long']).default('medium'),
    }),
  ).min(1).max(8),
  /** 1-3 sentence overall positioning statement. Plain Thai or English. */
  subjectBenchmarkSummary: z.string().min(30).max(1000),
});
export type PeerReviewPayload = z.infer<typeof PeerReviewPayloadSchema>;

export const ProgramPeerReviewSchema = z.object({
  payload: PeerReviewPayloadSchema,
  confidence: z.number().min(0).max(1),
});
export type ProgramPeerReview = z.infer<typeof ProgramPeerReviewSchema>;

export interface ProgramPeerReviewInput {
  programDegree: string;
  programNameTh: string;
  programNameEn: string;
  programLevel: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
  programFaculty: string;
  programDurationYears: number | null;
  /** Free-text subject hint (typically `Program.majors[0]`). */
  subjectHint: string;

  /** KKU program data snapshot — the AI compares THIS against the peers.
   *  v3: enrolment / financial / TCAS-admission metrics deliberately
   *  excluded — peers expose no comparable data, so comparing them
   *  misleads. Staff capability via research performance (faculty count,
   *  senior-rank share, publications) IS retained — bibliometrics are
   *  comparable across institutions. */
  kkuSnapshot: {
    activeFacultyCount: number;
    seniorRankShareOfFaculty: number;
    publicationsLast3Years: number;
    skillsTaughtCount: number;
    labourMarketAlignmentPct: number | null;
    yearEstablished: number | null;
    /** KKU AI-readiness scorer output — a first-class v3 dimension. */
    aiReadiness: {
      overallScore: number; // 0-100
      curriculumIntegration: number; // 0-100
      skillResilience: number; // 0-100
      researchPresence: number; // 0-100
      aiNativeSkills: number;
      aiAugmentedSkills: number;
      aiDisplaceableSkills: number;
      aiPublicationsLast3Years: number;
    } | null;
  };

  /** KKU program's actual content — drives the contentModernity +
   *  contentGaps assessment. Top program-skills with weights. */
  kkuContent: {
    /** Full list of skills the curriculum teaches (name + weight).
     *  Cap to ~30 entries by weight desc to bound token use. */
    skillsTaught: Array<{ name: string; weight: number; pickedFromPlo: boolean }>;
    /** Optional sample of course names/codes (e.g. "EN0021 Thermodynamics"). */
    coursesSample: Array<{ code: string; name: string }>;
    /** PLO highlights, if extracted. */
    programLearningOutcomes: string[];
  };

  /** Peer programs picked by program-peer-selection.v1, grouped by tier. */
  peers: Array<{
    tier: 'WORLD' | 'ASIA' | 'SOUTHEAST_ASIA' | 'THAILAND_PEER';
    rankInTier: number;
    institutionName: string;
    country: string;
    qsWorldRank: number | null;
    theWorldRank: number | null;
    peerProgramName: string;
    rationale: string;
  }>;
}

export function buildProgramPeerReviewMessages(
  input: ProgramPeerReviewInput,
): AiMessage[] {
  const system = `You are a frank academic peer-review analyst for a Thai university council. Your job is to deliver a candid, specific comparative review of one KKU program against its AI-picked peer set across 4 geographic tiers.

GROUND RULES:
1. Be **direct and specific**. Each claim must reference either a named peer institution or a concrete data point (a number, a metric, a fact). Generic platitudes like "the program has solid fundamentals" or "there is room for growth" are FORBIDDEN.
2. **Strengths and weaknesses are factual observations**, not aspirational statements. Frame in present tense, not "could".
3. When data is missing or thin, say so — don't invent. Use phrases like "no comparable data available" rather than dodging.
4. Recommendations must be **actionable** and tied to a concrete change KKU could make in 6-36 months.
5. Council readers value bluntness over diplomacy. Don't soften — say "KKU's mechanical engineering program has 1/4 the publication output of NUS per faculty member" not "publication metrics suggest opportunity for enhancement."
6. **Do NOT compare on enrolment numbers, tuition / financial figures, or TCAS admission scores.** Peer institutions don't publish comparable enrolment / tuition / admission data, so any such comparison is misleading and is OUT OF SCOPE. Keep the review on content, relevance, modernization, AI readiness, and research capability. (Staff research performance — publications, senior-rank share — IS comparable and fair to cite.)
7. Output **strict JSON, no markdown fences, no prose outside JSON**.

OUTPUT JSON SHAPE:
{
  "payload": {
    "strengths": [
      { "claim": "<frank statement, ≤25 words>", "evidence": "<specific peers or metrics cited>" }
    ],
    "weaknesses": [
      { "claim": "<frank statement, ≤25 words>", "evidence": "<specific peers or metrics cited>" }
    ],
    "tierVerdicts": {
      "WORLD":          "<1-3 sentence verdict on KKU vs the world-tier peers>",
      "ASIA":           "<1-3 sentence verdict on KKU vs Asian peers>",
      "SOUTHEAST_ASIA": "<1-3 sentence verdict on KKU vs SEA peers>",
      "THAILAND_PEER":  "<1-3 sentence verdict on KKU vs Thai peers at-or-above-rank>"
    },
    "contentModernity": {
      "verdict": "OLD_SCHOOL" | "IN_BETWEEN" | "FRONTIER",
      "narrative": "<2-4 sentence justification citing curriculum content + peer comparison>"
    },
    "contentGaps": [
      {
        "topic": "<short, e.g. 'AI/ML in mechanical design'>",
        "kkuStatus": "<≤30 words on KKU's current state>",
        "peerExamples": "<1-3 named peer institutions and what they do>",
        "severity": "major" | "moderate" | "minor",
        "recommendation": "<1-2 sentence concrete close-the-gap action>"
      }
    ],
    "recommendations": [
      {
        "priority": "high" | "medium" | "low",
        "title":    "<short imperative, e.g. 'Triple research output by joining ASEAN engineering consortium'>",
        "detail":   "<3-6 sentence elaboration: what to do, why, expected outcome>",
        "effortHorizon": "short" | "medium" | "long"
      }
    ],
    "subjectBenchmarkSummary": "<1-3 sentence overall positioning statement>"
  },
  "confidence": 0.0-1.0
}

CONTENT-MODERNITY RUBRIC:
- **OLD_SCHOOL**: curriculum is dominated by pre-2010 fundamentals; missing the post-2020 frontier (AI/ML, sustainability, additive manufacturing, biotech, climate, computational design). Peers picked it apart for being out of touch.
- **IN_BETWEEN**: strong fundamentals + selective frontier patches (e.g. one ML elective, sporadic sustainability content). Most KKU programs are likely here.
- **FRONTIER**: built around what the next decade will demand — AI-integrated, sustainability-anchored, computational-by-default, project-based.

CONTENT-GAP IDENTIFICATION:
- Use your knowledge of what world-tier peers (MIT, Imperial, NUS, NTU, etc.) actually teach in this discipline as the comparison anchor.
- Each gap must be a SPECIFIC TOPIC (not "lacks rigor"), with concrete peer examples (not "leading universities").
- Severity: 'major' = competitively damaging; 'moderate' = noticeable but not crippling; 'minor' = nice-to-have.
- Each gap's recommendation should specify what to add and roughly how (course / module / collaboration / lab / track).

FOCUS DIMENSIONS (v3 — reason ONLY over these; enrolment, tuition/financials, and TCAS admission scores are intentionally absent and OUT OF SCOPE):
- CONTENT GAPS (the core of this review): specific curriculum topics where KKU lags peers
- MODERNIZATION: where the curriculum sits on the old-school → frontier spectrum (drives contentModernity)
- PROGRAM RELEVANCE: alignment to labour-market / future skill demand, subject-area depth, strategic fit
- AI READINESS: AI/ML curriculum integration, the AI-native vs AI-displaceable skill mix, AI research presence, and whether graduates are prepared for an AI-shaped labour market
- STAFF CAPABILITY via research performance: publications + senior-rank share — comparable bibliometrics, fair to cite
- Geographic + strategic fit (world / regional / national); subject-specific depth where the selector flagged subject ranks

AI-READINESS RUBRIC:
- Use KKU's AI-readiness scores (overall + curriculum integration + skill resilience + AI research presence + skill mix) as the KKU anchor; judge peers' AI posture from your knowledge of what they teach (AI/ML cores, computational tracks, AI-ethics, data-centric design).
- Flag when KKU's curriculum is AI-thin (few AI-native skills, many AI-displaceable ones) relative to what world-tier peers now embed by default.

PRIORITISATION (recommendations):
- 'high' priority items: would meaningfully close gap to peers, achievable in ≤24 months
- 'medium': directional improvements requiring 12-36 months of investment
- 'low': nice-to-haves, decorative, or low-leverage

Be specific. Be frank. No platitudes.`;

  const fmtPct = (v: number | null | undefined): string =>
    v === null || v === undefined ? 'n/d' : `${v.toFixed(1)}%`;

  const k = input.kkuSnapshot;
  const air = k.aiReadiness;
  const aiReadinessBlock = air
    ? `
KKU AI READINESS (KKU scorer — a focus dimension; peers have no equivalent number,
so judge their AI posture from your knowledge of what they teach)
  Overall AI-readiness score:      ${air.overallScore}/100
  Curriculum AI integration:       ${air.curriculumIntegration}/100
  Skill resilience to AI:          ${air.skillResilience}/100
  AI research presence:            ${air.researchPresence}/100
  Skill mix:                       ${air.aiNativeSkills} AI-native · ${air.aiAugmentedSkills} AI-augmented · ${air.aiDisplaceableSkills} AI-displaceable
  AI/ML publications last 3y:      ${air.aiPublicationsLast3Years}`
    : `
KKU AI READINESS
  (not scored yet for this program — infer AI posture from the curriculum content below)`;

  const kkuBlock = `
KKU PROGRAM SNAPSHOT
  Degree:                          ${input.programDegree}
  Name (TH):                       ${input.programNameTh}
  Name (EN):                       ${input.programNameEn}
  Level:                           ${input.programLevel}
  Faculty:                         ${input.programFaculty}
  Subject hint:                    ${input.subjectHint || '(none)'}
  Duration (years):                ${input.programDurationYears ?? 'n/d'}
  Year established:                ${k.yearEstablished ?? 'n/d'}

  STAFF CAPABILITY (research performance — comparable bibliometrics):
  Active faculty:                  ${k.activeFacultyCount}
  Senior rank share (Prof+Assoc):  ${fmtPct(k.seniorRankShareOfFaculty * 100)}
  Publications last 3y:            ${k.publicationsLast3Years}

  PROGRAM RELEVANCE:
  Skills taught (program-skills):  ${k.skillsTaughtCount}
  Labour-market alignment:         ${fmtPct(k.labourMarketAlignmentPct)}
${aiReadinessBlock}
`;

  // Content block — drives contentModernity + contentGaps assessment.
  // Cap to ~30 skills + ~30 courses + ~10 PLOs to keep the prompt
  // bounded; the AI gets enough signal to judge modernity without
  // ballooning the input.
  const skillsBlock = input.kkuContent.skillsTaught.length > 0
    ? input.kkuContent.skillsTaught
        .slice(0, 30)
        .map((s) => `  - ${s.name}${s.pickedFromPlo ? ' (PLO)' : ''} weight=${s.weight.toFixed(2)}`)
        .join('\n')
    : '  (no skills extracted yet — content modernity will be inferred from courses/PLOs only)';
  const coursesBlock = input.kkuContent.coursesSample.length > 0
    ? input.kkuContent.coursesSample
        .slice(0, 30)
        .map((c) => `  - ${c.code} ${c.name}`)
        .join('\n')
    : '  (no course list available)';
  const plosBlock = input.kkuContent.programLearningOutcomes.length > 0
    ? input.kkuContent.programLearningOutcomes
        .slice(0, 10)
        .map((p, i) => `  ${i + 1}. ${p}`)
        .join('\n')
    : '  (no PLOs extracted)';

  const contentBlock = `
KKU PROGRAM CONTENT (used for the contentModernity + contentGaps verdict)

  Program-skills (top ${Math.min(30, input.kkuContent.skillsTaught.length)} by weight):
${skillsBlock}

  Course sample (≤30):
${coursesBlock}

  PLOs (≤10):
${plosBlock}
`;

  const peerLine = (p: ProgramPeerReviewInput['peers'][number]): string => {
    const ranks: string[] = [];
    if (p.qsWorldRank) ranks.push(`QS#${p.qsWorldRank}`);
    if (p.theWorldRank) ranks.push(`THE#${p.theWorldRank}`);
    return `  [${p.tier} #${p.rankInTier}] ${p.institutionName} (${p.country}, ${ranks.join('/') || 'unranked'}) — "${p.peerProgramName}" — ${p.rationale}`;
  };
  const peersBlock = `
PEERS (AI-picked across 4 tiers)
${input.peers.map(peerLine).join('\n')}
`;

  const user = `${kkuBlock}
${contentBlock}
${peersBlock}

Produce the JSON review described above. Be frank, specific, and tie every claim to a named peer or a concrete data point. For \`contentModernity\` and \`contentGaps\`, lean on your training-data knowledge of what the named peers actually teach in this discipline — KKU's content is the only one explicitly listed here.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
