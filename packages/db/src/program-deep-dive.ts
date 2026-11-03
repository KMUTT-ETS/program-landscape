import { Prisma, type ProgramLifecycleVerdict } from '@prisma/client';
import { z } from 'zod';
import {
  getInstitution,
  ProgramResearchExpertiseSchema,
  type ProgramResearchExpertise,
} from '@kku/shared';
import { prisma } from './index';
import { NATIONAL_REGION, projectionRegionForInstitution } from './projection-region';
import {
  computeHealthScores,
  computeProgramDimensionAverages,
  HEALTH_SCORE_VERSION,
  FLAGSHIP_REVENUE_FLOOR_THB,
  REVENUE_TARGET_THB_BY_LEVEL,
  type HealthDimension,
  type HealthScoreRow,
  type ProgramDimensionMeans,
} from './health-score';
import { queryMetricByScope } from './scope';
import { programJobThaiSkillCoverage } from './jobthai';
import { JOBTHAI_MIN_RELEVANT_SKILLS } from './jobthai-bridge';
import { realDataWhere, realDataSql } from './data-quality';
import { programFunnelYears } from './program-funnel';
import { academicYearContextSync, getAcademicYearContext } from './academic-year';
import { pickFinancialYear } from './financial-year';
import { readinessFor, type ExpertiseReadiness } from './program-research-expertise';
import {
  loadResearchSourceComposition,
  type ResearchSourceComposition,
} from './research-source-composition';
import {
  DQ_ELIGIBLE_LEVEL,
  OVERALL_MEAN_MAX_MODULE_NO,
  STUDENT_DQ_METHODOLOGY_VERSION,
  dqCompetencyByScope,
  dqDriverScore,
  dqIsEligible,
  dqRadar,
} from './student-dq';

// Deep-dive aggregator — all reads a single program's page needs.
// Each method corresponds to one section of the UI. Role-sensitive
// filtering (COUNCIL doesn't see individual salaries) lives here, not
// in the controller, so direct callers (PDF template, scripts) can't
// accidentally leak it.

// Three "signal strength" tones used by the UI + print.
export type SignalTone = 'strong' | 'caution' | 'weak' | 'unknown';

// ──────────────────────────────────────────────────────────────────────────
// Explicit return types — the inferred types reference Prisma-generated
// interfaces that pnpm buries deep in the store (.pnpm/...), which fails
// portability checks under tsconfig declaration:true. Declaring them here
// keeps consumers on a stable shape.
// ──────────────────────────────────────────────────────────────────────────

export interface ProgramOverviewResult {
  program: {
    id: string;
    code: string;
    nameEn: string;
    nameTh: string;
    level: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
    status: 'ACTIVE' | 'PAUSED' | 'SUNSET';
    yearEstablished: number | null;
    curriculumYearBE: number | null;
    faculty: { id: string; nameEn: string; nameTh: string };
    department: { id: string; nameEn: string; nameTh: string } | null;
  };
  health: HealthScoreRow | null;
  /** Most recent pipeline-output timestamp for this program. MAX across
   *  ProgramStrategicNarrative, ProgramAiReadinessAssessment,
   *  ProgramPeerReview, RiskAssessment. Carries full time-of-day
   *  precision so the "Updated Xh ago" deep-dive badge reflects when
   *  the pipeline actually last ran (not when the underlying registrar
   *  data was reported, which is `@db.Date` and lacks time). */
  lastAnalysedAt: Date | null;
  methodologyVersion: string;
}

export interface FacultyMemberSummary {
  id: string;
  rank: string;
  nameEn: string | null;
  nameTh: string | null;
  employeeCode: string | null;
  specialization: string | null;
  retirementDate: Date | null;
}

export interface ProgramFacultyResult {
  visibility: 'full' | 'aggregates-only';
  /** Where the roster came from. `program` = direct ProgramFaculty links;
   *  `department` = all FacultyMembers in the program's department;
   *  `faculty` = all FacultyMembers in the program's Faculty (broadest
   *  fallback when neither program-specific links nor a department
   *  mapping exists). The UI surfaces this so analysts know whether
   *  they're looking at a curated roster or a broader scope. */
  rosterScope: 'program' | 'department' | 'faculty';
  totalActive: number;
  ranks: Record<string, number>;
  averageAgeYears: number | null;
  retiringWithin5Years: number;
  successionRiskPct: number;
  /** Sum of `_count.researchOutputs` across all roster members.
   *  Cross-joined from research_outputs via FacultyMember.id.
   *
   *  UNFILTERED by `realDataWhere()`, unlike the research-expertise and
   *  health-score publication counts — so this is the one Council-facing
   *  figure on the deep-dive that DOES include on-demand Google Scholar
   *  imports. `researchSourceComposition` states by how much. */
  totalPublications: number;
  /** How much of the roster's publication record came from the on-demand
   *  Google Scholar import rather than the scheduled library pipeline.
   *  Council-readiness rule 1: the figure above moves when someone presses
   *  a button, so the drawer has to say who did. */
  researchSourceComposition: ResearchSourceComposition;
  members: FacultyMemberSummary[];
}

export interface ProgramPeersResult {
  peers: Array<{
    id: string;
    institution: string;
    country: string;
    programName: string;
    programLevel: 'BACHELOR' | 'MASTER' | 'DOCTORAL' | 'HIGHER_GRAD_DIPLOMA';
    ranking: number | null;
    descriptionUrl: string | null;
  }>;
}

export interface ProgramTrendSignalSummary {
  id: string;
  title: string;
  signalType: 'POLICY' | 'RESEARCH' | 'MARKET' | 'TECH' | 'NEWS';
  summaryTh: string | null;
  summaryEn: string | null;
  sourceUrl: string | null;
  detectedDate: Date;
  impactScore: number;
  isTargetedAtProgram: boolean;
}

export interface ProgramTrendsResult {
  signals: ProgramTrendSignalSummary[];
}

export interface ProgramDecisionsResult {
  decisions: Array<{
    id: string;
    decisionType: 'CLOSE' | 'MERGE' | 'LAUNCH' | 'RESTRUCTURE' | 'KEEP_AS_IS' | 'OTHER';
    status: 'PROPOSED' | 'COUNCIL_REVIEWED' | 'APPROVED' | 'IN_IMPLEMENTATION' | 'IMPLEMENTED' | 'COMPLETED' | 'REJECTED' | 'SUPERSEDED' | 'ARCHIVED';
    rationaleTh: string | null;
    rationaleEn: string | null;
    effectiveDate: Date | null;
    decidedBy: string;
    createdAt: Date;
  }>;
  annotations: Array<{
    id: string;
    kind: string;
    sectionKey: string | null;
    bodyTh: string | null;
    bodyEn: string | null;
    author: string;
    createdAt: Date;
  }>;
}

export async function programOverview(programId: string): Promise<ProgramOverviewResult | null> {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    include: {
      faculty: { select: { id: true, nameEn: true, nameTh: true } },
      department: { select: { id: true, nameEn: true, nameTh: true } },
    },
  });
  if (!program) return null;

  const [health, lastAnalysedAt] = await Promise.all([
    computeHealthScores('program', programId).then((rows) => rows[0] ?? null),
    computeLastAnalysedAt(programId),
  ]);

  return {
    program: {
      id: program.id,
      code: program.code,
      nameEn: program.nameEn,
      nameTh: program.nameTh,
      level: program.level,
      status: program.status,
      yearEstablished: program.yearEstablished,
      curriculumYearBE: program.curriculumYearBE,
      faculty: program.faculty,
      department: program.department,
    },
    health,
    /** MAX(strategicNarrative.generatedAt, aiReadiness.generatedAt,
     *  peerReview.generatedAt, riskAssessment.assessedAt) — the most
     *  recent time any analytical-output table was written for this
     *  program. The deep-dive "Updated Xh ago" badge sources from this
     *  (a full DateTime), not from EnrollmentMetric.freshness_date
     *  which is `@db.Date` and always reads 00:00:00 UTC in tooltips. */
    lastAnalysedAt,
    methodologyVersion: HEALTH_SCORE_VERSION,
  };
}

// Health-radar benchmarks — the University and Faculty program-level
// dimension averages this program is plotted against. Split out from
// programOverview (the auth canary, kept fast) because the underlying
// all-programs scoring is heavier; it's memoised for 5 minutes so the
// steady-state cost is a map lookup.
export interface ProgramHealthBenchmarksResult {
  methodologyVersion: string;
  /** Number of programs scored for the university mean. */
  programCount: number;
  university: ProgramDimensionMeans;
  /** The program's faculty mean — null when the program has no faculty
   *  or the faculty contributed no scored programs. */
  faculty: ProgramDimensionMeans | null;
  facultyId: string | null;
  facultyNameTh: string | null;
}

export async function getProgramHealthBenchmarks(
  programId: string,
): Promise<ProgramHealthBenchmarksResult | null> {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { facultyId: true, faculty: { select: { nameTh: true } } },
  });
  if (!program) return null;
  const averages = await computeProgramDimensionAverages();
  return {
    methodologyVersion: averages.methodologyVersion,
    programCount: averages.programCount,
    university: averages.university,
    faculty: program.facultyId ? (averages.byFaculty[program.facultyId] ?? null) : null,
    facultyId: program.facultyId,
    facultyNameTh: program.faculty?.nameTh ?? null,
  };
}

async function computeLastAnalysedAt(programId: string): Promise<Date | null> {
  // Read the four analytical-output DateTime fields in parallel. Each is
  // upserted by a different pipeline phase. MAX across them = "when did
  // the pipeline last touch this program".
  const [narrative, aiReadiness, peerReview, risk] = await Promise.all([
    prisma.programStrategicNarrative.findUnique({
      where: { programId },
      select: { generatedAt: true },
    }),
    prisma.programAiReadinessAssessment.findUnique({
      where: { programId },
      select: { generatedAt: true },
    }),
    prisma.programPeerReview.findUnique({
      where: { programId },
      select: { generatedAt: true },
    }),
    prisma.riskAssessment.findFirst({
      where: { programId },
      orderBy: { assessedAt: 'desc' },
      select: { assessedAt: true },
    }),
  ]);
  const candidates: Date[] = [];
  if (narrative?.generatedAt) candidates.push(narrative.generatedAt);
  if (aiReadiness?.generatedAt) candidates.push(aiReadiness.generatedAt);
  if (peerReview?.generatedAt) candidates.push(peerReview.generatedAt);
  if (risk?.assessedAt) candidates.push(risk.assessedAt);
  if (candidates.length === 0) return null;
  return new Date(Math.max(...candidates.map((d) => d.getTime())));
}

// ── Demand funnel ──────────────────────────────────────────────────────
// Applications → Admitted → Enrolled → Year-2 retained → Graduated on
// Composes the funnel from THREE real data sources:
//   1. tcas_admission_stats — TCAS3 applicants + admitted (where year on
//      file). Only TCAS3 channel for now (~25-50% of total admissions
//      depending on program).
//   2. alumni_cohort_statuses — exit-status counts by entry-year × bucket
//      from the registrar's VIEW_STUDENT_DETAIL_ALUMNI.
//   3. student_cohort_distributions — currently-active students by entry
//      year (live cohort, not yet exited).
//
// The funnel is anchored on the most recent COMPLETED cohort (entry
// year ≤ currentBE − programDuration − 1) so all 5 stages are
// comparable. Recent in-progress cohorts get a "partial cohort" trend
// row but don't drive the funnel value display.
//
// Stage definitions:
//   Applied        TCAS3 applicants (where TCAS3 data exists)
//   Admitted       TCAS3 admittedPass1 + admittedPass2 (where TCAS3 exists)
//   Enrolled       Total cohort entrants − RENOUNCED − NO_REPORT
//   Persisted      Enrolled − early dropouts (FINANCIAL/ACADEMIC/VOLUNTARY/TRANSFERRED)
//                  — STILL_ENROLLED counts here too, since those completed Year 2+
//   Graduated      Alumni rows with bucket=GRADUATED
export async function programDemandFunnel(programId: string) {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { facultyId: true, durationYears: true },
  });

  // Pull all the per-cohort data in parallel. `funnelYears` is the
  // ADMISSION_STAT all-rounds funnel (via the adapter) — preferred for the
  // top-of-funnel "Applied"/"Passed" stages when it covers the anchor
  // cohort year; the TCAS3 rows (peer/mytcas, wider year coverage) remain
  // the fallback for older completed cohorts ADMISSION_STAT doesn't reach.
  const [alumniRows, cohortRows, tcasRows, funnelYears] = await Promise.all([
    prisma.alumniCohortStatus.findMany({
      where: { programId, ...realDataWhere() },
      orderBy: [{ entryYearBE: 'asc' }, { statusBucket: 'asc' }],
    }),
    prisma.studentCohortDistribution.findMany({
      where: { programId, ...realDataWhere() },
      orderBy: { entryYearBE: 'asc' },
    }),
    prisma.tcasAdmissionStat.findMany({
      where: { programId, ...realDataWhere() },
      orderBy: [{ entryYearBE: 'asc' }, { round: 'desc' }],
    }),
    programFunnelYears(programId),
  ]);
  const funnelByYear = new Map(funnelYears.map((y) => [y.entryYearBE, y]));

  // Bucket alumni by year.
  type CohortRoll = {
    entryYearBE: number;
    graduated: number;
    renounced: number;
    noReport: number;
    droppedFinancial: number;
    droppedAcademic: number;
    droppedVoluntary: number;
    transferred: number;
    other: number;
    stillEnrolled: number;
  };
  const cohortMap = new Map<number, CohortRoll>();
  const ensureCohort = (yr: number): CohortRoll => {
    let c = cohortMap.get(yr);
    if (!c) {
      c = {
        entryYearBE: yr,
        graduated: 0,
        renounced: 0,
        noReport: 0,
        droppedFinancial: 0,
        droppedAcademic: 0,
        droppedVoluntary: 0,
        transferred: 0,
        other: 0,
        stillEnrolled: 0,
      };
      cohortMap.set(yr, c);
    }
    return c;
  };
  for (const a of alumniRows) {
    const c = ensureCohort(a.entryYearBE);
    switch (a.statusBucket) {
      case 'GRADUATED': c.graduated += a.count; break;
      case 'RENOUNCED': c.renounced += a.count; break;
      case 'NO_REPORT': c.noReport += a.count; break;
      case 'DROPPED_FINANCIAL': c.droppedFinancial += a.count; break;
      case 'DROPPED_ACADEMIC': c.droppedAcademic += a.count; break;
      case 'DROPPED_VOLUNTARY': c.droppedVoluntary += a.count; break;
      case 'TRANSFERRED': c.transferred += a.count; break;
      default: c.other += a.count; break;
    }
  }
  for (const k of cohortRows) {
    ensureCohort(k.entryYearBE).stillEnrolled = k.studentCount;
  }
  // TCAS counts — pick the highest-round entry per (year) since r3.2
  // supersedes r3.1.
  const tcasByYear = new Map<number, { applicants: number; admitted: number; round: string }>();
  for (const t of tcasRows) {
    const cur = tcasByYear.get(t.entryYearBE);
    const candidate = {
      applicants: t.applicants,
      admitted: t.admittedPass1 + t.admittedPass2,
      round: t.round,
    };
    if (!cur || cur.round.localeCompare(t.round) < 0) {
      tcasByYear.set(t.entryYearBE, candidate);
    }
  }

  // Pick the funnel anchor — most recent COMPLETED cohort.
  // currentBE - durationYears - 1 = last expected on-time graduation year.
  const nowCE = new Date().getUTCFullYear();
  const currentBE = nowCE + 543;
  const duration = program?.durationYears ?? 4;
  const minCompletedBE = 0; // floor (always allow)
  const maxCompletedBE = currentBE - duration - 1;
  const sortedYears = [...cohortMap.keys()].sort((a, b) => a - b);
  // Prefer the most recent year whose cohort has had time to complete.
  const completedYears = sortedYears.filter(
    (y) => y >= minCompletedBE && y <= maxCompletedBE,
  );
  const anchorYear = completedYears.at(-1) ?? sortedYears.at(-1) ?? null;

  // Compose the 5-stage funnel for the anchor cohort.
  let stages: Array<{ key: string; label: string; value: number }> = [];
  const conversions: Array<{ fromKey: string; toKey: string; rate: number | null }> = [];
  let alumniBreakdown: Array<{ bucket: string; count: number; pct: number }> = [];
  let stillEnrolledForAnchor = 0;
  let cohortCompleted = false;
  if (anchorYear !== null) {
    const c = cohortMap.get(anchorYear)!;
    cohortCompleted = anchorYear <= maxCompletedBE;
    const totalAlumni =
      c.graduated + c.renounced + c.noReport + c.droppedFinancial +
      c.droppedAcademic + c.droppedVoluntary + c.transferred + c.other;
    const totalCohort = totalAlumni + c.stillEnrolled;
    const enrolled = totalCohort - c.renounced - c.noReport;
    const persistedPastYear1 =
      enrolled - c.droppedFinancial - c.droppedAcademic - c.droppedVoluntary - c.transferred;
    stillEnrolledForAnchor = c.stillEnrolled;

    // The mytcas.com 2024 schema (TCAS62-67) didn't expose admitted-
    // pass-1/2 columns reliably; only TCAS68 r3.1/r3.2 has them
    // populated. So `tcas.admitted` may be 0 for older cohorts even
    // though applicants is real. We use the cohort total (alumni +
    // currently-active = everyone who received a STUDENTCODE) as the
    // ground-truth "admitted across all channels" — this is more
    // complete anyway since TCAS3 is only ~25-50% of admissions.
    const tcas = tcasByYear.get(anchorYear);
    const funnel = anchorYear !== null ? funnelByYear.get(anchorYear) : undefined;
    const stagesRaw: Array<{ key: string; label: string; value: number }> = [];
    // Prefer ADMISSION_STAT (all rounds) for the top of funnel; fall back to
    // TCAS3-round data for cohorts ADMISSION_STAT doesn't cover.
    if (funnel && funnel.totalApplicants > 0) {
      stagesRaw.push({ key: 'applied', label: 'Applied (all TCAS rounds)', value: funnel.totalApplicants });
      if (funnel.totalPassed > 0) {
        stagesRaw.push({ key: 'passed', label: 'Passed selection', value: funnel.totalPassed });
      }
    } else if (tcas && tcas.applicants > 0) {
      stagesRaw.push({ key: 'applied', label: 'Applied (TCAS3 round)', value: tcas.applicants });
      if (tcas.admitted > 0) {
        stagesRaw.push({ key: 'admitted_tcas', label: 'Admitted (TCAS3)', value: tcas.admitted });
      }
    }
    stagesRaw.push({
      key: 'admitted',
      label: 'Admitted (all channels)',
      value: totalCohort,
    });
    stagesRaw.push({ key: 'enrolled', label: 'Enrolled', value: Math.max(enrolled, 0) });
    stagesRaw.push({ key: 'persisted', label: 'Persisted past Year 1', value: Math.max(persistedPastYear1, 0) });
    stagesRaw.push({ key: 'graduated', label: 'Graduated', value: c.graduated });
    stages = stagesRaw;

    for (let i = 1; i < stages.length; i++) {
      const prev = stages[i - 1]!;
      const curr = stages[i]!;
      conversions.push({
        fromKey: prev.key,
        toKey: curr.key,
        rate: prev.value > 0 ? curr.value / prev.value : null,
      });
    }

    if (totalAlumni > 0) {
      const buckets: Array<[string, number]> = [
        ['GRADUATED', c.graduated],
        ['RENOUNCED', c.renounced],
        ['NO_REPORT', c.noReport],
        ['DROPPED_FINANCIAL', c.droppedFinancial],
        ['DROPPED_ACADEMIC', c.droppedAcademic],
        ['DROPPED_VOLUNTARY', c.droppedVoluntary],
        ['TRANSFERRED', c.transferred],
        ['OTHER', c.other],
      ];
      alumniBreakdown = buckets
        .filter(([, n]) => n > 0)
        .map(([bucket, count]) => ({
          bucket,
          count,
          pct: (count / totalAlumni) * 100,
        }))
        .sort((a, b) => b.count - a.count);
    }
  }

  // Multi-cohort trend — last 7 cohort years with key totals.
  const cohortTrend = sortedYears.slice(-7).map((yr) => {
    const c = cohortMap.get(yr)!;
    const totalAlumni =
      c.graduated + c.renounced + c.noReport + c.droppedFinancial +
      c.droppedAcademic + c.droppedVoluntary + c.transferred + c.other;
    const totalCohort = totalAlumni + c.stillEnrolled;
    const droppedTotal =
      c.droppedFinancial + c.droppedAcademic + c.droppedVoluntary + c.transferred;
    return {
      entryYearBE: yr,
      entryYearCE: yr - 543,
      admittedTotal: totalCohort,
      enrolled: Math.max(totalCohort - c.renounced - c.noReport, 0),
      stillEnrolled: c.stillEnrolled,
      graduated: c.graduated,
      droppedTotal,
      renouncedOrNoReport: c.renounced + c.noReport,
      cohortCompleted: yr <= maxCompletedBE,
    };
  });

  // Latest freshness — alumni rows are timestamped in `refreshedAt`.
  const latestRefresh = await prisma.alumniCohortStatus.findFirst({
    where: { programId, ...realDataWhere() },
    orderBy: { refreshedAt: 'desc' },
    select: { refreshedAt: true },
  });

  return {
    anchorEntryYearBE: anchorYear,
    anchorEntryYearCE: anchorYear !== null ? anchorYear - 543 : null,
    cohortCompleted,
    programDurationYears: program?.durationYears ?? null,
    stages,
    conversions,
    alumniBreakdown,
    stillEnrolledForAnchor,
    cohortTrend,
    latestFreshness: latestRefresh?.refreshedAt ?? null,
    benchmarks: anchorYear !== null
      ? await benchmarkEnrolment(programId, anchorYear - 543)
      : null,
    methodologyVersion: 'demand-funnel.v2',
  };
}

