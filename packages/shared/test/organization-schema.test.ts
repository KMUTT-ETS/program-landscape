import { describe, expect, it } from 'vitest';
import { OrganizationIdentityInputSchema } from '../src';

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
