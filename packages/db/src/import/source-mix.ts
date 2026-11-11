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
  sources: ImportVia[];
  lastBy: SourceMixEntry | null;
  /** One entry per term (term-scoped) or programme (programme-scoped), newest writer only. */
  perScope: (SourceMixEntry & { label: string })[];
}

const API_FILENAME_PREFIX = 'API: ';

/** The connector display name an API batch carries in its filename. */
export function connectorFromBatch(via: ImportVia, filename: string): string | null {
  if (via !== 'api') return null;
  return filename.startsWith(API_FILENAME_PREFIX) ? filename.slice(API_FILENAME_PREFIX.length) : filename;
}

/** `via` as recorded in run metadata; an absent or unknown value means an upload. */
export function viaFromMetadata(metadata: unknown): ImportVia {
  if (metadata && typeof metadata === 'object' && (metadata as { via?: unknown }).via === 'api') return 'api';
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
  if (termColumns.length === 2 && termColumns.includes('academicYear') && termColumns.includes('semester')
    && year !== undefined && semester !== undefined) {
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
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${String(d.getUTCDate()).padStart(2, '0')} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

function asRecord(v: unknown): Record<string, ImportCellValue> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, ImportCellValue>) : null;
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

/**
 * The mix as the loader needs it: the public SourceMix plus the most recent
 * API connector's name, which the upsert warning quotes even when the
 * current load is itself an upload.
 */
export async function readSourceMix(datasetSlug: string): Promise<SourceMix & { apiConnector: string | null }> {
  const dataset = getImportDataset(datasetSlug);
  // SUCCEEDED only: a FAILED or LOADING batch has not put rows in the table.
  const batches = await prisma.importBatch.findMany({
    where: { datasetSlug, status: 'SUCCEEDED' },
    orderBy: { createdAt: 'asc' },
    select: { filename: true, createdAt: true, ingestionRun: { select: { metadata: true } } },
  });

  const sources = new Set<ImportVia>();
  const newest = new Map<string, SourceMixEntry & { label: string }>();
  let lastBy: SourceMixEntry | null = null;
  let apiConnector: string | null = null;

  for (const b of batches) {
    // A batch whose run is gone has no metadata: it can only be an upload.
    const via = viaFromMetadata(b.ingestionRun?.metadata);
    const connector = connectorFromBatch(via, b.filename);
    const entry: SourceMixEntry = { via, connector, at: b.createdAt };
    sources.add(via);
    lastBy = entry;
    if (via === 'api') apiConnector = connector;
    for (const label of labelsFor(dataset, b.ingestionRun?.metadata)) newest.set(label, { ...entry, label });
  }

  return {
    sources: [...sources],
    lastBy,
    perScope: [...newest.values()],
    apiConnector,
  };
}

export async function importSourceMix(datasetSlug: string): Promise<SourceMix> {
  const { sources, lastBy, perScope } = await readSourceMix(datasetSlug);
  return { sources, lastBy, perScope };
}

/**
 * What to tell the operator about a load that is about to happen. Computed
 * from the mix BEFORE the load, since the load itself rewrites it.
 */
export function loadWarnings(
  dataset: ImportDataset,
  mix: SourceMix & { apiConnector: string | null },
  source: { via: ImportVia; connectorName?: string },
  term?: Readonly<Record<string, ImportCellValue>>,
  scopes?: readonly Readonly<Record<string, ImportCellValue>>[],
): string[] {
  const warnings: string[] = [];
  if (dataset.strategy.kind === 'upsert') {
    const other: ImportVia = source.via === 'api' ? 'upload' : 'api';
    if (mix.sources.includes(other)) {
      const connector = source.via === 'api' ? source.connectorName : mix.apiConnector;
      warnings.push(
        `Rows in this dataset come from both uploads and the API connector "${connector ?? ''}". A row may hold values from both.`,
      );
    }
    return warnings;
  }
  for (const label of labelsForLoad(dataset, term, scopes)) {
    const prior = mix.perScope.find((p) => p.label === label);
    if (!prior || prior.via === source.via) continue;
    const who = prior.via === 'upload' ? 'an upload' : `the API connector "${prior.connector ?? ''}"`;
    warnings.push(`${label} was last loaded by ${who} on ${formatWarningDate(prior.at)}. This load replaced it.`);
  }
  return warnings;
}
