// Compatibility check for the workshop mock-data generator
// (scripts/workshop-mock): proves the generated files pass the app's real
// importer and that the `tcas` connector's matcher would link the generated
// bachelor programmes to the university's public TCAS rows.
//
//   pnpm workshop:check-mock <dir> <input.toml>
//
// Relative paths resolve against the folder you ran pnpm from.
import fs from 'node:fs';
import path from 'node:path';
import { getImportDataset, validateSheet, type ImportDataset } from '@kku/db';
import { buildTcasMatchIndex, findOwnProgrammeMatch } from '@kku/shared';
import * as XLSX from 'xlsx';
import { parseImportWorkbook } from '../../src/import/parse';

export interface TcasMatchRow {
  institution: string;
  faculty: string;
  programme: string;
  major: string | null;
  /** Course code; optional, used only by the drift test. */
  code?: string;
}

export interface CheckResult {
  errors: string[];
  /** "<programme code> <Thai name>" of each bachelor programme a TCAS row links to. */
  matched: string[];
  unmatched: string[];
}

const FILE_RE = /^(\d{2})-([a-z][a-z0-9-]*)\.xlsx$/;

function cell(v: unknown): string {
  return v === null || v === undefined ? '' : String(v).trim();
}

function parse(dataset: ImportDataset, bytes: Buffer) {
  const r = parseImportWorkbook(bytes, dataset.sheetName);
  if (!r.ok) throw new Error(r.error);
  return r.parsed;
}

export function checkMockDir(
  dir: string,
  tcasRows: readonly TcasMatchRow[],
  university: string,
): CheckResult {
  const errors: string[] = [];
  const files = fs
    .readdirSync(dir)
    .map((f) => FILE_RE.exec(f))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({ file: m[0], index: Number(m[1]), slug: m[2] as string }))
    .sort((a, b) => a.index - b.index);
  if (files.length === 0) errors.push(`${dir}: no NN-<slug>.xlsx files found`);

  const indexOf = new Map<string, number>(files.map((f) => [f.slug, f.index]));
  const values = new Map<string, Set<string>>(); // dataset slug -> referenced-column values
  const parsedBySlug = new Map<string, ReturnType<typeof parse>>();
  const datasets = new Map<string, ImportDataset>();

  // Pass 1: parse every file so references can be built from the earlier ones.
  for (const f of files) {
    let dataset: ImportDataset;
    try {
      dataset = getImportDataset(f.slug);
    } catch {
      errors.push(`${f.file}: no dataset "${f.slug}" in the app`);
      continue;
    }
    datasets.set(f.slug, dataset);
    try {
      parsedBySlug.set(f.slug, parse(dataset, fs.readFileSync(path.join(dir, f.file))));
    } catch (e) {
      errors.push(`${f.file}: ${(e as Error).message}`);
    }
  }

  // Pass 2: validate in numeric order.
  for (const f of files) {
    const dataset = datasets.get(f.slug);
    const parsed = parsedBySlug.get(f.slug);
    if (!dataset || !parsed) continue;
    for (const col of dataset.columns) {
      const ref = col.references;
      if (!ref) continue;
      const refIndex = indexOf.get(ref.dataset);
      if (refIndex === undefined) {
        errors.push(`${f.file}: column "${col.header}" references ${ref.dataset}, which has no file`);
      } else if (refIndex >= f.index) {
        errors.push(
          `${f.file}: column "${col.header}" references ${ref.dataset} (file ${refIndex}), which must come earlier`,
        );
      }
      if (!values.has(ref.dataset)) {
        const target = datasets.get(ref.dataset);
        const targetParsed = parsedBySlug.get(ref.dataset);
        const header = target?.columns.find((c) => c.key === ref.column)?.header;
        if (target && targetParsed && header) {
          values.set(
            ref.dataset,
            new Set(targetParsed.rows.map((r) => cell(r[header])).filter((v) => v !== '')),
          );
        }
      }
    }
    const result = validateSheet(dataset, parsed, {
      references: values,
      heldRowCount: 0,
      allowShrink: false,
      maxRows: 5000,
    });
    if (!result.ok) {
      for (const e of result.errors.slice(0, 5)) errors.push(`${f.file}: ${JSON.stringify(e)}`);
      if (result.errors.length > 5) errors.push(`${f.file}: ... ${result.errors.length - 5} more errors`);
    } else if (result.rows.length === 0) {
      errors.push(`${f.file}: no rows`);
    }
  }

  // TCAS matching of the bachelor programmes.
  const matched: string[] = [];
  const unmatched: string[] = [];
  const progs = parsedBySlug.get('programmes');
  const facs = parsedBySlug.get('faculties');
  if (progs && facs) {
    const facName = new Map(facs.rows.map((r) => [cell(r['Faculty Code']), cell(r['Name (Thai)'])]));
    const bachelors = progs.rows
      .filter((r) => cell(r['Level']) === 'BACHELOR')
      .map((r) => ({
        id: cell(r['Programme Code']),
        nameTh: cell(r['Name (Thai)']),
        majors: [] as string[],
        facultyNameTh: facName.get(cell(r['Faculty Code'])) ?? '',
      }));
    const idx = buildTcasMatchIndex(bachelors);
    const hit = new Set<string>();
    for (const t of tcasRows) {
      if (t.institution !== university) continue;
      const m = findOwnProgrammeMatch(idx, t.faculty, t.programme, t.major ?? '');
      if (m) hit.add(m.id);
    }
    for (const b of bachelors) (hit.has(b.id) ? matched : unmatched).push(`${b.id} ${b.nameTh}`);
  } else {
    errors.push('01-faculties.xlsx / 03-programmes.xlsx missing or unreadable: cannot check TCAS matching');
  }
  return { errors, matched, unmatched };
}

