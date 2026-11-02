import { looksLikeThaiNationalId } from '@kku/shared';

import type {
  ImportCellValue,
  ImportColumn,
  ImportDataset,
  ImportRow,
  ImportValidationError,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Sheet validation — pure, so its large surface needs no database and no
// spreadsheet library.
//
// Order is deliberate and asserted by the tests: headers, then cells, then
// key integrity, then references, then privacy, then whole-file guards. A
// header failure returns alone — every cell error under a sheet whose shape
// is already wrong is noise about a column the operator has not supplied.
// ─────────────────────────────────────────────────────────────────────────────

/** A workbook's data sheet, already read. `rows[i]` is spreadsheet row i + 2. */
export interface ParsedSheet {
  sheetName: string;
  headers: readonly string[];
  rows: readonly Readonly<Record<string, unknown>>[];
}

export interface ValidationContext {
  /** dataset slug → the set of key values that exist. See ImportColumn.references. */
  references: ReadonlyMap<string, ReadonlySet<string>>;
  /** Rows the dataset currently holds, for the shrink guard. */
  heldRowCount: number;
  /**
   * Rows already stored FOR THE TERM a term-scoped file covers.
   *
   * The plain `heldRowCount` is the whole table, which for a term-scoped
   * dataset is every term ever loaded — so a complete file for one term
   * looks like a 75 % shrink once three terms are in. Undefined for every
   * other dataset, and for a term-scoped upload whose term cannot be read
   * (a file the validator is about to refuse anyway).
   */
  heldRowCountForTerm?: number;
  allowShrink: boolean;
  maxRows: number;
}

export type ValidateResult =
  | { ok: true; rows: readonly ImportRow[]; term: Readonly<Record<string, ImportCellValue>> | null }
  | { ok: false; errors: readonly ImportValidationError[]; totalErrors: number };

/** More than this and the list stops being readable; the true count rides along. */
export const MAX_REPORTED_ERRORS = 100;

/** Excel's day 0 is 1899-12-30 (its leap-year bug included). */
const EXCEL_EPOCH_MS = Date.UTC(1899, 11, 30);
const MS_PER_DAY = 86_400_000;
const EXCEL_SERIAL_MAX = 2_958_465; // 9999-12-31

const TRUTHY = new Set(['true', 'yes', 'y', '1']);
const FALSY = new Set(['false', 'no', 'n', '0']);

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

/**
 * Excel hands back a number for anything numeric-looking, so `001` arrives as
 * 1. The leading zeros are already gone and cannot be recovered — but
 * rendering 1 as "1.0" would make it wrong twice.
 */
function numberToText(value: number): string {
  // String() already renders a whole-valued float without a decimal point
  // (String(1.0) === "1"), which is exactly what a code column needs.
  return String(value);
}

function coerceDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 1 || value > EXCEL_SERIAL_MAX) return null;
    return new Date(EXCEL_EPOCH_MS + Math.round(value) * MS_PER_DAY);
  }
  if (typeof value !== 'string') return null;
  const text = value.trim();
  // Only ISO-ish dates. A locale string like 31/02/2024 is ambiguous even
  // when it is possible, so it is refused rather than guessed at.
  if (!/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(text)) return null;
  const parsed = new Date(text.length === 10 ? `${text}T00:00:00.000Z` : text);
  if (Number.isNaN(parsed.getTime())) return null;
  // Reject 2024-02-31, which Date would roll forward into March.
  const [y, m, d] = text.slice(0, 10).split('-').map(Number);
  if (parsed.getUTCFullYear() !== y || parsed.getUTCMonth() + 1 !== m || parsed.getUTCDate() !== d) return null;
  return parsed;
}

