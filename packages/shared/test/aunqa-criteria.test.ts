import { describe, it, expect } from 'vitest';
import {
  AUNQA_CRITERIA,
  AUNQA_UNEVIDENCED_CRITERIA,
  allEvidenceBindings,
  criterionById,
} from '../src/aunqa/criteria';

describe('AUNQA_CRITERIA', () => {
  it('carries the six criteria the platform can evidence', () => {
    expect(AUNQA_CRITERIA.map((c) => c.id)).toEqual(['1', '2', '3', '4', '5', '8']);
  });

  it('names the two it cannot, so a reader is not misled that six is all there are', () => {
    expect(AUNQA_UNEVIDENCED_CRITERIA.map((c) => c.id)).toEqual(['6', '7']);
    for (const c of AUNQA_UNEVIDENCED_CRITERIA) {
      expect(c.title.length).toBeGreaterThan(0);
      expect(c.whyAbsent.length).toBeGreaterThan(0);
    }
  });

  it('gives every criterion at least one sub-criterion', () => {
    for (const c of AUNQA_CRITERIA) expect(c.subCriteria.length).toBeGreaterThan(0);
  });

  it('gives every sub-criterion an id of the form <criterion>.<n>', () => {
    for (const c of AUNQA_CRITERIA) {
      for (const s of c.subCriteria) expect(s.id).toMatch(new RegExp(`^${c.id}\\.\\d+$`));
    }
  });

  it('binds every sub-criterion to at least one piece of evidence', () => {
    // A sub-criterion with no binding could never be evidenced, so it
    // would render as a permanent blank — worse than omitting it.
    for (const c of AUNQA_CRITERIA) {
      for (const s of c.subCriteria) expect(s.evidence.length).toBeGreaterThan(0);
    }
  });

  it('uses only binding kinds a resolver exists for', () => {
    const known = new Set([
      'evaluation-theme', 'dq-module-profile', 'dq-program-score', 'graduate-outcome',
      'class-gpa-distribution', 'enrollment-metric', 'cohort-progression', 'staff-metric',
      'curriculum', 'pedagogy-assessment', 'peer-review',
    ]);
    for (const b of allEvidenceBindings()) expect(known.has(b.kind)).toBe(true);
  });

  it('references only evaluation themes that exist in the instrument', () => {
    // Measured from evaluation_questions on 2026-08-26.
    const themes = new Set([
      'content-design', 'english-skills', 'active-learning', 'assessment', 'feedback', 'ethics',
    ]);
    for (const b of allEvidenceBindings()) {
      if (b.kind === 'evaluation-theme') expect(themes.has(b.theme)).toBe(true);
    }
  });

  it('looks a criterion up by id', () => {
    expect(criterionById('3')?.title).toContain('Teaching');
    expect(criterionById('6')).toBeUndefined(); // unevidenced ones are a separate list
  });
});
