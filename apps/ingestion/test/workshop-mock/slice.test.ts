import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildTcasMatchIndex, findOwnProgrammeMatch } from '@kku/shared';
import { resolveAnchors, type Inputs, type ProgrammeInput } from '../../src/scripts/workshop-mock/inputs';
import { makeRng } from '../../src/scripts/workshop-mock/rng';
import { SIZES, chooseSlice, specOf, type Slice } from '../../src/scripts/workshop-mock/slice';
import { loadRows, ownRows, round3Totals, type TcasRow } from '../../src/scripts/workshop-mock/tcas';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'workshop-mock', 'tcas-sample.xlsx');
const KMUTT = 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี';
const THAI = /[฀-๿]/;

function prog(name: string, extra: Partial<ProgrammeInput> = {}): ProgrammeInput {
  return { name, pdf: null, level: 'BACHELOR', faculty: null, tcasCode: null, courses: null, nameEn: null, ...extra };
}
const inputs = (...p: ProgrammeInput[]): Inputs => ({ university: KMUTT, region: 'x', programmes: p });

describe('chooseSlice', () => {
  let own: TcasRow[];
  let pair: [string, string];
  beforeAll(async () => {
    const rows = await loadRows('/nonexistent', { offline: true, files: [{ path: FIXTURE, entryYearBE: 2567, round: '3' }] });
    own = ownRows(rows, KMUTT);
    const pairs = [...new Set(own.map((r) => `${r.faculty}\u0001${r.programme}`))].sort().map((k) => k.split('\u0001') as [string, string]);
    pair = pairs[0]!;
  });
  const anchors = (extra: ProgrammeInput[] = []) =>
    resolveAnchors(inputs(prog(pair[1], { faculty: pair[0] }), ...extra), own);
  const slice = (seed = 7, size: 'small' | 'medium' = 'small', extra: ProgrammeInput[] = []): Slice =>
    chooseSlice(anchors(extra), own, size, makeRng(seed));

  it('respects bounds and marks one anchor', () => {
    const s = slice();
    expect(s.faculties.length).toBeLessThanOrEqual(SIZES.small[0]);
    expect(s.programmes.length).toBeLessThanOrEqual(SIZES.small[1]);
    const a = s.programmes.filter((p) => p.isAnchor);
    expect(a).toHaveLength(1);
    expect(a[0]!.nameTh).toBe(pair[1]);
  });

  it('adds one same-level sibling to the anchor', () => {
    const s = slice();
    const a = s.programmes.find((p) => p.isAnchor)!;
    const sibs = s.programmes.filter((p) => p.siblingOf === a.code);
    expect(sibs).toHaveLength(1);
    expect(sibs[0]!.level).toBe(a.level);
    expect(sibs[0]!.nameTh).not.toBe(a.nameTh);
  });

  it('every reference exists', () => {
    const s = slice(7, 'medium');
    const fac = new Set(s.faculties.map((f) => f.code));
    const dep = new Map(s.departments.map((d) => [d.code, d]));
    for (const d of s.departments) expect(fac.has(d.facultyCode)).toBe(true);
    for (const p of s.programmes) {
      expect(fac.has(p.facultyCode)).toBe(true);
      expect(dep.get(p.departmentCode)!.facultyCode).toBe(p.facultyCode);
    }
  });

  it('codes are sequential in sort order', () => {
    const s = slice(7, 'medium');
    expect(s.faculties.map((f) => f.code)).toEqual(s.faculties.map((_, i) => `MOCK-F${String(i + 1).padStart(2, '0')}`));
    expect(s.programmes.map((p) => p.code)).toEqual(s.programmes.map((_, i) => `MOCK-P${String(i + 1).padStart(3, '0')}`));
  });

  it('a track pair is one programme and sums both tracks through the app matcher', () => {
    const s0 = slice(7, 'medium');
    const names = s0.programmes.map((p) => `${p.facultyCode}|${p.nameTh}`);
    expect(new Set(names).size).toBe(names.length);
    const src = own.find((r) => r.courseCode === '10140107399991Z')!;
    const pairRows = own.filter((r) => r.faculty === src.faculty && r.programme === src.programme);
    expect(pairRows.length).toBeGreaterThan(1);
    const s = chooseSlice(resolveAnchors(inputs(prog(src.programme, { faculty: src.faculty })), own), own, 'small', makeRng(1));
    const a = s.programmes.find((p) => p.isAnchor)!;
    const facName = new Map(s.faculties.map((f) => [f.code, f.nameTh]));
    const idx = buildTcasMatchIndex(s.programmes.filter((p) => p.level === 'BACHELOR').map((p) => ({
      id: p.code, nameTh: p.nameTh, majors: [], facultyNameTh: facName.get(p.facultyCode)!,
    })));
    const linked = own.filter((r) => findOwnProgrammeMatch(idx, r.faculty, r.programme, r.major ?? '')?.id === a.code);
    for (const r of pairRows) expect(linked).toContain(r);
    expect(a.tcas.get(2567 - 543)).toEqual(round3Totals(linked).get(2567));
    const want = pairRows.filter((r) => r.entryYearBE === 2567).reduce((n, r) => n + (r.quota ?? 0), 0);
    expect(a.tcas.get(2567 - 543)!.quota).toBeGreaterThanOrEqual(want);
  });

  it('figures come from all own rows of all years in slice order (older year counted)', () => {
    const f = 'คณะวิทย์';
    const mk = (code: string, name: string, year: number): TcasRow => ({
      courseCode: code, institution: 'U', faculty: f, programme: name, major: null, entryYearBE: year,
      round: '3', quota: 10, applicants: 20, admitted: 5, minScore: null, maxScore: null,
    });
    const o = [
      mk('A', 'วท.บ.เคมี', 2567), mk('A-old', 'วท.บ.เคมี', 2566),
      mk('B', 'วท.บ.ฟิสิกส์', 2567),
    ];
    const a = resolveAnchors({ university: 'U', region: 'x', programmes: [prog('เคมี')] }, o);
    const s = chooseSlice(a, o, 'small', makeRng(1));
    const chem = s.programmes.find((p) => p.isAnchor)!;
    expect([...chem.tcas.keys()]).toEqual([2023, 2024]); // CE years, sorted
    expect(chem.tcas.get(2023)!.quota).toBe(10);
  });

  it('years', () => {
    const s = slice();
    expect(s.latestYearCE).toBe(2567 - 543);
    expect(s.yearsCE).toEqual([2020, 2021, 2022, 2023, 2024]);
  });

  it('is deterministic for a seed and varies with it', () => {
    expect(slice(7)).toEqual(slice(7));
  });

  it('a postgraduate anchor gets a Plan B sibling and no TCAS figures', () => {
    const s = slice(7, 'small', [prog('วิศวกรรมเครื่องกล', { level: 'MASTER', faculty: pair[0] })]);
    const m = s.programmes.find((p) => p.level === 'MASTER' && p.isAnchor)!;
    expect(m.tcas.size).toBe(0);
    const sib = s.programmes.find((p) => p.siblingOf === m.code)!;
    expect(sib.nameTh).toBe('วิศวกรรมเครื่องกล (แผน ข)');
    expect(sib.facultyCode).toBe(m.facultyCode);
    expect(sib.tcas.size).toBe(0);
  });

  it('anchors may exceed the size', () => {
    const names = [...new Set(own.map((r) => `${r.faculty}\u0001${r.programme}`))].sort().slice(0, 7).map((k) => k.split('\u0001') as [string, string]);
    const extra = names.slice(1).map(([f, n]) => prog(n, { faculty: f }));
    const s = slice(7, 'small', extra);
    expect(s.programmes.length).toBeGreaterThan(SIZES.small[1]);
    expect(s.programmes.filter((p) => p.isAnchor)).toHaveLength(extra.length + 1);
  });

  it('uses a typed English name', () => {
    const a = anchors();
    a[0]!.input.nameEn = 'Custom English Name';
    const s = chooseSlice(a, own, 'small', makeRng(7));
    expect(s.programmes.find((p) => p.isAnchor)!.nameEn).toBe('Custom English Name');
  });
});

