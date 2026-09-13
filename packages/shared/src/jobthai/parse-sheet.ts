import * as XLSX from 'xlsx';

import { JOBTHAI_COLUMNS, JOBTHAI_DATE_COLUMN } from './columns';
import { normaliseJobThaiRow, type NormalisedJobThaiRow } from './parse-row';

export type ParseSheetResult =
  | {
      ok: true;
      rows: NormalisedJobThaiRow[];
      duplicatesDropped: number;
      /** True when the source supplied real posting dates. */
      hasDateColumn: boolean;
    }
  | { ok: false; error: string };

/**
 * Buffer → validated, normalised rows. Never throws on bad input: a
 * malformed sheet is a discriminated failure carrying a message that names
 * the missing columns, so the upload endpoint can refuse the file while the
 * operator is still looking at it rather than failing asynchronously.
 */
export function parseJobThaiSheet(bytes: Buffer): ParseSheetResult {
  let wb: XLSX.WorkBook;
  try {
    wb = XLSX.read(bytes, { type: 'buffer' });
  } catch (e) {
    return { ok: false, error: `Not a readable spreadsheet: ${(e as Error).message}` };
  }
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { ok: false, error: 'Workbook contains no sheets.' };
  const ws = wb.Sheets[sheetName];
  if (!ws) return { ok: false, error: `Sheet "${sheetName}" could not be read.` };

  const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
  if (raw.length === 0) return { ok: false, error: 'Sheet has a header but no data rows.' };

  const present = new Set(Object.keys(raw[0] ?? {}));
  const missing = JOBTHAI_COLUMNS.filter((c) => !present.has(c));
  if (missing.length > 0) {
    return {
      ok: false,
      error:
        `Sheet is missing ${missing.length} expected column(s): ${missing.join(', ')}. ` +
        `Expected exactly: ${JOBTHAI_COLUMNS.join(', ')}.`,
    };
  }

  const seen = new Set<string>();
  const rows: NormalisedJobThaiRow[] = [];
  let duplicatesDropped = 0;
  for (const r of raw) {
    const row = normaliseJobThaiRow(r);
    if (seen.has(row.rowKey)) {
      duplicatesDropped += 1;
      continue;
    }
    seen.add(row.rowKey);
    rows.push(row);
  }

  return { ok: true, rows, duplicatesDropped, hasDateColumn: present.has(JOBTHAI_DATE_COLUMN) };
}
