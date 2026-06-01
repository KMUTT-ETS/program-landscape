import { Injectable } from '@nestjs/common';
import { prisma } from '@kku/db';
import {
  AdmissionCampaignsService,
  type CampaignDashboardPayload,
  type CampaignProgramRow,
  type CampaignMetrics,
} from './admission-campaigns.service';

// ─────────────────────────────────────────────────────────────────────────────
// Undergraduate recruitment rollup — compatibility shim.
//
// The dedicated /education/recruitment dashboard (POWERBI.ADMISSION_STAT_CURRID
// via tcas_admission_funnels) was retired. This service now DELEGATES to
// AdmissionCampaignsService (POWERBI.ADMISSION_STAT) and re-shapes its payload
// into the legacy RecruitmentDashboardPayload so the remaining consumers —
// the cockpit recruitment panel and the AI-analyst recruitment-dashboard tool
// — keep working unchanged, on the new data.
// ─────────────────────────────────────────────────────────────────────────────

// Kept for back-compat: callers that narrow to the unmapped bucket. Maps onto
// AdmissionCampaignsService's UNASSIGNED bucket at the call boundary.
export const UNDEFINED_FACULTY_ID = '__common_undefined__';
const UNDEFINED_FACULTY_CODE = 'COMMON';
const UNDEFINED_FACULTY_NAME_EN = 'Common / Undefined Program';

export interface RecruitmentFilters {
  entryYearBE?: number | null;
  facultyId?: string | null;
  level?: string | null;
  round?: string | null;
}

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
    appliedFilters: RecruitmentFilters;
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

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

// CampaignMetrics → the legacy FunnelTotals shape.
function toTotals(m: CampaignMetrics, programCount: number, rounds: number): FunnelTotals {
  return {
    seats: m.seats ?? 0,
    planPerYear: m.plan ?? 0,
    applicants: m.applicants,
    passed: m.passed,
    sendCh: m.sendCh,
    confirmCh: m.confirmCh,
    sendReg: m.sendReg,
    regReported: m.enrolled,
    rounds,
    programCount,
  };
}

function sumMetrics(items: CampaignMetrics[]): CampaignMetrics {
  let plan: number | null = null;
  let seats: number | null = null;
  let applicants = 0, passed = 0, sendCh = 0, confirmCh = 0, sendReg = 0, enrolled = 0;
  for (const m of items) {
    if (m.plan != null) plan = (plan ?? 0) + m.plan;
    if (m.seats != null) seats = (seats ?? 0) + m.seats;
    applicants += m.applicants;
    passed += m.passed;
    sendCh += m.sendCh;
    confirmCh += m.confirmCh;
    sendReg += m.sendReg;
    enrolled += m.enrolled;
  }
  return {
    plan, seats, applicants, passed, sendCh, confirmCh, sendReg, enrolled,
    percentAdmit: plan != null && plan > 0 ? enrolled / plan : null,
    competitionRate: seats != null && seats > 0 ? applicants / seats : null,
  };
}

@Injectable()
export class RecruitmentService {
  constructor(private readonly campaigns: AdmissionCampaignsService) {}

