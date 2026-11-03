import type { Prisma, PrismaClient } from '@prisma/client';

// ─────────────────────────────────────────────────────────────────────────────
// Spreadsheet import — declaration types.
//
// One declaration per importable dataset. Template generation, header and
// cell validation, the guide sheet, pre-fill and loading all read the same
// object, so a template cannot drift from the validator that accepts it.
//
// This module must never import `xlsx`: @kku/db is resolvable from apps/web,
// and pulling a server-only spreadsheet parser down that path would not show
// up until a bundle broke. The parser and the template writer live in
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
   * A check on this cell alone, run after coercion. Returns a message to
   * fail the cell, or null to accept it.
   *
   * A blank optional cell never reaches it — `required` already decides
   * whether blank is allowed, and a check that had to re-handle null would
   * state that rule in two places. Use `ImportRowRule` for anything that
   * needs to see a second column.
   */
  check?: (value: ImportCellValue) => string | null;
  /**
   * Marks a headcount column that gates k-anonymity on its row: a row whose
   * value is below `minimum` fails the file. The connectors apply this in
   * SQL (`HAVING COUNT(*) >= 5`); an uploaded sheet has no such guarantee.
   */
  groupSizeFor?: { minimum: number };
  /**
   * How this cell is compared when it is part of the match key, so that
   * 'MEE 221' and 'mee221' are recognised as the same record by the
   * duplicate-key check. Comparison only: the stored value is untouched, so
   * the loader still receives exactly what the operator typed.
   */
  identity?: (value: ImportCellValue) => string;
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
 * 'programme-scoped' — every distinct tuple of `scopeColumns` the file names
 *   (typically a programme code) is replaced wholesale; programmes the file
 *   does not mention are untouched. Used where the source is a programme's
 *   complete list of something, and a file may cover many programmes.
 */
export type ImportStrategy =
  | { kind: 'upsert'; match: ImportMatch }
  | { kind: 'term-scoped'; termColumns: readonly string[]; match: ImportMatch }
  | { kind: 'programme-scoped'; scopeColumns: readonly string[]; match: ImportMatch };

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
  /**
   * The period a `term-scoped` file covers, keyed by `termColumns`.
   *
   * Set only for a term-scoped dataset, where the loader DELETES this term
   * before inserting. `validateSheet` is what establishes it — it refuses a
   * file whose rows disagree, and refuses one that states no term at all —
   * so a loader receiving it can trust that every row belongs to it.
   */
  term?: Readonly<Record<string, ImportCellValue>>;
}

export interface ImportLoadResult {
  inserted: number;
  updated: number;
  deleted: number;
  /** Rows stored without a link the reader needs (e.g. a skill name that matched no skill). Reported to the operator. */
  unresolved?: number;
}

/** Narrows what a template is pre-filled with. */
export interface PrefillOptions {
  fromYear?: number;
  toYear?: number;
}

/**
 * A check across several cells of one row.
 *
 * Individually valid cells can still contradict each other — admitted above
 * applications, a survey year before the graduation year — and the surfaces
 * that read them render nonsense rather than failing. `check` returns false
 * to fail the row; it sees cells that have already been coerced and
 * individually validated, and must tolerate nulls, since an optional column
 * may legitimately be blank.
 */
export interface ImportRowRule {
  message: string;
  check: (row: ImportRow) => boolean;
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
  /** Cross-column checks, run per row once its cells have passed. */
  rowRules?: readonly ImportRowRule[];
  /** Rows the template ships pre-filled with. Omitted for tier 0. */
  prefill?: (prisma: PrismaClient, opts: PrefillOptions) => Promise<readonly ImportRow[]>;
  /** Writes validated rows, stamping `ctx.ingestionRunId` on every one. */
  load: (ctx: ImportLoadContext, rows: readonly ImportRow[]) => Promise<ImportLoadResult>;
  /** Rows currently held, for the shrink guard and the admin screen. */
  count: (prisma: PrismaClient) => Promise<number>;
  /**
   * Rows held for one term. Required of a `term-scoped` dataset, where the
   * table holds every term ever loaded and `count` would make a complete
   * one-term file look like a 75 % shrink from the fourth upload onward.
   */
  countForTerm?: (
    prisma: PrismaClient,
    term: Readonly<Record<string, ImportCellValue>>,
  ) => Promise<number>;
  /**
   * Rows held for the scopes a file names. Required of a `programme-scoped`
   * dataset, where the table holds every programme and `count` would make a
   * file covering two programmes look like a near-total shrink.
   */
  countForScope?: (
    prisma: PrismaClient,
    scopes: readonly Readonly<Record<string, ImportCellValue>>[],
  ) => Promise<number>;
  /** Deletes only rows written by the given import runs. Returns the count. */
  clear: (tx: Prisma.TransactionClient, runIds: readonly string[]) => Promise<number>;
  /** Datasets whose rows depend on this one; start-over refuses while they hold rows. */
  dependents?: readonly string[];
  /**
   * What would be destroyed if `clear` ran now, beyond this dataset's own
   * rows.
   *
   * Every foreign key into `programs` is `onDelete: Cascade`, and several
   * into `faculties` are too, so deleting an imported row silently takes
   * connector-written metrics with it. `dependents` cannot express that: it
   * names other IMPORT datasets, and the data at risk is usually not
   * imported at all. A dataset returns one entry per non-empty child table;
   * start-over refuses and names them rather than cascading.
   */
  cascadeBlockers?: (
    // The TRANSACTION, not the client: start-over reads this and then
    // deletes, and a count taken on a second pooled connection sits outside
    // that snapshot — so it can go stale in the window it exists to close.
    tx: Prisma.TransactionClient,
    runIds: readonly string[],
  ) => Promise<{ label: string; count: number }[]>;
}
