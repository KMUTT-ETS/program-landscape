/**
 * AUN-QA evidence resolvers — one per `EvidenceBinding` kind.
 *
 * The registry in `@kku/shared/aunqa/criteria` says WHAT could evidence a
 * sub-criterion. This file says whether the platform actually HAS it for a
 * given programme, and hands back the figure.
 *
 * ── THE RULE THIS FILE EXISTS TO ENFORCE ──────────────────────────────
 * A resolver returns `available: false` rather than a zero, an empty array
 * dressed as a value, or a thrown error. "No evidence for sub-criterion
 * 4.2" is the single most useful output this feature produces; a zero would
 * read as "assessed and scored nothing", which is a different and false
 * claim. Every resolver is wrapped so an upstream failure degrades to
 * unavailable rather than taking the page down — an accreditation surface
 * that half-renders is worse than one that says what it does not know.
 * `assertAvailable` makes `available: true` with a null value unreachable.
 * ──────────────────────────────────────────────────────────────────────
 *
 * Reuse over re-derivation: skills, courses, outcomes, faculty, cohorts and
 * DQ all come from the existing programme-scope readers in
 * `program-deep-dive.ts` / `student-dq.ts`. Two figures have no existing
 * reader at programme scope and are computed here — the evaluation-theme
 * aggregate and teaching workload — both modelled on the queries the
 * `/education/satisfaction` and `/staff/teaching-workload` surfaces run.
 *
 * ── Two readings this file deliberately does NOT make ─────────────────
 * 1. `enrollment_metrics.graduated_late` is 0 on all 4,641 rows: the
 *    registrar connector's on-time/late split was deferred, so
 *    `graduatedOnTime` in fact holds TOTAL graduates under a name that says
 *    otherwise. Nothing here reads that column, and nothing here calls any
 *    figure "graduated on time".
 * 2. Consequently there is no measured time-to-graduate anywhere in the
 *    platform. Sub-criterion 8.2 is bound to `cohort-progression` instead —
 *    where a cohort has piled up by year in programme, which is indicative
 *    of completion lag and is labelled as exactly that, never as a measured
 *    time to graduate.
 *
 * Sub-criterion 8.1 asks for pass AND dropout rates. `class-gpa-distribution`
 * evidences the pass half; `enrollment-metric` with field `dropouts` — a kind
 * added for exactly this, rather than smuggled into an unrelated one —
 * evidences the other. Neither reads any graduation column.
 */

import { scholarDisclosureLine, type EvidenceBinding } from '@kku/shared';
import { prisma } from './index';
import {
  programCourses,
  programDigitalCompetency,
  programFaculty,
  programOutcomes,
  programSkills,
  programStudentCohorts,
  programAiPeers,
} from './program-deep-dive';
import { dqCompetencyByScope } from './student-dq';

/** Main academic terms. Summer/special terms (3, 4) are excluded from the
 *  evaluation and workload aggregates for the same reason the dashboards
 *  exclude them: they are small, optional, and not representative. */
const MAIN_SEMESTERS = [1, 2];

export interface ResolvedEvidence {
  binding: EvidenceBinding;
  /** False whenever the platform cannot show a figure — including when the
   *  underlying read failed. Never true with a null `value`. */
  available: boolean;
  /** Shape depends on the kind — a number, a distribution, a profile.
   *  Always null when `available` is false. */
  value: unknown;
  /** Human-readable source, for the provenance drawer. */
  sourceLabel: string;
  freshness: Date | null;
  /** A limitation the reader must see beside the figure, or null. Rendered,
   *  not logged: on an accreditation surface the wording of a caveat is the
   *  guard against overclaiming. */
  caveat: string | null;
}

// ── Per-kind value shapes ─────────────────────────────────────────────
// `ResolvedEvidence.value` is `unknown` by contract; these let a caller
// narrow it once it knows the binding kind it asked for.

export interface CurriculumSkillsValue {
  skillCount: number;
  ploSkillCount: number;
  majorContributorCount: number;
  minorContributorCount: number;
  topSkills: Array<{ nameEn: string; nameTh: string; weight: number; pickedFromPlo: boolean }>;
}

export interface CurriculumCoursesValue {
  extractedCourseCount: number;
  gradedCourseCount: number;
  totalCredits: number | null;
  yearsObserved: number[];
}

export interface CurriculumCreditsValue {
  totalCredits: number;
  durationYears: number | null;
  creditsFromCourseList: number | null;
  extractedCourseCount: number;
}

export interface EvaluationThemeValue {
  theme: string;
  /** Respondent-weighted mean on the registrar's 1-5 Likert scale. */
  ratingAvg: number;
  respondentCount: number;
  cellCount: number;
  questionCount: number;
  yearsObserved: { first: number; last: number };
}

export interface DqProgramScoreValue {
  rawMean: number;
  scoredStudents: number;
}

export interface DqModuleProfileValue {
  rawMean: number | null;
  scoredStudents: number;
  modules: Array<{ moduleKey: string; moduleNo: number; mean: number | null; universityMean: number | null }>;
  weakest: Array<{ moduleKey: string; mean: number }>;
}