  async getDashboard(filters: RecruitmentFilters = {}): Promise<RecruitmentDashboardPayload> {
    const c: CampaignDashboardPayload = await this.campaigns.getDashboard({
      acadYearBE: filters.entryYearBE ?? null,
      // The unmapped-bucket sentinel differs between services; translate it.
      facultyId:
        filters.facultyId === UNDEFINED_FACULTY_ID ? '__unassigned__' : (filters.facultyId ?? null),
      round: filters.round ?? null,
    });

    // Faculty code/name-en lookup (the campaign payload carries only id + Thai name).
    const faculties = await prisma.faculty.findMany({ select: { id: true, code: true, nameEn: true } });
    const facLookup = new Map(faculties.map((f) => [f.id, f]));

    // ── KPIs ──
    const k = c.kpis;
    const kpis = {
      ...toTotals(k, k.programs, k.campaigns),
      competitionRatio: k.competitionRate,
      fillRate: ratio(k.passed, k.seats ?? 0),
      regYield: ratio(k.enrolled, k.sendCh),
    };

    // ── byRound / byYear ──
    const byRound: RoundRow[] = c.byRound.map((r) => ({
      round: r.round,
      totals: toTotals(r, r.programs, r.campaigns),
    }));
    const byYear: YearTrendRow[] = c.byYear.map((y) => ({
      entryYearBE: y.acadYearBE,
      isComplete: y.isComplete,
      totals: toTotals(y, y.programs, y.campaigns),
    }));

    // ── byFaculty — group the drill programs by faculty ──
    const facGroups = new Map<string, { facultyId: string | null; facultyNameTh: string; programs: CampaignProgramRow[] }>();
    for (const p of c.programs) {
      const key = p.facultyId ?? '__undef__';
      let g = facGroups.get(key);
      if (!g) { g = { facultyId: p.facultyId, facultyNameTh: p.facultyNameTh, programs: [] }; facGroups.set(key, g); }
      g.programs.push(p);
    }
    const byFaculty: FacultyRow[] = [...facGroups.values()]
      .map((g) => {
        const rounds = g.programs.reduce((s, p) => s + p.subPrograms.reduce((t, sp) => t + sp.roundCount, 0), 0);
        const totals = toTotals(sumMetrics(g.programs), g.programs.length, rounds);
        const fac = g.facultyId ? facLookup.get(g.facultyId) : undefined;
        return {
          facultyId: g.facultyId ?? UNDEFINED_FACULTY_ID,
          facultyCode: fac?.code ?? UNDEFINED_FACULTY_CODE,
          facultyNameTh: g.facultyNameTh,
          facultyNameEn: fac?.nameEn ?? UNDEFINED_FACULTY_NAME_EN,
          programCount: g.programs.length,
          totals,
        };
      })
      .sort((a, b) => b.totals.applicants - a.totals.applicants);

    // ── programs — flatten to per (program × round) drill rows ──
    const programs: ProgramDrillRow[] = [];
    for (const p of c.programs) {
      const fac = p.facultyId ? facLookup.get(p.facultyId) : undefined;
      const firstSub = p.subPrograms[0];
      const byRoundMap = new Map<string, CampaignMetrics[]>();
      for (const sub of p.subPrograms) for (const rd of sub.rounds) {
        (byRoundMap.get(rd.round) ?? byRoundMap.set(rd.round, []).get(rd.round)!).push(rd);
      }
      for (const [round, metricsList] of byRoundMap) {
        const m = sumMetrics(metricsList);
        programs.push({
          programId: p.programId ?? p.programKey,
          programCode: firstSub?.recruitmentProgramId ?? '',
          facultyCode: fac?.code ?? UNDEFINED_FACULTY_CODE,
          facultyNameTh: p.facultyNameTh,
          programNameTh: p.programNameTh,
          programNameEn: p.programNameEn ?? '',
          level: '',
          mhesiCurrId: firstSub?.currId ?? '',
          round,
          entryYearBE: c.meta.selectedYear ?? 0,
          enrollSeats: m.seats,
          planPerYear: p.plan,
          totalApplicants: m.applicants,
          totalPassed: m.passed,
          sendClearinghouse: m.sendCh,
          confirmClearinghouse: m.confirmCh,
          sendRegReported: m.sendReg,
          regReported: m.enrolled,
          competitionRatio: m.competitionRate,
          planYield: p.plan != null && p.plan > 0 ? m.enrolled / p.plan : null,
        });
      }
    }
    programs.sort((a, b) => (b.totalApplicants ?? 0) - (a.totalApplicants ?? 0));

    // ── meta ──
    const latestYearOverall = c.meta.availableYears[0] ?? null;
    const inProgressYear =
      latestYearOverall !== null &&
      (c.meta.latestCompleteYear === null || latestYearOverall > c.meta.latestCompleteYear)
        ? latestYearOverall
        : null;
    const facultiesWithData: FacultyOption[] = c.meta.facultiesWithData.map((f) => {
      const fac = facLookup.get(f.id);
      return { id: f.id, code: fac?.code ?? '', nameTh: f.nameTh, nameEn: fac?.nameEn ?? '' };
    });

    return {
      meta: {
        latestCompleteYear: c.meta.latestCompleteYear,
        latestYearOverall,
        inProgressYear: inProgressYear !== c.meta.selectedYear ? inProgressYear : null,
        availableYears: c.meta.availableYears,
        availableRounds: c.meta.availableRounds,
        selectedYear: c.meta.selectedYear,
        selectedRound: c.meta.selectedRound,
        appliedFilters: filters,
        selectedYearIsComplete: c.meta.selectedYearIsComplete,
        facultiesWithData,
        hasUndefinedBucket: c.meta.unmappedProgramCount > 0 || c.meta.hasUnassignedFaculty,
      },
      kpis,
      byFaculty,
      byRound,
      byYear,
      programs,
      // In-progress banner totals are surfaced by the dedicated campaigns
      // dashboard; the cockpit rollup omits the separate info banner.
      inProgressInfo: null,
    };
  }
}
