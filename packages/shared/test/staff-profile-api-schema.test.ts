import { describe, expect, it } from 'vitest';
import {
  STAFF_PROFILE_SECTIONS,
  STAFF_PROFILE_SECTION_LABELS,
  StaffProfileLookupSchema,
  StaffProfileResponseDataSchema,
} from '../src/staff-profile/api-schema';

describe('StaffProfileLookupSchema', () => {
  it('accepts a valid citizen id and normalises it', () => {
    const r = StaffProfileLookupSchema.safeParse({ citizenId: '1-1017-00203-88-3' });
    expect(r.success && r.data).toEqual({ citizenId: '1101700203883' });
  });
  it('rejects a citizen id failing the checksum', () => {
    expect(StaffProfileLookupSchema.safeParse({ citizenId: '1101700203884' }).success).toBe(false);
  });
  it('accepts an email and lowercases it', () => {
    const r = StaffProfileLookupSchema.safeParse({ email: ' Someone@KKU.ac.th ' });
    expect(r.success && r.data).toEqual({ email: 'someone@kku.ac.th' });
  });
  it('rejects both identifiers, neither, and unknown keys', () => {
    expect(StaffProfileLookupSchema.safeParse({ citizenId: '1101700203883', email: 'a@kku.ac.th' }).success).toBe(false);
    expect(StaffProfileLookupSchema.safeParse({}).success).toBe(false);
    expect(StaffProfileLookupSchema.safeParse({ email: 'a@kku.ac.th', extra: 1 }).success).toBe(false);
  });
});

describe('teachingEvaluation section', () => {
  const person = {
    facultyMemberId: 'fm1',
    isActive: true,
    title: { th: 'อาจารย์', en: 'Lecturer', abbrevTh: 'อ.', abbrevEn: 'Lect.' },
    name: { th: 'ก', en: 'A' },
    displayName: { th: 'ก', en: 'A' },
    email: null,
    identifiers: { orcid: null, scopusAuthorId: null, openalexAuthorId: null, scholarProfileId: null },
  };
  const evaluation = {
    scale: { min: 1, max: 5 },
    overall: 4.35,
    totalAnswers: 1880,
    courseCount: 1,
    termCount: 3,
    firstYearBE: 2566,
    lastYearBE: 2568,
    latestYearBE: 2568,
    latestRating: 4.4,
    previousYearBE: 2567,
    previousRating: 4.3,
    categories: [
      { tag: 'ethics', labelEn: 'Ethics', labelTh: 'คุณธรรมจริยธรรม', questions: 2, latest: 4.5, allTime: 4.4 },
    ],
    untaggedQuestions: 0,
    courses: [
      { code: '000101', nameTh: null, nameEn: 'X', rating: 4.3, answers: 1880, latestYearBE: 2568, latestSemester: 2 },
    ],
  };

  it('is a grantable section, listed last so existing grants keep their order', () => {
    expect(STAFF_PROFILE_SECTIONS.at(-1)).toBe('teachingEvaluation');
  });

  it('has a readable label for every section', () => {
    for (const s of STAFF_PROFILE_SECTIONS) expect(STAFF_PROFILE_SECTION_LABELS[s]).toMatch(/\S/);
    expect(STAFF_PROFILE_SECTION_LABELS.teachingEvaluation).toBe('Teaching evaluation');
  });

  it('accepts the section populated, null (granted, nothing on record) and absent', () => {
    expect(StaffProfileResponseDataSchema.safeParse({ person, teachingEvaluation: evaluation }).success).toBe(true);
    expect(StaffProfileResponseDataSchema.safeParse({ person, teachingEvaluation: null }).success).toBe(true);
    expect(StaffProfileResponseDataSchema.safeParse({ person }).success).toBe(true);
  });

  it('pins the 1-5 scale', () => {
    const bad = { ...evaluation, scale: { min: 0, max: 5 } };
    expect(StaffProfileResponseDataSchema.safeParse({ person, teachingEvaluation: bad }).success).toBe(false);
  });
});
