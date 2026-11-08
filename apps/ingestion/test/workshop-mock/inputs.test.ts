import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  InputError,
  loadInputs,
  resolveAnchors,
  type Inputs,
  type ProgrammeInput,
} from '../../src/scripts/workshop-mock/inputs';
import { loadRows, ownRows, type TcasRow } from '../../src/scripts/workshop-mock/tcas';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'workshop-mock', 'tcas-sample.xlsx');
const KMUTT = 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี';
const ENG = 'คณะวิศวกรรมศาสตร์';

function prog(name: string, extra: Partial<ProgrammeInput> = {}): ProgrammeInput {
  return { name, pdf: null, level: 'BACHELOR', faculty: null, tcasCode: null, courses: null, nameEn: null, ...extra };
}
function inputsOf(...programmes: ProgrammeInput[]): Inputs {
  return { university: KMUTT, region: 'Central', programmes };
}
function tr(code: string, programme: string, year: number, faculty = 'f', uni = KMUTT): TcasRow {
  return { courseCode: code, institution: uni, faculty, programme, major: null, entryYearBE: year, round: '3',
    quota: 10, applicants: 20, admitted: 5, minScore: null, maxScore: null };
}

describe('resolveAnchors', () => {
  let own: TcasRow[];
  beforeAll(async () => {
    const rows = await loadRows('/nonexistent', { offline: true, files: [{ path: FIXTURE, entryYearBE: 2567, round: '3' }] });
    own = ownRows(rows, KMUTT);
  });

  it('matches a name with a spelling difference', () => {
    const a = resolveAnchors(inputsOf(prog('หลักสูตรวิศวกรรมศาสตรบัณฑิต สาขาวิชา วิศวกรรมวัสดุ')), own)[0]!;
    expect(a.facultyTh).toBe(ENG);
    expect(a.programmeTh).toBe('วศ.บ.สาขาวิศวกรรมวัสดุ-วศ.บ.4ปี');
    expect(a.courseCodes).toEqual(['10140107302511A']);
    expect(a.rows).toHaveLength(1);
  });

  it('an ambiguous name across faculties needs a faculty', () => {
    const name = 'วิศวกรรมโยธา';
    expect(() => resolveAnchors(inputsOf(prog(name)), own)).toThrow(InputError);
    // the message names both ways out: a course code, or the faculty when the candidates differ in it
    expect(() => resolveAnchors(inputsOf(prog(name)), own)).toThrow(/"faculty"/);
    const a = resolveAnchors(inputsOf(prog(name, { faculty: ENG })), own)[0]!;
    expect(a.courseCodes).toEqual(['10140107302104A']);
  });

  it('nonsense lists five candidates', () => {
    let msg = '';
    try { resolveAnchors(inputsOf(prog('zzzz qqqq')), own); } catch (e) { msg = (e as Error).message; }
    const lines = msg.split('\n').filter((l) => l.includes('(0.') || l.includes('(1.'));
    expect(lines).toHaveLength(5);
    expect(lines[0]).toContain(' | ');
  });

  it('tcas_code wins', () => {
    const a = resolveAnchors(inputsOf(prog('zzzz', { tcasCode: '10140107302104A' })), own)[0]!;
    expect(a.courseCodes).toEqual(['10140107302104A']);
  });

  it('unknown tcas_code', () => {
    expect(() => resolveAnchors(inputsOf(prog('x', { tcasCode: 'nope' })), own)).toThrow(InputError);
  });

  it('a track pair has two codes', () => {
    const a = resolveAnchors(inputsOf(prog('x', { tcasCode: '10140107300507A' })), own)[0]!;
    expect(a.courseCodes).toEqual(['10140107300507A', '10140107399991Z']);
    expect(a.rows).toHaveLength(2);
  });

  it('a master needs a faculty', () => {
    expect(() => resolveAnchors(inputsOf(prog('x', { level: 'MASTER' })), own)).toThrow(InputError);
  });

  it('postgraduate faculty spelling', () => {
    const a = resolveAnchors(inputsOf(prog('วศ.ม. X', { level: 'MASTER', faculty: 'คณะ วิศวกรรมศาสตร์' })), own)[0]!;
    expect([a.facultyTh, a.programmeTh, a.rows]).toEqual([ENG, 'วศ.ม. X', []]);
    const b = resolveAnchors(inputsOf(prog('Y', { level: 'MASTER', faculty: 'คณะอื่น' })), own)[0]!;
    expect(b.facultyTh).toBe('คณะอื่น');
  });

  it('old spellings are ignored: latest year only', () => {
    const o = [
      tr('OLD1', 'วิศวกรรมสมมุติ - วศ.บ. 4 ปี', 2566),
      tr('C1', 'วศ.บ.สาขาวิศวกรรมสมมุติใหม่-วศ.บ.4ปี', 2567),
      tr('C2', 'วศ.บ.สาขาวิศวกรรมสมมุติใหม่-วศ.บ.4ปี', 2567),
      tr('C3', 'วศ.บ.สาขาวิศวกรรมอื่นโดยสิ้นเชิง-วศ.บ.4ปี', 2567),
    ];
    const a = resolveAnchors(inputsOf(prog('วิศวกรรมสมมุติ')), o)[0]!;
    expect(a.programmeTh).toBe('วศ.บ.สาขาวิศวกรรมสมมุติใหม่-วศ.บ.4ปี');
    expect(a.courseCodes).toEqual(['C1', 'C2']);
    expect(new Set(a.rows.map((r) => r.entryYearBE))).toEqual(new Set([2567]));
  });

  it('a tcas_code of an older year is rejected with the closest programme', () => {
    const o = [tr('OLD1', 'วศ.บ.สาขาวิศวกรรมสมมุติ-วศ.บ.4ปี', 2566), tr('C1', 'วศ.บ.สาขาวิศวกรรมสมมุติ-วศ.บ.4ปี', 2567)];
    let msg = '';
    try { resolveAnchors(inputsOf(prog('x', { tcasCode: 'OLD1' })), o); } catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('latest TCAS year (2567)');
    expect(msg).toContain('C1');
  });

  it('an invalid level in resolve', () => {
    expect(() => resolveAnchors(inputsOf(prog('x', { level: 'NOPE' })), own)).toThrow(InputError);
  });

  it('prefers the narrowing faculty only when it matches', () => {
    const o = [
      tr('A1', 'วศ.บ.สาขาวิศวกรรมโยธา-วศ.บ.4ปี', 2567, 'คณะหนึ่ง'),
      tr('B1', 'วศ.บ.สาขาวิศวกรรมโยธา-วศ.บ.4ปี', 2567, 'คณะสอง'),
    ];
    expect(resolveAnchors(inputsOf(prog('วิศวกรรมโยธา', { faculty: 'คณะ สอง' })), o)[0]!.courseCodes).toEqual(['B1']);
    expect(() => resolveAnchors(inputsOf(prog('วิศวกรรมโยธา', { faculty: 'คณะไม่มี' })), o)).toThrow(InputError);
  });
});

