import { describe, it, expect } from 'vitest';
import {
  PROGRAM_COURSES_EXTRACT_VERSION,
  ProgramCoursesExtractSchema,
  CourseCategorySchema,
  buildProgramCoursesExtractMessages,
  extractFallbackCourseFromContext,
} from '../src/ai/prompts/program-courses-extract';
import { AI_METHOD_CATALOG } from '../src/ai/method-catalog';

// The plan for this change called the category bump "v2". The file was
// already at v3 (regularised from patch-style v2.3 in c7a5a54), so v2 is
// taken: prod carries AiExtraction rows stamped program-courses-extract.v2
// from a materially different prompt (full-PDF scope, credits capped at 20).
// Reusing the string would fuse two prompt behaviours under one version and
// break the version → row link that lets us rerun affected extractions.
// docs/prompt-standard.md is explicit — major-only, never reuse a published
// version — so the category bump lands as v4.
const PREVIOUSLY_PUBLISHED = [
  'program-courses-extract.v1',
  'program-courses-extract.v2',
  'program-courses-extract.v2.1',
  'program-courses-extract.v2.2',
  'program-courses-extract.v2.3',
  'program-courses-extract.v3',
];

describe('program-courses-extract — version', () => {
  it('matches the method catalog (catalog drift is a silent audit break)', () => {
    const entry = AI_METHOD_CATALOG.find(
      (e) => e.methodPrefix === 'program-courses-extract',
    );
    expect(entry, 'program-courses-extract missing from AI_METHOD_CATALOG').toBeDefined();
    expect(entry!.currentVersion).toBe(PROGRAM_COURSES_EXTRACT_VERSION);
  });

  it('does not reuse a previously published version string', () => {
    // Reuse would fuse two prompt behaviours under one methodVersion and
    // break the version → AiExtraction row link.
    expect(PREVIOUSLY_PUBLISHED).not.toContain(PROGRAM_COURSES_EXTRACT_VERSION);
  });
});

describe('program-courses-extract v4 — course category', () => {
  it('pins the category members', () => {
    // Pinned so an added member cannot slip past the coverage test below
    // (or past the prompt-agreement test) unnoticed.
    expect(CourseCategorySchema.options).toEqual([
      'GENERAL_EDUCATION',
      'CORE',
      'MAJOR_REQUIRED',
      'MAJOR_ELECTIVE',
      'FREE_ELECTIVE',
      'THESIS_PROJECT',
      'UNKNOWN',
    ]);
  });

  it('accepts every category the Thai curriculum structure uses', () => {
    for (const category of CourseCategorySchema.options) {
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

  it('marks regex-fallback courses UNKNOWN — that path never reads headings', () => {
    // The fallback bypasses the Zod schema entirely (it builds program_courses
    // rows directly in the runner), so the default above cannot cover it.
    const fb = extractFallbackCourseFromContext(
      'EN241100 กลศาสตร์วิศวกรรม 3 (3-0-6) Engineering Mechanics  EN241100 อีกครั้ง',
      'EN241100',
    );
    expect(fb).not.toBeNull();
    expect(fb!.category).toBe('UNKNOWN');
  });
});

describe('program-courses-extract v4 — prompt/schema agreement', () => {
  const systemOf = (messages: ReturnType<typeof buildProgramCoursesExtractMessages>) =>
    messages.find((m) => m.role === 'system')!.content as string;

  const system = systemOf(
    buildProgramCoursesExtractMessages({
      programCode: 'KKU-SEQ-0001',
      programNameTh: 'หลักสูตรทดสอบ',
      programNameEn: 'Test Program',
      facultyNameTh: 'คณะวิศวกรรมศาสตร์',
      levelTh: 'ป.ตรี',
      pdfText: 'sample รายวิชา section text',
      candidateCodes: ['EN101001'],
    }),
  );

  it('names every schema category in the prompt', () => {
    // Schema-vs-prompt drift is the silent failure that costs a re-run: a
    // member the schema accepts but the prompt never mentions can never be
    // emitted, and one the prompt names but the schema rejects fails every
    // extraction that uses it.
    for (const category of CourseCategorySchema.options) {
      expect(system, `prompt never mentions ${category}`).toContain(category);
    }
  });

  it('spells the categories in the JSON example the model copies', () => {
    const example = system.slice(system.indexOf('"courses"'), system.indexOf('"caveats"'));
    expect(example).toContain('"category"');
    for (const category of CourseCategorySchema.options) {
      expect(example, `JSON example omits ${category}`).toContain(category);
    }
  });

  it('states the heading carry-forward and precedence rules', () => {
    // Both exist to stop the แกน/บังคับ overlap splitting the required-course
    // population non-deterministically between programmes.
    expect(system).toContain('HEADING SCOPE');
    expect(system).toContain('PRECEDENCE');
    expect(system).toMatch(/CORE beats MAJOR_REQUIRED/);
    expect(system).toMatch(/THESIS_PROJECT beats its\s+parent หมวด/);
  });

  it('maps every heading it names, including กลุ่มวิชาเฉพาะด้าน', () => {
    // กลุ่มวิชาเฉพาะด้าน appears in the prompt's own scope block; leaving it
    // unmapped was self-inflicted ambiguity.
    for (const heading of ['กลุ่มวิชาเฉพาะด้าน', 'กลุ่มวิชาแกน', 'ดุษฎีนิพนธ์', 'สารนิพนธ์']) {
      expect(system, `prompt never places ${heading}`).toContain(heading);
    }
  });
});
