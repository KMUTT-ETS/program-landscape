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

export type { OverlapMatrixLayer, OverlapMatrixResponse, OverlapPairDetail };
export type OverlapCell = ApiOverlapMatrixCell;
export type OverlapActionKey = NonNullable<OverlapPairDetail['primaryAction']>;
export type OverlapLevel = OverlapMatrixResponse['level'];

/** Weakest → strongest, the order the rules rank them (spec §6.1). */
export const OVERLAP_ACTION_ORDER: readonly OverlapActionKey[] = [
  'COORDINATE_SHARED_COURSES',
  'CONSOLIDATE_EQUIVALENT_COURSES',
  'SHARE_STAFF_RESOURCES',
  'DIFFERENTIATE',
  'CONSIDER_MERGE_OR_TRACK',
];

export const OVERLAP_ACTION_LABEL: Record<OverlapActionKey, string> = {
  COORDINATE_SHARED_COURSES: 'Coordinate shared courses',
  CONSOLIDATE_EQUIVALENT_COURSES: 'Consolidate equivalent courses',
  SHARE_STAFF_RESOURCES: 'Share staff & resources',
  DIFFERENTIATE: 'Differentiate',
  CONSIDER_MERGE_OR_TRACK: 'Consider merge or track',
};

/** Every action is a suggestion for a human to weigh, never a verdict. */
export function actionBadgeLabel(action: OverlapActionKey): string {
  return `${OVERLAP_ACTION_LABEL[action]} — for review`;
}

export const LANGUAGE_VARIANT_LABEL = 'Thai / international versions';

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
    'a' | 'b' | 'overlapIndex' | 'structure' | 'content' | 'outcome' | 'marketSimilarity' | 'primaryAction' | 'languageVariant'
  >,
  names: ReadonlyMap<string, string> | Readonly<Record<string, string>>,
): string {
  const name = (id: string): string =>
    (names instanceof Map ? names.get(id) : (names as Readonly<Record<string, string>>)[id]) ?? id;
  const parts: string[] = [`${name(cell.a)} ↔ ${name(cell.b)}`];
  if (cell.overlapIndex !== null) {
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

/** "72" / "—" for a nullable 0–100 figure. */
export function pct(v: number | null): string {
  return v === null ? '—' : String(Math.round(v));
}

/** Short programme label: Thai name (data labels stay Thai), code as fallback. */
export function programmeLabel(p: { code: string; nameTh: string; nameEn: string | null }): string {
  return p.nameTh || p.nameEn || p.code;
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
