// Trajectory score → verdict, then the modifier gates.
//
// The gates encode institutional positions the score alone can't: a gate can
// lower a verdict, never raise it. They run in the order of LIFECYCLE_GATES
// on the running verdict, so a FRONTIER one gate caps to RISING can still be
// capped to STABLE by a later one. A gate whose input is missing (null)
// never fires — we can't penalise data we don't have.
//
// Thresholds: ./tuning.ts (`verdict`, `gates`) and FLAGSHIP_REVENUE_FLOOR_THB
// in ../health-score/tuning.ts.

import type { ProgramLifecycleVerdict } from '@prisma/client';
import { FLAGSHIP_REVENUE_FLOOR_THB } from '../health-score/tuning';
import { LIFECYCLE_TUNING } from './tuning';
import type { LifecycleGateEffect } from './types';

const V = LIFECYCLE_TUNING.verdict;
const G = LIFECYCLE_TUNING.gates;

/** The verdict from the trajectory score alone. FRONTIER also requires the
 *  AI peer review to call the content FRONTIER; when the review hasn't run
 *  (null) it is treated as IN_BETWEEN. */
export function ungatedVerdict(
  score: number,
  modernityVerdict: string | null,
): ProgramLifecycleVerdict {
  if (score >= V.frontierAtLeast && modernityVerdict === 'FRONTIER') return 'FRONTIER';
  if (score >= V.risingAtLeast) return 'RISING';
  if (score >= V.stableAtLeast) return 'STABLE';
  return 'SUNSET';
}

/** What the gates read. */
export interface GateContext {
  aiReadiness: number;
  labourMarketScore: number | null;
  latestAnnualRevenueThb: number | null;
  modernityVerdict: string | null;
}

export interface LifecycleGate {
  name: LifecycleGateEffect['name'];
  /** Verdicts this gate can lower. */
  capFrom: readonly ProgramLifecycleVerdict[];
  /** The verdict it lowers them to. */
  capTo: ProgramLifecycleVerdict;
  fires(ctx: GateContext): boolean;
  /** Council-readable explanation, stored on the result. */
  reason(ctx: GateContext): string;
  /** Short name used in the narrative sentence. */
  shortLabel: string;
}

const RISING_OR_FRONTIER = ['RISING', 'FRONTIER'] as const;
const FRONTIER_ONLY = ['FRONTIER'] as const;
const floorM = (FLAGSHIP_REVENUE_FLOOR_THB / 1_000_000).toFixed(0);

export const LIFECYCLE_GATES: readonly LifecycleGate[] = [
  {
    // A curriculum out of touch with the field shouldn't be called "rising":
    // its trajectory is illusory until the content is refreshed.
    name: 'oldSchoolContentCap',
    capFrom: RISING_OR_FRONTIER,
    capTo: 'STABLE',
    fires: (c) => c.modernityVerdict === 'OLD_SCHOOL',
    reason: () =>
      'Peer-review content modernity verdict = OLD_SCHOOL; curriculum out of touch with the field caps the verdict at STABLE regardless of trajectory.',
    shortLabel: 'OLD_SCHOOL content cap',
  },
  {
    // The labour market punishes graduates whose programmes ignored AI.
    name: 'aiReadinessStableCap',
    capFrom: RISING_OR_FRONTIER,
    capTo: 'STABLE',
    fires: (c) => c.aiReadiness < G.aiReadinessStableBelow,
    reason: (c) =>
      `AI readiness ${c.aiReadiness.toFixed(0)}/100 < ${G.aiReadinessStableBelow} — program faces structural AI threat regardless of trajectory; caps verdict at STABLE.`,
    shortLabel: `AI readiness < ${G.aiReadinessStableBelow} (STABLE cap)`,
  },
  {
    name: 'aiReadinessFrontierCap',
    capFrom: FRONTIER_ONLY,
    capTo: 'RISING',
    fires: (c) => c.aiReadiness < G.aiReadinessFrontierBelow,
    reason: (c) =>
      `AI readiness ${c.aiReadiness.toFixed(0)}/100 < ${G.aiReadinessFrontierBelow} — FRONTIER label reserved for genuinely AI-integrated programs; caps at RISING.`,
    shortLabel: `AI readiness < ${G.aiReadinessFrontierBelow} (FRONTIER cap)`,
  },
  {
    // A program can't claim trajectory if it teaches a fraction of what
    // employers demand, however good the peer-review verdict sounds.
    name: 'lowLabourMarketAlignmentStableCap',
    capFrom: RISING_OR_FRONTIER,
    capTo: 'STABLE',
    fires: (c) => c.labourMarketScore !== null && c.labourMarketScore < G.labourMarketStableBelow,
    reason: (c) =>
      `Labour-market alignment ${(c.labourMarketScore ?? 0).toFixed(0)}/100 < ${G.labourMarketStableBelow} — program teaches only a fraction of employer-demanded skills; caps verdict at STABLE regardless of trajectory.`,
    shortLabel: `Labour-market alignment < ${G.labourMarketStableBelow} (STABLE cap)`,
  },
  {
    name: 'lowLabourMarketAlignmentFrontierCap',
    capFrom: FRONTIER_ONLY,
    capTo: 'RISING',
    fires: (c) => c.labourMarketScore !== null && c.labourMarketScore < G.labourMarketFrontierBelow,
    reason: (c) =>
      `Labour-market alignment ${(c.labourMarketScore ?? 0).toFixed(0)}/100 < ${G.labourMarketFrontierBelow} — FRONTIER label reserved for programs that meet employer demand; caps at RISING.`,
    shortLabel: `Labour-market alignment < ${G.labourMarketFrontierBelow} (FRONTIER cap)`,
  },
  {
    // FRONTIER means "strategic flagship the university should invest more
    // in", not "academically excellent boutique program". Zero revenue is
    // data (below the floor), not missing.
    name: 'lowRevenuePotentialFrontierCap',
    capFrom: FRONTIER_ONLY,
    capTo: 'RISING',
    fires: (c) =>
      c.latestAnnualRevenueThb !== null && c.latestAnnualRevenueThb < FLAGSHIP_REVENUE_FLOOR_THB,
    reason: (c) =>
      `Annual tuition revenue ${((c.latestAnnualRevenueThb ?? 0) / 1_000_000).toFixed(1)}M THB < ${floorM}M flagship floor — FRONTIER reserved for revenue-substantial programs (strategic, not academic); caps at RISING. Path to FRONTIER: grow cohort or partnerships.`,
    shortLabel: `Revenue < ${floorM}M THB/yr flagship floor (FRONTIER cap)`,
  },
];

/** Run every gate in order on the running verdict. */
export function applyGates(
  verdict: ProgramLifecycleVerdict,
  ctx: GateContext,
): { verdict: ProgramLifecycleVerdict; gatesApplied: LifecycleGateEffect[] } {
  let current = verdict;
  const gatesApplied: LifecycleGateEffect[] = [];
  for (const gate of LIFECYCLE_GATES) {
    if (!gate.capFrom.includes(current) || !gate.fires(ctx)) continue;
    gatesApplied.push({ name: gate.name, from: current, to: gate.capTo, reason: gate.reason(ctx) });
    current = gate.capTo;
  }
  return { verdict: current, gatesApplied };
}

/** The narrative's short name for a gate. */
export function gateShortLabel(name: LifecycleGateEffect['name']): string {
  return LIFECYCLE_GATES.find((g) => g.name === name)?.shortLabel ?? name;
}