export interface GraduateOutcomeValue {
  field: 'employmentRate' | 'jobRelevance' | 'furtherStudy' | 'salary';
  value: number;
  graduationYear: number;
  sampleSize: number;
}

export interface ClassGpaDistributionValue {
  /** Credit- and headcount-weighted mean across the programme's courses. */
  averageClassGpa: number;
  courseCount: number;
  classCount: number;
  gradedCount: number;
  /** Courses per GPA band — the distribution, not just its centre. */
  bands: Array<{ band: string; lo: number; hi: number; courses: number }>;
  yearsObserved: number[];
}

export interface EnrollmentYear {
  academicYear: number;
  enrolled: number;
  dropouts: number;
  /** Dropouts as a share of that year's intake. */
  dropoutPct: number;
}

export interface EnrollmentMetricValue {
  field: 'dropouts' | 'enrolled';
  /** The headline figure for the anchor year — a dropout count or an
   *  intake count. Zero is a measurement here, not an absence. */
  value: number;
  /** Latest year on record that recorded an intake. */
  academicYear: number;
  /** Both halves of the ratio, always: a dropout count without the
   *  cohort it came from says nothing. */
  enrolled: number;
  dropouts: number;
  dropoutPct: number;
  /** Up to five years, oldest first. The series is what makes an
   *  in-progress final year visible as the artefact it is. */
  series: EnrollmentYear[];
}

export interface StaffRatioValue {
  enrolled: number;
  activeStaff: number;
  studentsPerStaff: number;
  academicYear: number;
  rosterScope: 'program' | 'department' | 'faculty';
}

export interface StaffRankMixValue {
  activeStaff: number;
  ranks: Record<string, number>;
  seniorSharePct: number;
  retiringWithin5Years: number;
  rosterScope: 'program' | 'department' | 'faculty';
}

export interface StaffResearchValue {
  activeStaff: number;
  totalPublications: number;
  publicationsPerStaff: number;
  rosterScope: 'program' | 'department' | 'faculty';
}

export interface StaffWorkloadValue {
  academicYear: number;
  teachers: number;
  sections: number;
  totalContactHrsPerWeek: number;
  avgContactHrsPerTeacher: number;
}

export interface PedagogyDisciplineFitValue {
  disciplineFitScore: number;
  overallScore: number;
  confidence: number;
  methodVersion: string;
}

export interface PedagogyQaSystemValue {
  qaScore: number;
  framework: string | null;
  continuousImprovementEvidence: string[];
  stakeholderFeedbackLoops: string[];
  confidence: number;
  methodVersion: string;
}

export interface PedagogyGapsValue {
  gaps: Array<{ area: string; severity: string; observation: string; recommendation: string }>;
  gapCount: number;
  confidence: number;
  methodVersion: string;
}

export interface PeerContentModernityValue {
  verdict: string;
  narrative: string;
  confidence: number;
  peerCountTotal: number;
}

export interface PeerContentGapsValue {
  gaps: Array<{ topic: string; kkuStatus: string; peerExamples: string; severity: string }>;
  gapCount: number;
  confidence: number;
  peerCountTotal: number;
}

export interface CohortProgressionValue {
  cohorts: Array<{ entryYearBE: number; yearInProgramme: number; studentCount: number; status: string }>;
  totalActive: number;
  incomingCount: number;
  onTrackCount: number;
  /** Students past the nominal duration — the completion-lag signal. */
  delayedCount: number;
  delayedPct: number | null;
  programDurationYears: number | null;
}

/** The one caveat on this binding that must reach the screen. The registry
 *  rebound 8.2 here because no measured time-to-graduate exists anywhere in
 *  the platform; saying so beside the figure is what keeps the rebinding
 *  honest rather than a quieter version of the same overclaim. */
const COHORT_PROGRESSION_CAVEAT =
  'Cohort progression by year in programme — indicative of completion lag, not a measured time to graduate.';

/** Faculty rosters are curated per-programme for almost no programme, so
 *  `programFaculty` falls back to the department or the whole faculty. A
 *  staff figure computed over the faculty is not a statement about this
 *  programme, and the reader has to be told which one they are looking at. */
function rosterCaveat(scope: 'program' | 'department' | 'faculty'): string | null {
  if (scope === 'program') return null;
  if (scope === 'department') return 'Roster is the whole department — no programme-specific staff list exists.';
  return 'Roster is the whole faculty — no programme- or department-specific staff list exists.';
}

/** One caveat line out of several, dropping the ones that do not apply.
 *  `ResolvedEvidence.caveat` is a single nullable string rendered beside the
 *  figure, so a figure qualified by two things needs them joined here rather
 *  than one of them silently winning. */
function joinCaveats(parts: readonly (string | null)[]): string | null {
  const kept = parts.filter((p): p is string => p !== null && p.length > 0);
  return kept.length === 0 ? null : kept.join(' ');
}

/** The join every evaluation figure passes through, stated once. */
const COURSE_MAPPING_CAVEAT =
  'Counted through the programme\'s extracted course list; courses missing from that list contribute nothing.';

