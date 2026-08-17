import { prisma } from './index';
import { realDataWhere } from './data-quality';

// ─────────────────────────────────────────────────────────────────────────────
// Data assembly for the program-research-expertise deep-dive section.
//
// Pure core (dedupAndScorePapers / readinessFor / buildExpertiseStats) has NO
// DB dependency and is unit-tested directly over hand-built rows — see
// packages/db/test/program-research-expertise.test.ts. Only
// assembleResearchExpertiseInput() touches Prisma.
//
// Roster: Program → ProgramFaculty → FacultyMember (direct links only — no
// department/faculty-scope fallback the way programFaculty() in
// program-deep-dive.ts has one; per the design spec, a program without a
// curated ProgramFaculty roster is 'no-roster', full stop).
//
// Papers: FacultyMember → ResearchOutput, windowed to the last 10 years
// (relative to the CURRENT year, never a literal), gated by realDataWhere()
// so mock/untagged rows never reach this analysis.
// ─────────────────────────────────────────────────────────────────────────────

export type ExpertiseReadiness = 'ok' | 'thin' | 'no-roster';

export interface PaperRow {
  title: string;
  venue: string | null;
  year: number;
  citations: number;
  quartile: number | null;
  doi: string | null;
  openalexId: string | null;
  scopusId: string | null;
  pmid: string | null;
}

export interface ScoredPaper extends PaperRow {
  score: number;
  /** How many ResearchOutput rows (i.e. how many roster co-authors) this
   *  deduped paper was carried by before collapsing. */
  contributingRosterCount: number;
}

export interface ExpertiseStats {
  papersPerYear: Array<{ year: number; count: number }>;
  topVenues: Array<{ venue: string; count: number }>;
  quartileMix: { q1: number; q2: number; q3plus: number; unassessed: number };
  totalDistinct: number;
  rosterSize: number;
  notShownCount: number;
}

export interface ResearchExpertiseInput {
  readiness: ExpertiseReadiness;
  topPapers: ScoredPaper[];
  stats: ExpertiseStats;
  programNameEn: string;
  programLevel: string;
  facultyNameEn: string;
}

/** Distinct papers below this floor make theme claims numerology, not
 *  signal — see the design spec's `thin` readiness definition. */
const THIN_PAPER_THRESHOLD = 10;

/** Bounds LLM context — see spec §"Engine: single LLM call over a smart
 *  selection". Selection is done by score, not recency or citations alone,
 *  so a mega-program's top-150 is its BEST 150, not its newest 150. */
const TOP_PAPERS_LIMIT = 150;

/** Also cap how many top-N venues the stats block reports (spec: ≤15). */
const TOP_VENUES_LIMIT = 15;

/**
 * Dedup key, namespaced per id-kind. Two different papers where one is
 * keyed by DOI and the other falls back to a normalised title must NEVER
 * collide just because the raw ID string happens to equal the raw title
 * string — hence the `doi:` / `openalex:` / `scopus:` / `pmid:` / `title:`
 * prefix on every branch, not just a bare `id ?? title`.
 */
function dedupKey(row: PaperRow): string {
  if (row.doi) return `doi:${row.doi.toLowerCase().trim()}`;
  if (row.openalexId) return `openalex:${row.openalexId.trim()}`;
  if (row.scopusId) return `scopus:${row.scopusId.trim()}`;
  if (row.pmid) return `pmid:${row.pmid.trim()}`;
  return `title:${row.title.toLowerCase().trim()}`;
}

/**
 * Paper score (plan-pinned formula — ordering is the contract; exact
 * weights are tunable later):
 *   recency: papers in the last 10y ramp 0.5 → 1.0 linearly.
 *   quartileBoost: Q1 1.3x, Q2 1.15x, else (incl. null) 1x — null is NEVER
 *   a penalty relative to Q3/Q4/unassessed.
 */
function scoreOf(row: PaperRow, currentYear: number): number {
  const recency = 0.5 + 0.5 * Math.max(0, (row.year - (currentYear - 10)) / 10);
  const quartileBoost = row.quartile === 1 ? 1.3 : row.quartile === 2 ? 1.15 : 1;
  return recency * Math.log2(row.citations + 2) * quartileBoost;
}

/**
 * Dedup roster-co-authored rows down to distinct papers, then score + rank
 * them. Ties break toward the newer paper (higher `year`).
 */
export function dedupAndScorePapers(rows: PaperRow[], currentYear: number): ScoredPaper[] {
  const byKey = new Map<string, { row: PaperRow; contributingRosterCount: number }>();
  for (const row of rows) {
    const key = dedupKey(row);
    const existing = byKey.get(key);
    if (existing) {
      existing.contributingRosterCount += 1;
    } else {
      byKey.set(key, { row, contributingRosterCount: 1 });
    }
  }

  const scored: ScoredPaper[] = [];
  for (const { row, contributingRosterCount } of byKey.values()) {
    scored.push({ ...row, score: scoreOf(row, currentYear), contributingRosterCount });
  }

  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.year - a.year; // tie → newer paper first
  });
  return scored;
}

