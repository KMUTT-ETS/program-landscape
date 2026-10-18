// ─────────────────────────────────────────────────────────────────────────────
// Per-program / per-scope recruitment funnel adapter over
// admission_campaign_stats (POWERBI.ADMISSION_STAT).
//
// This is the single source of recruitment-funnel aggregation for scoring,
// deep-dive and risk — replacing direct reads of the retiring
// tcas_admission_funnels (POWERBI.ADMISSION_STAT_CURRID). The new table is a
// superset: campaign-track grain, with program_id resolved at ingest.
//
// Plan semantics: PLAN_PER_YEAER is constant within a (PROGRAMID, year); each
// PROGRAMID (sub-program: a major / management class) is a distinct intake
// with its own quota. So a program's annual plan = Σ over its PROGRAMIDs of
// MAX(plan) — never deduped by value or rolled up to the curriculum, and
// never summed across rounds.
// ─────────────────────────────────────────────────────────────────────────────

import { campaignPlanKey, campaignPlanKeySqlText } from './campaign-plan-key';
import { prisma } from './index';
import { realDataWhere, realDataSqlUnsafe } from './data-quality';
import { getAcademicYearContext, entryYearComplete } from './academic-year';

export const PROGRAM_FUNNEL_VERSION = 'program-funnel.v1';

/** Per-(year × round) funnel row — drop-in shape for the retired
 *  tcas_admission_funnels rows. `planPerYear` carries the program's ANNUAL
 *  plan (Σ over sub-programs of MAX plan), replicated on each round row, so
 *  callers that take MAX-across-rounds get the right annual figure. */