const UNAVAILABLE = {
  available: false as const,
  value: null,
  freshness: null,
};

interface ResolverOutput {
  available: boolean;
  value: unknown;
  sourceLabel: string;
  freshness: Date | null;
  caveat: string | null;
}

/** Guards the invariant in one place: an available result carries a value. */
function assertAvailable(out: ResolverOutput): ResolverOutput {
  if (out.available && (out.value === null || out.value === undefined)) {
    return { ...out, available: false, value: null };
  }
  return out;
}

// ── Individual resolvers ──────────────────────────────────────────────

async function resolveCurriculumSkills(programId: string): Promise<ResolverOutput> {
  const [skills, freshRow] = await Promise.all([
    programSkills(programId),
    prisma.programSkill.aggregate({ where: { programId }, _max: { computedAt: true } }),
  ]);
  const sourceLabel = 'Programme skill map (program_skills, extracted from the curriculum)';
  if (skills.taught.length === 0) {
    return { ...UNAVAILABLE, sourceLabel, caveat: null };
  }
  const value: CurriculumSkillsValue = {
    skillCount: skills.taught.length,
    ploSkillCount: skills.ploSkillCount,
    majorContributorCount: skills.majorContributorCount,
    minorContributorCount: skills.minorContributorCount,
    topSkills: skills.taught.slice(0, 10).map((s) => ({
      nameEn: s.nameEn,
      nameTh: s.nameTh,
      weight: s.weight,
      pickedFromPlo: s.pickedFromPlo,
    })),
  };
  return {
    available: true,
    value,
    sourceLabel,
    freshness: freshRow._max.computedAt ?? null,
    caveat: null,
  };
}

async function resolveCurriculumCourses(programId: string): Promise<ResolverOutput> {
  const [courses, freshRow, program] = await Promise.all([
    programCourses(programId, { semesters: MAIN_SEMESTERS }),
    prisma.programCourse.aggregate({ where: { programId }, _max: { refreshedAt: true } }),
    prisma.program.findUnique({ where: { id: programId }, select: { totalCredits: true } }),
  ]);
  const sourceLabel = 'Extracted course list (program_courses) × registrar class offerings';
  if (courses.extractedCount === 0) {
    return { ...UNAVAILABLE, sourceLabel, caveat: null };
  }
  const value: CurriculumCoursesValue = {
    extractedCourseCount: courses.extractedCount,
    gradedCourseCount: courses.total,
    totalCredits: program?.totalCredits ?? null,
    yearsObserved: courses.yearsObserved,
  };
  return {
    available: true,
    value,
    sourceLabel,
    freshness: freshRow._max.refreshedAt ?? null,
    caveat:
      courses.total === 0
        ? 'The course list exists but none of its courses has a graded section on record.'
        : null,
  };
}

async function resolveCurriculumCredits(programId: string): Promise<ResolverOutput> {
  const [program, courseAgg] = await Promise.all([
    prisma.program.findUnique({
      where: { id: programId },
      select: { totalCredits: true, durationYears: true },
    }),
    prisma.programCourse.aggregate({
      where: { programId },
      _sum: { credits: true },
      _count: { _all: true },
      _max: { refreshedAt: true },
    }),
  ]);
  const sourceLabel = 'Programme record (total credits) + extracted course list';
  const totalCredits = program?.totalCredits ?? null;
  if (totalCredits === null) {
    // A curriculum whose credit total was never extracted has no credit
    // structure to show. Summing the extracted course list instead would
    // present a partial list as a programme total.
    return { ...UNAVAILABLE, sourceLabel, caveat: null };
  }
  const value: CurriculumCreditsValue = {
    totalCredits,
    durationYears: program?.durationYears ?? null,
    creditsFromCourseList: courseAgg._sum.credits ?? null,
    extractedCourseCount: courseAgg._count._all,
  };
  return {
    available: true,
    value,
    sourceLabel,
    freshness: courseAgg._max.refreshedAt ?? null,
    caveat: null,
  };
}

/**
 * Respondent-weighted mean for one question theme, over the classes of this
 * programme's courses.
 *
 * Five of the instrument's forty questions carry a NULL or empty
 * `theme_tag` and so belong to no criterion — they count toward nothing
 * here. The themes therefore do NOT partition the instrument, and a reader
 * comparing a theme mean against the programme's overall satisfaction score
 * is comparing different question sets.
 *
 * The join runs through `program_courses`, exactly as
 * `/education/satisfaction`'s by-programme query does. A programme whose
 * courses were never extracted has NO evaluation evidence — that is a real
 * finding to display as unavailable, not a bug to work around; the same
 * join hides about a third of instructors on `/staff/teaching`.
 */
