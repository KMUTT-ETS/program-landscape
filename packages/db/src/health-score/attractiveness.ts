import { getInstitution, intakeComplianceFor, intakeFloors } from '@kku/shared';
import type { ScopeLevel } from '../scope';
import { prisma } from '../index';
import { realDataWhere } from '../data-quality';
import { programFunnelYears, scopeFunnelLatestYear } from '../program-funnel';
import { getAcademicYearContext, entryYearComplete } from '../academic-year';
import { PUBLIC_TCAS_BASIS, PUBLIC_TCAS_ROUND3, publicTcasTotals } from '../public-tcas-basis';
import type { HealthScore } from './schema';
import { HEALTH_SCORE_TUNING } from './tuning';
import { clamp, scoreCompetitionRatio, scoreFillRate, scoreRegistrationYield } from './curves';
import { applyPartialYearDrop, linearSlope } from './series';
import { extractSubjectSignature } from './subject-signature';
import { summariseDrivers } from './summarise';
import { collectProgramIdsForScope } from './scope-tree';
import { getProgramScoreIndex, rolledUpDriver } from './program-index';

const T = HEALTH_SCORE_TUNING.attractiveness;

// ──────────────────────────────────────────────────────────────────────────
// Attractiveness — TCAS competition + fill + enrollment trend
// ──────────────────────────────────────────────────────────────────────────

