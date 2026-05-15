// Response shapes — mirrored from apps/api/src/education/class-offerings.service.ts.

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

export interface DeepDiveRow {
  courseCode: string;
  courseNameTh: string | null;
  courseNameEn: string | null;
  registryFacultyName: string;
  levelName: string;
  isGeneralEducation: boolean;
  sections: number;
  seatsOffered: number;
  seatsFilled: number;
  fillRate: number;
  creditTotal: number | null;
  programsCount: number;
}

export interface DeepDiveResponse {
  acadYearBE: number;
  semester: number;
  rows: DeepDiveRow[];
  truncated: boolean;
}
