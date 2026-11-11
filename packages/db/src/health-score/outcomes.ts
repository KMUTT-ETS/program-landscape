import { getInstitution } from '@kku/shared';
import type { ScopeLevel } from '../scope';
import type { MetricRow } from '../scope';
import { prisma } from '../index';
import { realDataWhere } from '../data-quality';
import {
  dqCompetencyByScope,
  dqDriverScore,
  DQ_BAND_CEILING,
  DQ_BAND_FLOOR,
  DQ_BAND_PASS,
  DQ_ELIGIBLE_LEVEL,
} from '../student-dq';
import type { HealthScore } from './schema';
import { HEALTH_SCORE_TUNING } from './tuning';
import { clamp, scoreFurtherStudyRate } from './curves';
import { extractSubjectSignature } from './subject-signature';
import { summariseDrivers } from './summarise';
import { collectProgramIdsForScope } from './scope-tree';
import { getProgramScoreIndex, rolledUpDriver } from './program-index';

const T = HEALTH_SCORE_TUNING.outcomes;

// ──────────────────────────────────────────────────────────────────────────
// Outcomes — TCAS percentile + employment + salary
// ──────────────────────────────────────────────────────────────────────────

export async function scoreOutcomesProgram(programId: string, oRow: MetricRow | null): Promise<HealthScore> {
  // TCAS min-score percentile: KKU's min score's percentile among
  // peer programs in the same subject + (year, round).
  const kkuTcas = await prisma.tcasAdmissionStat.findFirst({
    where: { programId, minScorePass1: { not: null }, ...realDataWhere() },
    orderBy: [{ entryYearBE: 'desc' }, { round: 'desc' }],
  });
  let percentile: number | null = null;
  if (kkuTcas && kkuTcas.minScorePass1 !== null) {
    // The programme's own TCAS name is whatever the institution typed
    // ("... สาขาวิชาวิศวกรรมเครื่องกล ปริญญาตรี 4 ปี"), and its signature can
    // swallow trailing words that peers' names do not have. When that key
    // finds too few peers, retry with the signature of the programme's own
    // Thai name, as the competition-vs-peers driver does.
    const ownName = await prisma.program.findUnique({ where: { id: programId }, select: { nameTh: true } });
    const subjectKeys = [
      ...new Set(
        [extractSubjectSignature(kkuTcas.programmeName), ownName?.nameTh ? extractSubjectSignature(ownName.nameTh) : '']
          .filter((k) => k.length >= 2),
      ),
    ];
    for (const subjectKey of subjectKeys) {
      const peers = await prisma.tcasAdmissionStat.findMany({
        where: {
          entryYearBE: kkuTcas.entryYearBE,
          round: kkuTcas.round,
          minScorePass1: { not: null },
          institutionName: { not: getInstitution().nameTh },
          programmeName: { contains: subjectKey, mode: 'insensitive' },
          ...realDataWhere(),
        },
        select: { minScorePass1: true, programmeName: true },
      });
      const peerScores = peers
        .filter((p) => extractSubjectSignature(p.programmeName) === subjectKey)
        .map((p) => p.minScorePass1!)
        .filter((v): v is number => v !== null);
      if (peerScores.length >= T.tcasPercentileMinPeers) {
        const below = peerScores.filter((s) => s < kkuTcas.minScorePass1!).length;
        percentile = (below / peerScores.length) * 100;
        break;
      }
    }
  }

  // Pull the latest GraduateOutcome row directly. The annual KKU
  // graduate-employment survey (real data, ingested via
  // `pnpm outcomes:ingest`) is the canonical source; fall back to the
  // MV-aggregate `oRow` when no GraduateOutcome row exists yet for
  // this program (postgrad programs aren't surveyed; older cohorts
  // may not yet be ingested).
  const grad = await prisma.graduateOutcome.findFirst({
    where: { programId, ...realDataWhere() },
    orderBy: [{ surveyYear: 'desc' }, { graduationYear: 'desc' }],
  });

  const drivers: HealthScore['drivers'] = [
    {
      label: 'tcas_min_score_percentile',
      value: percentile !== null ? clamp(percentile) : null,
      raw: { kkuMin: kkuTcas?.minScorePass1, percentile },
    },
    {
      label: 'employment_rate',
      // GraduateOutcome.employmentRate is 0..1; convert to 0..100.
      // Fall back to MV when no survey row exists.
      value: grad
        ? clamp(grad.employmentRate * 100)
        : oRow?.employmentRateWeighted != null
          ? clamp(oRow.employmentRateWeighted * 100)
          : null,
      raw: grad
        ? {
            employmentRate: grad.employmentRate,
            surveyYear: grad.surveyYear,
            graduationYear: grad.graduationYear,
            sampleSize: grad.sampleSize,
            method: grad.methodologyVersion,
          }
        : oRow?.employmentRateWeighted,
    },
    {
      label: 'job_relevance',
      // Share of graduates whose job is "ตรงสาขา" (matches discipline).
      // 0..1 → 0..100. Null when not surveyed (postgrad) or when the
      // report didn't break this out per program.
      value: grad && grad.jobRelevanceScore > 0
        ? clamp(grad.jobRelevanceScore * 100)
        : null,
      raw: grad
        ? { jobRelevanceScore: grad.jobRelevanceScore, surveyYear: grad.surveyYear }
        : null,
    },
    {
      label: 'average_salary',
      // Linear between T.averageSalary.zeroAtThb (฿15,000, the legal floor)
      // → 0 and T.averageSalary.fullAtThb (฿35,000, premium / high-skill
      // clinical / engineering) → 100.
      value: (() => {
        const salary = grad ? Number(grad.averageSalary) : oRow?.averageSalaryWeighted ?? null;
        if (!salary || salary <= 0) return null;
        const { zeroAtThb, fullAtThb } = T.averageSalary;
        return clamp((salary - zeroAtThb) / ((fullAtThb - zeroAtThb) / 100));
      })(),
      raw: grad
        ? { averageSalary: Number(grad.averageSalary), surveyYear: grad.surveyYear }
        : oRow?.averageSalaryWeighted,
    },
    {
      label: 'further_study_rate',
      // Share continuing to graduate school. Mid-band is the sweet
      // spot — too low signals weak academic pipeline; too high
      // suggests under-employment masquerading as further study.
      // 0..0.05 → 50 (low), 0.05..0.15 → 100 (sweet spot), 0.15..0.30
      // → 70, 0.30+ → 30.
      value: grad
        ? clamp(scoreFurtherStudyRate(grad.furtherStudyRate))
        : null,
      raw: grad
        ? { furtherStudyRate: grad.furtherStudyRate, surveyYear: grad.surveyYear }
        : null,
    },
    // v3.7: student-satisfaction driver — POWERBI.EVALUATE_INSTRUCTOR
    // weighted mean rating, normalised to the [3.5, 5.0] band.
    await studentSatisfactionDriver({ scope: 'program', scopeId: programId }),
  ];

  // v4.0: DQ digital competency. Returns null — meaning "omit", not
  // "no data" — for non-bachelor programs, which keep the six drivers
  // above and their completeness with them. See `dqCompetencyDriver`.
  const dq = await dqCompetencyDriver({ scope: 'program', scopeId: programId });
  if (dq) drivers.push(dq);

  // Omitted, not null: from v5.0 summariseDrivers pads any canonical
  // driver a scorer did not build, so without this the non-bachelor
  // omission above would come back as a missing driver and dock
  // completeness for an instrument that cannot apply.
  return summariseDrivers('outcomes', drivers, dq ? [] : ['dq_digital_competency']);
}