export async function scoreAttractivenessProgram(programId: string): Promise<HealthScore> {
  // This installation's council policy. Null when no organisation profile
  // exists, which makes the intake driver read null rather than silently
  // judging the programme by whatever floor happened to be in the source.
  const floors = intakeFloors();

  // Latest COMPLETE year TCAS funnel — sums across rounds 1–4 + any
  // sub-rounds for the program's most recent FINISHED recruitment.
  // POWERBI.ADMISSION_STAT_CURRID gives quota / applicants / passed /
  // Clearinghouse send + confirm / registrar reg_reported.
  //
  // "Complete" = at least one round has reg_reported > 0. The current
  // recruitment year (in-progress) has reg_reported still null/0 across
  // all rounds — including it would make the registration-yield
  // driver score that program at 0% which is misleading. We score
  // against the latest completed cohort instead; the in-progress year
  // stays in the DB as informational data.
  //
  // Four drivers:
  //   - tcas_competition_ratio  (applicants / enrollSeats)
  //   - tcas_fill_rate          (totalPassed / enrollSeats)
  //   - tcas_registration_yield (regReported / sendClearinghouse)
  //   - tcas_competition_vs_peers — KKU's competition ratio vs the
  //     median ratio across other Thai universities running a
  //     comparable subject in TCAS3 (peer rows still live in
  //     TcasAdmissionStat — only KKU rows there were retired).
  //
  // Plus enrollment-trend + KKU intake-floor compliance drivers
  // (unchanged).
  const programRow = await prisma.program.findUnique({
    where: { id: programId },
    select: { level: true, nameTh: true },
  });

  // Latest COMPLETE year — a BE entry year is complete once its academic
  // year has started (the configurable academic-year boundary; see
  // packages/db/src/academic-year.ts). The in-progress current cohort stays
  // in the DB as informational data; scoring uses the latest COMPLETE year.
  // Sourced from ADMISSION_STAT via the funnel adapter (per-year totals,
  // realData-gated, canonical program_id); `isComplete` is set by
  // `programFunnelYears`, which delegates to `entryYearComplete`.
  const funnelYears = await programFunnelYears(programId);
  const latestYearOverall = funnelYears[0]?.entryYearBE ?? null;
  const latestComplete = funnelYears.find((y) => y.isComplete) ?? null;

  let funnelTotals: {
    enrollSeats: number;
    applicants: number;
    passed: number;
    sendCh: number;
    regReported: number;
    /** False when no row of the year states a Reported figure (v5.6). */
    regReportedStated: boolean;
    rounds: number;
    year: number;
    inProgressYear: number | null;
    /** Set to PUBLIC_TCAS_BASIS when seats/applicants/passed come from the
     *  public round-3 data (v5.6); absent when the campaign sheet supplied them. */
    basis?: string;
    /** Campaign basis: some other year states seats but the latest complete one does not. */
    seatsStatedInOtherYears?: boolean;
    /** Public basis only: no row states an admitted count (missing, not 0). */
    admittedNotPublished?: boolean;
  } | null = null;
  if (latestComplete !== null) {
    funnelTotals = {
      enrollSeats: latestComplete.enrollSeats,
      applicants: latestComplete.totalApplicants,
      passed: latestComplete.totalPassed,
      sendCh: latestComplete.sendClearinghouse,
      regReported: latestComplete.regReported,
      regReportedStated: latestComplete.regReportedStated,
      rounds: latestComplete.rounds,
      year: latestComplete.entryYearBE,
      inProgressYear:
        latestYearOverall !== null && latestYearOverall > latestComplete.entryYearBE
          ? latestYearOverall
          : null,
    };
    // v5.6: no planned seats in the campaign sheet -> the public TCAS round-3
    // figures for this programme and year stand in for seats / applicants /
    // passed. Campaign seats, when present, are never overridden.
    // Trigger: the programme's campaign data states no seat figure in ANY
    // year (enroll_seats and plan_per_year both absent). A programme whose
    // sheet carries seats but zero for one year keeps its campaign reading.
    const noSeatsAnywhere = funnelYears.every((y) => y.enrollSeats <= 0 && (y.planPerYear ?? 0) <= 0);
    if (funnelTotals.enrollSeats <= 0 && !noSeatsAnywhere) funnelTotals.seatsStatedInOtherYears = true;
    if (funnelTotals.enrollSeats <= 0 && noSeatsAnywhere) {
      const publicRows = await prisma.tcasAdmissionStat.findMany({
        where: {
          programId,
          entryYearBE: latestComplete.entryYearBE,
          round: { in: [...PUBLIC_TCAS_ROUND3] },
          ...realDataWhere(),
        },
        select: {
          tcasCourseCode: true,
          quota: true,
          applicants: true,
          admittedPass1: true,
          admittedPass2: true,
        },
      });
      const pub = publicTcasTotals(publicRows);
      if (pub) {
        funnelTotals = {
          ...funnelTotals,
          enrollSeats: pub.quota,
          applicants: pub.applicants,
          passed: pub.admitted,
          basis: PUBLIC_TCAS_BASIS,
          admittedNotPublished: !pub.admittedPublished,
        };
      }
    }
  }

  // v5.6: a programme with NO campaign rows at all can still be scored on the
  // public round-3 figures (the latest complete year that has any). On KKU's
  // installation the impact of this branch was not measured.
  if (funnelTotals === null && funnelYears.length === 0) {
    const ay = await getAcademicYearContext();
    const allPublic = await prisma.tcasAdmissionStat.findMany({
      where: { programId, round: { in: [...PUBLIC_TCAS_ROUND3] }, ...realDataWhere() },
      select: {
        entryYearBE: true,
        tcasCourseCode: true,
        quota: true,
        applicants: true,
        admittedPass1: true,
        admittedPass2: true,
      },
    });
    const years = [...new Set(allPublic.map((r) => r.entryYearBE))]
      .filter((y) => entryYearComplete(y, ay))
      .sort((a, b) => b - a);
    const year = years[0];
    if (year !== undefined) {
      const pub = publicTcasTotals(allPublic.filter((r) => r.entryYearBE === year));
      if (pub) {
        const newest = Math.max(...allPublic.map((r) => r.entryYearBE));
        funnelTotals = {
          enrollSeats: pub.quota,
          applicants: pub.applicants,
          passed: pub.admitted,
          sendCh: 0,
          regReported: 0,
          regReportedStated: false,
          rounds: 1,
          year,
          inProgressYear: newest > year ? newest : null,
          basis: PUBLIC_TCAS_BASIS,
          admittedNotPublished: !pub.admittedPublished,
        };
      }
    }
  }
  const peerYear = funnelTotals?.year ?? latestComplete?.entryYearBE ?? null;

  // Peer competition ratio for the latest complete year — TCAS3 peer
  // rows in TcasAdmissionStat (KKU's own rows there were retired but
  // ~25,705 peer rows remain). Match by extractSubjectSignature on
  // Program.nameTh (the new funnel doesn't carry programmeName).
  let peerMedianRatio: number | null = null;
  let peerCount = 0;
  if (peerYear !== null && programRow?.nameTh) {
    const subjectKey = extractSubjectSignature(programRow.nameTh);
    if (subjectKey.length >= 2) {
      const peerRows = await prisma.tcasAdmissionStat.findMany({
        where: {
          entryYearBE: peerYear,
          institutionName: { not: getInstitution().nameTh },
          // Same round-3 basis as the programme's own fallback figures.
          round: { in: [...PUBLIC_TCAS_ROUND3] },
          programmeName: { contains: subjectKey, mode: 'insensitive' },
          quota: { gt: 0 },
          ...realDataWhere(),
        },
        select: { quota: true, applicants: true, programmeName: true },
      });
      const peerRatios = peerRows
        .filter((p) => extractSubjectSignature(p.programmeName) === subjectKey)
        .map((p) => p.applicants / p.quota)
        .sort((a, b) => a - b);
      peerCount = peerRatios.length;
      if (peerRatios.length > 0) {
        peerMedianRatio = peerRatios[Math.floor(peerRatios.length / 2)] ?? null;
      }
    }
  }

  // Enrollment series for the trend driver.
  const enrollment = await prisma.enrollmentMetric.findMany({
    where: { programId, ...realDataWhere() },
    orderBy: { academicYear: 'asc' },
    select: { academicYear: true, enrolled: true },
  });

  const drivers = [
    {
      label: 'tcas_competition_ratio',
      value: (() => {
        if (!funnelTotals || funnelTotals.enrollSeats <= 0) return null;
        return scoreCompetitionRatio(funnelTotals.applicants / funnelTotals.enrollSeats);
      })(),
      raw: funnelTotals,
    },
    {
      label: 'tcas_fill_rate',
      value: (() => {
        if (!funnelTotals || funnelTotals.enrollSeats <= 0) return null;
        // Public basis with no admitted figures: missing, never a 0 fill.
        if (funnelTotals.admittedNotPublished) return null;
        return scoreFillRate(funnelTotals.passed / funnelTotals.enrollSeats);
      })(),
      raw: funnelTotals
        ? {
            ...(funnelTotals.admittedNotPublished ? { reason: 'admitted-not-published' } : {}),
            passed: funnelTotals.passed,
            seats: funnelTotals.enrollSeats,
            year: funnelTotals.year,
            ...(funnelTotals.seatsStatedInOtherYears ? { seatsStatedInOtherYears: true } : {}),
            ...(funnelTotals.basis ? { basis: funnelTotals.basis } : {}),
          }
        : null,
    },
    {
      label: 'tcas_registration_yield',
      value: (() => {
        // Yield = reg_reported / send_clearinghouse. Programs that lose
        // most accepted students between Clearinghouse and registration
        // are bleeding attractiveness (curve in tuning.ts).
        if (!funnelTotals || funnelTotals.sendCh <= 0) return null;
        // Confirmed stated but Reported not: missing, never a 0 yield.
        if (!funnelTotals.regReportedStated) return null;
        return scoreRegistrationYield(funnelTotals.regReported / funnelTotals.sendCh);
      })(),
      raw: funnelTotals
        ? {
            ...(funnelTotals.regReportedStated || funnelTotals.sendCh <= 0 ? {} : { reason: 'reported-not-stated' }),
            regReported: funnelTotals.regReported,
            sendCh: funnelTotals.sendCh,
          }
        : null,
    },
    {
      label: 'tcas_competition_vs_peers',
      value: (() => {
        if (!funnelTotals || funnelTotals.enrollSeats <= 0) return null;
        if (peerMedianRatio === null || peerMedianRatio <= 0) return null;
        const kkuRatio = funnelTotals.applicants / funnelTotals.enrollSeats;
        // T.peerParityScore (50) = parity with peer median; 2× → 100.
        // Peers come from TCAS3 only — sample size and methodology
        // differ from our full-funnel data, so this is comparative
        // signal not a precise apples-to-apples metric. Worth half
        // weight in summariseDrivers (which it gets automatically by
        // virtue of being one of N drivers).
        return clamp((kkuRatio / peerMedianRatio) * T.peerParityScore);
      })(),
      raw: {
        kkuRatio:
          funnelTotals && funnelTotals.enrollSeats > 0
            ? funnelTotals.applicants / funnelTotals.enrollSeats
            : null,
        peerMedianRatio,
        peerCount,
        year: peerYear,
        ...(funnelTotals?.seatsStatedInOtherYears ? { seatsStatedInOtherYears: true } : {}),
        ...(funnelTotals?.basis ? { basis: funnelTotals.basis } : {}),
      },
    },
    {
      label: 'enrollment_trend_slope',
      value: (() => {
        // Drop the most-recent year if it looks partial (cohort < 30%
        // of the prior year — same heuristic as financials).
        const series = applyPartialYearDrop(
          enrollment.map((r) => ({ year: r.academicYear, value: r.enrolled })),
        );
        if (series.length < 2) return null;
        const slope = linearSlope(series);
        // 0 = flat (50). +N students/year → 100. -N → 0.
        return clamp(50 + (slope / T.enrollmentSlopeStudentsPerYearForFull) * 50);
      })(),
      raw: { series: enrollment.map((r) => r.enrolled) },
    },
    {
      // Intake-floor policy. The floors come from this installation's
      // organisation profile, not from the source — see @kku/shared's
      // intake-policy module. Bachelor breaches are strict
      // (closure-track); postgraduate breaches are watch-list. The
      // driver's `raw.compliance` is the canonical surface for UI badges
      // and lifecycle verdicts.
      //
      // The label keeps its historic name: it is written into stored
      // assessments and named in the methodology docs, so renaming it is a
      // versioned change rather than a tidy-up.
      label: 'kku_intake_policy',
      value: (() => {
        const series = applyPartialYearDrop(
          enrollment.map((r) => ({ year: r.academicYear, value: r.enrolled })),
        );
        const latestIntake = series[series.length - 1]?.value ?? null;
        return intakeComplianceFor(programRow?.level ?? 'BACHELOR', latestIntake, floors).score;
      })(),
      raw: (() => {
        const series = applyPartialYearDrop(
          enrollment.map((r) => ({ year: r.academicYear, value: r.enrolled })),
        );
        const latestIntake = series[series.length - 1]?.value ?? null;
        const verdict = intakeComplianceFor(programRow?.level ?? 'BACHELOR', latestIntake, floors);
        return {
          level: programRow?.level ?? null,
          latestIntake,
          floor: verdict.floor,
          compliance: verdict.state,
        };
      })(),
    },
  ];
  return summariseDrivers('attractiveness', drivers);
}

