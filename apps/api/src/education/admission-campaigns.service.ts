import { Injectable } from '@nestjs/common';
import { prisma, getAcademicYearContext, academicYearContextSync, entryYearComplete, campaignPlanKey } from '@kku/db';

// ─────────────────────────────────────────────────────────────────────────────
// Actual recruitment campaigns dashboard — POWERBI.ADMISSION_STAT, ingested
// into admission_campaign_stats at the campaign-TRACK grain (one row per
// WPROGRAMID: a competency / language / exam-option / quota / branch-campus
// intake within a program × round × year).
//
// Drill hierarchy: Faculty → Program (canonical, via CURR_ID) → Sub-program
// (PROGRAMID — ภาคปกติ / โครงการพิเศษ / a วิชาเอก major) → TCAS Round.
//
// Source-column terminology (used across the whole dashboard):
//   Plan       ← PLAN_PER_YEAER   Seats     ← ENROLLSEAT
//   Applicants ← TOTAL_APPLICANT  Passed    ← TOTAL_PASS
//   Send CH    ← SEND_CLEARINGHOUSE   Confirm CH ← CONFIRM_CLEARINGHOUSE
//   Enrolled   ← REG_REPORTED    Percent Admit = Enrolled / Plan
//
// Program resolution: CURR_ID → Program.mhesiCode ∪ ProgramMhesiAlias
// (authoritative); name-based AdmissionStatProgramMapping bridge as fallback.
//
// Plan total = Σ over PROGRAMID of MAX(plan) — each sub-program is a distinct
// intake with its own quota (several can share a CURR_ID and even repeat the
// same plan number; never dedupe by value or roll up to the curriculum).
//
// Dataset is small (~4.3k rows) so we load once and aggregate in TS.
// ─────────────────────────────────────────────────────────────────────────────

export const UNASSIGNED_FACULTY_ID = '__unassigned__';
const UNMAPPED_PROGRAM_LABEL_TH = 'ยังไม่จับคู่หลักสูตร (to be assigned)';

// A declining program enters risk monitoring once its competition rate
// (Applicants ÷ Seats) in the latest year falls below this threshold.
export const RISK_COMPETITION_THRESHOLD = 5;

export interface CampaignFilters {
  acadYearBE?: number | null;
  facultyId?: string | null;
  round?: string | null;
  unmappedOnly?: boolean | null;
}

/** The shared funnel metric set, in the dashboard's terminology. */
export interface CampaignMetrics {
  plan: number | null;
  seats: number | null;
  applicants: number;
  passed: number;
  sendCh: number;
  confirmCh: number;
  /** Send Reg ← SEND_REG_REPORTED */
  sendReg: number;
  enrolled: number;
  /**
   * Enrolled restricted to programs that carry a plan — the numerator for
   * `percentAdmit`. Equals `enrolled` when every program has a plan; smaller
   * when some don't. Keeping numerator and denominator over the SAME program
   * set is what makes a partial-plan `% Admit` correct rather than overstated.
   */
  enrolledWithPlan: number;
  /** Enrolled (plan-bearing programs) ÷ Plan */
  percentAdmit: number | null;
  /** Applicants ÷ Seats — competition rate (applicants per seat) */
  competitionRate: number | null;
  /**
   * Plan coverage for this group: distinct PROGRAMIDs total vs those that
   * carry a PLAN_PER_YEAER. When `withPlan < total`, `% Admit` covers only
   * those `withPlan` programs (the rest are excluded from both sides). The UI
   * surfaces this as a coverage caveat; only a fully-missing plan (`withPlan
   * === 0`) leaves `% Admit` uncomputable.
   */
  planProgramsTotal: number;
  planProgramsWithPlan: number;
}

export interface CampaignKpis extends CampaignMetrics {
  /** distinct canonical programs (or curricula when unmapped) */
  programs: number;
  /** distinct sub-programs (PROGRAMID) */
  subPrograms: number;
  /** campaign tracks (rows) */
  campaigns: number;
  /** Seats ÷ Plan */
  overAlloc: number | null;
}

export interface CampaignRoundRow extends CampaignMetrics {
  round: string;
  programs: number;
  campaigns: number;
}

export interface CampaignYearRow extends CampaignMetrics {
  acadYearBE: number;
  isComplete: boolean;
  programs: number;
  campaigns: number;
}

