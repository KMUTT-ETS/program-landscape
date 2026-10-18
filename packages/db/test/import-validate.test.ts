import { describe, expect, it } from 'vitest';

import type { ImportDataset, ImportStrategy } from '../src/import/types';
import { MAX_REPORTED_ERRORS, validateSheet, type ParsedSheet, type ValidationContext } from '../src/import/validate';

// A fixture dataset, not one from the real registry: the suite must not move
// when a shipped declaration changes a column.

function makeDataset(overrides: Partial<ImportDataset> = {}): ImportDataset {
  const strategy: ImportStrategy = { kind: 'upsert', match: { kind: 'unique', columns: ['code'] } };
  return {
    slug: 'fixture',
    title: 'Fixture',
    description: '',
    tier: 0,
    sheetName: 'Data',
    columns: [
      { header: 'Code', key: 'code', type: 'text', required: true, guide: 'the code', example: 'A1' },
      { header: 'Name', key: 'name', type: 'text', required: true, guide: 'the name', example: 'x' },
      { header: 'Year', key: 'year', type: 'integer', required: false, guide: 'the year', example: '2568' },
      {
        header: 'Level', key: 'level', type: 'enum', required: false,
        enumValues: ['BACHELOR', 'MASTER'], guide: 'the level', example: 'BACHELOR',
      },
      { header: 'Started', key: 'started', type: 'date', required: false, guide: 'start date', example: '2024-01-31' },
      { header: 'Active', key: 'active', type: 'boolean', required: false, guide: 'is active', example: 'yes' },
      { header: 'Amount', key: 'amount', type: 'decimal', required: false, guide: 'the amount', example: '1200.50' },
      {
        header: 'Headcount', key: 'headcount', type: 'integer', required: false,
        groupSizeFor: { minimum: 5 }, guide: 'people in the group', example: '7',
      },
    ],
    strategy,
    load: async () => ({ inserted: 0, updated: 0, deleted: 0 }),
    count: async () => 0,
    clear: async () => 0,
    ...overrides,
  };
}

const ALL_HEADERS = ['Code', 'Name', 'Year', 'Level', 'Started', 'Active', 'Amount', 'Headcount'];

function sheet(headers: readonly string[], rows: readonly Record<string, unknown>[]): ParsedSheet {
  return { sheetName: 'Data', headers, rows };
}

function ctx(overrides: Partial<ValidationContext> = {}): ValidationContext {
  return {
    references: new Map(),
    heldRowCount: 0,
    allowShrink: false,
    maxRows: 50_000,
    ...overrides,
  };
}

/** One complete row, so each test varies only the cell it is about. */
function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    Code: 'A1', Name: 'Alpha', Year: null, Level: null,
    Started: null, Active: null, Amount: null, Headcount: null,
    ...over,
  };
}

function errorsOf(result: ReturnType<typeof validateSheet>): readonly { row: number; column: string | null; message: string }[] {
  if (result.ok) throw new Error('expected validation to fail');
  return result.errors;
}

describe('validateSheet — headers', () => {
  it('accepts headers in a different order from the declaration', () => {
    const reordered = [...ALL_HEADERS].reverse();
    const result = validateSheet(makeDataset(), sheet(reordered, [row()]), ctx());
    expect(result.ok).toBe(true);
  });

  it('trims whitespace on headers before comparing', () => {
    const padded = ALL_HEADERS.map((h) => (h === 'Code' ? '  Code  ' : h));
    const data = [{ ...row(), '  Code  ': 'A1' }];
    delete (data[0] as Record<string, unknown>).Code;
    const result = validateSheet(makeDataset(), sheet(padded, data), ctx());
    expect(result.ok).toBe(true);
  });

  it('reports every missing header in one error', () => {
    const result = validateSheet(makeDataset(), sheet(['Code', 'Name'], [row()]), ctx());
    const errors = errorsOf(result);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toContain('Year');
    expect(errors[0].message).toContain('Headcount');
  });

  it('rejects an unknown header, naming it', () => {
    const result = validateSheet(
      makeDataset(),
      sheet([...ALL_HEADERS, 'Citizen ID'], [{ ...row(), 'Citizen ID': 'x' }]),
      ctx(),
    );
    expect(errorsOf(result)[0].message).toContain('Citizen ID');
  });

  it('returns header errors alone, without cell errors, when both are present', () => {
    // Missing Name header AND a blank required Code — only the header shows.
    const headers = ALL_HEADERS.filter((h) => h !== 'Name');
    const result = validateSheet(makeDataset(), sheet(headers, [{ ...row(), Code: null }]), ctx());
    const errors = errorsOf(result);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(1);
  });
});

