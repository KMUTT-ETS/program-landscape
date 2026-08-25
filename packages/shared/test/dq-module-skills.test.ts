import { describe, it, expect } from 'vitest';
import { DQ_MODULE_SKILLS } from '../src/dq/module-skills';
import { theoryModules } from '../src/dq/modules';

// Ids verified against the live database on 2026-08-25:
//   docker exec program-landscape-postgres psql -U kku -d program_landscape -c \
//     "SELECT id, name_en FROM skills WHERE id IN (...);"
// Captured as literals here (not re-queried at test time) so this suite
// never depends on a running database.
const VERIFIED_SKILL_IDS: ReadonlySet<string> = new Set([
  'cmoo0dzo500kz2qd6nbewxgyy', // Operating Systems
  'cmoqi5dfy00e22nlfaemrgtic', // Academic Presentation
  'cmoqia2ud00oj2nlf8f3w8ulk', // Digital Media Production
  'cmoqi6yld00gz2nlfks0zgbo6', // Social Media Communication
  'cmoo1dif702um2qd6d6mzh7bz', // Information Literacy
  'cmoo2uikl06wk2qd6r7f2kra4', // Career and Learning Skills
  'cmoo2jzkh06462qd613cnuiur', // Digital Citizenship
  'cmoqi6yee00gq2nlff3mk8c20', // Generative AI Application
]);

describe('DQ_MODULE_SKILLS', () => {
  it('has exactly 13 rows, one per theory module', () => {
    expect(DQ_MODULE_SKILLS).toHaveLength(13);
  });

  it('covers module numbers 1-13 with no duplicates', () => {
    const moduleNos = DQ_MODULE_SKILLS.map((r) => r.moduleNo).sort((a, b) => a - b);
    expect(moduleNos).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    expect(new Set(moduleNos).size).toBe(13);
  });

  it('matches theoryModules() 1:1 by module number', () => {
    const theoryNos = theoryModules().map((m) => m.no).sort((a, b) => a - b);
    const mappingNos = DQ_MODULE_SKILLS.map((r) => r.moduleNo).sort((a, b) => a - b);
    expect(mappingNos).toEqual(theoryNos);
  });

  it('never maps the same skill id twice', () => {
    const ids = DQ_MODULE_SKILLS.map((r) => r.skillId).filter((id): id is string => id !== null);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every non-null skillId was verified to exist in the live taxonomy', () => {
    for (const row of DQ_MODULE_SKILLS) {
      if (row.skillId !== null) {
        expect(VERIFIED_SKILL_IDS.has(row.skillId)).toBe(true);
      }
    }
  });

  it('every row carries a non-empty note', () => {
    for (const row of DQ_MODULE_SKILLS) {
      expect(row.note.trim().length).toBeGreaterThan(0);
    }
  });

  it('exact and near rows carry both a skillId and a skillNameEn', () => {
    for (const row of DQ_MODULE_SKILLS) {
      if (row.confidence === 'exact' || row.confidence === 'near') {
        expect(row.skillId).not.toBeNull();
        expect(row.skillNameEn).not.toBeNull();
      }
    }
  });

  it('none rows carry neither a skillId nor a skillNameEn', () => {
    for (const row of DQ_MODULE_SKILLS) {
      if (row.confidence === 'none') {
        expect(row.skillId).toBeNull();
        expect(row.skillNameEn).toBeNull();
      }
    }
  });

  it('is mostly gaps: 3 exact, 5 near, 5 none — the measured finding', () => {
    const byConfidence = { exact: 0, near: 0, none: 0 };
    for (const row of DQ_MODULE_SKILLS) {
      byConfidence[row.confidence] += 1;
    }
    expect(byConfidence).toEqual({ exact: 3, near: 5, none: 5 });
  });
});
