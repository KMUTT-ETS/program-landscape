// Turns a dimension's drivers into its score, and five dimension scores
// into the overall composite. The null rule lives here: a null driver is
// excluded from the mean (never 0 or 50) and counts against
// dataCompletenessPct.

import { DIMENSION_DRIVERS, DRIVER_NOT_COMPUTED, type HealthDimension } from './drivers';
import type { HealthScore } from './schema';
import { LABOUR_MARKET_DEMAND_WEIGHTS } from './tuning';
import { clamp } from './curves';

const WEIGHTED_DRIVER_GROUPS: Partial<Record<HealthDimension, Readonly<Record<string, number>>>> = {
  relevance: LABOUR_MARKET_DEMAND_WEIGHTS,
};

export function summariseDrivers(
  dimension: HealthDimension,
  drivers: HealthScore['drivers'],
  omittedLabels: readonly string[] = [],
): HealthScore {
  const canonical = DIMENSION_DRIVERS[dimension];
  const omitted = new Set(omittedLabels);
  const present = new Map(drivers.map((d) => [d.label, d]));

  // Canonical order, padding anything the scorer never built. An omitted
  // label is dropped entirely — it is not "missing data", it is an
  // instrument that cannot apply at this scope/level.
  const resolved: HealthScore['drivers'] = [];
  for (const label of canonical) {
    if (omitted.has(label)) continue;
    resolved.push(present.get(label) ?? { label, value: null, raw: DRIVER_NOT_COMPUTED });
  }
  // Anything a scorer emitted that is not canonical is a bug; keep it
  // visible rather than swallowing it.
  for (const d of drivers) {
    if (!(canonical as readonly string[]).includes(d.label)) resolved.push(d);
  }

  const applicable = resolved.length;
  const nonNull = resolved.filter((d) => d.value !== null);
  const completeness = applicable > 0 ? (nonNull.length / applicable) * 100 : 0;
  if (nonNull.length === 0) {
    return { score: null, dataCompletenessPct: completeness, drivers: resolved };
  }
  // A weighted group keeps the combined weight its members would have had
  // (one per non-null member) and only redistributes it internally. Collapsing
  // the pair into a single slot would have halved labour-market's say in the
  // dimension — measured on dev, Industrial Engineering 66 -> 78 from that alone.
  const group = WEIGHTED_DRIVER_GROUPS[dimension];
  let total = 0;
  let count = 0;
  let groupSum = 0;
  let groupWeight = 0;
  let groupMembers = 0;
  for (const d of nonNull) {
    const w = group?.[d.label];
    if (w === undefined) {
      total += d.value ?? 0;
      count += 1;
    } else {
      groupSum += w * (d.value ?? 0);
      groupWeight += w;
      groupMembers += 1;
    }
  }
  if (groupWeight > 0) {
    total += (groupSum / groupWeight) * groupMembers;
    count += groupMembers;
  }
  const score = total / count;
  return { score: clamp(score), dataCompletenessPct: completeness, drivers: resolved };
}

// The scorer RAN and found nothing — every canonical driver explicitly
// null, `raw` empty. Distinct from a driver `summariseDrivers` had to pad
// because this scope's scorer does not implement it (DRIVER_NOT_COMPUTED).
// Conflating the two would make the parity guard unfalsifiable.
export function noDataScore(
  dimension: HealthDimension,
  omittedLabels: readonly string[] = [],
): HealthScore {
  const omitted = new Set(omittedLabels);
  return summariseDrivers(
    dimension,
    DIMENSION_DRIVERS[dimension]
      .filter((label) => !omitted.has(label))
      .map((label) => ({ label, value: null, raw: null })),
    omittedLabels,
  );
}

/** Test-only seam — `summariseDrivers` is module-private by design. */
export const summariseDriversForTest = summariseDrivers;

export function combineDimensions(dims: HealthScore[]): HealthScore {
  const nonNull = dims.filter((d) => d.score !== null);
  const completenessContribs = dims.map((d) => d.dataCompletenessPct / 100);
  const avgCompleteness = (completenessContribs.reduce((s, v) => s + v, 0) / dims.length) * 100;
  if (nonNull.length === 0) {
    return { score: null, dataCompletenessPct: avgCompleteness, drivers: [] };
  }
  const score = nonNull.reduce((s, d) => s + (d.score ?? 0), 0) / nonNull.length;
  return { score: clamp(score), dataCompletenessPct: avgCompleteness, drivers: [] };
}