describe('validateSheet — cells', () => {
  const d = makeDataset();

  it('reports a missing required cell, naming row and column', () => {
    const result = validateSheet(d, sheet(ALL_HEADERS, [row(), row({ Code: null })]), ctx());
    const errors = errorsOf(result);
    expect(errors).toHaveLength(1);
    expect(errors[0].row).toBe(3);
    expect(errors[0].column).toBe('Code');
  });

  it('coerces an integer written as a string', () => {
    const result = validateSheet(d, sheet(ALL_HEADERS, [row({ Year: '2568' })]), ctx());
    expect(result.ok && result.rows[0].year).toBe(2568);
  });

  it('rejects a non-integer in an integer column', () => {
    const result = validateSheet(d, sheet(ALL_HEADERS, [row({ Year: 12.5 })]), ctx());
    expect(errorsOf(result)[0].column).toBe('Year');
  });

  it('coerces a decimal with thousands separators', () => {
    const result = validateSheet(d, sheet(ALL_HEADERS, [row({ Amount: '1,234.50' })]), ctx());
    expect(result.ok && result.rows[0].amount).toBe(1234.5);
  });

  it('renders a numeric cell in a text column without a decimal point', () => {
    // Excel turns 001 into the number 1. "1.0" would be worse than wrong.
    const result = validateSheet(d, sheet(ALL_HEADERS, [row({ Code: 1 })]), ctx());
    expect(result.ok && result.rows[0].code).toBe('1');
  });

  it('renders a float-typed whole number in a text column as an integer', () => {
    const result = validateSheet(d, sheet(ALL_HEADERS, [row({ Code: 1.0 })]), ctx());
    expect(result.ok && result.rows[0].code).toBe('1');
  });

  it('trims surrounding whitespace in a text column', () => {
    const result = validateSheet(d, sheet(ALL_HEADERS, [row({ Code: '  A1  ' })]), ctx());
    expect(result.ok && result.rows[0].code).toBe('A1');
  });

  it('rejects a value outside enumValues, listing the allowed ones', () => {
    const result = validateSheet(d, sheet(ALL_HEADERS, [row({ Level: 'DIPLOMA' })]), ctx());
    const e = errorsOf(result)[0];
    expect(e.column).toBe('Level');
    expect(e.message).toContain('BACHELOR');
  });

  it('is case-sensitive about enum values', () => {
    const result = validateSheet(d, sheet(ALL_HEADERS, [row({ Level: 'bachelor' })]), ctx());
    expect(errorsOf(result)[0].column).toBe('Level');
  });

  it('accepts an ISO date string', () => {
    const result = validateSheet(d, sheet(ALL_HEADERS, [row({ Started: '2024-01-31' })]), ctx());
    expect(result.ok && (result.rows[0].started as Date).toISOString()).toBe('2024-01-31T00:00:00.000Z');
  });

  it('accepts an Excel serial date', () => {
    // 45322 = 2024-01-31 under the 1899-12-30 epoch.
    const result = validateSheet(d, sheet(ALL_HEADERS, [row({ Started: 45322 })]), ctx());
    expect(result.ok && (result.rows[0].started as Date).toISOString()).toBe('2024-01-31T00:00:00.000Z');
  });

  it('accepts a Date instance', () => {
    const when = new Date('2024-01-31T00:00:00.000Z');
    const result = validateSheet(d, sheet(ALL_HEADERS, [row({ Started: when })]), ctx());
    expect(result.ok && (result.rows[0].started as Date).toISOString()).toBe(when.toISOString());
  });

  it('rejects an impossible date', () => {
    const result = validateSheet(d, sheet(ALL_HEADERS, [row({ Started: '31/02/2024' })]), ctx());
    expect(errorsOf(result)[0].column).toBe('Started');
  });

  it('accepts the boolean spellings a person would type', () => {
    for (const [input, expected] of [['yes', true], ['no', false], [1, true], [0, false], [true, true], ['FALSE', false]] as const) {
      const result = validateSheet(d, sheet(ALL_HEADERS, [row({ Active: input })]), ctx());
      expect(result.ok && result.rows[0].active, String(input)).toBe(expected);
    }
  });

  it('skips a row whose every cell is blank', () => {
    const blank = Object.fromEntries(ALL_HEADERS.map((h) => [h, null]));
    const result = validateSheet(d, sheet(ALL_HEADERS, [row(), blank, blank]), ctx());
    expect(result.ok && result.rows).toHaveLength(1);
  });

  it('keeps later rows at their true spreadsheet numbers after a blank row', () => {
    const blank = Object.fromEntries(ALL_HEADERS.map((h) => [h, '  ']));
    const result = validateSheet(d, sheet(ALL_HEADERS, [row(), blank, row({ Code: null })]), ctx());
    // data rows are sheet rows 2,3,4 — the bad one is the third.
    expect(errorsOf(result)[0].row).toBe(4);
  });
});