async function benchmarkEnrolment(programId: string, year: number | undefined) {
  const program = await prisma.program.findUnique({ where: { id: programId } });
  if (!program || year === undefined) return null;
  const [fac, uni] = await Promise.all([
    queryMetricByScope({ scope: 'faculty', scopeId: program.facultyId, family: 'enrollment' }),
    queryMetricByScope({ scope: 'university', family: 'enrollment' }),
  ]);
  const facYear = fac.find((r) => r.year === year);
  const uniYear = uni.find((r) => r.year === year);
  return {
    faculty: facYear
      ? {
          admissionYield:
            facYear.admittedTotal && facYear.applicationsTotal
              ? facYear.admittedTotal / facYear.applicationsTotal
              : null,
          year2Retention:
            facYear.retainedYear2Total && facYear.enrolledTotal
              ? facYear.retainedYear2Total / facYear.enrolledTotal
              : null,
        }
      : null,
    university: uniYear
      ? {
          admissionYield:
            uniYear.admittedTotal && uniYear.applicationsTotal
              ? uniYear.admittedTotal / uniYear.applicationsTotal
              : null,
          year2Retention:
            uniYear.retainedYear2Total && uniYear.enrolledTotal
              ? uniYear.retainedYear2Total / uniYear.enrolledTotal
              : null,
        }
      : null,
  };
}

// ── Student cohort distribution ────────────────────────────────────────
// Histogram of currently-enrolled students by their entry-year cohort.
// Entry year derived from the first 2 digits of STUDENTCODE in BE.
// Populated by `pnpm programs:link-cohorts` (Oracle / kku-registry).
//
// Calendar logic:
//   KKU's academic year starts in JUNE. So between Jan-May of CE year
//   N, the active academic year is BE (N + 543 - 1). From June onward
//   it rolls to BE (N + 543).
//
//   yearInProgramme = currentAcademicYearBE - entryYearBE + 1
//
//     Year 0 → "Incoming" (admitted but classes haven't started yet —
//              between admission and June 1)
//     Year 1..N → on-track for an N-year program (Program.durationYears)
//     Year N+1.. → DELAYED graduation (low-performance signal)
export type CohortStatus = 'incoming' | 'on-track' | 'delayed';

export interface ProgramCohortDistribution {
  /** One bar per entry-year cohort, ordered ascending by year. */
  cohorts: Array<{
    /** Entry year in Buddhist Era (e.g., 2565). */
    entryYearBE: number;
    /** Same cohort in Common Era (e.g., 2022). */
    entryYearCE: number;
    /** Currently active students from this entry cohort. */
    studentCount: number;
    /** Year in programme — 0 = incoming (pre-June of entry year),
     *  1..N = on-track, > N = delayed (where N = Program.durationYears). */
    yearInProgramme: number;
    status: CohortStatus;
  }>;
  totalActive: number;
  /** Active academic year (BE) the analysis is anchored to. */
  currentAcademicYearBE: number;
  /** Nominal program duration in years (from Program.durationYears).
   *  Null if not extracted yet — delayed-flag becomes 'unknown'. */
  programDurationYears: number | null;
  /** Number of students with status='incoming' (Year 0). */
  incomingCount: number;
  /** Number of students with status='on-track' (Years 1..N). */
  onTrackCount: number;
  /** Number of students whose study time has exceeded the nominal
   *  duration — a delayed-graduation / low-performance signal. */
  delayedCount: number;
  refreshedAt: string | null;
}

/** Active academic year (BE). Delegates to the configurable academic-year
 *  boundary so deep-dive, recruitment, and risk all roll over together. */
export function currentAcademicYearBE(now: Date = new Date()): number {
  return academicYearContextSync(now).currentAcademicYearBE;
}

export async function programStudentCohorts(
  programId: string,
  now: Date = new Date(),
): Promise<ProgramCohortDistribution> {
  const [program, rows] = await Promise.all([
    prisma.program.findUnique({
      where: { id: programId },
      select: { durationYears: true },
    }),
    prisma.studentCohortDistribution.findMany({
      where: { programId, ...realDataWhere() },
      orderBy: { entryYearBE: 'asc' },
    }),
  ]);
  const programDurationYears = program?.durationYears ?? null;
  await getAcademicYearContext(now);
  const academicYearBE = currentAcademicYearBE(now);

  if (rows.length === 0) {
    return {
      cohorts: [],
      totalActive: 0,
      currentAcademicYearBE: academicYearBE,
      programDurationYears,
      incomingCount: 0,
      onTrackCount: 0,
      delayedCount: 0,
      refreshedAt: null,
    };
  }
  const refreshedAt = rows.reduce<Date | null>((acc, r) => {
    if (!acc) return r.refreshedAt;
    return r.refreshedAt > acc ? r.refreshedAt : acc;
  }, null);

  const cohorts = rows.map((r) => {
    const yearInProgramme = academicYearBE - r.entryYearBE + 1;
    let status: CohortStatus;
    if (yearInProgramme <= 0) {
      status = 'incoming';
    } else if (programDurationYears && yearInProgramme > programDurationYears) {
      status = 'delayed';
    } else {
      status = 'on-track';
    }
    return {
      entryYearBE: r.entryYearBE,
      entryYearCE: r.entryYearBE - 543,
      studentCount: r.studentCount,
      yearInProgramme,
      status,
    };
  });

  let incomingCount = 0;
  let onTrackCount = 0;
  let delayedCount = 0;
  for (const c of cohorts) {
    if (c.status === 'incoming') incomingCount += c.studentCount;
    else if (c.status === 'delayed') delayedCount += c.studentCount;
    else onTrackCount += c.studentCount;
  }

  return {
    cohorts,
    totalActive: cohorts.reduce((s, c) => s + c.studentCount, 0),
    currentAcademicYearBE: academicYearBE,
    programDurationYears,
    incomingCount,
    onTrackCount,
    delayedCount,
    refreshedAt: refreshedAt ? refreshedAt.toISOString() : null,
  };
}

// ── Candidate supply per program (for the Trends Radar) ────────────────
// Splits a program's CURRENTLY-ACTIVE students (the same student_cohort_
// distributions the /programs/[id] cohort chart uses) into:
//   • immediate — students in/past their final nominal year, graduating
//     now/soon → the pool that can fill immediate job roles today.
//   • emerging  — the rest of the active pipeline (incoming + earlier on-track
//     years) → graduate over the following ~1-3 years, mapping to emerging
//     roles.
// `immediate` = students whose yearInProgramme >= Program.durationYears
// (final year + delayed); `emerging` = totalActive − immediate. When duration
// isn't extracted yet the final year can't be identified, so durationKnown is
// false and everything lands in `emerging`.
export interface ProgramCandidateSupply {
  programId: string;
  immediate: number;
  emerging: number;
  totalActive: number;
  durationKnown: boolean;
}

export async function programsCandidateSupply(
  programIds: string[],
  now: Date = new Date(),
): Promise<Map<string, ProgramCandidateSupply>> {
  const result = new Map<string, ProgramCandidateSupply>();
  if (programIds.length === 0) return result;
  await getAcademicYearContext(now);
  const academicYearBE = currentAcademicYearBE(now);
  const [programs, rows] = await Promise.all([
    prisma.program.findMany({
      where: { id: { in: programIds } },
      select: { id: true, durationYears: true },
    }),
    prisma.studentCohortDistribution.findMany({
      where: { programId: { in: programIds }, ...realDataWhere() },
      select: { programId: true, entryYearBE: true, studentCount: true },
    }),
  ]);
  const durationById = new Map(programs.map((p) => [p.id, p.durationYears]));
  for (const id of programIds) {
    result.set(id, {
      programId: id,
      immediate: 0,
      emerging: 0,
      totalActive: 0,
      durationKnown: durationById.get(id) != null,
    });
  }
  for (const r of rows) {
    const entry = result.get(r.programId);
    if (!entry) continue;
    const duration = durationById.get(r.programId) ?? null;
    const yearInProgramme = academicYearBE - r.entryYearBE + 1;
    entry.totalActive += r.studentCount;
    if (duration != null && yearInProgramme >= duration) entry.immediate += r.studentCount;
    else entry.emerging += r.studentCount;
  }
  return result;
}

// ── Strategic narrative (pre-computed by pipeline) ─────────────────────
export interface ProgramStrategicNarrativeResult {
  contentMarkdown: string;
  confidence: number;
  methodVersion: string;
  generatedAt: string;
}

export async function programStrategicNarrative(
  programId: string,
): Promise<ProgramStrategicNarrativeResult | null> {
  const row = await prisma.programStrategicNarrative.findUnique({
    where: { programId },
  });
  if (!row) return null;
  return {
    contentMarkdown: row.contentMarkdown,
    confidence: row.confidence,
    methodVersion: row.methodVersion,
    generatedAt: row.generatedAt.toISOString(),
  };
}

// ── Research expertise ────────────────────────────────────────────────
// Reads the persisted `program-research-expertise` brief (see
// program-research-expertise-run.ts) for the deep-dive section. UNLIKE
// programStrategicNarrative above, ProgramResearchExpertise is
// INSERT-ONLY — a program can accrete multiple rows over time (re-runs
// via `pnpm expertise:generate`) — so this reads the LATEST by
// generatedAt rather than a unique-per-program row.
// Minimal view of the runner-persisted stats block — only the two fields
// the read path needs; extra keys pass through unvalidated by design.
const InputStatsSchema = z.object({
  totalDistinct: z.number().int().nonnegative(),
  notShownCount: z.number().int().nonnegative(),
});

export interface ProgramResearchExpertiseResult {
  payload: ProgramResearchExpertise;
  methodVersion: string;
  generatedAt: string;
  /** How many papers the model actually analysed vs the roster's total —
   *  paperCounts are counts WITHIN the analysed set (v2 rule), and the UI
   *  must state that basis rather than implying full-roster counts. */
  analysedPaperCount: number;
  totalDistinctPapers: number;
}

export async function programResearchExpertise(
  programId: string,
): Promise<ProgramResearchExpertiseResult | null> {
  const row = await prisma.programResearchExpertise.findFirst({
    where: { programId },
    orderBy: { generatedAt: 'desc' },
  });
  if (!row) return null;
  // inputStatsJson was written by the runner from the deterministic stats
  // block; totalDistinct/notShownCount reconstruct the analysed-set size
  // without a magic constant in any consumer.
  const stats = InputStatsSchema.parse(row.inputStatsJson);
  return {
    // Parsed (not cast) — payloadJson is a Prisma Json column with no
    // static shape; running it back through the same schema the runner
    // validated it against at write time is what makes the deep-dive's
    // typed read honest rather than an unchecked `as`.
    payload: ProgramResearchExpertiseSchema.parse(row.payloadJson),
    methodVersion: row.methodVersion,
    generatedAt: row.generatedAt.toISOString(),
    analysedPaperCount: stats.totalDistinct - stats.notShownCount,
    totalDistinctPapers: stats.totalDistinct,
  };
}

export interface ProgramResearchExpertiseReadinessResult {
  rosterSize: number;
  distinctPaperCount: number;
  readiness: ExpertiseReadiness;
}

/**
 * Cheap readiness verdict for the deep-dive's empty states — roster size
 * + a single scalar `COUNT(DISTINCT ...)` computed in Postgres. Deliberately
 * NOT `assembleResearchExpertiseInput()` (program-research-expertise.ts),
 * which additionally fetches every row's title/venue/citations/quartile to
 * score, rank, and build the full stats block — work this helper has no
 * need for and must not pay on every page view. `readinessFor()` is the
 * SAME pure function the runner uses, so the verdict here can never diverge
 * from what a generation run would have computed.
 */
