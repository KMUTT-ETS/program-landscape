import { z } from 'zod';
import type { AiMessage } from '../types';
import { getInstitution } from '../../institution';

// ─────────────────────────────────────────────────────────────────────────────
// program-strategic-narrative.v3
//
// Produces an OFFICIAL-FORMAT markdown brief intended for KKU Council
// decision review. Pre-computed during the per-program pipeline (NOT
// regenerated on-demand) so the Deep-Dive UI shows it immediately on
// page load.
//
// v2 (2026-08-16, docs/prompt-standard.md): widens the input snapshot with
// five channels the platform now holds (graduate outcomes, labour-market
// demand match, trend signals, risk overlay, cohort progression — see
// CHANNEL MANIFEST below), flips output to English, and adds the standard's
// confidence rubric + AI-tell ban + grounding rules. v1 never saw an
// employment rate; this was the audit's #1 finding
// (docs/superpowers/notes/2026-08-16-prompt-audit.md).
//
// v3 (2026-11-03): the demographic region label sent to the model is the
// organisation's own region ("<region> Thailand", or "Thailand" when none is
// set) instead of a KKU-only "Northeast" branch. Prompt text unchanged; the
// input it receives changes, so this is a behaviour change (see
// docs/prompt-standard.md, Versioning).
//
// Hard rules (kept verbatim from v1):
//   - No greetings ("Dear Council", "To whom it may concern")
//   - No closings ("Hope this helps", "Best regards")
//   - No filler / pleasantries — every sentence must carry information
//   - Markdown structure with ## headers, bullet lists, and concise prose
//   - Total length: 250-400 words, capped — Council readers don't have
//     time for verbose narratives
//   - Numbers cited from the input snapshot, not invented
//
// New in v2 (docs/prompt-standard.md):
//   - Write in English (analysis output is English-only; TH/EN identity
//     fields on the input, e.g. programNameTh, are data labels, not
//     analysis prose, and stay TH — see the standard's Language section).
//   - CONFIDENCE RUBRIC block — graded bands, not a bare 0-1 field.
//   - BANNED PHRASES block — removes AI writing tells; the terse register
//     this brief already used is kept.
//   - Grounding: missing channels render "data not available" and must be
//     named in Critical risks when material; causal claims are hedged as
//     hypotheses ("consistent with"), never asserted as bare "because".
//   - "## Data gaps" line required when 2+ channels are null.
//
// Pro thinking model is appropriate here — this is reasoning + concise
// official-document drafting, not extraction.
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRAM_STRATEGIC_NARRATIVE_VERSION = 'program-strategic-narrative.v3';

export const ProgramStrategicNarrativeSchema = z.object({
  /** Markdown content — must follow the structural template in the
   *  system prompt (## Executive summary / ## Strategic position /
   *  ## Critical risks / ## Opportunities / ## Recommended actions,
   *  plus an optional ## Data gaps line). */
  contentMarkdown: z.string().min(200).max(4500),
  confidence: z.number().min(0).max(1),
});
export type ProgramStrategicNarrative = z.infer<typeof ProgramStrategicNarrativeSchema>;

