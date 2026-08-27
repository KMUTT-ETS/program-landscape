import { describe, expect, it } from 'vitest';

import {
  EVAL_ROW_SCHEMA,
  QUESTION_ROW_SCHEMA,
  inferThemeTag,
  isCoreFromSemestersUsed,
  normaliseCourseCode,
  normaliseKkumail,
  parseLastUpdate,
  questionTextHash,
} from '../../src/connectors/sources/kku-evaluations/transforms';

describe('questionTextHash', () => {
  it('is deterministic for the same input', () => {
    const a = questionTextHash('นักศึกษาได้รับการชี้แจ้งหรือมีส่วนร่วม');
    const b = questionTextHash('นักศึกษาได้รับการชี้แจ้งหรือมีส่วนร่วม');
    expect(a).toBe(b);
    expect(a).toHaveLength(16);
  });

  it('normalises whitespace (drops trailing tabs that registrar adds)', () => {
    // Phase 0 found QID 36-39 carry a leading tab character. Hash must
    // collide with the cleaned form so we don't get phantom versions.
    const noisy = questionTextHash('\tความสามารถทางการเขียนของข้าพเจ้าดีขึ้น  ');
    const clean = questionTextHash('ความสามารถทางการเขียนของข้าพเจ้าดีขึ้น');
    expect(noisy).toBe(clean);
  });

  it('different text → different hash', () => {
    const a = questionTextHash('Question A');
    const b = questionTextHash('Question B');
    expect(a).not.toBe(b);
  });

  it('handles null + empty', () => {
    expect(questionTextHash(null)).toBe(questionTextHash(''));
    expect(questionTextHash(null)).toHaveLength(16);
  });
});

describe('normaliseCourseCode', () => {
  it('trims + uppercases + strips internal whitespace', () => {
    expect(normaliseCourseCode(' en241100 ')).toBe('EN241100');
    expect(normaliseCourseCode('en 24 1100')).toBe('EN241100');
    expect(normaliseCourseCode('318305')).toBe('318305');
  });
});

describe('normaliseKkumail', () => {
  it('lowercases + trims', () => {
    expect(normaliseKkumail(' Somchai@KKU.AC.TH ')).toBe('somchai@kku.ac.th');
  });

  it('collapses empties to null', () => {
    expect(normaliseKkumail('')).toBeNull();
    expect(normaliseKkumail('   ')).toBeNull();
    expect(normaliseKkumail(null)).toBeNull();
  });
});

describe('parseLastUpdate', () => {
  it('accepts Date instances', () => {
    const d = new Date('2026-05-19T08:56:21.000Z');
    expect(parseLastUpdate(d)).toEqual(d);
  });

  it('parses string timestamps', () => {
    const r = parseLastUpdate('2026-05-19T08:56:21.000Z');
    expect(r).toBeInstanceOf(Date);
    expect(r?.toISOString()).toBe('2026-05-19T08:56:21.000Z');
  });

  it('null when invalid', () => {
    expect(parseLastUpdate(null)).toBeNull();
    expect(parseLastUpdate('not-a-date')).toBeNull();
  });
});

describe('isCoreFromSemestersUsed', () => {
  it('core when ≥95% of buckets', () => {
    expect(isCoreFromSemestersUsed(21, 21)).toBe(true);
    expect(isCoreFromSemestersUsed(20, 21)).toBe(true); // 95.2%
    expect(isCoreFromSemestersUsed(19, 21)).toBe(false); // 90.5%
  });

  it('not core when total is 0', () => {
    expect(isCoreFromSemestersUsed(0, 0)).toBe(false);
  });
});

describe('inferThemeTag', () => {
  it('tags ethics from core question 4 prompt', () => {
    expect(inferThemeTag('ผู้สอนมีการสอดแทรกคุณธรรม จริยธรรม จรรยาบรรณ')).toBe('ethics');
  });

  it('tags active-learning', () => {
    expect(inferThemeTag('ผู้สอนมีกิจกรรมการเรียนการสอนที่เน้นให้ผู้เรียนมีส่วนร่วม')).toBe('active-learning');
  });

  it('tags assessment', () => {
    expect(inferThemeTag('ผู้สอนมีการวัดและประเมินผลด้วยวิธีการที่หลากหลาย')).toBe('assessment');
  });

  it('tags english-skills (the specialised questionnaire 33-40)', () => {
    expect(inferThemeTag('ความสามารถทางการฟังของข้าพเจ้าดีขึ้น')).toBe('english-skills');
    expect(inferThemeTag('ระดับความสามารถทางภาษาอังกฤษก่อนเรียน')).toBe('english-skills');
  });

  it('returns null on no match / null input', () => {
    expect(inferThemeTag('completely unrelated text')).toBeNull();
    expect(inferThemeTag(null)).toBeNull();
  });
});