async function resolveEvaluationTheme(programId: string, theme: string): Promise<ResolverOutput> {
  const sourceLabel = `Student evaluations, theme "${theme}" (evaluation_response_summaries × evaluation_questions)`;
  // $queryRawUnsafe with positional params rather than a Prisma.Sql
  // fragment: these resolvers run concurrently, and a shared Sql object
  // mis-binds under Promise.all (`syntax error at or near "$1"`) — the
  // same trap `dashboard-overview.ts` and `student-dq.ts` document.
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      rating_avg: number | null;
      respondents: bigint;
      cells: bigint;
      questions: bigint;
      first_year: number | null;
      last_year: number | null;
      freshness: Date | null;
    }>
  >(
    `
    SELECT
      (SUM(e.rating_avg::numeric * e.respondent_count)
        / NULLIF(SUM(e.respondent_count), 0))::float          AS rating_avg,
      COALESCE(SUM(e.respondent_count), 0)::bigint            AS respondents,
      COUNT(*)::bigint                                        AS cells,
      COUNT(DISTINCT e.question_id)::bigint                   AS questions,
      MIN(e.acad_year_be)::int                                AS first_year,
      MAX(e.acad_year_be)::int                                AS last_year,
      MAX(e.last_update_at)                                   AS freshness
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    JOIN evaluation_questions q ON q.id = e.question_id
    JOIN program_courses pc ON pc.course_code = e.course_code AND pc.program_id = $1
    WHERE ds.mocked = false
      AND q.theme_tag = $2
      AND e.semester = ANY($3::int[])
    `,
    programId,
    theme,
    MAIN_SEMESTERS,
  );
  const row = rows[0];
  const respondents = Number(row?.respondents ?? 0);
  const rating = row?.rating_avg;
  if (
    !row ||
    respondents === 0 ||
    typeof rating !== 'number' ||
    !Number.isFinite(rating) ||
    row.first_year === null ||
    row.last_year === null
  ) {
    return { ...UNAVAILABLE, sourceLabel, caveat: null };
  }
  const value: EvaluationThemeValue = {
    theme,
    ratingAvg: rating,
    respondentCount: respondents,
    cellCount: Number(row.cells),
    questionCount: Number(row.questions),
    yearsObserved: { first: row.first_year, last: row.last_year },
  };
  return {
    available: true,
    value,
    sourceLabel,
    freshness: row.freshness ?? null,
    caveat: COURSE_MAPPING_CAVEAT,
  };
}

async function resolveDqProgramScore(programId: string): Promise<ResolverOutput> {
  const dq = await dqCompetencyByScope({ scope: 'program', scopeId: programId });
  const sourceLabel = 'Digital Intelligence (DQ) assessment, programme scope';
  if (dq.rawMean === null) {
    // Withheld below the small-cell floor, or a non-bachelor programme the
    // instrument does not cover. Either way there is no score to show.
    return { ...UNAVAILABLE, sourceLabel, caveat: null };
  }
  const value: DqProgramScoreValue = { rawMean: dq.rawMean, scoredStudents: dq.scoredStudents };
  return { available: true, value, sourceLabel, freshness: null, caveat: null };
}

async function resolveDqModuleProfile(programId: string): Promise<ResolverOutput> {
  const dq = await programDigitalCompetency(programId);
  const sourceLabel = 'Digital Intelligence (DQ) module profile, programme scope';
  if (dq.status !== 'ok' || dq.modules.length === 0) {
    return {
      ...UNAVAILABLE,
      sourceLabel,
      caveat:
        dq.status === 'not-applicable'
          ? 'The DQ instrument is undergraduate-only; it does not cover this programme.'
          : null,
    };
  }
  const value: DqModuleProfileValue = {
    rawMean: dq.rawMean,
    scoredStudents: dq.scoredStudents,
    modules: dq.modules.map((m) => ({
      moduleKey: m.moduleKey,
      moduleNo: m.moduleNo,
      mean: m.mean,
      universityMean: m.universityMean,
    })),
    weakest: dq.weakest,
  };
  return { available: true, value, sourceLabel, freshness: null, caveat: null };
}

async function resolveGraduateOutcome(
  programId: string,
  field: 'employmentRate' | 'jobRelevance' | 'furtherStudy' | 'salary',
): Promise<ResolverOutput> {
  const outcomes = await programOutcomes(programId);
  const sourceLabel = 'Graduate outcome survey (graduate_outcomes)';
  const latest = outcomes.latest;
  if (!latest) return { ...UNAVAILABLE, sourceLabel, caveat: null };
  const raw =
    field === 'employmentRate'
      ? latest.employmentRate
      : field === 'jobRelevance'
        ? latest.jobRelevanceScore
        : field === 'furtherStudy'
          ? latest.furtherStudyRate
          : latest.averageSalary;
  if (typeof raw !== 'number' || !Number.isFinite(raw)) {
    return { ...UNAVAILABLE, sourceLabel, caveat: null };
  }
  const value: GraduateOutcomeValue = {
    field,
    value: raw,
    graduationYear: latest.graduationYear,
    sampleSize: latest.sampleSize,
  };
  return {
    available: true,
    value,
    sourceLabel,
    freshness: latest.freshnessDate ?? null,
    caveat:
      latest.sampleSize < 10
        ? `Based on ${latest.sampleSize} respondents — too few to read as a programme-level rate.`
        : null,
  };
}

/** GPA bands. Coarse on purpose: a finer grid over a course list of a dozen
 *  rows would render as noise rather than a distribution. */
