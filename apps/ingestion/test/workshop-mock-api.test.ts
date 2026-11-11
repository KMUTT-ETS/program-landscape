import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import { getImportDataset, type ImportRow } from '@kku/db';
import * as XLSX from 'xlsx';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildRoutes,
  loadMockSource,
  type MockSource,
} from '../src/scripts/workshop-mock-api/routes';

const TOKEN = 'test-token';
const PROGRAMMES = ['P-A', 'P-B', 'P-C'];

function section(i: number, year: number, semester: number): ImportRow {
  return {
    academicYear: year,
    semester,
    facultyCode: 'F1',
    levelName: 'Bachelor',
    courseCode: `C${i}`,
    section: 1 + (i % 3),
    classId: 1000 + i,
    courseNameTh: `วิชา ${i}`,
    courseNameEn: `Course ${i}`,
    creditTotal: 3,
    lectureHrsPerWeek: 2,
    labHrsPerWeek: 1,
    enrollSeat: i % 7,
    totalSeat: 40,
  };
}

const source: MockSource = {
  // 120 sections in 2025 (BE 2568) semester 1, three more in semester 2
  classOfferings: [
    ...Array.from({ length: 120 }, (_, i) => section(i, 2025, 1)),
    ...Array.from({ length: 3 }, (_, i) => section(200 + i, 2025, 2)),
  ],
  enrollment: PROGRAMMES.flatMap((p) =>
    [2024, 2025].map((y) => ({
      programmeCode: p,
      academicYear: y,
      applications: 100,
      admitted: 60,
      enrolled: 50,
      retainedYear2: 45,
      graduatedOnTime: 30,
      graduatedLate: 5,
      dropouts: 3,
    })),
  ),
};

let server: http.Server;
let base = '';

beforeAll(async () => {
  server = http.createServer(buildRoutes(source, TOKEN));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const get = (p: string, token: string | null = TOKEN) =>
  fetch(`${base}${p}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

async function all(
  path: string,
  limit?: number,
): Promise<{ rows: Array<Record<string, unknown>>; pages: number }> {
  const rows: Array<Record<string, unknown>> = [];
  let cursor: string | null = null;
  let pages = 0;
  do {
    const q = new URLSearchParams();
    if (limit) q.set('limit', String(limit));
    if (cursor) q.set('cursor', cursor);
    const body = (await (await get(`${path}?${q}`)).json()) as {
      data: Array<Record<string, unknown>>;
      next_cursor: string | null;
    };
    rows.push(...body.data);
    cursor = body.next_cursor;
    pages++;
  } while (cursor);
  return { rows, pages };
}

describe('workshop mock API', () => {
  it('401 without the bearer token', async () => {
    for (const token of [null, 'wrong']) {
      const res = await get('/terms', token);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'unauthorized' });
    }
  });

  it('sections paginate with next_cursor until null and cover every class-offerings row', async () => {
    const { rows, pages } = await all('/terms/2568/1/sections', 50);
    expect(pages).toBe(3);
    expect(rows).toHaveLength(120);
    expect(new Set(rows.map((r) => (r.subject as { code: string }).code)).size).toBe(120);
    expect(rows[0]).toMatchObject({
      faculty_code: 'F1',
      hours: { lecture: 2, lab: 1 },
      seats: { capacity: 40 },
    });
    const first = (await (await get('/terms/2568/1/sections?limit=50')).json()) as {
      next_cursor: string;
    };
    expect(first.next_cursor).not.toMatch(/^\d+$/);
  });

  it('rejects a bad limit and serves the default and maximum', async () => {
    expect((await get('/terms/2568/1/sections?limit=0')).status).toBe(400);
    expect((await get('/terms/2568/1/sections?limit=201')).status).toBe(400);
    expect((await get('/terms/2568/1/sections?limit=abc')).status).toBe(400);
    expect((await get('/terms/2568/1/sections?cursor=nope')).status).toBe(400);
    const def = (await (await get('/terms/2568/1/sections')).json()) as { data: unknown[] };
    expect(def.data).toHaveLength(50);
    const max = (await (await get('/terms/2568/1/sections?limit=200')).json()) as {
      data: unknown[];
      next_cursor: null;
    };
    expect(max.data).toHaveLength(120);
    expect(max.next_cursor).toBeNull();
  });

  it('years are served in the Buddhist era', async () => {
    const terms = (await (await get('/terms')).json()) as { data: unknown };
    expect(terms.data).toEqual([
      { year_be: 2568, semester: 1 },
      { year_be: 2568, semester: 2 },
    ]);
    const intake = (await (await get('/programmes/P-A/intake')).json()) as {
      data: Array<{ year_be: number; applied: number }>;
    };
    expect(intake.data.map((d) => d.year_be)).toEqual([2567, 2568]);
    expect(intake.data[0]).toMatchObject({ applied: 100, admitted: 60, enrolled: 50 });
    expect((await get('/programmes/NOPE/intake')).status).toBe(404);
  });

  it("enrolments per section sum to the section's enrolled count", async () => {
    const { rows } = await all('/terms/2568/1/enrolments', 200);
    const counts = new Map<string, number>();
    for (const r of rows) {
      const k = `${r.subject_code}#${r.section_no}`;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    for (let i = 0; i < 120; i++) {
      expect(counts.get(`C${i}#${1 + (i % 3)}`) ?? 0).toBe(i % 7);
    }
    expect(rows.every((r) => /^S-\d+$/.test(String(r.student_ref)))).toBe(true);
    expect(new Set(rows.map((r) => r.student_ref)).size).toBe(rows.length);
  });

  it('answers 404 for unknown paths and terms', async () => {
    expect((await get('/nothing')).status).toBe(404);
    expect((await get('/terms/2500/1/sections')).status).toBe(404);
  });
});

