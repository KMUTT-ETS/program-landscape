// A pretend registrar API for workshop session 4. It serves a `pnpm workshop:mock` folder in a shape
// that is deliberately NOT the import template: snake_case, nested objects, Buddhist-era years, a
// bearer token, opaque cursors, and a per-student endpoint that has to be aggregated.
import fs from 'node:fs';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import * as XLSX from 'xlsx';
import { getImportDataset, validateSheet, type ImportRow, type ParsedSheet } from '@kku/db';

export interface MockSource {
  classOfferings: readonly ImportRow[];
  enrollment: readonly ImportRow[];
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const BE_OFFSET = 543;

function findWorkbook(dir: string, slug: string): string {
  const hit = fs.readdirSync(dir).find((f) => f.endsWith(`-${slug}.xlsx`) && !f.startsWith('~$'));
  if (!hit)
    throw new Error(`No *-${slug}.xlsx in ${dir}. Is this a "pnpm workshop:mock" output folder?`);
  return path.join(dir, hit);
}

function readSheet(file: string, sheetName: string): ParsedSheet {
  const wb = XLSX.readFile(file);
  const ws = wb.Sheets[sheetName] ?? wb.Sheets[wb.SheetNames[0] as string];
  if (!ws) throw new Error(`${file} has no sheets`);
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, defval: null, raw: true });
  const headers = (aoa[0] ?? []).map((h) => String(h ?? ''));
  const rows = aoa
    .slice(1)
    .filter((cells) => cells.some((c) => c !== null && c !== ''))
    .map((cells) => Object.fromEntries(headers.map((h, i) => [h, cells[i] ?? null])));
  return { sheetName, headers, rows };
}

/** Reads and validates the two workbooks the API serves. No database involved. */
export async function loadMockSource(dir: string): Promise<MockSource> {
  const slugs = ['class-offerings', 'enrollment-metrics'] as const;
  const parsed = new Map<string, ParsedSheet>();
  for (const slug of slugs) {
    parsed.set(slug, readSheet(findWorkbook(dir, slug), getImportDataset(slug).sheetName));
  }
  // References (faculty codes, programme codes) come from the sibling workbooks in the same folder.
  const references = new Map<string, Set<string>>();
  for (const slug of slugs) {
    for (const col of getImportDataset(slug).columns) {
      const ref = col.references;
      if (!ref || references.has(ref.dataset)) continue;
      const target = getImportDataset(ref.dataset);
      const header = target.columns.find((c) => c.key === ref.column)?.header;
      if (!header) continue;
      const sheet = readSheet(findWorkbook(dir, ref.dataset), target.sheetName);
      references.set(ref.dataset, new Set(sheet.rows.map((r) => String(r[header] ?? ''))));
    }
  }
  const out: ImportRow[][] = [];
  for (const slug of slugs) {
    const result = validateSheet(getImportDataset(slug), parsed.get(slug) as ParsedSheet, {
      references,
      heldRowCount: 0,
      allowShrink: true,
      maxRows: 1_000_000,
    });
    if (!result.ok) {
      throw new Error(
        `${slug}: ${result.totalErrors} validation errors, first: ${JSON.stringify(result.errors[0])}`,
      );
    }
    out.push([...result.rows]);
  }
  return { classOfferings: out[0] as ImportRow[], enrollment: out[1] as ImportRow[] };
}

