import {
  getImportDataset,
  listImportDatasets,
  validateSheet,
  type ImportDataset,
  type ImportRow,
} from '@kku/db';
import { describe, expect, it } from 'vitest';

import { parseImportWorkbook } from '../src/import/parse';
import { buildImportTemplate } from '../src/import/template';

// The round trip nothing else makes: generate a template with its real
// pre-fill rows, fill in SOME of them the way an operator would, and push the
// bytes back through the parser and the validator.
//
// Every other suite rebuilds the sheet from the header row and discards the
// pre-filled rows, so the question "what happens to the rows the operator did
// not touch?" was never asked. The answer used to be: an enrolment template
// stored a zero for every untouched programme-year, and a finance or outcomes
// template was refused with thousands of errors naming rows the system wrote
// itself.

const PROGRAMMES = ['PF-A', 'PF-B'];
const YEARS = [2023, 2024];

/** Stands in for programmeYearPrefill without needing a database. */
function prefillRows(dataset: ImportDataset): ImportRow[] {
  const yearKey = dataset.columns.find((c) => /year/i.test(c.header))?.key ?? 'academicYear';
  const rows: ImportRow[] = [];
  for (const code of PROGRAMMES) {
    for (const year of YEARS) rows.push({ programmeCode: code, [yearKey]: year });
  }
  return rows;
}

function roundTrip(dataset: ImportDataset, fill: (row: Record<string, unknown>) => void) {
  const bytes = buildImportTemplate(dataset, prefillRows(dataset));
  const parsed = parseImportWorkbook(bytes, dataset.sheetName);
  if (!parsed.ok) throw new Error(`template did not parse: ${parsed.errors[0]?.message}`);

  // The operator opens it and types figures into the first row only.
  const rows = parsed.parsed.rows.map((r) => ({ ...r }));
  const first = rows[0];
  if (!first) throw new Error('template carried no pre-filled rows');
  fill(first);

  return validateSheet(
    dataset,
    { sheetName: dataset.sheetName, headers: parsed.parsed.headers, rows },
    {
      references: new Map([['programmes', new Set(PROGRAMMES)]]),
      heldRowCount: 0,
      allowShrink: true,
      maxRows: 5_000,
    },
  );
}

describe('a pre-filled template, filled in partly and uploaded', () => {
  it('refuses a template uploaded without a single figure in it', () => {
    const result = roundTrip(getImportDataset('student-cohorts'), () => {});
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.message).toMatch(/carries any figures/i);
  });

  it('still reports a mistake the operator made in a key cell', () => {
    const result = roundTrip(getImportDataset('student-cohorts'), (row) => {
      row['Entry Year'] = 2568;
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]?.column).toBe('Entry Year');
    expect(result.errors[0]?.message).toMatch(/Buddhist/i);
  });

  it('loads only the student-cohort row the operator filled', () => {
    const result = roundTrip(getImportDataset('student-cohorts'), (row) => {
      row['Students Still Enrolled'] = 118;
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ studentCount: 118, entryYear: YEARS[0] });
  });

  it('accepts an alumni-cohort template despite its required status column', () => {
    // Status is a required KEY column the pre-fill deliberately leaves
    // blank, because a cohort has several and guessing one looks like an
    // answer. Untouched rows must still be skipped rather than refused.
    const result = roundTrip(getImportDataset('alumni-cohorts'), (row) => {
      row['Status'] = 'GRADUATED';
      row['Count'] = 94;
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.rows).toHaveLength(1);
  });

  it('covers every dataset that ships a pre-fill', () => {
    // So a new pre-filled dataset cannot be added without a case above.
    const prefilled = listImportDatasets().filter((d) => d.prefill).map((d) => d.slug).sort();
    // Enrolment, finance and graduate outcomes deliberately ship empty.
    expect(prefilled).toEqual(['alumni-cohorts', 'student-cohorts']);
  });
});
