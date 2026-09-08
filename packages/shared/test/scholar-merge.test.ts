// packages/shared/test/scholar-merge.test.ts
import { describe, it, expect } from 'vitest';
import { normaliseTitle, planScholarMerge } from '../src/scholar/merge';

const existing = [
  { id: 'r1', title: 'Deep Learning for Rice Yield Prediction', year: 2023, doi: '10.1/abc', citations: 5 },
  { id: 'r2', title: 'A Study of Groundwater, in Isan!', year: 2021, doi: null, citations: 2 },
];

describe('normaliseTitle — Thai combining marks', () => {
  it('keeps Thai vowel signs instead of shattering the title into fragments', () => {
    // Thai vowel signs are category Mn. Filtering to \p{L}\p{N} alone
    // replaced them with spaces and turned this 5-word title into 8
    // fragments.
    const title = 'การศึกษาผลกระทบของปัญญาประดิษฐ์ต่อหลักสูตร';
    expect(normaliseTitle(title)).toBe(title.toLowerCase());
    expect(normaliseTitle(title)).not.toContain(' ');
  });

  it('no longer collapses two different Thai titles onto one key', () => {
    // The real consequence of the old behaviour: these normalised
    // identically, so the planner recorded a citation update against an
    // unrelated library row instead of inserting a new paper.
    expect(normaliseTitle('ผล ระบบ')).not.toBe(normaliseTitle('ผลิระบบ'));
  });

  it('still strips Latin accents, which NFD has already split off', () => {
    expect(normaliseTitle('Éxposé of Ångström')).toBe('expose of angstrom');
  });
});

describe('planScholarMerge', () => {
  it('matches on DOI and plans a citation update only', () => {
    const p = planScholarMerge({
      scholar: [{ scholarPaperId: 's1', title: 'Totally Different Title', year: 2023, doi: '10.1/abc', citations: 40, venue: 'X', type: null }],
      existing,
    });
    expect(p.inserts).toHaveLength(0);
    expect(p.citationUpdates).toEqual([{ id: 'r1', citations: 40, scholarPaperId: 's1' }]);
  });

  it('falls back to normalised title + year when there is no DOI', () => {
    const p = planScholarMerge({
      scholar: [{ scholarPaperId: 's2', title: 'a study of groundwater in isan', year: 2021, doi: null, citations: 9, venue: null, type: null }],
      existing,
    });
    expect(p.inserts).toHaveLength(0);
    expect(p.citationUpdates[0]!.id).toBe('r2');
  });

  it('does NOT match when the year differs, even on an identical title', () => {
    const p = planScholarMerge({
      scholar: [{ scholarPaperId: 's3', title: 'A Study of Groundwater, in Isan!', year: 2019, doi: null, citations: 9, venue: null, type: null }],
      existing,
    });
    expect(p.citationUpdates).toHaveLength(0);
    expect(p.inserts).toHaveLength(1);
  });

  it('inserts a paper the library does not have', () => {
    const p = planScholarMerge({
      scholar: [{ scholarPaperId: 's4', title: 'Novel Preprint', year: 2024, doi: null, citations: 1, venue: 'arXiv', type: null }],
      existing,
    });
    expect(p.inserts.map((i) => i.scholarPaperId)).toEqual(['s4']);
  });

  it('EMPTY scholar input writes nothing at all', () => {
    const p = planScholarMerge({ scholar: [], existing });
    expect(p.inserts).toHaveLength(0);
    expect(p.citationUpdates).toHaveLength(0);
  });

  it('never plans a deletion — the plan has no such field', () => {
    const p = planScholarMerge({ scholar: [], existing });
    expect(Object.keys(p).sort()).toEqual(['citationUpdates', 'inserts']);
  });

  it('does not update citations when Scholar reports fewer', () => {
    const p = planScholarMerge({
      scholar: [{ scholarPaperId: 's5', title: 'x', year: 2023, doi: '10.1/abc', citations: 1, venue: null, type: null }],
      existing,
    });
    expect(p.citationUpdates).toHaveLength(0);
  });

  it('dedupes two Scholar entries that collapse onto the same existing row', () => {
    const p = planScholarMerge({
      scholar: [
        { scholarPaperId: 's6', title: 'x', year: 2023, doi: '10.1/abc', citations: 40, venue: null, type: null },
        { scholarPaperId: 's7', title: 'x', year: 2023, doi: '10.1/abc', citations: 41, venue: null, type: null },
      ],
      existing,
    });
    expect(p.citationUpdates).toHaveLength(1);
  });
});
