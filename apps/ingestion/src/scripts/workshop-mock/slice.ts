// Choose the faculties, departments and programmes of the mock dataset.
import { buildTcasMatchIndex, extractSpecialization, findOwnProgrammeMatch } from '@kku/shared';
import type { Anchor, Level } from './inputs';
import type { Rng } from './rng';
import { round3Totals, type TcasRow, type TcasTotals } from './tcas';
import { facultyEn, translate } from './thai-en';

export type SliceSize = 'small' | 'medium';
/** (faculties, programmes). Caps only the filler: anchors, their faculties and siblings always stay. */
export const SIZES: Record<SliceSize, readonly [number, number]> = { small: [3, 8], medium: [5, 15] };

const DEGREE_EN: Record<Level, string> = {
  BACHELOR: 'Bachelor of',
  MASTER: 'Master of',
  DOCTORAL: 'Doctor of Philosophy in',
  HIGHER_GRAD_DIPLOMA: 'Graduate Diploma in',
};
const PLACEHOLDER_EN: Record<Level, string> = {
  BACHELOR: "Bachelor's programme",
  MASTER: "Master's programme",
  DOCTORAL: 'Doctoral programme',
  HIGHER_GRAD_DIPLOMA: 'Graduate diploma programme',
};
const DURATION: Record<Level, number> = { BACHELOR: 4, MASTER: 2, DOCTORAL: 3, HIGHER_GRAD_DIPLOMA: 1 };
const CREDITS: Record<Exclude<Level, 'BACHELOR'>, number> = { MASTER: 36, DOCTORAL: 48, HIGHER_GRAD_DIPLOMA: 24 };

export interface Faculty {
  code: string;
  nameTh: string;
  nameEn: string;
}
export interface Department {
  code: string;
  nameTh: string;
  nameEn: string;
  facultyCode: string;
}
export interface Programme {
  code: string;
  nameTh: string;
  nameEn: string;
  facultyCode: string;
  departmentCode: string;
  level: Level;
  duration: number;
  credits: number;
  yearEstablished: number;
  /** Keyed by CE year (BE - 543), ascending. Empty for postgraduate programmes. */
  tcas: Map<number, TcasTotals>;
  isAnchor: boolean;
  pdf: string | null;
  coursesCsv: string | null;
  siblingOf: string | null;
}
export interface Slice {
  faculties: Faculty[];
  departments: Department[];
  programmes: Programme[];
  latestYearCE: number;
  yearsCE: number[];
  /** One line per English-name placeholder: which Thai name had no English equivalent and how to fix it. */
  notes: string[];
}

const META_PAREN = ['หลักสูตร', 'นานาชาติ', 'ภาษาอังกฤษ', 'แผน', 'ต่อเนื่อง', 'สหกิจ'];
const DEGREE_WORD = /บัณฑิต$/;
const TAIL = /\s*(ปริญญา[^\n]*|\d+\s*ปี)$/;
const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** The field of a programme name, used as the department. Never just a degree name. */
export function specOf(name: string): string {
  const base = name.replace('(แผน ข)', '').trim();
  const spec = extractSpecialization(base);
  if (spec) return spec;
  const inner = [...base.matchAll(/\(([^)]+)\)/g)]
    .map((m) => (m[1] ?? '').trim())
    .filter((m) => m && !META_PAREN.some((k) => m.includes(k)));
  if (inner.length) return inner[0]!;
  let rest = base.replace(/\([^)]*\)/g, ' ');
  rest = rest.trim().replace(/^หลักสูตร/, '');
  rest = rest.trim().replace(TAIL, '');
  const tokens = rest.trim().split(/\s+/).filter(Boolean);
  let fields = tokens.filter((t) => !DEGREE_WORD.test(t));
  if (fields.length === 0 && tokens.length) {
    // only a degree name, e.g. "พยาบาลศาสตรบัณฑิต"
    const d = tokens[0]!.replace(DEGREE_WORD, '');
    fields = [d.endsWith('ศาสตร') ? `${d}์` : d];
  }
  const dedup: string[] = [];
  for (const t of fields) if (dedup.length === 0 || dedup[dedup.length - 1] !== t) dedup.push(t);
  return dedup.join(' ') || base;
}

/** faculty -> sorted programme names of the latest entry year. */
function pairsOf(own: readonly TcasRow[]): Map<string, string[]> {
  const year = Math.max(...own.map((r) => r.entryYearBE));
  const acc = new Map<string, Set<string>>();
  for (const r of own) {
    if (r.entryYearBE !== year) continue;
    const s = acc.get(r.faculty) ?? new Set<string>();
    s.add(r.programme);
    acc.set(r.faculty, s);
  }
  return new Map([...acc].map(([f, ps]) => [f, [...ps].sort(cmp)]));
}

interface Draft {
  faculty: string;
  nameTh: string;
  level: Level;
  anchor?: Anchor;
  /** [faculty, name] of the anchor draft this one is a sibling of. */
  siblingOf?: [string, string];
}

