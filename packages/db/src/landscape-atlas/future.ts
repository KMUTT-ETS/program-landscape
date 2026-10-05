// packages/db/src/landscape-atlas/future.ts
import { meanOf, round1 } from './scales';
import {
  LANDSCAPE_ATLAS_VERSION,
  NO_ANSWER,
  SECTOR_THIN_PROGRAMMES,
  type ChapterAnswer,
} from './types';

// ── Future-fit scorecard (spec 4.6, D8: three columns) ───────────────

export const SCORECARD_COLUMNS = [
  'AI readiness',
  'Digital intelligence (DQ)',
  'Relevance',
] as const;

export type ScorecardScopeLevel = 'university' | 'faculty' | 'department' | 'program';

/** One canonical ACTIVE programme in scope. */
export interface ScorecardProgrammeInput {
  programId: string;
  code: string;
  nameTh: string;
  nameEn: string;
  level: string;
  facultyId: string;
  facultyNameTh: string;
  facultyNameEn: string;
  /** programAiReadiness().overallScore; null = no extracted skills. */
  aiReadiness: number | null;
  /** Health relevance dimension. */
  relevance: number | null;
  /** The programme's own DQ (bachelor only, above the student floor); null otherwise. */
  dq: number | null;
  dqStudents: number;
}

/** A DQ rollup: dqCompetencyByScope(...).rawMean and its scored students. */
export interface DqRollup {
  value: number | null;
  students: number;
}

export interface ScorecardInput {
  programmes: readonly ScorecardProgrammeInput[];
  /** DQ rollup per faculty id; a missing faculty reads null. */
  facultyDq: ReadonlyMap<string, DqRollup>;
  /** DQ rollup at the chapter scope (the total row). */
  totalDq: DqRollup;
  scopeLevel: ScorecardScopeLevel;
}

export interface ScorecardNode {
  id: string;
  label: string;
  sublabel: string;
  kind: 'faculty' | 'level' | 'programme' | 'total';
  cells: Array<number | null>;
  mean: number | null;
  present: number;
  /** Students behind the DQ cell; null where the row carries no DQ. */
  dqStudents: number | null;
  href?: string;
  children: ScorecardNode[];
}

export interface Scorecard {
  columns: string[];
  rows: ScorecardNode[];
  /** Pinned last, never expandable. */
  total: ScorecardNode;
  /** Plain sentence naming the weakest faculties, or null. */
  note: string | null;
}

export const SCORECARD_LEVELS = [
  ['BACHELOR', 'Bachelor'],
  ['MASTER', 'Master'],
  ['DOCTORAL', 'Doctoral'],
  ['HIGHER_GRAD_DIPLOMA', 'Higher grad diploma'],
] as const;

const DQ_LEVEL = 'BACHELOR';

const TOTAL_LABEL: Record<ScorecardScopeLevel, string> = {
  university: 'University average',
  faculty: 'Faculty average',
  department: 'Department average',
  program: 'Programme average',
};

function node(
  base: Omit<ScorecardNode, 'cells' | 'mean' | 'present'>,
  ai: number | null,
  dq: number | null,
  relevance: number | null,
): ScorecardNode {
  const cells = [ai, dq, relevance].map((v) => (v === null ? null : round1(v)));
  const mean = meanOf(cells);
  return {
    ...base,
    cells,
    mean: mean === null ? null : round1(mean),
    present: cells.filter((c) => c !== null).length,
  };
}

function byMean(a: ScorecardNode, b: ScorecardNode): number {
  if (a.mean === null && b.mean === null) return a.label.localeCompare(b.label);
  if (a.mean === null) return 1;
  if (b.mean === null) return -1;
  return b.mean - a.mean || a.label.localeCompare(b.label);
}

const meanAi = (ps: readonly ScorecardProgrammeInput[]) => meanOf(ps.map((p) => p.aiReadiness));
const meanRel = (ps: readonly ScorecardProgrammeInput[]) => meanOf(ps.map((p) => p.relevance));
const plural = (n: number) => `${n} programme${n === 1 ? '' : 's'}`;

/**
 * Faculty → level → programme. AI readiness and relevance are means over the
 * programmes beneath a row (never a mean of child means); DQ is a scope
 * rollup, bachelor only.
 */
