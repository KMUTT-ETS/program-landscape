import { describe, expect, it } from 'vitest';
import {
  DIGEST_REVIEW_STATUSES,
  isEmbeddableMajorCourse,
  parseCareers,
  planCourseDescriptionUpdates,
  planPloRows,
} from '../src/program-overlap/prep';

describe('planPloRows', () => {
  it('numbers PLOs, normalises text and drops blanks', () => {
    expect(planPloRows(['PLO 1 ก', '  ', 'PLO 2: ข'])).toEqual([
      { ordinal: 1, textTh: 'PLO 1 ก', textNormalised: 'ก' },
      { ordinal: 2, textTh: 'PLO 2: ข', textNormalised: 'ข' },
    ]);
  });
});

describe('planCourseDescriptionUpdates', () => {
  it('matches digest courses to programme courses by normalised code', () => {
    const updates = planCourseDescriptionUpdates(
      [
        { id: 'pc1', courseCode: 'EN241100' },
        { id: 'pc2', courseCode: 'SC401201' },
      ],
      [
        { code: 'EN 241 100', descriptionTh: 'คำอธิบาย', learningOutcomesTh: ['ก'] },
        { code: 'XX000000', descriptionTh: 'ไม่ตรง', learningOutcomesTh: [] },
      ],
    );
    expect(updates).toEqual([{ id: 'pc1', descriptionTh: 'คำอธิบาย', learningOutcomesTh: ['ก'] }]);
  });

  it('skips digest courses with no description', () => {
    expect(
      planCourseDescriptionUpdates([{ id: 'pc1', courseCode: 'EN241100' }], [{ code: 'EN241100', descriptionTh: null }]),
    ).toEqual([]);
  });
});

describe('parseCareers', () => {
  it('accepts a string array, an object array, and garbage', () => {
    expect(parseCareers(['ก', ' ', 'ข'])).toEqual(['ก', 'ข']);
    expect(parseCareers([{ titleTh: 'ก' }, { titleEn: 'x' }])).toEqual(['ก']);
    expect(parseCareers(null)).toEqual([]);
    expect(parseCareers({ a: 1 })).toEqual([]);
  });
});

describe('isEmbeddableMajorCourse (D7: every major course, described or not)', () => {
  const named = { courseNameTh: 'วิชา', courseNameEn: null };
  it('embeds major and uncategorised courses on names alone', () => {
    for (const category of ['CORE', 'MAJOR_REQUIRED', 'MAJOR_ELECTIVE', 'UNKNOWN', null] as const) {
      expect(isEmbeddableMajorCourse({ category, ...named })).toBe(true);
    }
    expect(isEmbeddableMajorCourse({ category: 'CORE', courseNameTh: null, courseNameEn: 'Course' })).toBe(true);
  });
  it('excludes non-major categories', () => {
    for (const category of ['GENERAL_EDUCATION', 'FREE_ELECTIVE', 'THESIS_PROJECT'] as const) {
      expect(isEmbeddableMajorCourse({ category, ...named })).toBe(false);
    }
  });
  it('skips a course with neither name', () => {
    expect(isEmbeddableMajorCourse({ category: 'CORE', courseNameTh: null, courseNameEn: '  ' })).toBe(false);
  });
});

describe('DIGEST_REVIEW_STATUSES', () => {
  it('reads approved and auto-approved digests, nothing else', () => {
    expect([...DIGEST_REVIEW_STATUSES].sort()).toEqual(['APPROVED', 'AUTO_APPROVED']);
  });
});
