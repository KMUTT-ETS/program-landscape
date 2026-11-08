// Generate mock import spreadsheets for a workshop attendee's university.
//
//   pnpm workshop:mock <input.json> [--size small|medium] [--seed N] [--out DIR]
//                      [--cache DIR] [--offline] [--tcas-file PATH:YEAR:ROUND ...]
//
// Exit codes: 0 success, 2 input error (a message, no stack trace).
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { getImportDataset, validateSheet, type ImportDataset, type ParsedSheet } from '@kku/db';
import { coursesFromCsv, coursesFromPdf, inventedCourses, shareWithSibling, type Course } from './courses';
import { UPLOAD_ORDER, buildRows, type Row, type World } from './datasets';
import { InputError, loadInputs, resolveAnchors } from './inputs';
import { makePublications, makeStaff } from './people';
import { makeRng } from './rng';
import { SIZES, chooseSlice, type Slice, type SliceSize } from './slice';
import {
  TCAS_FILES,
  closestInstitutions,
  loadRows,
  ownRows,
  type LocalTcasFile,
  type TcasRow,
} from './tcas';
import { assertCellsClean, anchorLines, datasetBytes, fileName, readmeText } from './write';

const USAGE =
  'Usage: pnpm workshop:mock <input.json> [--size small|medium] [--seed N] [--out DIR] ' +
  '[--cache DIR] [--offline] [--tcas-file PATH:YEAR:ROUND ...]';

interface Args {
  input: string;
  size: SliceSize;
  seed: number;
  out: string;
  cache: string | null;
  offline: boolean;
  tcasFiles: string[];
}

function parseCli(argv: readonly string[], base: string): Args {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      allowPositionals: true,
      options: {
        size: { type: 'string', default: 'small' },
        seed: { type: 'string', default: '2026' },
        out: { type: 'string', default: 'workshop-mock-out' },
        cache: { type: 'string' },
        offline: { type: 'boolean', default: false },
        'tcas-file': { type: 'string', multiple: true, default: [] },
      },
    });
  } catch (err) {
    throw new InputError(`${(err as Error).message}\n${USAGE}`);
  }
  const { values, positionals } = parsed;
  if (positionals.length !== 1) throw new InputError(`Give exactly one input file.\n${USAGE}`);
  const size = String(values.size);
  if (!Object.prototype.hasOwnProperty.call(SIZES, size)) {
    throw new InputError(`--size must be one of ${Object.keys(SIZES).sort().join(', ')} (got ${size})`);
  }
  if (!/^-?\d+$/.test(String(values.seed))) throw new InputError(`--seed must be an integer (got ${String(values.seed)})`);
  const abs = (p: string): string => path.resolve(base, p);
  return {
    input: abs(positionals[0] as string),
    size: size as SliceSize,
    seed: Number(values.seed),
    out: abs(String(values.out)),
    cache: values.cache ? abs(String(values.cache)) : null,
    offline: Boolean(values.offline),
    tcasFiles: (values['tcas-file'] ?? []) as string[],
  };
}

function parseTcasFiles(specs: readonly string[], base: string): LocalTcasFile[] {
  const known = TCAS_FILES.map((f) => `${f.entryYearBE}:${f.round}`);
  return specs.map((s) => {
    const parts = s.split(':');
    const round = parts.pop() ?? '';
    const yearText = parts.pop() ?? '';
    const file = parts.join(':'); // a Windows path holds a colon
    if (!file || !/^\d+$/.test(yearText) || !round) {
      throw new InputError(`--tcas-file '${s}': write it as PATH:YEAR:ROUND, e.g. tcas67.xlsx:2567:3`);
    }
    const year = Number(yearText);
    if (!known.includes(`${year}:${round}`)) {
      throw new InputError(
        `--tcas-file '${s}': no TCAS file for year ${year} round ${round}. Known: ` + [...known].sort().join(', '),
      );
    }
    const full = path.resolve(base, file);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) throw new InputError(`--tcas-file '${s}': file not found: ${full}`);
    return { path: full, entryYearBE: year, round };
  });
}

function cacheName(year: number, round: string): string {
  const f = TCAS_FILES.find((x) => x.entryYearBE === year && x.round === round);
  if (!f) throw new InputError(`no TCAS file for year ${year} round ${round}`);
  return path.basename(new URL(f.url).pathname);
}

