import { describe, it, expect } from 'vitest';
import { DqExportItemSchema, accumulate, emptyAccumulator } from '../../src/connectors/sources/kku-dq/transforms';

const ITEM = {
  studentId: '643020334-9',
  firstname: 'REDACTED',
  lastname: 'REDACTED',
  faculty: 'คณะวิทยาศาสตร์ / ปริญญาตรี ภาคปกติ / นักศึกษา',
  hasResult: true,
  allPassed: true,
  modules: {
    THEORY_MODULE_1: 90,
    THEORY_MODULE_13: 0, // not taken
    WORKSHOP_MODULE_5: 80,
  },
};

describe('DqExportItemSchema', () => {
  it('accepts the documented shape', () => {
    expect(DqExportItemSchema.parse(ITEM).studentId).toBe('643020334-9');
  });

  it('accepts an item with no modules object', () => {
    const parsed = DqExportItemSchema.parse({ ...ITEM, modules: undefined });
    expect(parsed.modules).toEqual({});
  });

  it('rejects an item with no studentId — it cannot be placed or counted', () => {
    expect(() => DqExportItemSchema.parse({ ...ITEM, studentId: undefined })).toThrow();
  });

  // The live export sends null, not undefined, for students with no
  // result. Rejecting those dropped 2,404 students from the TESTED count.
  it('coerces a null hasResult/allPassed to false instead of rejecting', () => {
    const parsed = DqExportItemSchema.parse({ ...ITEM, hasResult: null, allPassed: null });
    expect(parsed.hasResult).toBe(false);
    expect(parsed.allPassed).toBe(false);
  });

  it('still counts a student whose allPassed is null', () => {
    const acc = emptyAccumulator();
    accumulate(acc, DqExportItemSchema.parse({ ...ITEM, hasResult: null, allPassed: null }), {
      facultyName: 'คณะวิทยาศาสตร์',
      facultyId: null,
      programId: null,
      programName: null,
      cohortYearBe: 2564,
    });
    const s = [...acc.students.values()][0]!;
    expect(s).toMatchObject({ studentsTested: 1, studentsWithScores: 1, studentsAllPassed: 0 });
  });

  it('accepts an out-of-range score rather than dropping the whole student', () => {
    expect(() =>
      DqExportItemSchema.parse({ ...ITEM, modules: { THEORY_MODULE_1: 9999 } }),
    ).not.toThrow();
  });
});

describe('accumulate', () => {
  const dims = { facultyName: 'คณะวิทยาศาสตร์', facultyId: 'fac-1', programId: 'prog-1', programName: 'BSc CS', cohortYearBe: 2564 };

  it('counts a scored student once in the student cube', () => {
    const acc = emptyAccumulator();
    accumulate(acc, DqExportItemSchema.parse(ITEM), dims);
    const key = [...acc.students.keys()][0]!;
    expect(acc.students.get(key)).toMatchObject({
      studentsTested: 1,
      studentsWithScores: 1,
      studentsAllPassed: 1,
    });
  });

  it('excludes a zero score from the module it belongs to', () => {
    const acc = emptyAccumulator();
    accumulate(acc, DqExportItemSchema.parse(ITEM), dims);
    const m1 = [...acc.modules.values()].find((m) => m.moduleKey === 'THEORY_MODULE_1')!;
    const m13 = [...acc.modules.values()].find((m) => m.moduleKey === 'THEORY_MODULE_13')!;
    expect(m1).toMatchObject({ takenCount: 1, scoreSum: 90, studentsInScope: 1 });
    // Present in the cube (so coverage can be shown) but not counted as taken.
    expect(m13).toMatchObject({ takenCount: 0, scoreSum: 0, studentsInScope: 1 });
  });

  it('counts a student with hasResult but no scores as tested, not scored', () => {
    const acc = emptyAccumulator();
    accumulate(acc, DqExportItemSchema.parse({ ...ITEM, modules: {} }), dims);
    const s = [...acc.students.values()][0]!;
    expect(s.studentsTested).toBe(1);
    expect(s.studentsWithScores).toBe(0);
    expect(acc.modules.size).toBe(0);
  });

  it('keeps unplaced students in their faculty under a null programId', () => {
    const acc = emptyAccumulator();
    accumulate(acc, DqExportItemSchema.parse(ITEM), { ...dims, programId: null, programName: null });
    const s = [...acc.students.values()][0]!;
    expect(s.programId).toBeNull();
    expect(s.facultyName).toBe('คณะวิทยาศาสตร์');
  });

  it('aggregates two students in the same tuple into one row', () => {
    const acc = emptyAccumulator();
    accumulate(acc, DqExportItemSchema.parse(ITEM), dims);
    accumulate(acc, DqExportItemSchema.parse({ ...ITEM, studentId: '643020335-7', allPassed: false, modules: { THEORY_MODULE_1: 70 } }), dims);
    expect(acc.students.size).toBe(1);
    const s = [...acc.students.values()][0]!;
    expect(s).toMatchObject({ studentsTested: 2, studentsWithScores: 2, studentsAllPassed: 1 });
    const m1 = [...acc.modules.values()].find((m) => m.moduleKey === 'THEORY_MODULE_1')!;
    expect(m1).toMatchObject({ takenCount: 2, scoreSum: 160, studentsInScope: 2 });
  });

  // A module the framework table does not carry must be visible, not
  // silently absent from every cube — module 13 already did that once.
  it('records a module key the framework does not know', () => {
    const acc = emptyAccumulator();
    accumulate(
      acc,
      DqExportItemSchema.parse({ ...ITEM, modules: { THEORY_MODULE_1: 90, THEORY_MODULE_14: 55 } }),
      dims,
    );
    expect(acc.unknownModuleKeys.get('THEORY_MODULE_14')).toBe(1);
    expect([...acc.modules.values()].map((m) => m.moduleKey)).toEqual(['THEORY_MODULE_1']);
  });

  it('skips an out-of-range score and counts it, leaving the mean untouched', () => {
    const acc = emptyAccumulator();
    accumulate(
      acc,
      DqExportItemSchema.parse({ ...ITEM, modules: { THEORY_MODULE_1: 9999 } }),
      dims,
    );
    accumulate(
      acc,
      DqExportItemSchema.parse({ ...ITEM, studentId: '643020335-7', modules: { THEORY_MODULE_1: -5 } }),
      dims,
    );
    accumulate(
      acc,
      DqExportItemSchema.parse({ ...ITEM, studentId: '643020336-5', modules: { THEORY_MODULE_1: 80 } }),
      dims,
    );
    expect(acc.outOfRangeScores.get('THEORY_MODULE_1')).toBe(2);
    const m1 = [...acc.modules.values()].find((m) => m.moduleKey === 'THEORY_MODULE_1')!;
    // Only the valid observation reached the cube — mean stays 80, not 3358.
    expect(m1).toMatchObject({ takenCount: 1, scoreSum: 80, studentsInScope: 1 });
    // The students themselves are still counted.
    expect([...acc.students.values()][0]!.studentsTested).toBe(3);
  });

  it('never carries a name into the accumulator', () => {
    const acc = emptyAccumulator();
    accumulate(acc, DqExportItemSchema.parse(ITEM), dims);
    expect(JSON.stringify([...acc.students.values(), ...acc.modules.values()])).not.toContain('REDACTED');
  });
});
