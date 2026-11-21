// The two shapes a lifecycle driver takes: a step function (bands) or a
// clamped line. The numbers come from ./tuning.ts.

import type { Banded, Linear } from './tuning';

/** Contribution of the first band the value reaches (value >= atLeast);
 *  `below` when it reaches none. */
export function bandScore(value: number, table: Banded): number {
  for (const [atLeast, contribution] of table.bands) {
    if (value >= atLeast) return contribution;
  }
  return table.below;
}

/** (value - centre) * weight, clamped to ±cap when the driver has a cap.
 *  Computed in exactly this order so published figures reproduce to the
 *  last bit. */
export function linearContribution(value: number, t: Linear): number {
  const raw = (value - t.centre) * t.weight;
  if (t.cap === undefined) return raw;
  return Math.max(-t.cap, Math.min(t.cap, raw));
}