async function buildCourses(slice: Slice, seed: number, notes: string[]): Promise<Map<string, Course[]>> {
  const dept = new Map(slice.departments.map((d) => [d.code, d.nameEn]));
  const byCode = new Map(slice.programmes.map((p) => [p.code, p]));
  const courses = new Map<string, Course[]>();
  const invent = (p: Slice['programmes'][number]): Course[] =>
    inventedCourses(p, makeRng(`${seed}-${p.code}`), dept.get(p.departmentCode) ?? p.nameEn);

  for (const p of slice.programmes) {
    if (p.siblingOf !== null) continue;
    let list: Course[] | null = null;
    if (p.coursesCsv) {
      const cs = coursesFromCsv(p.coursesCsv);
      if (cs.length > 0) {
        notes.push(`${p.nameTh}: ${cs.length} courses read from ${path.basename(p.coursesCsv)}`);
        list = cs;
      } else notes.push(`${p.nameTh}: no courses in ${path.basename(p.coursesCsv)}; using an invented list`);
    } else if (p.pdf) {
      const r = await coursesFromPdf(p.pdf);
      notes.push(`${p.nameTh}: ${r.note}`);
      if (r.courses.length > 0) list = r.courses;
    }
    courses.set(p.code, list ?? invent(p));
  }
  for (const p of slice.programmes) {
    if (p.siblingOf === null) continue;
    const base = byCode.get(p.siblingOf);
    const baseCourses = base ? courses.get(base.code) : undefined;
    if (!baseCourses) throw new Error(`programme ${p.code} is a sibling of an unknown programme ${p.siblingOf}`);
    courses.set(p.code, shareWithSibling(baseCourses, invent(p), makeRng(`${seed}-share-${p.code}`)));
  }
  return courses;
}

const MANIFEST = 'tcas-files.json';

function readManifest(cache: string): LocalTcasFile[] | null {
  const file = path.join(cache, MANIFEST);
  if (!fs.existsSync(file)) return null;
  try {
    const list = JSON.parse(fs.readFileSync(file, 'utf-8')) as Array<{ file: string; entryYearBE: number; round: string }>;
    return list.map((m) => ({ path: path.join(cache, m.file), entryYearBE: m.entryYearBE, round: m.round }));
  } catch (err) {
    throw new InputError(`${file} cannot be read (${(err as Error).message}). Delete it or run again with --tcas-file.`);
  }
}

async function readTcas(args: Args, tcasFiles: LocalTcasFile[], cache: string): Promise<TcasRow[]> {
  if (tcasFiles.length === 0 && args.offline) {
    // an earlier --tcas-file run recorded which files it used; read exactly those
    const recorded = readManifest(cache);
    if (recorded) {
      console.log(`Using the TCAS files recorded by an earlier --tcas-file run (${path.join(cache, MANIFEST)}).`);
      tcasFiles = recorded;
    }
  }
  if (tcasFiles.length > 0) {
    const rows: TcasRow[] = [];
    for (const f of tcasFiles) {
      if (!fs.existsSync(f.path)) throw new InputError(`TCAS file not found: ${f.path}`);
      try {
        rows.push(...(await loadRows(cache, { offline: true, files: [f] })));
      } catch (err) {
        throw new InputError(`--tcas-file ${f.path} cannot be read as a TCAS file (${(err as Error).name}: ${(err as Error).message})`);
      }
    }
    return rows;
  }
  try {
    return await loadRows(cache, { offline: args.offline });
  } catch (err) {
    throw new InputError(
      `Cannot download the TCAS files (${(err as Error).message}). Download them yourself and pass ` +
        '--tcas-file PATH:YEAR:ROUND, or fix the network.',
    );
  }
}