export interface ProgramFunnelRoundRow {
  entryYearBE: number;
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

export interface ProgramFunnelYear {
  entryYearBE: number;
  entryYearCE: number;
  isComplete: boolean;
  /** Σ over sub-programs of MAX(plan). Null when no plan on file. */
  planPerYear: number | null;
  enrollSeats: number;
  totalApplicants: number;
  totalPassed: number;
  sendClearinghouse: number;
  confirmClearinghouse: number;
  sendRegReported: number;
  regReported: number;
  rounds: number;
}

interface RawRow {
  recruitmentProgramId: string | null;
  campaignName: string;
  acadYearBE: number;
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

const n = (v: number | null | undefined): number => v ?? 0;

// Σ over sub-program (PROGRAMID) of MAX(plan) within the given rows.
function planSum(rows: RawRow[]): number | null {
  const byPid = new Map<string, number>();
  let any = false;
  for (const r of rows) {
    if (r.planPerYear === null) continue;
    any = true;
    const key = campaignPlanKey(r);
    const cur = byPid.get(key);
    byPid.set(key, cur == null ? r.planPerYear : Math.max(cur, r.planPerYear));
  }
  if (!any) return null;
  let s = 0;
  for (const v of byPid.values()) s += v;
  return s;
}

async function loadProgramRows(programId: string): Promise<RawRow[]> {
  return prisma.admissionCampaignStat.findMany({
    where: { programId, ...realDataWhere() },
    select: {
      recruitmentProgramId: true,
      campaignName: true,
      acadYearBE: true,
      round: true,
      enrollSeats: true,
      planPerYear: true,
      totalApplicants: true,
      totalPassed: true,
      sendClearinghouse: true,
      confirmClearinghouse: true,
      sendRegReported: true,
      regReported: true,
    },
  });
}

/** Per-year totals for a program — the shape scoring + demographic outlook want. */
export async function programFunnelYears(programId: string): Promise<ProgramFunnelYear[]> {
  const rows = await loadProgramRows(programId);
  const ay = await getAcademicYearContext();
  const byYear = new Map<number, RawRow[]>();
  for (const r of rows) (byYear.get(r.acadYearBE) ?? byYear.set(r.acadYearBE, []).get(r.acadYearBE)!).push(r);
  return [...byYear.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([yearBE, yr]) => ({
      entryYearBE: yearBE,
      entryYearCE: yearBE - 543,
      isComplete: entryYearComplete(yearBE, ay),
      planPerYear: planSum(yr),
      enrollSeats: yr.reduce((s, r) => s + n(r.enrollSeats), 0),
      totalApplicants: yr.reduce((s, r) => s + n(r.totalApplicants), 0),
      totalPassed: yr.reduce((s, r) => s + n(r.totalPassed), 0),
      sendClearinghouse: yr.reduce((s, r) => s + n(r.sendClearinghouse), 0),
      confirmClearinghouse: yr.reduce((s, r) => s + n(r.confirmClearinghouse), 0),
      sendRegReported: yr.reduce((s, r) => s + n(r.sendRegReported), 0),
      regReported: yr.reduce((s, r) => s + n(r.regReported), 0),
      rounds: new Set(yr.map((r) => r.round)).size,
    }));
}

/** Per-(year × round) rows for a program — drop-in for tcasAdmissionFunnel
 *  rows. Tracks within a (year, round) are summed; the annual plan is
 *  replicated on each round row. */
export async function programFunnelRoundRows(programId: string): Promise<ProgramFunnelRoundRow[]> {
  const rows = await loadProgramRows(programId);
  const byYear = new Map<number, RawRow[]>();
  for (const r of rows) (byYear.get(r.acadYearBE) ?? byYear.set(r.acadYearBE, []).get(r.acadYearBE)!).push(r);
  const out: ProgramFunnelRoundRow[] = [];
  for (const [yearBE, yr] of byYear) {
    const annualPlan = planSum(yr);
    const byRound = new Map<string, RawRow[]>();
    for (const r of yr) (byRound.get(r.round) ?? byRound.set(r.round, []).get(r.round)!).push(r);
    for (const [round, rr] of byRound) {
      out.push({
        entryYearBE: yearBE,
        round,
        enrollSeats: rr.some((r) => r.enrollSeats !== null) ? rr.reduce((s, r) => s + n(r.enrollSeats), 0) : null,
        planPerYear: annualPlan,
        totalApplicants: rr.reduce((s, r) => s + n(r.totalApplicants), 0),
        totalPassed: rr.reduce((s, r) => s + n(r.totalPassed), 0),
        sendClearinghouse: rr.reduce((s, r) => s + n(r.sendClearinghouse), 0),
        confirmClearinghouse: rr.reduce((s, r) => s + n(r.confirmClearinghouse), 0),
        sendRegReported: rr.reduce((s, r) => s + n(r.sendRegReported), 0),
        regReported: rr.reduce((s, r) => s + n(r.regReported), 0),
      });
    }
  }
  return out.sort((a, b) => b.entryYearBE - a.entryYearBE || a.round.localeCompare(b.round));
}

export type FunnelScope = 'university' | 'faculty' | 'department' | 'program';

export interface ScopeFunnelTotals {
  entryYearBE: number | null;
  planPerYear: number;
  enrollSeats: number;
  totalApplicants: number;
  totalPassed: number;
  sendClearinghouse: number;
  confirmClearinghouse: number;
  sendRegReported: number;
  regReported: number;
}

/** Latest-complete-year aggregate funnel totals for a scope (university /
 *  faculty / department / program). Aggregates across canonical-ACTIVE
 *  programs. Plan = Σ over sub-programs of MAX(plan). */
export async function scopeFunnelLatestYear(
  scope: FunnelScope,
  scopeId: string | null,
  now: Date = new Date(),
): Promise<ScopeFunnelTotals> {
  const ay = await getAcademicYearContext(now);
  // Built with $queryRawUnsafe + explicit positional params, NOT tagged-template
  // fragments. Under the dev webpack build pnpm can load two @prisma/client
  // module instances, so a nested Prisma.sql/Prisma.raw fragment fails its
  // `instanceof Sql` check and Prisma mis-numbers the parameters →
  // `syntax error at or near "$2"` (dev only; production `next build` dedupes to
  // one instance, which is why prod is unaffected). $queryRawUnsafe sidesteps the
  // fragment-nesting entirely. The realData subquery + scope COLUMN come from a
  // fixed allowlist (no user input); scopeId is always a positional ($N) param.
  const realData = realDataSqlUnsafe('c');
  const scopeCol =
    scope === 'faculty' ? 'p.faculty_id'
      : scope === 'department' ? 'p.department_id'
        : scope === 'program' ? 'p.id'
          : null;
  const scoped = Boolean(scopeCol && scopeId);

  // Latest entry year whose cohort has fully run.
  const yearRows = await prisma.$queryRawUnsafe<Array<{ y: number }>>(
    `SELECT DISTINCT c.acad_year_be AS y
     FROM admission_campaign_stats c
     JOIN programs p ON p.id = c.program_id
     WHERE p.status = 'ACTIVE' AND p.sequence_no_from_sheet IS NOT NULL
       AND ${realData}
       ${scoped ? `AND ${scopeCol} = $1` : ''}
     ORDER BY c.acad_year_be DESC`,
    ...(scoped ? [scopeId] : []),
  );
  const year = yearRows.map((r) => r.y).find((y) => entryYearComplete(y, ay)) ?? null;
  const empty: ScopeFunnelTotals = {
    entryYearBE: year, planPerYear: 0, enrollSeats: 0, totalApplicants: 0, totalPassed: 0,
    sendClearinghouse: 0, confirmClearinghouse: 0, sendRegReported: 0, regReported: 0,
  };
  if (year === null) return empty;
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      seats: bigint; applicants: bigint; passed: bigint; send_ch: bigint;
      confirm_ch: bigint; send_reg: bigint; reg: bigint; plan: bigint;
    }>
  >(
    `WITH scoped AS (
       SELECT c.*
       FROM admission_campaign_stats c
       JOIN programs p ON p.id = c.program_id
       WHERE p.status = 'ACTIVE' AND p.sequence_no_from_sheet IS NOT NULL
         AND c.acad_year_be = $1
         AND ${realData}
         ${scoped ? `AND ${scopeCol} = $2` : ''}
     ),
     plan_per_sub AS (
       SELECT ${campaignPlanKeySqlText('scoped')} AS plan_key, MAX(plan_per_year) AS pp
       FROM scoped GROUP BY plan_key
     )
     SELECT
       COALESCE(SUM(enroll_seats), 0)::bigint AS seats,
       COALESCE(SUM(total_applicants), 0)::bigint AS applicants,
       COALESCE(SUM(total_passed), 0)::bigint AS passed,
       COALESCE(SUM(send_clearinghouse), 0)::bigint AS send_ch,
       COALESCE(SUM(confirm_clearinghouse), 0)::bigint AS confirm_ch,
       COALESCE(SUM(send_reg_reported), 0)::bigint AS send_reg,
       COALESCE(SUM(reg_reported), 0)::bigint AS reg,
       (SELECT COALESCE(SUM(pp), 0)::bigint FROM plan_per_sub) AS plan
     FROM scoped`,
    year,
    ...(scoped ? [scopeId] : []),
  );
  const r = rows[0];
  if (!r) return empty;
  return {
    entryYearBE: year,
    planPerYear: Number(r.plan),
    enrollSeats: Number(r.seats),
    totalApplicants: Number(r.applicants),
    totalPassed: Number(r.passed),
    sendClearinghouse: Number(r.send_ch),
    confirmClearinghouse: Number(r.confirm_ch),
    sendRegReported: Number(r.send_reg),
    regReported: Number(r.reg),
  };
}
