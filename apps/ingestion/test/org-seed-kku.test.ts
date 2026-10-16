import { describe, expect, it } from 'vitest';
import { KKU_REFERENCE_ORGANIZATION } from '@kku/shared';
import { ORG_SEED_CHECK_MISSING_EXIT, kkuSeedIdentity, parseOrgSeedArgs } from '../src/lib/org-seed-kku';

describe('kkuSeedIdentity — carries KKU’s old User-Agent contact email over once', () => {
  it('prefers INSTITUTION_CONTACT_EMAIL', () => {
    const id = kkuSeedIdentity({ INSTITUTION_CONTACT_EMAIL: ' ops@example.ac.th ', OPENALEX_MAILTO: 'oa@example.ac.th' });
    expect(id.contactEmail).toBe('ops@example.ac.th');
  });

  it('falls back to OPENALEX_MAILTO', () => {
    expect(kkuSeedIdentity({ INSTITUTION_CONTACT_EMAIL: '  ', OPENALEX_MAILTO: 'oa@example.ac.th' }).contactEmail).toBe(
      'oa@example.ac.th',
    );
  });

  it('is null when neither key is set, and keeps every other KKU field', () => {
    const id = kkuSeedIdentity({});
    expect(id).toEqual({ ...KKU_REFERENCE_ORGANIZATION, contactEmail: null, expectedVersion: null });
  });
});

describe('parseOrgSeedArgs', () => {
  it('defaults to seeding; --check is a no-write probe', () => {
    expect(parseOrgSeedArgs([])).toEqual({ check: false });
    expect(parseOrgSeedArgs(['--check'])).toEqual({ check: true });
  });

  it('rejects unknown flags', () => {
    expect(() => parseOrgSeedArgs(['--apply'])).toThrow(/unknown argument/);
  });

  it('uses exit 3 for "no profile" in --check mode', () => {
    expect(ORG_SEED_CHECK_MISSING_EXIT).toBe(3);
  });
});

describe('kkuSeedIdentity — malformed email', () => {
  it('drops a value that is not an email rather than failing the deploy', () => {
    expect(kkuSeedIdentity({ INSTITUTION_CONTACT_EMAIL: 'not-an-email' }).contactEmail).toBeNull();
  });
});