// Header spellings by year. Twin of ALIASES in scripts/workshop-mock/wsmock/tcas.py
// (only the columns the matcher needs).
const ALIASES: Record<'institution' | 'code' | 'faculty' | 'programme' | 'major', string[]> = {
  institution: ['สถาบัน', 'university_name'],
  code: ['รหัสหลักสูตร', 'program_id'],
  faculty: ['คณะ', 'คณะ/สำนักวิชา', 'program_lookup_programs.faculty_name_th'],
  programme: ['หลักสูตร', 'ชื่อหลักสูตร', 'program_name_th'],
  major: ['สาขา/วิชาเอก', 'สาขาวิชา/วิชาเอก', 'แขนง/วิชาเอก', 'major_name_th'],
};

/** Read a TCAS max/min workbook (first sheet) into matcher rows. */
export function readTcasFile(file: string): TcasMatchRow[] {
  const wb = XLSX.read(fs.readFileSync(file), { type: 'buffer', cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0] as string];
  if (!ws) throw new Error(`${file}: no sheet`);
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
  const headers = (matrix[0] ?? []).map((h) => cell(h).split(/\s+/).join(' '));
  const at = (key: keyof typeof ALIASES): number => {
    for (const alias of ALIASES[key]) {
      const i = headers.indexOf(alias);
      if (i >= 0) return i;
    }
    return -1;
  };
  const ix = {
    institution: at('institution'),
    code: at('code'),
    faculty: at('faculty'),
    programme: at('programme'),
    major: at('major'),
  };
  if (ix.institution < 0 || ix.code < 0) throw new Error(`${file}: no institution / course-code header`);
  const out: TcasMatchRow[] = [];
  for (const r of matrix.slice(1)) {
    const institution = cell(r[ix.institution]);
    const code = cell(r[ix.code]);
    if (!institution || !code) continue;
    out.push({
      institution,
      code,
      faculty: ix.faculty >= 0 ? cell(r[ix.faculty]) : '',
      programme: ix.programme >= 0 ? cell(r[ix.programme]) : '',
      major: ix.major >= 0 ? cell(r[ix.major]) || null : null,
    });
  }
  return out;
}

export function universityFromToml(file: string): string {
  const m = /^\s*university\s*=\s*"((?:[^"\\]|\\.)*)"/m.exec(fs.readFileSync(file, 'utf8'));
  if (!m) throw new Error(`${file}: no university = "..." line`);
  return (m[1] as string).replace(/\\(.)/g, '$1');
}

function main(argv: string[]): number {
  const base = process.env.INIT_CWD ?? process.cwd();
  const [dirArg, tomlArg] = argv;
  if (!dirArg || !tomlArg) {
    console.log('Usage: pnpm workshop:check-mock <dir> <input.toml>');
    return 2;
  }
  const dir = path.resolve(base, dirArg);
  const toml = path.resolve(base, tomlArg);
  const cache = path.join(dir, '.cache');
  const cached = fs.existsSync(cache) ? fs.readdirSync(cache).filter((f) => f.endsWith('.xlsx')) : [];
  if (cached.length === 0) {
    console.log(`No TCAS files in ${cache}. Run the generator first (it caches them there).`);
    return 2;
  }
  const rows = cached.flatMap((f) => readTcasFile(path.join(cache, f)));
  const result = checkMockDir(dir, rows, universityFromToml(toml));
  console.log(`Matched ${result.matched.length} bachelor programme(s) to TCAS rows:`);
  for (const m of result.matched) console.log(`  ok    ${m}`);
  for (const m of result.unmatched) console.log(`  MISS  ${m}`);
  for (const e of result.errors) console.log(`  ERROR ${e}`);
  const bad = result.errors.length + result.unmatched.length;
  console.log(
    bad === 0
      ? 'OK: every file passes the importer and every bachelor programme matches.'
      : `FAILED: ${bad} problem(s).`,
  );
  return bad === 0 ? 0 : 1;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));
