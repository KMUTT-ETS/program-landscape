import { describe, expect, it } from 'vitest';
import { buildRosterLookup, matchRosterName, stripAcademicTitles } from '../src/program-faculty/name-match';

const roster = buildRosterLookup([
  { id: 'a', nameTh: 'สมมติ ทดสอบ', nameEn: 'Somsak Testing' },
  { id: 'b', nameTh: 'ตัวอย่าง ใจดี', nameEn: 'Example Jaidee' },
  { id: 'c', nameTh: 'ซ้ำ ชื่อ', nameEn: null },
  { id: 'd', nameTh: 'ซ้ำ ชื่อ', nameEn: null },
]);

describe('stripAcademicTitles', () => {
  it('strips Thai, English, combined and medical titles', () => {
    expect(stripAcademicTitles('ผศ.ดร. สมมติ ทดสอบ')).toBe('สมมติ ทดสอบ');
    expect(stripAcademicTitles('ผศ.นพ.สมมติ ทดสอบ')).toBe('สมมติ ทดสอบ');
    expect(stripAcademicTitles('รองศาสตราจารย์ นางสาว สมมติ ทดสอบ')).toBe('สมมติ ทดสอบ');
    expect(stripAcademicTitles('Asst. Prof. Dr. Somsak Testing')).toBe('somsak testing');
    expect(stripAcademicTitles('Associate Professor Dr Somsak  Testing')).toBe('somsak testing');
    expect(stripAcademicTitles('Mrs. Example Jaidee')).toBe('example jaidee');
  });
  it('leaves bare names alone', () => {
    expect(stripAcademicTitles('สมมติ ทดสอบ')).toBe('สมมติ ทดสอบ');
    expect(stripAcademicTitles('Drake Example')).toBe('drake example');
  });
});

describe('matchRosterName', () => {
  it('matches a titled Thai name', () => {
    expect(matchRosterName(roster, { nameTh: 'ผศ.ดร. สมมติ ทดสอบ' })).toBe('a');
  });
  it('matches titled English names in either order', () => {
    expect(matchRosterName(roster, { nameTh: 'ไม่มี', nameEn: 'Asst. Prof. Dr. Somsak Testing' })).toBe('a');
    expect(matchRosterName(roster, { nameEn: 'Dr. Testing Somsak' })).toBe('a');
  });
  it('still matches bare KKU-style names', () => {
    expect(matchRosterName(roster, { nameTh: 'ตัวอย่าง ใจดี' })).toBe('b');
  });
  it('refuses an ambiguous key', () => {
    expect(matchRosterName(roster, { nameTh: 'ซ้ำ ชื่อ' })).toBeNull();
  });
  it('returns null when nothing matches', () => {
    expect(matchRosterName(roster, { nameTh: 'ไม่พบ คนนี้', nameEn: 'No One' })).toBeNull();
  });
});