export function buildScorecard(input: ScorecardInput): Scorecard {
  const byFaculty = new Map<string, ScorecardProgrammeInput[]>();
  for (const p of input.programmes) {
    const list = byFaculty.get(p.facultyId) ?? [];
    list.push(p);
    byFaculty.set(p.facultyId, list);
  }

  const rows: ScorecardNode[] = [];
  for (const [facultyId, ps] of byFaculty) {
    const fDq = input.facultyDq.get(facultyId) ?? { value: null, students: 0 };
    const levels: ScorecardNode[] = [];
    for (const [level, levelLabel] of SCORECARD_LEVELS) {
      const lps = ps.filter((p) => p.level === level);
      if (lps.length === 0) continue;
      const programmes = lps
        .map((p) => {
          const dq = p.level === DQ_LEVEL ? p.dq : null;
          return node(
            {
              id: p.programId,
              label: p.nameTh,
              sublabel: p.nameEn && p.nameEn !== p.nameTh ? `${p.code} · ${p.nameEn}` : p.code,
              kind: 'programme',
              dqStudents: dq === null ? null : p.dqStudents,
              href: `/programs/${p.programId}`,
              children: [],
            },
            p.aiReadiness,
            dq,
            p.relevance,
          );
        })
        .sort(byMean);
      const isDq = level === DQ_LEVEL;
      levels.push(
        node(
          {
            id: `${facultyId}:${level}`,
            label: levelLabel,
            sublabel: plural(lps.length),
            kind: 'level',
            dqStudents: isDq ? fDq.students : null,
            children: programmes,
          },
          meanAi(lps),
          isDq ? fDq.value : null,
          meanRel(lps),
        ),
      );
    }
    const first = ps[0]!;
    rows.push(
      node(
        {
          id: facultyId,
          label: first.facultyNameTh,
          sublabel: first.facultyNameEn,
          kind: 'faculty',
          dqStudents: fDq.students,
          children: levels,
        },
        meanAi(ps),
        fDq.value,
        meanRel(ps),
      ),
    );
  }
  rows.sort(byMean);

  const total = node(
    {
      id: 'total',
      label: TOTAL_LABEL[input.scopeLevel],
      sublabel: plural(input.programmes.length),
      kind: 'total',
      dqStudents: input.totalDq.students,
      children: [],
    },
    meanAi(input.programmes),
    input.totalDq.value,
    meanRel(input.programmes),
  );

  const eligible = rows.filter((r) => r.present >= 2);
  // Naming "the lowest" is only meaningful with enough faculties to rank.
  const lowest = eligible.length >= 4 ? eligible.slice(-3).reverse() : [];
  return {
    columns: [...SCORECARD_COLUMNS],
    rows,
    total,
    note: lowest.length
      ? `Lowest on the measures available: ${lowest.map((r) => r.sublabel || r.label).join(', ')}.`
      : null,
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

export function buildFuture(
  scorecard: ScorecardInput,
  coverage: CoverageInput,
  computedAt: string,
): FutureChapter {
  const universityScope = scorecard.scopeLevel === 'university';
  const grid = buildCoverage(coverage);
  const n = grid.columns.length;
  const thin = grid.thinSectors.length;
  const fed = grid.columns.filter((c) => c.total > 0).length;
  const answer: ChapterAnswer =
    n === 0
      ? NO_ANSWER
      : !universityScope
        ? {
            figure: `${fed} of ${n}`,
            sentence:
              'national strategic sectors are fed by programmes in this scope' +
              (grid.unmappedSectors.length
                ? `; none mapped for ${grid.unmappedSectors.join(', ')}.`
                : '.'),
          }
        : {
            figure: `${thin === 0 ? n : thin} of ${n}`,
            sentence:
              thin === 0
                ? `national strategic sectors are fed by ${SECTOR_THIN_PROGRAMMES} or more programmes.`
                : `national strategic ${thin === 1 ? 'sector is' : 'sectors are'} fed by fewer than ${SECTOR_THIN_PROGRAMMES} programmes` +
                  (grid.unmappedSectors.length
                    ? `; ${grid.unmappedSectors.join(', ')} by none we can map.`
                    : '.'),
          };
  return {
    version: LANDSCAPE_ATLAS_VERSION,
    computedAt,
    scorecard: buildScorecard(scorecard),
    coverage: grid,
    answer,
  };
}