const GPA_BANDS: Array<{ band: string; lo: number; hi: number }> = [
  { band: '< 2.00', lo: 0, hi: 2 },
  { band: '2.00–2.49', lo: 2, hi: 2.5 },
  { band: '2.50–2.99', lo: 2.5, hi: 3 },
  { band: '3.00–3.49', lo: 3, hi: 3.5 },
  { band: '≥ 3.50', lo: 3.5, hi: 4.01 },
];

async function resolveClassGpaDistribution(programId: string): Promise<ResolverOutput> {
  const courses = await programCourses(programId, { semesters: MAIN_SEMESTERS });
  const sourceLabel = 'Registrar class GPA per course (class_offerings × program_courses)';
  if (courses.rows.length === 0) {
    return { ...UNAVAILABLE, sourceLabel, caveat: null };
  }
  let numer = 0;
  let denom = 0;
  let classCount = 0;
  let gradedCount = 0;
  const bandCounts = GPA_BANDS.map((b) => ({ ...b, courses: 0 }));
  for (const row of courses.rows) {
    // Weight by graded students so a 200-seat service course does not
    // count the same as a 6-student elective.
    numer += row.classGpa * row.gradedCount;
    denom += row.gradedCount;
    classCount += row.classCount;
    gradedCount += row.gradedCount;
    const band = bandCounts.find((b) => row.classGpa >= b.lo && row.classGpa < b.hi);
    if (band) band.courses += 1;
  }
  if (denom === 0) return { ...UNAVAILABLE, sourceLabel, caveat: null };
  const value: ClassGpaDistributionValue = {
    averageClassGpa: numer / denom,
    courseCount: courses.rows.length,
    classCount,
    gradedCount,
    bands: bandCounts,
    yearsObserved: courses.yearsObserved,
  };
  return {
    available: true,
    value,
    sourceLabel,
    freshness: null,
    caveat: COURSE_MAPPING_CAVEAT,
  };
}

/** How many years of the enrolment record the value carries. Five spans a
 *  bachelor cohort's life, which is what makes a rising dropout trend
 *  legible rather than a single year's noise. */
const ENROLMENT_SERIES_YEARS = 5;

/**
 * Retention from the registrar's enrolment record.
 *
 * Availability turns on whether a year with an intake exists, NOT on
 * whether anyone dropped out. `dropouts = 0` against a real cohort is a
 * measurement — 2,052 of the 4,641 rows say exactly that — and reporting it
 * as unavailable would tell a QA officer we hold no retention data for a
 * programme whose retention we have in fact measured as complete. "Nobody
 * dropped out" and "we have no retention data" are opposite findings.
 *
 * Anchored on the latest year that recorded an intake: 81 rows carry
 * `enrolled = 0` alongside `dropouts = 0`, which is a year with no cohort
 * rather than a year with perfect retention, and a rate over a zero
 * denominator is undefined, not 0%.
 *
 * Reads `enrolled` and `dropouts` only. `graduated_on_time` holds TOTAL
 * graduates despite its name and `graduated_late` is empty on every row, so
 * no completion figure is derived here under any label.
 */
async function resolveEnrollmentMetric(
  programId: string,
  field: 'dropouts' | 'enrolled',
): Promise<ResolverOutput> {
  const sourceLabel = 'Registrar enrolment record (enrollment_metrics)';
  const rows = await prisma.enrollmentMetric.findMany({
    where: { programId },
    orderBy: { academicYear: 'desc' },
    take: ENROLMENT_SERIES_YEARS,
    select: {
      academicYear: true,
      enrolled: true,
      dropouts: true,
      freshnessDate: true,
    },
  });
  if (rows.length === 0) return { ...UNAVAILABLE, sourceLabel, caveat: null };
  const withIntake = rows.filter((r) => r.enrolled > 0);
  const anchor = withIntake[0];
  if (!anchor) {
    return {
      ...UNAVAILABLE,
      sourceLabel,
      caveat: 'The enrolment record exists but no year on it records an intake.',
    };
  }
  const series: EnrollmentYear[] = withIntake
    .map((r) => ({
      academicYear: r.academicYear,
      enrolled: r.enrolled,
      dropouts: r.dropouts,
      dropoutPct: (r.dropouts / r.enrolled) * 100,
    }))
    .sort((a, b) => a.academicYear - b.academicYear);
  const value: EnrollmentMetricValue = {
    field,
    value: field === 'dropouts' ? anchor.dropouts : anchor.enrolled,
    academicYear: anchor.academicYear,
    enrolled: anchor.enrolled,
    dropouts: anchor.dropouts,
    dropoutPct: (anchor.dropouts / anchor.enrolled) * 100,
    series,
  };
  return {
    available: true,
    value,
    sourceLabel,
    freshness: anchor.freshnessDate ?? null,
    caveat:
      field === 'dropouts'
        ? 'Dropouts accumulate over a cohort\'s life, so the most recent year understates them; read the series, not the last figure alone.'
        : null,
  };
}