export async function scoreAttractivenessScope(
  scope: ScopeLevel,
  scopeId: string,
): Promise<HealthScore> {
  // Faculty/dept/uni attractiveness — aggregate the recruitment funnel
  // across canonical+ACTIVE programs at the scope, latest COMPLETE entry
  // year only. Source: admission_campaign_stats (POWERBI.ADMISSION_STAT)
  // via the funnel adapter.
  //
  // Three drivers (equal-weighted in summariseDrivers), on the same
  // curves as the program scorer (tuning.ts):
  //   - tcas_competition_ratio = applicants / enrollSeats
  //   - tcas_fill_rate = totalPassed / enrollSeats
  //   - tcas_registration_yield = regReported / sendClearinghouse
  const totals = await scopeFunnelLatestYear(scope, scope === 'university' ? null : scopeId);
  const applicants = totals.totalApplicants;
  const seats = totals.enrollSeats;
  const passed = totals.totalPassed;
  const sendCh = totals.sendClearinghouse;
  const regReported = totals.regReported;

  const competitionRatio = seats > 0 ? applicants / seats : null;
  const fillRate = seats > 0 ? passed / seats : null;
  const yieldRate = sendCh > 0 ? regReported / sendCh : null;

  const drivers: HealthScore['drivers'] = [
    {
      label: 'tcas_competition_ratio',
      value: competitionRatio === null ? null : scoreCompetitionRatio(competitionRatio),
      raw: { applicants, seats, competitionRatio },
    },
    {
      label: 'tcas_fill_rate',
      value: fillRate === null ? null : scoreFillRate(fillRate),
      raw: { passed, seats, fillRate },
    },
    {
      label: 'tcas_registration_yield',
      value: yieldRate === null ? null : scoreRegistrationYield(yieldRate),
      raw: { regReported, sendCh, yieldRate },
    },
  ];

  // v5.0: the three per-program drivers roll up from the program scores.
  // Their calibration cannot be reused against a faculty-wide total — a
  // subject-peer percentile, a ±5 students/yr slope and a per-level
  // intake floor are all per-program quantities. Before this the scope
  // scorer kept only the three aggregate TCAS ratios, which are the HIGH
  // ones, so faculty attractiveness read +25.8 pts above its program mean.
  const programIds = await collectProgramIdsForScope(scopeId, scope);
  const index = await getProgramScoreIndex();
  drivers.push(
    rolledUpDriver(index, programIds, 'attractiveness', 'tcas_competition_vs_peers'),
    rolledUpDriver(index, programIds, 'attractiveness', 'enrollment_trend_slope'),
    rolledUpDriver(index, programIds, 'attractiveness', 'kku_intake_policy'),
  );
  return summariseDrivers('attractiveness', drivers);
}
