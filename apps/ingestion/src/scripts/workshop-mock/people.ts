// Invent staff (numbered tokens, never names), programme rosters and publications.
import type { Rng } from './rng';
import type { Slice } from './slice';

const RANKS = [
  ...Array<string>(40).fill('LECTURER'),
  ...Array<string>(35).fill('ASST_PROF'),
  ...Array<string>(20).fill('ASSOC_PROF'),
  ...Array<string>(5).fill('PROF'),
];
const ROLES = ['COORDINATOR', 'CORE', 'CORE', 'CORE', 'CORE', 'SUPPORT', 'SUPPORT'] as const;
const TYPES = [...Array<string>(6).fill('JOURNAL'), ...Array<string>(3).fill('CONFERENCE'), 'BOOK', 'PATENT'];
const TEMPLATES = [
  'A survey of recent methods in {f}', 'Case study: applying {f} in practice',
  'Improving accuracy in {f} with data-driven models', 'Challenges and opportunities in {f}',
  'A comparative evaluation of approaches to {f}', 'Teaching and learning in {f}',
  'Sustainable practice in {f}', 'Measuring quality in {f}',
  'Towards a framework for {f}', 'Industry perspectives on {f}',
  'Experimental study in {f}', 'Modelling and simulation for {f}',
  'Ethics and policy in {f}', 'Low-cost solutions for {f}',
  'Field trial results in {f}', 'Emerging trends in {f}',
];
const VENUE: Record<string, string> = {
  JOURNAL: 'Mock Journal of {f}',
  CONFERENCE: 'Mock International Conference on {f}',
  BOOK: 'Mock Press ({f})',
  PATENT: 'Mock Patent Office ({f})',
};

/** Dates are ISO `YYYY-MM-DD` strings (what the importer reads, and they sort as text). */
export interface Staff {
  code: string;
  nameTh: string;
  nameEn: string;
  facultyCode: string;
  departmentCode: string;
  rank: string;
  qualification: string;
  specialization: string;
  hireDate: string;
  retirementDate: string;
  active: boolean;
}
export interface RosterLink {
  programmeCode: string;
  employeeCode: string;
  role: string;
}
export interface Publication {
  employeeCode: string;
  year: number;
  type: string;
  title: string;
  venue: string;
  citations: number;
}

const pad = (n: number, w: number): string => String(n).padStart(w, '0');
const fill = (t: string, f: string): string => t.replace('{f}', f);

export function makeStaff(slice: Slice, rng: Rng): { staff: Staff[]; links: RosterLink[] } {
  const firstYear = Math.min(...slice.yearsCE);
  const deptEn = new Map(slice.departments.map((d) => [d.code, d.nameEn]));
  const staff: Staff[] = [];
  const links: RosterLink[] = [];
  let n = 0;
  for (const p of slice.programmes) {
    const field = deptEn.get(p.departmentCode) || p.nameEn;
    for (const role of ROLES) {
      n++;
      const rank = rng.choice(RANKS);
      const hireYear = rng.int(firstYear - 25, firstYear - 2);
      const hireMonth = rng.int(1, 12);
      const retireYear = rng.int(2030, 2055);
      const s: Staff = {
        code: `MOCK-E${pad(n, 4)}`, nameTh: `อาจารย์ ${pad(n, 3)}`, nameEn: `Lecturer ${pad(n, 3)}`,
        facultyCode: p.facultyCode, departmentCode: p.departmentCode, rank, qualification: 'Mock PhD',
        specialization: field, hireDate: `${hireYear}-${pad(hireMonth, 2)}-01`, retirementDate: `${retireYear}-09-30`,
        active: true,
      };
      staff.push(s);
      links.push({ programmeCode: p.code, employeeCode: s.code, role });
    }
  }
  return { staff, links };
}

/**
 * The app counts distinct lower-cased titles (no DOI) credited to roster members with
 * year >= current year - 10 (real clock), so every anchor roster gets >= 15 unique titles
 * inside the last 10 years of the slice, clamped to that window. `today` is injectable so
 * tests (and a pinned run) do not depend on the clock.
 */
export function makePublications(
  slice: Slice,
  _staff: readonly Staff[],
  links: readonly RosterLink[],
  rng: Rng,
  today: Date = new Date(),
): Publication[] {
  const lo = Math.max(slice.latestYearCE - 9, today.getUTCFullYear() - 10);
  const years: number[] = [];
  for (let y = lo; y <= slice.latestYearCE; y++) years.push(y);
  if (years.length === 0) {
    throw new Error(
      `The research-readiness window is empty: the app counts publications from ${today.getUTCFullYear() - 10} ` +
        `onwards, but the newest year in this slice is ${slice.latestYearCE}. Use more recent TCAS data.`,
    );
  }
  const pubs: Publication[] = [];
  const seen = new Set<string>();
  for (const p of slice.programmes) {
    const members = links.filter((l) => l.programmeCode === p.code).map((l) => l.employeeCode);
    const field = p.nameEn;
    const count = p.isAnchor ? rng.int(16, 20) : rng.int(3, 8);
    const templates = rng.shuffle(TEMPLATES);
    for (let i = 0; i < count; i++) {
      let title = fill(templates[i % templates.length]!, field);
      if (i >= templates.length) title += ` (part ${Math.floor(i / templates.length) + 1})`;
      if (seen.has(title.toLowerCase())) title += ` (${p.code})`;
      seen.add(title.toLowerCase());
      const typ = rng.choice(TYPES);
      const year = p.isAnchor ? years[i % years.length]! : rng.choice(years);
      for (const author of rng.shuffle(members).slice(0, rng.int(1, 2))) {
        pubs.push({ employeeCode: author, year, type: typ, title, venue: fill(VENUE[typ]!, field), citations: rng.int(0, 60) });
      }
    }
  }
  return pubs;
}
