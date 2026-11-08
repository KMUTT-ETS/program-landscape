import { describe, expect, it } from 'vitest';

import { sfrBandFor } from '../src/health-score';

describe('sfrBandFor', () => {
  it('band falls back to PROFESSIONAL', () => {
    expect(sfrBandFor(null)).toBe('PROFESSIONAL');
  });
  it('stored band wins', () => {
    expect(sfrBandFor('CLINICAL')).toBe('CLINICAL');
  });
});