/**
 * Readiness verdict: a program with zero curated roster members can never
 * be analysed (`no-roster` — the runner makes ZERO AI calls for this
 * verdict). A roster that exists but whose members have under 10 distinct
 * papers in the 10y window is `thin` — enough to render, not enough to
 * support confident theme claims (confidence is ceiled accordingly by the
 * prompt layer, not here).
 */
export function readinessFor(rosterSize: number, distinctPapers: number): ExpertiseReadiness {
  if (rosterSize === 0) return 'no-roster';
  if (distinctPapers < THIN_PAPER_THRESHOLD) return 'thin';
  return 'ok';
}

/**
 * Deterministic stats block, computed in code (never asked of the model) —
 * this is what lets the prompt state facts like "312 further papers not
 * shown" without the model ever re-deriving them, and is what a reader can
 * audit the model's theme/trend claims against.
 *
 * `papers` is the FULL deduped+scored set (not just the top-N handed to the
 * model) — papersPerYear / topVenues / quartileMix summarise the whole
 * roster's output, not just the visible sample, which is the entire point
 * of shipping a stats block alongside a truncated paper list.
 */
export function buildExpertiseStats(
  papers: ScoredPaper[],
  keptN: number,
  rosterSize: number,
): ExpertiseStats {
  const perYear = new Map<number, number>();
  const perVenue = new Map<string, number>();
  const quartileMix = { q1: 0, q2: 0, q3plus: 0, unassessed: 0 };

  for (const p of papers) {
    perYear.set(p.year, (perYear.get(p.year) ?? 0) + 1);
    if (p.venue) perVenue.set(p.venue, (perVenue.get(p.venue) ?? 0) + 1);
    if (p.quartile === 1) quartileMix.q1 += 1;
    else if (p.quartile === 2) quartileMix.q2 += 1;
    else if (p.quartile !== null && p.quartile >= 3) quartileMix.q3plus += 1;
    else quartileMix.unassessed += 1;
  }

  const papersPerYear = Array.from(perYear.entries())
    .sort(([yearA], [yearB]) => yearA - yearB)
    .map(([year, count]) => ({ year, count }));

  const topVenues = Array.from(perVenue.entries())
    .sort(([venueA, countA], [venueB, countB]) => {
      if (countB !== countA) return countB - countA;
      return venueA.localeCompare(venueB); // deterministic tie-break
    })
    .slice(0, TOP_VENUES_LIMIT)
    .map(([venue, count]) => ({ venue, count }));

  return {
    papersPerYear,
    topVenues,
    quartileMix,
    totalDistinct: papers.length,
    rosterSize,
    notShownCount: Math.max(0, papers.length - keptN),
  };
}

/**
 * Assembles the full input for the program-research-expertise prompt.
 * Returns null ONLY when the program itself does not exist — a program
 * with zero roster members still returns a (readiness: 'no-roster')
 * result so the runner/UI can explain why nothing was generated.
 */
export async function assembleResearchExpertiseInput(
  programId: string,
): Promise<ResearchExpertiseInput | null> {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: {
      nameEn: true,
      level: true,
      faculty: { select: { nameEn: true } },
    },
  });
  if (!program) return null;

  const roster = await prisma.programFaculty.findMany({
    where: { programId },
    select: { facultyMemberId: true },
  });
  const rosterSize = roster.length;
  const memberIds = roster.map((r) => r.facultyMemberId);

  const currentYear = new Date().getUTCFullYear();

  const rows: PaperRow[] =
    memberIds.length > 0
      ? await prisma.researchOutput.findMany({
          where: {
            facultyMemberId: { in: memberIds },
            year: { gte: currentYear - 10 },
            ...realDataWhere(),
          },
          select: {
            title: true,
            venue: true,
            year: true,
            citations: true,
            quartile: true,
            doi: true,
            openalexId: true,
            scopusId: true,
            pmid: true,
          },
        })
      : [];

  const scored = dedupAndScorePapers(rows, currentYear);
  const readiness = readinessFor(rosterSize, scored.length);
  const stats = buildExpertiseStats(scored, TOP_PAPERS_LIMIT, rosterSize);
  const topPapers = scored.slice(0, TOP_PAPERS_LIMIT);

  return {
    readiness,
    topPapers,
    stats,
    programNameEn: program.nameEn,
    programLevel: program.level,
    facultyNameEn: program.faculty.nameEn,
  };
}
