import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';

import { parseJobThaiSheet } from '../../src/jobthai/parse-sheet';
import { JOBTHAI_COLUMNS } from '../../src/jobthai/columns';

function workbookOf(headers: string[], rows: string[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

describe('parseJobThaiSheet', () => {
  it('names the missing column instead of failing mid-parse', () => {
    const headers = JOBTHAI_COLUMNS.filter((c) => c !== 'Province');
    const result = parseJobThaiSheet(workbookOf([...headers], [headers.map(() => 'x')]));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected failure');
    expect(result.error).toContain('Province');
  });

  it('accepts a sheet carrying all seven expected columns', () => {
    const result = parseJobThaiSheet(workbookOf([...JOBTHAI_COLUMNS], [JOBTHAI_COLUMNS.map(() => 'x')]));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows).toHaveLength(1);
    expect(result.hasDateColumn).toBe(false);
  });

  it('drops exactly-duplicate rows', () => {
    const row = JOBTHAI_COLUMNS.map(() => 'same');
    const result = parseJobThaiSheet(workbookOf([...JOBTHAI_COLUMNS], [row, [...row]]));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.rows).toHaveLength(1);
    expect(result.duplicatesDropped).toBe(1);
  });

  it('reports a header-only sheet rather than returning zero rows as success', () => {
    const result = parseJobThaiSheet(workbookOf([...JOBTHAI_COLUMNS], []));
    expect(result.ok).toBe(false);
  });

  it('rejects bytes that are not a spreadsheet at all', () => {
    const result = parseJobThaiSheet(Buffer.from('this is not xlsx'));
    expect(result.ok).toBe(false);
  });

  it('detects the optional date column when present', () => {
    const headers = [...JOBTHAI_COLUMNS, 'Posted Date'];
    const result = parseJobThaiSheet(workbookOf(headers, [headers.map((h) => (h === 'Posted Date' ? '2026-08-15' : 'x'))]));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.error);
    expect(result.hasDateColumn).toBe(true);
    expect(result.rows[0]!.postedDate).not.toBeNull();
  });
});

// ── Barrel hygiene ────────────────────────────────────────────────────
//
// `xlsx` is a large server-only spreadsheet parser. The exports map is not
// the guarantee that keeps it out of a client bundle — the module staying
// off every barrel is. Same rule, same reasoning and same failure mode as
// `scholar/search-parse` with cheerio.

describe('parse-sheet stays off both barrels', () => {
  it('is absent from the root barrel, which client components can reach', async () => {
    const barrel: Record<string, unknown> = await import('../../src/index');
    expect(Object.keys(barrel)).not.toContain('parseJobThaiSheet');
  });

  it('is absent from the jobthai barrel too', async () => {
    const jobthaiBarrel: Record<string, unknown> = await import('../../src/jobthai/index');
    expect(Object.keys(jobthaiBarrel)).not.toContain('parseJobThaiSheet');
    // The pure parts ARE there — that is the point of the split.
    expect(Object.keys(jobthaiBarrel)).toContain('normaliseJobThaiRow');
  });

  it('is published under both spellings the two module resolutions need', async () => {
    const pkg = await import('../../package.json');
    const map = (pkg as unknown as { exports: Record<string, string> }).exports;
    expect(map['./jobthai/parse-sheet']).toBe('./src/jobthai/parse-sheet.ts');
    expect(map['./src/jobthai/parse-sheet']).toBe('./src/jobthai/parse-sheet.ts');
  });
});
