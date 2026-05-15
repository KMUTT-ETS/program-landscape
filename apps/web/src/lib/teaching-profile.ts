// ────────────────────────────────────────────────────────────────────────────
// teaching-profile.ts — summarise a FacultyMember's teaching over the
// last 5 academic years from class_offering_teachers × class_offerings.
//
// Joined via FacultyMember.id (resolved at ingest time) with a kkuEmail
// fallback for teachers whose facultyMemberId hasn't been backfilled yet.
// A single ~120ms aggregate query produces the by-year + by-course +
// by-area rollups; the rest is pure-function pivoting.
//
// Powers the "Teaching profile" section on /profile. The summariser
// returns `available: false` when the user has no kkuEmail OR no
// in-window teaching rows — the section then renders an empty state
// rather than fabricating numbers.
// ────────────────────────────────────────────────────────────────────────────

import { prisma } from '@kku/db';
import type {
  TeachingProfile,
  TeachingTopCourse,
  TeachingYearPoint,
} from './profile-types';

/** How many academic years (inclusive of the latest) to summarise. */
const WINDOW_YEARS = 5;
/** Cap on the "top courses" list — the rest still feed the aggregate KPIs. */
const TOP_COURSES_LIMIT = 10;

/** Returns the BE year of the latest semester WITH meaningful enrolment
 *  in the cube — the upper bound of the window. Defaults to "current
 *  BE year" (CE + 543) if the cube is empty, so callers always get a
 *  stable range to render. */
async function resolveWindowLatestYearBE(): Promise<number> {
  const row = await prisma.$queryRaw<Array<{ y: number }>>`
    SELECT acad_year_be AS y
      FROM class_offerings
     GROUP BY acad_year_be
    HAVING SUM(enroll_seat) > 0
     ORDER BY acad_year_be DESC
     LIMIT 1
  `;
  return row[0]?.y ?? new Date().getUTCFullYear() + 543;
}

