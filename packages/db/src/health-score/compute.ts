// The entry point: score every child of a scope on the five dimensions.
// Each dimension's drivers are computed in its own file
// (attractiveness.ts, financial.ts, capability.ts, outcomes.ts,
// relevance.ts); this file only fetches the shared inputs, calls the
// program-scope or the scope-level scorer, and assembles the row.

import type { ScopeLevel } from '../scope';
import { queryMetricByScope } from '../scope';
import type { HealthScoreRow } from './schema';
import { HEALTH_SCORE_VERSION } from './version';
import { combineDimensions } from './summarise';
import { resolveChildren } from './scope-tree';
import { computeKmitlProgramAlignment } from './relevance-inputs';
import { scoreAttractivenessProgram, scoreAttractivenessScope } from './attractiveness';
import { scoreFinancialProgram, scoreFinancialScope } from './financial';
import { scoreCapabilityProgram, scoreCapabilityScope } from './capability';
import { scoreOutcomesProgram, scoreOutcomesScope } from './outcomes';
import { scoreRelevanceProgram, scoreRelevanceScope } from './relevance';

// ──────────────────────────────────────────────────────────────────────────
// Public entry point
// ──────────────────────────────────────────────────────────────────────────

export async function computeHealthScores(
  scope: ScopeLevel,
  scopeId: string | null,
): Promise<HealthScoreRow[]> {
  // resolveChildren returns the EFFECTIVE child scope — usually the
  // natural child (faculty → department → program) but can collapse
  // a level when the org tree is incomplete (e.g., faculties whose
  // canonical programs all have departmentId=NULL skip the department
  // tier and return programs directly).
  const { scope: childScope, nodes: children } = await resolveChildren(scope, scopeId);

  // Pre-compute KMITL alignment for every program in one pass — used
  // by the relevance dimension. Empty map when the LinkedIn-via-MHESI
  // dataset has no rows yet → driver returns null per scope.
  const programAlignment = await computeKmitlProgramAlignment();

  const rows: HealthScoreRow[] = [];
  for (const child of children) {
    const enrollment = await queryMetricByScope({
      scope: childScope,
      scopeId: child.id,
      family: 'enrollment',
    });
    const financialsAgg = await queryMetricByScope({
      scope: childScope,
      scopeId: child.id,
      family: 'financial',
    });
    const outcomes = await queryMetricByScope({
      scope: childScope,
      scopeId: child.id,
      family: 'outcomes',
    });

    // Program-scope reads raw rows directly so the scorers can apply
    // partial-year heuristics + use program-internal fields the MV
    // doesn't expose. Faculty/dept/uni scopes still use the MV.
    const isProgram = childScope === 'program';

    // Pick the latest year that ACTUALLY has data for this family,
    // not just the latest year in the MV's union-of-years column. The
    // MV creates a row per (scope × year) for every distinct year
    // across enrollment ∪ financial ∪ outcomes; the freshest family
    // pulls forward the year axis, leaving NULL columns for the lagging
    // families. Without this filter, the LAGGING family (typically
    // outcomes — the survey runs ~6mo after the academic year) reads
    // null because its row at the latest universe-wide year is empty.
    // (Attractiveness pulls TCAS directly per scope — see
    // scoreAttractivenessScope — so we don't pre-pick an enrolment row
    // for it. Financial / outcomes still pivot on the latest year that
    // actually has data for that family.)
    const latestFinancial = latestWith(financialsAgg, (r) => r.netContributionTotal !== null);
    const latestOutcomes = latestWith(outcomes, (r) => r.employmentRateWeighted !== null);

    const attractiveness = isProgram
      ? await scoreAttractivenessProgram(child.id)
      : await scoreAttractivenessScope(childScope, child.id);
    const financial = isProgram
      ? await scoreFinancialProgram(child.id, enrollment)
      : await scoreFinancialScope(latestFinancial, childScope, child.id, enrollment);
    const capability = isProgram
      ? await scoreCapabilityProgram(child.id)
      : await scoreCapabilityScope(child.id, childScope);
    const outcomesScore = isProgram
      ? await scoreOutcomesProgram(child.id, latestOutcomes)
      : await scoreOutcomesScope(childScope, child.id, latestOutcomes);
    const relevance = isProgram
      ? await scoreRelevanceProgram(child.id, programAlignment.get(child.id) ?? null)
      : await scoreRelevanceScope(child.id, childScope, programAlignment);

    const dimensions: HealthScoreRow['dimensions'] = {
      attractiveness,
      financial,
      capability,
      outcomes: outcomesScore,
      relevance,
    };
    rows.push({
      scope: childScope,
      scopeId: child.id,
      scopeLabel: child.label,
      scopeLabelTh: child.labelTh,
      scopeLabelEn: child.labelEn,
      parentScopeId: child.parentId,
      methodologyVersion: HEALTH_SCORE_VERSION,
      dimensions,
      overall: combineDimensions(Object.values(dimensions)),
      latestFreshness:
        enrollment.at(-1)?.latestFreshness ??
        financialsAgg.at(-1)?.latestFreshness ??
        outcomes.at(-1)?.latestFreshness ??
        null,
    });
  }
  return rows;
}


// Pick the most recent year-row in a metric series that actually
// satisfies `predicate`. Falls back to null when no row qualifies.
// MV rows are ordered ASC by year, so we walk backwards from the tail.
function latestWith<T>(rows: T[], predicate: (r: T) => boolean): T | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i]!;
    if (predicate(r)) return r;
  }
  return null;
}
