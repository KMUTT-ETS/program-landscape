import { describe, expect, it } from 'vitest';

import { looksLikeThaiNationalId } from '../src/privacy/national-id';

// The fixtures below are SYNTHETIC: an arbitrary 12-digit prefix with its
// check digit computed, never a number belonging to a person.
const SYNTHETIC_VALID = '1101700207366';
const SYNTHETIC_VALID_2 = '2234567890129';

describe('looksLikeThaiNationalId', () => {
  it('accepts a well-formed synthetic id', () => {
    expect(looksLikeThaiNationalId(SYNTHETIC_VALID)).toBe(true);
    expect(looksLikeThaiNationalId(SYNTHETIC_VALID_2)).toBe(true);
  });

  it('accepts one written with hyphens and spaces', () => {
    expect(looksLikeThaiNationalId('1-1017-00207-36-6')).toBe(true);
    expect(looksLikeThaiNationalId(' 1 1017 00207 36 6 ')).toBe(true);
  });

  it('rejects 13 digits that fail the checksum', () => {
    // Same prefix, wrong check digit — this is what keeps a 13-digit course
    // or class code from being flagged as personal data.
    expect(looksLikeThaiNationalId('1101700207365')).toBe(false);
    expect(looksLikeThaiNationalId('1111111111111')).toBe(false);
  });

  it('rejects anything that is not 13 digits', () => {
    for (const value of ['', '123', '11017002073641', 'KKU-SEQ-0001', '2568', 'abcdefghijklm']) {
      expect(looksLikeThaiNationalId(value), value).toBe(false);
    }
  });

  it('rejects a string with 13 digits embedded in other text', () => {
    expect(looksLikeThaiNationalId('id:1101700207366')).toBe(false);
  });
});