describe('validateSheet — keys', () => {
  const d = makeDataset();

  it('reports a duplicate key naming both spreadsheet rows', () => {
    const result = validateSheet(d, sheet(ALL_HEADERS, [row({ Code: 'A1' }), row({ Code: 'A1' })]), ctx());
    const e = errorsOf(result)[0];
    expect(e.message).toMatch(/2/);
    expect(e.row).toBe(3);
  });

  it('reports a null in a key column even when the column is not required', () => {
    const optionalKey = makeDataset({
      columns: [
        { header: 'Code', key: 'code', type: 'text', required: false, guide: 'the code', example: 'A1' },
        { header: 'Name', key: 'name', type: 'text', required: true, guide: 'the name', example: 'x' },
      ],
    });
    const result = validateSheet(optionalKey, sheet(['Code', 'Name'], [{ Code: null, Name: 'Alpha' }]), ctx());
    expect(errorsOf(result)[0].column).toBe('Code');
  });
});

describe('validateSheet — references', () => {
  const withRef = makeDataset({
    columns: [
      { header: 'Code', key: 'code', type: 'text', required: true, guide: 'the code', example: 'A1' },
      {
        header: 'Faculty Code', key: 'facultyCode', type: 'text', required: true,
        references: { dataset: 'faculties', column: 'code' }, guide: 'owning faculty', example: 'ENG',
      },
    ],
  });

  it('rejects a reference value that does not exist, naming it', () => {
    const c = ctx({ references: new Map([['faculties', new Set(['ENG'])]]) });
    const result = validateSheet(withRef, sheet(['Code', 'Faculty Code'], [{ Code: 'A1', 'Faculty Code': 'SCI' }]), c);
    const e = errorsOf(result)[0];
    expect(e.column).toBe('Faculty Code');
    expect(e.message).toContain('SCI');
  });

  it('accepts a reference value that exists', () => {
    const c = ctx({ references: new Map([['faculties', new Set(['ENG'])]]) });
    const result = validateSheet(withRef, sheet(['Code', 'Faculty Code'], [{ Code: 'A1', 'Faculty Code': 'ENG' }]), c);
    expect(result.ok).toBe(true);
  });
});

