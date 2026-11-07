// Rows for the 20 import sheets, consistent with the public TCAS figures.
//
// Every figure of a programme-year comes from one plan (`computePlan`) that is derived from the
// world alone, with string-seeded generators, so two sheets can never disagree and the result
// does not depend on anything but the world (and its `seed`).
import { getImportDataset } from '@kku/db';
import { FREE, GE, type Course } from './courses';
import { makeRng, type Rng } from './rng';
import type { Publication, RosterLink, Staff } from './people';
import type { Programme, Slice } from './slice';

export const UPLOAD_ORDER: readonly string[] = [
  'faculties', 'departments', 'programmes', 'faculty-members', 'program-faculty',
  'programme-courses', 'research-outputs', 'admission-campaigns', 'enrollment-metrics',
  'student-cohorts', 'alumni-cohorts', 'financial-metrics', 'faculty-budgets',
  'graduate-outcomes', 'employer-feedback', 'digital-competency-cohorts',
  'digital-competency-modules', 'course-evaluations', 'population-projections',
  'career-skill-demand',
];

/** Sheet name, title and header order, read from the app's own declaration. */
export function sheetInfo(slug: string): { sheetName: string; title: string; headers: string[] } {
  const d = getImportDataset(slug);
  return { sheetName: d.sheetName, title: d.title, headers: d.columns.map((c) => c.header) };
}

export interface World {
  slice: Slice;
  staff: Staff[];
  links: RosterLink[];
  publications: Publication[];
  /** programme code -> course list */
  courses: Map<string, Course[]>;
  region: string;
  /** The run's --seed; mixed into every figure. */
  seed: number;
  /** Memoised derived data (the plan), so every sheet reads the same numbers. */
  cache: Map<string, unknown>;
}

export type Cell = string | number | null;
export type Row = Record<string, Cell>;

const SOURCE_NAME = 'Workshop mock data — not an official projection';
const ROUND3 = 'Round 3 — Admission';
const FEE: Record<string, readonly [number, number]> = {
  BACHELOR: [40000, 60000], MASTER: [60000, 90000], DOCTORAL: [80000, 120000], HIGHER_GRAD_DIPLOMA: [50000, 70000],
};
const SKILLS = [
  'Python', 'Data analysis', 'Project management', 'Communication', 'Teamwork',
  'Problem solving', 'Critical thinking', 'SQL', 'Microsoft Excel', 'Research',
  'Technical writing', 'Leadership', 'Time management', 'Presentation skills',
  'Quality control', 'Customer service', 'English', 'Statistics', 'Machine learning',
  'Cloud computing', 'Software testing', 'Risk management', 'Budgeting', 'Negotiation',
];

const r = (seed: number, ...parts: Array<string | number>): Rng => makeRng([seed, ...parts].join('|'));
const round = Math.round;
const roundTo = (x: number, digits: number): number => Math.round(x * 10 ** digits) / 10 ** digits;
const roundK = (x: number): number => Math.round(x / 1000) * 1000;

function rowsOf(slug: string, items: Cell[][]): Row[] {
  const headers = sheetInfo(slug).headers;
  return items.map((it) => {
    if (it.length !== headers.length) throw new Error(`${slug}: row has ${it.length} cells, the declaration has ${headers.length} columns`);
    return Object.fromEntries(headers.map((h, i) => [h, it[i] as Cell]));
  });
}

// ------------------------------------------------------------------ plan

interface Camp {
  round: string;
  seats: number;
  applicants: number;
  passed: number | null; // as published; null = blank cell
  notional: number; // passed, or an estimate when blank
  confirmed: number;
  reported: number;
}

function funnel(rng: Rng, seats: number, applicants: number, passed: number | null): Camp {
  const notional = passed ?? Math.min(applicants, round(seats * rng.uniform(1.0, 1.15)));
  const confirmed = round(notional * rng.uniform(0.75, 0.95));
  const reported = round(confirmed * rng.uniform(0.85, 0.97));
  return { round: '', seats, applicants, passed, notional, confirmed, reported };
}