/** Build the teaching profile for one staff member. */
export async function summariseTeaching(member: {
  id: string;
  kkuEmail: string | null;
}): Promise<TeachingProfile> {
  const latestBE = await resolveWindowLatestYearBE();
  const fromBE = latestBE - (WINDOW_YEARS - 1);
  const emailLower = (member.kkuEmail ?? '').toLowerCase();

  // Single aggregate scan. Match by facultyMemberId OR kkuEmail so we
  // catch teachers whose facultyMemberId hasn't been resolved yet at
  // ingest time (kkuEmail comes straight from KKUMAIL).
  //
  // We filter `c.enroll_seat > 0` — a section that opened but enrolled
  // no students wasn't really "taught" in any meaningful sense. The
  // registrar over-provisions sections in advance, so including them
  // would inflate the picture (and the user would correctly say "I
  // didn't actually teach those").
  const rows = await prisma.$queryRaw<
    Array<{
      acad_year_be: number;
      semester: number;
      course_code: string;
      course_name_th: string | null;
      course_name_en: string | null;
      registry_faculty_name: string;
      sections: bigint;
      students: bigint;
      contact_hrs: bigint;
    }>
  >`
    SELECT
      c.acad_year_be,
      c.semester,
      c.course_code,
      MAX(c.course_name_th)  AS course_name_th,
      MAX(c.course_name_en)  AS course_name_en,
      c.registry_faculty_name,
      COUNT(*)::bigint                              AS sections,
      COALESCE(SUM(c.enroll_seat), 0)::bigint       AS students,
      COALESCE(
        SUM(COALESCE(c.lecture_hrs_per_week, 0) + COALESCE(c.lab_hrs_per_week, 0)),
        0
      )::bigint                                     AS contact_hrs
    FROM class_offering_teachers t
    JOIN class_offerings c ON c.id = t.class_offering_id
    WHERE (
            t.faculty_member_id = ${member.id}
        OR  (${emailLower}::text <> '' AND LOWER(t.kku_email) = ${emailLower})
          )
      AND c.acad_year_be >= ${fromBE}
      AND c.acad_year_be <= ${latestBE}
      AND c.enroll_seat   >  0
    GROUP BY c.acad_year_be, c.semester, c.course_code, c.registry_faculty_name
  `;

  if (rows.length === 0) {
    return emptyProfile(fromBE, latestBE);
  }

  // ── Pivot into byYear, topCourses, expertiseAreas, KPIs ──
  const byYearMap = new Map<number, TeachingYearPoint>();
  const courseMap = new Map<string, TeachingTopCourse & { firstYear: number; lastYear: number }>();
  const areaMap = new Map<
    string,
    { sections: number; courses: Set<string> }
  >();
  const activeSemesters = new Set<string>(); // year-sem keys
  let totSections = 0;
  let totStudents = 0;

  for (const r of rows) {
    const y = r.acad_year_be;
    const s = r.semester;
    const sections = Number(r.sections);
    const students = Number(r.students);
    const contactHrs = Number(r.contact_hrs);

    totSections += sections;
    totStudents += students;
    activeSemesters.add(`${y}-${s}`);

    // by year
    const yp = byYearMap.get(y) ?? {
      acadYearBE: y,
      sections: 0,
      contactHrsPerWeekTotal: 0,
      studentsTaught: 0,
    };
    yp.sections += sections;
    yp.contactHrsPerWeekTotal += contactHrs;
    yp.studentsTaught += students;
    byYearMap.set(y, yp);

    // courses (year-overlapping rows for same course collapse here)
    const c = courseMap.get(r.course_code);
    if (c) {
      c.sections += sections;
      c.studentsTaught += students;
      c.firstYear = Math.min(c.firstYear, y);
      c.lastYear = Math.max(c.lastYear, y);
    } else {
      courseMap.set(r.course_code, {
        courseCode: r.course_code,
        courseNameTh: r.course_name_th,
        courseNameEn: r.course_name_en,
        sections,
        studentsTaught: students,
        firstYearBE: y,
        lastYearBE: y,
        firstYear: y,
        lastYear: y,
      });
    }

    // expertise areas = owning registry-faculty buckets
    const area = areaMap.get(r.registry_faculty_name) ?? {
      sections: 0,
      courses: new Set<string>(),
    };
    area.sections += sections;
    area.courses.add(r.course_code);
    areaMap.set(r.registry_faculty_name, area);
  }

  const byYear: TeachingYearPoint[] = [];
  for (let y = fromBE; y <= latestBE; y++) {
    byYear.push(
      byYearMap.get(y) ?? {
        acadYearBE: y,
        sections: 0,
        contactHrsPerWeekTotal: 0,
        studentsTaught: 0,
      },
    );
  }
  // Trim trailing zero-student years — the registrar's "ongoing" term
  // opens months before any student has enrolled, and showing it as a
  // 0-bar at the right edge of the chart is misleading. Internal gap
  // years (e.g., a sabbatical mid-window) stay so the timeline shape
  // is honest. Leading zeros also stay — they show "teaching started
  // mid-window" which is a fair thing to surface.
  while (byYear.length > 0 && byYear[byYear.length - 1]!.studentsTaught === 0) {
    byYear.pop();
  }

  // Top courses by section count, then by students-taught as tiebreak.
  const topCourses: TeachingTopCourse[] = [...courseMap.values()]
    .sort((a, b) => b.sections - a.sections || b.studentsTaught - a.studentsTaught)
    .slice(0, TOP_COURSES_LIMIT)
    .map((c) => ({
      courseCode: c.courseCode,
      courseNameTh: c.courseNameTh,
      courseNameEn: c.courseNameEn,
      sections: c.sections,
      studentsTaught: c.studentsTaught,
      firstYearBE: c.firstYear,
      lastYearBE: c.lastYear,
    }));

  const expertiseAreas = [...areaMap.entries()]
    .map(([registryFacultyName, v]) => ({
      registryFacultyName,
      sections: v.sections,
      distinctCourses: v.courses.size,
    }))
    .sort((a, b) => b.sections - a.sections);

  const activeSemCount = activeSemesters.size;
  const totalContactHrsAcrossActiveSemesters = [...byYearMap.values()].reduce(
    (s, y) => s + y.contactHrsPerWeekTotal,
    0,
  );
  const avgHrsWeekActive =
    activeSemCount > 0 ? totalContactHrsAcrossActiveSemesters / activeSemCount : 0;

  return {
    available: true,
    windowYearsBE: { from: fromBE, to: latestBE },
    kpis: {
      totalSections: totSections,
      totalDistinctCourses: courseMap.size,
      activeSemesters: activeSemCount,
      avgContactHrsPerWeekActive: avgHrsWeekActive,
      totalStudentsTaught: totStudents,
    },
    byYear,
    topCourses,
    expertiseAreas,
  };
}

function emptyProfile(fromBE: number, latestBE: number): TeachingProfile {
  const byYear: TeachingYearPoint[] = [];
  for (let y = fromBE; y <= latestBE; y++) {
    byYear.push({
      acadYearBE: y,
      sections: 0,
      contactHrsPerWeekTotal: 0,
      studentsTaught: 0,
    });
  }
  return {
    available: false,
    windowYearsBE: { from: fromBE, to: latestBE },
    kpis: {
      totalSections: 0,
      totalDistinctCourses: 0,
      activeSemesters: 0,
      avgContactHrsPerWeekActive: 0,
      totalStudentsTaught: 0,
    },
    byYear,
    topCourses: [],
    expertiseAreas: [],
  };
}