describe('validateSheet — privacy', () => {
  const d = makeDataset();

  it('rejects a cell holding a national id without echoing the value', () => {
    const id = '1101700207366'; // synthetic
    const result = validateSheet(d, sheet(ALL_HEADERS, [row({ Name: id })]), ctx());
    const e = errorsOf(result)[0];
    expect(e.column).toBe('Name');
    expect(e.message).not.toContain(id);
    expect(e.message).toMatch(/identifier|personal/i);
  });

  it('rejects a group smaller than the declared minimum', () => {
    const result = validateSheet(d, sheet(ALL_HEADERS, [row({ Headcount: 4 })]), ctx());
    expect(errorsOf(result)[0].column).toBe('Headcount');
  });

  it('accepts a group at the declared minimum', () => {
    const result = validateSheet(d, sheet(ALL_HEADERS, [row({ Headcount: 5 })]), ctx());
    expect(result.ok).toBe(true);
  });

  it('ignores a blank group-size cell', () => {
    const result = validateSheet(d, sheet(ALL_HEADERS, [row({ Headcount: null })]), ctx());
    expect(result.ok).toBe(true);
  });
});

describe('validateSheet — whole-file guards', () => {
  const d = makeDataset();

  it('reports one error when the file exceeds maxRows', () => {
    const rows = Array.from({ length: 11 }, (_, i) => row({ Code: `A${i}` }));
    const result = validateSheet(d, sheet(ALL_HEADERS, rows), ctx({ maxRows: 10 }));
    const errors = errorsOf(result);
    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/10/);
  });

  it('refuses a file under half of what is held', () => {
    const result = validateSheet(d, sheet(ALL_HEADERS, [row()]), ctx({ heldRowCount: 100 }));
    expect(errorsOf(result)[0].message).toMatch(/100/);
  });

  it('accepts the same file when shrinking is allowed', () => {
    const result = validateSheet(d, sheet(ALL_HEADERS, [row()]), ctx({ heldRowCount: 100, allowShrink: true }));
    expect(result.ok).toBe(true);
  });

  it('never triggers the shrink guard on an empty dataset', () => {
    const result = validateSheet(d, sheet(ALL_HEADERS, [row()]), ctx({ heldRowCount: 0 }));
    expect(result.ok).toBe(true);
  });

  it('caps reported errors but reports the true total', () => {
    const rows = Array.from({ length: MAX_REPORTED_ERRORS + 20 }, (_, i) => row({ Code: `A${i}`, Name: null }));
    const result = validateSheet(d, sheet(ALL_HEADERS, rows), ctx());
    if (result.ok) throw new Error('expected failure');
    expect(result.errors).toHaveLength(MAX_REPORTED_ERRORS);
    expect(result.totalErrors).toBe(MAX_REPORTED_ERRORS + 20);
  });
});

describe('validateSheet — term-scoped', () => {
  const termed = makeDataset({
    strategy: {
      kind: 'term-scoped',
      termColumns: ['year'],
      match: { kind: 'unique', columns: ['code'] },
    },
  });

  it('rejects rows that disagree on the term, naming the first dissenter', () => {
    const result = validateSheet(
      termed,
      sheet(ALL_HEADERS, [row({ Code: 'A1', Year: 2568 }), row({ Code: 'A2', Year: 2568 }), row({ Code: 'A3', Year: 2569 })]),
      ctx(),
    );
    const e = errorsOf(result)[0];
    expect(e.row).toBe(4);
    expect(e.column).toBe('Year');
  });

  it('returns the shared term when every row agrees', () => {
    const result = validateSheet(
      termed,
      sheet(ALL_HEADERS, [row({ Code: 'A1', Year: 2568 }), row({ Code: 'A2', Year: 2568 })]),
      ctx(),
    );
    expect(result.ok && result.term).toEqual({ year: 2568 });
  });

  it('leaves term null for an upsert dataset', () => {
    const result = validateSheet(makeDataset(), sheet(ALL_HEADERS, [row()]), ctx());
    expect(result.ok && result.term).toBeNull();
  });
});
