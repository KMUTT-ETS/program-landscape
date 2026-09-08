import { describe, expect, it } from 'vitest';
import {
  RESEARCH_COMPOSITION_DENOMINATOR,
  summariseResearchSources,
  type ResearchSourceGroupRow,
} from '../src/research-source-composition';
import { SCHOLAR_RESEARCH_OUTPUT_SOURCE } from '../src/scholar-fetch';

const LIBRARY = 'kku-publications:scopus';
const SCHOLAR = SCHOLAR_RESEARCH_OUTPUT_SOURCE;

describe('summariseResearchSources', () => {
  // Dev's actual state: the feature is built, nobody has pressed the button.
  // The honest answer is zeros with a denominator, NOT a hidden section — a
  // Council reader who opens the drawer and sees nothing cannot tell "no
  // Scholar data" from "we did not check".
  it('reports zeros, with the denominator, when nobody has fetched', () => {
    const out = summariseResearchSources(
      [
        { facultyMemberId: 'a', source: LIBRARY, count: 12 },
        { facultyMemberId: 'b', source: LIBRARY, count: 3 },
      ],
      ['a', 'b', 'c'],
      0,
    );
    expect(out.staffOnScholar).toBe(0);
    expect(out.staffWithResearch).toBe(2);
    expect(out.papersFromScholar).toBe(0);
    expect(out.papersTotal).toBe(15);
    expect(out.denominator).toBe(RESEARCH_COMPOSITION_DENOMINATOR);
  });

  it('reports zeros when there is no publication record at all', () => {
    const out = summariseResearchSources([], ['a', 'b'], 0);
    expect(out).toEqual({
      staffOnScholar: 0,
      staffWithResearch: 0,
      papersFromScholar: 0,
      papersTotal: 0,
      libraryPapersTouchedByScholar: 0,
      denominator: RESEARCH_COMPOSITION_DENOMINATOR,
    });
  });

  it('handles an empty roster', () => {
    const out = summariseResearchSources([], [], 0);
    expect(out.staffWithResearch).toBe(0);
    expect(out.papersTotal).toBe(0);
  });

  it('counts a person once even when they appear under both writers', () => {
    const rows: ResearchSourceGroupRow[] = [
      { facultyMemberId: 'a', source: LIBRARY, count: 20 },
      { facultyMemberId: 'a', source: SCHOLAR, count: 7 },
      { facultyMemberId: 'b', source: SCHOLAR, count: 4 },
      { facultyMemberId: 'c', source: LIBRARY, count: 1 },
    ];
    const out = summariseResearchSources(rows, ['a', 'b', 'c'], 0);
    // 2 of 3, not 2 of 4 — `a` is one person with two writers.
    expect(out.staffOnScholar).toBe(2);
    expect(out.staffWithResearch).toBe(3);
    expect(out.papersFromScholar).toBe(11);
    expect(out.papersTotal).toBe(32);
  });

  // `source` is nullable on rows predating provenance tracking. The Scholar
  // runner always stamps its own, so a null is library — the same rule
  // `scholar-console.ts` applies. Getting this backwards would silently
  // attribute the entire pre-2026 corpus to a button nobody pressed.
  it('treats a null source as library, never as Scholar', () => {
    const out = summariseResearchSources(
      [{ facultyMemberId: 'a', source: null, count: 9 }],
      ['a'],
      0,
    );
    expect(out.staffOnScholar).toBe(0);
    expect(out.papersFromScholar).toBe(0);
    expect(out.staffWithResearch).toBe(1);
    expect(out.papersTotal).toBe(9);
  });

  it('ignores rows for staff outside the set, and unattributed papers', () => {
    const out = summariseResearchSources(
      [
        { facultyMemberId: 'a', source: SCHOLAR, count: 5 },
        { facultyMemberId: 'stranger', source: SCHOLAR, count: 400 },
        { facultyMemberId: null, source: LIBRARY, count: 900 },
      ],
      ['a'],
      0,
    );
    expect(out.staffOnScholar).toBe(1);
    expect(out.staffWithResearch).toBe(1);
    expect(out.papersFromScholar).toBe(5);
    expect(out.papersTotal).toBe(5);
  });

  it('does not admit a staff member on a zero-count group row', () => {
    const out = summariseResearchSources(
      [{ facultyMemberId: 'a', source: LIBRARY, count: 0 }],
      ['a'],
      0,
    );
    expect(out.staffWithResearch).toBe(0);
  });

  it('can report a full sweep — everyone fetched', () => {
    const out = summariseResearchSources(
      [
        { facultyMemberId: 'a', source: SCHOLAR, count: 2 },
        { facultyMemberId: 'b', source: SCHOLAR, count: 3 },
      ],
      ['a', 'b'],
      0,
    );
    expect(out.staffOnScholar).toBe(2);
    expect(out.staffWithResearch).toBe(2);
    expect(out.papersFromScholar).toBe(out.papersTotal);
  });
});

// The count that makes "excludes Google Scholar rows" incomplete. It is
// passed through rather than derived, so the only thing worth asserting is
// that it survives — and that it is independent of whether any Scholar-SOURCED
// row exists, which is the whole point: a roster with zero Scholar rows can
// still have had its citation counts moved by an import.
describe('summariseResearchSources — citation-effect passthrough', () => {
  it('carries the touched-library-paper count', () => {
    const out = summariseResearchSources(
      [{ facultyMemberId: 'a', source: LIBRARY, count: 40 }],
      ['a'],
      7,
    );
    expect(out.libraryPapersTouchedByScholar).toBe(7);
    // No Scholar-sourced row anywhere, yet the import has still reached this
    // roster. A surface reporting only `staffOnScholar` would say "none".
    expect(out.staffOnScholar).toBe(0);
    expect(out.papersFromScholar).toBe(0);
  });
});
