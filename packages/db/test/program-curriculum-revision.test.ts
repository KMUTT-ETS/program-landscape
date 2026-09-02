import { describe, it, expect } from 'vitest';
import { validateCurriculumRevisionPayload } from '../src/program-curriculum-revision';
import { CURRICULUM_REVISION_PROVENANCE_CAVEAT, type ProgramCurriculumRevision } from '@kku/shared';

const ctx = {
  validCourseCodes: new Set(['EN241100', 'EN241200']),
  categoryByCourseCode: new Map<string, string | null>([
    ['EN241100', 'MAJOR_ELECTIVE'],
    ['EN241200', 'MAJOR_REQUIRED'],
  ]),
  validThemeNames: new Set(['Vector databases', 'Graph learning']),
  descriptionByCourseCode: new Map([
    ['EN241100', 'ศึกษาโครงสร้างข้อมูลพื้นฐาน  เช่น array และ linked list'],
    ['EN241200', 'ระบบปฏิบัติการเบื้องต้น'],
  ]),
};

function payload(over: Partial<ProgramCurriculumRevision> = {}): ProgramCurriculumRevision {
  return {
    coverageSummary: { themesTotal: 2, themesReflectedInCurriculum: 1, themesAbsent: [], narrative: 'n' },
    enhanceCourses: [], newCourseProposals: [], promotionCandidates: [],
    // caveats is .min(1).refine()'d to require the provenance sentence —
    // an empty array is not a payload the schema can produce, so the
    // fixture carries the real constant rather than [].
    confidence: 0.7, caveats: [CURRICULUM_REVISION_PROVENANCE_CAVEAT], ...over,
  } as ProgramCurriculumRevision;
}

const enhance = (over: Record<string, unknown> = {}) => ({
  courseCode: 'EN241100', courseNameTh: 'โครงสร้างข้อมูล',
  currentlyCoversQuote: 'ศึกษาโครงสร้างข้อมูลพื้นฐาน',
  themeRefs: ['Vector databases'], addition: 'a', additionDetail: 'd',
  effort: 'MINOR' as const, evidencePaperTitles: ['A survey of vector indexing'], ...over,
});

describe('validateCurriculumRevisionPayload', () => {
  it('keeps a fully valid recommendation untouched', () => {
    const { payload: out, drops } = validateCurriculumRevisionPayload(payload({ enhanceCourses: [enhance()] }), ctx);
    expect(out.enhanceCourses).toHaveLength(1);
    expect(drops.enhanceCoursesDropped).toBe(0);
  });

  it('DROPS an enhancement naming a course that does not exist', () => {
    // The core guarantee: a reader can always look up the course named.
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ enhanceCourses: [enhance(), enhance({ courseCode: 'ZZ999999' })] }), ctx,
    );
    expect(out.enhanceCourses).toHaveLength(1);
    expect(out.enhanceCourses[0]!.courseCode).toBe('EN241100');
    expect(drops.enhanceCoursesDropped).toBe(1);
  });

  it('drops invalid theme refs but keeps the item when a valid ref remains', () => {
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ enhanceCourses: [enhance({ themeRefs: ['Vector databases', 'Invented theme'] })] }), ctx,
    );
    expect(out.enhanceCourses[0]!.themeRefs).toEqual(['Vector databases']);
    expect(drops.themeRefsDropped).toBe(1);
  });

  it('drops the whole item when every theme ref was invented', () => {
    // An untethered recommendation has no evidence chain left.
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ enhanceCourses: [enhance({ themeRefs: ['Invented'] })] }), ctx,
    );
    expect(out.enhanceCourses).toHaveLength(0);
    expect(drops.enhanceCoursesDropped).toBe(1);
  });

  it('blanks a non-verbatim quote but KEEPS the recommendation', () => {
    // A paraphrased quote is a citation defect, not necessarily bad advice.
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ enhanceCourses: [enhance({ currentlyCoversQuote: 'this text is nowhere in the description' })] }), ctx,
    );
    expect(out.enhanceCourses).toHaveLength(1);
    expect(out.enhanceCourses[0]!.currentlyCoversQuote).toBe('');
    expect(drops.quotesBlanked).toBe(1);
  });

  it('accepts a verbatim quote whose whitespace differs from the source', () => {
    // The source has a double space; the model returned a single one.
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ enhanceCourses: [enhance({ currentlyCoversQuote: 'ศึกษาโครงสร้างข้อมูลพื้นฐาน เช่น array' })] }), ctx,
    );
    expect(out.enhanceCourses[0]!.currentlyCoversQuote).not.toBe('');
    expect(drops.quotesBlanked).toBe(0);
  });

  it('drops a promotion candidate naming an unknown course', () => {
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ promotionCandidates: [
        { courseCode: 'ZZ999999', courseNameTh: 'x', currentCategory: 'MAJOR_ELECTIVE', proposedCategory: 'MAJOR_REQUIRED', themeRefs: ['Vector databases'], rationale: 'r' },
      ] }), ctx,
    );
    expect(out.promotionCandidates).toHaveLength(0);
    expect(drops.promotionCandidatesDropped).toBe(1);
  });

  it('drops a promotion candidate for a course that is not MAJOR_ELECTIVE', () => {
    // EN241200 is MAJOR_REQUIRED — there is no promotion to make. The prompt
    // states this rule; the validator is what enforces it.
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ promotionCandidates: [
        { courseCode: 'EN241200', courseNameTh: 'x', currentCategory: 'MAJOR_REQUIRED', proposedCategory: 'MAJOR_REQUIRED', themeRefs: ['Vector databases'], rationale: 'r' },
      ] }), ctx,
    );
    expect(out.promotionCandidates).toHaveLength(0);
    expect(drops.promotionsNotElective).toBe(1);
  });

  it('keeps a promotion candidate that IS MAJOR_ELECTIVE', () => {
    const { payload: out } = validateCurriculumRevisionPayload(
      payload({ promotionCandidates: [
        { courseCode: 'EN241100', courseNameTh: 'x', currentCategory: 'MAJOR_ELECTIVE', proposedCategory: 'MAJOR_REQUIRED', themeRefs: ['Vector databases'], rationale: 'r' },
      ] }), ctx,
    );
    expect(out.promotionCandidates).toHaveLength(1);
  });

  it('drops a new-course proposal whose theme refs are all invented', () => {
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ newCourseProposals: [
        { titleTh: 'ก', titleEn: 'A', credits: 3, placementYear: 3, placementSemester: 1, themeRefs: ['Nope'], rationale: 'r', couldBeTaughtBy: [], evidencePaperTitles: [] },
      ] }), ctx,
    );
    expect(out.newCourseProposals).toHaveLength(0);
    expect(drops.newCourseProposalsDropped).toBe(1);
  });

  it('filters themesAbsent down to real theme names', () => {
    const { payload: out } = validateCurriculumRevisionPayload(
      payload({ coverageSummary: { themesTotal: 2, themesReflectedInCurriculum: 0, themesAbsent: ['Graph learning', 'Invented'], narrative: 'n' } }), ctx,
    );
    expect(out.coverageSummary.themesAbsent).toEqual(['Graph learning']);
  });

  it('reports zero drops for an empty payload', () => {
    const { drops } = validateCurriculumRevisionPayload(payload(), ctx);
    expect(drops).toEqual({
      enhanceCoursesDropped: 0, newCourseProposalsDropped: 0,
      promotionCandidatesDropped: 0, themeRefsDropped: 0, quotesBlanked: 0,
      promotionsNotElective: 0,
    });
  });
});