function synthetic(): TcasRow[] {
  const r = (code: string, faculty: string, programme: string): TcasRow => ({
    courseCode: code, institution: 'U', faculty, programme, major: null, entryYearBE: 2567, round: '3',
    quota: 10, applicants: 20, admitted: 5, minScore: null, maxScore: null,
  });
  return [
    r('1', 'คณะวิศวกรรมศาสตร์', 'วิศวกรรมศาสตรบัณฑิต (วิศวกรรมคอมพิวเตอร์) วิศวกรรมคอมพิวเตอร์'),
    r('2', 'คณะวิศวกรรมศาสตร์', 'วิศวกรรมศาสตรบัณฑิต (วิศวกรรมโยธา) วิศวกรรมโยธา'),
    r('3', 'คณะพยาบาลศาสตร์', 'พยาบาลศาสตรบัณฑิต พยาบาลศาสตรบัณฑิต'),
    r('4', 'คณะลึกลับ', 'ลึกลับศาสตรบัณฑิต ลึกลับศาสตรบัณฑิต'),
    r('5', 'คณะลึกลับ', 'ลึกลับศาสตรบัณฑิต (วิชาประหลาด) วิชาประหลาด'),
    r('6', 'วิทยาลัยนานาชาติ', 'หลักสูตรศิลปศาสตรบัณฑิต สาขาวิชาภาษาอังกฤษ'),
  ];
}
function noThai(s: Slice): void {
  for (const x of [...s.faculties, ...s.departments, ...s.programmes]) expect(THAI.test(x.nameEn)).toBe(false);
}