async function resolveStaffRatio(programId: string): Promise<ResolverOutput> {
  const sourceLabel = 'Staff roster (faculty_members) × latest enrolment (enrollment_metrics)';
  const [roster, enrolment] = await Promise.all([
    // Aggregates-only: this surface needs headcounts and ranks, never names.
    programFaculty(programId, 'aggregates-only'),
    prisma.enrollmentMetric.findFirst({
      where: { programId },
      orderBy: { academicYear: 'desc' },
      select: { academicYear: true, enrolled: true, freshnessDate: true },
    }),
  ]);
  if (roster.totalActive === 0 || !enrolment || enrolment.enrolled === 0) {
    return { ...UNAVAILABLE, sourceLabel, caveat: null };
  }
  const value: StaffRatioValue = {
    enrolled: enrolment.enrolled,
    activeStaff: roster.totalActive,
    studentsPerStaff: enrolment.enrolled / roster.totalActive,
    academicYear: enrolment.academicYear,
    rosterScope: roster.rosterScope,
  };
  return {
    available: true,
    value,
    sourceLabel,
    freshness: enrolment.freshnessDate ?? null,
    caveat: rosterCaveat(roster.rosterScope),
  };
}

async function resolveStaffRankMix(programId: string): Promise<ResolverOutput> {
  const sourceLabel = 'Staff roster ranks (faculty_members)';
  const roster = await programFaculty(programId, 'aggregates-only');
  if (roster.totalActive === 0) return { ...UNAVAILABLE, sourceLabel, caveat: null };
  const senior = (roster.ranks['PROF'] ?? 0) + (roster.ranks['ASSOC_PROF'] ?? 0);
  const value: StaffRankMixValue = {
    activeStaff: roster.totalActive,
    ranks: roster.ranks,
    seniorSharePct: (senior / roster.totalActive) * 100,
    retiringWithin5Years: roster.retiringWithin5Years,
    rosterScope: roster.rosterScope,
  };
  return { available: true, value, sourceLabel, freshness: null, caveat: rosterCaveat(roster.rosterScope) };
}

/**
 * Publications on the staff roster.
 *
 * THE CAVEAT IS LOAD-BEARING ON THIS SURFACE. `roster.totalPublications` is
 * UNFILTERED — it is one of only three renderings of the one research figure
 * that counts on-demand Google Scholar imports (the others being the web
 * deep-dive card and the Gotenberg `program-detail` PDF). An assessor reads
 * "Publications on record" in an accreditation pack as an audited figure, and
 * a pack is read away from any screen that could explain it, so the
 * disclosure has to be in the caveat line the module already renders beside
 * every figure. `scholarDisclosureLine` returns null when there is nothing to
 * disclose, which keeps the pack quiet in the ordinary case.
 */
async function resolveStaffResearch(programId: string): Promise<ResolverOutput> {
  const sourceLabel = 'Publications of the staff roster (research_outputs)';
  const roster = await programFaculty(programId, 'aggregates-only');
  if (roster.totalActive === 0) return { ...UNAVAILABLE, sourceLabel, caveat: null };
  // A known roster with zero publications is a measurement, not a data gap
  // — the distinction the availability flag exists to preserve.
  const value: StaffResearchValue = {
    activeStaff: roster.totalActive,
    totalPublications: roster.totalPublications,
    publicationsPerStaff: roster.totalPublications / roster.totalActive,
    rosterScope: roster.rosterScope,
  };
  return {
    available: true,
    value,
    sourceLabel,
    freshness: null,
    caveat: joinCaveats([
      rosterCaveat(roster.rosterScope),
      scholarDisclosureLine(roster.researchSourceComposition, 'counts-scholar-rows'),
    ]),
  };
}

/**
 * Contact hours per week on the programme's own courses, latest academic
 * year on record.
 *
 * Every co-teacher of a team-taught section carries the FULL section load —
 * the registrar's representation and KKU's teaching-credit policy both work
 * that way, and `/staff/teaching-workload` counts it the same, so the two
 * surfaces agree.
 */
async function resolveStaffWorkload(programId: string): Promise<ResolverOutput> {
  const sourceLabel = 'Teaching contact hours (class_offerings × class_offering_teachers)';
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      acad_year_be: number;
      teachers: bigint;
      sections: bigint;
      contact_hrs: number | null;
    }>
  >(
    `
    SELECT co.acad_year_be                                   AS acad_year_be,
           COUNT(DISTINCT cot.kku_email)::bigint             AS teachers,
           COUNT(DISTINCT co.id)::bigint                     AS sections,
           SUM(COALESCE(co.lecture_hrs_per_week, 0)
             + COALESCE(co.lab_hrs_per_week, 0))::float      AS contact_hrs
      FROM class_offerings co
      JOIN program_courses pc
        ON pc.course_code = co.course_code AND pc.program_id = $1
      JOIN class_offering_teachers cot ON cot.class_offering_id = co.id
     WHERE co.semester = ANY($2::int[])
     GROUP BY co.acad_year_be
     ORDER BY co.acad_year_be DESC
     LIMIT 1
    `,
    programId,
    MAIN_SEMESTERS,
  );
  const row = rows[0];
  const teachers = Number(row?.teachers ?? 0);
  const hrs = row?.contact_hrs ?? 0;
  if (!row || teachers === 0 || hrs <= 0) {
    return { ...UNAVAILABLE, sourceLabel, caveat: null };
  }
  const value: StaffWorkloadValue = {
    academicYear: row.acad_year_be,
    teachers,
    sections: Number(row.sections),
    totalContactHrsPerWeek: hrs,
    avgContactHrsPerTeacher: hrs / teachers,
  };
  return {
    available: true,
    value,
    sourceLabel,
    freshness: null,
    caveat:
      'Contact hours on this programme\'s courses only; a teacher\'s other teaching is not counted here.',
  };
}

