import { z } from 'zod';
import type { AiMessage } from '../types';

// ─────────────────────────────────────────────────────────────────────────────
// program-strategic-narrative.v1
//
// Produces an OFFICIAL-FORMAT markdown brief intended for KKU Council
// decision review. Pre-computed during the per-program pipeline (NOT
// regenerated on-demand) so the Deep-Dive UI shows it immediately on
// page load.
//
// Hard rules:
//   - No greetings ("Dear Council", "To whom it may concern")
//   - No closings ("Hope this helps", "Best regards")
//   - No filler / pleasantries — every sentence must carry information
//   - Markdown structure with ## headers, bullet lists, and concise prose
//   - Total length: 250-400 words, capped — Council readers don't have
//     time for verbose narratives
//   - Numbers cited from the input snapshot, not invented
//
// Pro thinking model is appropriate here — this is reasoning + concise
// official-document drafting, not extraction.
// ─────────────────────────────────────────────────────────────────────────────

export const PROGRAM_STRATEGIC_NARRATIVE_VERSION = 'program-strategic-narrative.v1';

export const ProgramStrategicNarrativeSchema = z.object({
  /** Markdown content — must follow the structural template in the
   *  system prompt (## Executive summary / ## Strategic position /
   *  ## Critical risks / ## Opportunities / ## Recommended actions). */
  contentMarkdown: z.string().min(200).max(4000),
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
}

export function buildProgramStrategicNarrativeMessages(
  input: ProgramStrategicNarrativeInput,
): AiMessage[] {
  const system = `You are drafting an OFFICIAL strategic brief for KKU's University Council on one academic program. The brief is read in advance of decision meetings — it must inform, not entertain. Every sentence must carry information.

HARD CONSTRAINTS:
1. **No greetings, no closings.** Do not write "Dear Council", "To whom it may concern", "Hope this helps", "Best regards", or anything similar. Start with the first markdown header. End with the last bullet.
2. **No filler.** Forbidden phrases include "It is important to note", "We are pleased to report", "Going forward", "In conclusion", "As you know", "We recommend that you consider".
3. **Numbers come from the input snapshot only.** Never invent or estimate.
4. **Output length: 250-400 words total.** Keep prose tight; Council readers don't have time.
5. **Use markdown:** ## headers for sections, - for bullet lists, **bold** for key figures.

REQUIRED STRUCTURE (in this order, all five headers required):

## Executive summary
Single sentence — the program's current strategic position in plain language. Cite the lifecycle verdict + trajectory score if available.

## Strategic position
3-4 bullets. Each bullet is a factual observation citing a specific number (health dimension, TCAS competition ratio, financial figure, AI readiness sub-score, etc.).

## Critical risks
2-4 bullets. Each names a SPECIFIC risk + the metric that flags it. Forbidden: vague risks like "external factors" or "future uncertainty".

## Opportunities
2-3 bullets. Each names a concrete opportunity grounded in a metric or peer comparison. Forbidden: aspirational platitudes.

## Recommended actions
3-5 numbered items, priority-ordered (1 = most urgent). Each item is one sentence in imperative voice (e.g. "Embed a mandatory ML course before the BE 2570 admissions cycle"). Include a horizon (months) and the expected outcome.

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
  }
  if (input.health) {
    blocks.push(`HEALTH SCORE (v3.0, ${input.health.completenessPct.toFixed(0)}% data)
  Overall:         ${fmt(input.health.overallScore)}
  Attractiveness:  ${fmt(input.health.attractiveness)}
  Financial:       ${fmt(input.health.financial)}
  Capability:      ${fmt(input.health.capability)}
  Outcomes:        ${fmt(input.health.outcomes)}
  Relevance:       ${fmt(input.health.relevance)}`);
  }
  if (input.aiReadiness) {
    blocks.push(`AI READINESS (v1)
  Overall:                 ${input.aiReadiness.overallScore.toFixed(0)} / 100
  Curriculum integration:  ${input.aiReadiness.curriculumIntegration.toFixed(0)}
  Skill resilience:        ${input.aiReadiness.skillResilience.toFixed(0)}
  Research presence:       ${input.aiReadiness.researchPresence.toFixed(0)}
  AI-native skills:        ${input.aiReadiness.aiSkillCount} of ${input.aiReadiness.totalSkills}`);
  }
  if (input.tcas) {
    blocks.push(`TCAS3 ADMISSIONS (BE ${input.tcas.latestYearBE})
  Competition ratio:  ${input.tcas.competitionRatio.toFixed(2)}x
  Fill rate:          ${(input.tcas.fillRate * 100).toFixed(1)}%
  Min admission:      ${fmt(input.tcas.minScore, '', 2)}`);
  }
  if (input.financial) {
    blocks.push(`FINANCIAL (FY ${input.financial.fiscalYear})
  Tuition revenue:           THB ${fmtInt(input.financial.tuitionRevenueThb)}
  Net contrib / student:     THB ${fmtInt(input.financial.netContributionPerStudent)}
  Government salary subsidy: THB ${fmtInt(input.financial.governmentFacultySubsidyThb)} / yr`);
  }
  if (input.demand) {
    blocks.push(`DEMAND FUNNEL (anchor cohort BE ${input.demand.anchorEntryYearBE})
  Admitted:        ${input.demand.admittedTotal}
  Enrolled:        ${input.demand.enrolled}
  Graduated:       ${input.demand.graduated}
  Dropped:         ${input.demand.droppedTotal}
  Still enrolled:  ${input.demand.stillEnrolled}`);
  }
  if (input.demographic) {
    blocks.push(`DEMOGRAPHIC OUTLOOK (${input.demographic.regionLabel})
  +10y required share:       ${input.demographic.requiredShareAt10Y === null ? 'n/d' : (input.demographic.requiredShareAt10Y * 100).toFixed(3) + '%'}
  +15y cohort contraction:   ${input.demographic.fifteenYearContractionPct.toFixed(1)}%
  Risk level:                ${input.demographic.riskLevel}`);
  }
  if (input.peerReview) {
    blocks.push(`AI PEER REVIEW
  Content modernity:         ${input.peerReview.contentModernityVerdict ?? 'n/d'}
  Top strength claim:        ${input.peerReview.topStrength}
  Top weakness claim:        ${input.peerReview.topWeakness}
  Subject benchmark summary: ${input.peerReview.subjectBenchmarkSummary}`);
  }

  const user = `${blocks.join('\n\n')}

Draft the strategic brief now. Return JSON exactly as specified above.`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: user },
  ];
}
