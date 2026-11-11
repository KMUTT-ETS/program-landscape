import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ImportRow } from '@kku/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildRoutes, type MockSource } from '../src/scripts/workshop-mock-api/routes';

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
