// Recruitment rollup payload — mirrors apps/api/src/education/recruitment.service.ts
// (RecruitmentService, now an ADMISSION_STAT compatibility shim). Lives here so
// the cockpit recruitment panel doesn't depend on the retired
// /education/recruitment dashboard's client file.

export interface FunnelTotals {
  seats: number;
  planPerYear: number;
  applicants: number;
  passed: number;
  sendCh: number;
  confirmCh: number;
  sendReg: number;
  regReported: number;
  rounds: number;
  programCount: number;
}

export interface FacultyRow {
  facultyId: string;
  facultyCode: string;
  facultyNameTh: string;
  facultyNameEn: string;
  programCount: number;
  totals: FunnelTotals;
}

export interface RoundRow {
  round: string;
  totals: FunnelTotals;
}

export interface YearTrendRow {
  entryYearBE: number;
  isComplete: boolean;
  totals: FunnelTotals;
}

export interface ProgramDrillRow {
  programId: string;
  programCode: string;
  facultyCode: string;
  facultyNameTh: string;
  programNameTh: string;
  programNameEn: string;
  level: string;
  mhesiCurrId: string;
  round: string;
  entryYearBE: number;
  enrollSeats: number | null;
  planPerYear: number | null;
  totalApplicants: number | null;
  totalPassed: number | null;
  sendClearinghouse: number | null;
  confirmClearinghouse: number | null;
  sendRegReported: number | null;
  regReported: number | null;
  competitionRatio: number | null;
  planYield: number | null;
}

export interface FacultyOption {
  id: string;
  code: string;
  nameTh: string;
  nameEn: string;
}

export interface RecruitmentDashboardPayload {
  meta: {
    latestCompleteYear: number | null;
    latestYearOverall: number | null;
    inProgressYear: number | null;
    availableYears: number[];
    availableRounds: string[];
    selectedYear: number | null;
    selectedRound: string | null;
    appliedFilters: {
      entryYearBE?: number | null;
      facultyId?: string | null;
      level?: string | null;
      round?: string | null;
    };
    selectedYearIsComplete: boolean;
    facultiesWithData: FacultyOption[];
    hasUndefinedBucket: boolean;
  };
  kpis: FunnelTotals & {
    competitionRatio: number | null;
    fillRate: number | null;
    regYield: number | null;
  };
  byFaculty: FacultyRow[];
  byRound: RoundRow[];
  byYear: YearTrendRow[];
  programs: ProgramDrillRow[];
  inProgressInfo: (FunnelTotals & { entryYearBE: number }) | null;
}