describe('English names', () => {
  it('the fixture never yields Thai English names', async () => {
    const rows = await loadRows('/nonexistent', { offline: true, files: [{ path: FIXTURE, entryYearBE: 2567, round: '3' }] });
    const own = ownRows(rows, KMUTT);
    for (let seed = 0; seed < 5; seed++) {
      const a = resolveAnchors(inputs(prog('วิศวกรรมคอมพิวเตอร์')), own);
      noThai(chooseSlice(a, own, 'medium', makeRng(seed)));
    }
  });

  it('KKU-style rows: no Thai, placeholders noted', () => {
    const own = synthetic();
    const a = resolveAnchors({ university: 'U', region: 'x', programmes: [prog('x', { tcasCode: '4' })] }, own);
    const s = chooseSlice(a, own, 'medium', makeRng(1));
    noThai(s);
    expect(s.notes.some((n) => n.includes('คณะลึกลับ'))).toBe(true);
    const fac = s.faculties.find((f) => f.nameTh === 'คณะลึกลับ')!;
    expect(fac.nameEn).toMatch(/^Faculty F\d+$/);
    expect(s.programmes.find((p) => p.isAnchor)!.nameEn).toMatch(/^Bachelor's programme P\d+$/);
    expect(s.notes.every((n) => n.includes('name_en') || n.includes('sheet'))).toBe(true);
  });

  it('prefers translatable programmes', () => {
    const own = synthetic();
    const a = resolveAnchors({ university: 'U', region: 'x', programmes: [prog('x', { tcasCode: '1' })] }, own);
    const s = chooseSlice(a, own, 'small', makeRng(1));
    expect(s.faculties.filter((f) => f.nameEn === 'Faculty of Engineering')).toHaveLength(1);
    expect(s.faculties.filter((f) => /^Faculty F\d/.test(f.nameEn))).toHaveLength(0);
  });

  it('college name', () => {
    const own = synthetic();
    const a = resolveAnchors({ university: 'U', region: 'x', programmes: [prog('ภาษาอังกฤษ', { faculty: 'วิทยาลัยนานาชาติ' })] }, own);
    const s = chooseSlice(a, own, 'small', makeRng(1));
    expect(s.faculties.map((f) => f.nameEn)).toContain('International College');
  });
});

describe('department names', () => {
  it('KKU-style names give fields, not degrees', () => {
    expect(specOf('วิศวกรรมศาสตรบัณฑิต (วิศวกรรมคอมพิวเตอร์) วิศวกรรมคอมพิวเตอร์')).toBe('วิศวกรรมคอมพิวเตอร์');
    expect(specOf('พยาบาลศาสตรบัณฑิต พยาบาลศาสตรบัณฑิต')).toBe('พยาบาลศาสตร์');
  });
  it('other shapes', () => {
    expect(specOf('หลักสูตรวิทยาศาสตรบัณฑิต สาขาวิชาฟิสิกส์ ปริญญาตรี 4 ปี')).toBe('ฟิสิกส์');
    expect(specOf('เทคโนโลยีบัณฑิต เทคโนโลยีอาหาร')).toBe('เทคโนโลยีอาหาร');
  });
});

describe('rng', () => {
  it('is deterministic, in range, and children are independent of draw order', () => {
    const a = makeRng('seed'); const b = makeRng('seed');
    expect([a.next(), a.int(1, 6), a.uniform(2, 3)]).toEqual([b.next(), b.int(1, 6), b.uniform(2, 3)]);
    for (let i = 0; i < 200; i++) { const v = a.int(3, 5); expect(v >= 3 && v <= 5).toBe(true); }
    const x = makeRng(1); x.next();
    expect(x.child('c').next()).toBe(makeRng(1).child('c').next());
    expect(makeRng(1).shuffle([1, 2, 3, 4, 5]).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});