/** Individual campaign track (WPROGRAMID) — the deepest tier. */
export interface CampaignTrackNode extends CampaignMetrics {
  /** Null for a spreadsheet-imported track: it has no registrar surrogate. */
  wProgramId: string | null;
  campaignName: string;
}

/** TCAS-round tier — groups the competency-option tracks; expandable to them. */
export interface CampaignRoundNode extends CampaignMetrics {
  round: string;
  trackCount: number;
  tracks: CampaignTrackNode[];
}

/** Sub-program tier — one PROGRAMID (ภาคปกติ / โครงการพิเศษ / a major). */
export interface CampaignSubProgramNode extends CampaignMetrics {
  /**
   * The registrar's PROGRAMID. Null for a spreadsheet-imported campaign,
   * which has none — NOT the internal grouping key, which contains a
   * control character and would be rendered verbatim.
   */
  recruitmentProgramId: string | null;
  currId: string | null;
  label: string;
  roundCount: number;
  rounds: CampaignRoundNode[];
}

/** Canonical-program tier. */
export interface CampaignProgramRow extends CampaignMetrics {
  programKey: string;
  programId: string | null;
  programNameTh: string;
  programNameEn: string | null;
  mappingMethod: string | null;
  /**
   * A brand-new program the TCAS feed slots under another program's reused
   * curr_id, flagged via RecruitmentProgramOverride. Shown standalone with a
   * "New program" badge rather than folded into the curr_id's program. Not yet
   * in the curriculum catalog (no deep-dive / curriculum analysis).
   */
  isNewProgram: boolean;
  facultyId: string | null;
  facultyNameTh: string;
  subProgramCount: number;
  subPrograms: CampaignSubProgramNode[];
}

export interface DecliningProgramRow {
  programKey: string;
  programNameTh: string;
  facultyNameTh: string;
  /** competition rate (applicants ÷ seats) in the latest year with data */
  currentCompetition: number | null;
  /** competition rate in the prior year */
  priorCompetition: number | null;
  /** mean year-on-year change in competition rate (negative = declining) */
  avgYoYChange: number;
  /** number of year-pairs the average is over */
  yearsObserved: number;
}

export interface CampaignFacultyOption {
  id: string;
  nameTh: string;
}

export interface CampaignDashboardPayload {
  meta: {
    availableYears: number[];
    selectedYear: number | null;
    availableRounds: string[];
    selectedRound: string | null;
    appliedFilters: CampaignFilters;
    latestCompleteYear: number | null;
    selectedYearIsComplete: boolean;
    facultiesWithData: CampaignFacultyOption[];
    hasUnassignedFaculty: boolean;
    seatDataAvailable: boolean;
    unmappedProgramCount: number;
    totalProgramCount: number;
  };
  kpis: CampaignKpis;
  byRound: CampaignRoundRow[];
  byYear: CampaignYearRow[];
  programs: CampaignProgramRow[];
  decliningPrograms: DecliningProgramRow[];
  zeroApplicantTrackCount: number;
}

interface Row {
  // Both are registrar identifiers and are NULL on a spreadsheet-imported
  // row — an adopting university has neither.
  wProgramId: string | null;
  recruitmentProgramId: string | null;
  currId: string | null;
  campaignName: string;
  facultyId: string | null;
  facultyNameTh: string;
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

interface ProgramRef {
  programId: string;
  nameTh: string;
  nameEn: string | null;
  method: 'curr_id' | 'llm';
}

const num = (v: number | null | undefined): number => v ?? 0;
const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null);