async function run(argv: readonly string[], base: string): Promise<number> {
  const args = parseCli(argv, base);
  const inputs = loadInputs(args.input);
  const cache = args.cache ?? path.join(args.out, '.cache');
  const tcasFiles = parseTcasFiles(args.tcasFiles, base);
  const rows = await readTcas(args, tcasFiles, cache);
  if (rows.length === 0) {
    const hint = args.offline
      ? 'Nothing is cached and --offline forbids downloading. Run once without --offline, or pass --tcas-file PATH:YEAR:ROUND.'
      : 'No TCAS rows could be read. Check the network, or pass --tcas-file PATH:YEAR:ROUND.';
    throw new InputError(`No TCAS data. ${hint}`);
  }
  const own = ownRows(rows, inputs.university);
  if (own.length === 0) {
    const near = closestInstitutions(rows, inputs.university);
    throw new InputError(
      `University '${inputs.university}' is not in the TCAS files. ` +
        `Use the Thai name exactly as TCAS spells it. Closest names:\n  ${near.join('\n  ')}`,
    );
  }
  const anchors = resolveAnchors(inputs, own);
  const slice = chooseSlice(anchors, own, args.size, makeRng(args.seed));
  const { staff, links } = makeStaff(slice, makeRng(args.seed));
  const publications = makePublications(slice, staff, links, makeRng(args.seed));
  const notes = [...slice.notes];
  const courses = await buildCourses(slice, args.seed, notes);
  const world: World = { slice, staff, links, publications, courses, region: inputs.region, seed: args.seed, cache: new Map() };

  // Build and validate every sheet with the app's own validator before anything is written.
  const built = new Map<string, Row[]>();
  const references = new Map<string, Set<string>>();
  const failures: string[] = [];
  for (const slug of UPLOAD_ORDER) {
    const dataset: ImportDataset = getImportDataset(slug);
    const sheetRows = buildRows(slug, world);
    built.set(slug, sheetRows);
    try {
      assertCellsClean(slug, sheetRows);
    } catch (err) {
      failures.push((err as Error).message);
    }
    // register this sheet's reference values first, so a failure here cannot make a later
    // sheet throw for lack of references: every failure must reach the list below
    for (const later of UPLOAD_ORDER) {
      for (const col of getImportDataset(later).columns) {
        if (col.references?.dataset !== slug) continue;
        const header = dataset.columns.find((c) => c.key === col.references?.column)?.header;
        if (!header) continue;
        const set = references.get(slug) ?? new Set<string>();
        for (const x of sheetRows) set.add(String(x[header]));
        references.set(slug, set);
      }
    }
    const parsed: ParsedSheet = { sheetName: dataset.sheetName, headers: dataset.columns.map((c) => c.header), rows: sheetRows };
    try {
      const result = validateSheet(dataset, parsed, { references, heldRowCount: 0, allowShrink: false, maxRows: 5000 });
      if (!result.ok) {
        failures.push(`${slug}: the app's importer would refuse this sheet:`);
        for (const e of result.errors.slice(0, 5)) failures.push(`  ${JSON.stringify(e)}`);
        if (result.errors.length > 5) failures.push(`  ... ${result.errors.length - 5} more errors`);
      }
    } catch (err) {
      failures.push(`${slug}: ${(err as Error).message}`);
    }
  }
  if (failures.length > 0) {
    throw new InputError(`Nothing was written. The generated data failed validation:\n${failures.join('\n')}`);
  }

  // All good: now write.
  fs.mkdirSync(args.out, { recursive: true });
  fs.writeFileSync(path.join(args.out, '.gitignore'), '*\n', 'utf-8'); // mock data is never committed
  fs.mkdirSync(cache, { recursive: true });
  for (const f of tcasFiles) {
    const dest = path.join(cache, cacheName(f.entryYearBE, f.round));
    if (path.resolve(f.path) !== path.resolve(dest)) fs.copyFileSync(f.path, dest);
  }
  const manifest = path.join(cache, MANIFEST);
  if (args.tcasFiles.length > 0) {
    // record which files this run used, so a later --offline run reads the same set
    const used = tcasFiles.map((f) => ({ file: cacheName(f.entryYearBE, f.round), entryYearBE: f.entryYearBE, round: f.round }));
    fs.writeFileSync(manifest, `${JSON.stringify(used, null, 2)}\n`, 'utf-8');
  } else if (!args.offline) {
    fs.rmSync(manifest, { force: true }); // an online run downloads the full set again
  }
  console.log(`TCAS years loaded: ${[...new Set(rows.map((r) => `${r.entryYearBE}/${r.round}`))].sort().join(', ')}`);
  console.log('TCAS matches:');
  for (const line of anchorLines(world, anchors)) console.log(`  ${line}`);
  for (const n of notes) console.log(`note: ${n}`);
  UPLOAD_ORDER.forEach((slug, k) => {
    const sheetRows = built.get(slug) as Row[];
    const file = path.join(args.out, fileName(k + 1, slug));
    fs.writeFileSync(file, datasetBytes(slug, sheetRows));
    console.log(`wrote ${file} (${sheetRows.length} rows)`);
  });
  const readme = path.join(args.out, 'README.txt');
  fs.writeFileSync(readme, readmeText(world, anchors, notes, inputs.university), 'utf-8');
  console.log(`wrote ${readme}`);
  console.log(`Next: open ${readme} and follow it.`);
  return 0;
}

/** Run the generator. Returns the exit code; user-relative paths resolve against `base`. */
export async function main(argv: readonly string[], base: string = process.env.INIT_CWD ?? process.cwd()): Promise<number> {
  try {
    return await run(argv, base);
  } catch (err) {
    if (err instanceof InputError) {
      console.log(err.message);
      return 2;
    }
    throw err;
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (err: unknown) => {
      console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
      process.exitCode = 1;
    },
  );
}
