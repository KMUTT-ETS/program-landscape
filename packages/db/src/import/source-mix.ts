import { prisma } from '../index';
import { getImportDataset } from './registry';
import type { ImportCellValue, ImportDataset } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Which sources — uploaded files, or an institution's API connector — have
// loaded a dataset, and who wrote each term or programme last.
//
// API loads are stored under the dataset's own `xlsx-<slug>` DataSource, so
// the only thing that tells the two apart is the import run's metadata
// (`via`, `term`, `scopes`) and the batch filename (`API: <connector name>`).
// Mixing is allowed and never refused; this module exists so the operator is
// told, not blocked.
// ─────────────────────────────────────────────────────────────────────────────

export type ImportVia = 'upload' | 'api';

export interface SourceMixEntry {
  via: ImportVia;
  /** The connector's display name; null for an upload. */
  connector: string | null;
  at: Date;
}

export interface SourceMix {
  /** The kinds of source present: uploads, API connectors, or both. */
  sources: ImportVia[];
  /**
   * Every distinct source that has loaded this dataset, with its newest load:
   * uploads count as one source, and each API connector as its own. Ordered by
   * first appearance. Two connectors filling one dataset show up here even
   * though `sources` would only say "api".
   */
  feeders: SourceMixEntry[];
  lastBy: SourceMixEntry | null;
  /** One entry per term (term-scoped) or programme (programme-scoped), newest writer only. */
  perScope: (SourceMixEntry & { label: string })[];
}

const API_FILENAME_PREFIX = 'API: ';

/** The connector display name an API batch carries in its filename. */
export function connectorFromBatch(via: ImportVia, filename: string): string | null {
  if (via !== 'api') return null;
  return filename.startsWith(API_FILENAME_PREFIX)
    ? filename.slice(API_FILENAME_PREFIX.length)
    : filename;
}

/** What makes two loads "the same source": all uploads are one, each connector is its own. */
export function sourceKey(entry: { via: ImportVia; connector: string | null }): string {
  return entry.via === 'upload' ? 'upload' : `api:${entry.connector ?? ''}`;
}

/** How a source is named inside a sentence. */
function sourcePhrase(
  entry: { via: ImportVia; connector: string | null },
  plural: boolean,
): string {
  if (entry.via === 'upload') return plural ? 'uploads' : 'an upload';
  return `the API connector "${entry.connector ?? ''}"`;
}

