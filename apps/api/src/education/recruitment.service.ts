import { Injectable } from '@nestjs/common';
import { Prisma, prisma } from '@kku/db';

// ─────────────────────────────────────────────────────────────────────────────
// Undergraduate recruitment dashboard — read-side helpers backed by
// tcas_admission_funnels (POWERBI.ADMISSION_STAT_CURRID).
//
// Splits "complete" (every round in the year has reg_reported populated)
// from "in-progress" (some rounds still pending). Scoring uses complete
// only; the in-progress payload is informational, surfaced in a separate
// banner on the dashboard.
//
// All endpoints honour optional filters: entryYearBE, facultyId, level.
// ─────────────────────────────────────────────────────────────────────────────

export interface RecruitmentFilters {
  entryYearBE?: number | null;
  facultyId?: string | null;
  level?: string | null;
}

export interface FunnelTotals {
  /** Per-round ENROLLSEAT, summed. Intentionally over-allocated vs the
   *  registrar's actual annual plan to compensate for no-show. */
  seats: number;
  /** PLAN_PER_YEAR — the registrar's actual annual seat target.
   *  Aggregated as SUM(MAX_per_program) so each program contributes
   *  its plan once regardless of how many rounds it has. */
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
  /** Annual planned seats — same value across rounds of the same
   *  (program × year), shown on every row so analyst can see the
   *  per-round allocation against the year target. */
  planPerYear: number | null;
  totalApplicants: number | null;
  totalPassed: number | null;
  sendClearinghouse: number | null;
  confirmClearinghouse: number | null;
  sendRegReported: number | null;
  regReported: number | null;
  competitionRatio: number | null;
  registrationYield: number | null;
}

export interface RecruitmentDashboardPayload {
  meta: {
    latestCompleteYear: number | null;
    latestYearOverall: number | null;
    inProgressYear: number | null;
    availableYears: number[];
    selectedYear: number | null;
    appliedFilters: RecruitmentFilters;
    /** True when the SELECTED year is in-progress — the UI shows a
     *  partial-data banner. */
    selectedYearIsComplete: boolean;
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
  /** When the selected year is COMPLETE, this carries the in-progress
   *  year's partial totals for an info-only banner. Null when the
   *  selected year IS the in-progress year (the KPIs already show it). */
  inProgressInfo: (FunnelTotals & { entryYearBE: number }) | null;
}

@Injectable()
export class RecruitmentService {
  // ──────────────────────────────────────────────────────────────────
  // Year status (complete vs in-progress).
  //
  // Calendar-based: a year is COMPLETE when its CE year (BE - 543) is
  // strictly less than the current CE year. Thai TCAS rounds run
  // Jan-Aug; registration wraps in Sep-Oct. By Jan 1 of the following
  // calendar year, every round of the prior cohort is finished.
  //
  // We tried a per-row "every row has reg_reported > 0" heuristic
  // first — that worked at program scope but failed at faculty/
  // university scope because some rounds legitimately had 0 reportees
  // (programs that simply didn't fill in a particular round). Calendar
  // is robust to that and matches the operator mental model.
  // ──────────────────────────────────────────────────────────────────
  private isYearComplete(entryYearBE: number, now: Date = new Date()): boolean {
    return entryYearBE - 543 < now.getUTCFullYear();
  }

  private async yearStatus(filters: RecruitmentFilters): Promise<{
    available: number[];
    latestComplete: number | null;
    latestOverall: number | null;
  }> {
    const programFilter = this.programFilter(filters);
    const rows = await prisma.$queryRaw<Array<{ entry_year_be: number }>>`
      SELECT DISTINCT f.entry_year_be
      FROM tcas_admission_funnels f
      JOIN programs p ON p.id = f.program_id
      WHERE p.status = 'ACTIVE' AND p.sequence_no_from_sheet IS NOT NULL
        ${programFilter}
      ORDER BY f.entry_year_be DESC
    `;
    const available = rows.map((r) => r.entry_year_be);
    const latestOverall = available[0] ?? null;
    const latestComplete = available.find((y) => this.isYearComplete(y)) ?? null;
    return { available, latestComplete, latestOverall };
  }

