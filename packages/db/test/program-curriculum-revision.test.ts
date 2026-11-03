import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { validateCurriculumRevisionPayload } from '../src/program-curriculum-revision';
import { normaliseCourseCode } from '../src/course-code-normalise';
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
  // The second title carries a double space, mirroring how a real title
  // arrives out of a PDF — the model reflowing it must still match.
  validPaperTitles: new Set([
    'A survey of vector indexing',
    'Graph neural nets for  citation  graphs',
  ]),
  // name → that person's ACTUAL rank. The keys double as the roster's
  // name set; the values are what stops a real person being promoted.
  validRosterRanks: new Map([['Somchai Jaidee', 'ASSOC_PROF']]),
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

  it('drops an invented evidence paper title but keeps the enhancement when a real one remains', () => {
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ enhanceCourses: [enhance({
        evidencePaperTitles: ['A survey of vector indexing', 'Scalable HNSW indexing for Thai corpora'],
      })] }), ctx,
    );
    expect(out.enhanceCourses[0]!.evidencePaperTitles).toEqual(['A survey of vector indexing']);
    expect(drops.evidenceTitlesDropped).toBe(1);
  });

  it('DROPS an enhancement whose evidence titles were all invented', () => {
    // The schema requires min 1 evidence title on this lane precisely because
    // an enhancement with no paper behind it is an opinion, not a finding.
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ enhanceCourses: [enhance({ evidencePaperTitles: ['A paper nobody wrote'] })] }), ctx,
    );
    expect(out.enhanceCourses).toHaveLength(0);
    expect(drops.enhanceCoursesDropped).toBe(1);
    expect(drops.evidenceTitlesDropped).toBe(1);
  });

  it('accepts an evidence title whose whitespace differs from the source', () => {
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ enhanceCourses: [enhance({
        evidencePaperTitles: ['Graph neural nets for citation graphs'],
      })] }), ctx,
    );
    expect(out.enhanceCourses).toHaveLength(1);
    expect(drops.evidenceTitlesDropped).toBe(0);
  });

  it('filters a new-course proposal evidence title without dropping the proposal', () => {
    // This lane's grounding is themeRefs; evidence titles are supporting.
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ newCourseProposals: [
        { titleTh: 'ก', titleEn: 'A', credits: 3, placementYear: 3, placementSemester: 1, themeRefs: ['Graph learning'], rationale: 'r', couldBeTaughtBy: [], evidencePaperTitles: ['Invented paper'] },
      ] }), ctx,
    );
    expect(out.newCourseProposals).toHaveLength(1);
    expect(out.newCourseProposals[0]!.evidencePaperTitles).toEqual([]);
    expect(drops.evidenceTitlesDropped).toBe(1);
    expect(drops.newCourseProposalsDropped).toBe(0);
  });

  it('removes an invented roster name but KEEPS the proposal', () => {
    // Naming a person who does not teach here is a claim about a real
    // individual; losing the name only weakens the recommendation.
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ newCourseProposals: [
        { titleTh: 'ก', titleEn: 'A', credits: 3, placementYear: 3, placementSemester: 1, themeRefs: ['Graph learning'], rationale: 'r',
          couldBeTaughtBy: [{ name: 'Somchai Jaidee', rank: 'ASSOC_PROF' }, { name: 'Ghost Person', rank: 'PROF' }],
          evidencePaperTitles: [] },
      ] }), ctx,
    );
    expect(out.newCourseProposals).toHaveLength(1);
    expect(out.newCourseProposals[0]!.couldBeTaughtBy).toEqual([{ name: 'Somchai Jaidee', rank: 'ASSOC_PROF' }]);
    expect(drops.rosterNamesDropped).toBe(1);
  });

  it('removes a roster entry whose rank does not match the real one', () => {
    // Somchai is an ASSOC_PROF. Promoting a real person in front of Council
    // is the same harm class as naming someone who does not exist.
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ newCourseProposals: [
        { titleTh: 'ก', titleEn: 'A', credits: 3, placementYear: 3, placementSemester: 1, themeRefs: ['Graph learning'], rationale: 'r',
          couldBeTaughtBy: [{ name: 'Somchai Jaidee', rank: 'PROF' }],
          evidencePaperTitles: [] },
      ] }), ctx,
    );
    expect(out.newCourseProposals).toHaveLength(1);
    expect(out.newCourseProposals[0]!.couldBeTaughtBy).toEqual([]);
    expect(drops.rosterNamesDropped).toBe(1);
  });

  it('skips the evidence-title check when there is nothing to check against', () => {
    // An empty validation set carries no information — it cannot tell an
    // invented title from "we have no corpus", so it must not reject
    // everything and read downstream as "the model produced nothing".
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ enhanceCourses: [enhance()] }),
      { ...ctx, validPaperTitles: new Set<string>() },
    );
    expect(out.enhanceCourses).toHaveLength(1);
    expect(drops.enhanceCoursesDropped).toBe(0);
    expect(drops.evidenceTitlesDropped).toBe(0);
    expect(drops.evidenceCheckSkipped).toBe(true);
  });

  it('blanks a quote too short to be a citation', () => {
    // 'array' is a substring of almost any description and conveys nothing.
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ enhanceCourses: [enhance({ currentlyCoversQuote: 'array' })] }), ctx,
    );
    expect(out.enhanceCourses).toHaveLength(1);
    expect(out.enhanceCourses[0]!.currentlyCoversQuote).toBe('');
    expect(drops.quotesBlanked).toBe(1);
  });

  it('counts an omitted quote as missing without dropping the recommendation', () => {
    // Previously "no citation at all" scored identically to a perfect one.
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ enhanceCourses: [enhance({ currentlyCoversQuote: '' })] }), ctx,
    );
    expect(out.enhanceCourses).toHaveLength(1);
    expect(drops.quotesMissing).toBe(1);
    expect(drops.quotesBlanked).toBe(0);
  });

  it('counts an unverifiable course code in prose without dropping', () => {
    // EN241100 is real and must not be counted; EN999999 is not.
    const { payload: out, drops } = validateCurriculumRevisionPayload(
      payload({ enhanceCourses: [enhance({
        addition: 'Add HNSW indexing; EN241100 and EN999999 already cover the basics',
      })] }), ctx,
    );
    expect(out.enhanceCourses).toHaveLength(1);
    expect(drops.proseCourseCodesUnverified).toBe(1);
  });

  it('counts both a loose 5-digit code and a 3-digit code in prose', () => {
    const { drops } = validateCurriculumRevisionPayload(
      payload({ enhanceCourses: [enhance({
        addition: 'Add HNSW indexing; EN 24110 and MEE 221 already cover the basics',
      })] }), ctx,
    );
    expect(drops.proseCourseCodesUnverified).toBe(2);
  });

  it('reports zero drops for an empty payload', () => {
    const { drops } = validateCurriculumRevisionPayload(payload(), ctx);
    expect(drops).toEqual({
      enhanceCoursesDropped: 0, newCourseProposalsDropped: 0,
      promotionCandidatesDropped: 0, themeRefsDropped: 0, quotesBlanked: 0,
      promotionsNotElective: 0, evidenceTitlesDropped: 0, rosterNamesDropped: 0,
      quotesMissing: 0, proseCourseCodesUnverified: 0, evidenceCheckSkipped: false,
    });
  });
});

describe('normaliseCourseCode stays in lockstep with the ingestion copy', () => {
  it('produces the same output as the ingestion implementation', () => {
    // The ingestion copy produced every ProgramCourse.courseCode in the DB.
    // If these diverge, digest descriptions silently stop matching courses.
    const ingestionSrc = readFileSync(
      path.join(__dirname, '..', '..', '..', 'apps', 'ingestion', 'src', 'lib', 'course-code.ts'),
      'utf8',
    );
    const body = /export function normaliseCourseCode[\s\S]*?\n}/.exec(ingestionSrc)?.[0];
    expect(body, 'ingestion normaliseCourseCode not found').toBeTruthy();
    expect(body).toContain(`replace(/\\s+/g, '').toUpperCase()`);
  });

  it('strips whitespace and upper-cases', () => {
    expect(normaliseCourseCode('en 241 100')).toBe('EN241100');
    expect(normaliseCourseCode(null)).toBe('');
    expect(normaliseCourseCode(undefined)).toBe('');
    expect(normaliseCourseCode('')).toBe('');
  });
});
