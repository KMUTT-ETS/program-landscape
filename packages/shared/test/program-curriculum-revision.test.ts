import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  PROGRAM_CURRICULUM_REVISION_VERSION,
  CURRICULUM_REVISION_PROVENANCE_CAVEAT,
  ProgramCurriculumRevisionSchema,
  buildProgramCurriculumRevisionMessages,
  type CurriculumRevisionInput,
} from '../src/ai/prompts/program-curriculum-revision';
import { AI_METHOD_CATALOG } from '../src/ai/method-catalog';

const input: CurriculumRevisionInput = {
  program: {
    code: 'KKU-SEQ-0001', nameTh: 'วิศวกรรมศาสตรบัณฑิต', nameEn: 'B.Eng.',
    levelTh: 'ป.ตรี', facultyNameTh: 'คณะวิศวกรรมศาสตร์',
    totalCredits: 140, durationYears: 4,
  },
  courses: [
    { courseCode: 'EN241100', nameTh: 'โครงสร้างข้อมูล', nameEn: 'Data Structures',
      credits: 3, category: 'MAJOR_REQUIRED',
      descriptionTh: 'ศึกษาโครงสร้างข้อมูลพื้นฐาน', learningOutcomesTh: ['เข้าใจ array'] },
  ],
  themes: [
    { name: 'Vector databases', paperCount: 12, exampleTitles: ['A survey of vector indexing'],
      yearSpan: '2019-2025', trend: 'rising', evidenceNote: 'twelve papers' },
  ],
  roster: [{ name: 'Somchai X', rank: 'ASSOC_PROF', specialization: 'databases' }],
  currentProgramSkills: ['Programming'],
  readiness: 'ok',
  totalDistinctPapers: 12,
};

const enhance = {
  courseCode: 'EN241100', courseNameTh: 'โครงสร้างข้อมูล',
  currentlyCoversQuote: 'ศึกษาโครงสร้างข้อมูลพื้นฐาน',
  themeRefs: ['Vector databases'], addition: 'Add vector indexing',
  additionDetail: 'A 3-hour module.', effort: 'MINOR',
  evidencePaperTitles: ['A survey of vector indexing'],
};

