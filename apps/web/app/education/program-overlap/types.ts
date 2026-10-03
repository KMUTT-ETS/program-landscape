// /education/program-overlap — pure labels and formatters (program-overlap.v1,
// spec §10.1). No runtime imports from @kku/db: the read-model types come in
// as `import type` only, so this module is safe in client components and in
// node-environment tests.
import type {
  OverlapMatrixCell as ApiOverlapMatrixCell,
  OverlapMatrixLayer,
  OverlapMatrixResponse,
  OverlapPairDetail,
} from '@kku/db';
import { LANGUAGE_VARIANT_LABEL, OVERLAP_ACTION_LABEL, isUncorroboratedCell } from '@/components/overlap/labels';

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
  isLimitedEvidence,
  isUncorroborated,
  isUncorroboratedCell,
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

export const OVERLAP_LAYERS: ReadonlyArray<{ value: OverlapMatrixLayer; label: string; hint: string }> = [
  { value: 'index', label: 'Overlap index', hint: 'Mean of the curriculum layers that could be measured' },
  { value: 'structure', label: 'Structure', hint: 'Major courses shared by code, by credits' },
  { value: 'content', label: 'Content', hint: 'Equivalent major courses, including those with different codes' },
  { value: 'outcome', label: 'Outcome', hint: 'PLOs covered by the other programme' },
  { value: 'market', label: 'Market similarity', hint: 'How alike the two programmes look to an applicant' },
];

/** The cell value the matrix colours by, for the selected layer. */
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

const round = (n: number) => Math.round(n);

/**
 * The hover title of one matrix cell, e.g.
 * "A ↔ B · index 72 (structure 60 · content 75 · outcome 81) · Consider merge or track".
 * Null layers are skipped rather than shown as 0; a pair stored only for its
 * market similarity says so instead of inventing an index.
 */
export function matrixTitle(
  cell: Pick<
    OverlapCell,
    | 'a'
    | 'b'
    | 'overlapIndex'
    | 'structure'
    | 'content'
    | 'outcome'
    | 'marketSimilarity'
    | 'primaryAction'
    | 'languageVariant'
    | 'uncorroborated'
  >,
  names: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): string {
  const name = (id: string): string =>
    (names instanceof Map ? names.get(id) : (names as Readonly<Record<string, string>>)[id]) ?? id;
  const parts: string[] = [`${name(cell.a)} ↔ ${name(cell.b)}`];
  if (isUncorroboratedCell(cell)) {
    // D8: a PLO-only match that nothing corroborates is not scored.
    parts.push('not scored (uncorroborated PLO match)');
  } else if (cell.overlapIndex !== null) {
    const layers: string[] = [];
    if (cell.structure !== null) layers.push(`structure ${round(cell.structure)}`);
    if (cell.content !== null) layers.push(`content ${round(cell.content)}`);
    if (cell.outcome !== null) layers.push(`outcome ${round(cell.outcome)}`);
    parts.push(`index ${round(cell.overlapIndex)}${layers.length ? ` (${layers.join(' · ')})` : ''}`);
  } else {
    parts.push('no curriculum index');
  }
  if (cell.marketSimilarity !== null) parts.push(`market similarity ${round(cell.marketSimilarity)}`);
  if (cell.primaryAction) parts.push(OVERLAP_ACTION_LABEL[cell.primaryAction]);
  if (cell.languageVariant) parts.push(LANGUAGE_VARIANT_LABEL);
  return parts.join(' · ');
}

/** Filters held in the URL. */
export interface OverlapFilters {
  level: OverlapLevel;
  layer: OverlapMatrixLayer;
  facultyId: string | null;
  threshold: number;
  pair: string | null;
}

export const DEFAULT_THRESHOLD = 30;
export const THRESHOLD_OPTIONS = [0, 30, 50, 70] as const;

export function overlapQueryString(f: OverlapFilters): string {
  const qs = new URLSearchParams();
  if (f.level !== 'BACHELOR') qs.set('level', f.level);
  if (f.layer !== 'index') qs.set('layer', f.layer);
  if (f.facultyId) qs.set('facultyId', f.facultyId);
  if (f.threshold !== DEFAULT_THRESHOLD) qs.set('threshold', String(f.threshold));
  if (f.pair) qs.set('pair', f.pair);
  return qs.toString();
}