describe('EVAL_ROW_SCHEMA', () => {
  it('parses a realistic sample row', () => {
    const result = EVAL_ROW_SCHEMA.safeParse({
      ACADYEAR: 2568,
      SEMESTER: 1,
      CAMPUSID: 1,
      FACULTYID: 2,
      COURSECODE: '318305',
      COURSENAME: 'ชีวเคมี',
      COURSENAMEENG: 'BIOCHEMISTRY',
      CLASSID: 694392,
      SECTION: 1,
      QUESTIONID: '01',
      OFFICERID: 16871,
      KKUMAIL: 'somchai@kku.ac.th',
      RATING_AVG: 4.5,
      RESPONDENT_COUNT: 5,
      LAST_UPDATE: '2026-05-19T08:56:21.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('coerces numeric strings (Oracle sometimes returns Decimal as string)', () => {
    const result = EVAL_ROW_SCHEMA.safeParse({
      ACADYEAR: 2568,
      SEMESTER: 1,
      CAMPUSID: 1,
      FACULTYID: 2,
      COURSECODE: '318305',
      COURSENAME: null,
      COURSENAMEENG: null,
      CLASSID: '694392',
      SECTION: 1,
      QUESTIONID: '01',
      OFFICERID: 16871,
      KKUMAIL: null,
      RATING_AVG: '4.5',
      RESPONDENT_COUNT: '5',
      LAST_UPDATE: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.RATING_AVG).toBe(4.5);
      expect(result.data.RESPONDENT_COUNT).toBe(5);
      expect(typeof result.data.CLASSID).toBe('bigint');
    }
  });

  it('rejects respondentCount < 5 (anonymity gate)', () => {
    const result = EVAL_ROW_SCHEMA.safeParse({
      ACADYEAR: 2568,
      SEMESTER: 1,
      CAMPUSID: 1,
      FACULTYID: 2,
      COURSECODE: '318305',
      COURSENAME: null,
      COURSENAMEENG: null,
      CLASSID: 694392,
      SECTION: 1,
      QUESTIONID: '01',
      OFFICERID: 16871,
      KKUMAIL: null,
      RATING_AVG: 4.5,
      RESPONDENT_COUNT: 4,
      LAST_UPDATE: null,
    });
    expect(result.success).toBe(false);
  });

  it('rejects RATING_AVG out of [0, 5]', () => {
    const bad = EVAL_ROW_SCHEMA.safeParse({
      ACADYEAR: 2568, SEMESTER: 1, CAMPUSID: 1, FACULTYID: 2,
      COURSECODE: '318305', COURSENAME: null, COURSENAMEENG: null,
      CLASSID: 694392, SECTION: 1, QUESTIONID: '01', OFFICERID: 16871,
      KKUMAIL: null, RATING_AVG: 5.1, RESPONDENT_COUNT: 5, LAST_UPDATE: null,
    });
    expect(bad.success).toBe(false);
  });
});

describe('QUESTION_ROW_SCHEMA', () => {
  it('parses a Q1 row', () => {
    const result = QUESTION_ROW_SCHEMA.safeParse({
      QUESTIONID: '01',
      QUESTION_TEXT_TH: 'นักศึกษาได้รับรู้และเข้าใจผลลัพธ์การเรียนรู้',
      FIRST_SEEN_YEAR_BE: 2564,
      LAST_SEEN_YEAR_BE: 2568,
      SEMESTERS_USED: 21,
    });
    expect(result.success).toBe(true);
  });

  it('accepts null question text (registrar sometimes ships empty)', () => {
    const result = QUESTION_ROW_SCHEMA.safeParse({
      QUESTIONID: '99',
      QUESTION_TEXT_TH: null,
      FIRST_SEEN_YEAR_BE: 2568,
      LAST_SEEN_YEAR_BE: 2568,
      SEMESTERS_USED: 1,
    });
    expect(result.success).toBe(true);
  });
});