  // ──────────────────────────────────────────────────────────────────
  // SQL filter fragment for the program scope (faculty + level).
  // Returns Prisma.empty when no scope filter applies.
  // ──────────────────────────────────────────────────────────────────
  private programFilter(filters: RecruitmentFilters): Prisma.Sql {
    const clauses: Prisma.Sql[] = [];
    if (filters.facultyId) {
      clauses.push(Prisma.sql`AND p.faculty_id = ${filters.facultyId}`);
    }
    if (filters.level) {
      clauses.push(Prisma.sql`AND p.level::text = ${filters.level}`);
    }
    if (clauses.length === 0) return Prisma.empty;
    return Prisma.join(clauses, ' ');
  }

  // ──────────────────────────────────────────────────────────────────
  // Aggregate funnel totals at scope × year.
  // ──────────────────────────────────────────────────────────────────
  private async totalsForYear(
    year: number,
    filters: RecruitmentFilters,
  ): Promise<FunnelTotals> {
    const programFilter = this.programFilter(filters);
    // PLAN_PER_YEAR must sum-MAX-by-program (not multi-count across
    // rounds). Funnel columns sum across all rows. Two CTEs.
    const rows = await prisma.$queryRaw<
      Array<{
        seats: bigint | null;
        plan_per_year: bigint | null;
        applicants: bigint | null;
        passed: bigint | null;
        send_ch: bigint | null;
        confirm_ch: bigint | null;
        send_reg: bigint | null;
        reg_reported: bigint | null;
        rounds: bigint;
        programs: bigint;
      }>
    >`
      WITH eligible AS (
        SELECT f.*
        FROM tcas_admission_funnels f
        JOIN programs p ON p.id = f.program_id
        WHERE p.status = 'ACTIVE' AND p.sequence_no_from_sheet IS NOT NULL
          AND f.entry_year_be = ${year}
          ${programFilter}
      ),
      per_program AS (
        SELECT program_id, MAX(plan_per_year) AS plan_per_year
        FROM eligible WHERE program_id IS NOT NULL GROUP BY program_id
      ),
      funnel AS (
        SELECT
          COALESCE(SUM(enroll_seats), 0)::bigint AS seats,
          COALESCE(SUM(total_applicants), 0)::bigint AS applicants,
          COALESCE(SUM(total_passed), 0)::bigint AS passed,
          COALESCE(SUM(send_clearinghouse), 0)::bigint AS send_ch,
          COALESCE(SUM(confirm_clearinghouse), 0)::bigint AS confirm_ch,
          COALESCE(SUM(send_reg_reported), 0)::bigint AS send_reg,
          COALESCE(SUM(reg_reported), 0)::bigint AS reg_reported,
          COUNT(*)::bigint AS rounds,
          COUNT(DISTINCT program_id)::bigint AS programs
        FROM eligible
      )
      SELECT funnel.*,
        (SELECT COALESCE(SUM(plan_per_year), 0)::bigint FROM per_program) AS plan_per_year
      FROM funnel;
    `;
    const r = rows[0];
    return {
      seats: Number(r?.seats ?? 0n),
      planPerYear: Number(r?.plan_per_year ?? 0n),
      applicants: Number(r?.applicants ?? 0n),
      passed: Number(r?.passed ?? 0n),
      sendCh: Number(r?.send_ch ?? 0n),
      confirmCh: Number(r?.confirm_ch ?? 0n),
      sendReg: Number(r?.send_reg ?? 0n),
      regReported: Number(r?.reg_reported ?? 0n),
      rounds: Number(r?.rounds ?? 0n),
      programCount: Number(r?.programs ?? 0n),
    };
  }