/** The covered year nearest to `year` (ties: the later). */
function nearestYear(years: Iterable<number>, year: number): number {
  return [...years].sort((a, b) => Math.abs(a - year) - Math.abs(b - year) || b - a)[0]!;
}

function campaigns(seed: number, p: Programme, year: number): Camp[] {
  const rng = r(seed, 'camp', p.code, year);
  if (p.level !== 'BACHELOR') {
    const seats = rng.int(12, 30);
    let c = funnel(rng, seats, round(seats * rng.uniform(1.4, 2.5)), null);
    const passed = Math.min(c.applicants, round(seats * rng.uniform(0.85, 1.0)));
    c = funnel(rng, seats, c.applicants, passed);
    c.round = 'Direct Admission';
    return [c];
  }
  const t = p.tcas.get(year);
  let q: number;
  let r3: Camp;
  if (t !== undefined) {
    q = t.quota;
    r3 = funnel(rng, t.quota, t.applicants, t.admitted);
  } else if (p.tcas.size > 0) {
    // no figure for this year: scale from the nearest year that has one
    const n = p.tcas.get(nearestYear(p.tcas.keys(), year))!;
    q = n.quota;
    const apps = q ? round(((q * n.applicants) / n.quota) * rng.uniform(0.9, 1.1)) : n.applicants;
    let passed: number | null = null;
    if (n.admitted !== null) {
      passed = q ? Math.min(apps, round(((q * n.admitted) / n.quota) * rng.uniform(0.9, 1.1))) : n.admitted;
    }
    r3 = funnel(rng, q, apps, passed);
  } else {
    q = rng.int(40, 90);
    const apps = round(q * rng.uniform(1.5, 4.0));
    r3 = funnel(rng, q, apps, Math.min(q, round(q * rng.uniform(0.9, 1.1))));
  }
  r3.round = ROUND3;
  // total seats such that round 3 is 30-45 % of them (q = 0: nothing to scale from)
  const lo = Math.ceil(q / 0.45);
  const hi = Math.floor(q / 0.3);
  const total = q > 0 ? rng.int(lo, hi) : 0;
  const others = Math.max(0, total - q);
  const r1 = round(others * 0.45);
  const r2 = round(others * 0.35);
  const sizes: Array<[string, number]> = [
    ['Round 1 — Portfolio', r1], ['Round 2 — Quota', r2], ['Round 4 — Direct Admission', others - r1 - r2],
  ];
  const out: Camp[] = [];
  for (const [name, s] of sizes) {
    const apps = round(s * rng.uniform(1.5, 3.5));
    const c = funnel(rng, s, apps, Math.min(s, round(s * rng.uniform(0.95, 1.15))));
    c.round = name;
    out.push(c);
  }
  return [out[0]!, out[1]!, r3, out[2]!];
}

interface Year {
  applications: number;
  admitted: number;
  enrolled: number;
  retained: number | null;
  onTime: number | null;
  late: number | null;
  dropouts: number | null;
  still: number;
}

function cohortTail(rng: Rng, p: Programme, y: number, last: number, enrolled: number) {
  const f = rng.uniform(0.06, 0.15);
  const first = round(enrolled * f * 0.7);
  const retained = y + 1 <= last ? enrolled - first : null;
  const graduated = y + p.duration <= last;
  let drop: number | null = null;
  if (y + 1 <= last) {
    const span = Math.min(1.0, (last - y) / p.duration);
    drop = Math.max(first, round(enrolled * f * (0.7 + 0.3 * span)));
  }
  let onTime: number | null = null;
  let late: number | null = null;
  let still = enrolled - (drop ?? 0);
  if (graduated) {
    const left = enrolled - (drop ?? 0);
    onTime = round(left * rng.uniform(0.7, 0.85));
    late = round(left * rng.uniform(0.08, 0.15));
    still = left - onTime - late;
  }
  return { retained, onTime, late, drop, still };
}