export async function researchExpertiseReadiness(
  programId: string,
): Promise<ProgramResearchExpertiseReadinessResult | null> {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { id: true },
  });
  if (!program) return null;

  const roster = await prisma.programFaculty.findMany({
    where: { programId },
    select: { facultyMemberId: true },
  });
  const rosterSize = roster.length;
  if (rosterSize === 0) {
    return { rosterSize: 0, distinctPaperCount: 0, readiness: 'no-roster' };
  }

  const memberIds = roster.map((r) => r.facultyMemberId);
  const currentYear = new Date().getUTCFullYear();

  const rows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT COUNT(DISTINCT COALESCE(ro.doi, ro.openalex_id, ro.scopus_id, ro.pmid, LOWER(ro.title))) AS count
    FROM research_outputs ro
    WHERE ro.faculty_member_id = ANY(${memberIds}::text[])
      AND ro.year >= ${currentYear - 10}
      AND ${realDataSql('ro')}
  `);
  const distinctPaperCount = Number(rows[0]?.count ?? 0n);

  return {
    rosterSize,
    distinctPaperCount,
    readiness: readinessFor(rosterSize, distinctPaperCount),
  };
}

// ── AI readiness ───────────────────────────────────────────────────────
// AI is the single biggest disruption higher education faces this decade.
// Programs are evaluated against four sub-scores:
//   1. Curriculum AI-coverage — does the program teach AI/ML?
//   2. Skill resilience — are the taught skills AI-augmented (high-
//      judgment, creative) or AI-displaceable (rote, repetitive)?
//   3. AI research presence — % of recent faculty publications with
//      AI/ML / data-science focus
//   4. Pedagogical readiness — placeholder (instrumentation pending)
//
// The composite (40/30/20/10 weighted) feeds the lifecycle verdict as
// its single heaviest driver (±25 contribution). AI-specific gaps and
// recommendations are surfaced explicitly so Council can see
// per-program "AI debt".
export interface AiReadinessGap {
  topic: string;
  severity: 'major' | 'moderate' | 'minor';
  observation: string;
  /** Where peers do this well (sourced from peer-review when available). */
  peerReference: string | null;
}

export interface AiReadinessRecommendation {
  priority: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  effortHorizon: 'short' | 'medium' | 'long';
}

export interface ProgramAiReadiness {
  /** Composite 0-100. */
  overallScore: number;
  /** Sub-scores. */
  subScores: {
    curriculumIntegration: number;
    skillResilience: number;
    researchPresence: number;
    pedagogicalReadiness: number | null;
  };
  /** Deterministic flag categories from skill scan (counts). */
  skillBreakdown: {
    aiNative: number;       // explicit AI/ML/DL/LLM/NLP/CV/data-science skills
    aiAugmented: number;    // judgment, design, creativity, strategy, leadership
    aiDisplaceable: number; // rote computation, data entry, repetitive coding
    neutral: number;
  };
  aiPublicationsLast3Years: number;
  totalPublicationsLast3Years: number;
  /** AI-specific gaps — filtered from peer review v2 + computed from
   *  the deterministic curriculum scan. */
  gaps: AiReadinessGap[];
  /** AI-specific recommendations, priority-sorted. */
  recommendations: AiReadinessRecommendation[];
  /** 1-3 sentence narrative summary. */
  summary: string;
  methodologyVersion: string;
  generatedAt: string;
}

const AI_READINESS_VERSION = 'ai-readiness.v1';

// Keyword sets — matched against ProgramSkill.skill.nameEn (lowercased).
// Conservative; favours precision over recall (we'd rather under-count
// than over-promise AI readiness on weak matches).
const AI_NATIVE_KEYWORDS = [
  'artificial intelligence', 'machine learning', 'deep learning',
  'neural network', 'data science', 'data analytics', 'big data',
  'natural language processing', 'computer vision', 'reinforcement learning',
  'generative ai', 'large language model', 'llm', 'prompt engineering',
  'mlops', 'ai ethics', 'ai/ml', 'ml engineering',
];
const AI_AUGMENTED_KEYWORDS = [
  // High-judgment / creative skills that AI augments rather than replaces
  'design thinking', 'strategy', 'leadership', 'innovation', 'creativity',
  'critical thinking', 'systems thinking', 'research', 'entrepreneurship',
  'ethics', 'judgment', 'communication', 'negotiation',
  'project management', 'cross-cultural', 'mentoring', 'teaching',
];
const AI_DISPLACEABLE_KEYWORDS = [
  // Rote / repetitive skills that AI is actively automating
  'data entry', 'transcription', 'document review',
  'rote calculation', 'manual testing', 'basic accounting',
  'translation', 'copy editing', 'form filling',
];

export function classifySkill(name: string): 'aiNative' | 'aiAugmented' | 'aiDisplaceable' | 'neutral' {
  const n = name.toLowerCase();
  if (AI_NATIVE_KEYWORDS.some((k) => n.includes(k))) return 'aiNative';
  if (AI_DISPLACEABLE_KEYWORDS.some((k) => n.includes(k))) return 'aiDisplaceable';
  if (AI_AUGMENTED_KEYWORDS.some((k) => n.includes(k))) return 'aiAugmented';
  return 'neutral';
}

const AI_RESEARCH_KEYWORDS = [
  'artificial intelligence', 'machine learning', 'deep learning',
  'neural', 'data science', 'reinforcement learning', 'generative',
  'natural language processing', 'computer vision', 'transformer',
  'llm', 'large language model', 'mlops',
];

export async function programAiReadiness(programId: string): Promise<ProgramAiReadiness> {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { level: true },
  });

  // 1. Curriculum scan — program skills with AI categorisation.
  const programSkills = await prisma.programSkill.findMany({
    where: { programId },
    include: { skill: { select: { nameEn: true, nameTh: true } } },
  });
  const breakdown = { aiNative: 0, aiAugmented: 0, aiDisplaceable: 0, neutral: 0 };
  let aiNativeWeight = 0;
  let totalWeight = 0;
  for (const ps of programSkills) {
    const cat = classifySkill(ps.skill.nameEn);
    breakdown[cat]++;
    totalWeight += ps.weight;
    if (cat === 'aiNative') aiNativeWeight += ps.weight;
  }
  const totalSkills = programSkills.length;

  // Curriculum integration: AI-native skill share, weighted. 25% of
  // skills with avg weight 0.7 → ~100; zero AI skills → 0.
  const curriculumIntegration =
    totalSkills === 0
      ? 0
      : Math.min(
          100,
          (aiNativeWeight / Math.max(totalWeight, 1)) * 400,
        );

  // 2. Skill resilience: weighted balance of native+augmented vs
  // displaceable. Score 50 = neutral; >50 = AI-resilient curriculum.
  const positiveCount = breakdown.aiNative * 2 + breakdown.aiAugmented;
  const negativeCount = breakdown.aiDisplaceable;
  const resilienceRaw =
    totalSkills === 0
      ? 50
      : 50 + ((positiveCount - negativeCount) / totalSkills) * 50;
  const skillResilience = Math.max(0, Math.min(100, resilienceRaw));

  // 3. Research presence: AI-related publications in last 3y / total.
  const programFaculty = await prisma.programFaculty.findMany({
    where: { programId },
    include: { facultyMember: { select: { id: true, isActive: true } } },
  });
  const memberIds = programFaculty
    .filter((p) => p.facultyMember.isActive)
    .map((p) => p.facultyMember.id);
  const currentYear = new Date().getUTCFullYear();
  let aiPubs = 0;
  let totalPubs = 0;
  if (memberIds.length > 0) {
    const pubs = await prisma.researchOutput.findMany({
      where: {
        facultyMemberId: { in: memberIds },
        year: { gte: currentYear - 3 },
        ...realDataWhere(),
      },
      select: { title: true },
    });
    totalPubs = pubs.length;
    aiPubs = pubs.filter((p) =>
      AI_RESEARCH_KEYWORDS.some((k) => p.title.toLowerCase().includes(k)),
    ).length;
  }
  const researchPresence =
    totalPubs === 0 ? 0 : Math.min(100, (aiPubs / totalPubs) * 200);

  // 4. Pedagogical readiness — populated from the persisted
  // ProgramPedagogyAssessment (`program-pedagogy.v1`). When the program
  // hasn't been pedagogy-assessed yet, falls back to null and the
  // composite redistributes weight across the other three sub-scores.
  const pedagogyAssessment = await prisma.programPedagogyAssessment.findUnique({
    where: { programId },
    select: { overallScore: true },
  });
  const pedagogicalReadiness: number | null = pedagogyAssessment?.overallScore ?? null;

  // Composite — 40 / 30 / 20 / 10 weighting. When pedagogical is null,
  // redistribute its weight equally across the other three.
  const weights = pedagogicalReadiness === null
    ? { c: 0.44, s: 0.33, r: 0.23, p: 0 }
    : { c: 0.40, s: 0.30, r: 0.20, p: 0.10 };
  const overallScore = Math.max(
    0,
    Math.min(
      100,
      curriculumIntegration * weights.c +
        skillResilience * weights.s +
        researchPresence * weights.r +
        (pedagogicalReadiness ?? 0) * weights.p,
    ),
  );

  // ── Gap surfacing ────────────────────────────────────────────────
  const gaps: AiReadinessGap[] = [];

  // From the curriculum scan
  if (breakdown.aiNative === 0) {
    gaps.push({
      topic: 'No AI/ML content in curriculum',
      severity: 'major',
      observation: `Of ${totalSkills} program skills, none are explicitly AI/ML/data-science. Graduates exit without exposure to the field reshaping their discipline.`,
      peerReference: null,
    });
  } else if (curriculumIntegration < 40) {
    gaps.push({
      topic: 'Thin AI/ML curriculum coverage',
      severity: 'moderate',
      observation: `Only ${breakdown.aiNative}/${totalSkills} program skills are AI-native; coverage is below the 25% threshold typical of frontier peer programs.`,
      peerReference: null,
    });
  }
  if (breakdown.aiDisplaceable > 0) {
    gaps.push({
      topic: 'Curriculum carries AI-displaceable skills',
      severity: breakdown.aiDisplaceable >= 2 ? 'moderate' : 'minor',
      observation: `${breakdown.aiDisplaceable} program skill(s) describe rote / repetitive work that LLMs already automate competitively.`,
      peerReference: null,
    });
  }
  if (totalPubs > 0 && aiPubs / totalPubs < 0.05) {
    gaps.push({
      topic: 'Low AI research output',
      severity: 'moderate',
      observation: `Only ${aiPubs}/${totalPubs} faculty publications in the last 3 years touch AI/ML. Faculty are not active in the field they're meant to teach.`,
      peerReference: null,
    });
  } else if (totalPubs === 0 && memberIds.length > 0) {
    gaps.push({
      topic: 'No measurable research output',
      severity: 'major',
      observation: `Active faculty produced 0 publications in the last 3 years; AI-research positioning cannot be assessed.`,
      peerReference: null,
    });
  }

  // From the AI peer review v2 contentGaps — filter to AI-related topics
  const peerReviewRow = await prisma.programPeerReview.findUnique({ where: { programId } });
  if (peerReviewRow) {
    const payload = peerReviewRow.payloadJson as
      | { contentGaps?: Array<{ topic: string; kkuStatus: string; peerExamples: string; severity: 'major' | 'moderate' | 'minor' }> }
      | null;
    const aiTopicRegex = /(ai|ml|machine learn|artificial intel|deep learn|data scienc|neural|generative|llm|nlp|computer vision|automation)/i;
    for (const g of payload?.contentGaps ?? []) {
      if (aiTopicRegex.test(g.topic)) {
        gaps.push({
          topic: g.topic,
          severity: g.severity,
          observation: g.kkuStatus,
          peerReference: g.peerExamples,
        });
      }
    }
  }

  // ── Recommendations ──────────────────────────────────────────────
  const recommendations: AiReadinessRecommendation[] = [];
  if (curriculumIntegration < 30) {
    recommendations.push({
      priority: 'high',
      title: 'Embed a mandatory AI/ML for the discipline course',
      detail:
        'Introduce a core 3-credit course pairing the program\'s domain with applied ML. Use existing open syllabi (MIT 6.036, Stanford CS229, Imperial M2AI) as templates. Target: 100% of graduates have hands-on ML exposure within 18 months.',
      effortHorizon: 'short',
    });
  }
  if (skillResilience < 50) {
    recommendations.push({
      priority: 'high',
      title: 'Phase out or transform AI-displaceable curriculum content',
      detail:
        'Audit every required course for content that LLMs/automation already do better than humans (rote computation, document drafting, basic translation, manual testing). Replace with judgment-heavy applied projects, AI-augmented workflows, or higher-order analysis.',
      effortHorizon: 'medium',
    });
  }
  if (researchPresence < 30 && memberIds.length > 0) {
    recommendations.push({
      priority: 'medium',
      title: 'Spin up an AI / domain research collaboration',
      detail:
        'Identify 2-3 faculty for cross-disciplinary AI research projects with KKU\'s College of Computing or external partners (NECTEC, AI Thailand, ASEAN AI consortium). Target: at least 15% of departmental publications touching AI within 3 years.',
      effortHorizon: 'long',
    });
  }
  if (breakdown.aiNative > 0 && curriculumIntegration < 70) {
    recommendations.push({
      priority: 'medium',
      title: 'Deepen existing AI exposure into a track',
      detail:
        'You have a foothold — convert isolated AI/ML electives into a cohesive 3-4 course track or specialisation that students can graduate with explicitly on their transcript.',
      effortHorizon: 'medium',
    });
  }
  if (recommendations.length === 0) {
    // Strong AI position — give the maintenance recommendation
    recommendations.push({
      priority: 'low',
      title: 'Maintain and showcase AI leadership',
      detail:
        'The program already shows strong AI integration. Focus on visibility (publications, industry partnerships, alumni stories) and on staying ahead of the next wave (e.g. agentic systems, multimodal models, AI safety).',
      effortHorizon: 'medium',
    });
  }
  // Pull AI-flavoured recommendations from peer review for additional Council options
  if (peerReviewRow) {
    const payload = peerReviewRow.payloadJson as
      | { recommendations?: Array<{ priority: 'high' | 'medium' | 'low'; title: string; detail: string; effortHorizon: 'short' | 'medium' | 'long' }> }
      | null;
    const aiTopicRegex = /(ai|ml|machine learn|artificial intel|deep learn|data scienc|generative|automation|llm|computational)/i;
    for (const r of payload?.recommendations ?? []) {
      if (aiTopicRegex.test(r.title) || aiTopicRegex.test(r.detail)) {
        recommendations.push({
          priority: r.priority,
          title: r.title,
          detail: r.detail,
          effortHorizon: r.effortHorizon,
        });
      }
    }
  }

  // ── Summary narrative ────────────────────────────────────────────
  let summary: string;
  if (overallScore >= 70) {
    summary = `Strong AI readiness (${overallScore.toFixed(0)}/100). Curriculum, skills, and research signal a discipline already engaging with the AI era.`;
  } else if (overallScore >= 45) {
    summary = `Partial AI readiness (${overallScore.toFixed(0)}/100). Selective AI exposure exists but the program is not yet structurally prepared for AI's role in the discipline.`;
  } else if (overallScore >= 20) {
    summary = `Low AI readiness (${overallScore.toFixed(0)}/100). The program is materially exposed to AI disruption and risks training graduates for a labour market that no longer wants the skills it teaches.`;
  } else {
    summary = `Critical AI gap (${overallScore.toFixed(0)}/100). The curriculum shows essentially no AI content; this is a structural threat to graduate employability.`;
  }
  void program; // silence unused — reserved for future per-level tuning

  // ── Discipline-aware AI override ─────────────────────────────────
  // When a ProgramAiReadinessAssessment row exists (generated by
  // program-ai-readiness.v2 — discipline-grounded reasoning), use its
  // overallScore + summary + gaps + recommendations IN PLACE OF the
  // deterministic v1 keyword-based output. Sub-scores + skillBreakdown
  // remain from the deterministic scan as a transparency layer ("here's
  // what the keyword scan saw; here's what the AI concluded once it
  // factored in your discipline").
  const aiAssessment = await prisma.programAiReadinessAssessment.findUnique({
    where: { programId },
  });
  if (aiAssessment) {
    const payload = aiAssessment.payloadJson as {
      relevanceScore: number;
      summary: string;
      gaps: Array<{ topic: string; severity: 'major' | 'moderate' | 'minor'; observation: string; peerReference: string | null }>;
      recommendations: Array<{ priority: 'high' | 'medium' | 'low'; title: string; detail: string; effortHorizon: 'short' | 'medium' | 'long' }>;
    };
    return {
      overallScore: payload.relevanceScore,
      subScores: {
        curriculumIntegration,
        skillResilience,
        researchPresence,
        pedagogicalReadiness,
      },
      skillBreakdown: breakdown,
      aiPublicationsLast3Years: aiPubs,
      totalPublicationsLast3Years: totalPubs,
      gaps: payload.gaps,
      recommendations: payload.recommendations,
      summary: payload.summary,
      methodologyVersion: aiAssessment.methodVersion,
      generatedAt: aiAssessment.generatedAt.toISOString(),
    };
  }

  return {
    overallScore,
    subScores: {
      curriculumIntegration,
      skillResilience,
      researchPresence,
      pedagogicalReadiness,
    },
    skillBreakdown: breakdown,
    aiPublicationsLast3Years: aiPubs,
    totalPublicationsLast3Years: totalPubs,
    gaps,
    recommendations: recommendations.slice(0, 8),
    summary,
    methodologyVersion: AI_READINESS_VERSION,
    generatedAt: new Date().toISOString(),
  };
}

// ── Program lifecycle verdict ──────────────────────────────────────────
// Single 4-band classifier combining EVERY signal the Deep-Dive exposes:
// health-score dimensions (attractiveness, financial, capability, outcomes,
// relevance), enrollment + tuition trends, demographic resilience, AI peer
// review's content-modernity verdict + content-gap severity, delayed-
// graduation share. Rules-based (auditable for Council) with the AI
// modernity verdict acting as a directional modifier.
//
// Verdicts:
//   - SUNSET   — declining on multiple fronts, weak fundamentals, structural
//                drift. Council action: closure / merger / radical
//                restructure.
//   - STABLE   — meeting current expectations, not growing. Council action:
//                hold + monitor.
//   - RISING   — improving across multiple signals. Council action: fund
//                continued development.
//   - FRONTIER — leading-edge program, future-defining. Council action:
//                showcase + scale.
//
// NOTE: `ProgramLifecycleVerdict` is now exported as a Prisma-generated
// enum from `@prisma/client` (the snapshot table uses it as a column
// type). Re-exporting here would clash, so consumers import the type
// directly from `@kku/db` via the wildcard re-export of `@prisma/client`.

export interface ProgramLifecycleDriver {
  label: string;
  /** Signed contribution to the trajectory score, -25 to +25. */
  contribution: number;
  raw: unknown;
}

/** One of the three modifier gates that can downgrade (never upgrade) the
 *  trajectory-score-based verdict (gap #8 closure). The presence of
 *  `gatesApplied[]` entries means the verdict reflects an institutional
 *  position, not just the trajectory math. */
export interface LifecycleGateEffect {
  /** Stable identifier — UI + analytics group by this. */
  name:
    | 'oldSchoolContentCap'
    | 'aiReadinessStableCap'
    | 'aiReadinessFrontierCap'
    | 'lowLabourMarketAlignmentStableCap'
    | 'lowLabourMarketAlignmentFrontierCap'
    | 'lowRevenuePotentialFrontierCap';
  /** Verdict before this gate fired (the counterfactual at this step). */
  from: ProgramLifecycleVerdict;
  /** Verdict after this gate fired. */
  to: ProgramLifecycleVerdict;
  /** Council-readable explanation of why this gate caps the verdict. */
  reason: string;
}

export interface ProgramLifecycleResult {
  /** Final verdict after all modifier gates have been applied. This is
   *  what surfaces on cockpit + Deep-Dive + Council Pack. */
  verdict: ProgramLifecycleVerdict;
  /** Counterfactual (gap #8): the verdict produced by trajectory score
   *  alone, with the 3 modifier gates skipped. Equals `verdict` when no
   *  gate fired. Surfaces in the lifecycle UI's "if gates were off" view
   *  so Council readers can see the gate's effect, even though the
   *  institutional position remains the gated value. */
  ungatedVerdict: ProgramLifecycleVerdict;
  /** Trajectory score, 0-100. Derived from weighted sum of drivers. */
  trajectoryScore: number;
  /** Drivers ordered by absolute contribution magnitude. */
  drivers: ProgramLifecycleDriver[];
  /** Modifier gates that fired (in application order). Empty when the
   *  trajectory-score-based verdict survived unchanged. */
  gatesApplied: LifecycleGateEffect[];
  /** 2-3 sentence rule-based narrative explaining the verdict. When any
   *  gate fired, mentions the gate's effect explicitly so the reader
   *  sees both the gated verdict and the counterfactual. */
  narrative: string;
  methodologyVersion: string;
  generatedAt: string;
}

// v1.1 (2026-05-02) adds AI-readiness as the single heaviest driver
// (±25). AI is the dominant disruption higher education faces this
// decade; the lifecycle verdict treats it as a first-class signal.
//
// v1.2 (2026-05-12) exposes the gate counterfactual (gap #8). No
// behavioural change to the gated verdict — only adds `ungatedVerdict`
// + `gatesApplied[]` to the result so Council readers can see when
// + why a modifier gate moved the verdict.
//
// v1.3 (2026-05-12) rebalances qualitative-vs-quantitative content
// signals after KKU-SEQ-0018 surfaced an over-weighted peer-review
// modernity verdict masking a 12.5% labour-market-alignment gap.
// Three coordinated changes:
//   1. content_modernity weight ±20 → ±10. The AI peer-review verdict
//      is qualitative (LLM-as-judge reading the syllabus); halving
//      stops a "modern-in-name-only" verdict from single-handedly
//      maxing the trajectory.
//   2. New first-class driver `labour_market_alignment` (±15) sourced
//      from the relevance-dimension driver, surfacing the
//      KMITL-employer-demand share directly into the lifecycle math
//      instead of leaving it diluted three layers deep inside health.
//   3. Two new modifier gates mirroring the AI-readiness gate pattern:
//        lowLabourMarketAlignmentStableCap   (score < 30 → STABLE)
//        lowLabourMarketAlignmentFrontierCap (score < 50 + FRONTIER → RISING)
//      The gates make the institutional position explicit: a program
//      can't claim trajectory if it teaches a fraction of what
//      employers demand, regardless of how good the peer-review
//      reasoning sounds.
//
// v1.4 (2026-05-12) bakes revenue-production potential into the verdict
// after KKU-SEQ-0291 (PhD Epi & Biostat, ~2M THB/yr, ~4 students/cohort)
// landed at FRONTIER with v1.3. The verdict was technically correct on
// content + alignment, but FRONTIER means "flagship the university
// should invest more in" — a boutique research program with structural
// revenue ceiling can't carry that institutional weight, regardless of
// content quality. Encodes the non-degree HRD shift bench-checking
// post-grad programs.
// Two coordinated changes:
//   1. New driver `revenue_scale` (±10), level-aware bands ("are you
//      revenue-substantial for your level"). DOCTORAL programs naturally
//      sit lower, so the per-level target compensates.
//   2. New modifier gate `lowRevenuePotentialFrontierCap` — level-
//      INDEPENDENT absolute threshold of 3M THB/yr annual tuition.
//      FRONTIER caps to RISING if revenue < 3M. Rationale: FRONTIER is
//      strategic, not academic — a program below 3M/yr is at best a
//      boutique-excellence case. Combined with the per-level driver
//      above this creates the right balance: "good for your level" earns
//      a driver bump, but "flagship-class" requires absolute scale.
const LIFECYCLE_VERSION = 'lifecycle.v1.4';

/** Compute the revenue_scale driver value for a program.
 *  - Returns ±10 banded score
 *  - Null-safe: returns 0 when revenue or level is missing (no penalty
 *    for data gaps; programs land neutral). */
export function computeRevenueScaleContribution(
  latestAnnualRevenueThb: number | null,
  level: keyof typeof REVENUE_TARGET_THB_BY_LEVEL | string | null,
): number {
  if (latestAnnualRevenueThb === null || latestAnnualRevenueThb <= 0) return 0;
  if (!level || !(level in REVENUE_TARGET_THB_BY_LEVEL)) return 0;
  const target = REVENUE_TARGET_THB_BY_LEVEL[level as keyof typeof REVENUE_TARGET_THB_BY_LEVEL];
  const ratio = latestAnnualRevenueThb / target;
  if (ratio >= 1.5) return 10;
  if (ratio >= 1.0) return 5;
  if (ratio >= 0.5) return 0;
  if (ratio >= 0.25) return -5;
  return -10;
}

