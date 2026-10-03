// /education/program-overlap — pure labels, formatters and the pair-list
// ranking (program-overlap.v1, spec §10.1). No runtime imports from @kku/db: the read-model types come in
// as `import type` only, so this module is safe in client components and in
// node-environment tests.
import type {
  OverlapMatrixCell as ApiOverlapMatrixCell,
  OverlapMatrixLayer,
  OverlapMatrixResponse,
  OverlapPairDetail,
} from '@kku/db';
import { hasNoCourseDataCell } from '@/components/overlap/labels';

export type { OverlapMatrixLayer, OverlapMatrixResponse, OverlapPairDetail };
export type OverlapCell = ApiOverlapMatrixCell;
export type OverlapLevel = OverlapMatrixResponse['level'];

// Action labels, formatters and the language-variant label are shared with
// the Deep-Dive section and the Risk panel; re-exported so this module stays
// the dashboard's single import point.
export {
  LANGUAGE_VARIANT_LABEL,
  OVERLAP_ACTION_LABEL,
  OVERLAP_ACTION_ORDER,
  actionBadgeLabel,
  hasNoCourseData,
  hasNoCourseDataCell,
  pct,
  programmeLabel,
  sortActionsStrongestFirst,
  type OverlapActionKey,
} from '@/components/overlap/labels';

export const OVERLAP_LEVELS: ReadonlyArray<{ value: OverlapLevel; label: string }> = [
  { value: 'BACHELOR', label: 'Bachelor' },
  { value: 'MASTER', label: 'Master' },
  { value: 'DOCTORAL', label: 'Doctoral' },
  { value: 'HIGHER_GRAD_DIPLOMA', label: 'Higher graduate diploma' },
];

/**
 * The measures the network and the pair list can rank by. Under D9 the
 * overlap index is course-only (mean of structure and content); PLO
 * alignment and market similarity are not overlap measures, so they live in
 * the pair panel only.
 */
export type OverlapNetworkLayer = Extract<OverlapMatrixLayer, 'index' | 'structure' | 'content'>;

export const OVERLAP_LAYERS: ReadonlyArray<{ value: OverlapNetworkLayer; label: string; hint: string }> = [
  { value: 'index', label: 'Overlap index', hint: 'Mean of the course layers (structure, content) that could be measured' },
  { value: 'structure', label: 'Structure', hint: 'Major courses shared by code, by credits' },
  { value: 'content', label: 'Content', hint: 'Equivalent major courses, including those with different codes' },
];

/** The cell value for a layer. */
export function layerValue(cell: OverlapCell, layer: OverlapMatrixLayer): number | null {
  switch (layer) {
    case 'index':
      return cell.overlapIndex;
    case 'structure':
      return cell.structure;
    case 'content':
      return cell.content;
    case 'outcome':
      return cell.outcome;
    case 'market':
      return cell.marketSimilarity;
  }
}

type ProgrammeNames = Pick<OverlapMatrixResponse['programmes'][number], 'code' | 'nameTh' | 'nameEn'>;

/**
 * The short name drawn on a network node — the Thai major, not the degree
 * name, since most siblings share a degree. Handles the three forms in the
 * programme register:
 *   "วิทยาศาสตรบัณฑิต (ฟิสิกส์)"                      → "ฟิสิกส์"
 *   "หลักสูตรวิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมเคมี" → "วิศวกรรมเคมี"
 *   "ศิลปศาสตรบัณฑิต การระหว่างประเทศ"                → "การระหว่างประเทศ"
 * A bare degree name ("เภสัชศาสตรบัณฑิต") stays as it is, and so does a
 * bracket that only says "international" ("(นานาชาติ)", dropped). Data labels stay Thai.
 */