const key = (code: string, y: number): string => `${code}\u0001${y}`;

function computePlan(world: World): Map<string, Year> {
  const s = world.slice;
  const last = s.latestYearCE;
  const out = new Map<string, Year>();
  for (const p of s.programmes) {
    for (const y of s.yearsCE) {
      const cs = campaigns(world.seed, p, y);
      const passed = cs.reduce((a, c) => a + c.notional, 0);
      const applications = Math.max(cs.reduce((a, c) => a + c.applicants, 0), passed);
      const enrolled = cs.reduce((a, c) => a + c.reported, 0);
      const t = cohortTail(r(world.seed, 'tail', p.code, y), p, y, last, enrolled);
      out.set(key(p.code, y), { applications, admitted: passed, enrolled, retained: t.retained, onTime: t.onTime, late: t.late, dropouts: t.drop, still: t.still });
    }
  }
  return out;
}

function plan(world: World): Map<string, Year> {
  let p = world.cache.get('plan') as Map<string, Year> | undefined;
  if (!p) {
    p = computePlan(world);
    world.cache.set('plan', p);
  }
  return p;
}

/** Cohorts that entered before the slice's window; alumni and tuition read them. */
function olderCohorts(world: World, pl: Map<string, Year>): Map<string, Year> {
  const s = world.slice;
  const first = Math.min(...s.yearsCE);
  const last = s.latestYearCE;
  const out = new Map<string, Year>();
  for (const p of s.programmes) {
    const base = pl.get(key(p.code, first))!.enrolled;
    for (let y = Math.max(first - 4, p.yearEstablished); y < first; y++) {
      const rng = r(world.seed, 'old', p.code, y);
      const enrolled = Math.max(5, round(base * rng.uniform(0.9, 1.1)));
      const t = cohortTail(r(world.seed, 'tail', p.code, y), p, y, last, enrolled);
      out.set(key(p.code, y), { applications: enrolled, admitted: enrolled, enrolled, retained: t.retained, onTime: t.onTime, late: t.late, dropouts: t.drop, still: t.still });
    }
  }
  return out;
}

// ------------------------------------------------------------------ builders

const faculties = (w: World): Row[] => rowsOf('faculties', w.slice.faculties.map((f) => [f.code, f.nameTh, f.nameEn, 'ACADEMIC', null]));
const departments = (w: World): Row[] => rowsOf('departments', w.slice.departments.map((d) => [d.code, d.nameTh, d.nameEn, d.facultyCode]));
const programmes = (w: World): Row[] =>
  rowsOf('programmes', w.slice.programmes.map((p) => [p.code, p.nameTh, p.nameEn, p.facultyCode, p.departmentCode, p.level, 'ACTIVE', p.yearEstablished, p.duration, p.credits, null]));
const staffRows = (w: World): Row[] =>
  rowsOf('faculty-members', w.staff.map((s) => [s.code, s.nameTh, s.nameEn, s.facultyCode, s.departmentCode, s.rank, s.qualification, s.specialization, s.hireDate, s.retirementDate, s.active ? 'Yes' : 'No']));
