// Response shapes — mirrored from apps/api/src/staff-dashboard/teaching-workload.service.ts.

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

export interface TeacherRow {
  kkuEmail: string;
  facultyMemberId: string | null;
  nameTh: string | null;
  nameEn: string | null;
  rank: string | null;
  facultyId: string | null;
  facultyName: string | null;
  sections: number;
  distinctCourses: number;
  totalContactHrsPerWeek: number;
  studentsTaught: number;
  teamTaughtSections: number;
}

export interface TeachersResponse {
  acadYearBE: number | null;
  semester: number | null;
  rows: TeacherRow[];
  truncated: boolean;
}