describe('loadMockSource without a class-offerings workbook', () => {
  const tmp = path.join(
    '/tmp/claude-1000/-home-chun-git-repos-program-landscape/9edeb45d-df10-4874-8257-05e44ff7f6f7/scratchpad',
    'mock-api-synth',
  );

  function write(file: string, slug: string, rows: Array<Record<string, string | number>>): void {
    const d = getImportDataset(slug);
    const h = (k: string): string => d.columns.find((c) => c.key === k)?.header as string;
    const mapped = rows.map((r) =>
      Object.fromEntries(Object.entries(r).map(([k, v]) => [h(k), v])),
    );
    const ws = XLSX.utils.json_to_sheet(mapped);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, d.sheetName);
    XLSX.writeFile(wb, path.join(tmp, file));
  }

  beforeAll(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    fs.mkdirSync(tmp, { recursive: true });
    write('01-faculties.xlsx', 'faculties', [{ code: 'F1', nameTh: 'คณะ', nameEn: 'Faculty' }]);
    write('03-programmes.xlsx', 'programmes', [
      { code: 'P-A', nameTh: 'หลักสูตร', nameEn: 'Prog', facultyCode: 'F1', level: 'Bachelor' },
    ]);
    write('04-enrollment-metrics.xlsx', 'enrollment-metrics', [
      { programmeCode: 'P-A', academicYear: 2023, applications: 10, admitted: 8, enrolled: 6 },
      { programmeCode: 'P-A', academicYear: 2024, applications: 10, admitted: 8, enrolled: 6 },
    ]);
    write('13-programme-courses.xlsx', 'programme-courses', [
      {
        programmeCode: 'P-A',
        courseCode: 'X101',
        courseNameTh: 'ก',
        courseNameEn: 'Alpha',
        credits: 3,
        category: 'Core',
      },
      {
        programmeCode: 'P-A',
        courseCode: 'X102',
        courseNameTh: 'ข',
        courseNameEn: 'Beta',
        credits: 2,
        category: 'Core',
      },
    ]);
  });
  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

  it('loadMockSource synthesizes sections from programme-courses when no class-offerings workbook exists', async () => {
    const src = await loadMockSource(tmp);
    expect(src.classOfferingsOrigin).toBe('synthesized');
    expect(src.classOfferings).toHaveLength(4);
    expect(src.classOfferings.every((r) => r.academicYear === 2024 && r.facultyCode === 'F1')).toBe(
      true,
    );
    expect(src.classOfferings.map((r) => r.semester).sort()).toEqual([1, 1, 2, 2]);
    expect(
      src.classOfferings.every(
        (r) => Number(r.enrollSeat) >= 0 && Number(r.enrollSeat) <= Number(r.totalSeat),
      ),
    ).toBe(true);
    expect(src.classOfferings.find((r) => r.courseCode === 'X102')?.creditTotal).toBe(2);
  });

  it('synthesis is deterministic', async () => {
    expect((await loadMockSource(tmp)).classOfferings).toEqual(
      (await loadMockSource(tmp)).classOfferings,
    );
  });

  it('fails clearly when neither workbook exists', async () => {
    const empty = path.join(tmp, 'empty');
    fs.mkdirSync(empty);
    fs.copyFileSync(
      path.join(tmp, '04-enrollment-metrics.xlsx'),
      path.join(empty, '04-enrollment-metrics.xlsx'),
    );
    await expect(loadMockSource(empty)).rejects.toThrow(/class-offerings.*programme-courses/);
  });
});
