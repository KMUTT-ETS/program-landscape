import { describe, expect, it } from 'vitest';
import { HEALTH_DANGER_BELOW, HEALTH_HEALTHY_FROM, healthZone } from '../src/health/zones';

describe('healthZone', () => {
  it('uses the documented cut-offs', () => {
    expect(HEALTH_DANGER_BELOW).toBe(40);
    expect(HEALTH_HEALTHY_FROM).toBe(65);
  });
  it.each([
    [0, 'danger'], [39.99, 'danger'],
    [40, 'attention'], [64.6, 'attention'], [64.99, 'attention'],
    [65, 'healthy'], [100, 'healthy'],
  ])('%d → %s', (score, zone) => {
    expect(healthZone(score)).toBe(zone);
  });
  it('returns null for missing or non-finite scores', () => {
    expect(healthZone(null)).toBeNull();
    expect(healthZone(undefined)).toBeNull();
    expect(healthZone(Number.NaN)).toBeNull();
    expect(healthZone(Number.POSITIVE_INFINITY)).toBeNull();
  });
});
