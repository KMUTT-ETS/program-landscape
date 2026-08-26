/**
 * AUN-QA readiness — how much of the platform's evidence a programme has,
 * criterion by criterion.
 *
 * ── WHAT A BAND DESCRIBES ─────────────────────────────────────────────
 * A `ReadinessBand` is a statement about OUR DATA, never about the
 * programme. "well-evidenced" means the platform holds evidence for most
 * of a criterion's sub-criteria; it does not mean the programme teaches
 * well, and nothing here may be read, rendered or captioned as a quality
 * judgement.
 *
 * That distinction is the whole reason this feature reports completeness
 * instead of an AUN-QA 1-7 rating. "4 of 6 sub-criteria have evidence" is
 * a claim about what we hold, and we can make it honestly. A rating is a
 * claim about the programme's quality, which the assessors award and this
 * platform cannot. If the naming or the wording ever blurs the two, the
 * feature has become the thing the spec set out not to build.
 * ──────────────────────────────────────────────────────────────────────
 *
 * Two paths, deliberately different in cost:
 *
 *   `aunqaReadinessForProgram`     — one programme, every binding fully
 *                                    resolved, values included. 130-1300 ms.
 *   `aunqaCompletenessForPrograms` — many programmes, availability only,
 *                                    no values. ~15 set-based queries for
 *                                    the whole set rather than ~25 per
 *                                    programme: measured 147 s for 301
 *                                    programmes the naive way, ~1 s this
 *                                    way. See AVAILABILITY COUPLING below.
 */

import {
  AUNQA_CRITERIA,
  type AunqaCriterion,
  type EvidenceBinding,
} from '@kku/shared';
import { prisma } from './index';
import { resolveEvidenceForProgram, type ResolvedEvidence } from './aunqa-evidence';
import {
  DQ_ELIGIBLE_LEVEL,
  DQ_MIN_CELL_STUDENTS,
  OVERALL_MEAN_MAX_MODULE_NO,
} from './student-dq';

/** Must match `MAIN_SEMESTERS` in `aunqa-evidence.ts` — the overview and
 *  the programme page would otherwise disagree about the same figure. */
const MAIN_SEMESTERS = [1, 2];

/** Must match `ENROLMENT_SERIES_YEARS` in `aunqa-evidence.ts` — the
 *  window that resolver looks for an intake in. */
const ENROLMENT_SERIES_YEARS = 5;

export type ReadinessBand = 'well-evidenced' | 'partly-evidenced' | 'no-evidence';

/** The one place the boundaries live, stated as the test pins them:
 *  `no-evidence` at zero sub-criteria evidenced; `well-evidenced` at two
 *  thirds or more; `partly-evidenced` in between. Two thirds is a
 *  judgement, not a measurement — it is here so a QA officer reading a
 *  faculty table can sequence programmes, and moving it is a one-line
 *  change plus a test edit. */
export const WELL_EVIDENCED_SHARE = 2 / 3;

/** Integer arithmetic on purpose: `4 >= 6 * (2/3)` is a float comparison
 *  that can fall the wrong side of the boundary it is meant to pin. */
export function readinessBand(
  subCriteriaTotal: number,
  subCriteriaWithEvidence: number,
): ReadinessBand {
  if (subCriteriaTotal <= 0 || subCriteriaWithEvidence <= 0) return 'no-evidence';
  return 3 * subCriteriaWithEvidence >= 2 * subCriteriaTotal
    ? 'well-evidenced'
    : 'partly-evidenced';
}

export interface SubCriterionCompleteness {
  id: string;
  title: string;
  /** True when at least ONE of the sub-criterion's bindings resolved to
   *  available. Completeness counts sub-criteria, not bindings: a
   *  sub-criterion with four bindings is not four times as evidenced. */
  hasEvidence: boolean;
}

export interface CriterionCompleteness {
  criterionId: string;
  title: string;
  subCriteriaTotal: number;
  subCriteriaWithEvidence: number;
  band: ReadinessBand;
  subCriteria: SubCriterionCompleteness[];
}

export interface SubCriterionReadiness extends SubCriterionCompleteness {
  evidence: ResolvedEvidence[];
}

export interface CriterionReadiness extends CriterionCompleteness {
  subCriteria: SubCriterionReadiness[];
  /** Every binding of the criterion, in registry order, resolved. */
  evidence: ResolvedEvidence[];
}

