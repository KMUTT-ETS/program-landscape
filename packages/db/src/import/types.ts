import type { Prisma, PrismaClient } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// Spreadsheet import — declaration types.
//
// One declaration per importable dataset. Template generation, header and
// cell validation, the guide sheet, pre-fill and loading all read the same
// object, so a template cannot drift from the validator that accepts it.
//
// This module is imported by apps/web through the @kku/db barrel. It must
// never import `xlsx` — the parser and the template writer live in
// apps/api/src/import/. A test in test/import-registry.test.ts enforces it.
// ─────────────────────────────────────────────────────────────────────────────

/** The cell shapes a template column can declare. */
export type ImportCellType = 'text' | 'integer' | 'decimal' | 'date' | 'boolean' | 'enum';

/** A validated cell value, after coercion from whatever the sheet held. */
export type ImportCellValue = string | number | boolean | Date | null;

/** One validated row, keyed by `ImportColumn.key` (not by header text). */
export type ImportRow = Readonly<Record<string, ImportCellValue>>;

/** One column of the data sheet. */
export interface ImportColumn {
  /** Exact header text in the data sheet. Compared after trimming. */
  header: string;
  /** Machine key, used in validation errors and in the loader's rows. */
  key: string;
  type: ImportCellType;
  /** A missing or blank value fails validation when true. */
  required: boolean;
  /** Required when `type` is 'enum'; the only accepted values. */
  enumValues?: readonly string[];
  /** Prose for the guide sheet. The adopter's only documentation. */
  guide: string;
  /** Shown in the guide sheet's Example column. */
  example: string;
  /** Value must already exist in another dataset, checked at validation. */
  references?: { dataset: string; column: string };
  /**
   * Marks a headcount column that gates k-anonymity on its row: a row whose
   * value is below `minimum` fails the file. The connectors apply this in
   * SQL (`HAVING COUNT(*) >= 5`); an uploaded sheet has no such guarantee.
   */
  groupSizeFor?: { minimum: number };
}

/**
 * How the loader finds the row an uploaded row corresponds to.
 *
 * 'unique' — a real Prisma compound unique, every component non-nullable.
 * 'manual' — findFirst → update | create. Needed when a key component is
 *   nullable (Postgres treats NULL ≠ NULL in a unique index, and Prisma's
 *   compound `where` rejects a null component) or when no constraint exists.
 */
export type ImportMatch =
  | { kind: 'unique'; columns: readonly string[] }
  | { kind: 'manual'; columns: readonly string[]; fallback?: readonly string[] };

/**
 * How a file's rows relate to rows already held.
 *
 * 'upsert'      — match and update, insert the rest, touch nothing else.
 * 'term-scoped' — the file declares the term it covers in `termColumns`, and
 *   that term is replaced wholesale. Not an operator choice: a fixed property
 *   of the dataset, invisible in the UI. Used where the source is a statement
 *   of what exists rather than a list of changes.
 */
export type ImportStrategy =
  | { kind: 'upsert'; match: ImportMatch }
  | { kind: 'term-scoped'; termColumns: readonly string[]; match: ImportMatch };

/** One thing wrong with an uploaded sheet, addressed to the operator. */
export interface ImportValidationError {
  sheet: string;
  /**
   * 1-based SPREADSHEET row, so the header is row 1 and the first data row
   * is row 2. Rendered to someone counting rows in Excel; never an index.
   * 0 means "the file as a whole" (a missing header, a size guard).
   */
  row: number;
  /** Header text of the offending column, or null for a whole-row problem. */
  column: string | null;
  message: string;
}

/** Passed to a dataset's `load`. The transaction is the caller's. */
export interface ImportLoadContext {
  tx: Prisma.TransactionClient;
  ingestionRunId: string;
}

export interface ImportLoadResult {
  inserted: number;
  updated: number;
  deleted: number;
}

/** Narrows what a template is pre-filled with. */
export interface PrefillOptions {
  fromYear?: number;
  toYear?: number;
}

/** Everything the framework needs to know about one importable dataset. */
export interface ImportDataset {
  /** URL-safe identifier; also names the DataSource row (`xlsx-<slug>`). */
  slug: string;
  title: string;
  description: string;
  /** 0 = org backbone, 1 = core metrics, 2 = remaining Deep-Dive inputs. */
  tier: 0 | 1 | 2;
  /** Name of the data sheet. Every other sheet in the workbook is ignored. */
  sheetName: string;
  columns: readonly ImportColumn[];
  strategy: ImportStrategy;
  /** Rows the template ships pre-filled with. Omitted for tier 0. */
  prefill?: (prisma: PrismaClient, opts: PrefillOptions) => Promise<readonly ImportRow[]>;
  /** Writes validated rows, stamping `ctx.ingestionRunId` on every one. */
  load: (ctx: ImportLoadContext, rows: readonly ImportRow[]) => Promise<ImportLoadResult>;
  /** Rows currently held, for the shrink guard and the admin screen. */
  count: (prisma: PrismaClient) => Promise<number>;
  /** Deletes only rows written by the given import runs. Returns the count. */
  clear: (tx: Prisma.TransactionClient, runIds: readonly string[]) => Promise<number>;
  /** Datasets whose rows depend on this one; start-over refuses while they hold rows. */
  dependents?: readonly string[];
}
