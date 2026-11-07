import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isCourseCode } from '@kku/shared';
import {
  CATEGORIES,
  cleanThaiName,
  coursesFromCsv,
  coursesFromPdf,
  inventedCourses,
  shareWithSibling,
} from '../../src/scripts/workshop-mock/courses';
import { makeRng } from '../../src/scripts/workshop-mock/rng';
import type { Programme } from '../../src/scripts/workshop-mock/slice';

const FIXTURE = path.join(__dirname, '..', 'fixtures', 'workshop-mock', 'curriculum-sample.pdf');

function prog(credits = 128, level: Programme['level'] = 'BACHELOR'): Programme {
  return {
    code: 'MOCK-P001', nameTh: 'x', nameEn: 'x', facultyCode: 'MOCK-F01', departmentCode: 'MOCK-F01-D01', level,
    duration: 4, credits, yearEstablished: 2000, tcas: new Map(), isAnchor: false, pdf: null, coursesCsv: null, siblingOf: null,
  };
}
function tmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'wsmock-'));
}

describe('coursesFromPdf', () => {
  it('reads codes, categories, credits and English names from the fixture', async () => {
    const { courses, note } = await coursesFromPdf(FIXTURE);
    const by = new Map(courses.map((c) => [c.code, c]));
    for (const code of ['GEN 101', 'MTH 101', 'CPE 101', 'CPE 411', 'CPE 491']) expect(by.has(code), code).toBe(true);
    expect(by.size).toBe(courses.length);
    expect(by.get('GEN 101')!.category).toBe('General education');
    expect(by.get('MTH 101')!.category).toBe('Core');
    expect(by.get('CPE 101')!.category).toBe('Major required');
    expect(by.get('CPE 411')!.category).toBe('Major elective');
    expect(by.get('CPE 491')!.category).toBe('Thesis / project');
    expect(by.get('CPE 401')!.credits).toBe(6);
    expect(by.get('CPE 491')!.credits).toBe(1);
    expect(by.get('CPE 101')!.nameEn).toBe('Computer Programming');
    expect(by.get('CPE 101')!.nameTh).toBe('การเขียนโปรแกรมคอมพิวเตอร์');
    expect(by.get('CPE 305')!.nameEn).toBe('Introduction to Artificial Intelligence');
    expect(note).toContain('course codes read from');
    for (const c of courses) expect(CATEGORIES).toContain(c.category);
  });

  it('matches the Python reference on the fixture (41 codes)', async () => {
    const { courses, note } = await coursesFromPdf(FIXTURE);
    expect(courses).toHaveLength(41);
    expect(courses.filter((c) => c.nameTh === null)).toHaveLength(14);
    expect(note).toContain('14 Thai course names were left blank');
    for (const c of courses) {
      if (c.nameTh !== null) expect(Array.from(c.nameTh).every((ch) => (ch.codePointAt(0) ?? 0) >= 32)).toBe(true);
    }
  });

  it('does not raise on a bad or missing PDF', async () => {
    const d = tmp();
    const f = path.join(d, 'fake.pdf');
    fs.writeFileSync(f, 'this is not a pdf', 'utf-8');
    for (const p of [f, path.join(d, 'nope.pdf')]) {
      const { courses, note } = await coursesFromPdf(p);
      expect(courses).toEqual([]);
      expect(note).toContain('no course codes');
    }
  });
});

describe('names', () => {
  it('a CSV name with a control character becomes null', () => {
    const f = path.join(tmp(), 'c.csv');
    fs.writeFileSync(f, 'code,name_th,name_en,credits,category\nAB 101,ชื่อ\u0000เสีย,Good,3,\n', 'utf-8');
    const [c] = coursesFromCsv(f);
    expect(c!.nameTh).toBeNull();
    expect(c!.nameEn).toBe('Good');
  });

  it('cleanThaiName rejects lost marks, leading combining marks and odd lengths', () => {
    expect(cleanThaiName('ัสิกส์ทั่วไป')).toBeNull();
    expect(cleanThaiName('ab')).toBeNull();
    expect(cleanThaiName('ก'.repeat(81))).toBeNull();
    expect(cleanThaiName('แคลคูลัส 1')).toBe('แคลคูลัส 1');
    expect(cleanThaiName('ภาษาไทยเพื\u0000อการสื\u0000อสาร')).toBeNull();
  });
});