export async function programLifecycleVerdict(
  programId: string,
): Promise<ProgramLifecycleResult> {
  // Pull every signal we already compute. All these helpers are
  // partial-year-aware + null-safe.
  const [
    healthRows,
    cohorts,
    demoOutlook,
    peerReviewRow,
    peerSelections,
    aiReadiness,
    program,
    latestFinancial,
  ] = await Promise.all([
    computeHealthScores('program', programId),
    programStudentCohorts(programId),
    programDemographicOutlook(programId),
    prisma.programPeerReview.findUnique({ where: { programId } }),
    prisma.programPeerSelection.findMany({ where: { programId }, take: 1 }),
    programAiReadiness(programId),
    prisma.program.findUnique({ where: { id: programId }, select: { level: true } }),
    // Latest completed-year tuition revenue. Used by the v1.4 revenue-
    // scale driver + the lowRevenuePotentialFrontierCap gate. Picks
    // most recent fiscal year — drop most-recent year if partial
    // (tuition < 30% of prior) to avoid penalising mid-year programs.
    prisma.financialMetric.findMany({
      where: { programId },
      orderBy: { fiscalYear: 'desc' },
      select: { tuitionRevenue: true, fiscalYear: true },
      take: 2,
    }),
  ]);
  const health = healthRows[0] ?? null;

  // Materialise latest annual revenue as a primitive THB number for the
  // driver + gate calculations below. Picks the most recent fiscal year
  // — drops it if partial (tuition < 30% of prior year) to avoid
  // penalising mid-year programs. Mirrors the partial-year drop applied
  // in scoreFinancialProgram (health-score.ts).
  const latestAnnualRevenueThb: number | null = (() => {
    if (latestFinancial.length === 0) return null;
    const head = latestFinancial[0];
    if (!head?.tuitionRevenue) return null;
    const latest = Number(head.tuitionRevenue);
    if (latestFinancial.length >= 2) {
      const prior = latestFinancial[1]?.tuitionRevenue;
      const priorN = prior ? Number(prior) : 0;
      // Partial-year heuristic: pick prior if latest is < 30% of prior.
      if (priorN > 0 && latest < priorN * 0.3) return priorN;
    }
    return latest;
  })();
  const latestRevenueFiscalYear =
    latestAnnualRevenueThb === null ? null : latestFinancial[0]?.fiscalYear ?? null;

  // ── Driver 1: overall health (central signal, weight 0.4) ────────
  // v1.1 weight reduced from 0.5 to 0.4 to make room for the new
  // AI-readiness driver while preserving headroom on the trajectory
  // score's 0-100 range.
  const overall = health?.overall.score ?? null;
  const healthDriver: ProgramLifecycleDriver = {
    label: 'health_overall',
    contribution: overall === null ? 0 : (overall - 50) * 0.4,
    raw: { score: overall, completeness: health?.overall.dataCompletenessPct ?? 0 },
  };

  // ── Driver 0 (heaviest): AI readiness — the single biggest signal ─
  // Composite from the AI-readiness scorer. Score 0-100 → ±25 around
  // a 50 baseline. Strong AI integration lifts; AI debt drags hard.
  const aiReadinessDriver: ProgramLifecycleDriver = {
    label: 'ai_readiness',
    contribution: (aiReadiness.overallScore - 50) * 0.5,
    raw: {
      score: aiReadiness.overallScore,
      curriculumIntegration: aiReadiness.subScores.curriculumIntegration,
      skillResilience: aiReadiness.subScores.skillResilience,
      researchPresence: aiReadiness.subScores.researchPresence,
    },
  };

  // ── Driver 2: enrollment trend slope (from attractiveness) ───────
  const enrollmentTrendDriver = extractDriverFromHealth(
    health,
    'attractiveness',
    'enrollment_trend_slope',
    (v) => (v - 50) * 0.6, // -30 to +30, capped to ±15
    'enrollment_trend',
    15,
  );

  // ── Driver 3: tuition trend slope (from financial) ───────────────
  const tuitionTrendDriver = extractDriverFromHealth(
    health,
    'financial',
    'tuition_trend_slope',
    (v) => (v - 50) * 0.4,
    'tuition_trend',
    10,
  );

  // ── Driver 4: content modernity (AI peer review v2) ──────────────
  // v1.3: weight halved from ±20 to ±10. This is a qualitative signal
  // (LLM-as-judge reading the syllabus against peer institutions) and
  // is correlated with — but not a substitute for — the quantitative
  // labour_market_alignment driver below.
  const reviewPayload = peerReviewRow?.payloadJson as
    | { contentModernity?: { verdict: string }; contentGaps?: Array<{ severity: string }> }
    | null
    | undefined;
  let modernityContribution = 0;
  let modernityVerdict: string | null = null;
  if (reviewPayload?.contentModernity) {
    modernityVerdict = reviewPayload.contentModernity.verdict;
    if (modernityVerdict === 'FRONTIER') modernityContribution = 10;
    else if (modernityVerdict === 'OLD_SCHOOL') modernityContribution = -10;
  }
  const modernityDriver: ProgramLifecycleDriver = {
    label: 'content_modernity',
    contribution: modernityContribution,
    raw: { verdict: modernityVerdict ?? 'unknown' },
  };

  // ── Driver 4b (NEW in v1.3): labour-market alignment ─────────────
  // Surfaces the KMITL-employer-demand-share driver from the relevance
  // dimension directly into the lifecycle math. Previously this signal
  // was diluted three layers deep (relevance dim → overall health →
  // health_overall driver × 0.4), so a 12.5% labour-market gap only
  // contributed ~-2 to the trajectory — easily masked by a +20
  // content_modernity verdict. Now first-class at ±15. Null when the
  // KMITL career mapping isn't populated yet (no penalty).
  const labourMarketScore =
    health?.dimensions.relevance.drivers.find((d) => d.label === 'labour_market_alignment')
      ?.value ?? null;
  const labourMarketDriver: ProgramLifecycleDriver = {
    label: 'labour_market_alignment',
    contribution:
      labourMarketScore === null
        ? 0
        : labourMarketScore >= 70
          ? 15
          : labourMarketScore >= 50
            ? 5
            : labourMarketScore >= 30
              ? -5
              : -15,
    raw: { score: labourMarketScore },
  };

  // ── Driver 5: major content gaps (penalty) ───────────────────────
  const majorGapCount =
    reviewPayload?.contentGaps?.filter((g) => g.severity === 'major').length ?? 0;
  const gapDriver: ProgramLifecycleDriver = {
    label: 'major_content_gaps',
    contribution: -Math.min(majorGapCount * 4, 12),
    raw: { count: majorGapCount },
  };

  // ── Driver 6: demographic resilience ─────────────────────────────
  const resilienceScore =
    health?.dimensions.relevance.drivers.find((d) => d.label === 'demographic_resilience')?.value ?? null;
  const resilienceDriver: ProgramLifecycleDriver = {
    label: 'demographic_resilience',
    contribution:
      resilienceScore === null
        ? 0
        : resilienceScore >= 80
          ? 10
          : resilienceScore >= 50
            ? 0
            : -10,
    raw: { score: resilienceScore, riskLevel: demoOutlook?.riskLevel ?? 'unknown' },
  };

  // ── Driver 7: delayed graduation share (cohort) ──────────────────
  const delayedShare =
    cohorts.totalActive > 0 ? cohorts.delayedCount / cohorts.totalActive : 0;
  const delayedDriver: ProgramLifecycleDriver = {
    label: 'delayed_graduation_share',
    contribution:
      delayedShare === 0
        ? 0
        : delayedShare >= 0.25
          ? -10
          : delayedShare >= 0.15
            ? -5
            : delayedShare >= 0.05
              ? -2
              : 0,
    raw: { delayedPct: delayedShare * 100 },
  };

  // ── Driver 8: capability strength (publications + senior rank) ───
  const capabilityScore = health?.dimensions.capability.score ?? null;
  const capabilityDriver: ProgramLifecycleDriver = {
    label: 'capability_strength',
    contribution:
      capabilityScore === null
        ? 0
        : capabilityScore >= 80
          ? 8
          : capabilityScore >= 60
            ? 3
            : capabilityScore < 40
              ? -8
              : 0,
    raw: { score: capabilityScore },
  };

  // ── Driver 4c (NEW in v1.4): revenue scale ───────────────────────
  // Level-aware "are you revenue-substantial for your level". Banded
  // ±10 — small enough not to dominate, large enough to materially
  // shift trajectory for outsized-revenue programs (high-volume
  // Bachelor's) and boutique programs (low-cohort PhDs).
  const revenueScaleDriver: ProgramLifecycleDriver = {
    label: 'revenue_scale',
    contribution: computeRevenueScaleContribution(latestAnnualRevenueThb, program?.level ?? null),
    raw: {
      latestAnnualRevenueThb,
      fiscalYear: latestRevenueFiscalYear,
      level: program?.level ?? null,
      target: program?.level
        ? REVENUE_TARGET_THB_BY_LEVEL[program.level as keyof typeof REVENUE_TARGET_THB_BY_LEVEL] ?? null
        : null,
    },
  };

  const drivers: ProgramLifecycleDriver[] = [
    aiReadinessDriver,
    healthDriver,
    enrollmentTrendDriver,
    tuitionTrendDriver,
    modernityDriver,
    labourMarketDriver, // v1.3
    revenueScaleDriver, // v1.4
    gapDriver,
    resilienceDriver,
    delayedDriver,
    capabilityDriver,
  ];

  const baselineScore = 50;
  const summed = drivers.reduce((s, d) => s + d.contribution, 0);
  const trajectoryScore = Math.max(0, Math.min(100, baselineScore + summed));

  // Verdict bands with content-modernity gates:
  //   - FRONTIER requires the AI's content-modernity verdict = FRONTIER.
  //     Strong metrics with IN_BETWEEN content max out at RISING — we
  //     can't claim "leading-edge" if the curriculum itself isn't.
  //   - OLD_SCHOOL content caps at STABLE — even with healthy metrics,
  //     a curriculum that's out of touch with the field shouldn't be
  //     called "rising" (its trajectory is illusory until content
  //     refreshes).
  //   - When the AI peer review hasn't run yet (modernityVerdict
  //     = null), we can't gate on it; treat as IN_BETWEEN.
  let verdict: ProgramLifecycleVerdict;
  if (trajectoryScore >= 80 && modernityVerdict === 'FRONTIER') verdict = 'FRONTIER';
  else if (trajectoryScore >= 65) verdict = 'RISING';
  else if (trajectoryScore >= 45) verdict = 'STABLE';
  else verdict = 'SUNSET';

  // Counterfactual capture (gap #8) — the trajectory-score-based verdict,
  // captured BEFORE the 3 modifier gates run. If no gate fires, this
  // equals `verdict`. If any gate fires, this is what the verdict would
  // be without the institutional-position caps.
  const ungatedVerdict = verdict;
  const gatesApplied: LifecycleGateEffect[] = [];

  // Apply OLD_SCHOOL cap: downgrade RISING/FRONTIER to STABLE.
  if (modernityVerdict === 'OLD_SCHOOL' && (verdict === 'RISING' || verdict === 'FRONTIER')) {
    const from = verdict;
    verdict = 'STABLE';
    gatesApplied.push({
      name: 'oldSchoolContentCap',
      from,
      to: verdict,
      reason: 'Peer-review content modernity verdict = OLD_SCHOOL; curriculum out of touch with the field caps the verdict at STABLE regardless of trajectory.',
    });
  }

  // AI-readiness gate. The 2026+ labour market punishes graduates
  // whose programmes ignored AI, so we apply two hard caps:
  //   - AI readiness < 30 → cap at STABLE (program faces structural
  //     AI threat regardless of how strong other metrics look)
  //   - AI readiness < 50 → cap at RISING (cannot claim FRONTIER
  //     without genuine AI integration)
  if (aiReadiness.overallScore < 30 && (verdict === 'RISING' || verdict === 'FRONTIER')) {
    const from = verdict;
    verdict = 'STABLE';
    gatesApplied.push({
      name: 'aiReadinessStableCap',
      from,
      to: verdict,
      reason: `AI readiness ${aiReadiness.overallScore.toFixed(0)}/100 < 30 — program faces structural AI threat regardless of trajectory; caps verdict at STABLE.`,
    });
  }
  if (aiReadiness.overallScore < 50 && verdict === 'FRONTIER') {
    const from = verdict;
    verdict = 'RISING';
    gatesApplied.push({
      name: 'aiReadinessFrontierCap',
      from,
      to: verdict,
      reason: `AI readiness ${aiReadiness.overallScore.toFixed(0)}/100 < 50 — FRONTIER label reserved for genuinely AI-integrated programs; caps at RISING.`,
    });
  }

  // Labour-market-alignment gates (NEW in v1.3). A program can't claim
  // trajectory if it teaches a fraction of what employers actually
  // demand, regardless of how good the peer-review modernity verdict
  // sounds. Two hard caps mirroring the AI-readiness gate pattern:
  //   - alignment < 30 → cap at STABLE (severe curriculum-market gap)
  //   - alignment < 50 → cap at RISING (FRONTIER reserved for programs
  //     that actually meet employer demand)
  // Null-safe: when the KMITL career mapping isn't populated yet, no
  // gate fires (we can't penalise data we don't have).
  if (
    labourMarketScore !== null &&
    labourMarketScore < 30 &&
    (verdict === 'RISING' || verdict === 'FRONTIER')
  ) {
    const from = verdict;
    verdict = 'STABLE';
    gatesApplied.push({
      name: 'lowLabourMarketAlignmentStableCap',
      from,
      to: verdict,
      reason: `Labour-market alignment ${labourMarketScore.toFixed(0)}/100 < 30 — program teaches only a fraction of employer-demanded skills; caps verdict at STABLE regardless of trajectory.`,
    });
  }
  if (labourMarketScore !== null && labourMarketScore < 50 && verdict === 'FRONTIER') {
    const from = verdict;
    verdict = 'RISING';
    gatesApplied.push({
      name: 'lowLabourMarketAlignmentFrontierCap',
      from,
      to: verdict,
      reason: `Labour-market alignment ${labourMarketScore.toFixed(0)}/100 < 50 — FRONTIER label reserved for programs that meet employer demand; caps at RISING.`,
    });
  }

  // Revenue-potential gate (NEW in v1.4). A program below the universal
  // 3M-THB/year flagship floor cannot claim FRONTIER regardless of
  // content or AI alignment — FRONTIER means "strategic flagship the
  // university should invest more in," not "academically excellent
  // boutique program." Encodes the non-degree HRD shift squeezing
  // post-grad cohorts.
  // Null-safe: when financial data is missing, gate cannot apply.
  if (
    latestAnnualRevenueThb !== null &&
    latestAnnualRevenueThb < FLAGSHIP_REVENUE_FLOOR_THB &&
    verdict === 'FRONTIER'
  ) {
    const from = verdict;
    verdict = 'RISING';
    const revM = (latestAnnualRevenueThb / 1_000_000).toFixed(1);
    const floorM = (FLAGSHIP_REVENUE_FLOOR_THB / 1_000_000).toFixed(0);
    gatesApplied.push({
      name: 'lowRevenuePotentialFrontierCap',
      from,
      to: verdict,
      reason: `Annual tuition revenue ${revM}M THB < ${floorM}M flagship floor — FRONTIER reserved for revenue-substantial programs (strategic, not academic); caps at RISING. Path to FRONTIER: grow cohort or partnerships.`,
    });
  }

  // ── Narrative ────────────────────────────────────────────────────
  const sortedDrivers = [...drivers].sort(
    (a, b) => Math.abs(b.contribution) - Math.abs(a.contribution),
  );
  const positives = sortedDrivers.filter((d) => d.contribution > 0).slice(0, 2);
  const negatives = sortedDrivers.filter((d) => d.contribution < 0).slice(0, 2);
  const narrativeParts: string[] = [];
  narrativeParts.push(verdictHeadline(verdict, trajectoryScore, modernityVerdict));
  if (positives.length > 0) {
    narrativeParts.push(
      `Lifting forces: ${positives.map((d) => labelToPhrase(d.label)).join(', ')}.`,
    );
  }
  if (negatives.length > 0) {
    narrativeParts.push(
      `Drag: ${negatives.map((d) => labelToPhrase(d.label)).join(', ')}.`,
    );
  }
  // Gate-counterfactual transparency (gap #8). When a modifier gate
  // moved the verdict, surface the counterfactual explicitly so
  // Council readers see the institutional position, not just its
  // effect.
  if (gatesApplied.length > 0) {
    const gateNames = gatesApplied.map((g) => labelGateName(g.name)).join(', ');
    narrativeParts.push(
      `Modifier gate(s) lowered verdict from ${ungatedVerdict} to ${verdict}: ${gateNames}.`,
    );
  }
  if (peerSelections.length === 0) {
    narrativeParts.push(
      'AI peer review not yet generated — run `pnpm peers:select <code>` for richer modernity + content-gap inputs.',
    );
  }
  const narrative = narrativeParts.join(' ');

  const result: ProgramLifecycleResult = {
    verdict,
    ungatedVerdict,
    trajectoryScore,
    drivers: sortedDrivers,
    gatesApplied,
    narrative,
    methodologyVersion: LIFECYCLE_VERSION,
    generatedAt: new Date().toISOString(),
  };

  // Write-through cache for the home dashboard + cockpit aggregations.
  // Re-running lifecycle compute for ~300 programs takes tens of
  // seconds; reading the snapshot is one indexed query. Failure is
  // intentionally swallowed — the snapshot is observability, not the
  // source of truth.
  prisma.programLifecycleSnapshot
    .upsert({
      where: { programId },
      create: {
        programId,
        verdict,
        trajectoryScore,
        methodologyVersion: LIFECYCLE_VERSION,
        driversJson: result as unknown as Prisma.InputJsonValue,
      },
      update: {
        verdict,
        trajectoryScore,
        methodologyVersion: LIFECYCLE_VERSION,
        driversJson: result as unknown as Prisma.InputJsonValue,
        computedAt: new Date(),
      },
    })
    .catch(() => undefined);

  return result;
}

function extractDriverFromHealth(
  health: HealthScoreRow | null,
  dim: HealthDimension,
  driverLabel: string,
  scaler: (v: number) => number,
  outLabel: string,
  cap: number,
): ProgramLifecycleDriver {
  const driver = health?.dimensions[dim].drivers.find((d) => d.label === driverLabel);
  if (!driver || driver.value === null) {
    return { label: outLabel, contribution: 0, raw: { score: null } };
  }
  const raw = scaler(driver.value);
  const clamped = Math.max(-cap, Math.min(cap, raw));
  return { label: outLabel, contribution: clamped, raw: { score: driver.value } };
}

function labelGateName(name: LifecycleGateEffect['name']): string {
  switch (name) {
    case 'oldSchoolContentCap':
      return 'OLD_SCHOOL content cap';
    case 'aiReadinessStableCap':
      return 'AI readiness < 30 (STABLE cap)';
    case 'aiReadinessFrontierCap':
      return 'AI readiness < 50 (FRONTIER cap)';
    case 'lowLabourMarketAlignmentStableCap':
      return 'Labour-market alignment < 30 (STABLE cap)';
    case 'lowLabourMarketAlignmentFrontierCap':
      return 'Labour-market alignment < 50 (FRONTIER cap)';
    case 'lowRevenuePotentialFrontierCap':
      return 'Revenue < 3M THB/yr flagship floor (FRONTIER cap)';
  }
}

function verdictHeadline(
  v: ProgramLifecycleVerdict,
  score: number,
  modernityVerdict: string | null,
): string {
  const s = score.toFixed(0);
  switch (v) {
    case 'FRONTIER':
      return `Frontier program (trajectory ${s}/100) — leading-edge content, strong fundamentals, future-defining.`;
    case 'RISING': {
      const modernityNote =
        modernityVerdict === 'IN_BETWEEN'
          ? ' Content sits in between fundamentals and the frontier — pushing the curriculum further would unlock Frontier status.'
          : modernityVerdict === null
            ? ' AI peer review not yet generated — content modernity unverified.'
            : '';
      return `Rising program (trajectory ${s}/100) — improving across multiple signals, growth trajectory.${modernityNote}`;
    }
    case 'STABLE': {
      const modernityNote =
        modernityVerdict === 'OLD_SCHOOL'
          ? ' Held back by old-school curriculum content — strong metrics are not enough without a content refresh.'
          : '';
      return `Stable program (trajectory ${s}/100) — meeting expectations, not yet growing.${modernityNote}`;
    }
    case 'SUNSET':
      return `Sunset risk (trajectory ${s}/100) — multiple signals declining; closure / merger / radical restructure on the table.`;
  }
}

function labelToPhrase(label: string): string {
  switch (label) {
    case 'ai_readiness': return 'AI readiness';
    case 'health_overall': return 'overall health';
    case 'enrollment_trend': return 'enrollment growth';
    case 'tuition_trend': return 'tuition growth';
    case 'content_modernity': return 'curriculum modernity';
    case 'labour_market_alignment': return 'labour-market alignment';
    case 'revenue_scale': return 'revenue scale';
    case 'major_content_gaps': return 'major content gaps vs peers';
    case 'demographic_resilience': return 'demographic resilience';
    case 'delayed_graduation_share': return 'delayed graduation share';
    case 'capability_strength': return 'faculty capability';
    default: return label.replace(/_/g, ' ');
  }
}

// ── AI-driven peer programs (QS / THE-ranked universities) ─────────────
// Two-phase comparison:
//   1. AI picks 3-5 best-fit peers per tier (program-peer-selection.v1)
//   2. AI writes a frank comparative review (program-peer-review.v1)
//      surfacing strengths · weaknesses · per-tier verdicts ·
//      improvement recommendations.
// The Deep-Dive UI leads with the REVIEW; the picks are supporting
// evidence (collapsed by default).
export interface PeerReviewBullet {
  claim: string;
  evidence: string;
}

export interface PeerReviewRecommendation {
  priority: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  effortHorizon: 'short' | 'medium' | 'long';
}

export interface PeerReviewContentGap {
  topic: string;
  kkuStatus: string;
  peerExamples: string;
  severity: 'major' | 'moderate' | 'minor';
  recommendation: string;
}

export interface ProgramAiPeerReview {
  strengths: PeerReviewBullet[];
  weaknesses: PeerReviewBullet[];
  tierVerdicts: {
    WORLD: string;
    ASIA: string;
    SOUTHEAST_ASIA: string;
    THAILAND_PEER: string;
  };
  /** Curriculum-content modernity verdict — added in v2. Null on
   *  older v1 review rows that haven't been regenerated yet. */
  contentModernity: {
    verdict: 'OLD_SCHOOL' | 'IN_BETWEEN' | 'FRONTIER';
    narrative: string;
  } | null;
  /** Specific topics where KKU's content lags peers. Null on v1 rows. */
  contentGaps: PeerReviewContentGap[] | null;
  recommendations: PeerReviewRecommendation[];
  subjectBenchmarkSummary: string;
  confidence: number;
  generatedAt: string;
  methodVersion: string;
  peerCountTotal: number;
}

export interface ProgramAiPeers {
  /** Subject area the AI used as the matching lens (e.g. "engineering-mechanical"). */
  subjectSignature: string | null;
  /** Selections grouped by tier, sorted by `rankInTier` ascending. */
  tiers: {
    WORLD: ProgramAiPeerEntry[];
    ASIA: ProgramAiPeerEntry[];
    SOUTHEAST_ASIA: ProgramAiPeerEntry[];
    THAILAND_PEER: ProgramAiPeerEntry[];
  };
  selectedAt: string | null;
  rankingYear: number | null;
  /** Frank comparative review. Null until `pnpm peers:select <code>`
   *  has run (the script generates picks then review by default). */
  review: ProgramAiPeerReview | null;
}

export interface ProgramAiPeerEntry {
  rankInTier: number;
  institutionName: string;
  country: string;
  qsWorldRank: number | null;
  theWorldRank: number | null;
  qsAsiaRank: number | null;
  websiteUrl: string | null;
  peerProgramName: string;
  peerProgramUrl: string | null;
  rationale: string;
  confidence: number;
  subjectArea: string | null;
}

