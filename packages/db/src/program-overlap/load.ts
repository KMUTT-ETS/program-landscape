// program-overlap.v1 — loads the scoring input for one degree level (spec §5,
// D5: same level only, canonical programmes only).
//
// Determinism: programmes come back sorted by id, courses by code (then id),
// PLOs by ordinal and staff ids sorted. The greedy matcher's tie-breaks and the
// evidence hash both depend on input order, so this is load-bearing.
import type { CourseCategory, ProgramLevel } from '@prisma/client';
import { prisma } from '../index';
import { IS_CANONICAL_PROGRAM } from '../canonical-programs';
import { readCourseVectors, readMarketVectors, readPloVectors } from './vectors';
import type { OverlapCourse, OverlapPlo, OverlapProgramme } from './score';

export interface OverlapLoadCoverage {
  level: ProgramLevel;
  programmes: number;
  withPlos: number;
  withCourses: number;
  withEmbeddedCourses: number;
  withDescribedCourses: number;
  withMarketVector: number;
  withActiveStaff: number;
  courses: number;
  embeddedCourses: number;
  describedCourses: number;
}

export interface OverlapLoad {
  programmes: OverlapProgramme[];
  coverage: OverlapLoadCoverage;
}

export interface OverlapProgrammeRow {
  id: string;
  code: string;
  level: ProgramLevel;
  facultyId: string;
  nameTh: string;
  nameEn: string | null;
  degreeNameTh: string | null;
  language: string | null;
}
export interface OverlapCourseRow {
  id: string;
  programId: string;
  courseCode: string;
  credits: number | null;
  category: CourseCategory | null;
  descriptionTh: string | null;
  courseNameTh: string | null;
  courseNameEn: string | null;
}
export interface OverlapStaffRow {
  programId: string;
  facultyMember: { id: string; isActive: boolean };
}

/** Plain UTF-16 code-unit order — independent of locale and ICU version, so
 *  the order (and with it every tie-break and evidence hash) is reproducible. */
export function byCodeUnits(x: string, y: string): number {
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Pure: assembles and orders the scoring input from already-read rows. */
export function assembleOverlapProgrammes(
  level: ProgramLevel,
  input: {
    programmes: OverlapProgrammeRow[];
    courses: OverlapCourseRow[];
    courseVectors: ReadonlyMap<string, number[]>;
    plos: ReadonlyMap<string, OverlapPlo[]>;
    marketVectors: ReadonlyMap<string, number[]>;
    staff: OverlapStaffRow[];
  },
): OverlapLoad {
  const coursesBy = new Map<string, OverlapCourse[]>();
  const sortedCourses = [...input.courses].sort((x, y) => byCodeUnits(x.courseCode, y.courseCode) || byCodeUnits(x.id, y.id));
  for (const c of sortedCourses) {
    const course: OverlapCourse = {
      id: c.id,
      code: c.courseCode,
      credits: c.credits,
      category: c.category,
      described: c.descriptionTh !== null,
      vector: input.courseVectors.get(c.id) ?? null,
      nameTh: c.courseNameTh,
      nameEn: c.courseNameEn,
    };
    const list = coursesBy.get(c.programId);
    if (list) list.push(course);
    else coursesBy.set(c.programId, [course]);
  }

  const staffBy = new Map<string, Set<string>>();
  for (const s of input.staff) {
    if (!s.facultyMember.isActive) continue;
    const set = staffBy.get(s.programId) ?? new Set<string>();
    set.add(s.facultyMember.id);
    staffBy.set(s.programId, set);
  }

  const programmes: OverlapProgramme[] = [...input.programmes]
    .filter((p) => p.level === level)
    .sort((x, y) => byCodeUnits(x.id, y.id))
    .map((p) => ({
      ...p,
      courses: coursesBy.get(p.id) ?? [],
      plos: [...(input.plos.get(p.id) ?? [])].sort((x, y) => x.ordinal - y.ordinal),
      marketVector: input.marketVectors.get(p.id) ?? null,
      staffIds: [...(staffBy.get(p.id) ?? [])].sort(),
    }));

  const allCourses = programmes.flatMap((p) => p.courses);
  const coverage: OverlapLoadCoverage = {
    level,
    programmes: programmes.length,
    withPlos: programmes.filter((p) => p.plos.length > 0).length,
    withCourses: programmes.filter((p) => p.courses.length > 0).length,
    withEmbeddedCourses: programmes.filter((p) => p.courses.some((c) => c.vector !== null)).length,
    withDescribedCourses: programmes.filter((p) => p.courses.some((c) => c.described)).length,
    withMarketVector: programmes.filter((p) => p.marketVector !== null).length,
    withActiveStaff: programmes.filter((p) => p.staffIds.length > 0).length,
    courses: allCourses.length,
    embeddedCourses: allCourses.filter((c) => c.vector !== null).length,
    describedCourses: allCourses.filter((c) => c.described).length,
  };
  return { programmes, coverage };
}

/** Every canonical programme at `level`, with courses, PLOs, market vector and
 *  active staff. */
export async function loadOverlapProgrammes(level: ProgramLevel): Promise<OverlapLoad> {
  const programmes = await prisma.program.findMany({
    where: { ...IS_CANONICAL_PROGRAM, level },
    select: { id: true, code: true, level: true, facultyId: true, nameTh: true, nameEn: true, degreeNameTh: true, language: true },
    orderBy: { id: 'asc' },
  });
  const ids = programmes.map((p) => p.id);
  const courses =
    ids.length === 0
      ? []
      : await prisma.programCourse.findMany({
          where: { programId: { in: ids } },
          select: {
            id: true, programId: true, courseCode: true, credits: true, category: true,
            descriptionTh: true, courseNameTh: true, courseNameEn: true,
          },
        });
  const staff =
    ids.length === 0
      ? []
      : await prisma.programFaculty.findMany({
          where: { programId: { in: ids } },
          select: { programId: true, facultyMember: { select: { id: true, isActive: true } } },
        });
  const [courseVectors, plos, marketVectors] = await Promise.all([
    readCourseVectors(courses.map((c) => c.id)),
    readPloVectors(ids),
    readMarketVectors(ids),
  ]);
  return assembleOverlapProgrammes(level, { programmes, courses, courseVectors, plos, marketVectors, staff });
}