interface PedagogyPayload {
  qaSystem?: {
    framework?: string;
    continuousImprovementEvidence?: string[];
    stakeholderFeedbackLoops?: string[];
  };
  gaps?: Array<{ area: string; severity: string; observation: string; recommendation: string }>;
}

async function resolvePedagogy(
  programId: string,
  field: 'disciplineFit' | 'qaSystem' | 'gaps',
): Promise<ResolverOutput> {
  const sourceLabel = 'AI pedagogy assessment of the curriculum document (program_pedagogy_assessments)';
  const row = await prisma.programPedagogyAssessment.findUnique({ where: { programId } });
  if (!row) return { ...UNAVAILABLE, sourceLabel, caveat: null };
  const payload = (row.payloadJson ?? {}) as PedagogyPayload;
  const caveat =
    row.confidence < 0.5
      ? `The assessment rates its own confidence at ${row.confidence.toFixed(2)} — the source document was thin on teaching and QA detail.`
      : null;
  if (field === 'disciplineFit') {
    const value: PedagogyDisciplineFitValue = {
      disciplineFitScore: row.disciplineFitScore,
      overallScore: row.overallScore,
      confidence: row.confidence,
      methodVersion: row.methodVersion,
    };
    return { available: true, value, sourceLabel, freshness: row.generatedAt, caveat };
  }
  if (field === 'qaSystem') {
    const value: PedagogyQaSystemValue = {
      qaScore: row.qaScore,
      framework: payload.qaSystem?.framework ?? null,
      continuousImprovementEvidence: payload.qaSystem?.continuousImprovementEvidence ?? [],
      stakeholderFeedbackLoops: payload.qaSystem?.stakeholderFeedbackLoops ?? [],
      confidence: row.confidence,
      methodVersion: row.methodVersion,
    };
    return { available: true, value, sourceLabel, freshness: row.generatedAt, caveat };
  }
  // gaps: an assessed programme with no gaps found IS evidenced — the
  // assessment ran and reported none. That is not the same as an
  // unassessed programme, which returns unavailable above.
  const gaps = payload.gaps ?? [];
  const value: PedagogyGapsValue = {
    gaps,
    gapCount: gaps.length,
    confidence: row.confidence,
    methodVersion: row.methodVersion,
  };
  return { available: true, value, sourceLabel, freshness: row.generatedAt, caveat };
}

async function resolvePeerReview(
  programId: string,
  field: 'contentModernity' | 'contentGaps',
): Promise<ResolverOutput> {
  const sourceLabel = 'AI peer review against ranked comparator programmes (program_peer_reviews)';
  const peers = await programAiPeers(programId);
  const review = peers.review;
  if (!review) return { ...UNAVAILABLE, sourceLabel, caveat: null };
  const generatedAt = new Date(review.generatedAt);
  const freshness = Number.isNaN(generatedAt.getTime()) ? null : generatedAt;
  // v1 review rows predate both fields and carry null; they need a
  // regeneration, not an inference from the rest of the review.
  if (field === 'contentModernity') {
    if (!review.contentModernity) {
      return {
        ...UNAVAILABLE,
        sourceLabel,
        caveat: `The stored review is ${review.methodVersion}, which predates the content-modernity verdict.`,
      };
    }
    const value: PeerContentModernityValue = {
      verdict: review.contentModernity.verdict,
      narrative: review.contentModernity.narrative,
      confidence: review.confidence,
      peerCountTotal: review.peerCountTotal,
    };
    return { available: true, value, sourceLabel, freshness, caveat: null };
  }
  if (review.contentGaps === null) {
    return {
      ...UNAVAILABLE,
      sourceLabel,
      caveat: `The stored review is ${review.methodVersion}, which predates the content-gap list.`,
    };
  }
  const value: PeerContentGapsValue = {
    gaps: review.contentGaps.map((g) => ({
      topic: g.topic,
      kkuStatus: g.kkuStatus,
      peerExamples: g.peerExamples,
      severity: g.severity,
    })),
    gapCount: review.contentGaps.length,
    confidence: review.confidence,
    peerCountTotal: review.peerCountTotal,
  };
  return { available: true, value, sourceLabel, freshness, caveat: null };
}

