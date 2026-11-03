import { vi } from 'vitest';
import { describe, it, expect } from 'vitest';
import {
  DQ_MODULES,
  DQ_PASS_MARK,
  cohortFromStudentId,
  dqModuleMean,
  normaliseDqFaculty,
  theoryModules,
  workshopModules,
} from '../src/dq/modules';

describe('DQ_MODULES', () => {
  it('covers exactly the 17 keys the export returns', () => {
    expect(DQ_MODULES).toHaveLength(17);
    expect(theoryModules()).toHaveLength(13);
    expect(workshopModules()).toHaveLength(4);
  });

  it('numbers theory modules 1..13 in framework order', () => {
    expect(theoryModules().map((m) => m.no)).toEqual([1,2,3,4,5,6,7,8,9,10,11,12,13]);
  });

  it('has workshops only for the Essential Software modules 5-8', () => {
    expect(workshopModules().map((m) => m.no)).toEqual([5, 6, 7, 8]);
  });

  it('keys match the export exactly', () => {
    expect(DQ_MODULES.find((m) => m.no === 7 && m.kind === 'THEORY')?.key).toBe('THEORY_MODULE_7');
    expect(DQ_MODULES.find((m) => m.no === 7 && m.kind === 'WORKSHOP')?.key).toBe('WORKSHOP_MODULE_7');
  });

  it('leaves module 13 without a Thai name — it is not in the supplied framework', () => {
    const m13 = DQ_MODULES.find((m) => m.no === 13 && m.kind === 'THEORY');
    expect(m13?.nameEn).toBe('Generative AI');
    expect(m13?.nameTh).toBeNull();
  });

  it('gives every module a radar-safe short label', () => {
    for (const m of DQ_MODULES) {
      expect(m.shortEn.length).toBeGreaterThan(0);
      expect(m.shortEn.length).toBeLessThanOrEqual(18);
    }
  });

  it('states the pass mark measured from the source', () => {
    expect(DQ_PASS_MARK).toBe(70);
  });
});

describe('normaliseDqFaculty', () => {
  it('keeps a plain faculty name', () => {
    expect(normaliseDqFaculty('คณะวิศวกรรมศาสตร์')).toBe('คณะวิศวกรรมศาสตร์');
  });

  it('strips the breadcrumb tail', () => {
    expect(normaliseDqFaculty('คณะวิศวกรรมศาสตร์ / ปริญญาตรี ภาคปกติ / นักศึกษา')).toBe(
      'คณะวิศวกรรมศาสตร์',
    );
  });

  it('collapses internal and surrounding whitespace', () => {
    expect(normaliseDqFaculty('  คณะบริหารธุรกิจ  วิทยาเขตหนองคาย  ')).toBe(
      'คณะบริหารธุรกิจ วิทยาเขตหนองคาย',
    );
  });

  it('maps blank and missing to a single explicit bucket', () => {
    expect(normaliseDqFaculty('')).toBe('(unknown)');
    expect(normaliseDqFaculty('   ')).toBe('(unknown)');
    expect(normaliseDqFaculty(null)).toBe('(unknown)');
    expect(normaliseDqFaculty(undefined)).toBe('(unknown)');
  });
});

describe('cohortFromStudentId', () => {
  it('reads the BE admission year from the first two digits', () => {
    expect(cohortFromStudentId('643020334-9')).toBe(2564);
    expect(cohortFromStudentId('6830201119')).toBe(2568);
  });

  it('rejects an implausible year rather than inventing a cohort', () => {
    // Real export data contains ids beginning "12" and "46". A 2512
    // cohort is not a cohort; it is a bad record.
    expect(cohortFromStudentId('1230201119')).toBeNull();
    expect(cohortFromStudentId('4630201119')).toBeNull();
  });

  it('lets the ceiling follow the calendar (current BE year + 1)', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2030-07-01T00:00:00Z')); // BE 2573
      expect(cohortFromStudentId('7430201119')).toBe(2574);
      expect(cohortFromStudentId('7530201119')).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('returns null for unusable ids', () => {
    expect(cohortFromStudentId('')).toBeNull();
    expect(cohortFromStudentId('x')).toBeNull();
    expect(cohortFromStudentId('6')).toBeNull();
  });
});

describe('dqModuleMean', () => {
  it('is the weighted mean of the taken scores', () => {
    expect(dqModuleMean(340, 4)).toBe(85);
  });

  it('returns null when nobody took the module — never 0', () => {
    expect(dqModuleMean(0, 0)).toBeNull();
  });

  it('rolls up correctly from parts', () => {
    // Two programs: 3 students averaging 80, 2 averaging 90.
    // The rollup must be 84, not the mean-of-means 85.
    expect(dqModuleMean(240 + 180, 3 + 2)).toBe(84);
  });
});