export async function programAiPeers(programId: string): Promise<ProgramAiPeers> {
  const [rows, reviewRow] = await Promise.all([
    prisma.programPeerSelection.findMany({
      where: { programId },
      include: { rankedUniversity: true },
      orderBy: [{ tier: 'asc' }, { rankInTier: 'asc' }],
    }),
    prisma.programPeerReview.findUnique({ where: { programId } }),
  ]);
  const tiers: ProgramAiPeers['tiers'] = {
    WORLD: [],
    ASIA: [],
    SOUTHEAST_ASIA: [],
    THAILAND_PEER: [],
  };
  let signature: string | null = null;
  let selectedAt: string | null = null;
  let rankingYear: number | null = null;
  for (const r of rows) {
    if (!signature && r.subjectArea) signature = r.subjectArea;
    if (!selectedAt) selectedAt = r.selectedAt.toISOString();
    if (rankingYear === null) rankingYear = r.rankedUniversity.rankingYear;
    tiers[r.tier as keyof ProgramAiPeers['tiers']].push({
      rankInTier: r.rankInTier,
      institutionName: r.rankedUniversity.name,
      country: r.rankedUniversity.country,
      qsWorldRank: r.rankedUniversity.qsWorldRank,
      theWorldRank: r.rankedUniversity.theWorldRank,
      qsAsiaRank: r.rankedUniversity.qsAsiaRank,
      websiteUrl: r.rankedUniversity.websiteUrl,
      peerProgramName: r.peerProgramName,
      peerProgramUrl: r.peerProgramUrl,
      rationale: r.rationale,
      confidence: r.confidence,
      subjectArea: r.subjectArea,
    });
  }
  let review: ProgramAiPeerReview | null = null;
  if (reviewRow) {
    const p = reviewRow.payloadJson as unknown as {
      strengths: PeerReviewBullet[];
      weaknesses: PeerReviewBullet[];
      tierVerdicts: ProgramAiPeerReview['tierVerdicts'];
      recommendations: PeerReviewRecommendation[];
      subjectBenchmarkSummary: string;
      contentModernity?: ProgramAiPeerReview['contentModernity'];
      contentGaps?: PeerReviewContentGap[];
    };
    review = {
      strengths: p.strengths,
      weaknesses: p.weaknesses,
      tierVerdicts: p.tierVerdicts,
      contentModernity: p.contentModernity ?? null,
      contentGaps: p.contentGaps ?? null,
      recommendations: p.recommendations,
      subjectBenchmarkSummary: p.subjectBenchmarkSummary,
      confidence: reviewRow.confidence,
      generatedAt: reviewRow.generatedAt.toISOString(),
      methodVersion: reviewRow.methodVersion,
      peerCountTotal: reviewRow.peerCountTotal,
    };
  }
  return { subjectSignature: signature, tiers, selectedAt, rankingYear, review };
}

// ── TCAS3 admission stats ──────────────────────────────────────────────
// Annual round-3 ("Admission") admission outcomes published by
// mytcas.com (CUPT). The Deep-Dive surfaces:
//   1. This program's year-over-year history (quota / applicants /
//      competition ratio / fill rate / score range)
//   2. Peer rows from OTHER institutions running the SAME or SIMILAR
//      program — peer matching is NOT done at faculty granularity
//      (a faculty contains many disparate programs; comparing a
//      Mechanical Engineering BE against a Civil Engineering BE
//      because they share "Faculty of Engineering" is misleading).
//      The match key is the program's *subject signature* (the
//      parenthesised major or the "สาขาวิชา..." suffix of the
//      programme name), giving peer programs that actually deliver
//      the same curriculum across institutions.
//
// Faculty-level and university-level scoping have their own helpers
// (`facultyTcasStats` / `universityTcasStats`) that aggregate at the
// matching scope.
export interface ProgramTcasStats {
  /** This program's TCAS3 history. Multiple rows per year if the
   *  registrar split into round 3.1 + 3.2 (TCAS68 onward). */
  history: Array<{
    entryYearBE: number;
    round: string;
    quota: number;
    applicants: number;
    admittedPass1: number;
    admittedPass2: number;
    /** applicants / quota — pressure ratio. */
    competitionRatio: number;
    /** admitted / quota — fill rate. */
    fillRate: number;
    minScorePass1: number | null;
    maxScorePass1: number | null;
    minScorePass2: number | null;
    maxScorePass2: number | null;
    sourceUrl: string;
  }>;
  /** Peer rows for the latest available year — programs matching
   *  this one's *subject signature* across other Thai institutions.
   *  See `extractSubjectSignature` for how the signature is derived. */
  peers: Array<{
    institutionName: string;
    facultyName: string | null;
    programmeName: string;
    entryYearBE: number;
    round: string;
    quota: number;
    applicants: number;
    competitionRatio: number;
    minScorePass1: number | null;
    maxScorePass1: number | null;
    /** How the peer matched: 'exact' (programme-name string equality)
     *  or 'subject' (subject-signature equality, looser). */
    matchTier: 'exact' | 'subject';
  }>;
  /** Latest year where this program has any TCAS row. */
  latestEntryYearBE: number | null;
  /** All TCAS years observed for this program (for the year-axis). */
  yearsObserved: number[];
  /** The subject signature used for peer matching, surfaced for
   *  transparency in the UI's "How peers were matched" caveat. */
  peerMatchKey: string | null;
}

/** Derive a subject signature from a Thai TCAS programme name.
 *  - Prefers the parenthesised major: "วท.บ. (คณิตศาสตร์)" → "คณิตศาสตร์"
 *  - Falls back to the "สาขาวิชา<X>" pattern: "วศ.บ. สาขาวิชาวิศวกรรมเครื่องกล" → "วิศวกรรมเครื่องกล"
 *  - Final fallback: the full programme name (less useful but preserves
 *    deterministic matching).
 *
 *  Lowercased and whitespace-trimmed for comparison. */
export function extractSubjectSignature(programmeName: string): string {
  const inParens = programmeName.match(/\(([^)]+)\)/);
  if (inParens) return inParens[1]!.trim().toLowerCase();
  const withSakha = programmeName.match(/สาขาวิชา\s*([^\s,()/]+(?:\s+[^\s,()/]+)?)/);
  if (withSakha) return withSakha[1]!.trim().toLowerCase();
  return programmeName.trim().toLowerCase();
}

export async function programTcasStats(
  programId: string,
): Promise<ProgramTcasStats> {
  const rows = await prisma.tcasAdmissionStat.findMany({
    where: { programId, ...realDataWhere() },
    orderBy: [{ entryYearBE: 'asc' }, { round: 'asc' }],
  });

  const history = rows.map((r) => ({
    entryYearBE: r.entryYearBE,
    round: r.round,
    quota: r.quota,
    applicants: r.applicants,
    admittedPass1: r.admittedPass1,
    admittedPass2: r.admittedPass2,
    competitionRatio: r.quota > 0 ? r.applicants / r.quota : 0,
    fillRate: r.quota > 0 ? (r.admittedPass1 + r.admittedPass2) / r.quota : 0,
    minScorePass1: r.minScorePass1,
    maxScorePass1: r.maxScorePass1,
    minScorePass2: r.minScorePass2,
    maxScorePass2: r.maxScorePass2,
    sourceUrl: r.sourceUrl,
  }));

  const yearsObserved = [...new Set(rows.map((r) => r.entryYearBE))].sort(
    (a, b) => a - b,
  );
  const latestEntryYearBE = yearsObserved.at(-1) ?? null;

  // Peer matching — by subject signature, NOT by faculty name.
  let peers: ProgramTcasStats['peers'] = [];
  let peerMatchKey: string | null = null;
  if (latestEntryYearBE !== null && rows.length > 0) {
    // Use the latest (year, round) KKU row's programmeName as the
    // canonical for matching. Anchor to the specific (year, round)
    // pair — TCAS68 splits round 3.1 + 3.2 and the same programme
    // can appear in both, which would create duplicate peer entries
    // if we matched on year alone.
    const latestKkuRows = rows
      .filter((r) => r.entryYearBE === latestEntryYearBE)
      .sort((a, b) => b.round.localeCompare(a.round)); // r3.2 before r3.1
    const kkuLatest = latestKkuRows[0] ?? rows.at(-1)!;
    const latestRound = kkuLatest.round;
    const subjectKey = extractSubjectSignature(kkuLatest.programmeName);
    peerMatchKey = subjectKey;

    // Tier 1 — exact programmeName match (strongest peers, same
    // curriculum framing across institutions).
    const exactPeers = await prisma.tcasAdmissionStat.findMany({
      where: {
        programmeName: kkuLatest.programmeName,
        entryYearBE: latestEntryYearBE,
        round: latestRound,
        institutionName: { not: getInstitution().nameTh },
        ...realDataWhere(),
      },
      orderBy: [{ applicants: 'desc' }],
      take: 100,
    });

    // Tier 2 — same subject signature (looser; catches institutions
    // that label the same major with slightly different programme
    // wording). Filter results by extracting the signature and
    // requiring equality. Cap at 50 candidate rows to bound work.
    const subjectCandidates = await prisma.tcasAdmissionStat.findMany({
      where: {
        entryYearBE: latestEntryYearBE,
        round: latestRound,
        institutionName: { not: getInstitution().nameTh },
        ...realDataWhere(),
        // Crude pre-filter to keep the row volume sane — anything
        // whose programmeName contains the signature substring.
        programmeName: { contains: subjectKey, mode: 'insensitive' },
      },
      orderBy: [{ applicants: 'desc' }],
      take: 200,
    });
    const exactIds = new Set(exactPeers.map((r) => r.id));
    const subjectPeers = subjectCandidates
      .filter(
        (r) =>
          !exactIds.has(r.id) && extractSubjectSignature(r.programmeName) === subjectKey,
      )
      .slice(0, 50);

    peers = [
      ...exactPeers.map((r) => ({
        institutionName: r.institutionName,
        facultyName: r.facultyName,
        programmeName: r.programmeName,
        entryYearBE: r.entryYearBE,
        round: r.round,
        quota: r.quota,
        applicants: r.applicants,
        competitionRatio: r.quota > 0 ? r.applicants / r.quota : 0,
        minScorePass1: r.minScorePass1,
        maxScorePass1: r.maxScorePass1,
        matchTier: 'exact' as const,
      })),
      ...subjectPeers.map((r) => ({
        institutionName: r.institutionName,
        facultyName: r.facultyName,
        programmeName: r.programmeName,
        entryYearBE: r.entryYearBE,
        round: r.round,
        quota: r.quota,
        applicants: r.applicants,
        competitionRatio: r.quota > 0 ? r.applicants / r.quota : 0,
        minScorePass1: r.minScorePass1,
        maxScorePass1: r.maxScorePass1,
        matchTier: 'subject' as const,
      })),
    ];
  }

  return { history, peers, latestEntryYearBE, yearsObserved, peerMatchKey };
}

// ── Faculty-level + University-level TCAS stats ────────────────────────
// For Cockpit / Benchmarking surfaces. Faculty scope = aggregate of
// all programs in this faculty across the latest TCAS year, peers =
// the corresponding faculty (same `facultyName` string) at OTHER
// institutions. University scope = aggregate of all KKU rows, peers
// = aggregate of each peer institution's full TCAS portfolio.
export interface FacultyTcasStats {
  scope: 'faculty';
  facultyName: string;
  /** KKU's faculty aggregate for the latest year. */
  kkuAggregate: TcasScopeAggregate;
  /** Same-named faculty at other institutions, latest year. */
  peers: Array<TcasScopeAggregate & { institutionName: string }>;
  latestEntryYearBE: number | null;
}

export interface UniversityTcasStats {
  scope: 'university';
  /** KKU's institution-wide aggregate for the latest year. */
  kkuAggregate: TcasScopeAggregate;
  /** Other institutions, ranked by total applicants desc. */
  peers: Array<TcasScopeAggregate & { institutionName: string }>;
  latestEntryYearBE: number | null;
}

interface TcasScopeAggregate {
  programCount: number;
  totalQuota: number;
  totalApplicants: number;
  totalAdmitted: number;
  /** Σ applicants / Σ quota — weighted by quota size. */
  weightedCompetitionRatio: number;
  /** Σ admitted / Σ quota. */
  weightedFillRate: number;
  /** Mean of per-program min scores (only programs that reported one). */
  meanMinScore: number | null;
}

function aggregateRows(rows: Array<{
  quota: number;
  applicants: number;
  admittedPass1: number;
  admittedPass2: number;
  minScorePass1: number | null;
}>): TcasScopeAggregate {
  const totalQuota = rows.reduce((s, r) => s + r.quota, 0);
  const totalApplicants = rows.reduce((s, r) => s + r.applicants, 0);
  const totalAdmitted = rows.reduce(
    (s, r) => s + r.admittedPass1 + r.admittedPass2,
    0,
  );
  const minScores = rows
    .map((r) => r.minScorePass1)
    .filter((s): s is number => s !== null);
  return {
    programCount: rows.length,
    totalQuota,
    totalApplicants,
    totalAdmitted,
    weightedCompetitionRatio: totalQuota > 0 ? totalApplicants / totalQuota : 0,
    weightedFillRate: totalQuota > 0 ? totalAdmitted / totalQuota : 0,
    meanMinScore:
      minScores.length > 0
        ? minScores.reduce((s, v) => s + v, 0) / minScores.length
        : null,
  };
}

export async function facultyTcasStats(
  facultyId: string,
): Promise<FacultyTcasStats | null> {
  const faculty = await prisma.faculty.findUnique({
    where: { id: facultyId },
    select: { nameTh: true },
  });
  if (!faculty) return null;
  const facultyNameTh = faculty.nameTh;
  const ownNameTh = getInstitution().nameTh;

  // Latest year present in the dataset for THIS faculty.
  const latestRow = await prisma.tcasAdmissionStat.findFirst({
    where: { facultyName: facultyNameTh, institutionName: ownNameTh, ...realDataWhere() },
    orderBy: [{ entryYearBE: 'desc' }, { round: 'desc' }],
    select: { entryYearBE: true },
  });
  const latestEntryYearBE = latestRow?.entryYearBE ?? null;
  if (latestEntryYearBE === null) {
    return {
      scope: 'faculty',
      facultyName: facultyNameTh,
      kkuAggregate: aggregateRows([]),
      peers: [],
      latestEntryYearBE: null,
    };
  }

  const allRows = await prisma.tcasAdmissionStat.findMany({
    where: { facultyName: facultyNameTh, entryYearBE: latestEntryYearBE, ...realDataWhere() },
    select: {
      institutionName: true,
      quota: true,
      applicants: true,
      admittedPass1: true,
      admittedPass2: true,
      minScorePass1: true,
    },
  });
  const kkuRows = allRows.filter((r) => r.institutionName === ownNameTh);
  const peerByInst = new Map<string, typeof allRows>();
  for (const r of allRows) {
    if (r.institutionName === ownNameTh) continue;
    const arr = peerByInst.get(r.institutionName) ?? [];
    arr.push(r);
    peerByInst.set(r.institutionName, arr);
  }
  const peers = [...peerByInst.entries()]
    .map(([institutionName, rows]) => ({
      institutionName,
      ...aggregateRows(rows),
    }))
    .sort((a, b) => b.totalApplicants - a.totalApplicants);

  return {
    scope: 'faculty',
    facultyName: facultyNameTh,
    kkuAggregate: aggregateRows(kkuRows),
    peers,
    latestEntryYearBE,
  };
}

export async function universityTcasStats(): Promise<UniversityTcasStats | null> {
  const ownNameTh = getInstitution().nameTh;
  const latestRow = await prisma.tcasAdmissionStat.findFirst({
    where: { institutionName: ownNameTh, ...realDataWhere() },
    orderBy: [{ entryYearBE: 'desc' }, { round: 'desc' }],
    select: { entryYearBE: true },
  });
  const latestEntryYearBE = latestRow?.entryYearBE ?? null;
  if (latestEntryYearBE === null) {
    return {
      scope: 'university',
      kkuAggregate: aggregateRows([]),
      peers: [],
      latestEntryYearBE: null,
    };
  }
  const allRows = await prisma.tcasAdmissionStat.findMany({
    where: { entryYearBE: latestEntryYearBE, ...realDataWhere() },
    select: {
      institutionName: true,
      quota: true,
      applicants: true,
      admittedPass1: true,
      admittedPass2: true,
      minScorePass1: true,
    },
  });
  const kkuRows = allRows.filter((r) => r.institutionName === ownNameTh);
  const peerByInst = new Map<string, typeof allRows>();
  for (const r of allRows) {
    if (r.institutionName === ownNameTh) continue;
    const arr = peerByInst.get(r.institutionName) ?? [];
    arr.push(r);
    peerByInst.set(r.institutionName, arr);
  }
  const peers = [...peerByInst.entries()]
    .map(([institutionName, rows]) => ({
      institutionName,
      ...aggregateRows(rows),
    }))
    .sort((a, b) => b.totalApplicants - a.totalApplicants);
  return {
    scope: 'university',
    kkuAggregate: aggregateRows(kkuRows),
    peers,
    latestEntryYearBE,
  };
}

// ── Demographic outlook (v2 — national + recruitment-funnel-aware) ──────
// Project the future youth cohort AND the program's recruitment funnel
// forward, and answer the question Council cares about: "as the youth
// cohort shrinks, can this program still fill its admission plan?"
//
// v2 changes (was: Northeast catchment, intake-share only):
//   - The projection is NATIONAL (region='TH'). The Northeast catchment
//     cohort is kept per-row as a comparator.
//   - It joins the TCAS recruitment funnel (Plan → Applicants → Reported
//     in). Applicants are scaled forward by the national cohort decline;
//     reported-in via the observed applicant→reported conversion. Each
//     horizon then shows whether projected reported-in still meets the
//     plan, and `planShortfallYear` flags the first year it does not.
export type DemographicRiskLevel = 'low' | 'medium' | 'high' | 'unknown';

export interface ProgramDemographicOutlook {
  /** Region the projection is anchored to. Always 'TH' today (v2 is
   *  national-primary); typed as a string so a regional primary can follow
   *  without another API change. */
  catchmentRegion: string;
  /** The institution's own projection region (organisation profile
   *  `regionEn`, resolved against the regions the data carries). Null when it
   *  resolves to the national series - there is then no separate comparator
   *  and `cohortPopulationRegional` is null on every row. */
  comparatorRegion: string | null;
  source: string;
  /** The cohort the projection is anchored to — '18-22' for bachelor
   *  programmes, '23-29' for graduate programmes. */
  ageCohort: '18-22' | '23-29';
  /** Today's Year-1 intake (latest year, dropping the in-progress
   *  partial year if applicable). Null when no enrollment data. */
  baselineYearOneIntake: number | null;
  /** Recruitment-funnel baseline — the most recent TCAS entry year with
   *  a usable Plan → Applicants → Reported-in funnel. Null when the
   *  program has no TcasAdmissionFunnel data. */
  funnelBaseline: {
    entryYearBE: number;
    /** แผนรับ — the registrar's annual seat target. */
    plan: number;
    /** จำนวนผู้สมัคร — total applicants. */
    applicants: number;
    /** จำนวนรายงานตัว — actually reported in / enrolled. */
    reportedIn: number;
    /** reportedIn / applicants — historical TCAS yield (funnel context;
     *  does NOT drive the risk projection). */
    reportedRate: number;
    /** applicants / plan — applicants per seat at the baseline year. */
    competitionRatio: number;
  } | null;
  /** Cohort projection at +0 / +5 / +10 / +15 years from now. */
  projections: Array<{
    year: number;
    /** NATIONAL 18-22 (or 23-29) cohort population. */
    cohortPopulation: number;
    /** The institution's regional cohort (`comparatorRegion`) — a comparator. */
    cohortPopulationRegional: number | null;
    /** Share of the NATIONAL cohort needed to maintain today's intake.
     *  Null when intake is unknown. */
    requiredShareOfCohort: number | null;
    /** % decline of the national cohort vs the year=now anchor. */
    cohortDeclinePct: number;
    /** Applicants projected forward, scaled by the national cohort
     *  decline. Null when the program has no recruitment-funnel baseline. */
    projectedApplicants: number | null;
    /** projectedApplicants / plan — applicants per seat. The risk
     *  signal: a program with a healthy applicant pool can fill its
     *  plan even as the cohort shrinks; below ~1.5 applicants per seat
     *  it is super-critical. */
    competitionRatio: number | null;
    /** True when competitionRatio < 1.5 — too few applicants to fill
     *  the plan with any selectivity margin. */
    superCritical: boolean | null;
  }>;
  /** Cohort decline from now → +15y, expressed as a percentage. */
  fifteenYearContraction: number;
  /** First horizon year at which the applicant pool falls below 1.5×
   *  the plan (super-critical). Null when it stays healthy through
   *  +15y, or when there is no funnel baseline. */
  superCriticalYear: number | null;
  /** Risk verdict. With funnel data it is driven by when the applicant
   *  pool turns super-critical (< 1.5 applicants/seat); without it, by
   *  the +10y national required share. */
  riskLevel: DemographicRiskLevel;
}

