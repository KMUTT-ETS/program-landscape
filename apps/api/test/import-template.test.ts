import { getImportDataset, type ImportRow } from '@kku/db';
import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';

import { parseImportWorkbook } from '../src/import/parse';
import { buildImportTemplate, importTemplateFilename } from '../src/import/template';

const faculties = getImportDataset('faculties');
const programmes = getImportDataset('programmes');

function sheetNames(bytes: Buffer): string[] {
  return XLSX.read(bytes, { type: 'buffer' }).SheetNames;
}

function sheetMatrix(bytes: Buffer, name: string): unknown[][] {
  const wb = XLSX.read(bytes, { type: 'buffer' });
  const ws = wb.Sheets[name];
  if (!ws) throw new Error(`no sheet ${name}`);
  return XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
}

describe('buildImportTemplate', () => {
  it('writes the data sheet first and the guide second', () => {
    const bytes = buildImportTemplate(faculties, []);
    expect(sheetNames(bytes)).toEqual([faculties.sheetName, 'Guide']);
  });

  it('writes the declared headers in declared order', () => {
    const bytes = buildImportTemplate(faculties, []);
    const matrix = sheetMatrix(bytes, faculties.sheetName);
    expect(matrix[0]).toEqual(faculties.columns.map((c) => c.header));
  });

  it('writes only the header row when there is nothing to pre-fill', () => {
    const bytes = buildImportTemplate(faculties, []);
    expect(sheetMatrix(bytes, faculties.sheetName)).toHaveLength(1);
  });

  it('places pre-filled values under the right headers', () => {
    const rows: ImportRow[] = [
      { code: 'ENG', nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering', kind: null },
    ];
    const matrix = sheetMatrix(buildImportTemplate(faculties, rows), faculties.sheetName);
    const headers = matrix[0] as string[];
    const first = matrix[1] as unknown[];
    expect(first[headers.indexOf('Faculty Code')]).toBe('ENG');
    expect(first[headers.indexOf('Name (English)')]).toBe('Engineering');
    // A column the row omits stays blank rather than shifting the others.
    expect(first[headers.indexOf('Kind')]).toBeNull();
  });

  it('ships a pre-filled tier-1 template the validator then accepts', () => {
    // The whole point of pre-fill: the operator fills values into rows
    // whose keys are already right, instead of hand-typing programme codes
    // that fail the file when one of them is mistyped.
    const enrolment = getImportDataset('enrollment-metrics');
    const rows: ImportRow[] = [
      { programmeCode: 'ENG-CIVIL-BE', academicYear: 2024 },
      { programmeCode: 'ENG-CIVIL-BE', academicYear: 2023 },
    ];
    const result = parseImportWorkbook(buildImportTemplate(enrolment, rows), enrolment.sheetName);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.rows).toHaveLength(2);
    expect(result.parsed.rows[0]).toMatchObject({
      'Programme Code': 'ENG-CIVIL-BE',
      'Academic Year': 2024,
    });
    // Every value column is blank, so a template downloaded and uploaded
    // unchanged states nothing rather than asserting zeros.
    expect(result.parsed.rows[0]?.['Enrolled'] ?? null).toBeNull();
  });

  it('round-trips through the parser', () => {
    // Binds template and parser together: a change to either is caught here.
    const rows: ImportRow[] = [
      { code: 'ENG', nameTh: 'วิศวกรรมศาสตร์', nameEn: 'Engineering', kind: 'ACADEMIC' },
      { code: 'SCI', nameTh: 'วิทยาศาสตร์', nameEn: 'Science', kind: null },
    ];
    const result = parseImportWorkbook(buildImportTemplate(faculties, rows), faculties.sheetName);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.parsed.rows).toHaveLength(2);
    expect(result.parsed.rows[0]).toMatchObject({ 'Faculty Code': 'ENG', 'Name (English)': 'Engineering' });
  });

  it('gives the guide one row per column, in declared order', () => {
    const matrix = sheetMatrix(buildImportTemplate(programmes, []), 'Guide');
    const columnCells = matrix.map((r) => r[0]).filter((v): v is string => typeof v === 'string');
    for (const column of programmes.columns) {
      expect(columnCells).toContain(column.header);
    }
    const positions = programmes.columns.map((c) => columnCells.indexOf(c.header));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('lists an enum column allowed values in the guide', () => {
    const matrix = sheetMatrix(buildImportTemplate(programmes, []), 'Guide');
    const levelRow = matrix.find((r) => r[0] === 'Level');
    expect(levelRow).toBeDefined();
    expect(String(levelRow?.join(' '))).toContain('BACHELOR');
    expect(String(levelRow?.join(' '))).toContain('HIGHER_GRAD_DIPLOMA');
  });

  it('writes Required as Yes or No', () => {
    const matrix = sheetMatrix(buildImportTemplate(programmes, []), 'Guide');
    const codeRow = matrix.find((r) => r[0] === 'Programme Code');
    const statusRow = matrix.find((r) => r[0] === 'Status');
    expect(codeRow?.[1]).toBe('Yes');
    expect(statusRow?.[1]).toBe('No');
  });

  it('names the key columns in the guide preamble', () => {
    const matrix = sheetMatrix(buildImportTemplate(programmes, []), 'Guide');
    const preamble = matrix.slice(0, 8).flat().filter(Boolean).join(' ');
    expect(preamble).toContain('Programme Code');
    expect(preamble.toLowerCase()).toContain('update');
  });

  it('carries each column guide text into the guide sheet', () => {
    const matrix = sheetMatrix(buildImportTemplate(faculties, []), 'Guide');
    const all = matrix.flat().filter(Boolean).join(' ');
    for (const column of faculties.columns) {
      expect(all).toContain(column.guide.slice(0, 30));
    }
  });
});

describe('importTemplateFilename', () => {
  it('carries the slug and an ISO date', () => {
    expect(importTemplateFilename(faculties, new Date('2026-10-18T09:00:00Z')))
      .toBe('faculties-template-2026-10-18.xlsx');
  });
});
