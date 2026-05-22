// Response shapes — mirror apps/api/src/staff-dashboard/teaching-workload.service.ts.

export interface FilterOptions {
  years: number[];
  semesters: number[];
  levels: string[];
  faculties: string[];
}

export interface Summary {
  acadYearBE: number | null;
  semester: number | null;
  totalSections: number;
  totalTeachers: number;
  resolvedTeachers: number;
  unresolvedTeachers: number;
  totalContactHrsPerWeek: number;
  avgContactHrsPerTeacher: number;
  teamTaughtSections: number;
  totalStudentsTaught: number;
}

export interface HistogramBucket {
  bucket: string;
  rangeLo: number;
  rangeHi: number;
  teachers: number;
  pctOfTotal: number;
  band: 'UNDER' | 'NORMAL' | 'OVER';
}

export interface HistogramResponse {
  acadYearBE: number | null;
  semester: number | null;
  totalTeachers: number;
  buckets: HistogramBucket[];
}

export interface ByFacultyRow {
  facultyId: string | null;
  facultyName: string;
  teachers: number;
  sections: number;
  totalContactHrsPerWeek: number;
  avgContactHrsPerTeacher: number;
  studentsTaught: number;
}

export interface ByFacultyResponse {
  acadYearBE: number | null;
  semester: number | null;
  rows: ByFacultyRow[];
  unresolvedRow: {
    teachers: number;
    sections: number;
    totalContactHrsPerWeek: number;
    avgContactHrsPerTeacher: number;
    studentsTaught: number;
  };
}

export interface StudentsByFacultyRow {
  facultyId: string | null;
  facultyName: string;
  teachers: number;
  sections: number;
  studentsTaught: number;
  studentsPerTeacher: number;
}

export interface StudentsByFacultyResponse {
  acadYearBE: number | null;
  semester: number | null;
  rows: StudentsByFacultyRow[];
  totals: {
    teachers: number;
    sections: number;
    studentsTaught: number;
  };
}

// By-teacher drill-down: Faculty → Program → Teacher.
// Workload figures on a TeacherRow are the teacher's ACTUAL totals across
// every section they teach — not split or weighted per program. A teacher
// who is a curriculum member of several programs appears under each one,
// every node showing the same full workload.
export interface TeacherRow {
  facultyMemberId: string | null;
  displayName: string;
  rank: string | null;
  /** ProgramFaculty role in this program (COORDINATOR / CORE / SUPPORT).
   *  Null in the "not attached to a curriculum" fallback node. */
  programRole: string | null;
  /** Number of programs the teacher is a curriculum member of. >1 means
   *  this row repeats under each — repeated, not additive. 0 = fallback. */
  programCount: number;
  sections: number;
  distinctCourses: number;
  /** Σ lecture-hrs per week (COURSEUNIT "B" of "A (B-C-D)"). */
  lectureHrsPerWeek: number;
  /** Σ lab-hrs per week (COURSEUNIT "C"). */
  labHrsPerWeek: number;
  totalContactHrsPerWeek: number;
  studentsTaught: number;
  teamTaughtSections: number;
}

// Middle (program) tier. `programId` is null for the synthetic
// "Not attached to a curriculum" node.
export interface TeacherProgramGroup {
  programId: string | null;
  programCode: string | null;
  programName: string;
  programLevel: string | null;
  children: TeacherRow[];
  teachers: number;
  sections: number;
  lectureHrsPerWeek: number;
  labHrsPerWeek: number;
  totalContactHrsPerWeek: number;
  avgContactHrsPerTeacher: number;
  studentsTaught: number;
  teamTaughtSections: number;
}

export interface TeacherFacultyGroup {
  facultyId: string | null;
  facultyName: string;
  programs: TeacherProgramGroup[];
  /** Distinct teachers — a teacher in several of the faculty's programs
   *  is counted once. */
  teachers: number;
  sections: number;
  lectureHrsPerWeek: number;
  labHrsPerWeek: number;
  totalContactHrsPerWeek: number;
  avgContactHrsPerTeacher: number;
  studentsTaught: number;
  teamTaughtSections: number;
}

export interface TeachersResponse {
  acadYearBE: number | null;
  semester: number | null;
  rows: TeacherFacultyGroup[];
  totals: {
    teachers: number;
    programs: number;
    sections: number;
    lectureHrsPerWeek: number;
    labHrsPerWeek: number;
    totalContactHrsPerWeek: number;
    avgContactHrsPerTeacher: number;
    studentsTaught: number;
    teamTaughtSections: number;
  };
}