describe('program-curriculum-revision prompt', () => {
  it('is stamped v1', () => {
    expect(PROGRAM_CURRICULUM_REVISION_VERSION).toBe('program-curriculum-revision.v1');
  });

  it('matches the method catalog (catalog drift is a silent audit break)', () => {
    const entry = AI_METHOD_CATALOG.find(
      (e) => e.methodPrefix === 'program-curriculum-revision',
    );
    expect(entry, 'program-curriculum-revision missing from AI_METHOD_CATALOG').toBeDefined();
    expect(entry!.currentVersion).toBe(PROGRAM_CURRICULUM_REVISION_VERSION);
  });

  it('parses a well-formed payload', () => {
    const parsed = ProgramCurriculumRevisionSchema.parse({
      coverageSummary: { themesTotal: 1, themesReflectedInCurriculum: 0, themesAbsent: ['Vector databases'], narrative: 'n' },
      enhanceCourses: [enhance],
      newCourseProposals: [], promotionCandidates: [],
      confidence: 0.7, caveats: [CURRICULUM_REVISION_PROVENANCE_CAVEAT],
    });
    expect(parsed.enhanceCourses[0]!.courseCode).toBe('EN241100');
  });

  it('defaults every list so a sparse model response still parses', () => {
    const parsed = ProgramCurriculumRevisionSchema.parse({
      coverageSummary: { themesTotal: 0, themesReflectedInCurriculum: 0, narrative: 'n' },
      confidence: 0.4, caveats: [CURRICULUM_REVISION_PROVENANCE_CAVEAT],
    });
    expect(parsed.enhanceCourses).toEqual([]);
    expect(parsed.newCourseProposals).toEqual([]);
    expect(parsed.promotionCandidates).toEqual([]);
    expect(parsed.coverageSummary.themesAbsent).toEqual([]);
  });

  it('rejects an effort value outside the enum', () => {
    expect(() =>
      ProgramCurriculumRevisionSchema.parse({
        coverageSummary: { themesTotal: 0, themesReflectedInCurriculum: 0, narrative: 'n' },
        enhanceCourses: [{ ...enhance, courseCode: 'X', effort: 'HUGE' }],
        confidence: 0.5, caveats: [CURRICULUM_REVISION_PROVENANCE_CAVEAT],
      }),
    ).toThrow();
  });

  // ── Grounding + proportionality guarantees ────────────────────────────

  it('rejects a payload whose caveats omit the provenance sentence', () => {
    // Every input here is itself AI-extracted (courses, descriptions,
    // themes). A reader who is not told that cannot weigh the advice.
    const base = {
      coverageSummary: { themesTotal: 0, themesReflectedInCurriculum: 0, narrative: 'n' },
      confidence: 0.5,
    };
    expect(() => ProgramCurriculumRevisionSchema.parse({ ...base, caveats: [] })).toThrow();
    expect(() =>
      ProgramCurriculumRevisionSchema.parse({ ...base, caveats: ['some other caveat'] }),
    ).toThrow();
  });

  it('rejects an enhancement with no paper behind it', () => {
    // evidencePaperTitles is the grounding; without one this is an opinion.
    expect(() =>
      ProgramCurriculumRevisionSchema.parse({
        coverageSummary: { themesTotal: 0, themesReflectedInCurriculum: 0, narrative: 'n' },
        enhanceCourses: [{ ...enhance, evidencePaperTitles: [] }],
        confidence: 0.5, caveats: [CURRICULUM_REVISION_PROVENANCE_CAVEAT],
      }),
    ).toThrow();
  });

  it('rejects a zero-credit proposed course', () => {
    expect(() =>
      ProgramCurriculumRevisionSchema.parse({
        coverageSummary: { themesTotal: 0, themesReflectedInCurriculum: 0, narrative: 'n' },
        newCourseProposals: [{
          titleTh: 'x', titleEn: 'x', credits: 0, placementYear: 1, placementSemester: 1,
          themeRefs: ['Vector databases'], rationale: 'r', couldBeTaughtBy: [], evidencePaperTitles: [],
        }],
        confidence: 0.5, caveats: [CURRICULUM_REVISION_PROVENANCE_CAVEAT],
      }),
    ).toThrow();
  });

  it('rejects a padded response that blows the per-lane ceiling', () => {
    // Over-production IS the failure mode; fail the parse rather than
    // silently truncate, so the runner's retry gets a chance.
    expect(() =>
      ProgramCurriculumRevisionSchema.parse({
        coverageSummary: { themesTotal: 0, themesReflectedInCurriculum: 0, narrative: 'n' },
        enhanceCourses: Array.from({ length: 7 }, () => ({ ...enhance })),
        confidence: 0.5, caveats: [CURRICULUM_REVISION_PROVENANCE_CAVEAT],
      }),
    ).toThrow();
  });

  // ── Message construction ──────────────────────────────────────────────

  it('puts the real course list and themes into the user message', () => {
    const [system, user] = buildProgramCurriculumRevisionMessages(input);
    expect(system!.role).toBe('system');
    expect(user!.content).toContain('EN241100');
    expect(user!.content).toContain('โครงสร้างข้อมูล');
    expect(user!.content).toContain('Vector databases');
    // The roster is what makes "who could teach it" answerable.
    expect(user!.content).toContain('Somchai X');
  });

  it('tells the model the course list is closed', () => {
    const [system] = buildProgramCurriculumRevisionMessages(input);
    // The code-level validator drops invented courses, but the prompt must
    // still say so — a dropped recommendation is a wasted one.
    expect(system!.content).toMatch(/only.*courses listed|listed above|do not invent/i);
  });

  it('states the category basis so promotion advice is not invented', () => {
    const withUnknown: CurriculumRevisionInput = {
      ...input,
      courses: [{ ...input.courses[0]!, category: null }],
    };
    const [, user] = buildProgramCurriculumRevisionMessages(withUnknown);
    expect(user!.content).toMatch(/category unknown|no category/i);
  });

  it("renders the extractor's 'UNKNOWN' category exactly like a missing one", () => {
    // program-courses-extract.v4 writes 'UNKNOWN' when it cannot read the
    // หมวด heading — the common case. A bare "UNKNOWN" in the category slot
    // reads as a category the model could treat as promotion evidence.
    const [, unknownStr] = buildProgramCurriculumRevisionMessages({
      ...input,
      courses: [{ ...input.courses[0]!, category: 'UNKNOWN' }],
    });
    const [, nullCat] = buildProgramCurriculumRevisionMessages({
      ...input,
      courses: [{ ...input.courses[0]!, category: null }],
    });
    expect(unknownStr!.content).toBe(nullCat!.content);
    expect(unknownStr!.content).toContain('category unknown — not eligible for promotion advice');
  });

  it('renders a course with no description as "(none on file)"', () => {
    const [, user] = buildProgramCurriculumRevisionMessages({
      ...input,
      courses: [{ ...input.courses[0]!, descriptionTh: '' }],
    });
    expect(user!.content).toContain('description: (none on file)');
  });

  it('THIN evidence gets a numeric warning and a hard recommendation ceiling', () => {
    // "few papers" is a sentiment the model can argue past; a count and a
    // cap are not. Mirrors program-research-expertise's THINNESS WARNING.
    const [, user] = buildProgramCurriculumRevisionMessages({
      ...input, readiness: 'thin', totalDistinctPapers: 4,
    });
    expect(user!.content).toContain('THIN');
    expect(user!.content).toContain('4 distinct paper');
    expect(user!.content).toMatch(/10-paper analysis threshold/);
    expect(user!.content).toMatch(/AT MOST 2 recommendations IN TOTAL/);
  });

  it('states the paper count even when the evidence is adequate', () => {
    const [, user] = buildProgramCurriculumRevisionMessages(input);
    expect(user!.content).toContain('12 distinct paper');
    expect(user!.content).not.toContain('THIN');
  });

  it('states the per-lane ceilings in the prompt, matching the schema', () => {
    const [system] = buildProgramCurriculumRevisionMessages(input);
    expect(system!.content).toContain('At most 6 enhanceCourses');
    expect(system!.content).toContain('4 newCourseProposals');
    expect(system!.content).toContain('3 promotionCandidates');
  });

  it('bans retire/merge/consolidate advice in EVERY field, not just the lanes', () => {
    // This is a policy commitment about staff livelihoods, and the free-text
    // fields (narrative, rationale, caveats) are where it would otherwise
    // leak. The synonym set includes this product's own scenario-planner
    // intervention names.
    const [system] = buildProgramCurriculumRevisionMessages(input);
    for (const word of [
      'removing', 'retiring', 'closing', 'discontinuing', 'suspending',
      'consolidating', 'merging', 'phasing out', 'sunsetting',
    ]) {
      expect(system!.content, `constraint 5 missing "${word}"`).toContain(word);
    }
    expect(system!.content).toMatch(/narrative, rationale/i);
  });

  it('requires the provenance caveat verbatim in the prompt text', () => {
    const [system] = buildProgramCurriculumRevisionMessages(input);
    expect(system!.content).toContain(CURRICULUM_REVISION_PROVENANCE_CAVEAT);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// OUTPUT JSON ↔ schema drift.
//
// The provider sends `responseMimeType: 'application/json'` with NO
// responseSchema (GoogleAiService.extractStructured), so the field names in
// the prompt's OUTPUT JSON block are the ONLY way the model learns what to
// emit. A key renamed on one side and not the other fails every call in the
// bulk run with a parse error — the highest-consequence regression in this
// file, and mechanically checkable.
// ─────────────────────────────────────────────────────────────────────────

function collectSchemaKeys(schema: z.ZodTypeAny, acc: Set<string>): void {
  if (schema instanceof z.ZodObject) {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    for (const [key, child] of Object.entries(shape)) {
      acc.add(key);
      collectSchemaKeys(child as z.ZodTypeAny, acc);
    }
    return;
  }
  if (schema instanceof z.ZodArray) return collectSchemaKeys(schema.element, acc);
  if (schema instanceof z.ZodDefault) return collectSchemaKeys(schema.removeDefault(), acc);
  if (schema instanceof z.ZodOptional || schema instanceof z.ZodNullable) {
    return collectSchemaKeys(schema.unwrap(), acc);
  }
  // `.refine()` wraps its subject in ZodEffects.
  if (schema instanceof z.ZodEffects) return collectSchemaKeys(schema.innerType(), acc);
}

describe('program-curriculum-revision — OUTPUT JSON block matches the schema', () => {
  const [system] = buildProgramCurriculumRevisionMessages(input);
  const block = system!.content.slice(system!.content.indexOf('OUTPUT JSON:'));
  const blockKeys = new Set(
    [...block.matchAll(/"([A-Za-z][A-Za-z0-9]*)"\s*:/g)].map((m) => m[1]!),
  );
  const schemaKeys = new Set<string>();
  collectSchemaKeys(ProgramCurriculumRevisionSchema, schemaKeys);

  it('extracts a non-trivial block (guards the slice itself)', () => {
    expect(block.length).toBeGreaterThan(200);
    expect(blockKeys.size).toBeGreaterThan(20);
  });

  it('shows every schema key to the model', () => {
    const missing = [...schemaKeys].filter((k) => !blockKeys.has(k));
    expect(missing, `schema keys absent from the OUTPUT JSON block: ${missing.join(', ')}`).toEqual([]);
  });

  it('invents no key the schema does not accept', () => {
    const extra = [...blockKeys].filter((k) => !schemaKeys.has(k));
    expect(extra, `OUTPUT JSON keys absent from the schema: ${extra.join(', ')}`).toEqual([]);
  });
});
