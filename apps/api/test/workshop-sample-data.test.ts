import fs from 'node:fs';
import path from 'node:path';
import { getImportDataset, validateSheet, type ImportDataset } from '@kku/db';
import { describe, expect, it } from 'vitest';
import { parseImportWorkbook } from '../src/import/parse';
import {
  SAMPLE_UPLOAD_ORDER,
  buildSampleRows,
  buildSampleWorkbook,
  sampleFilename,
} from '../scripts/workshop/sample-data';

const repo = path.resolve(__dirname, '../../..');
const sampleDir = path.join(repo, 'workshop', 'sample-data');

function parse(dataset: ImportDataset, bytes: Buffer) {
  const result = parseImportWorkbook(bytes, dataset.sheetName);
  if (!result.ok) throw new Error(`${dataset.slug}: ${result.error}`);
  return result.parsed;
}

/** Values of the column other datasets reference, keyed by dataset slug. */
function referencedValues(): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const slug of SAMPLE_UPLOAD_ORDER) {
    const dataset = getImportDataset(slug);
    for (const col of dataset.columns) {
      const ref = col.references;
      if (!ref || out.has(ref.dataset)) continue;
      const target = getImportDataset(ref.dataset);
      const header = target.columns.find((c) => c.key === ref.column)?.header;
      if (!header) throw new Error(`${ref.dataset} has no column ${ref.column}`);
      out.set(ref.dataset, new Set(buildSampleRows(ref.dataset).map((r) => String(r[header]))));
    }
  }
  return out;
}

describe('workshop sample data', () => {
  it('every sample file passes the importer', () => {
    const references = referencedValues();
    for (const slug of SAMPLE_UPLOAD_ORDER) {
      const dataset = getImportDataset(slug);
      const result = validateSheet(dataset, parse(dataset, buildSampleWorkbook(slug)), {
        references,
        heldRowCount: 0,
        allowShrink: false,
        maxRows: 5000,
      });
      if (!result.ok) {
        throw new Error(`${slug}: ${JSON.stringify(result.errors.slice(0, 5), null, 2)}`);
      }
      expect(result.rows.length, slug).toBeGreaterThan(0);
    }
  });

  it('programme staff state no curriculum year, since no sample sheet creates a revision', () => {
    // The importer resolves a stated year against the programme's revisions and refuses the
    // row when none matches; the sample data has no revisions, so the cell must stay blank.
    const years = buildSampleRows('program-faculty').map((r) => r['Curriculum Year']);
    expect(years.length).toBeGreaterThan(0);
    expect(new Set(years)).toEqual(new Set([null]));
  });

  it('upload order puts every reference before its user', () => {
    SAMPLE_UPLOAD_ORDER.forEach((slug, index) => {
      for (const col of getImportDataset(slug).columns) {
        if (!col.references) continue;
        const refIndex = SAMPLE_UPLOAD_ORDER.indexOf(col.references.dataset);
        expect(refIndex, `${slug}.${col.key} → ${col.references.dataset}`).toBeGreaterThanOrEqual(0);
        expect(refIndex, `${slug}.${col.key} → ${col.references.dataset}`).toBeLessThan(index);
      }
    });
  });

  it('no person is named', () => {
    const staff = getImportDataset('faculty-members');
    const nameHeaders = staff.columns.filter((c) => c.key.startsWith('name')).map((c) => c.header);
    expect(nameHeaders.length).toBeGreaterThan(0);
    for (const row of buildSampleRows('faculty-members')) {
      for (const h of nameHeaders) expect(String(row[h])).toMatch(/^(Lecturer|อาจารย์) \d{3}$/);
    }
  });

  it('no active staff member retires before the end of 2027', () => {
    const staff = getImportDataset('faculty-members');
    const header = staff.columns.find((c) => c.key === 'retirementDate')?.header;
    expect(header).toBeDefined();
    for (const row of buildSampleRows('faculty-members')) {
      expect(String(row[header as string]) > '2027-12-31', String(row[header as string])).toBe(true);
    }
  });

  it('committed files match the generator', () => {
    for (const slug of SAMPLE_UPLOAD_ORDER) {
      const dataset = getImportDataset(slug);
      const file = path.join(sampleDir, sampleFilename(slug));
      expect(fs.existsSync(file), `${file} missing — run pnpm workshop:sample-data`).toBe(true);
      const committed = parse(dataset, fs.readFileSync(file));
      const generated = parse(dataset, buildSampleWorkbook(slug));
      expect(committed, `${sampleFilename(slug)} drifted — run pnpm workshop:sample-data`).toEqual(generated);
    }
  });

  it('generator is deterministic', () => {
    for (const slug of SAMPLE_UPLOAD_ORDER) {
      expect(buildSampleRows(slug)).toEqual(buildSampleRows(slug));
    }
  });
});