  private async byFaculty(
    year: number,
    filters: RecruitmentFilters,
  ): Promise<FacultyRow[]> {
    const programFilter = this.programFilter(filters);
    // Two-stage aggregation: roll PLAN_PER_YEAR up by MAX-per-program,
    // then SUM into the faculty bucket alongside the per-row funnel sums.
    // Start from `faculties` (LEFT JOIN funnel data) so every academic
    // faculty with at least one canonical-active program appears in
    // the dashboard — even faculties with no admissions activity for
    // the selected year (graduate-only faculties, faculties with no
    // current cohort) show up with zero-count rows. Sorted by Thai
    // name to match the rollup tree.
    const facultyFilterScope: Prisma.Sql = filters.facultyId
      ? Prisma.sql`AND fac.id = ${filters.facultyId}`
      : Prisma.empty;
    const rows = await prisma.$queryRaw<
      Array<{
        faculty_id: string;
        faculty_code: string;
        faculty_name_th: string;
        faculty_name_en: string;
        program_count: bigint;
        seats: bigint | null;
        plan_per_year: bigint | null;
        applicants: bigint | null;
        passed: bigint | null;
        send_ch: bigint | null;
        confirm_ch: bigint | null;
        send_reg: bigint | null;
        reg_reported: bigint | null;
        rounds: bigint;
      }>
    >`
      WITH eligible AS (
        SELECT f.*, p.faculty_id AS faculty_id
        FROM tcas_admission_funnels f
        JOIN programs p ON p.id = f.program_id
        WHERE p.status = 'ACTIVE' AND p.sequence_no_from_sheet IS NOT NULL
          AND f.entry_year_be = ${year}
          ${programFilter}
      ),
      per_program AS (
        SELECT faculty_id, program_id, MAX(plan_per_year) AS plan_per_year
        FROM eligible WHERE program_id IS NOT NULL
        GROUP BY faculty_id, program_id
      ),
      plan_by_fac AS (
        SELECT faculty_id, COALESCE(SUM(plan_per_year), 0)::bigint AS plan_per_year
        FROM per_program GROUP BY faculty_id
      ),
      funnel_by_fac AS (
        SELECT
          e.faculty_id,
          COUNT(DISTINCT e.program_id)::bigint AS program_count,
          COALESCE(SUM(e.enroll_seats), 0)::bigint AS seats,
          COALESCE(SUM(e.total_applicants), 0)::bigint AS applicants,
          COALESCE(SUM(e.total_passed), 0)::bigint AS passed,
          COALESCE(SUM(e.send_clearinghouse), 0)::bigint AS send_ch,
          COALESCE(SUM(e.confirm_clearinghouse), 0)::bigint AS confirm_ch,
          COALESCE(SUM(e.send_reg_reported), 0)::bigint AS send_reg,
          COALESCE(SUM(e.reg_reported), 0)::bigint AS reg_reported,
          COUNT(*)::bigint AS rounds
        FROM eligible e GROUP BY e.faculty_id
      )
      SELECT
        fac.id AS faculty_id,
        fac.code AS faculty_code,
        fac.name_th AS faculty_name_th,
        fac.name_en AS faculty_name_en,
        COALESCE(fb.program_count, 0)::bigint AS program_count,
        COALESCE(fb.seats, 0)::bigint AS seats,
        COALESCE(fb.applicants, 0)::bigint AS applicants,
        COALESCE(fb.passed, 0)::bigint AS passed,
        COALESCE(fb.send_ch, 0)::bigint AS send_ch,
        COALESCE(fb.confirm_ch, 0)::bigint AS confirm_ch,
        COALESCE(fb.send_reg, 0)::bigint AS send_reg,
        COALESCE(fb.reg_reported, 0)::bigint AS reg_reported,
        COALESCE(fb.rounds, 0)::bigint AS rounds,
        COALESCE(pf.plan_per_year, 0)::bigint AS plan_per_year
      FROM faculties fac
      LEFT JOIN funnel_by_fac fb ON fb.faculty_id = fac.id
      LEFT JOIN plan_by_fac pf ON pf.faculty_id = fac.id
      WHERE fac.kind = 'ACADEMIC'
        AND EXISTS (
          SELECT 1 FROM programs p
          WHERE p.faculty_id = fac.id
            AND p.status = 'ACTIVE'
            AND p.sequence_no_from_sheet IS NOT NULL
        )
        ${facultyFilterScope}
      ORDER BY fac.name_th ASC;
    `;
    return rows.map((r) => ({
      facultyId: r.faculty_id,
      facultyCode: r.faculty_code,
      facultyNameTh: r.faculty_name_th,
      facultyNameEn: r.faculty_name_en,
      programCount: Number(r.program_count),
      totals: {
        seats: Number(r.seats ?? 0n),
        planPerYear: Number(r.plan_per_year ?? 0n),
        applicants: Number(r.applicants ?? 0n),
        passed: Number(r.passed ?? 0n),
        sendCh: Number(r.send_ch ?? 0n),
        confirmCh: Number(r.confirm_ch ?? 0n),
        sendReg: Number(r.send_reg ?? 0n),
        regReported: Number(r.reg_reported ?? 0n),
        rounds: Number(r.rounds),
        programCount: Number(r.program_count),
      },
    }));
  }

