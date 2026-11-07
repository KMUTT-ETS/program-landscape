import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import {
  closestInstitutions,
  loadRows,
  ownRows,
  round3Totals,
  type TcasRow,
} from '../../src/scripts/workshop-mock/tcas';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'workshop-mock', 'tcas-sample.xlsx');
const KMUTT = 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี';
const D = 'มหาวิทยาลัยทดสอบ';

function row(code: string, year = 2567, admitted: number | null = 5): TcasRow {
  return {
    courseCode: code, institution: KMUTT, faculty: 'f', programme: 'p', major: null,
    entryYearBE: year, round: '3', quota: 10, applicants: 20, admitted, minScore: null, maxScore: null,
  };
}

async function fixtureRows(): Promise<TcasRow[]> {
  return loadRows('/nonexistent', { offline: true, files: [{ path: FIXTURE, entryYearBE: 2567, round: '3' }] });
}

describe('tcas reader', () => {
  it('loads rows', async () => {
    const rows = await fixtureRows();
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.entryYearBE === 2567)).toBe(true);
  });

  it('a blank pass row has no admitted', async () => {
    const rows = await fixtureRows();
    const r = rows.find((x) => x.courseCode === '10140107399992Z')!;
    expect(r.admitted).toBeNull();
    expect(r.quota).not.toBeNull();
  });

  it('own rows are an exact name match', async () => {
    const rows = await fixtureRows();
    const own = ownRows(rows, KMUTT);
    expect(own.length).toBeGreaterThan(0);
    expect(own.every((r) => r.institution === KMUTT)).toBe(true);
    expect(ownRows(rows, KMUTT + ' ')).toEqual([]);
  });

  it('closest institutions', async () => {
    const rows = await fixtureRows();
    expect(closestInstitutions(rows, 'มหาวิทยาลัยเทคโนโลยีพระจอมเกล้า')[0]).toBe(KMUTT);
  });

  it('round 3 counts a code once', () => {
    const t = round3Totals([row('A'), row('A'), row('B')]).get(2567)!;
    expect([t.quota, t.applicants, t.admitted]).toEqual([20, 40, 10]);
  });

  it('round 3 admitted is null when unstated', () => {
    expect(round3Totals([row('A', 2567, null)]).get(2567)!.admitted).toBeNull();
  });

  it('3.1 blank then 3.2 counts, in either order', () => {
    const a: TcasRow = { ...row('A', 2568, null), round: '3.1' };
    const b: TcasRow = { ...row('A', 2568, 7), round: '3.2' };
    expect(round3Totals([a, b]).get(2568)!.admitted).toBe(7);
    expect(round3Totals([b, a]).get(2568)!.admitted).toBe(7);
  });
});

