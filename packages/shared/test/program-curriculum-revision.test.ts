import { describe, it, expect } from 'vitest';
import {
  PROGRAM_CURRICULUM_REVISION_VERSION,
  ProgramCurriculumRevisionSchema,
  buildProgramCurriculumRevisionMessages,
  type CurriculumRevisionInput,
} from '../src/ai/prompts/program-curriculum-revision';

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
};

describe('program-curriculum-revision prompt', () => {
  it('is stamped v1', () => {
    expect(PROGRAM_CURRICULUM_REVISION_VERSION).toBe('program-curriculum-revision.v1');
  });

  it('parses a well-formed payload', () => {
    const parsed = ProgramCurriculumRevisionSchema.parse({
      coverageSummary: { themesTotal: 1, themesReflectedInCurriculum: 0, themesAbsent: ['Vector databases'], narrative: 'n' },
      enhanceCourses: [{
        courseCode: 'EN241100', courseNameTh: 'โครงสร้างข้อมูล',
        currentlyCoversQuote: 'ศึกษาโครงสร้างข้อมูลพื้นฐาน',
        themeRefs: ['Vector databases'], addition: 'Add vector indexing',
        additionDetail: 'A 3-hour module.', effort: 'MINOR',
        evidencePaperTitles: ['A survey of vector indexing'],
      }],
      newCourseProposals: [], promotionCandidates: [],
      confidence: 0.7, caveats: [],
    });
    expect(parsed.enhanceCourses[0]!.courseCode).toBe('EN241100');
  });

  it('defaults every list so a sparse model response still parses', () => {
    const parsed = ProgramCurriculumRevisionSchema.parse({
      coverageSummary: { themesTotal: 0, themesReflectedInCurriculum: 0, narrative: 'n' },
      confidence: 0.4,
    });
    expect(parsed.enhanceCourses).toEqual([]);
    expect(parsed.newCourseProposals).toEqual([]);
    expect(parsed.promotionCandidates).toEqual([]);
    expect(parsed.caveats).toEqual([]);
    expect(parsed.coverageSummary.themesAbsent).toEqual([]);
  });

  it('rejects an effort value outside the enum', () => {
    expect(() =>
      ProgramCurriculumRevisionSchema.parse({
        coverageSummary: { themesTotal: 0, themesReflectedInCurriculum: 0, narrative: 'n' },
        enhanceCourses: [{
          courseCode: 'X', courseNameTh: 'x', currentlyCoversQuote: 'q', themeRefs: ['t'],
          addition: 'a', additionDetail: 'd', effort: 'HUGE', evidencePaperTitles: [],
        }],
        confidence: 0.5,
      }),
    ).toThrow();
  });

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
    expect(system!.content).toMatch(/only.*courses listed|listed above|do not invent|CLOSED/i);
  });

  it('states the category basis so promotion advice is not invented', () => {
    const withUnknown: CurriculumRevisionInput = {
      ...input,
      courses: [{ ...input.courses[0]!, category: null }],
    };
    const [, user] = buildProgramCurriculumRevisionMessages(withUnknown);
    expect(user!.content).toMatch(/category unknown|no category/i);
  });
});
