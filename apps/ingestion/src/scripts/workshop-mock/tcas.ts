// Reader for the public TCAS round-3 max/min files (mytcas.com).
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { BUILT_IN_TCAS_FILES, type TcasFile } from '../../connectors/sources/tcas/files';

const USER_AGENT = 'ProgramLandscape-WorkshopMock/1.0';
const REFERER = 'https://www.mytcas.com/stat/';
const TIMEOUT_MS = 60_000;

/** The files the app's own `tcas` connector reads (same list, one source of truth). */
export const TCAS_FILES: readonly TcasFile[] = BUILT_IN_TCAS_FILES;

export interface TcasRow {
  courseCode: string;
  institution: string;
  faculty: string;
  programme: string;
  major: string | null;
  entryYearBE: number;
  round: string;
  quota: number | null;
  applicants: number | null;
  /** pass1 + pass2 when either is stated, the plain pass column when present, else null. */
  admitted: number | null;
  minScore: number | null;
  maxScore: number | null;
}

export interface TcasTotals {
  quota: number;
  applicants: number;
  admitted: number | null;
}

export interface LocalTcasFile {
  path: string;
  entryYearBE: number;
  round: string;
}

function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).trim().replace(/,/g, '');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function int(v: unknown): number | null {
  const n = num(v);
  return n === null ? null : Math.trunc(n);
}

/** Header comparison only: collapse whitespace (incl. newlines). */
function norm(h: unknown): string {
  return String(h ?? '').split(/\s+/).filter(Boolean).join(' ');
}

const ALIASES = {
  institution: ['สถาบัน', 'university_name'],
  code: ['รหัสหลักสูตร', 'program_id'],
  faculty: ['คณะ', 'คณะ/สำนักวิชา', 'program_lookup_programs.faculty_name_th'],
  programme: ['หลักสูตร', 'ชื่อหลักสูตร', 'program_name_th'],
  major: ['สาขา/วิชาเอก', 'สาขาวิชา/วิชาเอก', 'แขนง/วิชาเอก', 'major_name_th'],
  quota: ['รับ'],
  applicants: ['สมัคร'],
  pass: ['ผ่าน'],
  pass1: ['ผ่าน(รอบ1)', 'ผ่าน ประมวลผลครั้งที่ 1'],
  pass2: ['ผ่าน(รอบ2)', 'ผ่าน ประมวลผลครั้งที่ 2'],
  min: ['คะแนนต่ำสุด', 'คะแนนต่ำสุด ประมวลผลครั้งที่ 1'],
  max: ['คะแนนสูงสุด', 'คะแนนสูงสุด ประมวลผลครั้งที่ 1'],
} as const;
type Key = keyof typeof ALIASES;
const KEYS = Object.keys(ALIASES) as Key[];

function indexOfHeader(headers: string[], key: Key): number | null {
  for (const alias of ALIASES[key]) {
    const i = headers.indexOf(alias);
    if (i >= 0) return i;
  }
  return null;
}

function readFile(file: string, entryYearBE: number, round: string): TcasRow[] {
  const wb = XLSX.readFile(file, { cellDates: false });
  const ws = wb.Sheets[wb.SheetNames[0]!];
  if (!ws) throw new Error(`${path.basename(file)}: no sheet`);
  const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
  if (grid.length === 0) throw new Error(`${path.basename(file)}: empty file`);
  const headers = (grid[0] as unknown[]).map(norm);
  const ix = {} as Record<Key, number | null>;
  for (const k of KEYS) ix[k] = indexOfHeader(headers, k);
  if (ix.institution === null || ix.code === null) {
    throw new Error(`${path.basename(file)}: missing institution/course-code header`);
  }
  const at = (r: unknown[], key: Key): unknown => {
    const i = ix[key];
    return i !== null && i < r.length ? r[i] : null;
  };
  const out: TcasRow[] = [];
  for (const r of grid.slice(1) as unknown[][]) {
    const code = text(at(r, 'code'));
    const inst = text(at(r, 'institution'));
    if (!code || !inst) continue;
    const plain = int(at(r, 'pass'));
    const p1 = int(at(r, 'pass1'));
    const p2 = int(at(r, 'pass2'));
    let admitted: number | null;
    if (plain !== null) admitted = plain;
    else if (p1 === null && p2 === null) admitted = null;
    else admitted = (p1 ?? 0) + (p2 ?? 0);
    out.push({
      courseCode: code,
      institution: inst,
      faculty: text(at(r, 'faculty')) ?? '',
      programme: text(at(r, 'programme')) ?? '',
      major: text(at(r, 'major')),
      entryYearBE,
      round,
      quota: int(at(r, 'quota')),
      applicants: int(at(r, 'applicants')),
      admitted,
      minScore: num(at(r, 'min')),
      maxScore: num(at(r, 'max')),
    });
  }
  const empty = out.filter((x) => !x.faculty || !x.programme).length;
  if (empty) console.warn(`warning: ${path.basename(file)}: ${empty} of ${out.length} rows have empty faculty or programme`);
  return out;
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT, Referer: REFERER },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const tmp = `${dest}.part`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, dest);
}

