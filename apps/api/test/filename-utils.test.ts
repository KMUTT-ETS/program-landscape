import { describe, it, expect } from 'vitest';
import {
  decodeMultipartFilename,
  looksLikeMojibake,
} from '../src/pdf-intake/filename-utils';

// Reproducibly build a mojibake string by round-tripping UTF-8 → latin1.
// Matches exactly what busboy does when it reads a Content-Disposition
// filename whose bytes are raw UTF-8 but the parser treats them as latin1.
function mojibake(utf8: string): string {
  return Buffer.from(utf8, 'utf8').toString('latin1');
}

describe('decodeMultipartFilename / looksLikeMojibake', () => {
  it('leaves pure-ASCII names alone', () => {
    expect(decodeMultipartFilename('normal.pdf')).toBe('normal.pdf');
    expect(looksLikeMojibake('normal.pdf')).toBe(false);
  });

  it('leaves proper Thai UTF-8 names alone', () => {
    const name = '1 วท.บ.เกษตรศาสตร์ 2565.pdf';
    expect(looksLikeMojibake(name)).toBe(false);
    expect(decodeMultipartFilename(name)).toBe(name);
  });

  it('leaves proper emoji / CJK names alone', () => {
    expect(decodeMultipartFilename('🎯.pdf')).toBe('🎯.pdf');
    expect(decodeMultipartFilename('测试.pdf')).toBe('测试.pdf');
    expect(looksLikeMojibake('🎯.pdf')).toBe(false);
    expect(looksLikeMojibake('测试.pdf')).toBe(false);
  });

  it('recovers Thai mojibake', () => {
    const orig = '1 วท.บ.เกษตรศาสตร์ 2565.pdf';
    const busboyed = mojibake(orig);
    expect(busboyed).not.toBe(orig);
    expect(looksLikeMojibake(busboyed)).toBe(true);
    expect(decodeMultipartFilename(busboyed)).toBe(orig);
  });

  it('recovers a short Thai name', () => {
    const orig = 'ไทย.pdf';
    expect(decodeMultipartFilename(mojibake(orig))).toBe(orig);
  });

  it('recovers emoji mojibake', () => {
    const orig = '🎯-ok.pdf';
    expect(decodeMultipartFilename(mojibake(orig))).toBe(orig);
  });

  it('is idempotent on already-recovered strings', () => {
    const orig = '1 วท.บ.เกษตรศาสตร์ 2565.pdf';
    const once = decodeMultipartFilename(mojibake(orig));
    const twice = decodeMultipartFilename(once);
    expect(once).toBe(twice);
  });
});