const translatable = (faculty: string, programme: string): boolean =>
  facultyEn(faculty) !== null && translate(specOf(programme)) !== null;

const keyOf = (faculty: string, name: string): string => `${faculty}\u0001${name}`;
const pad = (n: number, w: number): string => String(n).padStart(w, '0');

export function chooseSlice(anchors: readonly Anchor[], own: readonly TcasRow[], size: SliceSize, rng: Rng): Slice {
  const [nFac, nProg] = SIZES[size];
  const avail = pairsOf(own);
  const drafts: Draft[] = [];
  const used = new Set<string>();

  for (const a of anchors) {
    drafts.push({ faculty: a.facultyTh, nameTh: a.programmeTh, level: a.input.level as Level, anchor: a });
    used.add(keyOf(a.facultyTh, a.programmeTh));
  }
  const free = (f: string): string[] => (avail.get(f) ?? []).filter((p) => !used.has(keyOf(f, p)));
  const sortedFaculties = (): string[] => [...avail.keys()].sort(cmp);

  for (const a of anchors) {
    if (a.input.level === 'BACHELOR') {
      let pool: Array<[string, string]> = free(a.facultyTh).map((p) => [a.facultyTh, p]);
      if (pool.length === 0) pool = sortedFaculties().flatMap((f) => free(f).map((p): [string, string] => [f, p]));
      if (pool.length === 0) continue;
      const good = pool.filter(([f, p]) => translatable(f, p));
      if (good.length) pool = good;
      const [f, p] = rng.choice(pool);
      used.add(keyOf(f, p));
      drafts.push({ faculty: f, nameTh: p, level: 'BACHELOR', siblingOf: [a.facultyTh, a.programmeTh] });
    } else {
      const name = `${a.programmeTh} (แผน ข)`;
      used.add(keyOf(a.facultyTh, name));
      drafts.push({ faculty: a.facultyTh, nameTh: name, level: a.input.level as Level, siblingOf: [a.facultyTh, a.programmeTh] });
    }
  }

  const faculties = new Set(drafts.map((d) => d.faculty));

  const addOther = (f: string): boolean => {
    let pool = free(f);
    if (pool.length === 0) return false;
    const good = pool.filter((p) => translatable(f, p));
    if (good.length) pool = good;
    const p = rng.choice(pool);
    used.add(keyOf(f, p));
    drafts.push({ faculty: f, nameTh: p, level: 'BACHELOR' });
    return true;
  };

  while (drafts.length < nProg) {
    if (faculties.size < nFac) {
      let cands = sortedFaculties().filter((f) => !faculties.has(f) && free(f).length > 0);
      const good = cands.filter((f) => facultyEn(f) !== null && free(f).some((p) => translatable(f, p)));
      if (good.length) cands = good;
      const multi = cands.filter((f) => (avail.get(f) ?? []).length >= 2);
      const pick = multi.length ? multi : cands;
      if (pick.length) {
        const f = rng.choice(pick);
        faculties.add(f);
        addOther(f);
        continue;
      }
    }
    const pool = [...faculties].sort(cmp).filter((f) => free(f).length > 0);
    if (pool.length === 0) break;
    addOther(rng.choice(pool));
  }

  // ---- codes, in sort order
  const facNames = [...faculties].sort(cmp);
  const facCode = new Map(facNames.map((n, i) => [n, `MOCK-F${pad(i + 1, 2)}`]));
  const specOfDraft = new Map<string, string>();
  for (const d of drafts) {
    specOfDraft.set(keyOf(d.faculty, d.nameTh), d.siblingOf && d.level !== 'BACHELOR' ? specOf(d.siblingOf[1]) : specOf(d.nameTh));
  }
  const depKeys = [...new Map(drafts.map((d) => {
    const fc = facCode.get(d.faculty)!;
    const spec = specOfDraft.get(keyOf(d.faculty, d.nameTh))!;
    return [`${fc}\u0001${spec}`, { fc, spec }] as const;
  })).values()].sort((a, b) => cmp(a.fc, b.fc) || cmp(a.spec, b.spec));
  const perFaculty = new Map<string, number>();
  const depEntries = depKeys.map(({ fc, spec }) => {
    const n = (perFaculty.get(fc) ?? 0) + 1;
    perFaculty.set(fc, n);
    return { fc, spec, code: `${fc}-D${pad(n, 2)}` };
  });
  const depCode = new Map(depEntries.map((e) => [`${e.fc}\u0001${e.spec}`, e.code]));
  const depOf = (d: Draft): string =>
    depCode.get(`${facCode.get(d.faculty)!}\u0001${specOfDraft.get(keyOf(d.faculty, d.nameTh))!}`)!;
  const ordered = [...drafts].sort(
    (a, b) => cmp(facCode.get(a.faculty)!, facCode.get(b.faculty)!) || cmp(depOf(a), depOf(b)) || cmp(a.nameTh, b.nameTh),
  );
  const progCode = new Map(ordered.map((d, i) => [keyOf(d.faculty, d.nameTh), `MOCK-P${pad(i + 1, 3)}`]));

  const latestBE = Math.max(...own.map((r) => r.entryYearBE));
  const latestCE = latestBE - 543;
  const notes: string[] = [];
  const facEn = new Map<string, string>();
  for (const n of facNames) {
    let en = facultyEn(n);
    if (en === null) {
      en = `Faculty ${facCode.get(n)!.slice(-3)}`;
      notes.push(
        `No English name for faculty '${n}'; wrote '${en}'. Fix: the glossary has no equivalent, ` +
          'so edit the English faculty name in the generated sheet.',
      );
    }
    facEn.set(n, en);
  }
  const depEn = new Map<string, string>();
  for (const e of depEntries) {
    const t = translate(e.spec);
    if (t === null) {
      const en = `Department ${e.code.slice('MOCK-'.length)}`;
      depEn.set(e.code, en);
      notes.push(
        `No English name for department '${e.spec}'; wrote '${en}'. Fix: edit the English ` +
          'department name in the generated sheet (it is derived from the programme name).',
      );
    } else {
      depEn.set(e.code, `Department of ${t}`);
    }
  }

  const programmes: Programme[] = [];
  const enCache = new Map<string, string>();
  for (const d of ordered) {
    const spec = specOfDraft.get(keyOf(d.faculty, d.nameTh))!;
    const fc = facCode.get(d.faculty)!;
    const inp = d.anchor?.input;
    const code = progCode.get(keyOf(d.faculty, d.nameTh))!;
    let nameEn: string;
    if (inp?.nameEn) {
      nameEn = inp.nameEn;
    } else {
      const t = translate(spec);
      if (t === null) {
        nameEn = `${PLACEHOLDER_EN[d.level]} ${code.slice('MOCK-'.length)}`;
        notes.push(
          `No English name for programme '${d.nameTh}'; wrote '${nameEn}'. Fix: edit the ` +
            'programme\'s TCAS sheet name, or add `"name_en": "..."` to that programme in the input file.',
        );
      } else {
        nameEn = `${DEGREE_EN[d.level]} ${t}`;
      }
    }
    if (d.siblingOf && d.level !== 'BACHELOR') {
      const base = enCache.get(keyOf(d.siblingOf[0], d.siblingOf[1]));
      if (base !== undefined) nameEn = `${base} (Plan B)`;
    }
    enCache.set(keyOf(d.faculty, d.nameTh), nameEn);
    programmes.push({
      code,
      nameTh: d.nameTh,
      nameEn,
      facultyCode: fc,
      departmentCode: depCode.get(`${fc}\u0001${spec}`)!,
      level: d.level,
      duration: DURATION[d.level],
      credits: d.level === 'BACHELOR' ? rng.choice([124, 128, 132, 136]) : CREDITS[d.level],
      yearEstablished: rng.int(1990, 2018),
      tcas: new Map(),
      isAnchor: d.anchor !== undefined,
      pdf: inp?.pdf ?? null,
      coursesCsv: inp?.courses ?? null,
      siblingOf: d.siblingOf ? progCode.get(keyOf(d.siblingOf[0], d.siblingOf[1]))! : null,
    });
  }

  // TCAS figures: exactly what the app's `tcas` connector will link (its own matcher, all
  // own rows of all years, bachelor programmes in slice order).
  const facNameOf = new Map([...facCode].map(([n, c]) => [c, n]));
  const bachelors = programmes.filter((p) => p.level === 'BACHELOR');
  const index = buildTcasMatchIndex(
    bachelors.map((p) => ({ id: p.code, nameTh: p.nameTh, majors: [], facultyNameTh: facNameOf.get(p.facultyCode)! })),
  );
  const linked = new Map<string, TcasRow[]>(bachelors.map((p) => [p.code, []]));
  for (const r of own) {
    const hit = findOwnProgrammeMatch(index, r.faculty, r.programme, r.major ?? '');
    if (hit) linked.get(hit.id)?.push(r);
  }
  for (const p of bachelors) {
    p.tcas = new Map([...round3Totals(linked.get(p.code) ?? [])].map(([y, t]) => [y - 543, t]));
  }

  const departments: Department[] = [...depEntries]
    .sort((a, b) => cmp(a.code, b.code))
    .map((e) => ({ code: e.code, nameTh: `สาขาวิชา${e.spec}`, nameEn: depEn.get(e.code)!, facultyCode: e.fc }));
  return {
    faculties: facNames.map((n) => ({ code: facCode.get(n)!, nameTh: n, nameEn: facEn.get(n)! })),
    departments,
    programmes,
    latestYearCE: latestCE,
    yearsCE: [0, 1, 2, 3, 4].map((i) => latestCE - 4 + i),
    notes,
  };
}