export async function scoreOutcomesScope(
  scope: ScopeLevel,
  scopeId: string,
  row: MetricRow | null,
): Promise<HealthScore> {
  const drivers: HealthScore['drivers'] = [
    {
      label: 'employment_rate',
      value: row?.employmentRateWeighted !== null && row?.employmentRateWeighted !== undefined
        ? clamp(row.employmentRateWeighted * 100)
        : null,
      raw: row?.employmentRateWeighted,
    },
    {
      label: 'average_salary',
      value: row?.averageSalaryWeighted ? clamp((row.averageSalaryWeighted / T.averageSalaryScopeFullAtThb) * 100) : null,
      raw: row?.averageSalaryWeighted,
    },
    await studentSatisfactionDriver({ scope, scopeId }),
  ];

  // v4.0 — the mean is computed from the cube AT THIS SCOPE, never by
  // averaging program scores. Faculty / department / university always
  // carry the driver (they contain bachelor programs); the omission
  // branch only fires if this is ever called at program scope.
  const dq = await dqCompetencyDriver({ scope, scopeId });
  if (dq) drivers.push(dq);

  // v5.0: neither job relevance nor further study has an aggregate column
  // in the materialised view, and the TCAS min-score percentile is a
  // per-program peer-subject comparison. All three were simply absent at
  // scope while the dimension still reported 100% complete, leaving
  // faculty outcomes +9.3 pts above its program mean.
  const programIds = await collectProgramIdsForScope(scopeId, scope);
  const index = await getProgramScoreIndex();
  drivers.push(
    rolledUpDriver(index, programIds, 'outcomes', 'job_relevance'),
    rolledUpDriver(index, programIds, 'outcomes', 'further_study_rate'),
    rolledUpDriver(index, programIds, 'outcomes', 'tcas_min_score_percentile'),
  );

  return summariseDrivers('outcomes', drivers, dq ? [] : ['dq_digital_competency']);
}