describe('coursesFromCsv', () => {
  it('reads codes, credits and categories', () => {
    const f = path.join(tmp(), 'c.csv');
    fs.writeFileSync(
      f,
      '﻿code,name_th,name_en,credits,category\nMEE 221,,Thermo,3,core\nMEE 222,กลศาสตร์,,,Bogus\nMEE 221,dup,dup,3,core\n',
      'utf-8',
    );
    const cs = coursesFromCsv(f);
    expect(cs.map((c) => c.code)).toEqual(['MEE 221', 'MEE 222']);
    expect(cs[0]!.category).toBe('Core');
    expect(cs[0]!.nameTh).toBeNull();
    expect(cs[1]!.credits).toBe(3);
    expect(cs[1]!.category).toBe('Major required');
  });

  it('handles quoted fields with commas', () => {
    const f = path.join(tmp(), 'q.csv');
    fs.writeFileSync(f, 'code,name_th,name_en,credits,category\nMEE 221,,"Heat, mass and ""energy""",3,core\n', 'utf-8');
    expect(coursesFromCsv(f)[0]!.nameEn).toBe('Heat, mass and "energy"');
  });
});

describe('inventedCourses', () => {
  it('has the expected shape', () => {
    for (let seed = 0; seed < 5; seed++) {
      const cs = inventedCourses(prog(), makeRng(seed), 'Department of Mechanical Engineering');
      const codes = cs.map((c) => c.code);
      expect(new Set(codes).size).toBe(codes.length);
      for (const c of codes) expect(isCourseCode(c), c).toBe(true);
      expect(codes.filter((c) => c.startsWith('GEN'))).toHaveLength(4);
      expect(cs.every((c) => CATEGORIES.includes(c.category))).toBe(true);
      expect(cs.length).toBeGreaterThanOrEqual(35);
      expect(cs.length).toBeLessThanOrEqual(48);
      expect(Math.abs(cs.reduce((a, c) => a + c.credits, 0) - 128)).toBeLessThanOrEqual(4);
      expect(codes.some((c) => c.startsWith('MEC'))).toBe(true);
    }
  });

  it('never invents a GE/LI-prefixed major code', () => {
    for (const name of ['Department of Geology', 'Department of Genetics', 'Department of Linguistics', 'Department of Library Science']) {
      const cs = inventedCourses(prog(), makeRng(1), name);
      const major = cs.filter((c) => !c.code.startsWith('GEN')).map((c) => c.code);
      expect(major.length).toBeGreaterThan(0);
      for (const code of major) {
        expect(code.startsWith('GE') || code.startsWith('LI'), `${name} ${code}`).toBe(false);
        expect(isCourseCode(code)).toBe(true);
      }
    }
  });

  it('copes with a placeholder department name', () => {
    const cs = inventedCourses(prog(), makeRng(1), 'Department F03-D02');
    for (const c of cs) expect(isCourseCode(c.code), c.code).toBe(true);
    const pre = new Set(cs.filter((c) => !c.code.startsWith('GEN')).map((c) => c.code.slice(0, 3)));
    expect(pre.size).toBe(1);
    expect([...pre][0]).toMatch(/^[A-Z]{3}$/);
  });

  it('postgraduate lists use 5NN/6NN codes and total near the credits', () => {
    const cs = inventedCourses(prog(36, 'MASTER'), makeRng(1), 'Department of Physics');
    expect(Math.abs(cs.reduce((a, c) => a + c.credits, 0) - 36)).toBeLessThanOrEqual(4);
    expect(cs.every((c) => /^[A-Z]{3} [56]\d\d$/.test(c.code))).toBe(true);
    expect(cs.some((c) => c.code.startsWith('GEN'))).toBe(false);
  });

  it('is deterministic', () => {
    expect(inventedCourses(prog(), makeRng(3), 'Department of Physics')).toEqual(
      inventedCourses(prog(), makeRng(3), 'Department of Physics'),
    );
  });
});

describe('shareWithSibling', () => {
  it('shares 6-10 major courses and nothing else collides', () => {
    for (let seed = 0; seed < 10; seed++) {
      const rng = makeRng(seed);
      const anchor = inventedCourses(prog(), rng, 'Department of Mechanical Engineering');
      const sib = inventedCourses(prog(), rng, 'Department of Mechanical Engineering');
      const out = shareWithSibling(anchor, sib, rng);
      const major = new Set(anchor.filter((c) => c.category !== 'General education' && c.category !== 'Free elective').map((c) => c.code));
      const shared = new Set(out.map((c) => c.code).filter((c) => major.has(c)));
      expect(shared.size).toBeGreaterThanOrEqual(6);
      expect(shared.size).toBeLessThanOrEqual(10);
      const codes = out.map((c) => c.code);
      expect(new Set(codes).size).toBe(codes.length);
      const byAnchor = new Map(anchor.map((c) => [c.code, c]));
      for (const c of out) if (shared.has(c.code)) expect(c.nameEn).toBe(byAnchor.get(c.code)!.nameEn);
      const anchorCodes = new Set(anchor.map((c) => c.code));
      const others = new Set(codes.filter((c) => anchorCodes.has(c) && !shared.has(c)));
      expect(others).toEqual(new Set(anchor.filter((c) => c.category === 'General education').map((c) => c.code)));
    }
  });
});
