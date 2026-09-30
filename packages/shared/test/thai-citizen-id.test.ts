import { describe, expect, it } from 'vitest';
import { isValidThaiCitizenId, normaliseThaiCitizenId } from '../src/identity/thai-citizen-id';

// 1101700203883: weights 13..2 over the first 12 digits sum to 162;
// (11 - 162 % 11) % 10 = 3, the 13th digit. 3100600123450 likewise (sum 155, (11 - 155 % 11) % 10 = 0).
describe('isValidThaiCitizenId', () => {
  it('accepts ids whose 13th digit matches the mod-11 checksum', () => {
    expect(isValidThaiCitizenId('1101700203883')).toBe(true);
    expect(isValidThaiCitizenId('3100600123450')).toBe(true);
  });
  it('rejects a wrong check digit', () => {
    expect(isValidThaiCitizenId('1101700203884')).toBe(false);
  });
  it('accepts the dashed and spaced forms people type', () => {
    expect(isValidThaiCitizenId('1-1017-00203-88-3')).toBe(true);
    expect(isValidThaiCitizenId('1 1017 00203 88 3')).toBe(true);
  });
  it('rejects anything that is not exactly 13 digits', () => {
    expect(isValidThaiCitizenId('110170020388')).toBe(false);
    expect(isValidThaiCitizenId('11017002038830')).toBe(false);
    expect(isValidThaiCitizenId('11017002038a3')).toBe(false);
    expect(isValidThaiCitizenId('')).toBe(false);
  });
});

describe('normaliseThaiCitizenId', () => {
  it('strips dashes and whitespace only', () => {
    expect(normaliseThaiCitizenId(' 1-1017-00203-88-3 ')).toBe('1101700203883');
  });
});
