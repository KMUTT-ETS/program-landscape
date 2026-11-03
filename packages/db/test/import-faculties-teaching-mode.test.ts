
import { describe, expect, it } from 'vitest';

import { facultiesDataset } from '../src/import/datasets/faculties';
import { validateSheet, type ParsedSheet } from '../src/import/validate';

function validate(rows: Record<string, unknown>[]) {
  const headers = facultiesDataset.columns.map((c) => c.header);
  const parsed: ParsedSheet = { sheetName: facultiesDataset.sheetName, headers, rows };
  return validateSheet(facultiesDataset, parsed, {
    references: new Map(),
    heldRowCount: 0,
    allowShrink: true,
    maxRows: 5000,
  });
}

function row(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    'Faculty Code': 'ENG',
    'Name (Thai)': 'คณะวิศวกรรมศาสตร์',
    'Name (English)': 'Faculty of Engineering',
    Kind: null,
    'Teaching Mode': null,
    ...over,
  };
}

describe('faculties Teaching Mode column', () => {
  it('accepts Teaching Mode values case-insensitively', () => {
    for (const value of ['clinical', 'LAB-BASED', 'Studio', 'professional', 'Humanities']) {
      const result = validate([row({ 'Teaching Mode': value })]);
      expect(result.ok, value).toBe(true);
    }
  });

  it('refuses an unknown teaching mode naming row and allowed values', () => {
    const result = validate([row({ 'Teaching Mode': 'Lab' })]);
    expect(result.ok).toBe(false);
    const text = JSON.stringify(result);
    expect(text).toContain('Clinical, Lab-based, Studio, Professional, Humanities');
    expect(text).toContain('Teaching Mode');
  });

  it('blank teaching mode is allowed', () => {
    expect(validate([row()]).ok).toBe(true);
  });
});
