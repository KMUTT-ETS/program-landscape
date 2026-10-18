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

  switch (column.type) {
    case 'text': {
      const text = typeof raw === 'number' ? numberToText(raw) : String(raw).trim();
      return { value: text };
    }
    case 'integer': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim());
      if (!Number.isFinite(n)) return { error: `"${String(raw)}" is not a number.` };
      if (!Number.isInteger(n)) return { error: `"${String(raw)}" is not a whole number.` };
      return { value: n };
    }
    case 'decimal': {
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

  for (const [index, source] of parsed.rows.entries()) {
    const sheetRow = index + 2;
    const read = (column: ImportColumn): unknown => source[headerByTrimmed.get(column.header) ?? column.header];

    // Excel files routinely carry hundreds of empty rows after the data. One
    // of them must not produce an error per declared column.
    if (dataset.columns.every((c) => isBlank(read(c)))) continue;

    const built: Record<string, ImportCellValue> = {};
    for (const column of dataset.columns) {
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
      if (coerced.value === null && column.required) {
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

  for (const { sheetRow, row } of accepted) {
    const parts: string[] = [];
    let incomplete = false;
    for (const key of keyColumns) {
      const value = row[key];
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
      parts.push(value instanceof Date ? value.toISOString() : String(value));
    }
    if (incomplete) continue;
    const composite = parts.join('\u0000');
    const first = seen.get(composite);
    if (first !== undefined) {
      errors.push({
        sheet,
        row: sheetRow,
        column: headerFor(keyColumns[0] ?? ''),
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
    term = firstTerm;
  }

  // ── shrink guard ──────────────────────────────────────────────────────────
  if (!ctx.allowShrink && ctx.heldRowCount > 0 && accepted.length * 2 < ctx.heldRowCount) {
    errors.push({
      sheet,
      row: 0,
      column: null,
      message:
        `This file has ${accepted.length} rows but the dataset currently holds ` +
        `${ctx.heldRowCount}. That looks like a partial export. Re-upload with ` +
        `confirmation if it is intentional.`,
    });
  }

  if (errors.length > 0) return fail(errors);
  return { ok: true, rows: accepted.map((a) => a.row), term };
}
