// Health-score zones: which band a 0-100 health score falls in. Every place
// that colours or counts health scores asks this module instead of writing
// its own `< 40` / `< 65`. Definition: docs/methodologies/health-score.md
// ("Zones").
//
// The cut-offs are PRESENTATION, not the score formula: moving them changes
// how a score is coloured and counted, never the score itself, so it needs
// no HEALTH_SCORE_VERSION bump (or INSTITUTION_REVISION). Update the doc
// and the in-app methodology paper when you change them.
//
// Client components import this file through the `@kku/shared/health/zones`
// subpath so the server-side package index stays out of the browser bundle.

/** Scores below this are in the danger zone. */
export const HEALTH_DANGER_BELOW = 40;
/** Scores at or above this are healthy. */
export const HEALTH_HEALTHY_FROM = 65;

export type HealthZone = 'danger' | 'attention' | 'healthy';

/**
 * The zone of a raw (unrounded) health score. Null for a missing score and
 * for NaN / ±Infinity, which no zone describes truthfully.
 */
export function healthZone(score: number | null | undefined): HealthZone | null {
  if (score === null || score === undefined || !Number.isFinite(score)) return null;
  if (score < HEALTH_DANGER_BELOW) return 'danger';
  if (score < HEALTH_HEALTHY_FROM) return 'attention';
  return 'healthy';
}

export const HEALTH_ZONE_LABEL: Readonly<Record<HealthZone, string>> = {
  danger: 'Danger zone',
  attention: 'Needs attention',
  healthy: 'Healthy',
};
