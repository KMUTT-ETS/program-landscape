// Response shapes — mirror apps/api/src/education/class-offerings.service.ts.

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
  totalSeatsOffered: number;
  totalSeatsFilled: number;
  fillRate: number;
  distinctCourses: number;
  distinctFaculties: number;
  distinctTeachers: number;
  totalCreditsDelivered: number;
  zeroEnrollmentSections: number;
  geSections: number;
}

export interface HeatmapCell {
  acadYearBE: number;
  semester: number;
  sections: number;
  seatsOffered: number;
  seatsFilled: number;
  fillRate: number;
}

export interface HeatmapResponse {
  rows: Array<{ facultyName: string; cells: HeatmapCell[] }>;
  yearSemesters: Array<{ acadYearBE: number; semester: number; label: string }>;
}

export interface DistributionBucket {
  bucket: string;
  rangeLowerPct: number;
  rangeUpperPct: number;
  sections: number;
  pctOfTotal: number;
}

export interface DistributionResponse {
  acadYearBE: number;
  semester: number;
  totalSections: number;
  buckets: DistributionBucket[];
}

export interface GeProvider {
  registryFacultyName: string;
  isGeInstitute: boolean;
  sections: number;
  seatsOffered: number;
  seatsFilled: number;
  fillRate: number;
  distinctCourses: number;
}

export interface GeTrendPoint {
  acadYearBE: number;
  semester: number;
  label: string;
  sections: number;
  seatsOffered: number;
  seatsFilled: number;
  fillRate: number;
}

export interface GeResponse {
  byProvider: GeProvider[];
  trend: GeTrendPoint[];
  totals: {
    sections: number;
    seatsOffered: number;
    seatsFilled: number;
    fillRate: number;
  };
}

// Drill-down deep-dive — Faculty → Level → Course
export interface DeepDiveCourseRow {
  courseCode: string;
  courseNameTh: string | null;
  courseNameEn: string | null;
  isGeneralEducation: boolean;
  sections: number;
  seatsOffered: number;
  seatsFilled: number;
  fillRate: number;
  creditTotal: number | null;
  programsCount: number;
}

export interface DeepDiveLevelGroup {
  levelName: string;
  children: DeepDiveCourseRow[];
  sections: number;
  seatsOffered: number;
  seatsFilled: number;
  fillRate: number;
  totalCreditsDelivered: number;
}

export interface DeepDiveFacultyGroup {
  facultyName: string;
  children: DeepDiveLevelGroup[];
  sections: number;
  seatsOffered: number;
  seatsFilled: number;
  fillRate: number;
  totalCreditsDelivered: number;
  distinctCourses: number;
}

export interface DeepDiveResponse {
  acadYearBE: number;
  semester: number;
  rows: DeepDiveFacultyGroup[];
  totals: {
    sections: number;
    seatsOffered: number;
    seatsFilled: number;
    fillRate: number;
    totalCreditsDelivered: number;
    distinctCourses: number;
  };
}
