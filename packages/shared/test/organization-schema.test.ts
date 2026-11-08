import { describe, expect, it } from 'vitest';
import { OrganizationBrandInputSchema, OrganizationIdentityInputSchema } from '../src';

const base = {
  nameTh: 'มหาวิทยาลัยตัวอย่าง',
  nameEn: 'Example University',
  shortNameTh: 'มต.',
  shortNameEn: 'EXU',
  appUrl: 'https://landscape.example.ac.th',
  expectedVersion: null,
};

describe('OrganizationIdentityInputSchema', () => {
  it('trims names so the TCAS exact match still works on pasted text', () => {
    const out = OrganizationIdentityInputSchema.parse({ ...base, nameTh: '  มหาวิทยาลัยตัวอย่าง \n' });
    expect(out.nameTh).toBe('มหาวิทยาลัยตัวอย่าง');
  });

  it('defaults the intake floors to the values the product shipped with', () => {
    // An install that never touches them keeps scoring as it always did.
    const out = OrganizationIdentityInputSchema.parse(base);
    expect(out.intakeFloorBachelor).toBe(30);
    expect(out.intakeFloorPostgrad).toBe(8);
  });

  it('accepts an institution that sets its own floors', () => {
    const out = OrganizationIdentityInputSchema.parse({
      ...base,
      intakeFloorBachelor: 20,
      intakeFloorPostgrad: 5,
    });
    expect(out.intakeFloorBachelor).toBe(20);
    expect(out.intakeFloorPostgrad).toBe(5);
  });

  it('refuses a floor of zero', () => {
    // intakeComplianceFor divides by the floor; zero would score every
    // programme NaN rather than meaning "no policy".
    expect(
      OrganizationIdentityInputSchema.safeParse({ ...base, intakeFloorBachelor: 0 }).success,
    ).toBe(false);
  });

  it('refuses a fractional floor', () => {
    expect(
      OrganizationIdentityInputSchema.safeParse({ ...base, intakeFloorPostgrad: 4.5 }).success,
    ).toBe(false);
  });

  it('stores cleared optional fields as null', () => {
    const out = OrganizationIdentityInputSchema.parse({
      ...base,
      regionTh: '  ',
      regionEn: '',
      contactEmail: '',
    });
    expect(out.regionTh).toBeNull();
    expect(out.regionEn).toBeNull();
    expect(out.contactEmail).toBeNull();
  });

  it('stores a region in canonical spelling and derives the Thai name from it', () => {
    const out = OrganizationIdentityInputSchema.parse({ ...base, regionEn: '  northeast ' });
    expect(out.regionEn).toBe('Northeast');
    expect(out.regionTh).toBe('ภาคตะวันออกเฉียงเหนือ');
  });

  it('ignores a submitted Thai region that contradicts the English one', () => {
    const out = OrganizationIdentityInputSchema.parse({ ...base, regionEn: 'Central', regionTh: 'ภาคใต้' });
    expect(out.regionTh).toBe('ภาคกลาง');
  });

  it('rejects a region the projection does not carry', () => {
    // East and West are inside Central in the four-region projection.
    for (const regionEn of ['East', 'Northeastern (Isan)', 'Bangkok']) {
      expect(OrganizationIdentityInputSchema.safeParse({ ...base, regionEn }).success).toBe(false);
    }
  });

  it('rejects a blank required name, a bad email and a non-http URL', () => {
    expect(OrganizationIdentityInputSchema.safeParse({ ...base, nameEn: '   ' }).success).toBe(false);
    expect(OrganizationIdentityInputSchema.safeParse({ ...base, contactEmail: 'nope' }).success).toBe(false);
    expect(OrganizationIdentityInputSchema.safeParse({ ...base, appUrl: 'ftp://x.example' }).success).toBe(false);
  });

  it('strips a trailing slash from the app URL', () => {
    expect(OrganizationIdentityInputSchema.parse({ ...base, appUrl: 'https://a.example/' }).appUrl).toBe(
      'https://a.example',
    );
  });

  it('requires expectedVersion to be null or a positive integer', () => {
    expect(OrganizationIdentityInputSchema.safeParse({ ...base, expectedVersion: 0 }).success).toBe(false);
    expect(OrganizationIdentityInputSchema.parse({ ...base, expectedVersion: 3 }).expectedVersion).toBe(3);
  });
});

describe('OrganizationBrandInputSchema', () => {
  it('lower-cases hex and turns a cleared colour into null', () => {
    expect(
      OrganizationBrandInputSchema.parse({ primaryColor: '#F26522', secondaryColor: '', expectedVersion: 2 }),
    ).toEqual({ primaryColor: '#f26522', secondaryColor: null, expectedVersion: 2 });
  });

  it('rejects a non-hex colour and a missing version', () => {
    expect(OrganizationBrandInputSchema.safeParse({ primaryColor: 'orange', secondaryColor: null, expectedVersion: 1 }).success).toBe(false);
    expect(OrganizationBrandInputSchema.safeParse({ primaryColor: null, secondaryColor: null }).success).toBe(false);
  });
});

describe('OpenAlex institution id', () => {
  it('accepts a well-formed id and treats blank as unset', () => {
    expect(OrganizationIdentityInputSchema.parse({ ...base, openalexInstitutionId: ' I60837268 ' }).openalexInstitutionId).toBe('I60837268');
    expect(OrganizationIdentityInputSchema.parse({ ...base, openalexInstitutionId: '' }).openalexInstitutionId).toBeNull();
    expect(OrganizationIdentityInputSchema.parse(base).openalexInstitutionId).toBeNull();
  });

  it('rejects a malformed OpenAlex id', () => {
    for (const bad of ['60837268', 'https://openalex.org/I60837268', 'I12x']) {
      expect(OrganizationIdentityInputSchema.safeParse({ ...base, openalexInstitutionId: bad }).success).toBe(false);
    }
  });
});