const COHORT_FOR_LEVEL: Record<string, '18-22' | '23-29'> = {
  BACHELOR: '18-22',
  HIGHER_GRAD_DIPLOMA: '23-29',
  MASTER: '23-29',
  DOCTORAL: '23-29',
};

// Applicants-per-seat floor. Below this the program no longer has a
// substantial enough applicant pool to fill its plan with any
// selectivity margin — "super-critical".
const SUPER_CRITICAL_RATIO = 1.5;

interface FunnelBaseline {
  entryYearBE: number;
  plan: number;
  applicants: number;
  reportedIn: number;
  reportedRate: number;
  competitionRatio: number;
}

// Most recent COMPLETE TCAS entry year with a usable Plan / Applicants /
// Reported funnel. `maxEntryYearBE` excludes the in-progress admission
// cycle — its `reportedIn` is still partial and would yield a junk
// conversion rate. The plan repeats across a year's rounds (MAX collapses
// it); applicants + reported-in sum across rounds.
function buildFunnelBaseline(
  rows: Array<{
    entryYearBE: number;
    planPerYear: number | null;
    totalApplicants: number | null;
    regReported: number | null;
  }>,
  maxEntryYearBE: number,
): FunnelBaseline | null {
  const byYear = new Map<number, { plan: number; applicants: number; reportedIn: number }>();
  for (const r of rows) {
    if (r.entryYearBE > maxEntryYearBE) continue;
    const cur = byYear.get(r.entryYearBE) ?? { plan: 0, applicants: 0, reportedIn: 0 };
    cur.plan = Math.max(cur.plan, r.planPerYear ?? 0);
    cur.applicants += r.totalApplicants ?? 0;
    cur.reportedIn += r.regReported ?? 0;
    byYear.set(r.entryYearBE, cur);
  }
  for (const year of [...byYear.keys()].sort((a, b) => b - a)) {
    const v = byYear.get(year)!;
    if (v.plan > 0 && v.applicants > 0 && v.reportedIn > 0) {
      return {
        entryYearBE: year,
        plan: v.plan,
        applicants: v.applicants,
        reportedIn: v.reportedIn,
        reportedRate: v.reportedIn / v.applicants,
        competitionRatio: v.applicants / v.plan,
      };
    }
  }
  return null;
}

export async function programDemographicOutlook(
  programId: string,
  now: Date = new Date(),
): Promise<ProgramDemographicOutlook | null> {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { level: true },
  });
  if (!program) return null;

  // Warm the academic-year cache so the sync accessor below honours any
  // operator-set DB date for this request.
  await getAcademicYearContext(now);

  const ageCohort = COHORT_FOR_LEVEL[program.level] ?? '18-22';

  // Latest non-partial Year-1 intake. Use the most recent enrollment-
  // metric row whose `enrolled` value is at least 30% of the prior
  // year's (drops in-progress partial years — same heuristic as the
  // financials module).
  const enrollments = await prisma.enrollmentMetric.findMany({
    where: { programId, ...realDataWhere() },
    orderBy: { academicYear: 'desc' },
    take: 5,
    select: { academicYear: true, enrolled: true },
  });
  let baselineYearOneIntake: number | null = null;
  if (enrollments.length === 1) {
    baselineYearOneIntake = enrollments[0]!.enrolled || null;
  } else if (enrollments.length >= 2) {
    const [latest, prior] = [enrollments[0]!, enrollments[1]!];
    const isPartial =
      prior.enrolled > 0 && latest.enrolled < prior.enrolled * 0.3;
    baselineYearOneIntake = isPartial ? prior.enrolled : latest.enrolled;
  }

  // Recruitment-funnel baseline — Plan → Applicants → Reported in.
  // Sourced from ADMISSION_STAT via the adapter (per-year totals).
  const funnelRows = await programFunnelYears(programId);
  // Latest COMPLETE entry year (drops the in-progress admission cycle).
  const funnelBaseline = buildFunnelBaseline(
    funnelRows,
    academicYearContextSync(now).latestCompleteEntryYearBE,
  );

  // Demographic projection rows. Pin to the canonical NESDC-mid-
  // variant source (`NESDC-PopProj-2010-2040`) — the older synthetic
  // `NESDC-v1` rows from the original seed remain for gap-analysis
  // back-compat but must not double-up here.
  const CANONICAL_SOURCE = 'NESDC-PopProj-2010-2040';
  const allRows = await prisma.demographicProjection.findMany({
    where: { ageCohort, source: CANONICAL_SOURCE },
    orderBy: { year: 'asc' },
  });
  if (allRows.length === 0) return null;

  const resolvedRegion = projectionRegionForInstitution([...new Set(allRows.map((r) => r.region))]);
  const comparatorRegion = resolvedRegion === NATIONAL_REGION ? null : resolvedRegion;

  const nowCE = now.getUTCFullYear();
  const horizons = [0, 5, 10, 15];
  const projections: ProgramDemographicOutlook['projections'] = [];
  let anchorNational: number | null = null;
  for (const h of horizons) {
    const targetYear = nowCE + h;
    const nationalRow = allRows.find(
      (r) => r.region === NATIONAL_REGION && r.year === targetYear,
    );
    const regionalRow = comparatorRegion
      ? allRows.find((r) => r.region === comparatorRegion && r.year === targetYear)
      : undefined;
    if (!nationalRow) continue;
    if (anchorNational === null) anchorNational = nationalRow.population;
    const requiredShare =
      baselineYearOneIntake && nationalRow.population > 0
        ? baselineYearOneIntake / nationalRow.population
        : null;
    const declinePct =
      anchorNational && anchorNational > 0
        ? ((anchorNational - nationalRow.population) / anchorNational) * 100
        : 0;
    // Funnel projection — applicants scale with the national cohort.
    const cohortFactor =
      anchorNational && anchorNational > 0 ? nationalRow.population / anchorNational : 1;
    let projectedApplicants: number | null = null;
    let competitionRatio: number | null = null;
    let superCritical: boolean | null = null;
    if (funnelBaseline && funnelBaseline.plan > 0) {
      // Applicants shrink in proportion to the national cohort; the risk
      // is whether enough applicants remain per seat (NOT whether
      // reported-in — TCAS yield — covers the plan, since an over-
      // subscribed program admits more to absorb no-shows).
      projectedApplicants = Math.round(funnelBaseline.applicants * cohortFactor);
      competitionRatio = projectedApplicants / funnelBaseline.plan;
      superCritical = competitionRatio < SUPER_CRITICAL_RATIO;
    }
    projections.push({
      year: targetYear,
      cohortPopulation: nationalRow.population,
      cohortPopulationRegional: regionalRow?.population ?? null,
      requiredShareOfCohort: requiredShare,
      cohortDeclinePct: declinePct,
      projectedApplicants,
      competitionRatio,
      superCritical,
    });
  }
  if (projections.length === 0) return null;
  const tenYear = projections.find((p) => p.year === nowCE + 10);
  const fifteenYear = projections.find((p) => p.year === nowCE + 15);
  const fifteenYearContraction = fifteenYear?.cohortDeclinePct ?? 0;
  const superCriticalYear =
    projections.find((p) => p.superCritical === true)?.year ?? null;

  // Risk verdict. With funnel data: driven by when the applicant pool
  // turns super-critical (< 1.5 applicants/seat) — a program with a
  // substantial applicant pool can still fill its plan as the cohort
  // shrinks. Without funnel data: the +10y national required share,
  // thresholds rescaled ~1/3 from the v1 Northeast figures since the
  // national cohort is ~3× the NE cohort.
  let riskLevel: DemographicRiskLevel = 'unknown';
  if (funnelBaseline) {
    const nowRow = projections.find((p) => p.year === nowCE);
    if (nowRow?.superCritical === true) riskLevel = 'high';
    else if (superCriticalYear !== null && superCriticalYear <= nowCE + 10) riskLevel = 'high';
    else if (superCriticalYear !== null) riskLevel = 'medium';
    else riskLevel = 'low';
  } else if (tenYear && tenYear.requiredShareOfCohort !== null) {
    const sharePct = tenYear.requiredShareOfCohort * 100;
    if (sharePct < 0.017) riskLevel = 'low';
    else if (sharePct < 0.067) riskLevel = 'medium';
    else riskLevel = 'high';
  }

  return {
    catchmentRegion: NATIONAL_REGION,
    comparatorRegion,
    source: allRows[0]!.source,
    ageCohort,
    baselineYearOneIntake,
    funnelBaseline,
    projections,
    fifteenYearContraction,
    superCriticalYear,
    riskLevel,
  };
}

// ── Faculty salary by funding source (enrolment-weighted) ──────────────
// Surfaces, for the deep-dive financial section, where this program's
// teaching-staff salaries are funded from. NOT "all government" —
// reality (from the kku-hr-processed `staff_compensation_cube`) is that
// salaries split across เงินงบประมาณ (government allocation), เงินรายได้
// (university revenue), 50:50, special funds, etc.
//
// Multi-program faculty: a person who teaches multiple programs has
// their salary contribution to EACH program weighted by enrolment
// share — a lecturer who teaches a 200-student program AND a 20-student
// program contributes ~91% / ~9% to each respectively. Avoids the
// double-counting trap of summing the same person's full salary across
// every program they touch.
//
// Methodology stamp: 'salary-by-fund.v1'. Bump on behaviour change.
const SALARY_BY_FUND_VERSION = 'salary-by-fund.v1';

// Maps the FacultyMember.rank enum to the substring we expect to find
// in `staff_compensation_cube.level`. The cube stores Thai abbreviated
// forms ('ผศ', 'รศ', 'ศ', 'อ.') — we match by `startsWith` so variants
// like 'ผศ.ดร.' / 'ศ.เกียรติคุณ' still resolve to the same rank bucket.
const RANK_TO_LEVEL_PREFIXES: Record<
  'PROF' | 'ASSOC_PROF' | 'ASST_PROF' | 'LECTURER',
  string[]
> = {
  PROF: ['ศ.', 'ศ ', 'ศาสตราจารย์'],
  ASSOC_PROF: ['รศ', 'รองศาสตราจารย์'],
  ASST_PROF: ['ผศ', 'ผู้ช่วยศาสตราจารย์'],
  LECTURER: ['อ.', 'อ ', 'อาจารย์'],
};

function levelMatchesRank(
  level: string | null,
  rank: 'PROF' | 'ASSOC_PROF' | 'ASST_PROF' | 'LECTURER',
): boolean {
  if (!level) return false;
  const t = level.trim();
  return RANK_TO_LEVEL_PREFIXES[rank].some((p) => t.startsWith(p));
}

export interface SalaryByFundingEntry {
  /** Funding source as stored in the HR cube: 'เงินงบประมาณ' /
   *  'เงินรายได้' / '50:50' / etc. Normalised — blank / null becomes
   *  'เงินรายได้' to match the staff-dashboard convention. */
  salType: string;
  /** Enrolment-weighted annual salary contribution to THIS program
   *  funded from this source (THB / year). */
  annualThb: number;
  /** Share of the program's total weighted salary cost. 0–1. */
  share: number;
}

export interface ProgramSalaryByFunding {
  methodologyVersion: string;
  /** Sum of `annualThb` across all entries. */
  totalAnnualThb: number;
  /** How many ProgramFaculty members contributed (after enrolment
   *  weighting). Useful for sanity-checking — should match the
   *  deep-dive's "active teaching staff" count. */
  contributingMembers: number;
  /** Members from ProgramFaculty whose cube row couldn't be resolved
   *  (no matching faculty × rank cell). Surfaced as a caveat. */
  unresolvedMembers: number;
  /** Latest fiscal year the cube row was sourced from (BE). */
  sourceFiscalYear: number | null;
  /** Breakdown by funding source, sorted by share desc. */
  entries: SalaryByFundingEntry[];
}

export async function programFacultySalaryByFunding(
  programId: string,
): Promise<ProgramSalaryByFunding | null> {
  // 1. Find ProgramFaculty members on THIS program.
  const onThisProgram = await prisma.programFaculty.findMany({
    where: { programId },
    select: {
      facultyMember: {
        select: {
          id: true,
          rank: true,
          facultyId: true,
        },
      },
    },
  });
  if (onThisProgram.length === 0) return null;

  const memberIds = onThisProgram
    .map((p) => p.facultyMember?.id)
    .filter((x): x is string => Boolean(x));
  if (memberIds.length === 0) return null;

  // 2. Pull every program assignment for those members (across the
  //    whole institution) and the latest enrolment per program.
  const allAssignments = await prisma.programFaculty.findMany({
    where: { facultyMemberId: { in: memberIds } },
    select: { facultyMemberId: true, programId: true },
  });
  const programIds = [
    ...new Set(allAssignments.map((a) => a.programId)),
  ];
  const enrolments = await prisma.enrollmentMetric.findMany({
    where: { programId: { in: programIds } },
    orderBy: { academicYear: 'desc' },
    select: { programId: true, enrolled: true, academicYear: true },
  });
  const enrolByProgram = new Map<string, number>();
  for (const e of enrolments) {
    if (!enrolByProgram.has(e.programId)) {
      enrolByProgram.set(e.programId, e.enrolled);
    }
  }

  // 3. For each member, weight = enrolment(thisProgram) / sum across
  //    all their programs. When all are 0, fall back to even split.
  const memberWeight = new Map<string, number>();
  for (const id of memberIds) {
    const myPrograms = allAssignments
      .filter((a) => a.facultyMemberId === id)
      .map((a) => a.programId);
    const totals = myPrograms.map((p) => enrolByProgram.get(p) ?? 0);
    const total = totals.reduce((s, v) => s + v, 0);
    const here = enrolByProgram.get(programId) ?? 0;
    const weight = total > 0 ? here / total : 1 / myPrograms.length;
    memberWeight.set(id, weight);
  }

  // 4. Load every cube row keyed by the faculties + ranks we need.
  const facIds = [
    ...new Set(
      onThisProgram
        .map((p) => p.facultyMember?.facultyId)
        .filter((x): x is string => Boolean(x)),
    ),
  ];
  if (facIds.length === 0) return null;
  const cube = await prisma.staffCompensationCube.findMany({
    where: { facultyId: { in: facIds }, isAcademic: true },
    orderBy: { fiscalYear: 'desc' },
  });
  // Latest fiscal year only — we report a single-year snapshot.
  const latestFy = cube.length > 0 ? cube[0]!.fiscalYear : null;
  const latestCube = latestFy === null ? [] : cube.filter((r) => r.fiscalYear === latestFy);

  // 5. Walk each member and tally per-salType contribution.
  const perSalType = new Map<string, number>();
  let contributingMembers = 0;
  let unresolvedMembers = 0;
  for (const p of onThisProgram) {
    const m = p.facultyMember;
    if (!m) continue;
    const rows = latestCube.filter(
      (r) =>
        r.facultyId === m.facultyId &&
        levelMatchesRank(r.level, m.rank as keyof typeof RANK_TO_LEVEL_PREFIXES),
    );
    if (rows.length === 0) {
      unresolvedMembers += 1;
      continue;
    }
    contributingMembers += 1;
    const weight = memberWeight.get(m.id) ?? 1;
    // Build a salType → share table for this faculty × rank, using
    // headcount as the proportional weight (more headcount on a given
    // salType means more of the rank's salary mass comes from there).
    const rankHeadcount = rows.reduce((s, r) => s + r.headcount, 0);
    if (rankHeadcount === 0) continue;
    // Cube `meanSalary` is monthly (THB / month); HR runs payroll monthly.
    // Annualise by × 12.
    const memberAnnualByType = new Map<string, number>();
    for (const r of rows) {
      const salType = (r.salType ?? '').trim() || 'เงินรายได้';
      const proportion = r.headcount / rankHeadcount;
      const memberAnnual = r.meanSalary * 12 * proportion * weight;
      memberAnnualByType.set(
        salType,
        (memberAnnualByType.get(salType) ?? 0) + memberAnnual,
      );
    }
    for (const [salType, thb] of memberAnnualByType) {
      perSalType.set(salType, (perSalType.get(salType) ?? 0) + thb);
    }
  }

  const total = [...perSalType.values()].reduce((s, v) => s + v, 0);
  if (total === 0) return null;
  const entries: SalaryByFundingEntry[] = [...perSalType.entries()]
    .map(([salType, annualThb]) => ({
      salType,
      annualThb,
      share: annualThb / total,
    }))
    .sort((a, b) => b.share - a.share);

  return {
    methodologyVersion: SALARY_BY_FUND_VERSION,
    totalAnnualThb: total,
    contributingMembers,
    unresolvedMembers,
    sourceFiscalYear: latestFy,
    entries,
  };
}

// ── Financial waterfall ────────────────────────────────────────────────
// Current year snapshot + 5-year trend. The detailed allocation split
// (tuition → direct → faculty alloc → facilities alloc → overhead →
// net) needs the cost-methodology breakout which prompt 14's real
// Finance connector populates. For v1 we show the three totals we
// actually have.
export async function programFinancials(programId: string) {
  // Per-program raw financial rows (not the materialized rollup) — gives
  // the deep-dive direct access to the new per-program-link.v1 fields:
  // tuitionRevenue (program income), allocatedFacultyCost (government-
  // funded salary subsidy, NOT netted from tuition), netContribution
  // (revenue − direct costs only).
  const rawRows = await prisma.financialMetric.findMany({
    where: { programId, ...realDataWhere() },
    orderBy: { fiscalYear: 'asc' },
  });

  // Pick the latest COMPLETE academic year — i.e., skip the year still
  // being billed (an academic year's tuition straddles two fiscal years;
  // the in-progress year has only semester 1 collected). See
  // packages/db/src/financial-year.ts for the full reasoning and why a
  // ratio test alone can't tell "in progress" apart from a genuine
  // decline. For SEQ-0062 in 2026-05, FY 2026 showed 220K (11 students
  // enrolled so far) vs FY 2025's 11.6M (full year) — the in-progress
  // year is excluded, not scored.
  const academicYearCtx = await getAcademicYearContext();
  const currentAcademicYearCE = academicYearCtx.currentAcademicYearBE - 543;
  const pick = pickFinancialYear(rawRows, currentAcademicYearCE, (r) => Number(r.tuitionRevenue));
  const latest = pick.row ?? undefined;
  const displayedYearIsPartial = pick.excludedInProgressYear !== null;
  // The in-progress row itself — surfaced to the UI as clearly-labelled
  // informational data (never used in the score, the waterfall, or the
  // sensitivity figures above) so a reader can see "here's what's been
  // billed so far" without it being read as a complete-year number.
  const partialRow =
    pick.excludedInProgressYear !== null
      ? rawRows.find((r) => r.fiscalYear === pick.excludedInProgressYear)
      : undefined;
  const trend = rawRows.slice(-5).map((r) => ({
    year: r.fiscalYear,
    tuitionRevenue: Number(r.tuitionRevenue),
    facultyCostSubsidy: Number(r.allocatedFacultyCost),
    netContribution: Number(r.netContribution),
  }));

  // Waterfall — Tuition revenue → Direct cost → Net contribution.
  // Faculty salary is shown as a SEPARATE (non-netting) info line via
  // the `governmentSubsidy` field below — Thai public university model:
  // salaries are paid by the central government's block grant to KKU,
  // not from program-level tuition revenue.
  const waterfall = latest
    ? [
        { label: 'Tuition revenue', value: Number(latest.tuitionRevenue), kind: 'positive' as const },
        { label: 'Direct program cost', value: -Number(latest.directCost), kind: 'negative' as const },
        { label: 'Net contribution (from tuition)', value: Number(latest.netContribution), kind: 'total' as const },
      ]
    : [];

  // Sensitivity: what happens if tuition rose 5%?
  const sensitivity = latest
    ? {
        tuitionPlus5Pct: {
          tuitionRevenue: Number(latest.tuitionRevenue) * 1.05,
          netContribution:
            Number(latest.tuitionRevenue) * 1.05 - Number(latest.directCost),
        },
      }
    : null;

  // Salary breakdown by funding source — multi-program faculty are
  // weighted by enrolment share. Returns null when this program has no
  // ProgramFaculty links or no cube data is available; the deep-dive UI
  // falls back to the older "government subsidy" line in that case.
  const salaryByFunding = await programFacultySalaryByFunding(programId);

  return {
    waterfall,
    trend,
    /// The FY (CE) the headline numbers are sourced from.
    latestFiscalYear: latest?.fiscalYear ?? null,
    /// True when the connector has a row for a more recent academic year
    /// that is still being billed (excluded from scoring by
    /// pickFinancialYear). UI surfaces a small note that a partial year
    /// exists alongside the complete year the figures are drawn from.
    partialCurrentYearAvailable: displayedYearIsPartial,
    /// The academic year (CE) currently being billed, when one exists in
    /// the data. Null when there is none. Excluded from scoring — see
    /// `partialCurrentYearAvailable` above and financial-year.ts.
    partialFiscalYear: pick.excludedInProgressYear,
    /// That in-progress year's tuition collected SO FAR — informational
    /// only. Never enters the score, the waterfall, or the sensitivity
    /// figures above; it is roughly one semester of a full year's tuition
    /// by construction (see financial-year.ts), not a "this program
    /// declined" signal.
    partialTuitionRevenueSoFar: partialRow ? Number(partialRow.tuitionRevenue) : null,
    /// Annual salary subsidy the government pays for this program's
    /// faculty — sourced from `EmployeeDetail.SALARY × 12` for the staff
    /// in `ProgramFaculty`. Informational only; NOT netted from tuition.
    /// SUPERSEDED by `salaryByFunding` when available; kept for back-
    /// compat with surfaces that haven't migrated yet.
    governmentFacultySubsidy: latest ? Number(latest.allocatedFacultyCost) : null,
    /// Government investment per enrolled student per year.
    // `!= null` deliberately, not a truthy check: a genuine cost of 0 is a
    // measured value and must survive as 0. A truthy test turned it into
    // null, which every downstream surface renders as "no data".
    costPerStudent:
      latest?.costPerStudent != null ? Number(latest.costPerStudent) : null,
    /// Enrolment-weighted, faculty-rank-aware breakdown of salary cost
    /// by funding source (เงินงบประมาณ / เงินรายได้ / 50:50 / etc.).
    /// Sourced from staff_compensation_cube via salary-by-fund.v1.
    salaryByFunding,
    sensitivity,
    costMethodologyVersion: latest?.methodologyVersion ?? 'pending',
    latestFreshness: latest?.freshnessDate ?? null,
  };
}

