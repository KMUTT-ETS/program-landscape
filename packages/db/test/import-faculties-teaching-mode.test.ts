import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

describe('faculty_sfr_band migration', () => {
  const sql = readFileSync(
    join(__dirname, '../prisma/migrations/20261103120000_faculty_sfr_band/migration.sql'),
    'utf8',
  );

  it('backfill applies only when the profile is KKU', () => {
    expect(sql).toContain('EXISTS (SELECT 1 FROM organization_profile');
    expect(sql).toContain("name_en = 'Khon Kaen University'");
    expect(sql).toContain('"sfr_band" IS NULL');
    for (const code of [
      'MD', 'DT', 'VM', 'NU', 'AMS', 'PH', 'PHA', 'AG', 'SC', 'EN', 'TC', 'COC',
      'AR', 'FAR', 'BS', 'LAW', 'EC', 'COPA', 'IC', 'NK', 'GS', 'MBA', 'HU', 'ED',
    ]) {
      expect(sql, code).toContain(`'${code}'`);
    }
  });
});
