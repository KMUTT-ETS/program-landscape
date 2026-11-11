import { Prisma } from '@prisma/client';
import type { SfrBand } from '@prisma/client';
import type { ScopeLevel } from '../scope';
import { prisma } from '../index';
import { realDataWhere, realDataSql } from '../data-quality';
import type { HealthScore } from './schema';
import { HEALTH_SCORE_TUNING } from './tuning';
import { clamp, scoreStudentFacultyRatio, sfrBandFor, sfrBandThresholds } from './curves';
import { noDataScore, summariseDrivers } from './summarise';
import { collectProgramIdsForScope } from './scope-tree';

const T = HEALTH_SCORE_TUNING.capability;

const isSenior = (rank: string | null): boolean => rank !== null && T.seniorRanks.includes(rank);
/** Share of active staff at a senior rank → score (T.seniorRankShareFullAt → 100). */
const seniorShareScore = (senior: number, total: number): number =>
  clamp((senior / total / T.seniorRankShareFullAt) * 100);
/** Retirement cut-off: today + T.retirementHorizonYears. */
function retirementHorizon(): Date {
  const d = new Date();
  d.setUTCFullYear(d.getUTCFullYear() + T.retirementHorizonYears);
  return d;
}

// ──────────────────────────────────────────────────────────────────────────
// Capability — senior rank + publications + retirement horizon
// ──────────────────────────────────────────────────────────────────────────

export async function scoreCapabilityProgram(programId: string): Promise<HealthScore> {
  const links = await prisma.programFaculty.findMany({
    where: { programId },
    include: {
      facultyMember: {
        select: {
          id: true,
          rank: true,
          isActive: true,
          retirementDate: true,
        },
      },
    },
  });
  const active = links.filter((l) => l.facultyMember.isActive);
  if (active.length === 0) {
    return noDataScore('capability');
  }

  // Latest-year enrolment + faculty discipline (drives the SFR band).
  // QS/THE both weight student-faculty ratio heavily — and apply
  // different thresholds by subject (clinical = strict, humanities =
  // lenient). Pull the program's faculty teaching-mode band.
  const [latestEnrollment, programRow] = await Promise.all([
    prisma.enrollmentMetric.findFirst({
      where: { programId, ...realDataWhere() },
      orderBy: { academicYear: 'desc' },
      select: { enrolled: true },
    }),
    prisma.program.findUnique({
      where: { id: programId },
      select: { faculty: { select: { sfrBand: true } } },
    }),
  ]);
  const enrolled = latestEnrollment?.enrolled ?? 0;
  const sfrBand = sfrBandFor(programRow?.faculty?.sfrBand);

  // Publications: research outputs in the last T.publicationsWindowYears years for the same
  // faculty members.
  const memberIds = active.map((l) => l.facultyMember.id);
  const currentYear = new Date().getUTCFullYear();
  const pubCount =
    memberIds.length > 0
      ? await prisma.researchOutput.count({
          where: {
            facultyMemberId: { in: memberIds },
            year: { gte: currentYear - T.publicationsWindowYears },
            ...realDataWhere(),
          },
        })
      : 0;

  const seniorCount = active.filter((l) => isSenior(l.facultyMember.rank)).length;

  const fiveYearHorizon = retirementHorizon();
  const retiringSoon = active.filter(
    (l) =>
      l.facultyMember.retirementDate !== null &&
      l.facultyMember.retirementDate <= fiveYearHorizon,
  ).length;

  const drivers = [
    {
      label: 'senior_rank_share',
      value: seniorShareScore(seniorCount, active.length),
      raw: { seniorCount, total: active.length },
    },
    {
      label: 'publications_per_faculty',
      value: (() => {
        const ratio = pubCount / active.length;
        // T.publicationsPerFacultyForFull per staff member over the window → 100.
        return clamp((ratio / T.publicationsPerFacultyForFull) * 100);
      })(),
      raw: { pubCount, faculty: active.length, windowYears: T.publicationsWindowYears },
    },
    {
      label: 'retirement_horizon_5y',
      value: clamp(100 - (retiringSoon / active.length) * 100),
      raw: { retiringSoon, total: active.length },
    },
    {
      label: 'student_faculty_ratio',
      // Discipline-aware: clinical programs scored against a stricter
      // band than humanities. Null when no enrolment data yet —
      // programs without recent EnrollmentMetric rows get a null
      // driver rather than a misleading "perfect" 100.
      value: enrolled === 0
        ? null
        : clamp(scoreStudentFacultyRatio(enrolled / active.length, sfrBand)),
      raw: {
        enrolled,
        faculty: active.length,
        ratio: enrolled === 0 ? null : enrolled / active.length,
        band: sfrBand,
        bandThresholds: sfrBandThresholds(sfrBand),
      },
    },
  ];
  return summariseDrivers('capability', drivers);
}