// ── Skills coverage ────────────────────────────────────────────────────
// Top 20 skills the program teaches vs. top 20 demanded by the labor
// market (derived from job postings linked to ProgramSkill via skill
// overlap). Match score = cosine-ish intersection over union.
export async function programSkills(programId: string) {
  // Reads from ProgramSkill (populated by program-skills-detailed.v2):
  //   - compulsoryWeight = aggregate signal from compulsory courses + PLOs
  //   - electiveWeight   = aggregate signal from elective courses (minor)
  //   - pickedFromPlo    = explicitly mentioned in a Program Learning Outcome
  //   - evidenceQuote    = verbatim PLO/course quote justifying the mapping
  // If no rows exist yet, the UI renders an empty state pointing to
  // `pnpm programs:extract-skills <code>`.
  const taught = await prisma.programSkill.findMany({
    where: { programId },
    include: { skill: true },
    orderBy: [
      // PLO-tagged first; then by compulsoryWeight desc; then composite weight.
      { pickedFromPlo: 'desc' },
      { compulsoryWeight: 'desc' },
      { weight: 'desc' },
    ],
    take: 60,
  });

  // Demand source: LinkedIn labour-market data (subscribed by MHESI;
  // hosted at KMITL), filtered to careers the PROGRAM actually targets.
  //
  // Filter chain:
  //   (1) If Program.kmitlCareerIds is set → restrict demand rows to
  //       KmitlCareer rows whose kmitlCareerId is in that set. This is
  //       the right scope: SEQ-0062 (Mech Eng) shows Mechanical Engineer
  //       / Mechanical Design Engineer / Mechanical Project Engineer
  //       demand, not generic top-10 across all 401 careers.
  //   (2) If kmitlCareerIds is empty → fall back to ALL careers
  //       (legacy behaviour) so programs without a career mapping still
  //       see SOMETHING, with a banner in the UI noting it's unfiltered.
  //
  // Run `pnpm programs:map-careers <code>` to populate kmitlCareerIds.
  const programForCareers = await prisma.program.findUnique({
    where: { id: programId },
    select: { kmitlCareerIds: true },
  });
  const targetKmitlIds = programForCareers?.kmitlCareerIds ?? [];
  const careerFilter =
    targetKmitlIds.length > 0
      ? { career: { kmitlCareerId: { in: targetKmitlIds } } }
      : {};

  // Demand fallback chain. Engineering / specialty careers often have no
  // THAILAND × JOB_POSTINGS rows (Thai job-posting sample is thin and
  // skewed toward digital/service careers). Fall back to GLOBAL data so
  // the surface always shows something relevant. The label tells the
  // analyst which scope hit so they can read with appropriate caveat.
  const demandFallbackChain: Array<{
    label: string;
    scope: 'THAILAND' | 'GLOBAL';
    source: 'JOB_POSTINGS' | 'PROFILES';
    minPct: number;
  }> = [
    { label: 'thailand-job-postings', scope: 'THAILAND', source: 'JOB_POSTINGS', minPct: 5 },
    { label: 'thailand-profiles',     scope: 'THAILAND', source: 'PROFILES',     minPct: 5 },
    { label: 'global-job-postings',   scope: 'GLOBAL',   source: 'JOB_POSTINGS', minPct: 0 },
    { label: 'global-profiles',       scope: 'GLOBAL',   source: 'PROFILES',     minPct: 0 },
  ];

  type DemandRow = {
    skillId: string | null;
    _max: { percentage: number | null };
    _count: { skillId: number };
  };
  let demandRows: DemandRow[] = [];
  let usedDemandLabel = 'none';

  for (const tier of demandFallbackChain) {
    const rows = await prisma.kmitlCareerSkillDemand.groupBy({
      by: ['skillId'],
      where: {
        dataScope: tier.scope,
        dataSource: tier.source,
        percentage: { gte: tier.minPct },
        skillId: { not: null },
        ...careerFilter,
        ...realDataWhere(),
      },
      _max: { percentage: true },
      _count: { skillId: true },
      orderBy: { _max: { percentage: 'desc' } },
      take: 30,
    });
    if (rows.length > 0) {
      demandRows = rows;
      usedDemandLabel = tier.label;
      break;
    }
  }
  const demandIds = demandRows.map((d) => d.skillId).filter((id): id is string => Boolean(id));
  const demandSkills = await prisma.skill.findMany({
    where: { id: { in: demandIds } },
    select: { id: true, nameEn: true, nameTh: true, category: true },
  });
  const demandById = new Map(demandSkills.map((s) => [s.id, s]));

  const taughtIds = new Set(taught.map((t) => t.skillId));
  const demandSet = new Set(demandIds);

  // Read AI-computed demand-match decisions (demand-driven curriculum
  // search). Falls back to taxonomy-only intersection when no AI matches
  // exist yet — UI banner prompts to run `pnpm programs:match-demand`.
  const demandMatches = await prisma.programDemandMatch.findMany({
    where: { programId, skillId: { in: demandIds.length > 0 ? demandIds : ['__none__'] }, ...realDataWhere() },
  });
  const matchById = new Map(demandMatches.map((m) => [m.skillId, m]));

  // Match score: prefer AI decisions; denominator is RELEVANT demanded
  // skills only — irrelevant demands (e.g., "Civil engineering" surfacing
  // for a Mech Eng program because it shares "Engineer" group label) are
  // excluded so the score reflects how well the curriculum covers the
  // skills its graduates would actually need.
  let matchScore: number;
  if (demandMatches.length > 0) {
    const relevantSet = demandMatches.filter((m) => m.relevant);
    const matched = relevantSet.filter((m) => m.matched).length;
    matchScore = relevantSet.length === 0 ? 0 : (matched / relevantSet.length) * 100;
  } else {
    const intersection = [...demandSet].filter((id) => taughtIds.has(id));
    const union = new Set([...taughtIds, ...demandSet]);
    matchScore = union.size === 0 ? 0 : (intersection.length / union.size) * 100;
  }

  // Split taught skills into major vs minor contribution buckets so
  // the UI can show "MAJOR (compulsory + PLO)" separately from
  // "MINOR (elective only)".
  const majorContributors = taught.filter(
    (t) => t.pickedFromPlo || (t.compulsoryWeight ?? t.weight) >= 0.5,
  );
  const minorContributors = taught.filter(
    (t) => !t.pickedFromPlo && (t.compulsoryWeight ?? t.weight) < 0.5,
  );

  // ── JobThai (domestic) demand — v5.2 ─────────────────────────────────
  // Read through programJobThaiSkillCoverage, the same loader the
  // jobthai_demand_alignment health driver uses, so the gap list on this page
  // and the score beside it cannot disagree. Never blended with the LinkedIn
  // lists above: LinkedIn is % of profiles/postings per career, JobThai is %
  // of the postings behind this programme's field-of-study links.
  const jt = await programJobThaiSkillCoverage(programId);
  const jtSkillIds = jt.demand.demand.map((d) => d.skillId);
  const jtSkills = jtSkillIds.length === 0
    ? []
    : await prisma.skill.findMany({ where: { id: { in: jtSkillIds } }, select: { id: true, nameEn: true, nameTh: true, category: true } });
  const jtSkillById = new Map(jtSkills.map((sk) => [sk.id, sk]));
  const jtDemandSet = new Set(jtSkillIds);
  const jtMatchedTaught = new Set(
    [...jt.matches.values()].filter((m) => m.matched && m.matchedTaughtSkillId).map((m) => m.matchedTaughtSkillId as string),
  );
  const jtRelevant = [...jt.matches.values()].filter((m) => m.relevant);
  const jtAiComputed = jt.matches.size > 0;
  const jtSpecific = jt.demand.demand.filter((d) => !d.generic);
  const jobThai = {
    /** 'ok' | 'no-links' | 'below-floor' — the last two are data gaps, not zero demand. */
    status: jt.demand.status,
    postings: jt.demand.postings,
    occupationCount: jt.demand.occupations,
    /** The jobs this programme's field feeds, most postings first. */
    occupations: jt.demand.linkedOccupations.slice(0, 8).map((o) => ({
      category: o.category,
      subcategory: o.subcategory,
      postingCount: o.postingCount,
      /** Share of that occupation's eligible postings asking for this field. */
      linkScore: o.score,
    })),
    /** True once the AI curriculum check has run against JobThai demand. */
    aiComputed: jtAiComputed,
    /** Same figure as the jobthai_demand_alignment driver; null before the AI check. */
    matchScore: jtRelevant.length < JOBTHAI_MIN_RELEVANT_SKILLS ? null : (jtRelevant.filter((m) => m.matched).length / jtRelevant.length) * 100,
    minRelevantSkills: JOBTHAI_MIN_RELEVANT_SKILLS,
    /** How many relevant demanded skills the score rests on — shown beside it. */
    relevantCount: jtRelevant.length,
    // A skill judged another profession (demand-match.v4) is a degree employers
    // accept INSTEAD — job adverts list several — not something this
    // programme's graduates are hired to do. Shown on its own line.
    alsoAccepted: jtSpecific
      .filter((d) => jt.matches.get(d.skillId)?.fit === 'other-profession')
      .map((d) => ({
        skillId: d.skillId,
        nameEn: jtSkillById.get(d.skillId)?.nameEn ?? d.skillId,
        nameTh: jtSkillById.get(d.skillId)?.nameTh ?? '',
        fitReason: jt.matches.get(d.skillId)?.fitReason ?? null,
      })),
    demanded: jtSpecific.filter((d) => jt.matches.get(d.skillId)?.fit !== 'other-profession').slice(0, 20).map((d) => {
      const sk = jtSkillById.get(d.skillId);
      const m = jt.matches.get(d.skillId);
      return {
        skillId: d.skillId,
        nameEn: sk?.nameEn ?? d.skillId,
        nameTh: sk?.nameTh ?? '',
        category: sk?.category ?? null,
        /** % of the linked postings that name this skill. */
        demandPct: d.share * 100,
        occupationCount: d.occupations,
        curriculumMatched: m ? m.matched : null,
        relevant: m ? m.relevant : null,
        fit: m?.fit ?? null,
        fitReason: m?.fitReason ?? null,
        matchSource: m?.matchSource ?? null,
        evidenceQuote: m?.evidenceQuote ?? null,
      };
    }),
    /** Demanded by most occupations, so shown for context but kept out of gaps and the score. */
    generic: jt.demand.demand.filter((d) => d.generic).slice(0, 8).map((d) => ({
      skillId: d.skillId,
      nameEn: jtSkillById.get(d.skillId)?.nameEn ?? d.skillId,
      nameTh: jtSkillById.get(d.skillId)?.nameTh ?? '',
      demandPct: d.share * 100,
    })),
    // Gaps follow the LinkedIn rule: with an AI decision, matched=false AND
    // relevant=true; without one, a taxonomy fallback flagged as such.
    gaps: jtSpecific
      .filter((d) => {
        const m = jt.matches.get(d.skillId);
        return m ? !m.matched && m.relevant : !taughtIds.has(d.skillId);
      })
      .slice(0, 12)
      .map((d) => ({
        skillId: d.skillId,
        nameEn: jtSkillById.get(d.skillId)?.nameEn ?? d.skillId,
        nameTh: jtSkillById.get(d.skillId)?.nameTh ?? '',
        demandPct: d.share * 100,
        occupationCount: d.occupations,
        fit: jt.matches.get(d.skillId)?.fit ?? null,
        fitReason: jt.matches.get(d.skillId)?.fitReason ?? null,
      })),
    // Taught, not named by the linked postings and not the taught skill the AI
    // matched a demanded one to (a curriculum's "Legal Drafting" answering the
    // postings' "Litigation" is not surplus).
    surplus: taught
      .filter((t) => !jtDemandSet.has(t.skillId) && !jtMatchedTaught.has(t.skillId))
      .slice(0, 12)
      .map((t) => ({
        skillId: t.skillId,
        nameEn: t.skill.nameEn,
        nameTh: t.skill.nameTh,
        pickedFromPlo: t.pickedFromPlo,
      })),
  };

  return {
    taught: taught.map((ps) => ({
      skillId: ps.skillId,
      nameEn: ps.skill.nameEn,
      nameTh: ps.skill.nameTh,
      category: ps.skill.category,
      weight: ps.weight,
      compulsoryWeight: ps.compulsoryWeight,
      electiveWeight: ps.electiveWeight,
      pickedFromPlo: ps.pickedFromPlo,
      evidenceQuote: ps.evidenceQuote,
    })),
    majorContributorCount: majorContributors.length,
    minorContributorCount: minorContributors.length,
    ploSkillCount: taught.filter((t) => t.pickedFromPlo).length,
    demanded: demandRows
      .filter((d): d is typeof d & { skillId: string } => Boolean(d.skillId))
      .map((d) => {
        const s = demandById.get(d.skillId);
        const m = matchById.get(d.skillId);
        return {
          skillId: d.skillId,
          nameEn: s?.nameEn ?? d.skillId,
          nameTh: s?.nameTh ?? '',
          category: s?.category ?? null,
          /** Demand percentage from the LinkedIn-via-MHESI labour-market
           *  data — peak share across the program's target careers. */
          peakDemandPct: d._max.percentage ?? 0,
          /** Number of target careers where this skill exceeds threshold. */
          careerCount: d._count.skillId,
          /** AI-determined: does the curriculum teach this demanded skill? */
          curriculumMatched: m?.matched ?? null,
          /** Where the match was found: 'plo' | 'course' | 'extracted-skill' | 'unmatched'. */
          matchSource: m?.matchSource ?? null,
          /** 0..1 strength of the curriculum coverage. */
          relatedness: m?.relatedness ?? null,
          /** Verbatim PLO/course quote evidence. */
          evidenceQuote: m?.evidenceQuote ?? null,
          /** demand-match.v4 fit class + reason; null on v3 rows. */
          fit: m?.fit ?? null,
          fitReason: m?.fitReason ?? null,
        };
      }),
    // Demanded skills NOT taught BUT relevant to the program's discipline.
    // Filtered chain:
    //   - AI says matched=false AND relevant=true   → real gap (✗)
    //   - AI says matched=false AND relevant=false  → suppressed (irrelevant noise)
    //   - No AI decision yet → fall back to taxonomy-only intersection
    gaps: demandRows
      .filter((d): d is typeof d & { skillId: string } => {
        if (!d.skillId) return false;
        const m = matchById.get(d.skillId);
        if (m !== undefined) return !m.matched && m.relevant; // ← relevance gate
        return !taughtIds.has(d.skillId);                       // legacy fallback
      })
      .slice(0, 12)
      .map((d) => {
        const s = demandById.get(d.skillId);
        return {
          skillId: d.skillId,
          nameEn: s?.nameEn ?? d.skillId,
          nameTh: s?.nameTh ?? '',
          peakDemandPct: d._max.percentage ?? 0,
          careerCount: d._count.skillId,
        };
      }),
    // Skills taught but not demanded by the labour market — could be
    // foundational/academic OR a sign of curriculum drift.
    surplus: taught
      .filter((t) => !demandSet.has(t.skillId))
      .slice(0, 12)
      .map((t) => ({
        skillId: t.skillId,
        nameEn: t.skill.nameEn,
        nameTh: t.skill.nameTh,
        weight: t.weight,
        compulsoryWeight: t.compulsoryWeight,
        pickedFromPlo: t.pickedFromPlo,
      })),
    matchScore,
    // User-facing attribution: data is from LinkedIn profiles, subscribed
    // by MHESI. The KMITL Skill Mapping API is just the hosting endpoint
    // and must never appear in user-visible surfaces. See
    // memory/feedback_kmitl_data_attribution.md.
    demandSource: 'linkedin-via-mhesi',
    /** Which tier of the demand fallback chain produced these rows.
     *  'thailand-job-postings' is the preferred (Council-facing) signal;
     *  'global-*' tiers fire when Thai data is sparse — the UI labels
     *  the source so analysts read with appropriate caveat. */
    demandTier: usedDemandLabel,
    /** Number of KMITL careers the demand was filtered to. 0 means no
     *  career mapping exists yet — UI shows an "unfiltered" banner. */
    careerFilterCount: targetKmitlIds.length,
    /** The KMITL career IDs actually used for filtering (for UI labels). */
    careerFilterIds: targetKmitlIds,
    /** Domestic demand (JobThai). Rendered behind a source toggle, never blended. */
    jobThai,
    // Real "top 5 specific recommendations" text needs an AI call —
    // the narrative regen endpoint produces that; this method returns
    // the raw data the LLM needs.
  };
}

// ── Courses (v1.2.9 — program-courses-extract.v1) ─────────────────────
// Per-program course list + class-GPA aggregate per course. Joins
// program_courses (course-code list from the curriculum PDF) with
// class_offerings (registrar-reported grade distributions). Used by:
//   - /programs/[id]/courses endpoint (Curriculum & Faculty macro)
//   - AI Analyst `query_program_courses` tool
//   - PDF program-detail template's `courses` section
//
// Filter: returns only courses that have at least one graded section
// somewhere in class_offerings (classGpa ≠ null). Courses on the
// curriculum but never taught/never graded are excluded — the deep-dive
// + Council surfaces only the rows with a verifiable GPA aggregate.
// `total` is the count of returned rows; `extractedCount` is the
// unfiltered program_courses row count.
//
// Returns one row per course with both an all-year roll-up and a
// per-year `byYear` map (UI renders as year columns). The semesters
// filter narrows which terms count toward both aggregates — default
// is main terms 1+2.
export interface ProgramCoursesCell {
  classCount: number;
  gradedCount: number;
  averageClassGpa: number | null;
}

