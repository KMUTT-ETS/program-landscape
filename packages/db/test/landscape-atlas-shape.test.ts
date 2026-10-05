import { describe, expect, it } from 'vitest';
import { buildShape, type ShapeProgrammeInput } from '../src/landscape-atlas/shape';

const row = (over: Partial<ShapeProgrammeInput>): ShapeProgrammeInput => ({
  programId: 'p',
  code: 'KKU-SEQ-0001',
  nameTh: 'หลักสูตร',
  nameEn: 'Programme',
  level: 'BACHELOR',
  facultyId: 'f1',
  facultyCode: 'F1',
  facultyNameTh: 'คณะหนึ่ง',
  facultyNameEn: 'Faculty One',
  activeStudents: 100,
  health: 70,
  ...over,
});

describe('buildShape', () => {
  it('nests programmes under faculties, largest faculty first, with health tones', () => {
    const out = buildShape(
      [
        row({ programId: 'a', facultyId: 'f1', activeStudents: 50, health: 30 }),
        row({ programId: 'b', facultyId: 'f2', facultyNameTh: 'คณะสอง', activeStudents: 400, health: null }),
        row({ programId: 'c', facultyId: 'f1', activeStudents: 10, health: 66 }),
      ],
      '2026-10-05T00:00:00.000Z',
    );
    expect(out.faculties.map((f) => f.id)).toEqual(['f2', 'f1']);
    const f1 = out.faculties[1]!;
    expect(f1.value).toBe(60);
    expect(f1.children.map((c) => [c.id, c.tone])).toEqual([
      ['a', 'negative'],
      ['c', 'positive'],
    ]);
    expect(out.faculties[0]!.children[0]!.tone).toBe('neutral');
    expect(out.faculties[0]!.children[0]!.href).toBe('/programs/b');
    expect(out.totalStudents).toBe(460);
  });

  it('lists programmes with no or zero active students instead of drawing them', () => {
    const out = buildShape(
      [row({ programId: 'a', activeStudents: null }), row({ programId: 'b', activeStudents: 0 }), row({ programId: 'c' })],
      'x',
    );
    expect(out.unplotted).toEqual([
      { id: 'a', label: 'หลักสูตร', reason: 'No active-student data' },
      { id: 'b', label: 'หลักสูตร', reason: 'No active students' },
    ]);
    expect(out.faculties[0]!.children.map((c) => c.id)).toEqual(['c']);
  });

  it('answers with the top-5 faculty share and the count of small programmes', () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      row({ programId: `p${i}`, facultyId: `f${i}`, activeStudents: i === 0 ? 400 : i === 6 ? 10 : 100 }),
    );
    const out = buildShape(rows, 'x');
    // total 400 + 5×100 + 10 = 910; top five = 400 + 4×100 = 800 → 88%
    expect(out.answer.figure).toBe('88%');
    expect(out.answer.sentence).toBe(
      'of active students are in the 5 largest of 7 faculties; 1 programme has fewer than 15 active students.',
    );
    expect(out.smallProgrammes).toBe(1);
  });

  it('says all students are in the faculties shown when there are five or fewer', () => {
    const out = buildShape([row({ programId: 'a', activeStudents: 1200 })], 'x');
    expect(out.answer.figure).toBe('1,200');
    expect(out.answer.sentence).toBe(
      'active students, all in the 1 faculty shown; 0 programmes have fewer than 15 active students.',
    );
  });

  it('falls back to the neutral answer with no students at all', () => {
    expect(buildShape([], 'x').answer).toEqual({ figure: null, sentence: 'Not enough data to summarise this chapter.' });
  });
});
