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

import { rosterDegradedNote } from '../src/program-faculty/name-match';

describe('fix round 1', () => {
  it('does not fall through from an ambiguous key to the swapped kind', () => {
    const l = buildRosterLookup([
      { id: '1', nameTh: null, nameEn: 'A B' },
      { id: '2', nameTh: null, nameEn: 'A B' },
      { id: '3', nameTh: null, nameEn: 'B A' },
    ]);
    expect(matchRosterName(l, { nameEn: 'a b' })).toBeNull();
  });
  it('prefers the single active member among duplicates', () => {
    const l = buildRosterLookup([
      { id: 'old', nameTh: 'ซ้ำ ชื่อ', nameEn: null, isActive: false },
      { id: 'new', nameTh: 'ซ้ำ ชื่อ', nameEn: null, isActive: true },
    ]);
    expect(matchRosterName(l, { nameTh: 'ซ้ำ ชื่อ' })).toBe('new');
    const l2 = buildRosterLookup([
      { id: 'x', nameTh: 'ซ้ำ ชื่อ', nameEn: null, isActive: true },
      { id: 'y', nameTh: 'ซ้ำ ชื่อ', nameEn: null, isActive: true },
    ]);
    expect(matchRosterName(l2, { nameTh: 'ซ้ำ ชื่อ' })).toBeNull();
  });
  it('strips bare นาย only when it is a title', () => {
    expect(stripAcademicTitles('นายกร')).toBe('นายกร');
    expect(stripAcademicTitles('นาย สมมติ')).toBe('สมมติ');
    expect(stripAcademicTitles('นายสมมติ ทดสอบ')).toBe('สมมติ ทดสอบ');
    expect(stripAcademicTitles('นางสาวสมมติ')).toBe('สมมติ');
  });
  it('degraded note wiring', () => {
    expect(rosterDegradedNote(5, 0, 0)).toMatch(/^matched 0 of 5/);
    expect(rosterDegradedNote(5, 0, 3)).toBeNull();
    expect(rosterDegradedNote(5, 2, 0)).toBeNull();
    expect(rosterDegradedNote(0, 0, 0)).toBeNull();
  });
});