// ── student_satisfaction driver (added v3.7) ─────────────────────────
//
// Aggregates the program's (or scope's) courses' weighted-mean rating
// from POWERBI.EVALUATE_INSTRUCTOR via evaluation_response_summaries.
// Normalised 3.5→0..5.0→100 on the 1-5 likert scale (anchored linear),
// which captures the ceiling-biased distribution (87% ≥ 4.0 per
// docs/methodologies/evaluations.md §"Score scale"). Below 3.5
// saturates at 0; above 5.0 is impossible. Null when no surveyed
// cells exist for this scope in window — caller treats null as a
// data gap (driver excluded from the dimension average, completeness
// drops), NOT as a zero penalty.
//
// Scope:
//   - program → join through program_courses where program_id = scopeId
//   - faculty → join through program_courses → programs where program.faculty_id = scopeId
//   - department → similar, programs.department_id = scopeId
//   - university → no scope filter (Σ across all programs)
//
// The same cell can be attributed to multiple programs (general-ed
// courses) — at faculty/dept/uni rollups this is the correct posture
// (the cell SHOULD count once per program that teaches it). The
// double-count is benign for the weighted mean since both copies
// carry the same rating + respondent count.
async function studentSatisfactionDriver(args: {
  scope: ScopeLevel;
  scopeId: string;
  // Program-scope shortcut — when caller already has the programId,
  // skip the program→faculty rollup. Same WHERE clause is built either
  // way; this is purely for readability at call sites.
  programId?: string;
}): Promise<HealthScore['drivers'][number]> {
  // $queryRawUnsafe + plain SQL + positional params — same pattern as
  // dashboard-overview.ts. Calling this with a Prisma.Sql fragment
  // (Prisma.sql`...`) under concurrent Promise.all execution
  // intermittently produces `syntax error at or near "$1"` because
  // Prisma's Sql-object instanceof check fails across async contexts
  // and the parameter mis-binds. Plain string + positional params
  // bypasses the Sql-object machinery entirely.
  let scopeSql: string;
  const scopeParams: unknown[] = [];
  if (args.scope === 'program') {
    scopeSql = 'AND pc.program_id = $1';
    scopeParams.push(args.scopeId);
  } else if (args.scope === 'faculty') {
    scopeSql = 'AND p.faculty_id = $1';
    scopeParams.push(args.scopeId);
  } else if (args.scope === 'department') {
    scopeSql = 'AND p.department_id = $1';
    scopeParams.push(args.scopeId);
  } else {
    // university — no scope filter (Σ across all programs).
    scopeSql = '';
  }
  const rows = await prisma.$queryRawUnsafe<
    Array<{
      rating: number | null;
      n: bigint;
      cells: bigint;
      courses: bigint;
      years: bigint;
    }>
  >(
    `
    SELECT
      (SUM(e.rating_avg::numeric * e.respondent_count) / NULLIF(SUM(e.respondent_count), 0))::float AS rating,
      COALESCE(SUM(e.respondent_count), 0)::bigint                                                  AS n,
      COUNT(*)::bigint                                                                              AS cells,
      COUNT(DISTINCT e.course_code)::bigint                                                         AS courses,
      COUNT(DISTINCT e.acad_year_be)::bigint                                                        AS years
    FROM evaluation_response_summaries e
    JOIN ingestion_runs ir ON ir.id = e.ingestion_run_id
    JOIN data_sources ds ON ds.id = ir.data_source_id
    JOIN program_courses pc ON pc.course_code = e.course_code
    JOIN programs p ON p.id = pc.program_id
    WHERE ds.mocked = false
      AND e.semester IN (1, 2)
      ${scopeSql}
    `,
    ...scopeParams,
  );
  const r = rows[0];
  if (!r || r.rating === null || Number(r.cells) === 0) {
    return { label: 'student_satisfaction', value: null, raw: null };
  }
  const rating = Number(r.rating);
  // Anchored linear: 3.5 → 0, 5.0 → 100. Below 3.5 saturates at 0.
  // Spreads the [3.5, 5.0] band — where 95%+ of real ratings sit —
  // across the full 0..100 health-score range so programs actually
  // differentiate. A naive [1, 5] → [0, 100] would compress every
  // program into the 75-100 band given KKU's ceiling-biased data.
  const { zeroAtRating, fullAtRating } = T.studentSatisfaction;
  const value = clamp(((rating - zeroAtRating) / (fullAtRating - zeroAtRating)) * 100);
  return {
    label: 'student_satisfaction',
    value,
    raw: {
      ratingAvg: rating,
      respondentCount: Number(r.n),
      cellCount: Number(r.cells),
      coursesObserved: Number(r.courses),
      yearsObserved: Number(r.years),
      normalisation: `${zeroAtRating.toFixed(1)} → 0, ${fullAtRating.toFixed(1)} → 100 (anchored linear)`,
      source: 'course-evaluations.v1',
    },
  };
}

