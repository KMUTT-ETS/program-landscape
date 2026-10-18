import type { ImportDataset, ImportRow } from '@kku/db';
import * as XLSX from 'xlsx';

// ─────────────────────────────────────────────────────────────────────────────
// Declaration → workbook.
//
// Generated rather than committed, so the template cannot drift from the
// validator that accepts it: both read the same declaration. A static .xlsx
// in git goes stale the first time a column changes, and the adopter finds
// out through a rejected upload.
//
// Two sheets. The parser reads only the first, so the guide can be as wordy
// as it needs to be.
// ─────────────────────────────────────────────────────────────────────────────

const GUIDE_SHEET = 'Guide';
const GUIDE_HEADERS = ['Column', 'Required', 'Type', 'What to put', 'Example', 'Allowed values'];

/** Column widths, so the guide is readable without the adopter resizing it. */
const GUIDE_WIDTHS = [26, 10, 10, 72, 24, 40];

function cellValue(value: ImportRow[string]): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return value;
}

function keyColumnHeaders(dataset: ImportDataset): string[] {
  const byKey = new Map(dataset.columns.map((c) => [c.key, c.header]));
  return dataset.strategy.match.columns.map((k) => byKey.get(k) ?? k);
}

function guidePreamble(dataset: ImportDataset): unknown[][] {
  const keys = keyColumnHeaders(dataset);
  const keyPhrase = keys.length === 1 ? keys[0] : keys.join(' + ');
  const lines: string[] = [
    dataset.title,
    dataset.description,
    '',
    `This workbook has two sheets. Put your data in "${dataset.sheetName}". ` +
      `This Guide sheet is ignored when you upload.`,
    `Rows are matched on ${keyPhrase}. Uploading again will UPDATE rows whose ` +
      `${keyPhrase} is already here, insert the ones that are new, and leave ` +
      `everything else untouched.`,
    `Do not add, remove or rename columns — the upload is refused if the ` +
      `columns do not match exactly.`,
    'Leave a cell blank when you have no value for it. Blank rows are ignored.',
    '',
  ];
  return lines.map((line) => [line]);
}

export function buildImportTemplate(
  dataset: ImportDataset,
  prefillRows: readonly ImportRow[],
): Buffer {
  const wb = XLSX.utils.book_new();

  // ── data sheet ────────────────────────────────────────────────────────────
  const headers = dataset.columns.map((c) => c.header);
  const dataMatrix: unknown[][] = [headers];
  for (const row of prefillRows) {
    dataMatrix.push(dataset.columns.map((c) => cellValue(row[c.key] ?? null)));
  }
  const dataSheet = XLSX.utils.aoa_to_sheet(dataMatrix);
  dataSheet['!cols'] = dataset.columns.map((c) => ({ wch: Math.max(14, c.header.length + 4) }));
  XLSX.utils.book_append_sheet(wb, dataSheet, dataset.sheetName);

  // ── guide sheet ───────────────────────────────────────────────────────────
  const guideMatrix: unknown[][] = [
    ...guidePreamble(dataset),
    GUIDE_HEADERS,
    ...dataset.columns.map((c) => [
      c.header,
      c.required ? 'Yes' : 'No',
      c.type,
      c.guide,
      c.example,
      c.enumValues ? c.enumValues.join(', ') : '',
    ]),
  ];
  const guideSheet = XLSX.utils.aoa_to_sheet(guideMatrix);
  guideSheet['!cols'] = GUIDE_WIDTHS.map((wch) => ({ wch }));
  XLSX.utils.book_append_sheet(wb, guideSheet, GUIDE_SHEET);

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

export function importTemplateFilename(dataset: ImportDataset, today: Date): string {
  return `${dataset.slug}-template-${today.toISOString().slice(0, 10)}.xlsx`;
}