/** Returns the coerced value, or a message saying why the cell is wrong. */
function coerceCell(column: ImportColumn, raw: unknown): { value: ImportCellValue } | { error: string } {
  if (isBlank(raw)) return { value: null };

  /**
   * A comma used as a DECIMAL point rather than a thousands separator.
   *
   * Commas are stripped so an operator can paste `1,250,000`. The same rule
   * silently turns the European `1234,56` into 123456 — a hundredfold error
   * in a column that is usually money, accepted with no signal at all. A
   * separator always leaves groups of exactly three digits behind it, so a
   * trailing group of one or two is the giveaway.
   */
  function decimalCommaError(text: string): string | null {
    const trimmed = text.trim();
    if (!/^-?[\d,]+(\.\d+)?$/.test(trimmed)) return null;
    const groups = trimmed.replace(/^-/, '').split(',');
    if (groups.length < 2) return null;
    const last = groups[groups.length - 1] ?? '';
    if (/^\d{3}(\.\d+)?$/.test(last)) return null;
    return (
      `"${trimmed}" uses a comma where this column expects a decimal point. ` +
      `Write ${groups.join('')} as ${groups.slice(0, -1).join('')}.${last} if you ` +
      `meant a decimal, or use commas only to group thousands.`
    );
  }

  switch (column.type) {
    case 'text': {
      const text = typeof raw === 'number' ? numberToText(raw) : String(raw).trim();
      return { value: text };
    }
    case 'integer': {
      if (typeof raw !== 'number') {
        const decimalComma = decimalCommaError(String(raw));
        if (decimalComma) return { error: decimalComma };
      }
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
      if (!Number.isFinite(n)) return { error: `"${String(raw)}" is not a number.` };
      if (!Number.isInteger(n)) return { error: `"${String(raw)}" is not a whole number.` };
      return { value: n };
    }
    case 'decimal': {
      if (typeof raw !== 'number') {
        const decimalComma = decimalCommaError(String(raw));
        if (decimalComma) return { error: decimalComma };
      }
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
      if (!Number.isFinite(n)) return { error: `"${String(raw)}" is not a number.` };
      return { value: n };
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return { value: raw };
      const text = String(raw).trim().toLowerCase();
      if (TRUTHY.has(text)) return { value: true };
      if (FALSY.has(text)) return { value: false };
      return { error: `"${String(raw)}" is not yes or no.` };
    }
    case 'date': {
      const parsed = coerceDate(raw);
      if (!parsed) return { error: `"${String(raw)}" is not a date. Use YYYY-MM-DD.` };
      return { value: parsed };
    }
    case 'enum': {
      const text = String(raw).trim();
      const allowed = column.enumValues ?? [];
      if (!allowed.includes(text)) {
        return { error: `"${text}" is not allowed. Use one of: ${allowed.join(', ')}.` };
      }
      return { value: text };
    }
    default: {
      const exhaustive: never = column.type;
      return { error: `Unsupported column type ${String(exhaustive)}.` };
    }
  }
}

/**
 * The term a term-scoped file appears to cover, read before validation.
 *
 * The shrink guard has to compare a file against the rows stored FOR ITS
 * TERM, and the term is only established by validation — so the caller
 * peeks first. This is advisory only: `validateSheet` remains the authority
 * on whether every row agrees and whether a term was stated at all, and
 * returns null here rather than guessing.
 */
export function readDeclaredTerm(
  dataset: ImportDataset,
  parsed: ParsedSheet,
): Readonly<Record<string, ImportCellValue>> | null {
  if (dataset.strategy.kind !== 'term-scoped') return null;
  const termColumns = dataset.strategy.termColumns;
  const headerByTrimmed = new Map(parsed.headers.map((h) => [h.trim(), h]));
  const columns = dataset.columns.filter((c) => termColumns.includes(c.key));
  if (columns.length !== termColumns.length) return null;

  for (const source of parsed.rows) {
    const read = (c: ImportColumn): unknown => source[headerByTrimmed.get(c.header) ?? c.header];
    if (dataset.columns.every((c) => isBlank(read(c)))) continue;

    const term: Record<string, ImportCellValue> = {};
    for (const column of columns) {
      const coerced = coerceCell(column, read(column));
      if ('error' in coerced || coerced.value === null) return null;
      term[column.key] = coerced.value;
    }
    return term;
  }
  return null;
}

