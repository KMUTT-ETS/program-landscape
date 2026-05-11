// ─────────────────────────────────────────────────────────────────────────────
// Per-program TCAS recruitment funnel — surfaces the full POWERBI.
// ADMISSION_STAT_CURRID data for one program on the deep-dive page.
//
// Returns:
//   - byYear: per-year totals (plan, allocated, applicants, passed,
//     CH send/confirm, reg sent/reported), with isComplete flag
//   - latest: the latest complete year's per-round breakdown
//   - inProgress: the in-progress year's per-round breakdown (when one
//     exists) — informational, not used for scoring
//   - methodologyVersion: stable for audit
// ─────────────────────────────────────────────────────────────────────────────

import { prisma } from './index';
import { realDataWhere } from './data-quality';

export interface ProgramRecruitmentRoundRow {
  round: string;
  enrollSeats: number | null;
  planPerYear: number | null;
  totalApplicants: number | null;
  totalPassed: number | null;
  sendClearinghouse: number | null;
  confirmClearinghouse: number | null;
  sendRegReported: number | null;
  regReported: number | null;
}

export interface ProgramRecruitmentYearTotals {
  entryYearBE: number;
  isComplete: boolean;
  /** Calendar year (CE) — convenience for UI labels. */
  entryYearCE: number;
  /** PLAN_PER_YEAR — annual seat target, taken as MAX across rounds. */
  planPerYear: number | null;
  /** Sum of ENROLLSEAT across rounds (over-allocated for no-show). */
  enrollSeats: number;
  totalApplicants: number;
  totalPassed: number;
  sendClearinghouse: number;
  confirmClearinghouse: number;
  sendRegReported: number;
  regReported: number;
  /** applicants / enrollSeats. Null when no seats. */
  competitionRatio: number | null;
  /** sum-of-allocated / plan-per-year — observed over-allocation. */
  overAllocationFactor: number | null;
  /** reg_reported / plan-per-year. Null when no plan. */
  fillRateVsPlan: number | null;
  /** reg_reported / send_clearinghouse — Clearinghouse → registrar conversion. */
  registrationYield: number | null;
  /** Number of rounds (1.x sub-rounds counted separately). */
  rounds: number;
}

export interface ProgramRecruitmentResult {
  programId: string;
  byYear: ProgramRecruitmentYearTotals[];
  /** Latest COMPLETE year's per-round breakdown. */
  latestRounds: {
    entryYearBE: number;
    rounds: ProgramRecruitmentRoundRow[];
  } | null;
  /** Per-round breakdown of the in-progress year, when one exists. */
  inProgressRounds: {
    entryYearBE: number;
    rounds: ProgramRecruitmentRoundRow[];
  } | null;
  methodologyVersion: string;
}

const VERSION = 'program-recruitment.v1';

function isYearComplete(yearBE: number, now: Date = new Date()): boolean {
  return yearBE - 543 < now.getUTCFullYear();
}

export async function programRecruitment(
  programId: string,
): Promise<ProgramRecruitmentResult> {
  const allRows = await prisma.tcasAdmissionFunnel.findMany({
    where: { programId, ...realDataWhere() },
    orderBy: [{ entryYearBE: 'desc' }, { round: 'asc' }],
  });

  // Group by year for the per-year totals.
  const byYearMap = new Map<number, typeof allRows>();
  for (const r of allRows) {
    const arr = byYearMap.get(r.entryYearBE) ?? [];
    arr.push(r);
    byYearMap.set(r.entryYearBE, arr);
  }

  const byYear: ProgramRecruitmentYearTotals[] = Array.from(byYearMap.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([yearBE, rows]) => {
      const planPerYear = rows.reduce<number | null>((acc, r) => {
        if (r.planPerYear === null) return acc;
        if (acc === null) return r.planPerYear;
        return Math.max(acc, r.planPerYear);
      }, null);
      const seats = rows.reduce((s, r) => s + (r.enrollSeats ?? 0), 0);
      const apps = rows.reduce((s, r) => s + (r.totalApplicants ?? 0), 0);
      const passed = rows.reduce((s, r) => s + (r.totalPassed ?? 0), 0);
      const sendCh = rows.reduce((s, r) => s + (r.sendClearinghouse ?? 0), 0);
      const confirmCh = rows.reduce((s, r) => s + (r.confirmClearinghouse ?? 0), 0);
      const sendReg = rows.reduce((s, r) => s + (r.sendRegReported ?? 0), 0);
      const reg = rows.reduce((s, r) => s + (r.regReported ?? 0), 0);
      return {
        entryYearBE: yearBE,
        entryYearCE: yearBE - 543,
        isComplete: isYearComplete(yearBE),
        planPerYear,
        enrollSeats: seats,
        totalApplicants: apps,
        totalPassed: passed,
        sendClearinghouse: sendCh,
        confirmClearinghouse: confirmCh,
        sendRegReported: sendReg,
        regReported: reg,
        competitionRatio: seats > 0 ? apps / seats : null,
        overAllocationFactor: planPerYear && planPerYear > 0 ? seats / planPerYear : null,
        fillRateVsPlan: planPerYear && planPerYear > 0 ? reg / planPerYear : null,
        registrationYield: sendCh > 0 ? reg / sendCh : null,
        rounds: rows.length,
      };
    });

  const latestComplete = byYear.find((y) => y.isComplete) ?? null;
  const latestInProgress = byYear.find((y) => !y.isComplete) ?? null;

  const roundsFor = (yearBE: number): ProgramRecruitmentRoundRow[] => {
    const rows = byYearMap.get(yearBE) ?? [];
    return rows.map((r) => ({
      round: r.round,
      enrollSeats: r.enrollSeats,
      planPerYear: r.planPerYear,
      totalApplicants: r.totalApplicants,
      totalPassed: r.totalPassed,
      sendClearinghouse: r.sendClearinghouse,
      confirmClearinghouse: r.confirmClearinghouse,
      sendRegReported: r.sendRegReported,
      regReported: r.regReported,
    }));
  };

  return {
    programId,
    byYear,
    latestRounds: latestComplete
      ? { entryYearBE: latestComplete.entryYearBE, rounds: roundsFor(latestComplete.entryYearBE) }
      : null,
    inProgressRounds: latestInProgress
      ? { entryYearBE: latestInProgress.entryYearBE, rounds: roundsFor(latestInProgress.entryYearBE) }
      : null,
    methodologyVersion: VERSION,
  };
}