const D = (c: string, p: string, uni: string, fac = ENG): TcasRow => tr(c, p, 2569, fac, uni);
const KKU_ROWS: TcasRow[] = [
  D('10030104300501A', 'วิศวกรรมศาสตรบัณฑิต (วิศวกรรมคอมพิวเตอร์) วิศวกรรมคอมพิวเตอร์', 'U'),
  D('10030104301001E', 'วิศวกรรมศาสตรบัณฑิต (วิศวกรรมสื่อดิจิทัล) หลักสูตรนานาชาติ วิศวกรรมสื่อดิจิทัล หลักสูตรนานาชาติ', 'U'),
  D('10030104303402A', 'วิศวกรรมศาสตรบัณฑิต (วิศวกรรมเซมิคอนดักเตอร์) วิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมเซมิคอนดักเตอร์', 'U'),
  D('10030104300601A', 'วิศวกรรมศาสตรบัณฑิต (วิศวกรรมเครื่องกล) วิศวกรรมเครื่องกล', 'U'),
  D('10030105703501A', 'ศึกษาศาสตรบัณฑิต (คอมพิวเตอร์ศึกษา) ศึกษาศาสตรบัณฑิต วิชาเอกคอมพิวเตอร์ศึกษา', 'U', 'คณะศึกษาศาสตร์'),
  D('10030138220202A', 'วิทยาศาสตรบัณฑิต (วิทยาการคอมพิวเตอร์) วิทยาการคอมพิวเตอร์', 'U', 'วิทยาลัยการคอมพิวเตอร์'),
];
const KMUTT_ROWS: TcasRow[] = [
  D('10140107300507A', 'วิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมคอมพิวเตอร์ ปริญญาตรี 4 ปี', KMUTT),
  D('10140107300502E', 'วิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมคอมพิวเตอร์ ปริญญาตรี 4 ปี  (หลักสูตรนานาชาติ)', KMUTT),
];
const codesOf = (rows: TcasRow[], name: string, faculty: string | null = null): string[] =>
  resolveAnchors({ university: 'U', region: 'x', programmes: [prog(name, { faculty })] }, rows)[0]!.courseCodes;

