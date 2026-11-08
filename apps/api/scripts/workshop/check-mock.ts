// Compatibility check for the workshop mock-data generator
// (apps/ingestion/src/scripts/workshop-mock): proves the generated files pass the app's real
// importer and that the `tcas` connector's matcher would link the generated
// bachelor programmes to the university's public TCAS rows.
//
//   pnpm workshop:check-mock <dir> <input.json>
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

// Header spellings by year (only the columns the matcher needs; the generator's reader is
// apps/ingestion/src/scripts/workshop-mock/tcas.ts).
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

export function universityFromInput(file: string): string {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  } catch (e) {
    throw new Error(`${file}: ${(e as Error).message}`);
  }
  const u = (data as { university?: unknown } | null)?.university;
  if (typeof u !== 'string' || u.trim() === '') throw new Error(`${file}: no "university" text`);
  return u.trim();
}

const USAGE = `Usage: pnpm workshop:check-mock <dir> <input.json> [--cache DIR]

  <dir>         the generator's output folder
  <input.json>  the input file given to the generator (its "university" is read)
  --cache DIR   where the TCAS files are (default <dir>/.cache). If the generator recorded
                the files it used (tcas-files.json there), exactly those are read.

Exit codes: 0 every file passes and every bachelor programme matches; 1 a check failed
(the lines above name it); 2 a problem with the arguments or an unreadable input.`;

/** Returns the exit code. User-relative paths resolve against `base`. */
export function runCheck(argv: string[], base: string = process.env.INIT_CWD ?? process.cwd()): number {
  const positional: string[] = [];
  let cacheArg: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string;
    if (a === '--cache') {
      cacheArg = argv[++i] ?? null;
      if (!cacheArg) {
        console.log(`--cache needs a folder\n${USAGE}`);
        return 2;
      }
    } else if (a.startsWith('--')) {
      console.log(`Unknown option ${a}\n${USAGE}`);
      return 2;
    } else positional.push(a);
  }
  const [dirArg, inputArg] = positional;
  if (!dirArg || !inputArg || positional.length > 2) {
    console.log(USAGE);
    return 2;
  }
  const dir = path.resolve(base, dirArg);
  const input = path.resolve(base, inputArg);
  const cache = cacheArg ? path.resolve(base, cacheArg) : path.join(dir, '.cache');
  let files: string[] = [];
  try {
    const manifest = path.join(cache, 'tcas-files.json');
    if (fs.existsSync(manifest)) {
      files = (JSON.parse(fs.readFileSync(manifest, 'utf8')) as Array<{ file: string }>).map((m) => m.file);
    } else if (fs.existsSync(cache)) {
      files = fs.readdirSync(cache).filter((f) => f.endsWith('.xlsx') && !f.startsWith('~$'));
    }
  } catch (e) {
    console.log(`${path.join(cache, 'tcas-files.json')}: ${(e as Error).message}`);
    return 2;
  }
  if (files.length === 0) {
    console.log(`No TCAS files in ${cache}. Run the generator first (it caches them there), or pass --cache.`);
    return 2;
  }
  const rows: TcasMatchRow[] = [];
  for (const f of files) {
    try {
      rows.push(...readTcasFile(path.join(cache, f)));
    } catch (e) {
      console.log(`${f}: ${(e as Error).message}`);
      return 2;
    }
  }
  let university: string;
  try {
    university = universityFromInput(input);
  } catch (e) {
    console.log((e as Error).message);
    return 2;
  }
  const result = checkMockDir(dir, rows, university);
  console.log(`Matched ${result.matched.length} bachelor programme(s) to TCAS rows:`);
  for (const m of result.matched) console.log(`  ok    ${m}`);
  for (const m of result.unmatched) console.log(`  MISS  ${m}`);
  for (const e of result.errors) console.log(`  ERROR ${e}`);
  const bad = result.errors.length + result.unmatched.length;
  console.log(
    bad === 0
      ? `OK: every file passes the importer and all ${result.matched.length} bachelor programme(s) match (read ${files.length} TCAS file(s)).`
      : `FAILED: ${bad} problem(s) (${result.errors.length} file error(s), ${result.unmatched.length} unmatched programme(s)).`,
  );
  return bad === 0 ? 0 : 1;
}

if (require.main === module) process.exit(runCheck(process.argv.slice(2)));
