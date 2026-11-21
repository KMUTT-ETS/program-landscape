// Lifecycle verdict — shared types.
//
// `ProgramLifecycleVerdict` itself is a Prisma enum (the snapshot table uses
// it as a column type); consumers import it from `@kku/db` via the wildcard
// re-export of `@prisma/client`.

import type { ProgramLifecycleVerdict } from '@prisma/client';
import type { HealthScoreRow } from '../health-score';
import type { DemographicRiskLevel, ProgramAiReadiness } from '../program-deep-dive';

export interface ProgramLifecycleDriver {
  label: string;
  /** Signed contribution to the trajectory score, -25 to +25. */
  contribution: number;
  raw: unknown;
}

/** One of the modifier gates that can downgrade (never upgrade) the
 *  trajectory-score-based verdict (gap #8 closure). The presence of
 *  `gatesApplied[]` entries means the verdict reflects an institutional
 *  position, not just the trajectory math. */
export interface LifecycleGateEffect {
  /** Stable identifier — UI + analytics group by this. */
  name:
    | 'oldSchoolContentCap'
    | 'aiReadinessStableCap'
    | 'aiReadinessFrontierCap'
    | 'lowLabourMarketAlignmentStableCap'
    | 'lowLabourMarketAlignmentFrontierCap'
    | 'lowRevenuePotentialFrontierCap';
  /** Verdict before this gate fired (the counterfactual at this step). */
  from: ProgramLifecycleVerdict;
  /** Verdict after this gate fired. */
  to: ProgramLifecycleVerdict;
  /** Council-readable explanation of why this gate caps the verdict. */
  reason: string;
}

export interface ProgramLifecycleResult {
  /** Final verdict after all modifier gates have been applied. This is
   *  what surfaces on cockpit + Deep-Dive + Council Pack. */
  verdict: ProgramLifecycleVerdict;
  /** Counterfactual (gap #8): the verdict produced by trajectory score
   *  alone, with the modifier gates skipped. Equals `verdict` when no
   *  gate fired. Surfaces in the lifecycle UI's "if gates were off" view
   *  so Council readers can see the gate's effect, even though the
   *  institutional position remains the gated value. */
  ungatedVerdict: ProgramLifecycleVerdict;
  /** Trajectory score, 0-100. Derived from weighted sum of drivers. */
  trajectoryScore: number;
  /** Drivers ordered by absolute contribution magnitude. */
  drivers: ProgramLifecycleDriver[];
  /** Modifier gates that fired (in application order). Empty when the
   *  trajectory-score-based verdict survived unchanged. */
  gatesApplied: LifecycleGateEffect[];
  /** 2-3 sentence rule-based narrative explaining the verdict. When any
   *  gate fired, mentions the gate's effect explicitly so the reader
   *  sees both the gated verdict and the counterfactual. */
  narrative: string;
  methodologyVersion: string;
  generatedAt: string;
}

/** Everything the lifecycle formula reads, already fetched. `load.ts`
 *  builds this from the database; `compute.ts` turns it into a result
 *  without touching the database. */
export interface LifecycleInputs {
  health: HealthScoreRow | null;
  aiReadiness: Pick<ProgramAiReadiness, 'overallScore'> & {
    subScores: Pick<
      ProgramAiReadiness['subScores'],
      'curriculumIntegration' | 'skillResilience' | 'researchPresence'
    >;
  };
  /** The peer review's payload; null when no review has run. */
  peerReview: {
    contentModernity?: { verdict: string };
    contentGaps?: Array<{ severity: string }>;
  } | null;
  /** Whether the AI peer selection has run (drives a narrative hint). */
  hasPeerSelection: boolean;
  cohorts: { totalActive: number; delayedCount: number };
  demographicRiskLevel: DemographicRiskLevel | null;
  level: string | null;
  /** Latest complete-year annual tuition revenue, THB (see load.ts). */
  latestAnnualRevenueThb: number | null;
  latestRevenueFiscalYear: number | null;
}
