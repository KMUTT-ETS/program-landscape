// Source composition for research roll-ups.
//
// WHY THIS EXISTS.
// `ResearchOutput` now has two writers. The curated library pipeline
// (`kku-research`, mirroring Scopus + PubMed) imports on a schedule for
// everybody. The Google Scholar runner imports ON DEMAND, for one person, when
// that person — or an administrator acting for them — presses a button. So a
// research figure over a group of staff can move without anything about the
// underlying research changing: a faculty where three people fetched looks
// stronger than one where nobody did.
//
// Council-readiness rule 1 (CLAUDE.md) requires provenance on every chart. Here
// that means stating the mix, in the drawer, next to the number. This module
// computes it. It does NOT try to correct for it — see
// `docs/methodologies/health-score.md` §"Mixed-source research data" for why
// normalising the two sources against each other would be a guess dressed as a
// method.
//
// THE DENOMINATOR IS FIXED, AND IT IS NAMED IN THE DRAWER TEXT.
// M is the staff in the set who have at least one publication on file from any
// source. Not "everyone in scope" (most of a faculty's roster has no papers, so
// the ratio would say more about roster size than about the mix) and not
// "everyone with a FacultyMember row" (the `kkupub_*` backfill added 1,375 rows
// for people who publish but do not teach). A staff member with no papers
// cannot shift the mix, so they do not belong in a ratio about the mix.
// A ratio whose denominator is ambiguous is worse than no ratio, so
// `RESEARCH_COMPOSITION_DENOMINATOR` travels with the numbers and is rendered
// verbatim.

import type { ScholarComposition } from '@kku/shared';
import { prisma } from './index';
import { SCHOLAR_RESEARCH_OUTPUT_SOURCE } from './scholar-fetch';

/** Rendered verbatim in the provenance drawer beneath "N of M staff". */
export const RESEARCH_COMPOSITION_DENOMINATOR =
  'staff on this roster with at least one publication on file, from any source';

/** Human label for the on-demand writer, used in drawer copy. */
export const SCHOLAR_SOURCE_LABEL = 'Google Scholar';

/**
 * Structurally the shared `ScholarComposition` — declared there, not here, so
 * the figure and the words printed beside it are typed by one shape. Aliased
 * rather than re-declared for exactly that reason.
 */
export type ResearchSourceComposition = ScholarComposition;

/** One `groupBy` row: papers per (staff member × source). */
export interface ResearchSourceGroupRow {
  facultyMemberId: string | null;
  source: string | null;
  count: number;
}

/**
 * Fold grouped `(facultyMemberId, source)` counts into a composition.
 *
 * Pure — the DB round trip is `loadResearchSourceComposition` below.
 *
 * `source` is nullable on `ResearchOutput`, and a null source is NOT Scholar:
 * the runner always stamps its own. Same rule as `scholar-console.ts`,
 * deliberately. No row in the database is actually null today (measured
 * 2026-09-08: 64,294 `kku-publications:scopus` + 57,444 `openalex` + 44,730
 * `kku-publications:pubmed`, zero null) — the branch is here because the
 * column permits it, not because a legacy population is known to exist.
 *
 * Rows for a `facultyMemberId` outside `memberIds`, or with a null one, are
 * ignored — the caller owns the set, and an unattributed paper cannot be said
 * to belong to any staff member's record.
 */
export function summariseResearchSources(
  rows: readonly ResearchSourceGroupRow[],
  memberIds: readonly string[],
  /**
   * Library rows a Scholar import has raised the citations of. Passed in
   * rather than derived, because it cannot come out of the same `groupBy`:
   * it is keyed on `scholarPaperId IS NOT NULL`, which is per-row and would
   * make the grouping unbounded. `loadResearchSourceComposition` counts it
   * separately and hands it here so the whole composition stays one value.
   */
  libraryPapersTouchedByScholar: number,
): ResearchSourceComposition {
  const inSet = new Set(memberIds);
  const scholarStaff = new Set<string>();
  const anyStaff = new Set<string>();
  let papersFromScholar = 0;
  let papersTotal = 0;

  for (const row of rows) {
    const id = row.facultyMemberId;
    if (id === null || !inSet.has(id)) continue;
    if (row.count <= 0) continue;
    anyStaff.add(id);
    papersTotal += row.count;
    if (row.source === SCHOLAR_RESEARCH_OUTPUT_SOURCE) {
      scholarStaff.add(id);
      papersFromScholar += row.count;
    }
  }

  return {
    staffOnScholar: scholarStaff.size,
    staffWithResearch: anyStaff.size,
    papersFromScholar,
    papersTotal,
    libraryPapersTouchedByScholar,
    denominator: RESEARCH_COMPOSITION_DENOMINATOR,
  };
}

/**
 * Composition for a set of staff records.
 *
 * One grouped query, not a count per member. Deliberately UNFILTERED by
 * `realDataWhere()`: it describes what is on the staff record, and the
 * surfaces it annotates say for themselves whether their own figure counts
 * Scholar rows (`countedInFigure` on the provenance meta). Filtering here
 * would make the disclosure agree with whichever surface happened to be asked
 * first and silently disagree with the others.
 */
export async function loadResearchSourceComposition(
  memberIds: readonly string[],
): Promise<ResearchSourceComposition> {
  if (memberIds.length === 0) return summariseResearchSources([], [], 0);
  const ids = [...memberIds];
  const [grouped, touched] = await Promise.all([
    prisma.researchOutput.groupBy({
      by: ['facultyMemberId', 'source'],
      where: { facultyMemberId: { in: ids } },
      _count: { _all: true },
    }),
    // A LIBRARY row carrying a Scholar paper id is one the merge matched and
    // raised the citations of. Its `source` and `ingestion_run_id` are
    // untouched, so it still passes `realDataWhere()` — this is the count that
    // makes "excludes Scholar rows" an incomplete statement on any
    // citation-weighted analysis.
    prisma.researchOutput.count({
      where: {
        facultyMemberId: { in: ids },
        scholarPaperId: { not: null },
        NOT: { source: SCHOLAR_RESEARCH_OUTPUT_SOURCE },
      },
    }),
  ]);
  return summariseResearchSources(
    grouped.map((g) => ({
      facultyMemberId: g.facultyMemberId,
      source: g.source,
      count: g._count._all,
    })),
    memberIds,
    touched,
  );
}