  private async byRound(
    year: number,
    filters: RecruitmentFilters,
  ): Promise<RoundRow[]> {
    const programFilter = this.programFilter(filters);
    const rows = await prisma.$queryRaw<
      Array<{
        round: string;
        seats: bigint | null;
        applicants: bigint | null;
        passed: bigint | null;
        send_ch: bigint | null;
        confirm_ch: bigint | null;
        send_reg: bigint | null;
        reg_reported: bigint | null;
        rounds: bigint;
        programs: bigint;
      }>
    >`
      SELECT
        f.round,
        COALESCE(SUM(f.enroll_seats), 0)::bigint AS seats,
        COALESCE(SUM(f.total_applicants), 0)::bigint AS applicants,
        COALESCE(SUM(f.total_passed), 0)::bigint AS passed,
        COALESCE(SUM(f.send_clearinghouse), 0)::bigint AS send_ch,
        COALESCE(SUM(f.confirm_clearinghouse), 0)::bigint AS confirm_ch,
        COALESCE(SUM(f.send_reg_reported), 0)::bigint AS send_reg,
        COALESCE(SUM(f.reg_reported), 0)::bigint AS reg_reported,
        COUNT(*)::bigint AS rounds,
        COUNT(DISTINCT f.program_id)::bigint AS programs
      FROM tcas_admission_funnels f
      JOIN programs p ON p.id = f.program_id
      WHERE p.status = 'ACTIVE' AND p.sequence_no_from_sheet IS NOT NULL
        AND f.entry_year_be = ${year}
        ${programFilter}
      GROUP BY f.round
      ORDER BY f.round;
    `;
    return rows.map((r) => ({
      round: r.round,
      totals: {
        seats: Number(r.seats ?? 0n),
        // PLAN_PER_YEAR is annual, not per-round — set 0 here. The
        // round breakdown table doesn't render this column anyway.
        planPerYear: 0,
        applicants: Number(r.applicants ?? 0n),
        passed: Number(r.passed ?? 0n),
        sendCh: Number(r.send_ch ?? 0n),
        confirmCh: Number(r.confirm_ch ?? 0n),
        sendReg: Number(r.send_reg ?? 0n),
        regReported: Number(r.reg_reported ?? 0n),
        rounds: Number(r.rounds),
        programCount: Number(r.programs),
      },
    }));
  }