describe('name views (real header shapes)', () => {
  it('computer engineering, not semiconductor', () => {
    expect(codesOf(KKU_ROWS, 'วิศวกรรมคอมพิวเตอร์', ENG)).toEqual(['10030104300501A']);
    expect(codesOf(KKU_ROWS, 'วิศวกรรมคอมพิวเตอร์')).toEqual(['10030104300501A']);
  });
  it('semiconductor', () => {
    expect(codesOf(KKU_ROWS, 'วิศวกรรมเซมิคอนดักเตอร์')).toEqual(['10030104303402A']);
  });
  it('digital media', () => {
    expect(codesOf(KKU_ROWS, 'วิศวกรรมสื่อดิจิทัล')).toEqual(['10030104301001E']);
  });
  it('KMUTT computer engineering picks the plain programme over the international twin', () => {
    expect(codesOf(KMUTT_ROWS, 'วิศวกรรมคอมพิวเตอร์')).toEqual(['10140107300507A']);
    expect(codesOf(KMUTT_ROWS, 'วิศวกรรมคอมพิวเตอร์ (หลักสูตรนานาชาติ)')).toEqual(['10140107300502E']);
  });
});

describe('loadInputs (JSON)', () => {
  function write(obj: unknown): string {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wsmock-in-'));
    const f = path.join(d, 'i.json');
    fs.writeFileSync(f, typeof obj === 'string' ? obj : JSON.stringify(obj), 'utf-8');
    return f;
  }

  it('round trip, relative paths resolve against the file', () => {
    const f = write({ university: KMUTT, region: 'Central', programmes: [
      { name: 'วิศวกรรมคอมพิวเตอร์', pdf: 'pdfs/ce.pdf' },
      { name: 'x', level: 'master', faculty: ENG, tcas_code: '123', courses: 'c.csv', name_en: 'X' },
    ] });
    fs.mkdirSync(path.join(path.dirname(f), 'pdfs'));
    fs.writeFileSync(path.join(path.dirname(f), 'pdfs', 'ce.pdf'), '%PDF-1.4\n');
    fs.writeFileSync(path.join(path.dirname(f), 'c.csv'), 'code,name_th,name_en,credits,category\n');
    const i = loadInputs(f);
    expect(i.university).toBe(KMUTT);
    expect(i.programmes).toHaveLength(2);
    const p = i.programmes[0]!;
    expect(p.level).toBe('BACHELOR');
    expect(p.pdf).toBe(path.join(path.dirname(f), 'pdfs', 'ce.pdf'));
    expect(p.tcasCode).toBeNull();
    const q = i.programmes[1]!;
    expect([q.level, q.faculty, q.tcasCode, q.nameEn]).toEqual(['MASTER', ENG, '123', 'X']);
    expect(q.courses).toBe(path.join(path.dirname(f), 'c.csv'));
  });

  it('bad level, bad JSON, missing file, missing programmes', () => {
    expect(() => loadInputs(write({ university: 'u', region: 'Central', programmes: [{ name: 'n', level: 'x' }] }))).toThrow(InputError);
    expect(() => loadInputs(write('{ nope'))).toThrow(/not valid JSON/);
    expect(() => loadInputs('/nonexistent/i.json')).toThrow(/not found/);
    expect(() => loadInputs(write({ university: 'u', region: 'Central', programmes: [] }))).toThrow(InputError);
    expect(() => loadInputs(write({ university: 'u', programmes: [{ name: 'n' }] }))).toThrow(/region/);
    // East is inside Central in the four-region projection; the message says so.
    expect(() => loadInputs(write({ university: 'u', region: 'East', programmes: [{ name: 'n' }] }))).toThrow(
      /region must be one of Northeast, Central, North, South.*Central/,
    );
    expect(loadInputs(write({ university: 'u', region: ' central ', programmes: [{ name: 'n' }] })).region).toBe('Central');
  });

  it('a pdf or courses path that does not exist is refused, naming the resolved path', () => {
    const f = write({ university: KMUTT, region: 'Central', programmes: [{ name: 'n', pdf: 'pdfs/missing.pdf' }] });
    expect(() => loadInputs(f)).toThrow(InputError);
    expect(() => loadInputs(f)).toThrow(`programmes #1: pdf not found: ${path.join(path.dirname(f), 'pdfs', 'missing.pdf')}`);
    const g = write({ university: KMUTT, region: 'Central', programmes: [{ name: 'n', courses: 'missing.csv' }] });
    expect(() => loadInputs(g)).toThrow(/programmes #1: courses not found: .*missing\.csv/);
    const d = write({ university: KMUTT, region: 'Central', programmes: [{ name: 'n', pdf: '.' }] });
    expect(() => loadInputs(d)).toThrow(/pdf not found/); // a folder is not a file
  });

  it('a postgraduate programme needs a faculty', () => {
    expect(() => loadInputs(write({ university: 'u', region: 'Central', programmes: [{ name: 'n', level: 'DOCTORAL' }] }))).toThrow(/faculty/);
  });
});
