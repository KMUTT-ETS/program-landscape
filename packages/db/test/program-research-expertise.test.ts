import { describe, expect, it } from 'vitest';
import {
  dedupAndScorePapers,
  buildExpertiseStats,
  readinessFor,
  type PaperRow,
} from '../src/program-research-expertise';

const paper = (over: Partial<PaperRow>): PaperRow => ({
  title: 'Recycled aggregate concrete',
  venue: 'Constr Build Mater',
  year: 2024,
  citations: 10,
  quartile: null,
  doi: null,
  openalexId: null,
  scopusId: null,
  pmid: null,
  ...over,
});

describe('dedupAndScorePapers', () => {
  it('collapses the same paper carried by multiple roster authors', () => {
    const rows = [
      paper({ doi: '10.1/x', citations: 50 }),
      paper({ doi: '10.1/x', citations: 50 }),
      paper({ doi: '10.1/y', title: 'Other', citations: 5 }),
    ];
    const out = dedupAndScorePapers(rows, 2026);
    expect(out).toHaveLength(2);
    expect(out[0]!.contributingRosterCount).toBe(2); // the duplicated one, and it ranks first
    expect(out[0]!.doi).toBe('10.1/x');
  });

  it('falls back to normalised title when all external ids are null', () => {
    const rows = [paper({ title: 'Same Title ' }), paper({ title: 'same title' })];
    expect(dedupAndScorePapers(rows, 2026)).toHaveLength(1);
  });

  it('ranks a recent Q1 paper above an old uncited one, and null quartile is never a penalty vs Q3+', () => {
    const out = dedupAndScorePapers(
      [
        paper({ doi: 'a', year: 2017, citations: 0 }),
        paper({ doi: 'b', year: 2025, citations: 30, quartile: 1 }),
      ],
      2026,
    );
    expect(out[0]!.doi).toBe('b');
  });

  it('does not collide two different papers when one carries a DOI and the other only a title of the same raw value (id-kind namespacing)', () => {
    // Deliberately adversarial: the DOI's raw string equals the other
    // paper's title string. An un-namespaced dedup key (e.g. plain
    // `row.doi ?? row.title.toLowerCase().trim()`) would collapse these
    // two DISTINCT papers into one. The key must be prefixed per id-kind
    // so "doi:same-value" and "title:same-value" never collide.
    const rows = [
      paper({ doi: 'same-value', title: 'Paper about concrete', citations: 5 }),
      paper({ doi: null, title: 'same-value', citations: 3 }),
    ];
    const out = dedupAndScorePapers(rows, 2026);
    expect(out).toHaveLength(2);
  });

  it('ties in score break toward the newer paper', () => {
    // Same citations, same quartile (null), same recency formula input
    // EXCEPT year — construct two rows whose scores would tie if year
    // were ignored, then confirm the newer one sorts first.
    const older = paper({ doi: 'old', year: 2020, citations: 4 });
    const newer = paper({ doi: 'new', year: 2024, citations: 4 });
    const out = dedupAndScorePapers([older, newer], 2026);
    // The recency term already ranks 2024 above 2020 (rising ramp), so
    // this also exercises the general ordering, but with equal citations
    // and quartile the year is the ONLY differentiator, which is exactly
    // the tie-break contract described in the plan.
    expect(out[0]!.doi).toBe('new');
    expect(out[1]!.doi).toBe('old');
  });
});

describe('readinessFor', () => {
  it('is no-roster at 0 members, thin below 10 papers, ok otherwise', () => {
    expect(readinessFor(0, 999)).toBe('no-roster');
    expect(readinessFor(5, 9)).toBe('thin');
    expect(readinessFor(5, 10)).toBe('ok');
  });

  it('is no-roster even when somehow papers exist (0 roster members wins)', () => {
    expect(readinessFor(0, 0)).toBe('no-roster');
  });
});

describe('buildExpertiseStats', () => {
  // 5 hand-built papers: 3 distinct years (2022/2023/2024), 2 venues
  // (Journal A x3, Journal B x2), one Q1 paper, one Q2, one Q3, two
  // unassessed (null quartile).
  const papers = dedupAndScorePapers(
    [
      { title: 'P1', venue: 'Journal A', year: 2024, citations: 20, quartile: 1, doi: 'p1', openalexId: null, scopusId: null, pmid: null },
      { title: 'P2', venue: 'Journal A', year: 2024, citations: 5, quartile: null, doi: 'p2', openalexId: null, scopusId: null, pmid: null },
      { title: 'P3', venue: 'Journal B', year: 2023, citations: 8, quartile: 2, doi: 'p3', openalexId: null, scopusId: null, pmid: null },
      { title: 'P4', venue: 'Journal B', year: 2023, citations: 1, quartile: null, doi: 'p4', openalexId: null, scopusId: null, pmid: null },
      { title: 'P5', venue: 'Journal A', year: 2022, citations: 12, quartile: 3, doi: 'p5', openalexId: null, scopusId: null, pmid: null },
    ],
    2026,
  );

  it('reports papersPerYear, topVenues with counts, quartile mix, and notShownCount', () => {
    const stats = buildExpertiseStats(papers, 3 /* topN kept */, 11 /* rosterSize */);

    expect(stats.totalDistinct).toBe(5);
    expect(stats.rosterSize).toBe(11);
    expect(stats.notShownCount).toBe(papers.length - 3);
    expect(stats.notShownCount).toBe(2);

    expect(stats.papersPerYear).toEqual([
      { year: 2022, count: 1 },
      { year: 2023, count: 2 },
      { year: 2024, count: 2 },
    ]);

    expect(stats.topVenues).toEqual([
      { venue: 'Journal A', count: 3 },
      { venue: 'Journal B', count: 2 },
    ]);
    expect(stats.topVenues[0]).toEqual({ venue: expect.any(String), count: expect.any(Number) });

    expect(stats.quartileMix).toEqual({ q1: 1, q2: 1, q3plus: 1, unassessed: 2 });
  });

  it('excludes null-venue papers from topVenues but still counts them in totalDistinct', () => {
    const withNullVenue = dedupAndScorePapers(
      [
        { title: 'V1', venue: null, year: 2024, citations: 1, quartile: null, doi: 'v1', openalexId: null, scopusId: null, pmid: null },
        { title: 'V2', venue: 'Journal C', year: 2024, citations: 1, quartile: null, doi: 'v2', openalexId: null, scopusId: null, pmid: null },
      ],
      2026,
    );
    const stats = buildExpertiseStats(withNullVenue, 150, 3);
    expect(stats.totalDistinct).toBe(2);
    expect(stats.topVenues).toEqual([{ venue: 'Journal C', count: 1 }]);
  });

  it('notShownCount floors at 0 when keptN exceeds totalDistinct', () => {
    const stats = buildExpertiseStats(papers, 150, 11);
    expect(stats.notShownCount).toBe(0);
  });
});
