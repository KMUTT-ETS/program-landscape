// Course lists for each programme: read from the PDF, a CSV, or invented.
import fs from 'node:fs';
import path from 'node:path';
import { normaliseCourseCode } from '@kku/db';
import { courseCodeRegex } from '@kku/shared';
import { extractNativeText } from '../../pdf-intake/pipeline/native-text-extractor';
import type { Rng } from './rng';
import type { Programme } from './slice';

export const GE = 'General education';
export const CORE = 'Core';
export const REQ = 'Major required';
export const ELEC = 'Major elective';
export const FREE = 'Free elective';
export const THESIS = 'Thesis / project';
export const CATEGORIES: readonly string[] = [GE, CORE, REQ, ELEC, FREE, THESIS];
const NOT_MAJOR: readonly string[] = [GE, FREE];

export interface Course {
  code: string;
  nameTh: string | null;
  nameEn: string | null;
  credits: number;
  category: string;
}

const THAI_CHAR = /[฀-๿]/;
// U+0E31, U+0E34-U+0E3A, U+0E47-U+0E4E
const isCombining = (ch: string): boolean => {
  const c = ch.codePointAt(0) ?? 0;
  return c === 0x0e31 || (c >= 0x0e34 && c <= 0x0e3a) || (c >= 0x0e47 && c <= 0x0e4e);
};
// eslint-disable-next-line no-control-regex
const hasControl = (s: string): boolean => /[\u0000-\u001f]/.test(s);

/** Keep a Thai name only if it looks intact (3-80 chars, no leading combining mark, no lost-mark NUL). */
export function cleanThaiName(s: string | null | undefined): string | null {
  if (!s) return null;
  const t = s.trim();
  if (hasControl(t)) return null; // a NUL marks a Thai mark the PDF font lost: misspelled, so unusable
  const len = Array.from(t).length;
  if (len < 3 || len > 80 || isCombining(Array.from(t)[0] ?? '')) return null;
  return t;
}

