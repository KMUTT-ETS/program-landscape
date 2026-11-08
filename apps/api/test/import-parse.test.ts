import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import { parseImportWorkbook } from '../src/import/parse';

function workbook(sheets: Record<string, unknown[][]>): Buffer {
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
  }
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseImportWorkbook', () => {
  it('reads headers and rows from the named sheet', () => {
    const bytes = workbook({
      Data: [['Code', 'Name'], ['A1', 'Alpha'], ['B2', 'Beta']],
    });
    const result = parseImportWorkbook(bytes, 'Data');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.headers).toEqual(['Code', 'Name']);
    expect(result.parsed.rows).toHaveLength(2);
    expect(result.parsed.rows[0]).toMatchObject({ Code: 'A1', Name: 'Alpha' });
  });

  it('ignores every other sheet, including one named Guide', () => {
    const bytes = workbook({
      Data: [['Code'], ['A1']],
      Guide: [['Column', 'What to put'], ['Code', 'your own identifier']],
      Scratch: [['anything']],
    });
    const result = parseImportWorkbook(bytes, 'Data');
    expect(result.ok && result.parsed.rows).toHaveLength(1);
    expect(result.ok && result.parsed.headers).toEqual(['Code']);
  });

  it('fails naming the sheets present when the named one is absent', () => {
    const bytes = workbook({ Sheet1: [['Code'], ['A1']] });
    const result = parseImportWorkbook(bytes, 'Data');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Data');
    expect(result.error).toContain('Sheet1');
  });

  it('fails rather than throws on unreadable bytes', () => {
    const result = parseImportWorkbook(Buffer.from('not a spreadsheet at all'), 'Data');
    expect(result.ok).toBe(false);
  });

  it('succeeds with no rows when the sheet has only headers', () => {
    const bytes = workbook({ Data: [['Code', 'Name']] });
    const result = parseImportWorkbook(bytes, 'Data');
    // Shape is the parser's job; whether emptiness is allowed is policy.
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.headers).toEqual(['Code', 'Name']);
    expect(result.parsed.rows).toEqual([]);
  });

  it('hands numbers and dates through raw for the validator to coerce', () => {
    const bytes = workbook({
      Data: [['Code', 'Year', 'Started'], ['001', 2568, new Date('2024-01-31T00:00:00Z')]],
    });
    const result = parseImportWorkbook(bytes, 'Data');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const row = result.parsed.rows[0] as Record<string, unknown>;
    expect(typeof row.Year).toBe('number');
    // raw: true means a date cell arrives as a serial, not a locale string.
    expect(typeof row.Started === 'number' || row.Started instanceof Date).toBe(true);
  });

  it('keeps a blank cell as null rather than dropping the key', () => {
    const bytes = workbook({ Data: [['Code', 'Name'], ['A1', null]] });
    const result = parseImportWorkbook(bytes, 'Data');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.rows[0]).toHaveProperty('Name');
    expect((result.parsed.rows[0] as Record<string, unknown>).Name).toBeNull();
  });

  it('keeps a blank row in place so later rows keep their spreadsheet numbers', () => {
    // The validator skips blank rows but computes a row number from the
    // index. If the parser dropped the blank, row 4 would be reported as
    // row 3 and the operator would be sent to the wrong line.
    const bytes = workbook({
      Data: [['Code', 'Name'], ['A1', 'Alpha'], [null, null], ['C3', 'Gamma']],
    });
    const result = parseImportWorkbook(bytes, 'Data');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.rows).toHaveLength(3);
    expect((result.parsed.rows[2] as Record<string, unknown>).Code).toBe('C3');
  });

  it('ignores trailing empty header cells left by a stray note', () => {
    // An operator types a note in a far cell; the sheet's !ref widens and the
    // header row gains a null. Reported as-is this becomes "Unexpected
    // column(s): ." — a refusal naming a column that does not exist.
    const bytes = workbook({ Data: [['Code', 'Name', null, null], ['A1', 'Alpha', null, null]] });
    const result = parseImportWorkbook(bytes, 'Data');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.headers).toEqual(['Code', 'Name']);
  });

  it('treats headers differing only by trailing space as duplicates', () => {
    // The validator trims before comparing, so these two collapse onto one
    // key and the LAST silently wins — the file is accepted and every row is
    // read from the wrong column.
    const bytes = workbook({ Data: [['Code', 'Code '], ['right', 'wrong']] });
    const result = parseImportWorkbook(bytes, 'Data');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Code');
  });

  it('reports a duplicated header rather than silently keeping one', () => {
    const bytes = workbook({ Data: [['Code', 'Code'], ['A1', 'A2']] });
    const result = parseImportWorkbook(bytes, 'Data');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toContain('Code');
  });
});
