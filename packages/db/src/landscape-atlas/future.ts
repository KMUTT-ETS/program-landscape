// packages/db/src/landscape-atlas/future.ts
import { meanOf, round1 } from './scales';
import { LANDSCAPE_ATLAS_VERSION, NO_ANSWER, SECTOR_THIN_PROGRAMMES, type ChapterAnswer } from './types';

// ── Future-fit scorecard (spec 4.6, D8: three columns) ───────────────

export const SCORECARD_COLUMNS = ['AI readiness', 'Digital intelligence (DQ)', 'Relevance'] as const;

export interface ScorecardInput {
  facultyId: string;
  code: string;
  nameTh: string;
  nameEn: string;
  /** Mean of programmes' programAiReadiness().overallScore; null = none scored. */
  aiReadiness: number | null;
  /** dqCompetencyByScope(...).rawMean; null = no scored students. */
  dq: number | null;
  dqStudents: number;
  /** Mean of programmes' health relevance dimension. */
  relevance: number | null;
}

export interface ScorecardRow {
  id: string;
  label: string;
  sublabel: string;
  cells: Array<number | null>;
  mean: number | null;
  present: number;
  dqStudents: number;
}

export interface Scorecard {
  columns: string[];
  rows: ScorecardRow[];
  /** Plain sentence naming the weakest faculties, or null. */
  note: string | null;
}

export function buildScorecard(inputs: readonly ScorecardInput[]): Scorecard {
  const rows: ScorecardRow[] = inputs.map((r) => {
    const cells = [r.aiReadiness, r.dq, r.relevance].map((v) => (v === null ? null : round1(v)));
    const mean = meanOf(cells);
    return {
      id: r.facultyId,
      label: r.nameTh,
      sublabel: r.nameEn,
      cells,
      mean: mean === null ? null : round1(mean),
      present: cells.filter((c) => c !== null).length,
      dqStudents: r.dqStudents,
    };
  });
  rows.sort((a, b) => {
    if (a.mean === null && b.mean === null) return a.label.localeCompare(b.label);
    if (a.mean === null) return 1;
    if (b.mean === null) return -1;
    return b.mean - a.mean || a.label.localeCompare(b.label);
  });
  const eligible = rows.filter((r) => r.present >= 2);
  const lowest = eligible.slice(-3).reverse();
  return {
    columns: [...SCORECARD_COLUMNS],
    rows,
    note: lowest.length ? `Lowest on the measures available: ${lowest.map((r) => r.sublabel || r.label).join(', ')}.` : null,
  };
}

// ── National-strategy coverage (spec 4.7) ────────────────────────────

export interface CoverageInput {
  faculties: Array<{ id: string; code: string; nameTh: string; nameEn: string }>;
  sectors: Array<{ id: string; code: string; nameTh: string; nameEn: string }>;
  counts: Array<{ facultyId: string; sectorId: string; programmes: number }>;
}

export interface CoverageGrid {
  columns: Array<{ id: string; label: string; total: number }>;
  rows: Array<{ id: string; label: string; sublabel: string; cells: Array<number | null> }>;
  unmappedSectors: string[];
  thinSectors: string[];
}

export function buildCoverage(input: CoverageInput): CoverageGrid {
  const key = (f: string, s: string) => `${f}|${s}`;
  const count = new Map(input.counts.map((c) => [key(c.facultyId, c.sectorId), c.programmes]));
  const columns = input.sectors.map((s) => ({
    id: s.id,
    label: s.nameEn,
    total: input.counts.filter((c) => c.sectorId === s.id).reduce((a, c) => a + c.programmes, 0),
  }));
  const rows = input.faculties.map((f) => ({
    id: f.id,
    label: f.nameTh,
    sublabel: f.nameEn,
    cells: input.sectors.map((s) => count.get(key(f.id, s.id)) ?? null),
  }));
  return {
    columns,
    rows,
    unmappedSectors: columns.filter((c) => c.total === 0).map((c) => c.label),
    thinSectors: columns.filter((c) => c.total < SECTOR_THIN_PROGRAMMES).map((c) => c.label),
  };
}

// ── Chapter ───────────────────────────────────────────────────────────

export interface FutureChapter {
  version: typeof LANDSCAPE_ATLAS_VERSION;
  computedAt: string;
  scorecard: Scorecard;
  coverage: CoverageGrid;
  answer: ChapterAnswer;
}

export function buildFuture(scorecard: readonly ScorecardInput[], coverage: CoverageInput, computedAt: string): FutureChapter {
  const grid = buildCoverage(coverage);
  const n = grid.columns.length;
  const thin = grid.thinSectors.length;
  const answer: ChapterAnswer =
    n === 0
      ? NO_ANSWER
      : {
          figure: `${thin} of ${n}`,
          sentence:
            `${thin} of ${n} national strategic sectors ${thin === 1 ? 'is' : 'are'} fed by fewer than ${SECTOR_THIN_PROGRAMMES} programmes` +
            (grid.unmappedSectors.length ? `; ${grid.unmappedSectors.join(', ')} by none we can map.` : '.'),
        };
  return { version: LANDSCAPE_ATLAS_VERSION, computedAt, scorecard: buildScorecard(scorecard), coverage: grid, answer };
}
