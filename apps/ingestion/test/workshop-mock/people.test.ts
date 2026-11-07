import { describe, expect, it, vi } from 'vitest';
import { InputError } from '../../src/scripts/workshop-mock/inputs';
import { makePublications, makeStaff, type Publication, type RosterLink, type Staff } from '../../src/scripts/workshop-mock/people';
import { makeRng } from '../../src/scripts/workshop-mock/rng';
import type { Programme, Slice } from '../../src/scripts/workshop-mock/slice';

function makeSlice(): Slice {
  const programmes: Programme[] = [true, false, false].map((anchor, i) => ({
    code: `MOCK-P${String(i + 1).padStart(3, '0')}`, nameTh: 'x', nameEn: `Computer Engineering ${i + 1}`,
    facultyCode: 'MOCK-F01', departmentCode: 'MOCK-F01-D01', level: 'BACHELOR', duration: 4, credits: 128,
    yearEstablished: 2000, tcas: new Map(), isAnchor: anchor, pdf: null, coursesCsv: null, siblingOf: null,
  }));
  return {
    faculties: [{ code: 'MOCK-F01', nameTh: 'x', nameEn: 'Faculty of Engineering' }],
    departments: [{ code: 'MOCK-F01-D01', nameTh: 'x', nameEn: 'Computer Engineering', facultyCode: 'MOCK-F01' }],
    programmes, latestYearCE: 2025, yearsCE: [2021, 2022, 2023, 2024, 2025], notes: [],
  };
}

describe('people', () => {
  const s = makeSlice();
  const { staff, links } = makeStaff(s, makeRng(1));
  const today = new Date(Date.UTC(2026, 10, 7));
  const pubs = makePublications(s, staff, links, makeRng(2), today);

  it('staff are numbered tokens, never names', () => {
    for (const st of staff) {
      expect(st.code.startsWith('MOCK-')).toBe(true);
      expect(st.nameEn).toMatch(/^Lecturer \d{3}$/);
      expect(st.nameTh).toMatch(/^อาจารย์ \d{3}$/);
      expect(st.active).toBe(true);
    }
    expect(new Set(staff.map((x) => x.code)).size).toBe(staff.length);
  });

  it('dates and ranks', () => {
    for (const st of staff) {
      expect(st.retirementDate > '2027-12-31').toBe(true);
      expect(st.hireDate < `${s.yearsCE[0]}-01-01`).toBe(true);
      expect(['LECTURER', 'ASST_PROF', 'ASSOC_PROF', 'PROF']).toContain(st.rank);
    }
  });

  it('every programme has a 7-person roster', () => {
    for (const p of s.programmes) {
      const ls = links.filter((l: RosterLink) => l.programmeCode === p.code);
      expect(ls).toHaveLength(7);
      expect(ls.filter((l) => l.role === 'COORDINATOR')).toHaveLength(1);
      expect(ls.filter((l) => l.role === 'CORE')).toHaveLength(4);
      expect(ls.filter((l) => l.role === 'SUPPORT')).toHaveLength(2);
    }
  });

  it('the anchor has >= 15 distinct titles in the app research-readiness window', () => {
    const anchor = s.programmes[0]!;
    const members = new Set(links.filter((l) => l.programmeCode === anchor.code).map((l) => l.employeeCode));
    const titles = new Set(
      pubs.filter((p: Publication) => members.has(p.employeeCode) && p.year >= today.getUTCFullYear() - 10).map((p) => p.title.toLowerCase().trim()),
    );
    expect(titles.size).toBeGreaterThanOrEqual(15);
  });

  it('other programmes get 3-8 titles; fields are sane', () => {
    for (const p of s.programmes.slice(1)) {
      const members = new Set(links.filter((l) => l.programmeCode === p.code).map((l) => l.employeeCode));
      expect(new Set(pubs.filter((x) => members.has(x.employeeCode)).map((x) => x.title)).size).toBeGreaterThanOrEqual(3);
      expect(new Set(pubs.filter((x) => members.has(x.employeeCode)).map((x) => x.title)).size).toBeLessThanOrEqual(8);
    }
    for (const pub of pubs) {
      expect(pub.year).toBeLessThanOrEqual(2025);
      expect(pub.year).toBeGreaterThanOrEqual(today.getUTCFullYear() - 10);
      expect(['JOURNAL', 'CONFERENCE', 'PATENT', 'BOOK']).toContain(pub.type);
      expect(pub.venue).toContain('Mock');
      expect(pub.title.toLowerCase()).not.toContain('doi');
      expect(pub.citations).toBeGreaterThanOrEqual(0);
    }
  });

  it('is deterministic for a fixed today, and not tied to the clock otherwise', () => {
    const again = makePublications(s, staff, links, makeRng(2), today);
    expect(again).toEqual(pubs);
  });

  it('the default `today` comes from the slice, not the clock', () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2031-05-05T00:00:00Z'));
      const a = makePublications(s, staff, links, makeRng(2));
      vi.setSystemTime(new Date('2026-11-07T00:00:00Z'));
      const b = makePublications(s, staff, links, makeRng(2));
      expect(a).toEqual(b);
      expect(Math.min(...a.map((p) => p.year))).toBeGreaterThanOrEqual(s.latestYearCE - 7);
    } finally {
      vi.useRealTimers();
    }
  });

  it('an empty window is an InputError', () => {
    const old: Slice = { ...s, latestYearCE: 2010, yearsCE: [2006, 2007, 2008, 2009, 2010] };
    const st = makeStaff(old, makeRng(1));
    expect(() => makePublications(old, st.staff, st.links, makeRng(2), today)).toThrow(InputError);
  });

  it('a slice whose years fall outside the window fails with a clear error', () => {
    const old: Slice = { ...s, latestYearCE: 2010, yearsCE: [2006, 2007, 2008, 2009, 2010] };
    const st: { staff: Staff[]; links: RosterLink[] } = makeStaff(old, makeRng(1));
    expect(() => makePublications(old, st.staff, st.links, makeRng(2), today)).toThrow(/research-readiness window|window/i);
  });
});