// ---------------------------------------------------------------- PDF
//
// extractNativeText (pdfjs) returns each page as ONE line of text with a space between every glyph
// run, so Thai words arrive as "ห ลั ก สู ตร". pypdf kept real lines. Parsing therefore works on the
// flat token stream: Thai-to-Thai spaces are removed (Thai has none inside a word, and a lost mark
// is a NUL), every course code starts a segment, and a segment reads
//   <Thai name> <English name> <credits> [<next heading text>].
const CREDITS_RE = /(\d)\s*\(\d-\d-\d\)/;
const HEADING_SPLIT = /(?=\d+(?:\.\d+)*\)?\s|หมวด|กลุ่ม)/;
const NUMERICISH = /^\d+(?:\.\d+)*\)?$/;
const LATIN_RUN = /^[A-Za-z][A-Za-z0-9 ,.&'()/:+\-ﬀ-ﬆ]*/;

function despace(text: string): string {
  return text
    // eslint-disable-next-line no-control-regex
    .replace(/(?<=[\u0e00-\u0e7f\u0000]) +(?=[\u0e00-\u0e7f\u0000])/g, '')
    .replace(/\s+/g, ' ');
}

/** pdfjs splits Latin ligatures out of words ("Arti fi cial"); rejoin them. */
function joinLigatures(s: string): string {
  return s.replace(/([a-z]) (ffi|ffl|ff|fi|fl) (?=[a-z])/g, '$1$2').replace(/([a-z])(ffi|ffl|ff|fi|fl) ([a-z])/g, '$1$2$3');
}

/** Category set by heading text, or null. */
function headingCategory(piece: string): string | null {
  if (piece.includes('หมวดวิชาศึกษา')) return GE;
  if (piece.includes('เลือกเสรี')) return FREE;
  if (piece.includes('วิชาเฉพาะเลือก') || piece.includes('วิชาเลือก')) return ELEC;
  if (piece.includes('วิชาแกน')) return CORE;
  if (/วิทยานิพนธ์|โครงงาน|สหกิจ/.test(piece)) return THESIS;
  if (piece.includes('หมวดวิชา') || piece.includes('กลุ่มวิชา')) return REQ;
  return null;
}

/** The category after the last heading found in a stretch of text between two courses. */
function categoryAfter(tail: string, current: string): string {
  let cat = current;
  for (const piece of tail.split(HEADING_SPLIT)) {
    const h = headingCategory(piece);
    if (h) cat = h;
  }
  return cat;
}

export function parseCoursesFromText(raw: string): { courses: Course[]; lostMarks: number } {
  const text = despace(raw);
  const matches = [...text.matchAll(courseCodeRegex('g'))];
  const seen = new Map<string, Course>();
  let lostMarks = 0;
  // a heading before the first code (e.g. "1) หมวดวิชาศึกษาทั่วไป") sets the first category
  let category = categoryAfter(text.slice(0, matches[0]?.index ?? 0), REQ);
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const start = m.index ?? 0;
    const segEnd = i + 1 < matches.length ? (matches[i + 1]!.index ?? text.length) : text.length;
    let seg = text.slice(start + m[0].length, segEnd);
    const code = m[0].replace(/\s+/g, ' ').trim();
    if (seen.has(normaliseCourseCode(code))) continue; // 'MEE 364' and 'MEE364' are one course to the importer
    let credits: number | null = null;
    let tail = ''; // whatever follows this course's credits: the next heading, if there is one
    const cm = CREDITS_RE.exec(seg);
    if (cm) {
      credits = Number(cm[1]);
      tail = seg.slice(cm.index + cm[0].length);
      seg = seg.slice(0, cm.index);
    }
    // Thai name = before the first Latin letter; English name = the Latin run after it
    const latinAt = seg.search(/[A-Za-z]/);
    const thaiPart = (latinAt < 0 ? seg : seg.slice(0, latinAt)).replace(/\(.*$/, '').trim();
    let nameEn: string | null = null;
    if (latinAt >= 0) {
      const run = LATIN_RUN.exec(seg.slice(latinAt))?.[0] ?? '';
      const after = seg.slice(latinAt + run.length);
      const tokens = joinLigatures(run).trim().split(/\s+/).filter(Boolean);
      // table layout: the credit figure is the last lone digit after the English name, followed
      // at most by numbering of the next heading ("... Physics I 3 2.2)")
      let k = -1;
      if (credits === null) {
        for (let j = tokens.length - 1; j > 0; j--) {
          if (/^\d$/.test(tokens[j]!) && tokens.slice(j + 1).every((t) => NUMERICISH.test(t))) {
            k = j;
            break;
          }
        }
      }
      if (k > 0) {
        credits = Number(tokens[k]);
        tail = `${tokens.slice(k + 1).join(' ')} ${after}${tail}`;
        nameEn = tokens.slice(0, k).join(' ');
      } else {
        nameEn = tokens.join(' ');
        tail = `${after}${tail}`;
      }
      if (!nameEn || hasControl(nameEn)) nameEn = null;
      else if (cm) nameEn = nameEn.replace(/\(.*$/, '').trim() || null;
    }
    const hasThai = THAI_CHAR.test(thaiPart);
    const nameTh = hasThai ? cleanThaiName(thaiPart) : null;
    if (hasThai && nameTh === null && hasControl(thaiPart)) lostMarks++;
    seen.set(normaliseCourseCode(code), { code, nameTh, nameEn, credits: credits ?? 3, category });
    category = categoryAfter(tail, category);
  }
  return { courses: [...seen.values()], lostMarks };
}

/** Read course codes from a curriculum PDF. Never throws on a bad PDF. */
export async function coursesFromPdf(pdf: string): Promise<{ courses: Course[]; note: string }> {
  const base = path.basename(pdf);
  const empty = { courses: [] as Course[], note: `no course codes found in ${base}; using an invented list` };
  let text: string;
  try {
    const result = await extractNativeText(fs.readFileSync(pdf));
    text = result.pages.map((p) => p.textContent ?? '').join(' ');
  } catch {
    return empty; // unreadable, encrypted, not a PDF, missing
  }
  const { courses, lostMarks } = parseCoursesFromText(text);
  if (courses.length === 0) return empty;
  let note = `${courses.length} course codes read from ${base}`;
  if (lostMarks) {
    note +=
      `; ${lostMarks} Thai course names were left blank because they did not survive ` +
      'PDF extraction (a font mark was lost)';
  }
  return { courses, note };
}

// ---------------------------------------------------------------- CSV

/** RFC 4180 reader: quoted fields, doubled quotes, CRLF. Returns rows of cells. */
function parseCsv(textIn: string): string[][] {
  const text = textIn.replace(/^\ufeff/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      rows.push(row);
      row = [];
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function cleanCsvName(v: string | undefined): string | null {
  const s = (v ?? '').trim();
  return s === '' || hasControl(s) ? null : s;
}

export function coursesFromCsv(file: string): Course[] {
  const rows = parseCsv(fs.readFileSync(file, 'utf-8'));
  const header = (rows[0] ?? []).map((h) => h.trim());
  const col = (name: string): number => header.indexOf(name);
  const byLabel = new Map(CATEGORIES.map((c) => [c.toLowerCase(), c]));
  const out: Course[] = [];
  const seen = new Set<string>();
  for (const r of rows.slice(1)) {
    const get = (name: string): string | undefined => (col(name) >= 0 ? r[col(name)] : undefined);
    const code = (get('code') ?? '').trim();
    if (!code || seen.has(normaliseCourseCode(code))) continue;
    seen.add(normaliseCourseCode(code));
    const n = Number((get('credits') ?? '').trim());
    const credits = (get('credits') ?? '').trim() !== '' && Number.isFinite(n) ? Math.trunc(n) : 3;
    out.push({
      code,
      nameTh: cleanCsvName(get('name_th')),
      nameEn: cleanCsvName(get('name_en')),
      credits,
      category: byLabel.get((get('category') ?? '').trim().toLowerCase()) ?? REQ,
    });
  }
  return out;
}

// ---------------------------------------------------------------- invented

const STOP = new Set(['department', 'of', 'and', 'the', 'faculty', 'school', 'in', 'for']);
const GEN_COURSES: ReadonlyArray<readonly [string, string]> = [
  ['GEN 101', 'Communication in English'],
  ['GEN 102', 'Thai Language for Communication'],
  ['GEN 111', 'Citizenship and Society'],
  ['GEN 121', 'Digital Literacy'],
];

/** 3 uppercase letters from the department name. Never starts with GE or LI: the app's overlap
 * method (isGeneralEducationCode) reads those as general education. */
function prefixOf(departmentNameEn: string): string {
  const words = departmentNameEn.split(/[^A-Za-z0-9]+/).filter((w) => w && !STOP.has(w.toLowerCase()));
  const letters = words.filter((w) => /^[A-Za-z]+$/.test(w));
  let src = letters.length ? letters[0]! : words.join('').replace(/[^A-Za-z]/g, '');
  src = src.toUpperCase().replace(/[^A-Z]/g, '');
  while (src.startsWith('GE') || src.startsWith('LI')) src = src.slice(1); // Geology -> EOL
  const p = `${src}XXX`.slice(0, 3);
  return p.startsWith('GE') || p.startsWith('LI') ? 'XXX' : p;
}

const range = (lo: number, hi: number): number[] => Array.from({ length: hi - lo }, (_, i) => lo + i);

/** Invent a plausible course list. `departmentNameEn` is the English name of the programme's department. */
export function inventedCourses(programme: Programme, rng: Rng, departmentNameEn: string): Course[] {
  const prefix = prefixOf(departmentNameEn);
  const bachelor = programme.level === 'BACHELOR';
  const gen: Course[] = bachelor ? GEN_COURSES.map(([c, n]) => ({ code: c, nameTh: null, nameEn: n, credits: 3, category: GE })) : [];
  const nMajor = Math.max(8, Math.round(programme.credits / 3) - gen.length);
  const years = bachelor ? [1, 2, 3, 4] : [5, 6];
  const perYear = years.map((_, k) => Math.floor(nMajor / years.length) + (k < nMajor % years.length ? 1 : 0));
  const courses: Course[] = [];
  years.forEach((y, k) => {
    const picks = rng.shuffle(range(1, 60)).slice(0, perYear[k]!).sort((a, b) => a - b);
    for (const nn of picks) courses.push({ code: `${prefix} ${y}${String(nn).padStart(2, '0')}`, nameTh: null, nameEn: null, credits: 3, category: REQ });
  });
  // categories: first ~25 % core, then required; last years carry electives, last two are project
  const n = courses.length;
  const nCore = Math.round(n * 0.25);
  const nElec = Math.round(n * 0.25);
  courses.forEach((c, k) => {
    if (k < nCore) c.category = CORE;
    else if (k >= n - 2) c.category = THESIS;
    else if (k >= n - 2 - nElec) c.category = ELEC;
  });
  if (bachelor) {
    courses[n - 3 - nElec]!.category = FREE;
    courses[n - 4 - nElec]!.category = FREE;
  }
  courses.forEach((c, k) => {
    c.nameEn = `${prefix} Topic ${k + 1}`;
  });
  // tune credits so the total lands within a credit or two of the programme total
  const diff = programme.credits - [...gen, ...courses].reduce((a, c) => a + c.credits, 0);
  const step = diff > 0 ? 1 : -1;
  const idx = courses.flatMap((c, k) => (c.category !== THESIS ? [k] : []));
  for (let k = 0; k < Math.abs(diff); k++) courses[idx[(k * 7) % idx.length]!]!.credits += step;
  return [...gen, ...courses];
}

/** The sibling's list with 6-10 of the anchor's major courses substituted in (same code and name). */
export function shareWithSibling(anchorCourses: readonly Course[], siblingCourses: readonly Course[], rng: Rng): Course[] {
  const anchorMajor = anchorCourses.filter((c) => !NOT_MAJOR.includes(c.category));
  const sibMajorIdx = siblingCourses.flatMap((c, i) => (!NOT_MAJOR.includes(c.category) ? [i] : []));
  const k = Math.min(rng.int(6, 10), anchorMajor.length, sibMajorIdx.length);
  const chosen = rng.shuffle(anchorMajor).slice(0, k);
  const slots = new Set(rng.shuffle(sibMajorIdx).slice(0, k));
  const out: Course[] = [];
  const shared = new Set<Course>();
  const queue = [...chosen];
  siblingCourses.forEach((c, i) => {
    if (slots.has(i)) {
      const copy = { ...queue.pop()! };
      out.push(copy);
      shared.add(copy);
    } else out.push({ ...c });
  });
  // an unshared sibling course must not reuse a code the anchor already uses (compared the way the importer does)
  const n = normaliseCourseCode;
  const anchorCodes = new Set(anchorCourses.map((c) => n(c.code)));
  const used = new Set([...out.filter((c) => shared.has(c)).map((c) => n(c.code)), ...out.filter((c) => !anchorCodes.has(n(c.code))).map((c) => n(c.code))]);
  for (const c of out) {
    if (shared.has(c) || c.category === GE || !anchorCodes.has(n(c.code))) continue;
    const m = /^([A-Z]+) (\d)/.exec(c.code);
    const [pre, yr] = m ? [m[1]!, m[2]!] : ['XXX', '1'];
    for (let nn = 99; nn > 0; nn--) {
      const cand = `${pre} ${yr}${String(nn).padStart(2, '0')}`;
      if (!used.has(n(cand)) && !anchorCodes.has(n(cand))) {
        c.code = cand;
        used.add(n(cand));
        break;
      }
    }
  }
  return out;
}