@Injectable()
export class AdmissionCampaignsService {
  // Plan total = Σ over PROGRAMID of MAX(plan). PLAN_PER_YEAER is constant
  // within a (PROGRAMID, year); each PROGRAMID is a distinct intake (major /
  // management class) with its own quota — several can share a CURR_ID and
  // repeat the same plan number, so we never dedupe by value or roll up.
  private planSum(rows: Row[]): number | null {
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

  private seatSum(rows: Row[]): number | null {
    if (!rows.some((r) => r.enrollSeats !== null)) return null;
    return rows.reduce((a, r) => a + num(r.enrollSeats), 0);
  }

  private metrics(rows: Row[]): CampaignMetrics {
    const plan = this.planSum(rows);
    const seats = this.seatSum(rows);
    const enrolled = rows.reduce((a, r) => a + num(r.regReported), 0);
    const applicants = rows.reduce((a, r) => a + num(r.totalApplicants), 0);
    // Plan coverage: distinct PROGRAMIDs total vs those carrying a plan. A
    // PROGRAMID counts as plan-bearing if ANY of its rows has a plan.
    const pidsTotal = new Set<string>();
    const pidsWithPlan = new Set<string>();
    for (const r of rows) {
      // An imported row has no PROGRAMID; it is its own group, so coverage
      // counts it once rather than merging every such row into one bucket.
      const key = campaignPlanKey(r);
      pidsTotal.add(key);
      if (r.planPerYear !== null) pidsWithPlan.add(key);
    }
    // Numerator for % Admit: enrolled only from plan-bearing programs, so it
    // sits over the same population as `plan` (the denominator).
    const enrolledWithPlan = rows.reduce(
      (a, r) => (pidsWithPlan.has(campaignPlanKey(r)) ? a + num(r.regReported) : a),
      0,
    );
    return {
      plan,
      seats,
      applicants,
      passed: rows.reduce((a, r) => a + num(r.totalPassed), 0),
      sendCh: rows.reduce((a, r) => a + num(r.sendClearinghouse), 0),
      confirmCh: rows.reduce((a, r) => a + num(r.confirmClearinghouse), 0),
      sendReg: rows.reduce((a, r) => a + num(r.sendRegReported), 0),
      enrolled,
      enrolledWithPlan,
      percentAdmit: plan != null && plan > 0 ? enrolledWithPlan / plan : null,
      competitionRate: seats != null && seats > 0 ? applicants / seats : null,
      planProgramsTotal: pidsTotal.size,
      planProgramsWithPlan: pidsWithPlan.size,
    };
  }

  private distinctProgramKeys(rows: Row[], programKey: (r: Row) => string): number {
    return new Set(rows.map(programKey)).size;
  }

  async getDashboard(filters: CampaignFilters = {}): Promise<CampaignDashboardPayload> {
    const [allRows, mappings, programsRaw, aliasesRaw, overridesRaw] = await Promise.all([
      prisma.admissionCampaignStat.findMany({
        where: { ingestionRunId: { not: null } },
        select: {
          wProgramId: true,
          recruitmentProgramId: true,
          currId: true,
          campaignName: true,
          facultyId: true,
          facultyNameTh: true,
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
      }),
      prisma.admissionStatProgramMapping.findMany({
        select: {
          recruitmentProgramId: true,
          confidence: true,
          program: { select: { id: true, nameTh: true, nameEn: true } },
        },
      }),
      prisma.program.findMany({
        where: { status: 'ACTIVE', sequenceNoFromSheet: { not: null } },
        select: { id: true, nameTh: true, nameEn: true, mhesiCode: true },
      }),
      prisma.programMhesiAlias.findMany({ select: { mhesiCode: true, programId: true } }),
      prisma.recruitmentProgramOverride.findMany({
        select: { recruitmentProgramId: true, kind: true, displayNameTh: true, displayNameEn: true },
      }),
    ]);

    const progById = new Map(programsRaw.map((p) => [p.id, p]));
    const currMap = new Map<string, ProgramRef>();
    for (const p of programsRaw) {
      if (p.mhesiCode) currMap.set(p.mhesiCode, { programId: p.id, nameTh: p.nameTh, nameEn: p.nameEn, method: 'curr_id' });
    }
    for (const a of aliasesRaw) {
      if (currMap.has(a.mhesiCode)) continue;
      const p = progById.get(a.programId);
      if (p) currMap.set(a.mhesiCode, { programId: p.id, nameTh: p.nameTh, nameEn: p.nameEn, method: 'curr_id' });
    }
    const bridgeByPid = new Map<string, ProgramRef>();
    for (const m of mappings) {
      bridgeByPid.set(m.recruitmentProgramId, { programId: m.program.id, nameTh: m.program.nameTh, nameEn: m.program.nameEn, method: 'llm' });
    }
    // New-program overrides: recruitment programs flagged as standalone +
    // uncatalogued. They DON'T resolve (their curr_id is ignored for grouping)
    // and get a per-PROGRAMID key so they never fold into another program.
    const newProgramByPid = new Map<string, { displayNameTh: string | null; displayNameEn: string | null }>();
    for (const o of overridesRaw) {
      if (o.kind === 'NEW_PROGRAM') {
        newProgramByPid.set(o.recruitmentProgramId, { displayNameTh: o.displayNameTh, displayNameEn: o.displayNameEn });
      }
    }
    const resolve = (r: Row): ProgramRef | null => {
      // A flagged new program is intentionally unmapped — skip curr_id/bridge.
      // Both bridges are keyed on the registrar's PROGRAMID, so an imported
      // row (which has none) can never be in either.
      if (r.recruitmentProgramId === null) return null;
      if (newProgramByPid.has(r.recruitmentProgramId)) return null;
      // Per-PROGRAMID bridge wins over curr_id. The bridge is the deliberate,
      // analyst/LLM-curated mapping; it exists specifically to correct the
      // recruitment feed reusing one curr_id across distinct programs (e.g.
      // KKU-SEQ-0067's curr_id 25640034000456 is reused for the brand-new
      // rail + semiconductor intakes). Checking curr_id first silently
      // overrode 28 such corrections — so the bridge takes precedence.
      const byBridge = bridgeByPid.get(r.recruitmentProgramId);
      if (byBridge) return byBridge;
      if (r.currId) {
        const byCurr = currMap.get(r.currId);
        if (byCurr) return byCurr;
      }
      return null;
    };
    const programKey = (r: Row): string => {
      // Standalone key so a flagged new program never bundles with another
      // (even another row that shares its reused curr_id).
      if (r.recruitmentProgramId !== null && newProgramByPid.has(r.recruitmentProgramId)) {
        return `new:${r.recruitmentProgramId}`;
      }
      const ref = resolve(r);
      if (ref) return ref.programId;
      if (r.currId) return `curr:${r.currId}`;
      // An imported row has no registrar id at all; its own identity is the
      // only thing that distinguishes it.
      return campaignPlanKey(r);
    };

    const scoped = allRows.filter((r) => {
      if (filters.facultyId === UNASSIGNED_FACULTY_ID) {
        if (r.facultyId !== null) return false;
      } else if (filters.facultyId) {
        if (r.facultyId !== filters.facultyId) return false;
      }
      if (filters.unmappedOnly && resolve(r) !== null) return false;
      return true;
    });

    const years = [...new Set(scoped.map((r) => r.acadYearBE))].sort((a, b) => b - a);
    const ay = await getAcademicYearContext();
    const latestCompleteYear = years.find((y) => entryYearComplete(y, ay)) ?? null;
    const selectedYear = filters.acadYearBE ?? latestCompleteYear ?? years[0] ?? null;

    const facMap = new Map<string, string>();
    let hasUnassignedFaculty = false;
    for (const r of allRows) {
      if (r.facultyId) facMap.set(r.facultyId, r.facultyNameTh);
      else hasUnassignedFaculty = true;
    }
    const facultiesWithData: CampaignFacultyOption[] = [...facMap.entries()]
      .map(([id, nameTh]) => ({ id, nameTh }))
      .sort((a, b) => a.nameTh.localeCompare(b.nameTh, 'th'));

    const seatDataAvailable = allRows.some((r) => r.planPerYear !== null || r.enrollSeats !== null);
    const allPids = new Set(allRows.map((r) => campaignPlanKey(r)));
    let unmappedProgramCount = 0;
    const seenPid = new Set<string>();
    for (const r of allRows) {
      const pidKey = campaignPlanKey(r);
      if (seenPid.has(pidKey)) continue;
      seenPid.add(pidKey);
      if (resolve(r) === null) unmappedProgramCount += 1;
    }

    const emptyKpis: CampaignKpis = {
      plan: null, seats: null, applicants: 0, passed: 0, sendCh: 0, confirmCh: 0, sendReg: 0,
      enrolled: 0, enrolledWithPlan: 0, percentAdmit: null, competitionRate: null,
      planProgramsTotal: 0, planProgramsWithPlan: 0,
      programs: 0, subPrograms: 0, campaigns: 0, overAlloc: null,
    };

    if (selectedYear === null) {
      return {
        meta: {
          availableYears: [], selectedYear: null, availableRounds: [],
          selectedRound: filters.round ?? null, appliedFilters: filters,
          latestCompleteYear: null, selectedYearIsComplete: false,
          facultiesWithData, hasUnassignedFaculty, seatDataAvailable,
          unmappedProgramCount, totalProgramCount: allPids.size,
        },
        kpis: emptyKpis,
        byRound: [], byYear: [], programs: [], decliningPrograms: [], zeroApplicantTrackCount: 0,
      };
    }

    const yearRows = scoped.filter((r) => r.acadYearBE === selectedYear);
    const availableRounds = [...new Set(yearRows.map((r) => r.round))].sort();
    const round = filters.round ?? null;
    const inScope = round ? yearRows.filter((r) => r.round === round) : yearRows;

    const m = this.metrics(inScope);
    const kpis: CampaignKpis = {
      ...m,
      programs: this.distinctProgramKeys(inScope, programKey),
      subPrograms: new Set(inScope.map((r) => campaignPlanKey(r))).size,
      campaigns: inScope.length,
      overAlloc: m.plan != null && m.plan > 0 && m.seats != null ? m.seats / m.plan : null,
    };

    return {
      meta: {
        availableYears: years,
        selectedYear,
        availableRounds,
        selectedRound: round,
        appliedFilters: filters,
        latestCompleteYear,
        selectedYearIsComplete: entryYearComplete(selectedYear, ay),
        facultiesWithData,
        hasUnassignedFaculty,
        seatDataAvailable,
        unmappedProgramCount,
        totalProgramCount: allPids.size,
      },
      kpis,
      byRound: this.groupRound(yearRows, programKey),
      byYear: this.groupYear(scoped, programKey),
      programs: this.buildDrill(inScope, resolve, programKey, newProgramByPid),
      decliningPrograms: this.declining(scoped, resolve, programKey),
      zeroApplicantTrackCount: inScope.filter((r) => num(r.totalApplicants) === 0).length,
    };
  }

  private groupRound(rows: Row[], programKey: (r: Row) => string): CampaignRoundRow[] {
    const groups = new Map<string, Row[]>();
    for (const r of rows) (groups.get(r.round) ?? groups.set(r.round, []).get(r.round)!).push(r);
    return [...groups.entries()]
      .map(([roundKey, grp]) => ({ round: roundKey, programs: this.distinctProgramKeys(grp, programKey), campaigns: grp.length, ...this.metrics(grp) }))
      .sort((a, b) => a.round.localeCompare(b.round));
  }

  private groupYear(rows: Row[], programKey: (r: Row) => string): CampaignYearRow[] {
    const ay = academicYearContextSync();
    const groups = new Map<number, Row[]>();
    for (const r of rows) (groups.get(r.acadYearBE) ?? groups.set(r.acadYearBE, []).get(r.acadYearBE)!).push(r);
    return [...groups.entries()]
      .map(([year, grp]) => ({ acadYearBE: year, isComplete: entryYearComplete(year, ay), programs: this.distinctProgramKeys(grp, programKey), campaigns: grp.length, ...this.metrics(grp) }))
      .sort((a, b) => a.acadYearBE - b.acadYearBE);
  }

  // Drill: Faculty (client-grouped) → Program → Sub-program (PROGRAMID) → TCAS Round.
  private buildDrill(
    rows: Row[],
    resolve: (r: Row) => ProgramRef | null,
    programKey: (r: Row) => string,
    newProgramByPid: Map<string, { displayNameTh: string | null; displayNameEn: string | null }>,
  ): CampaignProgramRow[] {
    const progGroups = new Map<string, Row[]>();
    for (const r of rows) {
      const key = programKey(r);
      (progGroups.get(key) ?? progGroups.set(key, []).get(key)!).push(r);
    }
    const out: CampaignProgramRow[] = [];
    for (const [key, grp] of progGroups) {
      const ref = resolve(grp[0]!);
      // Sub-program tier (PROGRAMID).
      const subGroups = new Map<string, Row[]>();
      for (const r of grp) {
        // An imported row has no PROGRAMID tier; it stands alone under the
        // programme rather than merging with every other such row.
        const sub = campaignPlanKey(r);
        (subGroups.get(sub) ?? subGroups.set(sub, []).get(sub)!).push(r);
      }
      const subPrograms: CampaignSubProgramNode[] = [...subGroups.entries()]
        .map(([pid, sg]) => {
          // Round tier (aggregate the competency-option tracks within a round).
          const roundGroups = new Map<string, Row[]>();
          for (const r of sg) (roundGroups.get(r.round) ?? roundGroups.set(r.round, []).get(r.round)!).push(r);
          const rounds: CampaignRoundNode[] = [...roundGroups.entries()]
            .map(([rd, rg]) => ({
              round: rd,
              trackCount: rg.length,
              tracks: rg
                .map((r) => ({ wProgramId: r.wProgramId, campaignName: r.campaignName, ...this.metrics([r]) }))
                .sort((a, b) => b.applicants - a.applicants),
              ...this.metrics(rg),
            }))
            .sort((a, b) => a.round.localeCompare(b.round));
          const label = sg.reduce((a, r) => (r.campaignName.length < a.length ? r.campaignName : a), sg[0]!.campaignName);
          return {
            // The group's own id, not the synthesised grouping key: this
            // field is rendered verbatim on /education/recruitment-campaigns.
            recruitmentProgramId: sg[0]!.recruitmentProgramId,
            currId: sg[0]!.currId,
            label,
            roundCount: rounds.length,
            rounds,
            ...this.metrics(sg),
          };
        })
        .sort((a, b) => b.applicants - a.applicants);
      // New-program override: standalone, uncatalogued. Its key is per-PROGRAMID
      // (`new:<pid>`), so the whole group shares one recruitmentProgramId.
      // An imported group has no PROGRAMID and can never be a flagged new
      // programme — that flag is set against the registrar's own id.
      const groupPid = grp[0]!.recruitmentProgramId;
      const newOvr = groupPid === null ? undefined : newProgramByPid.get(groupPid);
      const isNewProgram = key.startsWith('new:');
      // Fallback display name = shortest campaign name in the group.
      const derivedLabel = grp.reduce((a, r) => (r.campaignName.length < a.length ? r.campaignName : a), grp[0]!.campaignName);
      out.push({
        programKey: key,
        programId: ref?.programId ?? null,
        programNameTh: isNewProgram
          ? (newOvr?.displayNameTh ?? derivedLabel)
          : (ref?.nameTh ?? UNMAPPED_PROGRAM_LABEL_TH),
        programNameEn: isNewProgram ? (newOvr?.displayNameEn ?? null) : (ref?.nameEn ?? null),
        mappingMethod: isNewProgram ? 'new-program' : (ref?.method ?? null),
        isNewProgram,
        facultyId: grp[0]!.facultyId,
        facultyNameTh: grp[0]!.facultyNameTh,
        subProgramCount: subGroups.size,
        subPrograms,
        ...this.metrics(grp),
      });
    }
    return out.sort((a, b) => b.applicants - a.applicants);
  }

  // Declining indicator: the mean year-on-year change in competition rate
  // (Applicants ÷ Seats) across every year a program has data. Programs whose
  // competition rate is trending DOWN (negative average) are surfaced,
  // steepest decline first. Uses the full year span, not just the selected
  // year, so it reads as a trend rather than a single-year dip.
  private declining(
    rows: Row[],
    resolve: (r: Row) => ProgramRef | null,
    programKey: (r: Row) => string,
  ): DecliningProgramRow[] {
    const byProg = new Map<string, Map<number, { apps: number; seats: number }>>();
    const meta = new Map<string, { progName: string; facName: string }>();
    for (const r of rows) {
      const key = programKey(r);
      let ym = byProg.get(key);
      if (!ym) { ym = new Map(); byProg.set(key, ym); }
      const cur = ym.get(r.acadYearBE) ?? { apps: 0, seats: 0 };
      cur.apps += num(r.totalApplicants);
      cur.seats += num(r.enrollSeats);
      ym.set(r.acadYearBE, cur);
      if (!meta.has(key)) meta.set(key, { progName: resolve(r)?.nameTh ?? r.campaignName, facName: r.facultyNameTh });
    }
    const out: DecliningProgramRow[] = [];
    for (const [key, ym] of byProg) {
      const series = [...ym.entries()]
        .filter(([, v]) => v.seats > 0)
        .map(([y, v]) => ({ year: y, rate: v.apps / v.seats }))
        .sort((a, b) => a.year - b.year);
      if (series.length < 2) continue;
      const current = series[series.length - 1]!.rate;
      // Risk monitoring: only declining programs whose latest competition
      // rate has dropped below the threshold (oversubscribed programs that
      // soften but stay well above demand aren't yet a concern).
      if (current >= RISK_COMPETITION_THRESHOLD) continue;
      const changes: number[] = [];
      for (let i = 1; i < series.length; i++) changes.push(series[i]!.rate - series[i - 1]!.rate);
      const avg = changes.reduce((a, b) => a + b, 0) / changes.length;
      if (avg >= 0) continue;
      const m = meta.get(key)!;
      out.push({
        programKey: key,
        programNameTh: m.progName,
        facultyNameTh: m.facName,
        currentCompetition: series[series.length - 1]!.rate,
        priorCompetition: series[series.length - 2]!.rate,
        avgYoYChange: avg,
        yearsObserved: changes.length,
      });
    }
    return out.sort((a, b) => a.avgYoYChange - b.avgYoYChange).slice(0, 50);
  }
}
