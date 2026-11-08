// Write every XLSX import template to a folder, without a running app or a
// database — for handing to workshop participants before the day.
//
//   pnpm workshop:templates [--out DIR]
//
// Each file is exactly what "Download template" on /admin/data-setup gives,
// minus the rows the app pre-fills from the database (an adopter has none yet).
// The ranked-universities starter list is public reference data held in code,
// so it is kept. Files are numbered in upload order (IMPORT_DATASETS).
//
// Relative paths resolve against the folder you ran pnpm from.
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { listImportDatasets, type ImportDataset, type ImportRow } from '@kku/db';
import type { PrismaClient } from '@prisma/client';
import { buildImportTemplate } from '../../src/import/template';

/** Datasets whose prefill reads only constants in code, never the database. */
const DB_FREE_PREFILL = new Set(['ranked-universities']);

async function prefillRows(dataset: ImportDataset): Promise<readonly ImportRow[]> {
  if (!dataset.prefill || !DB_FREE_PREFILL.has(dataset.slug)) return [];
  return dataset.prefill(null as unknown as PrismaClient, {});
}

export function templateFileName(index: number, slug: string): string {
  return `${String(index).padStart(2, '0')}-${slug}-template.xlsx`;
}

function indexText(datasets: readonly ImportDataset[]): string {
  const lines = [
    'Program Landscape — XLSX import templates',
    '',
    'Upload the files in this order on /admin/data-setup: each dataset may',
    'refer to ones above it (programmes need faculties, staff links need staff).',
    'Fill only the first sheet; the "Guide" sheet explains every column.',
    'Do not add, remove or rename columns.',
    '',
    'Remove personal data before the files leave your office: no national ID',
    'numbers, birth dates, addresses or phone numbers.',
    '',
  ];
  datasets.forEach((d, i) => {
    lines.push(`${templateFileName(i + 1, d.slug).padEnd(52)} ${d.title}`);
  });
  return `${lines.join('\n')}\n`;
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: { out: { type: 'string', default: 'import-templates' } },
  });
  const base = process.env.INIT_CWD ?? process.cwd();
  const out = path.resolve(base, values.out ?? 'import-templates');
  fs.mkdirSync(out, { recursive: true });

  const datasets = listImportDatasets();
  for (const [i, dataset] of datasets.entries()) {
    const bytes = buildImportTemplate(dataset, await prefillRows(dataset));
    fs.writeFileSync(path.join(out, templateFileName(i + 1, dataset.slug)), bytes);
  }
  fs.writeFileSync(path.join(out, 'README.txt'), indexText(datasets));
  process.stdout.write(`Wrote ${datasets.length} templates and README.txt to ${out}\n`);
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
