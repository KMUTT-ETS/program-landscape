import { describe, it, expect } from 'vitest';
import {
  PROGRAM_COURSES_EXTRACT_VERSION,
  ProgramCoursesExtractSchema,
} from '../src/ai/prompts/program-courses-extract';

// The plan for this change called the category bump "v2". The file was
// already at v3 (regularised from patch-style v2.3 in c7a5a54), so v2 is
// taken: prod carries AiExtraction rows stamped program-courses-extract.v2
// from a materially different prompt (full-PDF scope, credits capped at 20).
// Reusing the string would fuse two prompt behaviours under one version and
// break the version → row link that lets us rerun affected extractions.
// docs/prompt-standard.md is explicit — major-only, never reuse a published
// version — so the category bump lands as v4.
describe('program-courses-extract v4 — course category', () => {
  it('is stamped v4', () => {
    expect(PROGRAM_COURSES_EXTRACT_VERSION).toBe('program-courses-extract.v4');
  });

  it('accepts every category the Thai curriculum structure uses', () => {
    for (const category of [
      'GENERAL_EDUCATION',
      'CORE',
      'MAJOR_REQUIRED',
      'MAJOR_ELECTIVE',
      'FREE_ELECTIVE',
      'THESIS_PROJECT',
      'UNKNOWN',
    ]) {
      const parsed = ProgramCoursesExtractSchema.parse({
        courses: [{ code: 'EN241100', nameTh: 'x', nameEn: 'x', credits: 3, category }],
        caveats: [],
        confidence: 0.9,
      });
      expect(parsed.courses[0]!.category).toBe(category);
    }
  });

  it('defaults a missing category to UNKNOWN rather than guessing one', () => {
    // A v3-era payload, or a course the model could not place. Defaulting
    // to a real category would produce confidently wrong promotion advice.
    const parsed = ProgramCoursesExtractSchema.parse({
      courses: [{ code: 'EN241100', nameTh: 'x', nameEn: 'x', credits: 3 }],
      caveats: [],
      confidence: 0.9,
    });
    expect(parsed.courses[0]!.category).toBe('UNKNOWN');
  });

  it('rejects a category outside the enum', () => {
    expect(() =>
      ProgramCoursesExtractSchema.parse({
        courses: [{ code: 'EN241100', nameTh: 'x', nameEn: 'x', credits: 3, category: 'ELECTIVE' }],
        caveats: [],
        confidence: 0.9,
      }),
    ).toThrow();
  });
});
