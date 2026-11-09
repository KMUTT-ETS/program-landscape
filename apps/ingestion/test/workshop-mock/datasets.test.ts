import path from 'node:path';
import { getImportDataset, validateSheet, type ImportDataset, type ParsedSheet } from '@kku/db';
import { beforeAll, describe, expect, it } from 'vitest';
import { inventedCourses } from '../../src/scripts/workshop-mock/courses';
import { UPLOAD_ORDER, buildRows, sheetInfo, type World } from '../../src/scripts/workshop-mock/datasets';
import { resolveAnchors, type Inputs, type ProgrammeInput } from '../../src/scripts/workshop-mock/inputs';
import { makePublications, makeStaff } from '../../src/scripts/workshop-mock/people';
import { makeRng } from '../../src/scripts/workshop-mock/rng';
import { chooseSlice, type SliceSize } from '../../src/scripts/workshop-mock/slice';
import { loadRows, ownRows } from '../../src/scripts/workshop-mock/tcas';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'workshop-mock', 'tcas-sample.xlsx');
const KMUTT = 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี';
const TODAY = new Date(Date.UTC(2026, 10, 7));
type Row = Record<string, string | number | boolean | null>;

function prog(name: string, extra: Partial<ProgrammeInput> = {}): ProgrammeInput {
  return { name, pdf: null, level: 'BACHELOR', faculty: '', tcasCode: null, courses: null, nameEn: null, ...extra };
}

async function makeWorld(seed = 7, runSeed = 0, size: SliceSize = 'medium'): Promise<World> {
  const rows = await loadRows('/nonexistent', { offline: true, files: [{ path: FIXTURE, entryYearBE: 2567, round: '3' }] });
  const own = ownRows(rows, KMUTT);
  const pairs = [...new Set(own.map((r) => `${r.faculty}\u0001${r.programme}`))].sort().map((k) => k.split('\u0001') as [string, string]);
  const [fac, name] = pairs[0]!;
  const inputs: Inputs = {
    university: KMUTT, region: 'Central',
    programmes: [
      prog(name, { faculty: fac }),
      prog(pairs[1]![1], { faculty: pairs[1]![0] }),
      prog('วิศวกรรมเครื่องกล', { level: 'MASTER', faculty: fac }),
    ],
  };
  const anchors = resolveAnchors(inputs, own);
  const slice = chooseSlice(anchors, own, size, makeRng(seed));
  const victim = slice.programmes.find((p) => p.level === 'BACHELOR' && !p.isAnchor)!;
  const y0 = [...victim.tcas.keys()][0]!;
  const t0 = victim.tcas.get(y0)!;
  victim.tcas.set(y0, { quota: t0.quota, applicants: t0.applicants, admitted: null });
  const { staff, links } = makeStaff(slice, makeRng(seed));
  const publications = makePublications(slice, staff, links, makeRng(seed), TODAY);
  const dept = new Map(slice.departments.map((d) => [d.code, d.nameEn]));
  const courses = new Map(slice.programmes.map((p) => [p.code, inventedCourses(p, makeRng(p.code), dept.get(p.departmentCode)!)]));
  return { slice, staff, links, publications, courses, region: 'Central', seed: runSeed, cache: new Map() };
}