// ── dq_digital_competency driver (added v4.0) ────────────────────────
//
// KKU's Digital Intelligence test is a competency every undergraduate
// sits, so how a program's students score is evidence of what that
// program develops in them. The driver is the respondent-weighted mean
// over theory modules 1-12, banded on KKU's own pass mark:
// ≤50 → 0 · 70 → 50 · ≥90 → 100.
//
// Everything that decides the number lives in `student-dq.ts`, beside
// the cubes and the dashboard that share the same rules:
//   - `dqCompetencyByScope` computes SUM/SUM AT THE SCOPE ASKED FOR,
//     never a mean of program means (the cube exists for that reason:
//     the mean-of-means error is 0.8 points on module 1 at university
//     scope), excludes module 13 (uptake 48.7%-96.7% by faculty, so it
//     would score the rollout rather than the students), restricts to
//     `level = 'BACHELOR'`, and applies the ≥5 scored-student floor;
//   - `dqDriverScore` applies the band.
// It carries the same `$queryRawUnsafe` discipline as
// `studentSatisfactionDriver` above, for the same reason — this is one
// of the concurrent call sites that provoked the `$1` mis-binding.
//
// Two different absences, deliberately handled differently — this is
// the difference between "we don't know" and "the question doesn't
// apply", and `dataCompletenessPct` is Council-facing (the cockpit
// bands it at 75/50, the deep-dive header prints it, verdict snapshots
// store it):
//
//   * A NON-BACHELOR program returns null from here and the driver is
//     OMITTED from the array entirely. DQ is an undergraduate
//     instrument; a doctoral program is not *missing* a DQ score, DQ
//     does not apply to it. Appending a null would put a driver that
//     can never apply into its denominator and report it as having
//     less complete data than before purely because an undergraduate
//     instrument exists (measured: 2.4-14.3 points of false loss across
//     all 199). Same distinction the deep-dive section draws between
//     `not-applicable` and `no-data`.
//   * A BACHELOR program with no DQ rows, or under the 5-student
//     floor, gets the driver with a NULL value. There the evidence is
//     genuinely missing, and it SHOULD count against completeness.
//     Never 0 either way: a program with no DQ evidence has not scored
//     zero. `summariseDrivers` excludes nulls from the dimension mean.
//
// Faculty / department / university scopes always carry the driver:
// they legitimately contain bachelor programs, and the cube's own join
// applies the level gate inside the aggregate.
async function dqCompetencyDriver(args: {
  scope: ScopeLevel;
  scopeId: string;
}): Promise<HealthScore['drivers'][number] | null> {
  if (args.scope === 'program') {
    const program = await prisma.program.findUnique({
      where: { id: args.scopeId },
      select: { level: true },
    });
    // Only a POSITIVELY known ineligible level omits the driver. An
    // unknown program keeps it (null-valued) rather than silently
    // shrinking its denominator on a lookup miss.
    if (program && program.level !== DQ_ELIGIBLE_LEVEL) return null;
  }
  const dq = await dqCompetencyByScope({ scope: args.scope, scopeId: args.scopeId });
  return {
    label: 'dq_digital_competency',
    value: dqDriverScore(dq.rawMean),
    // `raw` carries the evidence, `scoredStudents` above all: the
    // 5-student floor is low by decision, so every surface that renders
    // this score must be able to show how thin it is.
    raw:
      dq.rawMean === null
        ? null
        : {
            rawMean: dq.rawMean,
            scoredStudents: dq.scoredStudents,
            programCount: dq.programCount,
            // Both of these reach Council through the provenance
            // drawer, so both are built from the SAME constants
            // `dqDriverScore` applies — never restated as literals
            // here, which would be a second source for the band.
            passMark: DQ_BAND_PASS,
            band:
              `≤${DQ_BAND_FLOOR} → 0, ${DQ_BAND_PASS} → 50, ` +
              `≥${DQ_BAND_CEILING} → 100 (anchored on the pass mark)`,
            modulesCounted: 'theory 1-12 (module 13 excluded — uneven rollout)',
            source: 'student-dq.v1',
          },
  };
}