async function resolveCohortProgression(programId: string): Promise<ResolverOutput> {
  const sourceLabel = 'Registrar cohort distribution (student_cohort_distributions)';
  const cohorts = await programStudentCohorts(programId);
  if (cohorts.cohorts.length === 0 || cohorts.totalActive === 0) {
    return { ...UNAVAILABLE, sourceLabel, caveat: COHORT_PROGRESSION_CAVEAT };
  }
  const value: CohortProgressionValue = {
    cohorts: cohorts.cohorts.map((c) => ({
      entryYearBE: c.entryYearBE,
      yearInProgramme: c.yearInProgramme,
      studentCount: c.studentCount,
      status: c.status,
    })),
    totalActive: cohorts.totalActive,
    incomingCount: cohorts.incomingCount,
    onTrackCount: cohorts.onTrackCount,
    delayedCount: cohorts.delayedCount,
    // Null, not zero, when the nominal duration was never extracted: with
    // no duration there is no line past which a cohort counts as delayed.
    delayedPct:
      cohorts.programDurationYears === null
        ? null
        : (cohorts.delayedCount / cohorts.totalActive) * 100,
    programDurationYears: cohorts.programDurationYears,
  };
  return {
    available: true,
    value,
    sourceLabel,
    freshness: cohorts.refreshedAt ? new Date(cohorts.refreshedAt) : null,
    caveat: COHORT_PROGRESSION_CAVEAT,
  };
}

// ── Dispatch ──────────────────────────────────────────────────────────

function bindingKey(binding: EvidenceBinding): string {
  if (binding.kind === 'evaluation-theme') return `evaluation-theme:${binding.theme}`;
  if (
    binding.kind === 'graduate-outcome' ||
    binding.kind === 'enrollment-metric' ||
    binding.kind === 'staff-metric' ||
    binding.kind === 'curriculum' ||
    binding.kind === 'pedagogy-assessment' ||
    binding.kind === 'peer-review'
  ) {
    return `${binding.kind}:${binding.field}`;
  }
  return binding.kind;
}

function dispatch(programId: string, binding: EvidenceBinding): Promise<ResolverOutput> {
  switch (binding.kind) {
    case 'evaluation-theme':
      return resolveEvaluationTheme(programId, binding.theme);
    case 'dq-program-score':
      return resolveDqProgramScore(programId);
    case 'dq-module-profile':
      return resolveDqModuleProfile(programId);
    case 'graduate-outcome':
      return resolveGraduateOutcome(programId, binding.field);
    case 'class-gpa-distribution':
      return resolveClassGpaDistribution(programId);
    case 'enrollment-metric':
      return resolveEnrollmentMetric(programId, binding.field);
    case 'cohort-progression':
      return resolveCohortProgression(programId);
    case 'staff-metric':
      switch (binding.field) {
        case 'studentFacultyRatio':
          return resolveStaffRatio(programId);
        case 'rankMix':
          return resolveStaffRankMix(programId);
        case 'research':
          return resolveStaffResearch(programId);
        case 'workload':
          return resolveStaffWorkload(programId);
      }
      break;
    case 'curriculum':
      switch (binding.field) {
        case 'skills':
          return resolveCurriculumSkills(programId);
        case 'courses':
          return resolveCurriculumCourses(programId);
        case 'credits':
          return resolveCurriculumCredits(programId);
      }
      break;
    case 'pedagogy-assessment':
      return resolvePedagogy(programId, binding.field);
    case 'peer-review':
      return resolvePeerReview(programId, binding.field);
  }
  // Unreachable while the registry and this switch agree; if a kind is
  // added to the registry without a resolver, it reports as unevidenced
  // rather than throwing on an accreditation page.
  return Promise.resolve({
    ...UNAVAILABLE,
    sourceLabel: 'No resolver for this binding kind',
    caveat: 'This evidence kind has no resolver yet.',
  });
}

/**
 * Resolve every binding for one programme.
 *
 * Returns one entry per input binding, in the same order, so a caller can
 * zip the results back onto its sub-criteria. Bindings repeated across
 * sub-criteria (curriculum skills appears in four) are fetched once and the
 * result shared.
 *
 * A resolver that throws is reported as unavailable, with the reason in the
 * caveat. On this surface an unreadable source and an absent source are
 * both "we cannot evidence this", and neither justifies a blank page.
 */
export async function resolveEvidenceForProgram(
  programId: string,
  bindings: EvidenceBinding[],
): Promise<ResolvedEvidence[]> {
  const byKey = new Map<string, Promise<ResolverOutput>>();
  for (const binding of bindings) {
    const key = bindingKey(binding);
    if (byKey.has(key)) continue;
    byKey.set(
      key,
      dispatch(programId, binding)
        .then(assertAvailable)
        .catch((err: unknown) => ({
          ...UNAVAILABLE,
          sourceLabel: 'Source unavailable',
          caveat: `Could not be read: ${err instanceof Error ? err.message : String(err)}`,
        })),
    );
  }
  const settled = new Map<string, ResolverOutput>();
  await Promise.all(
    [...byKey.entries()].map(async ([key, promise]) => {
      settled.set(key, await promise);
    }),
  );
  return bindings.map((binding) => {
    const out = settled.get(bindingKey(binding));
    if (!out) {
      return {
        binding,
        available: false,
        value: null,
        sourceLabel: 'Source unavailable',
        freshness: null,
        caveat: null,
      };
    }
    return { binding, ...out };
  });
}