export interface ProgramStrategicNarrativeInput {
  programNameTh: string;
  programNameEn: string;
  programLevel: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
  programFaculty: string;
  programDurationYears: number | null;
  yearEstablished: number | null;
  /** Lifecycle verdict if available. */
  lifecycle: {
    verdict: 'SUNSET' | 'STABLE' | 'RISING' | 'FRONTIER';
    trajectoryScore: number;
  } | null;
  /** Health score overall + dimension scores. */
  health: {
    overallScore: number | null;
    attractiveness: number | null;
    financial: number | null;
    capability: number | null;
    outcomes: number | null;
    relevance: number | null;
    completenessPct: number;
  } | null;
  /** AI readiness composite + sub-scores. */
  aiReadiness: {
    overallScore: number;
    curriculumIntegration: number;
    skillResilience: number;
    researchPresence: number;
    aiSkillCount: number;
    totalSkills: number;
  } | null;
  /** TCAS3 latest year + competition signal. */
  tcas: {
    latestYearBE: number;
    competitionRatio: number;
    fillRate: number;
    minScore: number | null;
  } | null;
  /** Financial KPI summary. */
  financial: {
    fiscalYear: number;
    tuitionRevenueThb: number;
    netContributionPerStudent: number | null;
    governmentFacultySubsidyThb: number | null;
  } | null;
  /** Demand-funnel anchor cohort. */
  demand: {
    anchorEntryYearBE: number;
    admittedTotal: number;
    enrolled: number;
    graduated: number;
    droppedTotal: number;
    stillEnrolled: number;
  } | null;
  /** Demographic outlook for the program's catchment. */
  demographic: {
    regionLabel: string;
    requiredShareAt10Y: number | null;
    fifteenYearContractionPct: number;
    riskLevel: string;
  } | null;
  /** Peer review summary (if available). */
  peerReview: {
    contentModernityVerdict: 'OLD_SCHOOL' | 'IN_BETWEEN' | 'FRONTIER' | null;
    topStrength: string;
    topWeakness: string;
    subjectBenchmarkSummary: string;
  } | null;
  /** Latest graduate-outcome survey row (null = no survey data passes realDataWhere). */
  outcomes: {
    surveyYear: number;
    employmentRatePct: number | null;
    averageSalaryThb: number | null;
    furtherStudyRatePct: number | null;
    sampleSize: number;
  } | null;
  /** KMITL/LinkedIn demand alignment (null = no demand-match rows). */
  demandMatch: {
    matchedDemanded: number;
    relevantDemanded: number;
    topUnmatchedSkills: string[]; // ≤5
  } | null;
  /** Trend signals targeted at or affecting this program (≤5, newest first). */
  trendSignals: Array<{
    title: string;
    signalType: string;
    impactScorePct: number;
    recommendation: string;
  }>;
  /** Risk overlay summary (null = risk assessment not yet run). */
  risk: {
    compositeScore: number;
    topLikelihoodDriver: string;
    topImpactDimension: string;
  } | null;
  /** Cohort progression (null = no cohort links). */
  cohorts: {
    totalActive: number;
    delayedSharePct: number | null;
  } | null;
}

/**
 * Count how many of the 13 input channels are absent. The 12 nullable
 * object-shaped channels count as missing when `null`; `trendSignals`
 * (an array, not nullable) counts as missing when empty. `programme`
 * identity fields are always present and are not counted.
 *
 * This is the deterministic half of FIX 1 (see docs/prompt-standard.md
 * `## Confidence rubric`) — the model's self-reported confidence is a
 * floor-signal only; this function plus `narrativeConfidenceCeiling()`
 * enforce the rubric's bands mechanically rather than trusting the
 * model to grade itself against them.
 */
export function countMissingNarrativeChannels(input: ProgramStrategicNarrativeInput): number {
  const nullableChannels: unknown[] = [
    input.lifecycle,
    input.health,
    input.aiReadiness,
    input.tcas,
    input.financial,
    input.demand,
    input.demographic,
    input.peerReview,
    input.outcomes,
    input.demandMatch,
    input.risk,
    input.cohorts,
  ];
  const missingObjectChannels = nullableChannels.filter((c) => c === null).length;
  const missingTrendSignals = input.trendSignals.length === 0 ? 1 : 0;
  return missingObjectChannels + missingTrendSignals;
}

/**
 * Deterministic ceiling on self-reported confidence, enforcing the
 * rubric's bands mechanically. All channels weigh equally in v1 of this
 * clamp — materiality weighting is a future refinement, recorded in
 * docs/prompt-standard.md.
 *
 *   0 missing → 1.00 · 1 → 0.89 · 2–3 → 0.69 · 4–5 → 0.55 · 6+ → 0.49
 */
export function narrativeConfidenceCeiling(missingCount: number): number {
  if (missingCount <= 0) return 1.0;
  if (missingCount === 1) return 0.89;
  if (missingCount <= 3) return 0.69;
  if (missingCount <= 5) return 0.55;
  return 0.49;
}

