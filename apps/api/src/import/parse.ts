import type { ParsedSheet } from '@kku/db';
import * as XLSX from 'xlsx';

// ─────────────────────────────────────────────────────────────────────────────
// Workbook bytes → a ParsedSheet the validator can read.
//
// Never throws: a malformed file is a discriminated failure carrying a
// message, so the upload endpoint can refuse it while the operator is still
// looking at the screen rather than failing in a job log. Same contract as
// parseJobThaiSheet.
//
// Shape only. Whether an empty sheet is acceptable, whether a column belongs,
// what a cell means — all policy, and all the validator's business.
// ─────────────────────────────────────────────────────────────────────────────

export type ParseWorkbookResult =
  | { ok: true; parsed: ParsedSheet }
  | { ok: false; error: string };

export function parseImportWorkbook(bytes: Buffer, sheetName: string): ParseWorkbookResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: 'buffer', cellDates: false });
  } catch (e) {
    return { ok: false, error: `Not a readable spreadsheet: ${(e as Error).message}` };
  }

  const ws = wb.Sheets[sheetName];
  if (!ws) {
    const present = wb.SheetNames.length > 0 ? wb.SheetNames.join(', ') : '(none)';
    return {
      ok: false,
      error:
        `This workbook has no sheet named "${sheetName}". Sheets found: ${present}. ` +
        `Download the template and fill that, or rename your sheet to "${sheetName}".`,
    };
  }

  // header: 1 gives an array-of-arrays so the header row is read positionally.
  // sheet_to_json's object mode silently de-duplicates repeated headers, which
  // would turn two "Code" columns into one and lose a column without a word.
  let matrix: unknown[][];
  try {
    // blankrows MUST stay true. The validator skips a blank row but derives
    // the spreadsheet row number from the index, so dropping blanks here
    // would renumber every row after one and send the operator to the wrong
    // line in their file.
    matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true, blankrows: true });
  } catch (e) {
    return { ok: false, error: `Sheet "${sheetName}" could not be read: ${(e as Error).message}` };
  }

  const headerRow = matrix[0];
  if (!headerRow) {
    return { ok: false, error: `Sheet "${sheetName}" is empty — it has no header row.` };
  }

  const headers = headerRow.map((h) => (h === null || h === undefined ? '' : String(h)));

  const duplicates = headers.filter((h, i) => h !== '' && headers.indexOf(h) !== i);
  if (duplicates.length > 0) {
    return {
      ok: false,
      error:
        `Sheet "${sheetName}" repeats the column name(s): ${[...new Set(duplicates)].join(', ')}. ` +
        `Each column must appear once.`,
    };
  }

  const rows: Record<string, unknown>[] = [];
  for (const line of matrix.slice(1)) {
    const row: Record<string, unknown> = {};
    for (const [index, header] of headers.entries()) {
      if (header === '') continue;
      const cell = line?.[index];
      row[header] = cell === undefined ? null : cell;
    }
    rows.push(row);
  }

  return { ok: true, parsed: { sheetName, headers, rows } };
}