  private async byYear(
    filters: RecruitmentFilters,
  ): Promise<YearTrendRow[]> {
    const programFilter = this.programFilter(filters);
    const rows = await prisma.$queryRaw<
      Array<{
        entry_year_be: number;
        seats: bigint | null;
        plan_per_year: bigint | null;
        applicants: bigint | null;
        passed: bigint | null;
        send_ch: bigint | null;
        confirm_ch: bigint | null;
        send_reg: bigint | null;
        reg_reported: bigint | null;
        rounds: bigint;
        programs: bigint;
      }>
    >`
      WITH eligible AS (
        SELECT f.*
        FROM tcas_admission_funnels f
        JOIN programs p ON p.id = f.program_id
        WHERE p.status = 'ACTIVE' AND p.sequence_no_from_sheet IS NOT NULL
          ${programFilter}
      ),
      per_program_year AS (
        SELECT entry_year_be, program_id, MAX(plan_per_year) AS plan_per_year
        FROM eligible WHERE program_id IS NOT NULL
        GROUP BY entry_year_be, program_id
      ),
      plan_by_year AS (
        SELECT entry_year_be, COALESCE(SUM(plan_per_year), 0)::bigint AS plan_per_year
        FROM per_program_year GROUP BY entry_year_be
      ),
      funnel_by_year AS (
        SELECT
          e.entry_year_be,
          COALESCE(SUM(e.enroll_seats), 0)::bigint AS seats,
          COALESCE(SUM(e.total_applicants), 0)::bigint AS applicants,
          COALESCE(SUM(e.total_passed), 0)::bigint AS passed,
          COALESCE(SUM(e.send_clearinghouse), 0)::bigint AS send_ch,
          COALESCE(SUM(e.confirm_clearinghouse), 0)::bigint AS confirm_ch,
          COALESCE(SUM(e.send_reg_reported), 0)::bigint AS send_reg,
          COALESCE(SUM(e.reg_reported), 0)::bigint AS reg_reported,
          COUNT(*)::bigint AS rounds,
          COUNT(DISTINCT e.program_id)::bigint AS programs
        FROM eligible e GROUP BY e.entry_year_be
      )
      SELECT fy.*, COALESCE(py.plan_per_year, 0)::bigint AS plan_per_year
      FROM funnel_by_year fy
      LEFT JOIN plan_by_year py ON py.entry_year_be = fy.entry_year_be
      ORDER BY fy.entry_year_be ASC;
    `;
    return rows.map((r) => {
      const isComplete = this.isYearComplete(r.entry_year_be);
      return {
        entryYearBE: r.entry_year_be,
        isComplete,
        totals: {
          seats: Number(r.seats ?? 0n),
          planPerYear: Number(r.plan_per_year ?? 0n),
          applicants: Number(r.applicants ?? 0n),
          passed: Number(r.passed ?? 0n),
          sendCh: Number(r.send_ch ?? 0n),
          confirmCh: Number(r.confirm_ch ?? 0n),
          sendReg: Number(r.send_reg ?? 0n),
          regReported: Number(r.reg_reported ?? 0n),
          rounds: Number(r.rounds),
          programCount: Number(r.programs),
        },
      };
    });
  }