export function buildProgramStrategicNarrativeMessages(
  input: ProgramStrategicNarrativeInput,
): AiMessage[] {
  const inst = getInstitution();
  const system = `You are drafting an OFFICIAL strategic brief for ${inst.shortNameEn}'s University Council on one academic program. The brief is read in advance of decision meetings — it must inform, not entertain. Every sentence must carry information.

HARD CONSTRAINTS:
1. **No greetings, no closings.** Do not write "Dear Council", "To whom it may concern", "Hope this helps", "Best regards", or anything similar. Start with the first markdown header. End with the last bullet.
2. **No filler.** Forbidden phrases include "It is important to note", "We are pleased to report", "Going forward", "In conclusion", "As you know", "We recommend that you consider".
3. **Numbers come from the input snapshot only.** Never invent or estimate.
4. **Output length: 250-400 words total.** Keep prose tight; Council readers don't have time.
5. **Use markdown:** ## headers for sections, - for bullet lists, **bold** for key figures.
6. **Write in English.** The brief is English-only analysis prose. Program names given in Thai (programNameTh) are data labels, not analysis — do not translate them, and do not write any other sentence in Thai.

GROUNDING RULES:
- A number in your output must be traceable to a value in the input snapshot below. Never assert a number you were not given.
- When a channel below is marked "data not available", do not guess or infer its value. If the missing channel is material to the program's strategic position (e.g. no graduate-outcome data for a program under enrollment pressure), name the gap explicitly in Critical risks or the Data gaps line — do not silently omit it.
- Causal claims are hypotheses, not facts, unless the input states the mechanism directly. Use "consistent with", "may reflect", or similar hedged language. Never write "because X" when the input only shows X and Y are both true — that is correlation dressed as causation.

CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95.

BANNED PHRASES (do not use these words/phrases or their close paraphrases):
- "delve"
- "leverage" (as a verb)
- "robust"
- "landscape" (in its metaphorical sense — "the competitive landscape" — not literal geography)
- "tapestry"
- "furthermore"
- "moreover"
- "it is important to note"
- "in today's rapidly evolving"
Also: do not open two bullets in the same section with the same sentence structure (e.g. every bullet starting "This program..."); do not force exactly three items in a list when the data supports two or four — list what the data supports.

REQUIRED STRUCTURE (in this order, all five headers required; add a sixth only when the Data gaps rule below triggers):

## Executive summary
Single sentence — the program's current strategic position in plain language. Cite the lifecycle verdict + trajectory score if available.

## Strategic position
3-4 bullets. Each bullet is a factual observation citing a specific number (health dimension, TCAS competition ratio, financial figure, AI readiness sub-score, graduate-outcome rate, demand-match coverage, etc.), with the source channel named when the same kind of number could plausibly come from more than one channel (e.g. distinguish a headcount from COHORT vs. from DEMAND FUNNEL).

## Critical risks
2-4 bullets. Each names a SPECIFIC risk + the metric that flags it. Forbidden: vague risks like "external factors" or "future uncertainty". When RISK data is available, ground at least one bullet in its top likelihood driver or impact dimension.

## Opportunities
2-3 bullets. Each names a concrete opportunity grounded in a metric, peer comparison, unmatched demanded skill, or trend signal. Forbidden: aspirational platitudes.

## Recommended actions
3-5 numbered items, priority-ordered (1 = most urgent). Each item is one sentence in imperative voice (e.g. "Embed a mandatory ML course before the BE 2570 admissions cycle"). Include a horizon (months) and the expected outcome.

## Data gaps
Required ONLY when 2 or more of the below channels are "data not available": PROGRAM, LIFECYCLE, HEALTH SCORE, AI READINESS, TCAS3 ADMISSIONS, FINANCIAL, DEMAND FUNNEL, DEMOGRAPHIC OUTLOOK, AI PEER REVIEW, GRADUATE OUTCOMES, LABOUR-MARKET DEMAND, TREND SIGNALS, RISK, COHORT. One line naming which channels are missing and what that limits about this brief. Omit this header entirely when fewer than 2 channels are missing.

OUTPUT JSON:
{
  "contentMarkdown": "<the markdown brief, no greetings, no closings>",
  "confidence": 0.0-1.0
}

No prose outside the JSON. No markdown fences around the JSON.`;

  const fmt = (v: number | null | undefined, suffix = '', digits = 1): string =>
    v === null || v === undefined ? 'n/d' : `${v.toFixed(digits)}${suffix}`;
  const fmtInt = (v: number | null | undefined): string =>
    v === null || v === undefined ? 'n/d' : Math.round(v).toLocaleString();

  const blocks: string[] = [];
  blocks.push(`PROGRAM
  Name (TH):       ${input.programNameTh}
  Name (EN):       ${input.programNameEn}
  Level:           ${input.programLevel}
  Faculty:         ${input.programFaculty}
  Duration:        ${input.programDurationYears ?? 'n/d'} years
  Established:     ${input.yearEstablished ?? 'n/d'}`);

  if (input.lifecycle) {
    blocks.push(`LIFECYCLE
  Verdict:         ${input.lifecycle.verdict}
  Trajectory:      ${input.lifecycle.trajectoryScore.toFixed(0)} / 100`);
  } else {
    blocks.push('LIFECYCLE: data not available');
  }
  if (input.health) {
    blocks.push(`HEALTH SCORE (v3.0, ${input.health.completenessPct.toFixed(0)}% data)
  Overall:         ${fmt(input.health.overallScore)}
  Attractiveness:  ${fmt(input.health.attractiveness)}
  Financial:       ${fmt(input.health.financial)}
  Capability:      ${fmt(input.health.capability)}
  Outcomes:        ${fmt(input.health.outcomes)}
  Relevance:       ${fmt(input.health.relevance)}`);
  } else {
    blocks.push('HEALTH SCORE: data not available');
  }
  if (input.aiReadiness) {
    blocks.push(`AI READINESS (v1)
  Overall:                 ${input.aiReadiness.overallScore.toFixed(0)} / 100
  Curriculum integration:  ${input.aiReadiness.curriculumIntegration.toFixed(0)}
  Skill resilience:        ${input.aiReadiness.skillResilience.toFixed(0)}
  Research presence:       ${input.aiReadiness.researchPresence.toFixed(0)}
  AI-native skills:        ${input.aiReadiness.aiSkillCount} of ${input.aiReadiness.totalSkills}`);
  } else {
    blocks.push('AI READINESS: data not available');
  }
  if (input.tcas) {
    blocks.push(`TCAS3 ADMISSIONS (BE ${input.tcas.latestYearBE})
  Competition ratio:  ${input.tcas.competitionRatio.toFixed(2)}x
  Fill rate:          ${(input.tcas.fillRate * 100).toFixed(1)}%
  Min admission:      ${fmt(input.tcas.minScore, '', 2)}`);
  } else {
    blocks.push('TCAS3 ADMISSIONS: data not available');
  }
  if (input.financial) {
    blocks.push(`FINANCIAL (FY ${input.financial.fiscalYear})
  Tuition revenue:           THB ${fmtInt(input.financial.tuitionRevenueThb)}
  Net contrib / student:     THB ${fmtInt(input.financial.netContributionPerStudent)}
  Government salary subsidy: THB ${fmtInt(input.financial.governmentFacultySubsidyThb)} / yr`);
  } else {
    blocks.push('FINANCIAL: data not available');
  }
  if (input.demand) {
    blocks.push(`DEMAND FUNNEL (anchor cohort BE ${input.demand.anchorEntryYearBE})
  Admitted:        ${input.demand.admittedTotal}
  Enrolled:        ${input.demand.enrolled}
  Graduated:       ${input.demand.graduated}
  Dropped:         ${input.demand.droppedTotal}
  Still enrolled:  ${input.demand.stillEnrolled}`);
  } else {
    blocks.push('DEMAND FUNNEL: data not available');
  }
  if (input.demographic) {
    blocks.push(`DEMOGRAPHIC OUTLOOK (${input.demographic.regionLabel})
  +10y required share:       ${input.demographic.requiredShareAt10Y === null ? 'n/d' : (input.demographic.requiredShareAt10Y * 100).toFixed(3) + '%'}
  +15y cohort contraction:   ${input.demographic.fifteenYearContractionPct.toFixed(1)}%
  Risk level:                ${input.demographic.riskLevel}`);
  } else {
    blocks.push('DEMOGRAPHIC OUTLOOK: data not available');
  }
  if (input.peerReview) {
    blocks.push(`AI PEER REVIEW
  Content modernity:         ${input.peerReview.contentModernityVerdict ?? 'n/d'}
  Top strength claim:        ${input.peerReview.topStrength}
  Top weakness claim:        ${input.peerReview.topWeakness}
  Subject benchmark summary: ${input.peerReview.subjectBenchmarkSummary}`);
  } else {
    blocks.push('AI PEER REVIEW: data not available');
  }

  if (input.outcomes) {
    blocks.push(`GRADUATE OUTCOMES (cohort graduation year ${input.outcomes.surveyYear})
  Employment rate:     ${fmt(input.outcomes.employmentRatePct, '%')}
  Average salary:      THB ${fmtInt(input.outcomes.averageSalaryThb)} / month
  Further study rate:  ${fmt(input.outcomes.furtherStudyRatePct, '%')}
  Sample size:         ${input.outcomes.sampleSize} respondents`);
  } else {
    blocks.push('GRADUATE OUTCOMES: data not available');
  }

  if (input.demandMatch) {
    const unmatchedList =
      input.demandMatch.topUnmatchedSkills.length > 0
        ? input.demandMatch.topUnmatchedSkills.join(', ')
        : 'none';
    blocks.push(`LABOUR-MARKET DEMAND (KMITL-hosted demand feed)
  Demanded skills matched:    ${input.demandMatch.matchedDemanded} of ${input.demandMatch.relevantDemanded} relevant
  Top unmatched demanded skills: ${unmatchedList}`);
  } else {
    blocks.push('LABOUR-MARKET DEMAND: data not available');
  }

  if (input.trendSignals.length > 0) {
    const rows = input.trendSignals
      .slice(0, 5)
      .map(
        (s, i) =>
          `  ${i + 1}. [${s.signalType}] ${s.title} — impact ${s.impactScorePct.toFixed(0)}%. Recommendation on file: ${s.recommendation}`,
      )
      .join('\n');
    blocks.push(`TREND SIGNALS (newest first, up to 5)\n${rows}`);
  } else {
    blocks.push('TREND SIGNALS: data not available');
  }

  if (input.risk) {
    blocks.push(`RISK (composite, risk-scoring methodology)
  Composite score:        ${input.risk.compositeScore.toFixed(0)} / 100
  Top likelihood driver:  ${input.risk.topLikelihoodDriver}
  Top impact dimension:   ${input.risk.topImpactDimension}`);
  } else {
    blocks.push('RISK: data not available');
  }

  if (input.cohorts) {
    blocks.push(`COHORT (currently-active students)
  Total active:      ${input.cohorts.totalActive}
  Delayed share:     ${fmt(input.cohorts.delayedSharePct, '%')}`);
  } else {
    blocks.push('COHORT: data not available');
  }

  const user = `${blocks.join('\n\n')}

Draft the strategic brief now. Return JSON exactly as specified above.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}

// ─────────────────────────────────────────────────────────────────────────────
// CHANNEL MANIFEST
//
// Consumed (14 blocks, each rendered as a labelled ALL-CAPS section; null
// channels render as "<CHANNEL>: data not available" rather than being
// dropped from the snapshot, so the model always sees the full channel list
// and can name gaps explicitly):
//   - PROGRAM            — Program identity + faculty (always present).
//   - LIFECYCLE           — programLifecycleVerdict() (@kku/db program-deep-dive.ts).
//   - HEALTH SCORE        — computeHealthScores('program', id) (@kku/db health-score.ts).
//   - AI READINESS        — programAiReadiness() (@kku/db program-deep-dive.ts).
//   - TCAS3 ADMISSIONS    — programTcasStats() latest year (@kku/db program-deep-dive.ts).
//   - FINANCIAL           — programFinancials() latest fiscal year (@kku/db program-deep-dive.ts).
//   - DEMAND FUNNEL       — programDemandFunnel() anchor cohort (@kku/db program-deep-dive.ts).
//   - DEMOGRAPHIC OUTLOOK — programDemographicOutlook() (@kku/db program-deep-dive.ts).
//   - AI PEER REVIEW      — ProgramPeerReview.payloadJson (Prisma, program-peer-review.v4 output).
//   - GRADUATE OUTCOMES   — programOutcomes() latest survey row (@kku/db program-deep-dive.ts).
//   - LABOUR-MARKET DEMAND — ProgramDemandMatch rows where relevant=true, the same
//     table + filter the health-score relevance driver reads (@kku/db health-score.ts
//     scoreRelevanceProgram()) — matched count over relevant count, plus up to 5
//     unmatched demanded skill names.
//   - TREND SIGNALS       — programTrends() (@kku/db program-deep-dive.ts), capped at 5,
//     targeted-at-program signals preferred over the recency fallback.
//   - RISK                — latest RiskAssessment row (Prisma, findFirst by assessedAt
//     desc) — composite score + the highest-scoring of the three likelihood drivers
//     (L1 recruitment / L2 AI-disruption / L3 demographic) + the larger of the two
//     impact dimensions (direct revenue at risk / stranded cost).
//   - COHORT              — programStudentCohorts() (@kku/db program-deep-dive.ts) —
//     totalActive + delayedCount share.
//
// Deliberately omitted, with reason:
//   - Course list (programCourses()) — too long for this prompt's context budget;
//     already digested into ProgramSkill coverage, which reaches the model
//     indirectly via HEALTH SCORE's capability/relevance dimensions and LABOUR-MARKET
//     DEMAND's matched-skill count. A course-by-course brief is a different prompt's job.
//   - Faculty roster (programFaculty()) — PII posture (this prompt has no
//     role-based visibility gating, unlike the Deep-Dive UI's own faculty section);
//     the capability health-score dimension already carries the faculty-strength
//     aggregate without naming individuals.
//   - Decision history (programDecisions()) — this brief informs a Council decision,
//     it is not itself a record of past decisions; prior CouncilDecision rows are a
//     separate Deep-Dive section, not narrative input.
// ─────────────────────────────────────────────────────────────────────────────
