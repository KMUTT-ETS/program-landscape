// Attendee input file (JSON) and resolution of programmes to TCAS rows.
import fs from 'node:fs';
import path from 'node:path';
import { similarity, type TcasRow } from './tcas';

export const LEVELS = ['BACHELOR', 'MASTER', 'DOCTORAL', 'HIGHER_GRAD_DIPLOMA'] as const;
export type Level = (typeof LEVELS)[number];
const MIN_SCORE = 0.6;
const MIN_MARGIN = 0.05;

/** The message is the text printed to the attendee. */
export class InputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InputError';
  }
}

export interface ProgrammeInput {
  name: string;
  pdf: string | null;
  /** Normally a Level; resolveAnchors rejects anything else. */
  level: string;
  faculty: string | null;
  tcasCode: string | null;
  courses: string | null;
  nameEn: string | null;
}

export interface Inputs {
  university: string;
  region: string;
  programmes: ProgrammeInput[];
}

export interface Anchor {
  input: ProgrammeInput;
  facultyTh: string;
  programmeTh: string;
  courseCodes: string[];
  rows: TcasRow[];
}

function str(d: Record<string, unknown>, key: string, where: string, required = false): string | null {
  const v = d[key];
  if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) {
    if (required) throw new InputError(`${where}: \`${key}\` is required`);
    return null;
  }
  if (typeof v !== 'string') throw new InputError(`${where}: \`${key}\` must be text`);
  return v.trim();
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function loadInputs(jsonPath: string): Inputs {
  const name = path.basename(jsonPath);
  let raw: string;
  try {
    raw = fs.readFileSync(jsonPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') throw new InputError(`Input file not found: ${jsonPath}`);
    throw new InputError(`${name}: cannot read the file (${(err as Error).message})`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);
  } catch (err) {
    throw new InputError(`${name}: not valid JSON (${(err as Error).message})`);
  }
  if (!isRecord(data)) throw new InputError(`${name}: the file must hold one JSON object`);
  const base = path.dirname(path.resolve(jsonPath));
  const rel = (v: string | null): string | null => (v === null ? null : path.isAbsolute(v) ? v : path.join(base, v));

  const university = str(data, 'university', name, true)!;
  const region = str(data, 'region', name, true)!;
  const blocks = data.programmes;
  if (!Array.isArray(blocks) || blocks.length === 0) {
    throw new InputError(`${name}: add at least one entry to "programmes"`);
  }
  const programmes: ProgrammeInput[] = blocks.map((b: unknown, idx: number) => {
    const where = `${name} programmes #${idx + 1}`;
    if (!isRecord(b)) throw new InputError(`${where}: must be an object`);
    const level = (str(b, 'level', where) ?? 'BACHELOR').toUpperCase();
    if (!(LEVELS as readonly string[]).includes(level)) {
      throw new InputError(`${where}: level must be one of ${LEVELS.join(', ')} (got ${level})`);
    }
    const faculty = str(b, 'faculty', where);
    if (level !== 'BACHELOR' && !faculty) throw new InputError(`${where}: \`faculty\` is required for level ${level}`);
    return {
      name: str(b, 'name', where, true)!,
      pdf: rel(str(b, 'pdf', where)),
      level,
      faculty,
      tcasCode: str(b, 'tcas_code', where),
      courses: rel(str(b, 'courses', where)),
      nameEn: str(b, 'name_en', where),
    };
  });
  return { university, region, programmes };
}

const squash = (s: string): string => (s ?? '').replace(/\s+/g, '');

// "-วศ.บ.4ปี" (older files) or "ปริญญาตรี 4 ปี" (newer) after whitespace is squashed
const TRAILING_DEGREE = /-[^-]*ปี$|ปริญญา[^()]*?ปี/g;
const INTL = /\(?หลักสูตรนานาชาติ\)?/g;
const PAREN = /\(([^)]*)\)/g;
const DEGREE_TOKEN = /\S*บัณฑิต/g;
const YEARS = /\d+\s*ปี/g;

function afterMarker(name: string): string {
  let s = squash(name);
  if (s.startsWith('หลักสูตร')) s = s.slice('หลักสูตร'.length);
  s = s.replace(TRAILING_DEGREE, '');
  for (const marker of ['สาขาวิชา', 'สาขา']) {
    const at = s.indexOf(marker);
    if (at >= 0) return s.slice(at + marker.length);
  }
  return s;
}

/**
 * Normalised readings of a programme name, for comparison only: the part after สาขา(วิชา),
 * each parenthesised field, the name without degree words, year suffixes, a leading หลักสูตร
 * and หลักสูตรนานาชาติ, and the full name.
 */
function views(name: string): string[] {
  const out = new Set<string>([squash(name), afterMarker(name)]);
  for (const m of name.matchAll(PAREN)) out.add(squash((m[1] ?? '').replace(INTL, '')));
  let t = name.replace(INTL, ' ').trim();
  t = t.replace(/^หลักสูตร/, '');
  t = t.replace(YEARS, '').replace(TRAILING_DEGREE, '');
  t = t.replace(DEGREE_TOKEN, ' ');
  t = t.replace(/สาขาวิชา|สาขา/g, ' ');
  out.add(squash(t.replace(/[()]/g, ' ')));
  return [...out].filter((v) => v).sort();
}

function score(typed: string, tcas: string): number {
  const b = views(tcas);
  let best = 0;
  for (const x of views(typed)) for (const y of b) best = Math.max(best, similarity(x, y));
  return best;
}