export async function scoreCapabilityScope(scopeId: string, scope: ScopeLevel): Promise<HealthScore> {
  // Aggregate over all programs under this scope.
  const programIds = await collectProgramIdsForScope(scopeId, scope);
  if (programIds.length === 0) return noDataScore('capability');

  // SFR band selection at scope level:
  //   faculty / department → use that faculty's discipline band
  //   university (rollup)  → use the default band (middle-of-the-road) since
  //                          the row aggregates a mix of disciplines
  let scopeBand: SfrBand = T.defaultStudentFacultyBand;
  if (scope === 'faculty' || scope === 'department') {
    const fac = await prisma.faculty.findFirst({
      where:
        scope === 'faculty'
          ? { id: scopeId }
          : { departments: { some: { id: scopeId } } },
      select: { sfrBand: true },
    });
    scopeBand = sfrBandFor(fac?.sfrBand);
  } else if (scope === 'program') {
    const p = await prisma.program.findUnique({
      where: { id: scopeId },
      select: { faculty: { select: { sfrBand: true } } },
    });
    scopeBand = sfrBandFor(p?.faculty?.sfrBand);
  }
  const links = await prisma.programFaculty.findMany({
    where: { programId: { in: programIds } },
    include: {
      facultyMember: {
        select: { id: true, rank: true, isActive: true, retirementDate: true },
      },
    },
  });
  const distinctActive = new Map<string, typeof links[number]['facultyMember']>();
  for (const l of links) {
    if (l.facultyMember.isActive) distinctActive.set(l.facultyMember.id, l.facultyMember);
  }
  const active = [...distinctActive.values()];
  if (active.length === 0) return noDataScore('capability');

  const memberIds = active.map((m) => m.id);
  const currentYear = new Date().getUTCFullYear();
  const pubCount = await prisma.researchOutput.count({
    where: { facultyMemberId: { in: memberIds }, year: { gte: currentYear - T.publicationsWindowYears }, ...realDataWhere() },
  });
  const seniorCount = active.filter((m) => isSenior(m.rank)).length;
  const fiveYearHorizon = retirementHorizon();
  const retiringSoon = active.filter(
    (m) => m.retirementDate !== null && m.retirementDate <= fiveYearHorizon,
  ).length;

  // Aggregate enrolment across all programs in scope (sum of latest year per program).
  const latestEnrolByProgram = await prisma.$queryRaw<Array<{ enrolled: bigint }>>(Prisma.sql`
    WITH latest AS (
      SELECT program_id, MAX(academic_year) as max_year
      FROM enrollment_metrics em0
      WHERE program_id = ANY(${programIds})
        AND ${realDataSql('em0')}
      GROUP BY program_id
    )
    SELECT em.enrolled::bigint as enrolled
    FROM enrollment_metrics em
    JOIN latest l ON l.program_id = em.program_id AND em.academic_year = l.max_year
    WHERE ${realDataSql('em')};
  `);
  const totalEnrolled = latestEnrolByProgram.reduce((s, r) => s + Number(r.enrolled), 0);
  const drivers = [
    { label: 'senior_rank_share', value: seniorShareScore(seniorCount, active.length), raw: { seniorCount, total: active.length } },
    { label: 'publications_per_faculty', value: clamp((pubCount / active.length / T.publicationsPerFacultyForFull) * 100), raw: { pubCount, total: active.length } },
    { label: 'retirement_horizon_5y', value: clamp(100 - (retiringSoon / active.length) * 100), raw: { retiringSoon, total: active.length } },
    {
      label: 'student_faculty_ratio',
      value: totalEnrolled === 0
        ? null
        : clamp(scoreStudentFacultyRatio(totalEnrolled / active.length, scopeBand)),
      raw: {
        enrolled: totalEnrolled,
        faculty: active.length,
        ratio: totalEnrolled === 0 ? null : totalEnrolled / active.length,
        band: scopeBand,
        bandThresholds: sfrBandThresholds(scopeBand),
      },
    },
  ];
  return summariseDrivers('capability', drivers);
}
