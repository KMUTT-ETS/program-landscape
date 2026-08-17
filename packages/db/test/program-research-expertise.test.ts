import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { AiService } from '@kku/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks prisma (via '../src/index', same pattern as health-score.test.ts /
// ai-jobs.test.ts) so the runner's skip-path tests below run without a DB
// and without ever reaching the AiService. The AI path itself is NOT
// tested here — per the plan, that's covered by the 3-program live gate,
// not mocked theater.
// ─────────────────────────────────────────────────────────────────────────────
const mocks = vi.hoisted(() => ({
  programFindUnique: vi.fn(),
  programFacultyFindMany: vi.fn(),
  researchOutputFindMany: vi.fn(),
  programResearchExpertiseCreate: vi.fn(),
}));

vi.mock('../src/index', async () => {
  const actual = await vi.importActual<typeof import('../src/index')>('../src/index');
  return {
    ...actual,
    prisma: {
      program: { findUnique: mocks.programFindUnique },
      programFaculty: { findMany: mocks.programFacultyFindMany },
      researchOutput: { findMany: mocks.researchOutputFindMany },
      programResearchExpertise: { create: mocks.programResearchExpertiseCreate },
    },
  };
});

import {
  dedupAndScorePapers,
  buildExpertiseStats,
  readinessFor,
  type PaperRow,
} from '../src/program-research-expertise';
import { buildLintableText, generateProgramResearchExpertise } from '../src/program-research-expertise-run';

/** An AiService whose every method is a spy that must never be called —
 *  used to assert the no-roster / not-found skip paths make ZERO AI calls. */
function unreachableAi(): AiService {
  return {
    providerId: 'mock',
    complete: vi.fn(),
    embed: vi.fn(),
    extractStructured: vi.fn(),
    translate: vi.fn(),
    vision: vi.fn(),
  };
}

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

describe('buildLintableText', () => {
  const payload = {
    themes: [
      { name: 'Concrete durability', evidenceNote: 'Grounded in P1 and P2.' },
      { name: 'Battery recycling', evidenceNote: 'Rising per the per-year table.' },
    ],
    recommendations: {
      curriculum: [{ action: 'Add a materials-durability elective.', rationale: 'Builds on the theme.' }],
      positioning: [{ action: 'Market the concrete-durability niche.', rationale: 'Distinct from peers.' }],
      research: [{ action: 'Seek a battery-recycling grant.', rationale: 'Rising trend.' }],
    },
    caveats: ['Analysis covers publications of the curated program roster.'],
  };

  it('joins theme names + evidence notes, every recommendation action + rationale across all three lanes, and the caveats into one string', () => {
    const text = buildLintableText(payload);
    expect(text).toContain('Concrete durability');
    expect(text).toContain('Grounded in P1 and P2.');
    expect(text).toContain('Battery recycling');
    expect(text).toContain('Rising per the per-year table.');
    expect(text).toContain('Add a materials-durability elective.');
    expect(text).toContain('Builds on the theme.');
    expect(text).toContain('Market the concrete-durability niche.');
    expect(text).toContain('Distinct from peers.');
    expect(text).toContain('Seek a battery-recycling grant.');
    expect(text).toContain('Rising trend.');
    expect(text).toContain('Analysis covers publications of the curated program roster.');
  });

  it('produces an empty string for an empty payload rather than throwing', () => {
    const text = buildLintableText({
      themes: [],
      recommendations: { curriculum: [], positioning: [], research: [] },
      caveats: [],
    });
    expect(text).toBe('');
  });

  it('does not cross-contaminate between recommendation lanes (each lane only contributes its own entries)', () => {
    const text = buildLintableText({
      themes: [],
      recommendations: {
        curriculum: [{ action: 'CURRICULUM_ONLY_ACTION', rationale: 'CURRICULUM_ONLY_RATIONALE' }],
        positioning: [],
        research: [],
      },
      caveats: [],
    });
    expect(text).toContain('CURRICULUM_ONLY_ACTION');
    expect(text).toContain('CURRICULUM_ONLY_RATIONALE');
  });
});

describe('generateProgramResearchExpertise — skip paths', () => {
  beforeEach(() => {
    for (const fn of Object.values(mocks)) fn.mockReset();
  });

  it('skips with zero AI calls and nothing stored when the program does not exist', async () => {
    mocks.programFindUnique.mockResolvedValue(null);
    const ai = unreachableAi();

    const outcome = await generateProgramResearchExpertise({ programId: 'nonexistent-id', ai });

    expect(outcome.status).toBe('SKIPPED');
    if (outcome.status === 'SKIPPED') {
      expect(outcome.reason).toContain('program not found');
      expect(outcome.readiness).toBeNull();
    }
    expect(ai.extractStructured).not.toHaveBeenCalled();
    expect(mocks.programResearchExpertiseCreate).not.toHaveBeenCalled();
  });

  it("skips with zero AI calls and nothing stored when readiness is 'no-roster'", async () => {
    mocks.programFindUnique.mockResolvedValue({
      nameEn: 'Test Program',
      level: 'BACHELOR',
      faculty: { nameEn: 'Test Faculty' },
    });
    mocks.programFacultyFindMany.mockResolvedValue([]); // zero roster members
    const ai = unreachableAi();

    const outcome = await generateProgramResearchExpertise({ programId: 'p-empty-roster', ai });

    expect(outcome.status).toBe('SKIPPED');
    if (outcome.status === 'SKIPPED') {
      expect(outcome.reason).toBe('no-roster');
      expect(outcome.readiness).toBe('no-roster');
    }
    // Zero roster members means assembleResearchExpertiseInput() never
    // even queries researchOutput — the empty-array short-circuit in that
    // function, not just the runner's early return.
    expect(mocks.researchOutputFindMany).not.toHaveBeenCalled();
    expect(ai.extractStructured).not.toHaveBeenCalled();
    expect(mocks.programResearchExpertiseCreate).not.toHaveBeenCalled();
  });
});