/**
 * Read TCAS rows. `files` bypasses the download (tests, `--tcas-file`) and a bad file throws.
 * Without it the nine built-in files are cached in `cacheDir`; one bad file is skipped with a
 * warning so it cannot stop the run.
 */
export async function loadRows(
  cacheDir: string,
  opts: { offline: boolean; files?: readonly LocalTcasFile[] },
): Promise<TcasRow[]> {
  const rows: TcasRow[] = [];
  if (opts.files) {
    for (const f of opts.files) rows.push(...readFile(f.path, f.entryYearBE, f.round));
    return rows;
  }
  for (const f of TCAS_FILES) {
    const dest = path.join(cacheDir, path.basename(new URL(f.url).pathname));
    try {
      if (!fs.existsSync(dest)) {
        if (opts.offline) {
          console.warn(`warning: ${path.basename(dest)} not cached and offline; skipped`);
          continue;
        }
        await download(f.url, dest);
      }
      rows.push(...readFile(dest, f.entryYearBE, f.round));
    } catch (err) {
      console.warn(`warning: TCAS file ${f.url} skipped: ${(err as Error).message}`);
    }
  }
  return rows;
}

/** Rows of one institution, exact name match. */
export function ownRows(rows: readonly TcasRow[], university: string): TcasRow[] {
  return rows.filter((r) => r.institution === university);
}

/** Python difflib.SequenceMatcher(None, a, b).ratio() (autojunk included). */
export function similarity(aStr: string, bStr: string): number {
  const a = Array.from(aStr);
  const b = Array.from(bStr);
  if (a.length === 0 && b.length === 0) return 1;
  const b2j = new Map<string, number[]>();
  b.forEach((ch, j) => {
    const l = b2j.get(ch);
    if (l) l.push(j);
    else b2j.set(ch, [j]);
  });
  if (b.length >= 200) {
    const ntest = Math.floor(b.length / 100) + 1;
    for (const [k, l] of [...b2j]) if (l.length > ntest) b2j.delete(k);
  }
  const longest = (alo: number, ahi: number, blo: number, bhi: number): [number, number, number] => {
    let besti = alo;
    let bestj = blo;
    let bestsize = 0;
    let j2len = new Map<number, number>();
    for (let i = alo; i < ahi; i++) {
      const newj2len = new Map<number, number>();
      for (const j of b2j.get(a[i]!) ?? []) {
        if (j < blo) continue;
        if (j >= bhi) break;
        const k = (j2len.get(j - 1) ?? 0) + 1;
        newj2len.set(j, k);
        if (k > bestsize) {
          besti = i - k + 1;
          bestj = j - k + 1;
          bestsize = k;
        }
      }
      j2len = newj2len;
    }
    while (besti > alo && bestj > blo && a[besti - 1] === b[bestj - 1]) {
      besti--;
      bestj--;
      bestsize++;
    }
    while (besti + bestsize < ahi && bestj + bestsize < bhi && a[besti + bestsize] === b[bestj + bestsize]) {
      bestsize++;
    }
    return [besti, bestj, bestsize];
  };
  let matches = 0;
  const queue: Array<[number, number, number, number]> = [[0, a.length, 0, b.length]];
  while (queue.length) {
    const [alo, ahi, blo, bhi] = queue.pop()!;
    const [i, j, k] = longest(alo, ahi, blo, bhi);
    if (k) {
      matches += k;
      if (alo < i && blo < j) queue.push([alo, i, blo, j]);
      if (i + k < ahi && j + k < bhi) queue.push([i + k, ahi, j + k, bhi]);
    }
  }
  return (2 * matches) / (a.length + b.length);
}

export function closestInstitutions(rows: readonly TcasRow[], university: string, n = 5): string[] {
  const names = [...new Set(rows.map((r) => r.institution))].sort();
  return names
    .map((s) => ({ s, score: similarity(university, s) }))
    .sort((x, y) => y.score - x.score || (x.s < y.s ? -1 : x.s > y.s ? 1 : 0))
    .slice(0, n)
    .map((x) => x.s);
}

/**
 * Per entry year (Map in ascending order), summed over distinct course codes. A code repeated
 * by rounds 3.1 and 3.2 counts once: the row that states `admitted`, else the first seen.
 */
export function round3Totals(rows: readonly TcasRow[]): Map<number, TcasTotals> {
  const seen = new Map<string, TcasRow>();
  for (const r of rows) {
    if (!r.round.startsWith('3')) continue;
    const key = `${r.entryYearBE}\u0000${r.courseCode}`;
    const cur = seen.get(key);
    if (cur === undefined || (cur.admitted === null && r.admitted !== null)) seen.set(key, r);
  }
  const acc = new Map<number, TcasTotals>();
  for (const r of seen.values()) {
    const a = acc.get(r.entryYearBE) ?? { quota: 0, applicants: 0, admitted: null };
    a.quota += r.quota ?? 0;
    a.applicants += r.applicants ?? 0;
    if (r.admitted !== null) a.admitted = (a.admitted ?? 0) + r.admitted;
    acc.set(r.entryYearBE, a);
  }
  return new Map([...acc].sort((x, y) => x[0] - y[0]));
}