export interface ProgramAunqaReadiness {
  programId: string;
  criteria: CriterionReadiness[];
  subCriteriaTotal: number;
  subCriteriaWithEvidence: number;
  band: ReadinessBand;
}

export interface ProgramAunqaCompleteness {
  programId: string;
  criteria: CriterionCompleteness[];
  subCriteriaTotal: number;
  subCriteriaWithEvidence: number;
  band: ReadinessBand;
}

/** Pure: counts a criterion's completeness given a predicate over its
 *  bindings. Both paths go through this, so the full programme page and
 *  the faculty overview can never count differently. */
export function criterionCompletenessFrom(
  criterion: AunqaCriterion,
  hasEvidence: (binding: EvidenceBinding) => boolean,
): CriterionCompleteness {
  const subCriteria: SubCriterionCompleteness[] = criterion.subCriteria.map((sub) => ({
    id: sub.id,
    title: sub.title,
    hasEvidence: sub.evidence.some(hasEvidence),
  }));
  const withEvidence = subCriteria.filter((s) => s.hasEvidence).length;
  return {
    criterionId: criterion.id,
    title: criterion.title,
    subCriteriaTotal: subCriteria.length,
    subCriteriaWithEvidence: withEvidence,
    band: readinessBand(subCriteria.length, withEvidence),
    subCriteria,
  };
}

function rollUp(criteria: CriterionCompleteness[]): {
  subCriteriaTotal: number;
  subCriteriaWithEvidence: number;
  band: ReadinessBand;
} {
  const total = criteria.reduce((s, c) => s + c.subCriteriaTotal, 0);
  const withEvidence = criteria.reduce((s, c) => s + c.subCriteriaWithEvidence, 0);
  return {
    subCriteriaTotal: total,
    subCriteriaWithEvidence: withEvidence,
    band: readinessBand(total, withEvidence),
  };
}

/**
 * One programme, fully resolved: every binding's value, source, freshness
 * and caveat, plus the completeness counts.
 *
 * `resolveEvidenceForProgram` returns one entry per input binding in input
 * order, so the results zip straight back onto the sub-criteria that asked
 * for them — no key matching, no chance of a value landing under the wrong
 * sub-criterion.
 */
export async function aunqaReadinessForProgram(
  programId: string,
): Promise<ProgramAunqaReadiness> {
  const bindings = AUNQA_CRITERIA.flatMap((c) => c.subCriteria.flatMap((s) => s.evidence));
  const resolved = await resolveEvidenceForProgram(programId, bindings);

  let cursor = 0;
  const criteria: CriterionReadiness[] = AUNQA_CRITERIA.map((criterion) => {
    const subCriteria: SubCriterionReadiness[] = criterion.subCriteria.map((sub) => {
      const evidence = resolved.slice(cursor, cursor + sub.evidence.length);
      cursor += sub.evidence.length;
      return {
        id: sub.id,
        title: sub.title,
        hasEvidence: evidence.some((e) => e.available),
        evidence,
      };
    });
    const withEvidence = subCriteria.filter((s) => s.hasEvidence).length;
    return {
      criterionId: criterion.id,
      title: criterion.title,
      subCriteriaTotal: subCriteria.length,
      subCriteriaWithEvidence: withEvidence,
      band: readinessBand(subCriteria.length, withEvidence),
      subCriteria,
      evidence: subCriteria.flatMap((s) => s.evidence),
    };
  });

  return { programId, criteria, ...rollUp(criteria) };
}

// ── The overview path ─────────────────────────────────────────────────
//
// ── AVAILABILITY COUPLING ─────────────────────────────────────────────
// The queries below answer ONE question per binding — "does this
// programme have any evidence of this kind" — set-based, for every
// programme at once. Each mirrors the availability condition of the
// matching resolver in `aunqa-evidence.ts`; it must NOT drift from it,
// and a change there needs the mirror here in the same commit.
//
// A binding kind with no mirror falls through to unavailable rather than
// throwing, so adding a kind to the registry understates the overview
// until its mirror lands — never overstates it, and never breaks the
// page. The programme page, which resolves properly, is the authority
// whenever the two disagree.
//
// Why not just call the resolvers per programme: measured 487 ms per
// programme at concurrency 8, i.e. ~147 s for the university-wide
// caller's 301 programmes. Completeness needs no values, so it does not
// pay for them.
// ──────────────────────────────────────────────────────────────────────