export function validateSheet(
  dataset: ImportDataset,
  parsed: ParsedSheet,
  ctx: ValidationContext,
): ValidateResult {
  const sheet = parsed.sheetName;
  const fail = (errors: ImportValidationError[]): ValidateResult => ({
    ok: false,
    errors: errors.slice(0, MAX_REPORTED_ERRORS),
    totalErrors: errors.length,
  });

  // ── headers ───────────────────────────────────────────────────────────────
  // Trim before comparing: a trailing space is what Excel gives you when
  // someone types into a cell, and "missing column: Code" while the operator
  // is looking straight at Code is the most infuriating possible failure.
  const headerByTrimmed = new Map<string, string>();
  for (const h of parsed.headers) headerByTrimmed.set(String(h).trim(), String(h));

  const declared = new Set(dataset.columns.map((c) => c.header));
  const headerErrors: ImportValidationError[] = [];

  const missing = dataset.columns.filter((c) => !headerByTrimmed.has(c.header)).map((c) => c.header);
  if (missing.length > 0) {
    headerErrors.push({
      sheet,
      row: 1,
      column: null,
      message:
        `Missing ${missing.length} column(s): ${missing.join(', ')}. ` +
        `Expected exactly: ${dataset.columns.map((c) => c.header).join(', ')}.`,
    });
  }
  const unknown = [...headerByTrimmed.keys()].filter((h) => !declared.has(h));
  if (unknown.length > 0) {
    headerErrors.push({
      sheet,
      row: 1,
      column: null,
      message:
        `Unexpected column(s): ${unknown.join(', ')}. Remove them — only the ` +
        `declared columns are imported, and an extra column may carry data ` +
        `this system must not store.`,
    });
  }
  if (headerErrors.length > 0) return fail(headerErrors);

  // ── whole-file size guard, before per-row work ────────────────────────────
  if (parsed.rows.length > ctx.maxRows) {
    return fail([{
      sheet,
      row: 0,
      column: null,
      message:
        `This file has ${parsed.rows.length} rows; the limit is ${ctx.maxRows}. ` +
        `Split it into smaller files.`,
    }]);
  }

  // ── cells ─────────────────────────────────────────────────────────────────
  const errors: ImportValidationError[] = [];
  /** Accepted rows, each carrying the spreadsheet row it came from. */
  const accepted: { sheetRow: number; row: Record<string, ImportCellValue> }[] = [];

  // Columns that only say WHICH row this is. A row carrying nothing but
  // these asserts no figure, whatever is in them.
  const identityKeys = new Set<string>([
    ...dataset.strategy.match.columns,
    ...(dataset.strategy.kind === 'term-scoped' ? dataset.strategy.termColumns : []),
  ]);
  const identityColumns = dataset.columns.filter((c) => identityKeys.has(c.key));
  const valueColumns = dataset.columns.filter((c) => !identityKeys.has(c.key));

  // Only a dataset whose template PRE-FILLS the key columns can produce a
  // row the operator never wrote. Everywhere else, keys-and-nothing-else is
  // somebody starting a row and abandoning it, and saying so is the help.
  const skipsValuelessRows = dataset.prefill !== undefined && valueColumns.length > 0;
  let skippedEmptyValueRows = 0;

  for (const [index, source] of parsed.rows.entries()) {
    const sheetRow = index + 2;
    const read = (column: ImportColumn): unknown => source[headerByTrimmed.get(column.header) ?? column.header];

    // Excel files routinely carry hundreds of empty rows after the data. One
    // of them must not produce an error per declared column.
    if (dataset.columns.every((c) => isBlank(read(c)))) continue;

    // A pre-filled template arrives with one row per programme per year and
    // every figure blank; an operator fills the years they have. The rest
    // must not be read as statements — otherwise a dataset whose figures are
    // optional stores a wall of zeros (and a zero is a claim that something
    // was counted), and one whose figures are required refuses the file with
    // thousands of errors naming rows the system itself wrote.
    //
    // A blank is the absence of a figure. A typed 0 is a figure, reaches
    // isBlank as false, and keeps its row.
    //
    // The KEY cells are still checked. A Buddhist-era year on a row with no
    // figures is the operator's mistake and reporting it is the whole point
    // of the column check; only the required-value errors are what has to
    // stay quiet here.
    const valuelessRow = skipsValuelessRows && valueColumns.every((c) => isBlank(read(c)));
    const errorsBefore = errors.length;

    const built: Record<string, ImportCellValue> = {};
    for (const column of valuelessRow ? identityColumns : dataset.columns) {
      const raw = read(column);

      // Privacy FIRST, on the raw cell, before anything can coerce or echo
      // it. Two reasons the later check was not enough:
      //  - Excel stores a 13-digit ID typed into a General cell as a NUMBER,
      //    so a check on coerced strings never saw it in a numeric column.
      //  - Every coercion-failure message quotes the offending value, so an
      //    ID pasted into an enum column was echoed into the HTTP response
      //    and onto the operator's screen by the very path meant to stop it.
      if (!isBlank(raw) && looksLikeThaiNationalId(String(raw))) {
        errors.push({
          sheet,
          row: sheetRow,
          column: column.header,
          message:
            'This cell looks like a personal identifier (national ID). Remove the ' +
            'column or replace it with a non-personal code before uploading.',
        });
        continue;
      }

      const coerced = coerceCell(column, raw);
      if ('error' in coerced) {
        errors.push({ sheet, row: sheetRow, column: column.header, message: coerced.error });
        continue;
      }
      // "Required" is suspended on a row that states no figure at all —
      // including for a key. The alumni-cohort template cannot know the
      // status, so it ships that column blank; demanding it back on a line
      // the operator never filled in would refuse the template as
      // downloaded. A key that is present but MALFORMED still fails below:
      // blank is an untouched row, wrong is a mistake.
      if (coerced.value === null && column.required && !valuelessRow) {
        errors.push({ sheet, row: sheetRow, column: column.header, message: 'This cell is required.' });
        continue;
      }
      if (column.check && coerced.value !== null) {
        const problem = column.check(coerced.value);
        if (problem) {
          errors.push({ sheet, row: sheetRow, column: column.header, message: problem });
          continue;
        }
      }
      if (column.groupSizeFor && typeof coerced.value === 'number' && coerced.value < column.groupSizeFor.minimum) {
        errors.push({
          sheet,
          row: sheetRow,
          column: column.header,
          message:
            `A group of ${coerced.value} is too small to report. Each row must ` +
            `cover at least ${column.groupSizeFor.minimum} people, so no ` +
            `individual's figures can be inferred.`,
        });
        continue;
      }
      built[column.key] = coerced.value;
    }

    // Keys were fine and the row states no figure: it is a template line the
    // operator did not fill in. Skip it without comment.
    if (valuelessRow) {
      if (errors.length === errorsBefore) skippedEmptyValueRows += 1;
      continue;
    }

    // Cross-column rules, only for a row whose own cells came through
    // clean. Running them over a row that already failed coercion would
    // describe one mistake twice, in two different vocabularies.
    const rowFailed = errors.some((e) => e.row === sheetRow);
    if (!rowFailed) {
      for (const rule of dataset.rowRules ?? []) {
        if (!rule.check(built)) {
          errors.push({ sheet, row: sheetRow, column: null, message: rule.message });
        }
      }
    }

    accepted.push({ sheetRow, row: built });
  }

  // ── keys ──────────────────────────────────────────────────────────────────
  const keyColumns = dataset.strategy.match.columns;
  const columnByKey = new Map(dataset.columns.map((c) => [c.key, c]));
  const headerFor = (key: string): string => columnByKey.get(key)?.header ?? key;
  const seen = new Map<string, number>();

  // A `manual` match may declare a FALLBACK key for rows whose primary one
  // is not filled in — publications are matched by DOI where there is one
  // and by (title, year) within one author where there is not. The loader
  // follows that two-step rule, so the duplicate check has to as well:
  // without it, two of an author's papers that both lack a DOI collapse to
  // one composite and the file is refused as duplicated, naming a blank
  // cell the operator cannot fill. Conference papers, books and
  // Thai-journal articles routinely have no DOI, so that is most files.
  const fallbackColumns =
    dataset.strategy.match.kind === 'manual' ? dataset.strategy.match.fallback : undefined;

  for (const { sheetRow, row } of accepted) {
    // Which rule identifies THIS row. A blank in the primary key is what
    // sends it to the fallback, exactly as in the loader.
    const primaryIsBlank = keyColumns.some((k) => {
      const v = row[k];
      return (v === null || v === undefined) && columnByKey.get(k)?.required === false;
    });
    const activeKey = fallbackColumns && primaryIsBlank ? fallbackColumns : keyColumns;
    // Namespaced so a fallback composite can never equal a primary one.
    const parts: string[] = [activeKey === keyColumns ? 'k' : 'f'];
    let incomplete = false;
    for (const key of activeKey) {
      const value = row[key];

      // One OPTIONAL component of a COMPOUND key may be blank, and the blank
      // is part of the row's identity rather than a hole in it: a
      // compensation row with no department is the faculty-wide figure, not
      // a broken department one. That is the whole reason `manual` matching
      // exists — Postgres treats NULL as distinct in a unique index, so such
      // a row cannot be constrained by one. Blank joins the key as its own
      // value, which keeps the duplicate check below honest.
      //
      // A key of ONE column is different and still refused however it is
      // declared: a row whose only identifying cell is blank has no identity
      // at all, and nothing downstream could ever find it again.
      const optionalPartOfCompoundKey =
        activeKey.length > 1 && columnByKey.get(key)?.required === false;
      if ((value === null || value === undefined) && optionalPartOfCompoundKey) {
        parts.push('\u0000blank');
        continue;
      }

      if (value === null || value === undefined) {
        // Only report when the cell itself did not already fail.
        const header = headerFor(key);
        if (!errors.some((e) => e.row === sheetRow && e.column === header)) {
          errors.push({
            sheet,
            row: sheetRow,
            column: header,
            message: 'This cell identifies the row and cannot be blank.',
          });
        }
        incomplete = true;
        continue;
      }
      // A column may declare how its cell compares (case, inner spaces);
      // dates keep their ISO form either way.
      const identity = columnByKey.get(key)?.identity;
      parts.push(
        value instanceof Date ? value.toISOString() : identity ? identity(value) : String(value),
      );
    }
    if (incomplete) continue;
    const composite = parts.join('\u0000');
    const first = seen.get(composite);
    if (first !== undefined) {
      errors.push({
        sheet,
        row: sheetRow,
        column: headerFor(activeKey[0] ?? ''),
        message: `Duplicate of row ${first}: these rows identify the same record.`,
      });
      continue;
    }
    seen.set(composite, sheetRow);
  }

  // ── references ────────────────────────────────────────────────────────────
  for (const column of dataset.columns) {
    const reference = column.references;
    if (!reference) continue;
    const known = ctx.references.get(reference.dataset);
    if (!known) {
      // Not "nothing to check against" — the caller failed to supply the
      // set, so skipping would accept any value in a column whose whole
      // purpose is to be checked. Loud, because it is a wiring mistake.
      throw new Error(
        `Import validation for "${dataset.slug}" was given no reference values for ` +
          `"${reference.dataset}" (needed by column "${column.header}").`,
      );
    }
    for (const { sheetRow, row } of accepted) {
      const value = row[column.key];
      if (value === null || value === undefined) continue;
      if (!known.has(String(value))) {
        errors.push({
          sheet,
          row: sheetRow,
          column: column.header,
          message:
            `"${String(value)}" is not a known ${reference.dataset} ${reference.column}. ` +
            `Upload that dataset first, or correct the value.`,
        });
      }
    }
  }

  // ── term agreement ────────────────────────────────────────────────────────
  let term: Record<string, ImportCellValue> | null = null;
  const first = accepted[0];
  if (dataset.strategy.kind === 'term-scoped' && first) {
    const termColumns = dataset.strategy.termColumns;
    const firstTerm: Record<string, ImportCellValue> = {};
    for (const key of termColumns) firstTerm[key] = first.row[key] ?? null;

    // Report the FIRST dissenting row and stop. Counting the whole `errors`
    // array here would mean any earlier cell error silently disabled term
    // checking after one row.
    let reported = false;
    for (const { sheetRow, row } of accepted.slice(1)) {
      for (const key of termColumns) {
        if (String(row[key] ?? '') !== String(firstTerm[key] ?? '')) {
          errors.push({
            sheet,
            row: sheetRow,
            column: headerFor(key),
            message:
              `Every row in this file must cover the same period. Row ${first.sheetRow} ` +
              `has ${String(firstTerm[key])} and this row has ${String(row[key])}. ` +
              `Upload one file per period.`,
          });
          reported = true;
        }
      }
      if (reported) break;
    }

    // A term the file never states. Rows agreeing on nothing still agree,
    // so the loop above is silent — and the loader would then be handed
    // `{ year: null }` and asked to DELETE whatever that matches. The only
    // destructive write in the importer must not run on a blank key.
    for (const key of termColumns) {
      if (firstTerm[key] === null) {
        errors.push({
          sheet,
          row: first.sheetRow,
          column: headerFor(key),
          message:
            `This column says which period the file covers, so it cannot be ` +
            `blank. Uploading this file replaces everything already stored ` +
            `for the period it names.`,
        });
      }
    }

    term = firstTerm;
  }

  // ── shrink guard ──────────────────────────────────────────────────────────
  // A term-scoped file is compared against its own term, not the table:
  // see ValidationContext.heldRowCountForTerm.
  const shrinkBaseline =
    dataset.strategy.kind === 'term-scoped' && ctx.heldRowCountForTerm !== undefined
      ? ctx.heldRowCountForTerm
      : ctx.heldRowCount;

  if (!ctx.allowShrink && shrinkBaseline > 0 && accepted.length * 2 < shrinkBaseline) {
    errors.push({
      sheet,
      row: 0,
      column: null,
      message:
        `This file has ${accepted.length} rows but ${shrinkBaseline} are already ` +
        `stored for it. That looks like a partial export. Re-upload with ` +
        `confirmation if it is intentional.`,
    });
  }

  // A template downloaded and uploaded untouched. Reporting it as a success
  // that loaded nothing is how someone comes away believing they have
  // uploaded their figures.
  if (accepted.length === 0 && skippedEmptyValueRows > 0) {
    errors.push({
      sheet,
      row: 0,
      column: null,
      message:
        `None of the ${skippedEmptyValueRows} rows in this file carries any figures — ` +
        `every one has only its programme and year filled in. Enter the figures ` +
        `you have and upload it again. Rows you leave blank are skipped, so there ` +
        `is no need to delete them.`,
    });
  }

  if (errors.length > 0) return fail(errors);
  return { ok: true, rows: accepted.map((a) => a.row), term };
}
