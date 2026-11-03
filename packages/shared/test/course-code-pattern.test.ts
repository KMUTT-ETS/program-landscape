import { describe, it, expect } from 'vitest';
import { courseCodeRegex, isCourseCode } from '../src/curriculum/course-code-pattern';
import {
  extractCandidateCourseCodes,
  extractFallbackCourseFromContext,
} from '../src/ai/prompts/program-courses-extract';

describe('course code pattern', () => {
  it.each(['EN 241 100', 'EN241100', 'MEE 221', 'MEE221', 'GEN 111'])('accepts %s', (c) => {
    expect(isCourseCode(c)).toBe(true);
  });
  it.each(['PHY 2565', 'ISO 9001', 'MEE 4000', 'MEE 22', 'mee 221', 'MEE 221A', 'E 221'])(
    'rejects %s',
    (c) => {
      expect(isCourseCode(c)).toBe(false);
    },
  );
  it('allows a line break at the boundaries like the old \\s? regexes', () => {
    expect(isCourseCode('EN 241\n100')).toBe(true);
    expect(isCourseCode('EN\n241 100')).toBe(true);
  });
  it('refuses extra digits after a 3-digit code, even across one space', () => {
    expect(isCourseCode('EN 241 1000')).toBe(false);
    expect(courseCodeRegex('g').exec('EN 241 1000')).toBeNull();
  });
  it('does not match double space (as before)', () => {
    expect(courseCodeRegex().exec('EN  241 100')).toBeNull();
  });
  it('returns fresh global regexes', () => {
    const a = courseCodeRegex('g');
    a.exec('MEE 221');
    expect(courseCodeRegex('g').lastIndex).toBe(0);
  });
});

describe('candidate scan and fallback with 3-digit codes', () => {
  const text =
    'GEN 111 ภาษาอังกฤษพื้นฐาน 3 (3-0-6) Basic English MEE221 กลศาสตร์ 3 (3-0-6) Mechanics ' +
    'หน้า PHY 2565 EN 241 100 วิชา 3 (3-0-6) Intro';
  it('returns normalised codes for both shapes', () => {
    expect(extractCandidateCourseCodes(text)).toEqual(['EN241100', 'GEN111', 'MEE221']);
  });
  it('fallback parses a 3-digit row', () => {
    const r = extractFallbackCourseFromContext(text, 'GEN111');
    expect(r).not.toBeNull();
    expect(r!.credits).toBe(3);
    expect(r!.nameTh).toContain('ภาษาอังกฤษพื้นฐาน');
    expect(r!.nameEn).toContain('Basic English');
  });
  it('fallback still rejects malformed codes', () => {
    expect(extractFallbackCourseFromContext(text, 'GEN11')).toBeNull();
  });
});
