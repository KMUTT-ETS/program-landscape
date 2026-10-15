import { describe, expect, it } from 'vitest';
import {
  DEFAULT_APP_PUBLIC_URL,
  DEFAULT_INSTITUTION_NAME_EN,
  DEFAULT_INSTITUTION_NAME_TH,
  DEFAULT_INSTITUTION_SHORT_NAME_EN,
  DEFAULT_INSTITUTION_SHORT_NAME_TH,
  getInstitution,
  isOwnInstitution,
  outboundUserAgent,
} from '../src/institution';

describe('getInstitution', () => {
  it('falls back to KKU when nothing is set, so upstream behaviour is unchanged', () => {
    expect(getInstitution({})).toEqual({
      nameTh: DEFAULT_INSTITUTION_NAME_TH,
      nameEn: DEFAULT_INSTITUTION_NAME_EN,
      shortNameEn: DEFAULT_INSTITUTION_SHORT_NAME_EN,
      shortNameTh: DEFAULT_INSTITUTION_SHORT_NAME_TH,
      contactEmail: null,
      appUrl: DEFAULT_APP_PUBLIC_URL,
    });
  });

  it('reads overrides and trims them', () => {
    const inst = getInstitution({
      INSTITUTION_NAME_TH: '  มหาวิทยาลัยตัวอย่าง ',
      INSTITUTION_NAME_EN: ' Example University ',
      INSTITUTION_SHORT_NAME_EN: 'EXU',
      INSTITUTION_SHORT_NAME_TH: 'มต.',
      INSTITUTION_CONTACT_EMAIL: ' landscape@example.ac.th ',
      APP_PUBLIC_URL: 'https://landscape.example.ac.th',
    });
    expect(inst).toEqual({
      nameTh: 'มหาวิทยาลัยตัวอย่าง',
      nameEn: 'Example University',
      shortNameEn: 'EXU',
      shortNameTh: 'มต.',
      contactEmail: 'landscape@example.ac.th',
      appUrl: 'https://landscape.example.ac.th',
    });
  });

  it('treats blank values as unset', () => {
    expect(getInstitution({ INSTITUTION_NAME_TH: '   ' }).nameTh).toBe(DEFAULT_INSTITUTION_NAME_TH);
  });

  it('falls back to OPENALEX_MAILTO for the contact email', () => {
    expect(getInstitution({ OPENALEX_MAILTO: 'polite@example.ac.th' }).contactEmail).toBe(
      'polite@example.ac.th',
    );
    expect(
      getInstitution({
        OPENALEX_MAILTO: 'polite@example.ac.th',
        INSTITUTION_CONTACT_EMAIL: 'contact@example.ac.th',
      }).contactEmail,
    ).toBe('contact@example.ac.th');
  });
});

describe('outboundUserAgent', () => {
  it('omits the email when none is configured', () => {
    expect(outboundUserAgent(undefined, {})).toBe(
      `Program-Landscape/1.0 (+${DEFAULT_APP_PUBLIC_URL})`,
    );
  });

  it('includes purpose, app URL and contact email', () => {
    expect(
      outboundUserAgent('discovery', {
        APP_PUBLIC_URL: 'https://landscape.example.ac.th',
        INSTITUTION_CONTACT_EMAIL: 'landscape@example.ac.th',
      }),
    ).toBe('Program-Landscape/1.0 discovery (+https://landscape.example.ac.th; landscape@example.ac.th)');
  });
});

describe('isOwnInstitution', () => {
  it('matches the configured Thai name, ignoring surrounding whitespace', () => {
    const env = { INSTITUTION_NAME_TH: 'มหาวิทยาลัยตัวอย่าง' };
    expect(isOwnInstitution(' มหาวิทยาลัยตัวอย่าง ', env)).toBe(true);
    expect(isOwnInstitution(DEFAULT_INSTITUTION_NAME_TH, env)).toBe(false);
    expect(isOwnInstitution(null, env)).toBe(false);
  });
});