function num(v: unknown): number {
  return typeof v === 'number' ? v : 0;
}
function str(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

interface Section {
  yearBe: number;
  semester: number;
  facultyCode: string;
  level: string;
  code: string;
  nameTh: string;
  nameEn: string;
  credit: number;
  sectionNo: number;
  classId: number | null;
  lecture: number;
  lab: number;
  capacity: number;
  enrolled: number;
}

function toSection(r: ImportRow): Section {
  return {
    yearBe: num(r.academicYear) + BE_OFFSET,
    semester: num(r.semester),
    facultyCode: str(r.facultyCode),
    level: str(r.levelName),
    code: str(r.courseCode),
    nameTh: str(r.courseNameTh),
    nameEn: str(r.courseNameEn),
    credit: num(r.creditTotal),
    sectionNo: num(r.section),
    classId: typeof r.classId === 'number' ? r.classId : null,
    lecture: num(r.lectureHrsPerWeek),
    lab: num(r.labHrsPerWeek),
    capacity: num(r.totalSeat),
    enrolled: num(r.enrollSeat),
  };
}

const encodeCursor = (offset: number): string =>
  Buffer.from(`c1:${offset * 7919 + 13}`).toString('base64url');
function decodeCursor(c: string): number | null {
  const m = /^c1:(\d+)$/.exec(Buffer.from(c, 'base64url').toString('utf8'));
  if (!m) return null;
  const n = (Number(m[1]) - 13) / 7919;
  return Number.isInteger(n) && n >= 0 ? n : null;
}

function send(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

type Page = { error: string } | { start: number; limit: number };
function pageParams(url: URL): Page {
  const raw = url.searchParams.get('limit');
  let limit = DEFAULT_LIMIT;
  if (raw !== null) {
    if (!/^\d+$/.test(raw)) return { error: 'bad_request' };
    limit = Number(raw);
    if (limit < 1 || limit > MAX_LIMIT) return { error: 'bad_request' };
  }
  const cursor = url.searchParams.get('cursor');
  let start = 0;
  if (cursor) {
    const d = decodeCursor(cursor);
    if (d === null) return { error: 'bad_request' };
    start = d;
  }
  return { start, limit };
}

function paged<T>(res: ServerResponse, url: URL, items: readonly T[]): void {
  const p = pageParams(url);
  if ('error' in p) return send(res, 400, { error: p.error });
  const end = p.start + p.limit;
  send(res, 200, {
    data: items.slice(p.start, end),
    next_cursor: end < items.length ? encodeCursor(end) : null,
  });
}

export function buildRoutes(
  source: MockSource,
  token: string,
): (req: IncomingMessage, res: ServerResponse) => void {
  const sections = source.classOfferings.map(toSection);
  const termKey = (y: number, s: number): string => `${y}/${s}`;
  const terms = new Map<string, { year_be: number; semester: number }>();
  for (const s of sections)
    terms.set(termKey(s.yearBe, s.semester), { year_be: s.yearBe, semester: s.semester });
  const termList = [...terms.values()].sort(
    (a, b) => a.year_be - b.year_be || a.semester - b.semester,
  );

  /** Student references are numbered per term, in section order: the same input always gives the same ids. */
  const enrolments = (
    yearBe: number,
    semester: number,
  ): Array<{ student_ref: string; subject_code: string; section_no: number }> => {
    const out: Array<{ student_ref: string; subject_code: string; section_no: number }> = [];
    let n = 0;
    for (const s of sections) {
      if (s.yearBe !== yearBe || s.semester !== semester) continue;
      for (let i = 0; i < s.enrolled; i++) {
        n += 1;
        out.push({ student_ref: `S-${n}`, subject_code: s.code, section_no: s.sectionNo });
      }
    }
    return out;
  };

  return (req, res) => {
    const auth = req.headers.authorization ?? '';
    if (auth !== `Bearer ${token}`) return send(res, 401, { error: 'unauthorized' });
    if (req.method !== 'GET') return send(res, 405, { error: 'method_not_allowed' });
    const url = new URL(req.url ?? '/', 'http://localhost');
    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    if (parts[0] !== 'api' || parts[1] !== 'v1') return send(res, 404, { error: 'not_found' });
    const [, , a, b, c, d] = parts;

    if (a === 'terms' && parts.length === 3) return send(res, 200, { data: termList });

    if (a === 'terms' && parts.length === 6 && /^\d+$/.test(b ?? '') && /^\d+$/.test(c ?? '')) {
      const yearBe = Number(b);
      const semester = Number(c);
      if (!terms.has(termKey(yearBe, semester))) return send(res, 404, { error: 'not_found' });
      if (d === 'sections') {
        const items = sections
          .filter((s) => s.yearBe === yearBe && s.semester === semester)
          .map((s) => ({
            faculty_code: s.facultyCode,
            level: s.level,
            subject: { code: s.code, name_th: s.nameTh, name_en: s.nameEn, credit: s.credit },
            section_no: s.sectionNo,
            class_id: s.classId,
            hours: { lecture: s.lecture, lab: s.lab },
            seats: { capacity: s.capacity, enrolled: s.enrolled },
          }));
        return paged(res, url, items);
      }
      if (d === 'enrolments') return paged(res, url, enrolments(yearBe, semester));
    }

    if (a === 'programmes' && parts.length === 5 && c === 'intake' && b) {
      const rows = source.enrollment.filter((r) => str(r.programmeCode) === b);
      if (rows.length === 0) return send(res, 404, { error: 'not_found' });
      const data = rows
        .map((r) => ({
          year_be: num(r.academicYear) + BE_OFFSET,
          applied: num(r.applications),
          admitted: num(r.admitted),
          enrolled: num(r.enrolled),
          retained_year2: num(r.retainedYear2),
          graduated_on_time: num(r.graduatedOnTime),
          graduated_late: num(r.graduatedLate),
          dropouts: num(r.dropouts),
        }))
        .sort((x, y) => x.year_be - y.year_be);
      return send(res, 200, { data });
    }
    return send(res, 404, { error: 'not_found' });
  };
}