export async function programCourses(
  programId: string,
  opts: { semesters?: number[] } = {},
): Promise<{
  methodVersion: string;
  total: number;
  extractedCount: number;
  rows: Array<{
    courseCode: string;
    courseNameTh: string;
    courseNameEn: string;
    credits: number | null;
    classCount: number;
    gradedCount: number;
    classGpa: number;
    byYear: Record<string, ProgramCoursesCell>;
  }>;
  yearsObserved: number[];
  windowYearsBE: { start: number | null; end: number | null };
  semestersApplied: number[];
}> {
  const semesters =
    opts.semesters && opts.semesters.length > 0 ? [...opts.semesters].sort() : [1, 2];

  const courseRows = await prisma.programCourse.findMany({
    where: { programId },
    orderBy: { courseCode: 'asc' },
    select: {
      courseCode: true,
      courseNameTh: true,
      courseNameEn: true,
      credits: true,
      methodVersion: true,
    },
  });
  if (courseRows.length === 0) {
    return {
      methodVersion: 'none',
      total: 0,
      extractedCount: 0,
      rows: [],
      yearsObserved: [],
      windowYearsBE: { start: null, end: null },
      semestersApplied: semesters,
    };
  }
  const codes = courseRows.map((c) => c.courseCode);

  // Per-(course × year) aggregate. The UI rolls each course's year
  // cells into the overall row aggregate to keep numerator/denominator
  // exact under further combination.
  const aggs = await prisma.$queryRaw<
    Array<{
      course_code: string;
      acad_year_be: number;
      class_count: bigint;
      graded_count: bigint;
      weighted_numer: number | null;
      weighted_denom: number | null;
    }>
  >(Prisma.sql`
    SELECT co."course_code"   AS course_code,
           co."acad_year_be"  AS acad_year_be,
           COUNT(co."id")::bigint AS class_count,
           COALESCE(SUM(co."graded_count"), 0)::bigint AS graded_count,
           SUM(co."class_gpa" * co."graded_count" * COALESCE(co."credit_total", 1)) AS weighted_numer,
           SUM(co."graded_count" * COALESCE(co."credit_total", 1))::float AS weighted_denom
      FROM "class_offerings" co
     WHERE co."course_code" IN (${Prisma.join(codes)})
       AND co."graded_count" > 0
       AND co."semester" IN (${Prisma.join(semesters)})
  GROUP BY co."course_code", co."acad_year_be"
  `);

  interface Agg {
    classCount: number;
    gradedCount: number;
    weightedNumer: number;
    weightedDenom: number;
    byYear: Record<string, ProgramCoursesCell>;
  }
  const byCode = new Map<string, Agg>();
  const yearSet = new Set<number>();
  for (const r of aggs) {
    yearSet.add(r.acad_year_be);
    const numer = r.weighted_numer ?? 0;
    const denom = r.weighted_denom ?? 0;
    const classCount = Number(r.class_count);
    const gradedCount = Number(r.graded_count);
    const cell: ProgramCoursesCell = {
      classCount,
      gradedCount,
      averageClassGpa: denom > 0 ? numer / denom : null,
    };
    const entry =
      byCode.get(r.course_code) ?? {
        classCount: 0,
        gradedCount: 0,
        weightedNumer: 0,
        weightedDenom: 0,
        byYear: {},
      };
    entry.classCount += classCount;
    entry.gradedCount += gradedCount;
    entry.weightedNumer += numer;
    entry.weightedDenom += denom;
    entry.byYear[String(r.acad_year_be)] = cell;
    byCode.set(r.course_code, entry);
  }

  // Filter to courses with a real GPA aggregate within the semester
  // window. Courses on the curriculum but with no graded sections in
  // the chosen semesters are excluded entirely.
  const rows = courseRows.flatMap((c) => {
    const agg = byCode.get(c.courseCode);
    if (!agg || agg.weightedDenom <= 0) return [];
    return [{
      courseCode: c.courseCode,
      courseNameTh: c.courseNameTh ?? '',
      courseNameEn: c.courseNameEn ?? '',
      credits: c.credits,
      classCount: agg.classCount,
      gradedCount: agg.gradedCount,
      classGpa: agg.weightedNumer / agg.weightedDenom,
      byYear: agg.byYear,
    }];
  });

  const yearsObserved = [...yearSet].sort((a, b) => a - b);
  return {
    methodVersion: courseRows[0]?.methodVersion ?? 'unknown',
    total: rows.length,
    extractedCount: courseRows.length,
    rows,
    yearsObserved,
    windowYearsBE: {
      start: yearsObserved.length > 0 ? yearsObserved[0]! : null,
      end: yearsObserved.length > 0 ? yearsObserved[yearsObserved.length - 1]! : null,
    },
    semestersApplied: semesters,
  };
}

// ── Outcomes ──────────────────────────────────────────────────────────
export async function programOutcomes(programId: string) {
  const outcomes = await prisma.graduateOutcome.findMany({
    where: { programId, ...realDataWhere() },
    orderBy: [{ surveyYear: 'desc' }, { graduationYear: 'desc' }],
    take: 20,
  });
  const latest = outcomes[0];
  const employer = await prisma.employerFeedback.findMany({
    where: { programId },
    orderBy: { year: 'desc' },
    take: 10,
  });
  // Salary trajectory: one point per graduation year, latest survey.
  const byGraduationYear = new Map<number, { graduationYear: number; averageSalary: number }>();
  for (const o of outcomes) {
    if (!byGraduationYear.has(o.graduationYear)) {
      byGraduationYear.set(o.graduationYear, {
        graduationYear: o.graduationYear,
        averageSalary: Number(o.averageSalary),
      });
    }
  }
  const salaryTrajectory = [...byGraduationYear.values()].sort(
    (a, b) => a.graduationYear - b.graduationYear,
  );

  return {
    latest: latest
      ? {
          graduationYear: latest.graduationYear,
          employmentRate: latest.employmentRate,
          averageSalary: Number(latest.averageSalary),
          jobRelevanceScore: latest.jobRelevanceScore,
          furtherStudyRate: latest.furtherStudyRate,
          sampleSize: latest.sampleSize,
          freshnessDate: latest.freshnessDate,
          methodologyVersion: latest.methodologyVersion,
        }
      : null,
    salaryTrajectory,
    topEmployers: employer.slice(0, 10).map((e) => ({
      name: e.employerName,
      year: e.year,
      satisfactionScore: e.satisfactionScore,
    })),
    // Thailand geographic heatmap deferred (needs a per-graduate
    // location field we don't collect yet). UI shows a placeholder.
  };
}

// ── Digital competency (DQ) ───────────────────────────────────────────

export interface ProgramDigitalCompetencyModule {
  moduleKey: string;
  moduleNo: number;
  /** This programme's weighted mean, or null when the module was never
   *  taken here — and null on every module when the figure is withheld. */
  mean: number | null;
  coveragePct: number | null;
  /** The same module computed over every faculty. Never withheld: it is
   *  an institution-wide mean attributable to nobody. */
  universityMean: number | null;
}

export interface ProgramDigitalCompetency {
  /** 'not-applicable' for non-bachelor programmes: the section does not
   *  render at all, which is different from having no data. */
  status: 'ok' | 'below-floor' | 'no-data' | 'not-applicable';
  rawMean: number | null;
  driverScore: number | null;
  /** Always populated when known — the floor is deliberately low, so
   *  every surface that shows the score must show how thin it is. Zero
   *  on `not-applicable`: whatever DQ rows a non-bachelor programme
   *  carries are the current-enrolment join's artefact, not students
   *  this programme tested. */
  scoredStudents: number;
  passRatePct: number | null;
  /** All 13 theory modules for the radar, plus the university series. */
  modules: ProgramDigitalCompetencyModule[];
  /** Named weakest modules — the actionable part. */
  weakest: Array<{ moduleKey: string; mean: number }>;
  methodologyVersion: string;
}

/** How many modules the section names as weakest. Three is enough to
 *  point a programme chair somewhere without reading as a ranking of
 *  all thirteen. */
const DQ_WEAKEST_COUNT = 3;

/**
 * The programme's Digital Intelligence competency section.
 *
 * Four distinct states, because collapsing any two of them would lie:
 *   - `not-applicable` — any non-bachelor programme. DQ is an
 *     undergraduate instrument; the non-bachelor programmes carrying DQ
 *     rows hold 10 students between them, all undergraduates who later
 *     enrolled, caught by the current-enrolment join. A master's
 *     programme must show no score AND no empty box.
 *   - `no-data` — a bachelor programme the DQ export never covered.
 *   - `below-floor` — 1-4 scored students. The score and the pass rate
 *     are withheld (see DQ_MIN_CELL_STUDENTS), but the COUNT is
 *     returned, so the UI can say why rather than leave a reader to
 *     guess at the dashes. Telling a programme with four tested
 *     students that it has never been tested is the error this
 *     distinction exists to prevent.
 *   - `ok` — a bachelor programme with ≥5 scored students.
 */
export async function programDigitalCompetency(
  programId: string,
): Promise<ProgramDigitalCompetency> {
  const blank = {
    rawMean: null,
    driverScore: null,
    passRatePct: null,
    modules: [] as ProgramDigitalCompetencyModule[],
    weakest: [] as Array<{ moduleKey: string; mean: number }>,
    methodologyVersion: STUDENT_DQ_METHODOLOGY_VERSION,
  };

  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { level: true },
  });
  // A missing programme takes the same branch as a master's: the section
  // renders nothing either way, and the 404 is the caller's to raise.
  if (!program || program.level !== DQ_ELIGIBLE_LEVEL) {
    return { status: 'not-applicable', scoredStudents: 0, ...blank };
  }

  // Bachelor-only and floor-aware by construction — the same query the
  // health driver reads, so the two can never disagree.
  const scope = await dqCompetencyByScope({ scope: 'program', scopeId: programId });
  if (scope.scoredStudents === 0) {
    return { status: 'no-data', scoredStudents: 0, ...blank };
  }

  const withheld = !dqIsEligible(program.level, scope.scoredStudents);

  // Both series come out of `dqRadar`'s reindex against the framework's
  // 13 theory axes, so a module absent from the cube is a null on the
  // same axis in both — never dropped from one series and not the other.
  const radar = await dqRadar({ programId, kind: 'THEORY' });
  const universityByKey = new Map(radar.university.map((c) => [c.moduleKey, c.mean]));
  const modules: ProgramDigitalCompetencyModule[] = radar.scope.map((c) => ({
    moduleKey: c.moduleKey,
    moduleNo: c.moduleNo,
    mean: c.mean,
    coveragePct: c.coveragePct,
    universityMean: universityByKey.get(c.moduleKey) ?? null,
  }));

  if (withheld) {
    // `dqRadar` has already blanked every scope mean; the counts and the
    // university overlay survive.
    return { status: 'below-floor', scoredStudents: scope.scoredStudents, ...blank, modules };
  }

  // Pass rate is DQ's own `allPassed` flag passed through unchanged —
  // the source's inconsistency about module 13 is noted where it is
  // rendered, not silently corrected here.
  const passed = await prisma.dqStudentCube.aggregate({
    where: { programId },
    _sum: { studentsWithScores: true, studentsAllPassed: true },
  });
  const scoredInCube = passed._sum.studentsWithScores ?? 0;
  const allPassed = passed._sum.studentsAllPassed ?? 0;

  // Weakest is drawn from the modules the headline mean averages over.
  // Module 13's uptake varies two-fold between faculties, so it is
  // excluded here for the same reason it is excluded from the score
  // printed beside it — see OVERALL_MEAN_MAX_MODULE_NO.
  const weakest = modules
    .filter(
      (m): m is ProgramDigitalCompetencyModule & { mean: number } =>
        m.moduleNo <= OVERALL_MEAN_MAX_MODULE_NO && m.mean !== null,
    )
    .sort((a, b) => a.mean - b.mean)
    .slice(0, DQ_WEAKEST_COUNT)
    .map((m) => ({ moduleKey: m.moduleKey, mean: m.mean }));

  return {
    status: 'ok',
    rawMean: scope.rawMean,
    driverScore: dqDriverScore(scope.rawMean),
    scoredStudents: scope.scoredStudents,
    passRatePct: scoredInCube > 0 ? (100 * allPassed) / scoredInCube : null,
    modules,
    weakest,
    methodologyVersion: STUDENT_DQ_METHODOLOGY_VERSION,
  };
}

// ── Faculty capability (role-filtered) ─────────────────────────────────
export type FacultyVisibilityLevel = 'full' | 'aggregates-only';

export async function programFaculty(
  programId: string,
  visibility: FacultyVisibilityLevel,
): Promise<ProgramFacultyResult> {
  // Fallback chain for the roster:
  //   (1) ProgramFaculty links — curated per-program roster (no real
  //       connector populates this today; analyst-driven only)
  //   (2) Department-scoped — all FacultyMembers in program.departmentId
  //   (3) Faculty-scoped — all FacultyMembers in program.facultyId
  //
  // The kku-hr connector loads FacultyMember rows with facultyId always
  // set and departmentId optional; programs from the sheet seed have
  // facultyId set and departmentId rarely set. So in practice, most
  // programs land at scope=faculty until an analyst links the per-
  // department or per-program rosters.

  const memberSelect = {
    id: true,
    rank: true,
    nameEn: visibility === 'full',
    nameTh: visibility === 'full',
    employeeCode: visibility === 'full',
    academicQualification: true,
    specialization: visibility === 'full',
    dateOfBirth: true,
    hireDate: visibility === 'full',
    retirementDate: true,
    isActive: true,
    _count: { select: { researchOutputs: true } },
  } as const;

  let rosterScope: ProgramFacultyResult['rosterScope'] = 'program';
  let memberRows: Array<{
    facultyMember: {
      id: string;
      rank: 'PROF' | 'ASSOC_PROF' | 'ASST_PROF' | 'LECTURER';
      nameEn: string | null | false;
      nameTh: string | null | false;
      employeeCode: string | null | false;
      academicQualification: string | null;
      specialization: string | null | false;
      dateOfBirth: Date | null;
      hireDate: Date | null | false;
      retirementDate: Date | null;
      isActive: boolean;
      _count: { researchOutputs: number };
    };
  }> = await prisma.programFaculty.findMany({
    where: { programId },
    include: { facultyMember: { select: memberSelect } },
  });

  if (memberRows.length === 0) {
    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: { facultyId: true, departmentId: true },
    });
    if (program) {
      // (2) Department-scoped fallback
      if (program.departmentId) {
        const deptMembers = await prisma.facultyMember.findMany({
          where: { departmentId: program.departmentId },
          select: memberSelect,
        });
        if (deptMembers.length > 0) {
          rosterScope = 'department';
          memberRows = deptMembers.map((m) => ({ facultyMember: m }));
        }
      }
      // (3) Faculty-scoped fallback (broadest)
      if (memberRows.length === 0) {
        const facMembers = await prisma.facultyMember.findMany({
          where: { facultyId: program.facultyId },
          select: memberSelect,
        });
        rosterScope = 'faculty';
        memberRows = facMembers.map((m) => ({ facultyMember: m }));
      }
    }
  }

  // Aggregates every role can see.
  const ranks: Record<string, number> = {};
  const activeMembers = memberRows
    .map((m) => m.facultyMember)
    .filter((m) => m.isActive);
  for (const m of activeMembers) {
    ranks[m.rank] = (ranks[m.rank] ?? 0) + 1;
  }
  const now = new Date();
  const fiveYears = new Date(now.getFullYear() + 5, now.getMonth(), now.getDate());
  const retiringWithin5 = activeMembers.filter(
    (m) => m.retirementDate && m.retirementDate < fiveYears,
  ).length;
  const avgAgeYears =
    activeMembers.length === 0
      ? null
      : activeMembers
          .filter((m) => m.dateOfBirth)
          .reduce((s, m) => {
            const age = (now.getTime() - m.dateOfBirth!.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
            return s + age;
          }, 0) / Math.max(1, activeMembers.filter((m) => m.dateOfBirth).length);

  const totalPublications = activeMembers.reduce((sum, m) => sum + (m._count?.researchOutputs ?? 0), 0);

  // Same roster the publication total is summed over, so the ratio and the
  // number it qualifies can never describe different populations.
  const researchSourceComposition = await loadResearchSourceComposition(
    activeMembers.map((m) => m.id),
  );

  return {
    visibility,
    rosterScope,
    totalActive: activeMembers.length,
    ranks,
    averageAgeYears: avgAgeYears,
    retiringWithin5Years: retiringWithin5,
    successionRiskPct:
      activeMembers.length === 0 ? 0 : (retiringWithin5 / activeMembers.length) * 100,
    totalPublications,
    researchSourceComposition,
    // Individual list — respects role. COUNCIL sees anonymised rows
    // (employeeCode + ranks only; no names, no specialisation).
    members: memberRows.map((m) => ({
      id: m.facultyMember.id,
      rank: m.facultyMember.rank,
      nameEn: visibility === 'full' ? (m.facultyMember.nameEn || null) : null,
      nameTh: visibility === 'full' ? (m.facultyMember.nameTh || null) : null,
      employeeCode: visibility === 'full' ? (m.facultyMember.employeeCode || null) : null,
      specialization: visibility === 'full' ? (m.facultyMember.specialization || null) : null,
      retirementDate: m.facultyMember.retirementDate,
    })),
  };
}

// ── Peers ──────────────────────────────────────────────────────────────
export async function programPeers(programId: string): Promise<ProgramPeersResult> {
  const peers = await prisma.peerProgram.findMany({
    orderBy: [{ ranking: 'asc' }, { institution: 'asc' }],
    take: 5,
  });
  void programId;
  return {
    peers: peers.map((p) => ({
      id: p.id,
      institution: p.institution,
      country: p.country,
      programName: p.programName,
      programLevel: p.programLevel,
      ranking: p.ranking,
      descriptionUrl: p.descriptionUrl,
    })),
    // Auto-suggestion (skill-embedding similarity) deferred to prompt
    // 10 (Benchmarking module). UI shows a note pointing there.
  };
}

// ── Trends ─────────────────────────────────────────────────────────────
export async function programTrends(programId: string): Promise<ProgramTrendsResult> {
  // Program-level TrendSignal link lives in `affectedProgramIds` (a
  // String[] on the signal). We filter those that include this program,
  // fall back to recent-all if empty.
  const targeted = await prisma.trendSignal.findMany({
    where: { affectedProgramIds: { has: programId } },
    orderBy: { detectedDate: 'desc' },
    take: 10,
  });
  const signals = targeted.length
    ? targeted
    : await prisma.trendSignal.findMany({
        orderBy: { detectedDate: 'desc' },
        take: 5,
      });
  return {
    signals: signals.map((s) => ({
      id: s.id,
      title: s.title,
      signalType: s.signalType,
      summaryTh: s.summaryTh,
      summaryEn: s.summaryEn,
      sourceUrl: s.sourceUrl,
      detectedDate: s.detectedDate,
      impactScore: s.impactScore,
      isTargetedAtProgram: targeted.length > 0,
    })),
  };
}

// ── Decision history ─────────────────────────────────────────────────
export async function programDecisions(programId: string): Promise<ProgramDecisionsResult> {
  const decisions = await prisma.councilDecision.findMany({
    where: { affectedProgramIds: { has: programId } },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: {
      user: { select: { name: true, email: true } },
    },
  });
  const annotations = await prisma.annotation.findMany({
    where: { entityType: 'program', entityId: programId },
    orderBy: { createdAt: 'desc' },
    take: 20,
    include: { user: { select: { name: true, email: true, role: true } } },
  });
  return {
    decisions: decisions.map((d) => ({
      id: d.id,
      decisionType: d.decisionType,
      status: d.status,
      rationaleTh: d.rationaleTh,
      rationaleEn: d.rationaleEn,
      effectiveDate: d.effectiveDate,
      decidedBy: d.user.name ?? d.user.email,
      createdAt: d.createdAt,
    })),
    annotations: annotations.map((a) => ({
      id: a.id,
      kind: a.kind,
      sectionKey: a.sectionKey,
      bodyTh: a.bodyTh,
      bodyEn: a.bodyEn,
      author: a.user.name ?? a.user.email,
      createdAt: a.createdAt,
    })),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Combined shape for the single-page GET /programs/:id/overview convenience
// call the deep-dive page loads on first render.
// ──────────────────────────────────────────────────────────────────────────

export const ProgramDeepDiveSchema = z.object({
  program: z.any(),
  health: z.any().nullable(),
  methodologyVersion: z.string(),
});
export type ProgramDeepDiveOverview = Awaited<ReturnType<typeof programOverview>>;
export type ProgramDemandFunnel = Awaited<ReturnType<typeof programDemandFunnel>>;
export type ProgramFinancials = Awaited<ReturnType<typeof programFinancials>>;
export type ProgramSkillsPayload = Awaited<ReturnType<typeof programSkills>>;
export type ProgramOutcomesPayload = Awaited<ReturnType<typeof programOutcomes>>;
export type ProgramFacultyPayload = Awaited<ReturnType<typeof programFaculty>>;
export type ProgramPeersPayload = Awaited<ReturnType<typeof programPeers>>;
export type ProgramTrendsPayload = Awaited<ReturnType<typeof programTrends>>;
export type ProgramDecisionsPayload = Awaited<ReturnType<typeof programDecisions>>;

// Not exported as a single call at the service layer — we keep the
// controller fan-out explicit so the UI can prioritise above-the-fold
// sections. But HealthScoreRow is re-exported for convenience.
export type { HealthScoreRow };