/** `a and b`, or `a, b and c`. */
function joinList(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/** `via` as recorded in run metadata; an absent or unknown value means an upload. */
export function viaFromMetadata(metadata: unknown): ImportVia {
  if (metadata && typeof metadata === 'object' && (metadata as { via?: unknown }).via === 'api')
    return 'api';
  return 'upload';
}

function cellText(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

/** `Semester 1/2025` for an academic-year + semester term; other shapes join their values with `/`. */
export function formatTermLabel(
  term: Readonly<Record<string, ImportCellValue>>,
  termColumns: readonly string[],
): string {
  const year = term.academicYear;
  const semester = term.semester;
  if (
    termColumns.length === 2 &&
    termColumns.includes('academicYear') &&
    termColumns.includes('semester') &&
    year !== undefined &&
    semester !== undefined
  ) {
    return `Semester ${cellText(semester)}/${cellText(year)}`;
  }
  return termColumns.map((c) => cellText(term[c])).join('/');
}

/** A programme scope's label: its scope values joined (normally the programme code). */
export function formatScopeLabel(
  scope: Readonly<Record<string, ImportCellValue>>,
  scopeColumns: readonly string[],
): string {
  return scopeColumns.map((c) => cellText(scope[c])).join('/');
}

/** `dd Mon yyyy` in UTC, e.g. `08 Nov 2026`. */
export function formatWarningDate(d: Date): string {
  const months = [
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'May',
    'Jun',
    'Jul',
    'Aug',
    'Sep',
    'Oct',
    'Nov',
    'Dec',
  ];
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function asRecord(v: unknown): Record<string, ImportCellValue> | null {
  return v && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, ImportCellValue>)
    : null;
}

/** The scope label(s) one run's metadata names for this dataset. */
function labelsFor(dataset: ImportDataset, metadata: unknown): string[] {
  const meta = asRecord(metadata);
  if (!meta) return [];
  if (dataset.strategy.kind === 'term-scoped') {
    const term = asRecord(meta.term);
    return term ? [formatTermLabel(term, dataset.strategy.termColumns)] : [];
  }
  if (dataset.strategy.kind === 'programme-scoped') {
    const scopes = Array.isArray(meta.scopes) ? meta.scopes : [];
    const columns = dataset.strategy.scopeColumns;
    return scopes.flatMap((s) => {
      const rec = asRecord(s);
      return rec ? [formatScopeLabel(rec, columns)] : [];
    });
  }
  return [];
}

/** Label for a load about to happen, so its warning matches what perScope shows. */
export function labelsForLoad(
  dataset: ImportDataset,
  term?: Readonly<Record<string, ImportCellValue>>,
  scopes?: readonly Readonly<Record<string, ImportCellValue>>[],
): string[] {
  if (dataset.strategy.kind === 'term-scoped') {
    return term ? [formatTermLabel(term, dataset.strategy.termColumns)] : [];
  }
  if (dataset.strategy.kind === 'programme-scoped') {
    const columns = dataset.strategy.scopeColumns;
    return (scopes ?? []).map((s) => formatScopeLabel(s, columns));
  }
  return [];
}

/** Which sources have loaded a dataset, read from its live (SUCCEEDED) batches. */
export async function readSourceMix(datasetSlug: string): Promise<SourceMix> {
  const dataset = getImportDataset(datasetSlug);
  // SUCCEEDED only: a FAILED or LOADING batch has not put rows in the table.
  const batches = await prisma.importBatch.findMany({
    where: { datasetSlug, status: 'SUCCEEDED' },
    orderBy: { createdAt: 'asc' },
    select: { filename: true, createdAt: true, ingestionRun: { select: { metadata: true } } },
  });

  const sources = new Set<ImportVia>();
  const feeders = new Map<string, SourceMixEntry>();
  const newest = new Map<string, SourceMixEntry & { label: string }>();
  let lastBy: SourceMixEntry | null = null;

  for (const b of batches) {
    // A batch whose run is gone has no metadata: it can only be an upload.
    const via = viaFromMetadata(b.ingestionRun?.metadata);
    const connector = connectorFromBatch(via, b.filename);
    const entry: SourceMixEntry = { via, connector, at: b.createdAt };
    sources.add(via);
    feeders.set(sourceKey(entry), entry); // Map keeps first-appearance order; the value becomes the newest load
    lastBy = entry;
    for (const label of labelsFor(dataset, b.ingestionRun?.metadata))
      newest.set(label, { ...entry, label });
  }

  return {
    sources: [...sources],
    feeders: [...feeders.values()],
    lastBy,
    perScope: [...newest.values()],
  };
}

export async function importSourceMix(datasetSlug: string): Promise<SourceMix> {
  return readSourceMix(datasetSlug);
}

/**
 * What to tell the operator about a load that is about to happen. Computed
 * from the mix BEFORE the load, since the load itself rewrites it.
 */
export function loadWarnings(
  dataset: ImportDataset,
  mix: SourceMix,
  source: { via: ImportVia; connectorName?: string },
  term?: Readonly<Record<string, ImportCellValue>>,
  scopes?: readonly Readonly<Record<string, ImportCellValue>>[],
): string[] {
  const warnings: string[] = [];
  const current = {
    via: source.via,
    connector: source.via === 'api' ? (source.connectorName ?? null) : null,
  };
  if (dataset.strategy.kind === 'upsert') {
    // Every source that will have written rows once this load is in, in first-appearance order.
    const all = [...mix.feeders];
    if (!all.some((f) => sourceKey(f) === sourceKey(current)))
      all.push({ ...current, at: new Date() });
    if (all.length > 1) {
      const names = joinList(all.map((f) => sourcePhrase(f, true)));
      warnings.push(
        all.length === 2
          ? `Rows in this dataset come from both ${names}. A row may hold values from both.`
          : `Rows in this dataset come from ${names}. A row may hold values from any of them.`,
      );
    }
    return warnings;
  }
  for (const label of labelsForLoad(dataset, term, scopes)) {
    const prior = mix.perScope.find((p) => p.label === label);
    if (!prior || sourceKey(prior) === sourceKey(current)) continue;
    warnings.push(
      `${label} was last loaded by ${sourcePhrase(prior, false)} on ${formatWarningDate(prior.at)}. This load replaced it.`,
    );
  }
  return warnings;
}
