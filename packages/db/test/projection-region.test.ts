import { afterEach, describe, expect, it } from 'vitest';
import { KKU_REFERENCE_ORGANIZATION, setOrganizationForTest } from '@kku/shared';
import { projectionRegionForInstitution, resolveProjectionRegion } from '../src/projection-region';

const REGIONS = ['TH', 'Northeast', 'Central'] as const;

describe('resolveProjectionRegion', () => {
  it('exact match', () => {
    expect(resolveProjectionRegion('Northeast', REGIONS)).toBe('Northeast');
  });
  it('matches case-insensitively, trimmed, returning the stored spelling', () => {
    expect(resolveProjectionRegion(' northeast ', REGIONS)).toBe('Northeast');
  });
  it('unknown region falls back to TH', () => {
    expect(resolveProjectionRegion('Bangkok', REGIONS)).toBe('TH');
  });
  it('null, undefined and empty fall back to TH', () => {
    expect(resolveProjectionRegion(null, REGIONS)).toBe('TH');
    expect(resolveProjectionRegion(undefined, REGIONS)).toBe('TH');
    expect(resolveProjectionRegion('  ', REGIONS)).toBe('TH');
  });
});

describe('projectionRegionForInstitution', () => {
  afterEach(() => setOrganizationForTest(KKU_REFERENCE_ORGANIZATION));

  it('profile not configured -> TH', () => {
    setOrganizationForTest(null);
    expect(projectionRegionForInstitution(REGIONS)).toBe('TH');
  });
  it('profile never loaded -> TH', () => {
    setOrganizationForTest(undefined);
    expect(projectionRegionForInstitution(REGIONS)).toBe('TH');
  });
  it('KKU reference profile -> Northeast', () => {
    setOrganizationForTest(KKU_REFERENCE_ORGANIZATION);
    expect(projectionRegionForInstitution(REGIONS)).toBe('Northeast');
  });
});
