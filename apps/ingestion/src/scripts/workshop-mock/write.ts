// Write the xlsx files and the attendee-facing README.txt.
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import type { Row, World } from './datasets';
import { UPLOAD_ORDER, sheetInfo } from './datasets';
import type { Anchor } from './inputs';

// SheetJS writes the same bytes for the same workbook: it has no clock-based zip entry times and
// takes the core.xml dates from Props. Pin the dates so nothing depends on when the run happens.
const FIXED_DATE = new Date(Date.UTC(2000, 0, 1, 0, 0, 0));

export function fileName(index: number, slug: string): string {
  return `${String(index).padStart(2, '0')}-${slug}.xlsx`;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/;

/** Throws, naming dataset, row and column, when a text cell holds a control character. */
export function assertCellsClean(slug: string, rows: readonly Row[]): void {
  const { headers } = sheetInfo(slug);
  rows.forEach((r, i) => {
    for (const h of headers) {
      const v = r[h];
      if (typeof v === 'string' && CONTROL.test(v)) {
        throw new Error(`${slug}: row ${i + 2}, column '${h}' holds a control character: ${JSON.stringify(v)}`);
      }
    }
  });
}

/** The bytes of one sheet named as the app expects, headers in row 1. Text stays text; null stays empty. */
export function datasetBytes(slug: string, rows: readonly Row[]): Buffer {
  assertCellsClean(slug, rows);
  const { sheetName, headers } = sheetInfo(slug);
  const aoa: Array<Array<string | number | null>> = [
    [...headers],
    ...rows.map((r) => headers.map((h) => r[h] ?? null)),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  for (const [addr, cell] of Object.entries(ws)) {
    if (addr.startsWith('!')) continue;
    const c = cell as XLSX.CellObject;
    if (typeof c.v === 'string') {
      c.t = 's'; // never a formula or a number, whatever the text looks like
      delete c.f;
    }
  }
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  wb.Props = { CreatedDate: FIXED_DATE, ModifiedDate: FIXED_DATE };
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }) as Buffer;
}

export function writeDataset(out: string, index: number, slug: string, rows: readonly Row[]): string {
  const file = path.join(out, fileName(index, slug));
  fs.writeFileSync(file, datasetBytes(slug, rows));
  return file;
}

/** One line per anchor: the TCAS row it was matched to and the mock programme it became. */
export function anchorLines(world: World, anchors: readonly Anchor[]): string[] {
  return anchors.map((a) => {
    const prog = world.slice.programmes.find((p) => p.isAnchor && p.nameTh === a.programmeTh && p.level === a.input.level);
    const code = prog ? prog.code : '?';
    if (a.courseCodes.length > 0) {
      const more = a.courseCodes.length > 1 ? ` (+${a.courseCodes.length - 1} more codes)` : '';
      return `${a.input.name} -> programme ${code}: TCAS course code ${a.courseCodes[0]}${more}, faculty '${a.facultyTh}', programme '${a.programmeTh}'`;
    }
    return `${a.input.name} -> programme ${code} (${a.input.level}): no TCAS row (only bachelor programmes have TCAS rows), faculty '${a.facultyTh}'`;
  });
}

export function readmeText(world: World, anchors: readonly Anchor[], notes: readonly string[], university: string): string {
  const L: string[] = [
    'WORKSHOP MOCK DATA - what to do next', '='.repeat(40), '',
    'These files are MOCK data. They are not your university\'s real figures.',
    'Do not show them to anyone as real results.',
    '',
    '1. Organisation profile',
    '-'.repeat(24),
    'In the app open /admin/organization, the "Identity" tab, and type these two values exactly:',
    `  University name (Thai): ${university}`,
    `  Region (English): ${world.region}`,
    '',
    '2. Upload the files in this order',
    '-'.repeat(33),
    'Dataset pages are under /admin/data-setup. Each dataset has its own page there.',
    'Open the page named below and use the "Upload filled template" control.',
    'Upload in this order. Later files refer to codes in earlier ones.', '',
  ];
  UPLOAD_ORDER.forEach((slug, k) => {
    L.push(`  ${String(k + 1).padStart(2, ' ')}. ${fileName(k + 1, slug).padEnd(46)} dataset page: ${sheetInfo(slug).title}`);
  });
  L.push(
    '',
    'University Rankings: this one has no file. Download the app\'s pre-filled',
    'template and upload it unchanged.',
    '',
    '3. Run these connectors',
    '-'.repeat(23),
    'Do this at /admin/data-sources, AFTER all the uploads above are done.',
    '  tcas              needed. Links the public TCAS admission rows to the mock programmes.',
    '  un-wpp            needed. Loads the public UN population projections.',
    '  kmitl-skill-mapping  optional. Adds public job-skill demand.',
    '  openalex-works    will NOT match. The mock staff are tokens (Lecturer 001 and so on),',
    '                    not real people, so there is nothing for it to find. Skip it.',
    '',
    '4. Which TCAS row anchors which programme',
    '-'.repeat(41),
    'Check that each match below is the programme you meant. If one is wrong, add',
    '"tcas_code": "..." to that entry of "programmes" in your input file and run again.', '',
  );
  L.push(...anchorLines(world, anchors).map((x) => `  ${x}`));
  L.push('', '5. Notes from this run', '-'.repeat(22));
  L.push(...(notes.length ? notes.map((n) => `  - ${n}`) : ['  (none)']));
  L.push(
    '', '6. How to remove the mock data', '-'.repeat(30),
    'On each dataset page use Start over, in the REVERSE of the upload order:',
    'from Career Skill Demand (20) back to Faculties (1). Programmes cannot be cleared',
    'while metric rows still depend on them, so go in that order.',
    'Then delete the generated folder.',
    '',
  );
  return L.join('\n');
}

export function writeReadme(out: string, text: string): string {
  const file = path.join(out, 'README.txt');
  fs.writeFileSync(file, text, 'utf-8');
  return file;
}
