import { Prisma, type ProgramLifecycleVerdict } from '@prisma/client';
import { z } from 'zod';
import { prisma } from './index';
import {
  computeHealthScores,
  HEALTH_SCORE_VERSION,
  type HealthDimension,
  type HealthScoreRow,
} from './health-score';
import { queryMetricByScope } from './scope';
import { realDataWhere } from './data-quality';

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
    faculty: { id: string; nameEn: string; nameTh: string };
    department: { id: string; nameEn: string; nameTh: string } | null;
  };
  health: HealthScoreRow | null;
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
   *  Cross-joined from research_outputs via FacultyMember.id; reflects
   *  the OpenAlex publication count for this program's curated faculty. */
  totalPublications: number;
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

  const health = (await computeHealthScores('program', programId))[0] ?? null;

  return {
    program: {
      id: program.id,
      code: program.code,
      nameEn: program.nameEn,
      nameTh: program.nameTh,
      level: program.level,
      status: program.status,
      yearEstablished: program.yearEstablished,
      faculty: program.faculty,
      department: program.department,
    },
    health,
    methodologyVersion: HEALTH_SCORE_VERSION,
  };
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

  // Pull all the per-cohort data in parallel.
  const [alumniRows, cohortRows, tcasRows] = await Promise.all([
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
  ]);

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
  let conversions: Array<{ fromKey: string; toKey: string; rate: number | null }> = [];
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
    const stagesRaw: Array<{ key: string; label: string; value: number }> = [];
    if (tcas && tcas.applicants > 0) {
      stagesRaw.push({ key: 'applied', label: 'Applied (TCAS3 round)', value: tcas.applicants });
    }
    if (tcas && tcas.admitted > 0) {
      stagesRaw.push({ key: 'admitted_tcas', label: 'Admitted (TCAS3)', value: tcas.admitted });
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

/** Compute KKU's active academic year. Term 1 starts June; before
 *  June 1, the active academic year is the prior BE year. */
export function currentAcademicYearBE(now: Date = new Date()): number {
  const ceYear = now.getUTCFullYear();
  const monthZeroIndexed = now.getUTCMonth(); // 0=Jan ... 5=June
  const startsInJune = monthZeroIndexed >= 5;
  const beYear = ceYear + 543;
  return startsInJune ? beYear : beYear - 1;
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

function classifySkill(name: string): 'aiNative' | 'aiAugmented' | 'aiDisplaceable' | 'neutral' {
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

  // 4. Pedagogical readiness: placeholder for now. Surveys + classroom
  // instrumentation land later.
  const pedagogicalReadiness: number | null = null;

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

export interface ProgramLifecycleResult {
  verdict: ProgramLifecycleVerdict;
  /** Trajectory score, 0-100. Derived from weighted sum of drivers. */
  trajectoryScore: number;
  /** Drivers ordered by absolute contribution magnitude. */
  drivers: ProgramLifecycleDriver[];
  /** 2-3 sentence rule-based narrative explaining the verdict. */
  narrative: string;
  methodologyVersion: string;
  generatedAt: string;
}

// v1.1 (2026-05-02) adds AI-readiness as the single heaviest driver
// (±25). AI is the dominant disruption higher education faces this
// decade; the lifecycle verdict treats it as a first-class signal.
const LIFECYCLE_VERSION = 'lifecycle.v1.1';

export async function programLifecycleVerdict(
  programId: string,
): Promise<ProgramLifecycleResult> {
  // Pull every signal we already compute. All these helpers are
  // partial-year-aware + null-safe.
  const [healthRows, cohorts, demoOutlook, peerReviewRow, peerSelections, aiReadiness] = await Promise.all([
    computeHealthScores('program', programId),
    programStudentCohorts(programId),
    programDemographicOutlook(programId),
    prisma.programPeerReview.findUnique({ where: { programId } }),
    prisma.programPeerSelection.findMany({ where: { programId }, take: 1 }),
    programAiReadiness(programId),
  ]);
  const health = healthRows[0] ?? null;

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
  const reviewPayload = peerReviewRow?.payloadJson as
    | { contentModernity?: { verdict: string }; contentGaps?: Array<{ severity: string }> }
    | null
    | undefined;
  let modernityContribution = 0;
  let modernityVerdict: string | null = null;
  if (reviewPayload?.contentModernity) {
    modernityVerdict = reviewPayload.contentModernity.verdict;
    if (modernityVerdict === 'FRONTIER') modernityContribution = 20;
    else if (modernityVerdict === 'OLD_SCHOOL') modernityContribution = -20;
  }
  const modernityDriver: ProgramLifecycleDriver = {
    label: 'content_modernity',
    contribution: modernityContribution,
    raw: { verdict: modernityVerdict ?? 'unknown' },
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

  const drivers: ProgramLifecycleDriver[] = [
    aiReadinessDriver,
    healthDriver,
    enrollmentTrendDriver,
    tuitionTrendDriver,
    modernityDriver,
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

  // Apply OLD_SCHOOL cap: downgrade RISING/FRONTIER to STABLE.
  if (modernityVerdict === 'OLD_SCHOOL' && (verdict === 'RISING' || verdict === 'FRONTIER')) {
    verdict = 'STABLE';
  }

  // AI-readiness gate. The 2026+ labour market punishes graduates
  // whose programmes ignored AI, so we apply two hard caps:
  //   - AI readiness < 30 → cap at STABLE (program faces structural
  //     AI threat regardless of how strong other metrics look)
  //   - AI readiness < 50 → cap at RISING (cannot claim FRONTIER
  //     without genuine AI integration)
  if (aiReadiness.overallScore < 30 && (verdict === 'RISING' || verdict === 'FRONTIER')) {
    verdict = 'STABLE';
  }
  if (aiReadiness.overallScore < 50 && verdict === 'FRONTIER') {
    verdict = 'RISING';
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
  if (peerSelections.length === 0) {
    narrativeParts.push(
      'AI peer review not yet generated — run `pnpm peers:select <code>` for richer modernity + content-gap inputs.',
    );
  }
  const narrative = narrativeParts.join(' ');

  const result: ProgramLifecycleResult = {
    verdict,
    trajectoryScore,
    drivers: sortedDrivers,
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
        institutionName: { not: 'มหาวิทยาลัยขอนแก่น' },
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
        institutionName: { not: 'มหาวิทยาลัยขอนแก่น' },
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

const KKU_INSTITUTION_NAME_TH = 'มหาวิทยาลัยขอนแก่น';

export async function facultyTcasStats(
  facultyId: string,
): Promise<FacultyTcasStats | null> {
  const faculty = await prisma.faculty.findUnique({
    where: { id: facultyId },
    select: { nameTh: true },
  });
  if (!faculty) return null;
  const facultyNameTh = faculty.nameTh;

  // Latest year present in the dataset for THIS faculty.
  const latestRow = await prisma.tcasAdmissionStat.findFirst({
    where: { facultyName: facultyNameTh, institutionName: KKU_INSTITUTION_NAME_TH, ...realDataWhere() },
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
  const kkuRows = allRows.filter((r) => r.institutionName === KKU_INSTITUTION_NAME_TH);
  const peerByInst = new Map<string, typeof allRows>();
  for (const r of allRows) {
    if (r.institutionName === KKU_INSTITUTION_NAME_TH) continue;
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
  const latestRow = await prisma.tcasAdmissionStat.findFirst({
    where: { institutionName: KKU_INSTITUTION_NAME_TH, ...realDataWhere() },
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
  const kkuRows = allRows.filter((r) => r.institutionName === KKU_INSTITUTION_NAME_TH);
  const peerByInst = new Map<string, typeof allRows>();
  for (const r of allRows) {
    if (r.institutionName === KKU_INSTITUTION_NAME_TH) continue;
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

// ── Demographic outlook ────────────────────────────────────────────────
// Project the program's catchment-region applicant pool forward and
// compare against current Year-1 intake. KKU's catchment is primarily
// Northeast Thailand; we use that as the v1 default and surface the
// national 'TH' as a comparator. Sub-program catchment overrides come
// later — for now every program inherits the institutional catchment.
//
// The signal Council wants: "If we maintain today's intake, what
// share of the future 18-22 cohort do we need to capture?" — a low
// share is comfortable; a rising share indicates the program is
// approaching its demographic ceiling.
export type DemographicRiskLevel = 'low' | 'medium' | 'high' | 'unknown';

export interface ProgramDemographicOutlook {
  catchmentRegion: 'Northeast' | 'TH';
  source: string;
  /** The cohort the projection is anchored to — '18-22' for bachelor
   *  programmes, '23-29' for graduate programmes. */
  ageCohort: '18-22' | '23-29';
  /** Today's Year-1 intake (latest year, dropping the in-progress
   *  partial year if applicable). Null when no enrollment data. */
  baselineYearOneIntake: number | null;
  /** Cohort projection at +0 / +5 / +10 / +15 years from now. */
  projections: Array<{
    year: number;
    cohortPopulation: number;
    cohortPopulationNational: number | null;
    /** Share of the catchment cohort needed to maintain today's
     *  intake. Null when intake is unknown. */
    requiredShareOfCohort: number | null;
    /** % decline of the cohort vs the year=now anchor. */
    cohortDeclinePct: number;
  }>;
  /** Cohort decline from now → +15y, expressed as a percentage. */
  fifteenYearContraction: number;
  /** Risk verdict based on the +10y required-share trajectory:
   *    < 0.05% (NE 18-22)  → low
   *    0.05–0.20%          → medium
   *    > 0.20%             → high
   *  Tuned for KKU's individual program scale; aggregate across all
   *  KKU bachelor programs becomes the institutional ceiling and is
   *  surfaced separately at the cockpit/portfolio level. */
  riskLevel: DemographicRiskLevel;
}

const COHORT_FOR_LEVEL: Record<string, '18-22' | '23-29'> = {
  BACHELOR: '18-22',
  HIGHER_GRAD_DIPLOMA: '23-29',
  MASTER: '23-29',
  DOCTORAL: '23-29',
};

export async function programDemographicOutlook(
  programId: string,
  now: Date = new Date(),
): Promise<ProgramDemographicOutlook | null> {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: { level: true },
  });
  if (!program) return null;

  const catchment: 'Northeast' = 'Northeast'; // KKU institutional default
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

  const nowCE = now.getUTCFullYear();
  const horizons = [0, 5, 10, 15];
  const projections: ProgramDemographicOutlook['projections'] = [];
  let anchorPopulation: number | null = null;
  for (const h of horizons) {
    const targetYear = nowCE + h;
    const regionalRow = allRows.find(
      (r) => r.region === catchment && r.year === targetYear,
    );
    const nationalRow = allRows.find(
      (r) => r.region === 'TH' && r.year === targetYear,
    );
    if (!regionalRow) continue;
    if (anchorPopulation === null) anchorPopulation = regionalRow.population;
    const requiredShare =
      baselineYearOneIntake && regionalRow.population > 0
        ? baselineYearOneIntake / regionalRow.population
        : null;
    const declinePct =
      anchorPopulation && anchorPopulation > 0
        ? ((anchorPopulation - regionalRow.population) / anchorPopulation) * 100
        : 0;
    projections.push({
      year: targetYear,
      cohortPopulation: regionalRow.population,
      cohortPopulationNational: nationalRow?.population ?? null,
      requiredShareOfCohort: requiredShare,
      cohortDeclinePct: declinePct,
    });
  }
  if (projections.length === 0) return null;
  const tenYear = projections.find((p) => p.year === nowCE + 10);
  const fifteenYear = projections.find((p) => p.year === nowCE + 15);
  const fifteenYearContraction = fifteenYear?.cohortDeclinePct ?? 0;

  let riskLevel: DemographicRiskLevel = 'unknown';
  if (tenYear && tenYear.requiredShareOfCohort !== null) {
    const sharePct = tenYear.requiredShareOfCohort * 100;
    if (sharePct < 0.05) riskLevel = 'low';
    else if (sharePct < 0.2) riskLevel = 'medium';
    else riskLevel = 'high';
  }

  return {
    catchmentRegion: catchment,
    source: allRows[0]!.source,
    ageCohort,
    baselineYearOneIntake,
    projections,
    fifteenYearContraction,
    riskLevel,
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

  // Pick the latest COMPLETE fiscal year — i.e., skip a partial in-
  // progress year. Heuristic: if the most recent year's tuition is
  // less than 30% of the prior year, treat it as partial (academic
  // term in flight, not all students have paid yet). For SEQ-0062 in
  // 2026-05, FY 2026 shows 220K (11 students enrolled so far) vs FY
  // 2025's 11.6M (full year) — the partial year is excluded.
  const PARTIAL_YEAR_RATIO = 0.3;
  let latest: typeof rawRows[number] | undefined;
  let displayedYearIsPartial = false;
  if (rawRows.length >= 2) {
    const last = rawRows[rawRows.length - 1]!;
    const prior = rawRows[rawRows.length - 2]!;
    const lastTuition = Number(last.tuitionRevenue);
    const priorTuition = Number(prior.tuitionRevenue);
    if (priorTuition > 0 && lastTuition < priorTuition * PARTIAL_YEAR_RATIO) {
      latest = prior;
      displayedYearIsPartial = true;
    } else {
      latest = last;
    }
  } else {
    latest = rawRows.at(-1);
  }
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

  return {
    waterfall,
    trend,
    /// The FY (CE) the headline numbers are sourced from.
    latestFiscalYear: latest?.fiscalYear ?? null,
    /// True when the connector wrote a more recent FY but the heuristic
    /// classified it as partial/in-progress. UI surfaces a small note.
    partialCurrentYearAvailable: displayedYearIsPartial,
    /// Annual salary subsidy the government pays for this program's
    /// faculty — sourced from `EmployeeDetail.SALARY × 12` for the staff
    /// in `ProgramFaculty`. Informational only; NOT netted from tuition.
    governmentFacultySubsidy: latest ? Number(latest.allocatedFacultyCost) : null,
    /// Government investment per enrolled student per year.
    costPerStudent: latest?.costPerStudent ? Number(latest.costPerStudent) : null,
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
    demandSource: 'linkedin-via-mhesi-kmitl',
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
    // Real "top 5 specific recommendations" text needs an AI call —
    // the narrative regen endpoint produces that; this method returns
    // the raw data the LLM needs.
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