  private async programDrill(
    year: number,
    filters: RecruitmentFilters,
  ): Promise<ProgramDrillRow[]> {
    const where: Prisma.TcasAdmissionFunnelWhereInput = {
      entryYearBE: year,
      programId: { not: null },
      program: {
        status: 'ACTIVE',
        sequenceNoFromSheet: { not: null },
        ...(filters.facultyId ? { facultyId: filters.facultyId } : {}),
        ...(filters.level
          ? { level: filters.level as 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA' }
          : {}),
      },
    };
    const rows = await prisma.tcasAdmissionFunnel.findMany({
      where,
      include: {
        program: {
          select: {
            id: true,
            code: true,
            nameTh: true,
            nameEn: true,
            level: true,
            faculty: { select: { code: true, nameTh: true } },
          },
        },
      },
      orderBy: [{ program: { code: 'asc' } }, { round: 'asc' }],
      take: 2000,
    });
    return rows
      .filter((r) => r.program !== null)
      .map((r) => {
        const ratio =
          r.enrollSeats && r.enrollSeats > 0 && r.totalApplicants !== null
            ? r.totalApplicants / r.enrollSeats
            : null;
        const yieldRate =
          r.sendClearinghouse && r.sendClearinghouse > 0 && r.regReported !== null
            ? r.regReported / r.sendClearinghouse
            : null;
        return {
          programId: r.program!.id,
          programCode: r.program!.code,
          facultyCode: r.program!.faculty.code,
          facultyNameTh: r.program!.faculty.nameTh,
          programNameTh: r.program!.nameTh,
          programNameEn: r.program!.nameEn,
          level: String(r.program!.level),
          mhesiCurrId: r.mhesiCurrId,
          round: r.round,
          entryYearBE: r.entryYearBE,
          enrollSeats: r.enrollSeats,
          planPerYear: r.planPerYear,
          totalApplicants: r.totalApplicants,
          totalPassed: r.totalPassed,
          sendClearinghouse: r.sendClearinghouse,
          confirmClearinghouse: r.confirmClearinghouse,
          sendRegReported: r.sendRegReported,
          regReported: r.regReported,
          competitionRatio: ratio,
          registrationYield: yieldRate,
        };
      });
  }

  // ──────────────────────────────────────────────────────────────────
  // Public entry point — single payload for the dashboard.
  // ──────────────────────────────────────────────────────────────────
  async getDashboard(
    filters: RecruitmentFilters = {},
  ): Promise<RecruitmentDashboardPayload> {
    const status = await this.yearStatus(filters);
    const selectedYear =
      filters.entryYearBE ?? status.latestComplete ?? status.latestOverall;
    const selectedYearIsComplete =
      selectedYear !== null && selectedYear === status.latestComplete;

    if (selectedYear === null) {
      const empty: FunnelTotals = {
        seats: 0,
        planPerYear: 0,
        applicants: 0,
        passed: 0,
        sendCh: 0,
        confirmCh: 0,
        sendReg: 0,
        regReported: 0,
        rounds: 0,
        programCount: 0,
      };
      return {
        meta: {
          latestCompleteYear: null,
          latestYearOverall: null,
          inProgressYear: null,
          availableYears: [],
          selectedYear: null,
          appliedFilters: filters,
          selectedYearIsComplete: false,
        },
        kpis: {
          ...empty,
          competitionRatio: null,
          fillRate: null,
          regYield: null,
        },
        byFaculty: [],
        byRound: [],
        byYear: [],
        programs: [],
        inProgressInfo: null,
      };
    }

    // Run all aggregations in parallel.
    const [totals, byFaculty, byRound, byYear, programs] = await Promise.all([
      this.totalsForYear(selectedYear, filters),
      this.byFaculty(selectedYear, filters),
      this.byRound(selectedYear, filters),
      this.byYear(filters),
      this.programDrill(selectedYear, filters),
    ]);

    const inProgressYear =
      status.latestOverall !== null &&
      status.latestComplete !== null &&
      status.latestOverall > status.latestComplete
        ? status.latestOverall
        : status.latestOverall !== null && status.latestComplete === null
          ? status.latestOverall
          : null;

    let inProgressInfo: (FunnelTotals & { entryYearBE: number }) | null = null;
    if (
      inProgressYear !== null &&
      inProgressYear !== selectedYear // only show banner when user is on the complete year
    ) {
      const ipTotals = await this.totalsForYear(inProgressYear, filters);
      inProgressInfo = { ...ipTotals, entryYearBE: inProgressYear };
    }

    return {
      meta: {
        latestCompleteYear: status.latestComplete,
        latestYearOverall: status.latestOverall,
        inProgressYear,
        availableYears: status.available,
        selectedYear,
        appliedFilters: filters,
        selectedYearIsComplete,
      },
      kpis: {
        ...totals,
        competitionRatio: totals.seats > 0 ? totals.applicants / totals.seats : null,
        fillRate: totals.seats > 0 ? totals.passed / totals.seats : null,
        regYield: totals.sendCh > 0 ? totals.regReported / totals.sendCh : null,
      },
      byFaculty,
      byRound,
      byYear,
      programs,
      inProgressInfo,
    };
  }
}