const programmeFaculty = (w: World): Row[] => rowsOf('program-faculty', w.links.map((l) => [l.programmeCode, l.employeeCode, l.role, null]));
function programmeCourses(w: World): Row[] {
  const items: Cell[][] = [];
  for (const p of w.slice.programmes) for (const c of w.courses.get(p.code) ?? []) items.push([p.code, c.code, c.nameTh, c.nameEn, c.credits, c.category]);
  return rowsOf('programme-courses', items);
}
const research = (w: World): Row[] => rowsOf('research-outputs', w.publications.map((x) => [x.employeeCode, x.year, x.type, x.title, x.venue, x.citations, null]));
function campaignRows(w: World): Row[] {
  const items: Cell[][] = [];
  for (const p of w.slice.programmes)
    for (const y of w.slice.yearsCE)
      for (const c of campaigns(w.seed, p, y)) items.push([p.code, y, c.round, `${p.nameEn}, mock`, c.seats, c.applicants, c.passed, c.confirmed, c.reported]);
  return rowsOf('admission-campaigns', items);
}
function enrolment(w: World): Row[] {
  const pl = plan(w);
  const items: Cell[][] = [];
  for (const p of w.slice.programmes)
    for (const y of w.slice.yearsCE) {
      const v = pl.get(key(p.code, y))!;
      items.push([p.code, y, v.applications, v.admitted, v.enrolled, v.retained, v.onTime, v.late, v.dropouts]);
    }
  return rowsOf('enrollment-metrics', items);
}
function studentCohorts(w: World): Row[] {
  const pl = plan(w);
  const items: Cell[][] = [];
  for (const p of w.slice.programmes) for (const y of w.slice.yearsCE) items.push([p.code, y, pl.get(key(p.code, y))!.still]);
  return rowsOf('student-cohorts', items);
}
function alumni(w: World): Row[] {
  const pl = plan(w);
  const cohorts = new Map([...olderCohorts(w, pl), ...pl]);
  const last = w.slice.latestYearCE;
  const items: Cell[][] = [];
  for (const p of w.slice.programmes) {
    const mine = [...cohorts].map(([k, v]) => [k.split('\u0001'), v] as const).filter(([[c]]) => c === p.code).map(([[, y], v]) => [Number(y), v] as const).sort((a, b) => a[0] - b[0]);
    for (const [y, v] of mine) {
      if (y + p.duration > last) continue;
      const rng = r(w.seed, 'alumni', p.code, y);
      const drop = v.dropouts ?? 0;
      const fin = round(drop * rng.uniform(0.25, 0.35));
      const acad = round(drop * rng.uniform(0.2, 0.3));
      const vol = round(drop * rng.uniform(0.2, 0.25));
      const transferred = Math.min(drop - fin - acad - vol, round(drop * 0.1));
      const other = drop - fin - acad - vol - transferred;
      const graduated = (v.onTime ?? 0) + (v.late ?? 0);
      const noReport = v.enrolled - graduated - drop;
      const counts: Array<[string, number]> = [
        ['GRADUATED', graduated], ['DROPPED_FINANCIAL', fin], ['DROPPED_ACADEMIC', acad], ['DROPPED_VOLUNTARY', vol],
        ['TRANSFERRED', transferred], ['OTHER', other], ['NO_REPORT', noReport],
      ];
      const sum = counts.reduce((a, [, n]) => a + n, 0);
      if (sum !== v.enrolled) throw new Error(`alumni counts for ${p.code} ${y} sum to ${sum}, not ${v.enrolled}`);
      for (const [st, n] of counts) if (n > 0) items.push([p.code, y, st, n]);
    }
  }
  return rowsOf('alumni-cohorts', items);
}
function studentsInYear(w: World, p: Programme, y: number, pl: Map<string, Year>, older: Map<string, Year>): number {
  let total = 0;
  for (let k = 0; k < p.duration; k++) {
    const v = pl.get(key(p.code, y - k)) ?? older.get(key(p.code, y - k));
    const base = v ? v.enrolled : pl.get(key(p.code, Math.min(...w.slice.yearsCE)))!.enrolled;
    total += base * 0.93 ** k;
  }
  return total;
}
function finance(w: World): Row[] {
  const pl = plan(w);
  const older = olderCohorts(w, pl);
  const items: Cell[][] = [];
  for (const p of w.slice.programmes) {
    const [lo, hi] = FEE[p.level]!;
    const fee = r(w.seed, 'fee', p.code).int(Math.floor(lo / 1000), Math.floor(hi / 1000)) * 1000;
    w.slice.yearsCE.forEach((y, i) => {
      const tuition = round(studentsInYear(w, p, y, pl, older) * fee * 1.02 ** i);
      items.push([p.code, y, tuition, round(tuition * 0.08)]);
    });
  }
  return rowsOf('financial-metrics', items);
}
function budgets(w: World): Row[] {
  const fin = finance(w);
  const facOf = new Map(w.slice.programmes.map((p) => [p.code, p.facultyCode]));
  const items: Cell[][] = [];
  for (const f of w.slice.faculties)
    for (const y of w.slice.yearsCE) {
      const tuition = fin
        .filter((x) => x['Academic Year'] === y && facOf.get(x['Programme Code'] as string) === f.code)
        .reduce((a, x) => a + (x['Tuition Revenue (THB)'] as number), 0);
      const rng = r(w.seed, 'budget', f.code, y);
      for (const [fund, mult] of [['University revenue (mock)', 1.0], ['Government subsidy (mock)', 1.6]] as const) {
        const total = roundK((20_000_000 + tuition * rng.uniform(2.0, 3.0)) * mult);
        const commit = roundK(total * 0.05);
        const oblig = roundK(total * 0.05);
        const spent = roundK(total * (y === w.slice.latestYearCE ? 0.5 : 0.85));
        items.push([`${f.nameEn} (mock)`, f.code, fund, y, total, commit, oblig, spent, total - commit - oblig - spent]);
      }
    }
  return rowsOf('faculty-budgets', items);
}
function outcomes(w: World): Row[] {
  const items: Cell[][] = [];
  for (const p of w.slice.programmes)
    for (const g of w.slice.yearsCE.slice(0, -1)) {
      const rng = r(w.seed, 'outcome', p.code, g);
      const post = p.level !== 'BACHELOR';
      const salary = post ? rng.int(30, 50) : rng.int(18, 30);
      const employment = roundTo(rng.uniform(0.78, 0.96), 2);
      const relevance = roundTo(rng.uniform(0.6, 0.9), 2);
      const further = roundTo(post ? rng.uniform(0.02, 0.1) : rng.uniform(0.05, 0.3), 2);
      items.push([p.code, g, g + 1, employment, salary * 1000, relevance, further, rng.int(8, 60)]);
    }
  return rowsOf('graduate-outcomes', items);
}
function employers(w: World): Row[] {
  const last = w.slice.latestYearCE;
  const items: Cell[][] = [];
  for (const p of w.slice.programmes)
    for (const y of [last - 1, last])
      for (const n of [1, 2, 3]) {
        const rng = r(w.seed, 'employer', p.code, y, n);
        items.push([p.code, y, `Mock employer ${n}`, roundTo(rng.uniform(0.7, 0.95), 2), rng.int(8, 30)]);
      }
  return rowsOf('employer-feedback', items);
}
const bachelors = (w: World): Programme[] => w.slice.programmes.filter((p) => p.level === 'BACHELOR');
function dqCohorts(w: World): Row[] {
  const pl = plan(w);
  const items: Cell[][] = [];
  for (const p of bachelors(w))
    for (const y of w.slice.yearsCE) {
      const rng = r(w.seed, 'dq', p.code, y);
      const tested = Math.max(8, round(pl.get(key(p.code, y))!.enrolled * rng.uniform(0.7, 0.95)));
      const scored = round(tested * rng.uniform(0.85, 0.98));
      items.push([p.code, y, tested, scored, round(scored * rng.uniform(0.5, 0.8))]);
    }
  return rowsOf('digital-competency-cohorts', items);
}
function dqModules(w: World): Row[] {
  const items: Cell[][] = [];
  for (const c of dqCohorts(w)) {
    const code = c['Programme Code'] as string;
    const y = c['Entry Year'] as number;
    for (let m = 1; m <= 13; m++) {
      const rng = r(w.seed, 'dqm', code, y, m);
      const taken = Math.max(8, round((c['Students With Scores'] as number) * rng.uniform(0.85, 1.0)));
      items.push([code, y, m, taken, roundTo(rng.uniform(55, 85), 1), c['Students Tested'] as number]);
    }
  }
  return rowsOf('digital-competency-modules', items);
}
function evaluations(w: World): Row[] {
  const last = w.slice.latestYearCE;
  const facOf = new Map(w.slice.programmes.map((p) => [p.code, p.facultyCode]));
  const seen = new Set<string>();
  const items: Cell[][] = [];
  for (const p of w.slice.programmes)
    for (const c of w.courses.get(p.code) ?? []) {
      if (c.category === GE || c.category === FREE) continue;
      const codeKey = c.code.replace(/\s+/g, '').toUpperCase();
      const rng = r(w.seed, 'eval', p.code, c.code);
      const sems = rng.choice([[1], [2], [1, 2]]);
      for (const y of [last - 1, last])
        for (const sem of sems) {
          const k = `${y}|${sem}|${codeKey}`;
          if (seen.has(k)) continue;
          seen.add(k);
          const r2 = r(w.seed, 'evalrow', c.code, y, sem);
          items.push([c.code, y, sem, 1, roundTo(r2.uniform(3.2, 4.7), 2), r2.int(8, 60), facOf.get(p.code)!, c.nameTh, c.nameEn]);
        }
    }
  return rowsOf('course-evaluations', items);
}
function population(w: World): Row[] {
  const rng = r(w.seed, 'pop', w.region);
  const share = rng.uniform(0.12, 0.3);
  const base: Record<string, number> = { '15-17': 2_900_000, '18-22': 4_600_000, '23-29': 6_300_000 };
  const decay: Record<string, number> = { '15-17': 0.985, '18-22': 0.985, '23-29': 0.992 };
  const items: Cell[][] = [];
  for (const [region, k] of [[w.region, share], ['TH', 1.0]] as const)
    for (let i = 0; i < 16; i++)
      for (const age of Object.keys(base)) items.push([region, w.slice.latestYearCE + i, age, round(base[age]! * k * decay[age]! ** i), SOURCE_NAME]);
  return rowsOf('population-projections', items);
}
function fieldsOf(w: World): string[] {
  const dept = new Map(w.slice.departments.map((d) => [d.code, d.nameEn]));
  const fields: string[] = [];
  const ordered = [...w.slice.programmes].sort((a, b) => Number(!a.isAnchor) - Number(!b.isAnchor));
  for (const p of ordered) {
    const f = (dept.get(p.departmentCode) ?? p.nameEn).replace(/^Department of /, '');
    if (!fields.includes(f)) fields.push(f);
    if (fields.length === 3) break;
  }
  for (const extra of ['Business', 'Technology', 'Science']) if (fields.length < 3 && !fields.includes(extra)) fields.push(extra);
  return fields;
}
function skills(w: World): Row[] {
  const items: Cell[][] = [];
  for (const f of fieldsOf(w)) {
    const rng = r(w.seed, 'skills', f);
    for (const s of rng.shuffle(SKILLS).slice(0, 8)) items.push([`${f} careers (mock)`, null, `${f} professional (mock)`, s, 'Thailand', 'Job postings', roundTo(rng.uniform(5, 45), 1)]);
  }
  return rowsOf('career-skill-demand', items);
}

const BUILDERS: Record<string, (w: World) => Row[]> = {
  faculties, departments, programmes, 'faculty-members': staffRows, 'program-faculty': programmeFaculty,
  'programme-courses': programmeCourses, 'research-outputs': research, 'admission-campaigns': campaignRows,
  'enrollment-metrics': enrolment, 'student-cohorts': studentCohorts, 'alumni-cohorts': alumni,
  'financial-metrics': finance, 'faculty-budgets': budgets, 'graduate-outcomes': outcomes,
  'employer-feedback': employers, 'digital-competency-cohorts': dqCohorts, 'digital-competency-modules': dqModules,
  'course-evaluations': evaluations, 'population-projections': population, 'career-skill-demand': skills,
};

/** Rows keyed by header text; null is a blank cell. Every figure derives from the world (and its `seed`). */
export function buildRows(slug: string, world: World): Row[] {
  const b = BUILDERS[slug];
  if (!b) throw new Error(`no builder for dataset '${slug}'`);
  return b(world);
}