type AvailabilityKey = string;

/** Mirrors `bindingKey` in `aunqa-evidence.ts`. Local because that one is
 *  private, and because a kind this file has no mirror for must still get
 *  a key rather than throw. */
function availabilityKey(binding: EvidenceBinding): AvailabilityKey {
  switch (binding.kind) {
    case 'evaluation-theme':
      return `evaluation-theme:${binding.theme}`;
    case 'graduate-outcome':
    case 'staff-metric':
    case 'curriculum':
    case 'pedagogy-assessment':
    case 'peer-review':
    case 'enrollment-metric':
      return `${binding.kind}:${binding.field}`;
    default:
      return binding.kind;
  }
}

interface ProgramRow {
  id: string;
  level: string;
  total_credits: number | null;
  faculty_id: string;
  department_id: string | null;
}

interface CountRow {
  id: string;
  total: bigint;
  active: bigint;
}

function num(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Availability of every binding kind, for every programme asked about.
 *
 * `$queryRawUnsafe` with positional parameters rather than `Prisma.sql`
 * fragments: these run concurrently under `Promise.all`, where a shared
 * Sql object mis-binds (`syntax error at or near "$1"`) — the trap
 * `aunqa-evidence.ts`, `dashboard-overview.ts` and `student-dq.ts` all
 * document. Only programme ids ride as parameters; the rest are module
 * constants.
 */
async function availabilityByProgram(
  programIds: string[],
): Promise<Map<string, Set<AvailabilityKey>>> {
  const available = new Map<string, Set<AvailabilityKey>>();
  for (const id of programIds) available.set(id, new Set<AvailabilityKey>());
  if (programIds.length === 0) return available;

  const mark = (programId: string, key: AvailabilityKey): void => {
    available.get(programId)?.add(key);
  };

  const [
    programs,
    skills,
    courses,
    pedagogy,
    peerReviews,
    themes,
    gpa,
    workload,
    linkedStaff,
    enrolment,
    enrolmentSeries,
    outcomes,
    cohorts,
    dq,
  ] = await Promise.all([
    prisma.$queryRawUnsafe<ProgramRow[]>(
      `SELECT id, level, total_credits, faculty_id, department_id
         FROM programs WHERE id = ANY($1::text[])`,
      programIds,
    ),
    // curriculum:skills — `programSkills().taught` is a plain read of
    // program_skills; any row means the map exists.
    prisma.$queryRawUnsafe<Array<{ program_id: string }>>(
      `SELECT DISTINCT program_id FROM program_skills WHERE program_id = ANY($1::text[])`,
      programIds,
    ),
    // curriculum:courses — `extractedCount > 0`.
    prisma.$queryRawUnsafe<Array<{ program_id: string }>>(
      `SELECT DISTINCT program_id FROM program_courses WHERE program_id = ANY($1::text[])`,
      programIds,
    ),
    // pedagogy-assessment:* — all three fields come off one row.
    prisma.$queryRawUnsafe<Array<{ program_id: string }>>(
      `SELECT DISTINCT program_id FROM program_pedagogy_assessments
        WHERE program_id = ANY($1::text[])`,
      programIds,
    ),
    // peer-review:* — v1 review rows predate both fields and carry
    // neither; jsonb_typeof returns NULL for an absent key, so an
    // unmatched type is exactly the resolver's "regenerate it" branch.
    prisma.$queryRawUnsafe<
      Array<{ program_id: string; modernity_type: string | null; gaps_type: string | null }>
    >(
      `SELECT program_id,
              jsonb_typeof(payload_json->'contentModernity') AS modernity_type,
              jsonb_typeof(payload_json->'contentGaps')      AS gaps_type
         FROM program_peer_reviews WHERE program_id = ANY($1::text[])`,
      programIds,
    ),
    // evaluation-theme:* — aggregated per (course, theme) FIRST, then
    // joined to the programme's course list. Joining the other way round
    // fans 986k evaluation rows out across every programme sharing a
    // course and takes 53 s; this way it takes under a second. Rating and
    // respondent count are both NOT NULL in the source, so a row with
    // respondents is a theme mean the resolver can compute.
    prisma.$queryRawUnsafe<Array<{ program_id: string; theme: string }>>(
      `WITH per_course AS (
         SELECT e.course_code AS course_code, q.theme_tag AS theme
           FROM evaluation_response_summaries e
           JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
           JOIN data_sources ds ON ds.id = ir.data_source_id
           JOIN evaluation_questions q ON q.id = e.question_id
          WHERE ds.mocked = false
            AND q.theme_tag IS NOT NULL
            AND e.semester = ANY($2::int[])
            AND e.respondent_count > 0
          GROUP BY 1, 2
       )
       SELECT DISTINCT pc.program_id AS program_id, c.theme AS theme
         FROM per_course c
         JOIN program_courses pc ON pc.course_code = c.course_code
        WHERE pc.program_id = ANY($1::text[])`,
      programIds,
      MAIN_SEMESTERS,
    ),
    // class-gpa-distribution — the resolver needs at least one graded
    // class on one of the programme's courses.
    prisma.$queryRawUnsafe<Array<{ program_id: string }>>(
      `SELECT DISTINCT pc.program_id AS program_id
         FROM program_courses pc
         JOIN class_offerings co ON co.course_code = pc.course_code
        WHERE pc.program_id = ANY($1::text[])
          AND co.graded_count > 0
          AND co.semester = ANY($2::int[])`,
      programIds,
      MAIN_SEMESTERS,
    ),
    // staff-metric:workload — latest academic year on record, then the
    // resolver's teachers > 0 and contact hours > 0 test on that year.
    prisma.$queryRawUnsafe<
      Array<{ program_id: string; teachers: bigint; contact_hrs: number | null }>
    >(
      `SELECT DISTINCT ON (t.program_id) t.program_id, t.teachers, t.contact_hrs
         FROM (
           SELECT pc.program_id                                    AS program_id,
                  co.acad_year_be                                  AS acad_year_be,
                  COUNT(DISTINCT cot.kku_email)::bigint            AS teachers,
                  SUM(COALESCE(co.lecture_hrs_per_week, 0)
                    + COALESCE(co.lab_hrs_per_week, 0))::float     AS contact_hrs
             FROM class_offerings co
             JOIN program_courses pc
               ON pc.course_code = co.course_code AND pc.program_id = ANY($1::text[])
             JOIN class_offering_teachers cot ON cot.class_offering_id = co.id
            WHERE co.semester = ANY($2::int[])
            GROUP BY 1, 2
         ) t
        ORDER BY t.program_id, t.acad_year_be DESC`,
      programIds,
      MAIN_SEMESTERS,
    ),
    // staff-metric:* roster, step (1) of `programFaculty`'s fallback
    // chain — the curated per-programme roster.
    prisma.$queryRawUnsafe<CountRow[]>(
      `SELECT pf.program_id AS id,
              COUNT(*)::bigint                                  AS total,
              COUNT(*) FILTER (WHERE fm.is_active)::bigint      AS active
         FROM program_faculties pf
         JOIN faculty_members fm ON fm.id = pf.faculty_member_id
        WHERE pf.program_id = ANY($1::text[])
        GROUP BY 1`,
      programIds,
    ),
    // staff-metric:studentFacultyRatio — latest enrolment, any source
    // (the resolver applies no provenance filter here).
    prisma.$queryRawUnsafe<Array<{ program_id: string; enrolled: number }>>(
      `SELECT DISTINCT ON (program_id) program_id, enrolled
         FROM enrollment_metrics
        WHERE program_id = ANY($1::text[])
        ORDER BY program_id, academic_year DESC`,
      programIds,
    ),
    // enrollment-metric:* — a year WITH AN INTAKE inside the resolver's
    // five-year window. Availability turns on the intake, never on the
    // dropout count: `dropouts = 0` against a real cohort is a
    // measurement, and reporting it as unavailable would say we hold no
    // retention data for a programme whose retention we have measured.
    prisma.$queryRawUnsafe<Array<{ program_id: string }>>(
      `SELECT DISTINCT t.program_id AS program_id
         FROM (
           SELECT program_id,
                  enrolled,
                  ROW_NUMBER() OVER (
                    PARTITION BY program_id ORDER BY academic_year DESC
                  ) AS rn
             FROM enrollment_metrics
            WHERE program_id = ANY($1::text[])
         ) t
        WHERE t.rn <= ${ENROLMENT_SERIES_YEARS} AND t.enrolled > 0`,
      programIds,
    ),
    // graduate-outcome:* — the latest real-data survey row. Every field
    // is NOT NULL in the source, so the row's existence is the test.
    prisma.$queryRawUnsafe<
      Array<{
        program_id: string;
        employment_rate: number | null;
        job_relevance_score: number | null;
        further_study_rate: number | null;
        average_salary: string | number | null;
      }>
    >(
      `SELECT DISTINCT ON (go.program_id)
              go.program_id AS program_id,
              go.employment_rate,
              go.job_relevance_score,
              go.further_study_rate,
              go.average_salary
         FROM graduate_outcomes go
         JOIN ingestion_runs ir ON ir.id = go.ingestion_run_id
         JOIN data_sources ds ON ds.id = ir.data_source_id
        WHERE go.program_id = ANY($1::text[]) AND ds.mocked = false
        ORDER BY go.program_id, go.survey_year DESC, go.graduation_year DESC`,
      programIds,
    ),
    // cohort-progression — real-data cohort rows with students on them.
    prisma.$queryRawUnsafe<Array<{ program_id: string; students: bigint }>>(
      `SELECT scd.program_id AS program_id,
              COALESCE(SUM(scd.student_count), 0)::bigint AS students
         FROM student_cohort_distributions scd
         JOIN ingestion_runs ir ON ir.id = scd.ingestion_run_id
         JOIN data_sources ds ON ds.id = ir.data_source_id
        WHERE scd.program_id = ANY($1::text[]) AND ds.mocked = false
        GROUP BY 1`,
      programIds,
    ),
    // dq-* — the undergraduate-only instrument, with its small-cell
    // floor applied exactly as `dqCompetencyByScope` applies it.
    prisma.$queryRawUnsafe<
      Array<{ program_id: string; scored: bigint; raw_mean: number | null }>
    >(
      `SELECT p.id AS program_id,
              (SELECT COALESCE(SUM(s.students_with_scores), 0)
                 FROM dq_student_cube s WHERE s.program_id = p.id)::bigint AS scored,
              (SELECT SUM(m.score_sum) / NULLIF(SUM(m.taken_count), 0)
                 FROM dq_module_cube m
                WHERE m.program_id = p.id
                  AND m.module_kind = 'THEORY'
                  AND m.module_no <= ${OVERALL_MEAN_MAX_MODULE_NO})::float AS raw_mean
         FROM programs p
        WHERE p.id = ANY($1::text[]) AND p.level = '${DQ_ELIGIBLE_LEVEL}'`,
      programIds,
    ),
  ]);

  const programById = new Map(programs.map((p) => [p.id, p]));

  for (const p of programs) {
    // curriculum:credits — the resolver refuses to sum a partial course
    // list into a programme total, so the extracted total is the test.
    if (p.total_credits !== null) mark(p.id, 'curriculum:credits');
  }
  for (const r of skills) mark(r.program_id, 'curriculum:skills');
  for (const r of courses) mark(r.program_id, 'curriculum:courses');
  for (const r of pedagogy) {
    mark(r.program_id, 'pedagogy-assessment:disciplineFit');
    mark(r.program_id, 'pedagogy-assessment:qaSystem');
    mark(r.program_id, 'pedagogy-assessment:gaps');
  }
  for (const r of peerReviews) {
    if (r.modernity_type === 'object') mark(r.program_id, 'peer-review:contentModernity');
    // An empty gap list IS a finding: the review ran and named none.
    if (r.gaps_type === 'array') mark(r.program_id, 'peer-review:contentGaps');
  }
  for (const r of themes) mark(r.program_id, `evaluation-theme:${r.theme}`);
  for (const r of gpa) mark(r.program_id, 'class-gpa-distribution');
  for (const r of workload) {
    const hrs = num(r.contact_hrs) ?? 0;
    if (Number(r.teachers) > 0 && hrs > 0) mark(r.program_id, 'staff-metric:workload');
  }

  // Roster fallback chain, mirrored from `programFaculty`: a curated
  // programme roster wins; otherwise the department's roster IF the
  // department has any members at all; otherwise the faculty's. Note the
  // resolver stops at a roster that exists but has nobody ACTIVE, which
  // is why `total` and `active` are counted separately.
  const linkedById = new Map(linkedStaff.map((r) => [r.id, r]));
  const departmentIds = [
    ...new Set(
      programs
        .map((p) => p.department_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    ),
  ];
  const facultyIds = [...new Set(programs.map((p) => p.faculty_id))];
  const [deptCounts, facultyCounts] = await Promise.all([
    departmentIds.length === 0
      ? Promise.resolve<CountRow[]>([])
      : prisma.$queryRawUnsafe<CountRow[]>(
          `SELECT department_id AS id,
                  COUNT(*)::bigint                             AS total,
                  COUNT(*) FILTER (WHERE is_active)::bigint    AS active
             FROM faculty_members
            WHERE department_id = ANY($1::text[])
            GROUP BY 1`,
          departmentIds,
        ),
    facultyIds.length === 0
      ? Promise.resolve<CountRow[]>([])
      : prisma.$queryRawUnsafe<CountRow[]>(
          `SELECT faculty_id AS id,
                  COUNT(*)::bigint                             AS total,
                  COUNT(*) FILTER (WHERE is_active)::bigint    AS active
             FROM faculty_members
            WHERE faculty_id = ANY($1::text[])
            GROUP BY 1`,
          facultyIds,
        ),
  ]);
  const deptById = new Map(deptCounts.map((r) => [r.id, r]));
  const facultyById = new Map(facultyCounts.map((r) => [r.id, r]));

  const activeStaff = new Map<string, number>();
  for (const p of programs) {
    const linked = linkedById.get(p.id);
    if (linked && Number(linked.total) > 0) {
      activeStaff.set(p.id, Number(linked.active));
      continue;
    }
    const dept = p.department_id ? deptById.get(p.department_id) : undefined;
    if (dept && Number(dept.total) > 0) {
      activeStaff.set(p.id, Number(dept.active));
      continue;
    }
    activeStaff.set(p.id, Number(facultyById.get(p.faculty_id)?.active ?? 0));
  }
  for (const [programId, active] of activeStaff) {
    if (active > 0) {
      mark(programId, 'staff-metric:rankMix');
      mark(programId, 'staff-metric:research');
    }
  }
  for (const r of enrolment) {
    if (r.enrolled !== 0 && (activeStaff.get(r.program_id) ?? 0) > 0) {
      mark(r.program_id, 'staff-metric:studentFacultyRatio');
    }
  }

  for (const r of enrolmentSeries) {
    mark(r.program_id, 'enrollment-metric:dropouts');
    mark(r.program_id, 'enrollment-metric:enrolled');
  }
  for (const r of outcomes) {
    if (num(r.employment_rate) !== null) mark(r.program_id, 'graduate-outcome:employmentRate');
    if (num(r.job_relevance_score) !== null) mark(r.program_id, 'graduate-outcome:jobRelevance');
    if (num(r.further_study_rate) !== null) mark(r.program_id, 'graduate-outcome:furtherStudy');
    if (num(r.average_salary) !== null) mark(r.program_id, 'graduate-outcome:salary');
  }
  for (const r of cohorts) {
    if (Number(r.students) > 0) mark(r.program_id, 'cohort-progression');
  }
  for (const r of dq) {
    const scored = Number(r.scored);
    if (scored < DQ_MIN_CELL_STUDENTS) continue;
    // The module profile needs only the floor and the level: its axes are
    // the framework's fixed list, so they are never empty once a
    // programme is above the floor.
    if (programById.get(r.program_id)) mark(r.program_id, 'dq-module-profile');
    if (num(r.raw_mean) !== null) mark(r.program_id, 'dq-program-score');
  }

  return available;
}

/**
 * Completeness for many programmes at once — the faculty overview.
 *
 * Returns one row per requested programme, in the order asked, including
 * programmes with no evidence at all: a dean sequencing programmes needs
 * to see the empty ones most of all.
 */
export async function aunqaCompletenessForPrograms(
  programIds: string[],
): Promise<ProgramAunqaCompleteness[]> {
  const availability = await availabilityByProgram(programIds);
  return programIds.map((programId) => {
    const keys = availability.get(programId) ?? new Set<AvailabilityKey>();
    const criteria = AUNQA_CRITERIA.map((criterion) =>
      criterionCompletenessFrom(criterion, (binding) => keys.has(availabilityKey(binding))),
    );
    return { programId, criteria, ...rollUp(criteria) };
  });
}
