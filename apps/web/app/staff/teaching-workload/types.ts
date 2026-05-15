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

// By-teacher drill-down: Faculty → Teacher
export interface TeacherRow {
  facultyMemberId: string | null;
  displayName: string;
  rank: string | null;
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

export interface TeacherFacultyGroup {
  facultyId: string | null;
  facultyName: string;
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

export interface TeachersResponse {
  acadYearBE: number | null;
  semester: number | null;
  rows: TeacherFacultyGroup[];
  totals: {
    teachers: number;
    sections: number;
    totalContactHrsPerWeek: number;
    avgContactHrsPerTeacher: number;
    studentsTaught: number;
    teamTaughtSections: number;
  };
}