const isIntl = (name: string): boolean => name.includes('นานาชาติ');
const sameButInternational = (a: string, b: string): boolean => squash(a.replace(INTL, '')) === squash(b.replace(INTL, ''));

interface Pair {
  faculty: string;
  programme: string;
  codes: Set<string>;
  rows: TcasRow[];
}

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** One pair per distinct (faculty, programme) in the latest entry year, sorted. */
function latestPairs(own: readonly TcasRow[]): Pair[] {
  if (own.length === 0) return [];
  const year = Math.max(...own.map((r) => r.entryYearBE));
  const grouped = new Map<string, Pair>();
  for (const r of own) {
    if (r.entryYearBE !== year) continue;
    const key = `${r.faculty}\u0001${r.programme}`;
    const p = grouped.get(key) ?? { faculty: r.faculty, programme: r.programme, codes: new Set<string>(), rows: [] };
    p.codes.add(r.courseCode);
    p.rows.push(r);
    grouped.set(key, p);
  }
  return [...grouped.values()].sort((a, b) => cmp(a.faculty, b.faculty) || cmp(a.programme, b.programme));
}

function anchorOf(input: ProgrammeInput, pair: Pair): Anchor {
  return { input, facultyTh: pair.faculty, programmeTh: pair.programme, courseCodes: [...pair.codes].sort(), rows: [...pair.rows] };
}

function candidateLines(ranked: Array<[number, Pair]>): string {
  return ranked
    .slice(0, 5)
    .map(([s, p]) => `  ${[...p.codes].sort()[0]}  ${p.faculty} | ${p.programme}  (${s.toFixed(2)})`)
    .join('\n');
}

export function resolveAnchors(inputs: Inputs, own: readonly TcasRow[]): Anchor[] {
  const pairs = latestPairs(own);
  const out: Anchor[] = [];
  for (const inp of inputs.programmes) {
    if (!(LEVELS as readonly string[]).includes(inp.level)) {
      throw new InputError(`${inp.name}: level must be one of ${LEVELS.join(', ')} (got ${inp.level})`);
    }
    if (inp.level !== 'BACHELOR') {
      if (!inp.faculty) throw new InputError(`${inp.name}: \`faculty\` is required for level ${inp.level}`);
      const typed = squash(inp.faculty);
      const known = [...new Set(own.map((r) => r.faculty))].sort();
      const facultyTh = known.find((f) => squash(f) === typed) ?? inp.faculty;
      out.push({ input: inp, facultyTh, programmeTh: inp.name, courseCodes: [], rows: [] });
      continue;
    }
    if (pairs.length === 0) throw new InputError(`${inp.name}: no TCAS rows for ${inputs.university}`);
    const year = Math.max(...own.map((r) => r.entryYearBE));
    if (inp.tcasCode) {
      const hit = pairs.find((p) => p.codes.has(inp.tcasCode!));
      if (hit) {
        out.push(anchorOf(inp, hit));
        continue;
      }
      const older = own.find((r) => r.courseCode === inp.tcasCode);
      if (!older) throw new InputError(`${inp.name}: tcas_code ${inp.tcasCode} is not a course code of ${inputs.university}`);
      let near = pairs[0]!;
      let nearScore = -1;
      for (const p of pairs) {
        const s = score(older.programme, p.programme);
        if (s > nearScore) {
          near = p;
          nearScore = s;
        }
      }
      throw new InputError(
        `${inp.name}: tcas_code ${inp.tcasCode} is not in the latest TCAS year (${year}); ` +
          `course codes change between years. Closest programme in ${year}: ` +
          `${near.faculty} | ${near.programme}, codes: ${[...near.codes].sort().join(', ')}`,
      );
    }
    let pool = pairs;
    if (inp.faculty) {
      // an optional faculty narrows the candidates when it matches any
      const typedF = squash(inp.faculty);
      const narrowed = pairs.filter((p) => squash(p.faculty) === typedF);
      if (narrowed.length) pool = narrowed;
    }
    const typedIntl = isIntl(inp.name);
    const ranked: Array<[number, Pair]> = pool
      .map((p): [number, Pair] => [score(inp.name, p.programme), p])
      .sort((x, y) => {
        const rx = Math.round(x[0] * 1e9);
        const ry = Math.round(y[0] * 1e9);
        if (rx !== ry) return ry - rx;
        const ix = isIntl(x[1].programme) !== typedIntl ? 1 : 0;
        const iy = isIntl(y[1].programme) !== typedIntl ? 1 : 0;
        return ix - iy || cmp(x[1].faculty, y[1].faculty) || cmp(x[1].programme, y[1].programme);
      });
    const top = ranked[0]!;
    const best = top[0];
    // the international twin of the winner is not a rival: the typed name decides between them
    const rivals = ranked
      .slice(1)
      .filter(([, p]) => !(p.faculty === top[1].faculty && sameButInternational(p.programme, top[1].programme)));
    const second = rivals.length ? rivals[0]![0] : 0;
    if (best < MIN_SCORE || best - second < MIN_MARGIN) {
      const why = best < MIN_SCORE ? 'no close match' : 'more than one close match';
      throw new InputError(
        `Cannot match programme '${inp.name}' to a TCAS programme (${why}). ` +
          `Closest candidates:\n${candidateLines(ranked)}\n` +
          'Add `"tcas_code": "<course code>"` to that programme in the input file.',
      );
    }
    out.push(anchorOf(inp, top[1]));
  }
  return out;
}
