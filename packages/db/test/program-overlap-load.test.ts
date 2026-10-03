import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  programFindMany: vi.fn(),
  courseFindMany: vi.fn(),
  staffFindMany: vi.fn(),
  readCourseVectors: vi.fn(),
  readPloVectors: vi.fn(),
  readMarketVectors: vi.fn(),
}));

// No real client: nothing here can reach the dev database.
vi.mock('../src/index', () => ({
  prisma: {
    program: { findMany: mocks.programFindMany },
    programCourse: { findMany: mocks.courseFindMany },
    programFaculty: { findMany: mocks.staffFindMany },
  },
}));
vi.mock('../src/program-overlap/vectors', () => ({
  readCourseVectors: mocks.readCourseVectors,
  readPloVectors: mocks.readPloVectors,
  readMarketVectors: mocks.readMarketVectors,
}));

import { assembleOverlapProgrammes, loadOverlapProgrammes, type OverlapProgrammeRow } from '../src/program-overlap/load';

const prog = (id: string, level: OverlapProgrammeRow['level'] = 'BACHELOR'): OverlapProgrammeRow => ({
  id, code: id, level, facultyId: 'f1', nameTh: id, nameEn: null, degreeNameTh: null, language: 'TH',
});
const course = (id: string, programId: string, courseCode: string, descriptionTh: string | null = null) => ({
  id, programId, courseCode, credits: 3, category: null, descriptionTh, courseNameTh: courseCode, courseNameEn: null,
});

describe('assembleOverlapProgrammes', () => {
  it('orders programmes by id, courses by code, PLOs by ordinal; keeps one level', () => {
    const r = assembleOverlapProgrammes('BACHELOR', {
      programmes: [prog('p2'), prog('p1'), prog('m1', 'MASTER')],
      courses: [course('c2', 'p1', 'ZZ100'), course('c1', 'p1', 'AA100', 'desc'), course('c3', 'p2', 'BB100')],
      courseVectors: new Map([['c1', [1, 0]]]),
      plos: new Map([['p1', [{ ordinal: 2, text: 'b', vector: [0, 1] }, { ordinal: 1, text: 'a', vector: [1, 0] }]]]),
      marketVectors: new Map([['p2', [1, 0]]]),
      staff: [],
    });
    expect(r.programmes.map((p) => p.id)).toEqual(['p1', 'p2']);
    expect(r.programmes[0]!.courses.map((c) => c.code)).toEqual(['AA100', 'ZZ100']);
    expect(r.programmes[0]!.plos.map((p) => p.ordinal)).toEqual([1, 2]);
    expect(r.programmes[1]!.marketVector).toEqual([1, 0]);
  });

  it('marks described from descriptionTh and attaches vectors to any course', () => {
    const r = assembleOverlapProgrammes('BACHELOR', {
      programmes: [prog('p1')],
      courses: [course('c1', 'p1', 'AA100', 'desc'), course('c2', 'p1', 'BB100')],
      courseVectors: new Map([['c2', [0, 1]]]),
      plos: new Map(),
      marketVectors: new Map(),
      staff: [],
    });
    const [a, b] = r.programmes[0]!.courses;
    expect(a).toMatchObject({ code: 'AA100', described: true, vector: null });
    expect(b).toMatchObject({ code: 'BB100', described: false, vector: [0, 1] });
    expect(r.coverage).toMatchObject({ programmes: 1, courses: 2, embeddedCourses: 1, describedCourses: 1, withPlos: 0 });
  });

  it('keeps active staff only, distinct and sorted', () => {
    const r = assembleOverlapProgrammes('BACHELOR', {
      programmes: [prog('p1')],
      courses: [],
      courseVectors: new Map(),
      plos: new Map(),
      marketVectors: new Map(),
      staff: [
        { programId: 'p1', facultyMember: { id: 's2', isActive: true } },
        { programId: 'p1', facultyMember: { id: 's1', isActive: true } },
        { programId: 'p1', facultyMember: { id: 's2', isActive: true } },
        { programId: 'p1', facultyMember: { id: 's3', isActive: false } },
      ],
    });
    expect(r.programmes[0]!.staffIds).toEqual(['s1', 's2']);
  });
});

describe('loadOverlapProgrammes', () => {
  beforeEach(() => {
    for (const m of Object.values(mocks)) m.mockReset();
    mocks.readCourseVectors.mockResolvedValue(new Map());
    mocks.readPloVectors.mockResolvedValue(new Map());
    mocks.readMarketVectors.mockResolvedValue(new Map());
  });

  it('queries canonical programmes at the one level and reads vectors for every course', async () => {
    mocks.programFindMany.mockResolvedValue([prog('p1')]);
    mocks.courseFindMany.mockResolvedValue([course('c1', 'p1', 'AA100'), course('c2', 'p1', 'BB100', 'd')]);
    mocks.staffFindMany.mockResolvedValue([]);
    const r = await loadOverlapProgrammes('MASTER');
    expect(mocks.programFindMany.mock.calls[0]![0].where).toEqual({ sequenceNoFromSheet: { not: null }, level: 'MASTER' });
    expect(mocks.readCourseVectors).toHaveBeenCalledWith(['c1', 'c2']);
    expect(mocks.readPloVectors).toHaveBeenCalledWith(['p1']);
    // The prog row says BACHELOR; the assembler drops anything not at the asked level.
    expect(r.programmes).toEqual([]);
  });

  it('skips course and staff reads when there are no programmes', async () => {
    mocks.programFindMany.mockResolvedValue([]);
    const r = await loadOverlapProgrammes('DOCTORAL');
    expect(mocks.courseFindMany).not.toHaveBeenCalled();
    expect(mocks.staffFindMany).not.toHaveBeenCalled();
    expect(r.coverage.programmes).toBe(0);
  });
});
