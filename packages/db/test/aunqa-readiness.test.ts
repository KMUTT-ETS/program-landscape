import { describe, expect, it, vi, beforeEach } from 'vitest';

// A band describes OUR DATA, never the programme — see the header of
// `aunqa-readiness.ts`. These tests pin the boundaries so the judgement
// stays a judgement someone made once, on purpose, in one place.

const mocks = vi.hoisted(() => ({ queryRawUnsafe: vi.fn() }));

vi.mock('../src/index', () => ({
  prisma: { $queryRawUnsafe: mocks.queryRawUnsafe },
}));

import { AUNQA_CRITERIA, type AunqaCriterion, type EvidenceBinding } from '@kku/shared';
import {
  aunqaCompletenessForPrograms,
  criterionCompletenessFrom,
  readinessBand,
} from '../src/aunqa-readiness';

const never = (): boolean => false;
const always = (): boolean => true;

describe('readinessBand', () => {
  it('is no-evidence when nothing at all is evidenced', () => {
    expect(readinessBand(6, 0)).toBe('no-evidence');
    expect(readinessBand(3, 0)).toBe('no-evidence');
  });

  it('is no-evidence for a criterion with no sub-criteria to count', () => {
    expect(readinessBand(0, 0)).toBe('no-evidence');
  });

  it('is well-evidenced at exactly two thirds, and above', () => {
    expect(readinessBand(6, 4)).toBe('well-evidenced');
    expect(readinessBand(3, 2)).toBe('well-evidenced');
    expect(readinessBand(5, 4)).toBe('well-evidenced');
    expect(readinessBand(4, 4)).toBe('well-evidenced');
  });

  it('is partly-evidenced just below two thirds', () => {
    // 3/5 = 0.6, 1/3, 3/6 = 0.5 — all short of the boundary.
    expect(readinessBand(5, 3)).toBe('partly-evidenced');
    expect(readinessBand(3, 1)).toBe('partly-evidenced');
    expect(readinessBand(6, 3)).toBe('partly-evidenced');
    expect(readinessBand(6, 1)).toBe('partly-evidenced');
  });
});

describe('criterionCompletenessFrom', () => {
  const criterion: AunqaCriterion = {
    id: '9',
    title: 'Test criterion',
    subCriteria: [
      {
        id: '9.1',
        title: 'Four bindings',
        evidence: [
          { kind: 'curriculum', field: 'skills' },
          { kind: 'curriculum', field: 'credits' },
          { kind: 'curriculum', field: 'courses' },
          { kind: 'dq-program-score' },
        ],
      },
      { id: '9.2', title: 'One binding', evidence: [{ kind: 'class-gpa-distribution' }] },
      { id: '9.3', title: 'One binding', evidence: [{ kind: 'cohort-progression' }] },
    ],
  };

  it('counts sub-criteria, not bindings — four evidenced bindings on one sub-criterion is 1 of 3', () => {
    const onlyCurriculum = (b: EvidenceBinding): boolean => b.kind === 'curriculum';
    const out = criterionCompletenessFrom(criterion, onlyCurriculum);
    expect(out.subCriteriaTotal).toBe(3);
    expect(out.subCriteriaWithEvidence).toBe(1);
    expect(out.band).toBe('partly-evidenced');
  });

  it('counts a sub-criterion as evidenced when ANY one of its bindings is', () => {
    const onlyDq = (b: EvidenceBinding): boolean => b.kind === 'dq-program-score';
    const out = criterionCompletenessFrom(criterion, onlyDq);
    expect(out.subCriteria.map((s) => s.hasEvidence)).toEqual([true, false, false]);
  });

  it('reports 0 of n rather than failing when a programme has nothing', () => {
    const out = criterionCompletenessFrom(criterion, never);
    expect(out.subCriteriaWithEvidence).toBe(0);
    expect(out.subCriteriaTotal).toBe(3);
    expect(out.band).toBe('no-evidence');
  });

  it('is well-evidenced with everything available', () => {
    expect(criterionCompletenessFrom(criterion, always).band).toBe('well-evidenced');
  });

  it('covers every registry criterion without inventing a sub-criterion', () => {
    for (const c of AUNQA_CRITERIA) {
      const out = criterionCompletenessFrom(c, never);
      expect(out.criterionId).toBe(c.id);
      expect(out.subCriteriaTotal).toBe(c.subCriteria.length);
      expect(out.subCriteriaWithEvidence).toBe(0);
    }
  });
});

describe('aunqaCompletenessForPrograms', () => {
  beforeEach(() => {
    mocks.queryRawUnsafe.mockReset();
  });

  it('asks the database nothing when asked about no programmes', async () => {
    await expect(aunqaCompletenessForPrograms([])).resolves.toEqual([]);
    expect(mocks.queryRawUnsafe).not.toHaveBeenCalled();
  });

  it('returns a row per programme, 0 of n on every criterion, when no source holds anything', async () => {
    // Every availability query comes back empty — the state of a
    // programme nobody has ingested, extracted or surveyed.
    mocks.queryRawUnsafe.mockResolvedValue([]);
    const [row] = await aunqaCompletenessForPrograms(['prog-1']);
    expect(row?.programId).toBe('prog-1');
    expect(row?.band).toBe('no-evidence');
    expect(row?.subCriteriaWithEvidence).toBe(0);
    expect(row?.criteria.map((c) => c.criterionId)).toEqual(
      AUNQA_CRITERIA.map((c) => c.id),
    );
    for (const c of row?.criteria ?? []) {
      expect(c.band).toBe('no-evidence');
      expect(c.subCriteriaTotal).toBe(
        AUNQA_CRITERIA.find((x) => x.id === c.criterionId)?.subCriteria.length,
      );
    }
  });

  it('keeps the requested order so a caller can zip programme names back on', async () => {
    mocks.queryRawUnsafe.mockResolvedValue([]);
    const rows = await aunqaCompletenessForPrograms(['a', 'b', 'c']);
    expect(rows.map((r) => r.programId)).toEqual(['a', 'b', 'c']);
  });
});