const HEADERS: Record<string, string[]> = {
  '2562': ['รหัส', 'สถาบัน', 'รหัสหลักสูตร', 'คณะ', 'หลักสูตร', 'รับร่วม', 'กลุ่มองค์ประกอบ', 'PAT7', 'รับ', 'สมัคร', 'ผ่าน', 'อัตราการแข่งขัน', 'ผ่านสัมภาษณ์', 'ไม่ประสงค์เข้าศึกษา/ตกสัมภาษณ์', 'สละสิทธิ์', 'มีสิทธิ์เข้าศึกษา', 'คะแนนสูงสุด', 'คะแนนต่ำสุด', 'คะแนนต่ำสุด\n(มีสิทธิ์เข้าศึกษา)', 'ความต่างของคะแนน', 'คะแนนเฉลี่ย', 'SD'],
  '2563': ['ลำดับ', 'รหัสหลักสูตร', 'สถาบัน', 'วิทยาเขต', 'คณะ', 'หลักสูตร', 'แขนง/วิชาเอก', 'รหัส\nโครงการ', 'โครงการ/รูปแบบ', 'PAT', 'รหัสรับร่วม', 'รับ', 'สมัคร', 'ผ่าน', 'อัตราการแข่งขัน', 'คะแนนสูงสุด', 'คะแนนต่ำสุด', 'ความต่างของคะแนน'],
  '2565': ['university_id', 'university_name', 'program_id', 'major_id', 'project_id', 'campus_name_th', 'program_lookup_programs.faculty_name_th', 'program_name_th', 'project_name_th', 'major_name_th', 'join_id', 'รับ', 'สมัคร', 'ผ่าน', 'คะแนนต่ำสุด', 'คะแนนสูงสุด', 'คะแนนต่ำสุด หลังประมวลผลรอบ 2', 'คะแนนสูงสุด หลังประมวลผลรอบ 2'],
  '2566': ['สถาบัน', 'วิทยาเขต', 'รหัสหลักสูตร', 'คณะ/สำนักวิชา', 'ชื่อหลักสูตร', 'รายละเอียด', 'สาขาวิชา/วิชาเอก', 'รหัสรับร่วม', 'รับ', 'สมัคร', 'ผ่าน', 'คะแนนต่ำสุด', 'คะแนนสูงสุด'],
  '2568-3.1': ['สถาบัน', 'วิทยาเขต', 'รหัสหลักสูตร', 'คณะ', 'หลักสูตร', 'รายละเอียด', 'สาขา/วิชาเอก', 'รหัสรับร่วม', 'รับ', 'สมัคร', 'ผ่าน', 'คะแนนสูงสุด', 'คะแนนต่ำสุด'],
  '2568-3.2': ['สถาบัน', 'วิทยาเขต', 'รหัสหลักสูตร', 'คณะ', 'หลักสูตร', 'รายละเอียด', 'สาขา/วิชาเอก', 'รหัสรับร่วม', 'รับ', 'สมัคร', 'ผ่าน ประมวลผลครั้งที่ 1', 'ผ่าน ประมวลผลครั้งที่ 2', 'คะแนนสูงสุด ประมวลผลครั้งที่ 1', 'คะแนนต่ำสุด ประมวลผลครั้งที่ 1', 'คะแนนสูงสุด ประมวลผลครั้งที่ 2', 'คะแนนต่ำสุด ประมวลผลครั้งที่ 2'],
  '2569': ['สถาบัน', 'วิทยาเขต', 'รหัสหลักสูตร', 'รหัสสาขา', 'รหัสโครงการ', 'คณะ', 'หลักสูตร', 'รายละเอียด', 'สาขา/วิชาเอก', 'รหัสรับร่วม', 'รับ', 'สมัคร', 'ผ่าน', 'คะแนนสูงสุด', 'คะแนนต่ำสุด', 'ผ่าน DS', 'คะแนนสูงสุด DS', 'คะแนนต่ำสุด DS'],
};
const VALUES: Record<string, string | number> = {
  'สถาบัน': D, university_name: D,
  'รหัสหลักสูตร': '{code}', program_id: '{code}',
  'คณะ': 'คณะวิทย์', 'คณะ/สำนักวิชา': 'คณะวิทย์', 'program_lookup_programs.faculty_name_th': 'คณะวิทย์',
  'หลักสูตร': 'วท.บ.เคมี', 'ชื่อหลักสูตร': 'วท.บ.เคมี', program_name_th: 'วท.บ.เคมี',
  'รับ': 30, 'สมัคร': 90, 'ผ่าน': 25, 'ผ่าน ประมวลผลครั้งที่ 1': 20, 'ผ่าน ประมวลผลครั้งที่ 2': 5,
  'คะแนนต่ำสุด': 50.5, 'คะแนนสูงสุด': 80.5,
  'คะแนนต่ำสุด ประมวลผลครั้งที่ 1': 50.5, 'คะแนนสูงสุด ประมวลผลครั้งที่ 1': 80.5,
};

describe('tcas header layouts', () => {
  for (const name of Object.keys(HEADERS)) {
    it(`reads the ${name} layout`, async () => {
      const year = Number(name.slice(0, 4));
      const rnd = name.slice(5) || '3';
      const headers = HEADERS[name]!;
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsmock-tcas-'));
      const file = path.join(dir, 'x.xlsx');
      const aoa = [headers, ...['C1', 'C2'].map((code) =>
        headers.map((h) => {
          const v = VALUES[h];
          if (v === undefined) return null;
          return typeof v === 'string' ? v.replace('{code}', code) : v;
        }))];
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'S');
      XLSX.writeFile(wb, file);
      const rows = await loadRows(dir, { offline: true, files: [{ path: file, entryYearBE: year, round: rnd }] });
      expect(rows).toHaveLength(2);
      for (const r of rows) {
        expect(r.institution).toBe(D);
        expect(r.courseCode.startsWith('C')).toBe(true);
        expect(r.faculty).toBe('คณะวิทย์');
        expect(r.programme).toBe('วท.บ.เคมี');
        expect([r.quota, r.applicants]).toEqual([30, 90]);
        expect(r.admitted).toBe(25);
        expect([r.minScore, r.maxScore]).toEqual([50.5, 80.5]);
      }
      fs.rmSync(dir, { recursive: true, force: true });
    });
  }

  it('refuses an explicitly given file without the institution and code headers', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wsmock-tcas-'));
    const file = path.join(dir, 'bad.xlsx');
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['a', 'b'], [1, 2]]), 'S');
    XLSX.writeFile(wb, file);
    await expect(loadRows(dir, { offline: true, files: [{ path: file, entryYearBE: 2567, round: '3' }] }))
      .rejects.toThrow(/missing institution/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
