import { prisma } from '../index';
import { loadImportReferences } from './references';
import type { ImportCellValue, ImportDataset } from './types';
import { readDeclaredScopes, readDeclaredTerm, validateSheet, type ParsedSheet, type ValidateResult } from './validate';

/** The database reads validation needs, injectable so tests need no database. */
export interface PrepareDeps {
  loadReferences: (dataset: ImportDataset) => Promise<Map<string, Set<string>>>;
  heldCount: (dataset: ImportDataset) => Promise<number>;
  /** Rows held for one term; undefined unless the dataset is term-scoped. */
  heldCountForTerm: (
    dataset: ImportDataset,
    term: Readonly<Record<string, ImportCellValue>>,
  ) => Promise<number | undefined>;
  /** Rows held for the scopes a file names; undefined unless programme-scoped. */
  heldCountForScope: (
    dataset: ImportDataset,
    scopes: readonly Readonly<Record<string, ImportCellValue>>[],
  ) => Promise<number | undefined>;
}

export const defaultPrepareDeps: PrepareDeps = {
  loadReferences: loadImportReferences,
  heldCount: (dataset) => dataset.count(prisma),
  heldCountForTerm: (dataset, term) =>
    dataset.countForTerm ? dataset.countForTerm(prisma, term) : Promise.resolve(undefined),
  heldCountForScope: (dataset, scopes) =>
    dataset.countForScope ? dataset.countForScope(prisma, scopes) : Promise.resolve(undefined),
};

/** Reads the baselines the shrink guard needs, then validates the sheet. */
export async function prepareImportRows(
  dataset: ImportDataset,
  parsed: ParsedSheet,
  opts: { allowShrink: boolean; maxRows: number },
  deps: PrepareDeps = defaultPrepareDeps,
): Promise<ValidateResult> {
  const [references, heldRowCount] = await Promise.all([deps.loadReferences(dataset), deps.heldCount(dataset)]);

  // A term-scoped file is compared against its own term, not the table.
  // The term is read from the file here only to pick that baseline;
  // validateSheet is still what refuses a file whose rows disagree.
  const declaredTerm = readDeclaredTerm(dataset, parsed);
  const heldRowCountForTerm = declaredTerm ? await deps.heldCountForTerm(dataset, declaredTerm) : undefined;

  // Likewise a programme-scoped file is compared against the rows held for
  // the programmes it names.
  const declaredScopes = readDeclaredScopes(dataset, parsed);
  const heldRowCountForScope = declaredScopes ? await deps.heldCountForScope(dataset, declaredScopes) : undefined;

  return validateSheet(dataset, parsed, {
    references,
    heldRowCount,
    heldRowCountForTerm,
    heldRowCountForScope,
    allowShrink: opts.allowShrink,
    maxRows: opts.maxRows,
  });
}