describe('datasets', () => {
  let w: World;
  let rows: Record<string, Row[]>;
  beforeAll(async () => {
    w = await makeWorld();
    rows = Object.fromEntries(UPLOAD_ORDER.map((s) => [s, buildRows(s, w) as Row[]]));
  });
  const camp = () => rows['admission-campaigns']!;

  it('twenty sheets, each a registered dataset', () => {
    expect(UPLOAD_ORDER).toHaveLength(20);
    for (const slug of UPLOAD_ORDER) expect(getImportDataset(slug).slug).toBe(slug);
    expect(sheetInfo('faculties').sheetName).toBe(getImportDataset('faculties').sheetName);
  });

  it('keys equal the declaration headers', () => {
    for (const slug of UPLOAD_ORDER) {
      const headers = getImportDataset(slug).columns.map((c) => c.header);
      expect(rows[slug]!.length, slug).toBeGreaterThan(0);
      for (const r of rows[slug]!) expect(Object.keys(r), slug).toEqual(headers);
    }
  });

  it('is deterministic and cached on the world', () => {
    for (const slug of UPLOAD_ORDER) expect(buildRows(slug, w)).toEqual(rows[slug]);
    expect(w.cache.has('plan')).toBe(true);
  });

  it('round 3 equals the public TCAS figures', () => {
    let checked = 0;
    for (const p of w.slice.programmes) {
      if (p.level !== 'BACHELOR') continue;
      for (const [y, t] of p.tcas) {
        if (!w.slice.yearsCE.includes(y)) continue;
        const r = camp().filter((c) => c['Programme Code'] === p.code && c['Round'] === 'Round 3 — Admission' && c['Academic Year'] === y);
        expect(r).toHaveLength(1);
        expect([r[0]!['Planned Seats'], r[0]!['Total Applicants'], r[0]!['Total Passed']]).toEqual([t.quota, t.applicants, t.admitted]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3);
  });

  it('uncovered years scale from the nearest covered year', () => {
    const years = w.slice.yearsCE;
    const p = w.slice.programmes.find((x) => x.level === 'BACHELOR' && (x.tcas.get(2024)?.quota ?? 0) >= 10)!;
    expect([...p.tcas.keys()].filter((y) => years.includes(y)).length).toBeLessThan(years.length);
    for (const y of years) {
      if (p.tcas.has(y)) continue;
      const r = camp().find((c) => c['Programme Code'] === p.code && c['Round'] === 'Round 3 — Admission' && c['Academic Year'] === y)!;
      const ny = [...p.tcas.keys()].sort((a, b) => Math.abs(a - y) - Math.abs(b - y) || b - a)[0]!;
      const n = p.tcas.get(ny)!;
      expect(r['Planned Seats']).toBe(n.quota);
      const want = n.applicants;
      expect(Math.abs((r['Total Applicants'] as number) - want)).toBeLessThanOrEqual(0.1 * want + 1);
    }
  });

  it('a blank pass count stays blank', async () => {
    let found = false;
    for (const p of w.slice.programmes) {
      for (const [y, t] of p.tcas) {
        if (t.admitted !== null || !w.slice.yearsCE.includes(y)) continue;
        found = true;
        const r = camp().find((c) => c['Programme Code'] === p.code && c['Round'] === 'Round 3 — Admission' && c['Academic Year'] === y)!;
        expect(r['Total Passed']).toBeNull();
        expect(r['Reported']).not.toBeNull();
      }
    }
    expect(found).toBe(true);
  });

  it('older alumni cohorts are not before the programme was established', async () => {
    const by = new Map(w.slice.programmes.map((p) => [p.code, p]));
    for (const r of rows['alumni-cohorts']!) expect(r['Entry Year'] as number).toBeGreaterThanOrEqual(by.get(r['Programme Code'] as string)!.yearEstablished);
    const late = await makeWorld();
    for (const p of late.slice.programmes) p.yearEstablished = Math.min(...late.slice.yearsCE) - 1;
    const r2 = buildRows('alumni-cohorts', late) as Row[];
    const first = Math.min(...late.slice.yearsCE);
    expect(r2.every((r) => (r['Entry Year'] as number) >= first - 1)).toBe(true);
    expect(r2.some((r) => r['Entry Year'] === first - 1)).toBe(true);
  });

  it('the run seed changes the figures but is stable', async () => {
    const a = buildRows('enrollment-metrics', await makeWorld(7, 1));
    const b = buildRows('enrollment-metrics', await makeWorld(7, 1));
    const c = buildRows('enrollment-metrics', await makeWorld(7, 2));
    expect(a).toEqual(b);
    expect(a).not.toEqual(c);
  });

  it('campaign funnel, round share and "mock" in free text', () => {
    const by = new Map<string, Row[]>();
    for (const r of camp()) {
      expect(String(r['Campaign Name']).endsWith(', mock')).toBe(true);
      expect(r['Reported'] as number).toBeLessThanOrEqual(r['Confirmed'] as number);
      if (r['Total Passed'] !== null) expect(r['Confirmed'] as number).toBeLessThanOrEqual(r['Total Passed'] as number);
      const k = `${r['Programme Code']}|${r['Academic Year']}`;
      by.set(k, [...(by.get(k) ?? []), r]);
    }
    const lvl = new Map(w.slice.programmes.map((p) => [p.code, p.level]));
    for (const [k, rs] of by) {
      if (lvl.get(k.split('|')[0]!) === 'BACHELOR') {
        const r3 = rs.find((r) => r['Round'] === 'Round 3 — Admission')!;
        const total = rs.reduce((a, r) => a + (r['Planned Seats'] as number), 0);
        if (total) {
          expect(r3['Planned Seats'] as number / total).toBeGreaterThanOrEqual(0.29);
          expect(r3['Planned Seats'] as number / total).toBeLessThanOrEqual(0.46);
        }
        expect(rs).toHaveLength(4);
      } else expect(rs.map((r) => r['Round'])).toEqual(['Direct Admission']);
    }
  });

  it('enrolment follows campaigns; alumni sum to enrolment; cohorts never exceed it', () => {
    const cm = new Map<string, Row[]>();
    for (const r of camp()) {
      const k = `${r['Programme Code']}|${r['Academic Year']}`;
      cm.set(k, [...(cm.get(k) ?? []), r]);
    }
    const enrol = new Map<string, Row>();
    for (const r of rows['enrollment-metrics']!) {
      const k = `${r['Programme Code']}|${r['Academic Year']}`;
      enrol.set(k, r);
      expect(r['Enrolled']).toBe(cm.get(k)!.reduce((a, c) => a + (c['Reported'] as number), 0));
      expect(r['Enrolled'] as number).toBeLessThanOrEqual(r['Admitted'] as number);
      expect(r['Admitted'] as number).toBeLessThanOrEqual(r['Applications'] as number);
      const parts = ['Graduated on Time', 'Graduated Late', 'Dropouts'].reduce((a, h) => a + ((r[h] as number | null) ?? 0), 0);
      expect(parts).toBeLessThanOrEqual(r['Enrolled'] as number);
      expect((r['Retained to Year 2'] as number | null) ?? 0).toBeLessThanOrEqual(r['Enrolled'] as number);
    }
    const sums = new Map<string, number>();
    for (const r of rows['alumni-cohorts']!) {
      const k = `${r['Programme Code']}|${r['Entry Year']}`;
      sums.set(k, (sums.get(k) ?? 0) + (r['Count'] as number));
    }
    let hit = 0;
    for (const [k, v] of sums) if (enrol.has(k)) { hit++; expect(v, k).toBe(enrol.get(k)!['Enrolled']); }
    expect(hit).toBeGreaterThan(0);
    for (const r of rows['student-cohorts']!) {
      expect(r['Students Still Enrolled'] as number).toBeLessThanOrEqual(enrol.get(`${r['Programme Code']}|${r['Entry Year']}`)!['Enrolled'] as number);
    }
  });

  it('years are Common Era', () => {
    for (const slug of UPLOAD_ORDER)
      for (const r of rows[slug]!)
        for (const [h, v] of Object.entries(r))
          if (h.includes('Year') && typeof v === 'number' && h !== 'Year Established' && h !== 'Curriculum Year') expect(v, `${slug} ${h}`).toBeLessThan(2200);
  });

  it('every groupSizeFor value is at least 8', () => {
    for (const slug of UPLOAD_ORDER) {
      const ds = getImportDataset(slug);
      for (const c of ds.columns.filter((x) => x.groupSizeFor)) {
        for (const r of rows[slug]!) {
          const v = r[c.header];
          if (v !== null) expect(v as number, `${slug} ${c.header}`).toBeGreaterThanOrEqual(8);
        }
      }
    }
    for (const r of rows['graduate-outcomes']!) {
      expect(r['Sample Size'] as number).toBeGreaterThanOrEqual(8);
      expect(r['Sample Size'] as number).toBeLessThanOrEqual(60);
      expect(r['Survey Year']).toBe((r['Graduation Year'] as number) + 1);
      for (const h of ['Employment Rate', 'Job Relevance Score', 'Further Study Rate']) {
        expect(r[h] as number).toBeGreaterThanOrEqual(0);
        expect(r[h] as number).toBeLessThanOrEqual(1);
      }
    }
    for (const r of rows['employer-feedback']!) expect(String(r['Employer'])).toMatch(/^Mock employer \d+$/);
    expect(new Set(rows['graduate-outcomes']!.map((r) => r['Graduation Year']))).not.toContain(w.slice.yearsCE.at(-1));
  });

  it('digital competency covers bachelor programmes only and is consistent', () => {
    const lvl = new Map(w.slice.programmes.map((p) => [p.code, p.level]));
    for (const r of rows['digital-competency-cohorts']!) {
      expect(lvl.get(r['Programme Code'] as string)).toBe('BACHELOR');
      expect(r['Students With Scores'] as number).toBeLessThanOrEqual(r['Students Tested'] as number);
      expect(r['Students Passing All Modules'] as number).toBeLessThanOrEqual(r['Students With Scores'] as number);
    }
    for (const r of rows['digital-competency-modules']!) {
      expect(lvl.get(r['Programme Code'] as string)).toBe('BACHELOR');
      expect(r['Students Taking'] as number).toBeLessThanOrEqual(r['Students In Scope'] as number);
    }
  });

  it('course evaluations use the programmes course lists, one row per key', () => {
    const anchor = w.slice.programmes.find((p) => p.isAnchor)!;
    const codes = new Set(w.courses.get(anchor.code)!.map((c) => c.code));
    const got = new Set(rows['course-evaluations']!.map((r) => r['Course Code'] as string));
    expect([...got].some((c) => codes.has(c))).toBe(true);
    const keys = rows['course-evaluations']!.map((r) => `${r['Academic Year']}|${r['Semester']}|${String(r['Course Code']).replace(/\s+/g, '').toUpperCase()}|${r['Section']}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('population, skills, labels and ids', () => {
    const pop = rows['population-projections']!;
    expect(new Set(pop.map((r) => r['Region']))).toEqual(new Set(['Central', 'TH']));
    expect(pop.every((r) => String(r['Source Name']).includes('Workshop mock data'))).toBe(true);
    const sk = rows['career-skill-demand']!;
    const groups = new Set(sk.map((r) => r['Career Group']));
    expect(groups.size).toBe(3);
    for (const g of groups) expect(sk.filter((r) => r['Career Group'] === g)).toHaveLength(8);
    for (const r of rows['faculty-budgets']!) expect(String(r['Division Name']).endsWith(' (mock)')).toBe(true);
    for (const slug of UPLOAD_ORDER)
      for (const r of rows[slug]!)
        for (const [h, v] of Object.entries(r)) if (typeof v === 'number' && v >= 1e12 && v < 1e13) throw new Error(`13-digit integer in ${slug}/${h}`);
    expect(new Set(rows['programme-courses']!.map((r) => r['Programme Code']))).toEqual(new Set(w.courses.keys()));
    expect(rows['faculty-members']).toHaveLength(w.staff.length);
    expect(rows['program-faculty']).toHaveLength(w.links.length);
    expect(rows['research-outputs']).toHaveLength(w.publications.length);
  });

  it('English programme names never contain Thai', () => {
    for (const r of rows['programmes']!) expect(String(r['Name (English)'])).not.toMatch(/[฀-๿]/);
  });
});

describe('every sheet passes the importer validator', () => {
  it('on a medium slice, with references built from the earlier sheets', async () => {
    const w = await makeWorld(7, 3, 'medium');
    const references = new Map<string, Set<string>>();
    for (const slug of UPLOAD_ORDER) {
      const dataset: ImportDataset = getImportDataset(slug);
      const built = buildRows(slug, w) as Row[];
      const parsed: ParsedSheet = { sheetName: dataset.sheetName, headers: dataset.columns.map((c) => c.header), rows: built };
      const result = validateSheet(dataset, parsed, { references, heldRowCount: 0, allowShrink: false, maxRows: 5000 });
      if (!result.ok) throw new Error(`${slug}: ${JSON.stringify(result.errors.slice(0, 5), null, 2)}`);
      expect(result.rows.length, slug).toBe(built.length);
      // later sheets reference columns of this one
      for (const later of UPLOAD_ORDER) {
        for (const col of getImportDataset(later).columns) {
          if (col.references?.dataset !== slug) continue;
          const header = dataset.columns.find((c) => c.key === col.references!.column)!.header;
          references.set(slug, new Set([...(references.get(slug) ?? []), ...built.map((x) => String(x[header]))]));
        }
      }
    }
  });
});