export function shortProgrammeLabel(p: ProgrammeNames): string {
  const th = (p.nameTh ?? '').trim().replace(/^หลักสูตร/, '');
  if (!th) return p.nameEn || p.code;
  const major = th.match(/สาขาวิชา\s*(.+)$/);
  // "สาขาวิชา (เภสัชวิทยา)" — drop the wrapping brackets.
  if (major?.[1]) return major[1].trim().replace(/^\((.+)\)$/, '$1');
  const inner = th.match(/\(([^()]+)\)\s*$/);
  if (inner?.[1] && inner[1].trim() !== 'นานาชาติ') return inner[1].trim();
  // "(นานาชาติ)" is dropped: the node's second line already says "Intl".
  const base = th.replace(/\s*\(นานาชาติ\)\s*$/, '');
  const afterDegree = base.match(/^\S*บัณฑิต\s+(.+)$/);
  if (afterDegree?.[1]) return afterDegree[1].trim();
  return base;
}

/** True for an international programme (its English name says so). */
export function isInternationalProgramme(p: Pick<ProgrammeNames, 'nameEn'>): boolean {
  return /international program/i.test(p.nameEn ?? '');
}

/** Second node line: faculty code, plus "Intl" so twin names stay distinct. */
export function nodeSublabel(
  p: Pick<OverlapMatrixResponse['programmes'][number], 'nameEn' | 'facultyCode'>,
): string {
  return [p.facultyCode, isInternationalProgramme(p) ? 'Intl' : null].filter(Boolean).join(' · ');
}

/**
 * The larger containment direction of a pair, or null when neither side
 * could be measured: "A ⊂ B 84 %" means 84 % of A's major credits are
 * found in B.
 */
export function largestContainment(
  cell: Pick<OverlapCell, 'containmentAInB' | 'containmentBInA'>,
): { inner: 'A' | 'B'; value: number } | null {
  // `?? null` tolerates an API built before containment joined the cell.
  const ab = cell.containmentAInB ?? null;
  const ba = cell.containmentBInA ?? null;
  if (ab === null && ba === null) return null;
  if (ba === null || (ab !== null && ab >= ba)) return { inner: 'A', value: ab ?? 0 };
  return { inner: 'B', value: ba };
}

/**
 * The ranked pair list: scored pairs (a course comparison exists) whose
 * layer value reaches the threshold, optionally only those touching one
 * programme, strongest first. Not-scored pairs are left out (D9).
 */
export function overlapPairRows(
  cells: readonly OverlapCell[],
  opts: { layer: OverlapNetworkLayer; threshold: number; nodeId?: string | null },
): Array<{ cell: OverlapCell; value: number }> {
  const rows: Array<{ cell: OverlapCell; value: number }> = [];
  for (const cell of cells) {
    if (hasNoCourseDataCell(cell)) continue;
    const value = layerValue(cell, opts.layer);
    if (value === null || value < opts.threshold) continue;
    if (opts.nodeId && cell.a !== opts.nodeId && cell.b !== opts.nodeId) continue;
    rows.push({ cell, value });
  }
  return rows.sort(
    (x, y) =>
      y.value - x.value ||
      (y.cell.overlapIndex ?? -1) - (x.cell.overlapIndex ?? -1) ||
      (x.cell.pairId < y.cell.pairId ? -1 : x.cell.pairId > y.cell.pairId ? 1 : 0),
  );
}

/** Filters held in the URL. */
export interface OverlapFilters {
  level: OverlapLevel;
  layer: OverlapNetworkLayer;
  facultyId: string | null;
  threshold: number;
  /** Selected network node: filters the pair list to that programme. */
  node: string | null;
  pair: string | null;
}

export const DEFAULT_THRESHOLD = 30;
export const THRESHOLD_OPTIONS = [30, 50, 70] as const;

export function overlapQueryString(f: OverlapFilters): string {
  const qs = new URLSearchParams();
  if (f.level !== 'BACHELOR') qs.set('level', f.level);
  if (f.layer !== 'index') qs.set('layer', f.layer);
  if (f.facultyId) qs.set('facultyId', f.facultyId);
  if (f.threshold !== DEFAULT_THRESHOLD) qs.set('threshold', String(f.threshold));
  if (f.node) qs.set('node', f.node);
  if (f.pair) qs.set('pair', f.pair);
  return qs.toString();
}
