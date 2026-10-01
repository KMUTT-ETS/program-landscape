// The /profile evaluation panel's data shape and summariser live in
// @kku/shared (one implementation for /profile and the external staff-profile
// API). Re-exported here by DEEP PATH — the panel is a client component and the
// @kku/shared barrel pulls node:crypto. Only the radar's axis rule is UI-only.
export * from '@kku/shared/src/staff-profile/teaching-evaluation';

/** Radial axis for 1–5 ratings: start at 3 unless a plotted value is lower
 *  (then the half point below it), so no point is clipped to the centre. */
export function evaluationRadarDomain(values: Array<number | null>): [number, number] {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return [3, 5];
  const min = Math.min(...present);
  return [Math.min(3, Math.floor(min * 2) / 2), 5];
}
