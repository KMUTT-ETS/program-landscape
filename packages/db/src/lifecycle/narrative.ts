// The 2-3 sentence rule-based narrative stored with every lifecycle verdict.

import type { ProgramLifecycleVerdict } from '@prisma/client';
import { gateShortLabel } from './gates';
import type { LifecycleGateEffect, ProgramLifecycleDriver } from './types';

export interface NarrativeArgs {
  verdict: ProgramLifecycleVerdict;
  ungatedVerdict: ProgramLifecycleVerdict;
  trajectoryScore: number;
  modernityVerdict: string | null;
  /** Drivers already sorted by |contribution|, largest first. */
  sortedDrivers: ProgramLifecycleDriver[];
  gatesApplied: LifecycleGateEffect[];
  hasPeerSelection: boolean;
}

export function buildNarrative(a: NarrativeArgs): string {
  const positives = a.sortedDrivers.filter((d) => d.contribution > 0).slice(0, 2);
  const negatives = a.sortedDrivers.filter((d) => d.contribution < 0).slice(0, 2);
  const parts: string[] = [verdictHeadline(a.verdict, a.trajectoryScore, a.modernityVerdict)];
  if (positives.length > 0) {
    parts.push(`Lifting forces: ${positives.map((d) => labelToPhrase(d.label)).join(', ')}.`);
  }
  if (negatives.length > 0) {
    parts.push(`Drag: ${negatives.map((d) => labelToPhrase(d.label)).join(', ')}.`);
  }
  // Gate-counterfactual transparency (gap #8): when a gate moved the
  // verdict, say so, so Council readers see the institutional position and
  // not just its effect.
  if (a.gatesApplied.length > 0) {
    const gateNames = a.gatesApplied.map((g) => gateShortLabel(g.name)).join(', ');
    parts.push(`Modifier gate(s) lowered verdict from ${a.ungatedVerdict} to ${a.verdict}: ${gateNames}.`);
  }
  if (!a.hasPeerSelection) {
    parts.push(
      'AI peer review not yet generated — run `pnpm peers:select <code>` for richer modernity + content-gap inputs.',
    );
  }
  return parts.join(' ');
}

function verdictHeadline(
  v: ProgramLifecycleVerdict,
  score: number,
  modernityVerdict: string | null,
): string {
  const s = score.toFixed(0);
  switch (v) {
    case 'FRONTIER':
      return `Frontier program (trajectory ${s}/100) — leading-edge content, strong fundamentals, future-defining.`;
    case 'RISING': {
      const modernityNote =
        modernityVerdict === 'IN_BETWEEN'
          ? ' Content sits in between fundamentals and the frontier — pushing the curriculum further would unlock Frontier status.'
          : modernityVerdict === null
            ? ' AI peer review not yet generated — content modernity unverified.'
            : '';
      return `Rising program (trajectory ${s}/100) — improving across multiple signals, growth trajectory.${modernityNote}`;
    }
    case 'STABLE': {
      const modernityNote =
        modernityVerdict === 'OLD_SCHOOL'
          ? ' Held back by old-school curriculum content — strong metrics are not enough without a content refresh.'
          : '';
      return `Stable program (trajectory ${s}/100) — meeting expectations, not yet growing.${modernityNote}`;
    }
    case 'SUNSET':
      return `Sunset risk (trajectory ${s}/100) — multiple signals declining; closure / merger / radical restructure on the table.`;
  }
}

function labelToPhrase(label: string): string {
  switch (label) {
    case 'ai_readiness': return 'AI readiness';
    case 'health_overall': return 'overall health';
    case 'enrollment_trend': return 'enrollment growth';
    case 'tuition_trend': return 'tuition growth';
    case 'content_modernity': return 'curriculum modernity';
    case 'labour_market_alignment': return 'labour-market alignment';
    case 'revenue_scale': return 'revenue scale';
    case 'major_content_gaps': return 'major content gaps vs peers';
    case 'demographic_resilience': return 'demographic resilience';
    case 'delayed_graduation_share': return 'delayed graduation share';
    case 'capability_strength': return 'faculty capability';
    default: return label.replace(/_/g, ' ');
  }
}
