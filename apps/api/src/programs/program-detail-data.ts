// Builds the typed payload that drives the program-detail Gotenberg
// template. Calls every deep-dive helper in parallel, transforms each
// result into the tabular shape the template expects (every value
// pre-formatted as a string — the template renders cells, not numbers).
//
// Kept separate from the controller so the transform logic is unit-
// testable in isolation.

import {
  programAiPeers,
  programAiReadiness,
  programDecisions,
  programDemandFunnel,
  programDemographicOutlook,
  programFaculty,
  programFinancials,
  programLifecycleVerdict,
  programOutcomes,
  programOverview,
  programPeers,
  programRecruitment,
  programSkills,
  programStrategicNarrative,
  programStudentCohorts,
  programTcasStats,
  programTrends,
} from '@kku/db';
import type { ProgramDetailData } from '@kku/pdf-templates';

const LEVEL_LABEL: Record<string, string> = {
  BACHELOR: 'Bachelor',
  MASTER: 'Master',
  DOCTORAL: 'Doctoral',
  HIGHER_GRAD_DIPLOMA: 'Higher Graduate Diploma',
};

const RANK_LABELS: Record<string, string> = {
  PROF: 'Professor',
  ASSOC_PROF: 'Associate Professor',
  ASST_PROF: 'Assistant Professor',
  LECTURER: 'Lecturer',
  RESEARCHER: 'Researcher',
  ADJUNCT: 'Adjunct',
  EMERITUS: 'Emeritus',
};

const DRIVER_LABELS: Record<string, string> = {
  tcas_competition_vs_peers: 'TCAS competition vs peers',
  tcas_fill_rate: 'TCAS fill rate',
  enrollment_trend_slope: 'Enrolment trend (3-yr slope)',
  kku_intake_policy: 'KKU intake-floor policy',
  net_contribution_per_student: 'Net contribution / student',
  tuition_revenue_trend: 'Tuition revenue trend',
  cost_per_student_vs_peers: 'Cost / student vs peers',
  senior_rank_share: 'Senior-rank faculty share',
  publications_per_faculty: 'Publications per faculty (3 yr)',
  retirement_horizon_5y: '5-yr retirement headroom',
  student_faculty_ratio: 'Student / faculty ratio',
  employment_rate: 'Employment rate',
  job_relevance: 'Job relevance',
  average_salary: 'Average starting salary',
  further_study_rate: 'Further-study share',
  curriculum_modernity: 'Curriculum modernity',
  skill_resilience_vs_ai: 'Skill resilience vs AI',
  ai_research_intensity: 'AI research intensity',
  labour_market_alignment_kmitl: 'Labour-market alignment (LinkedIn · MHESI)',
};

const DRIVER_PHRASES: Record<string, string> = {
  health_overall: 'Overall health',
  enrollment_trend: 'Enrolment growth',
  tuition_trend: 'Tuition growth',
  content_modernity: 'Curriculum modernity',
  major_content_gaps: 'Major content gaps vs peers',
  demographic_resilience: 'Demographic resilience',
  delayed_graduation_share: 'Delayed-graduation share',
  capability_strength: 'Faculty capability',
  ai_readiness: 'AI readiness',
};

const SIGNAL_KIND_LABEL: Record<string, string> = {
  POLICY: 'Policy / regulation',
  RESEARCH: 'Research finding',
  MARKET: 'Labour-market signal',
  TECH: 'Technology shift',
  NEWS: 'News development',
};

// ---------------------------------------------------------------------------
// Format helpers.
// ---------------------------------------------------------------------------

function fmtNum(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPct(n: number | null | undefined, decimals = 0): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${n.toFixed(decimals)}%`;
}

function fmtRatePct(n: number | null | undefined, decimals = 0): string {
  // For 0..1 fractions.
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return `${(n * 100).toFixed(decimals)}%`;
}

function fmtDate(s: string | Date | null | undefined): string {
  if (!s) return '—';
  const d = typeof s === 'string' ? new Date(s) : s;
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().slice(0, 10);
}

function fmtDriverLabel(label: string): string {
  return DRIVER_LABELS[label] ?? label.replace(/_/g, ' ');
}

function fmtDriverPhrase(label: string): string {
  return DRIVER_PHRASES[label] ?? label.replace(/_/g, ' ');
}

// ---------------------------------------------------------------------------
// Trend recommendation logic — mirror the deep-dive client so the PDF
// emits the same advice the analyst sees on screen.
// ---------------------------------------------------------------------------

function trendRecommendation(s: {
  impactScore: number;
  isTargetedAtProgram: boolean;
  signalType: string;
}): { label: string; rationale: string } {
  const high = s.impactScore > 0.65;
  const moderate = s.impactScore > 0.35;
  const targeted = s.isTargetedAtProgram;
  const isPolicy = s.signalType === 'POLICY';
  if ((targeted && high) || (isPolicy && high)) {
    return {
      label: 'Take action',
      rationale: targeted
        ? 'Names the program directly and high impact. Bring to the next curriculum-committee meeting and decide on a curriculum amendment, admissions update, or Council-level briefing within this academic year.'
        : 'Regulatory or policy change at this impact level rarely stays sector-wide. Confirm scope; treat as an action item if the program is in scope.',
    };
  }
  if ((targeted && moderate) || (high && !targeted) || (isPolicy && moderate)) {
    return {
      label: 'Monitor',
      rationale: targeted
        ? 'Tagged as affecting this program at moderate impact. Track downstream effects; revisit explicitly at the next annual program review.'
        : isPolicy
          ? 'Policy direction worth tracking even though the program is not directly named — review again if a follow-up regulation lands.'
          : 'Sector-wide signal at high impact. Likely indirect effect — assign an analyst to flag if the wave reaches the discipline.',
    };
  }
  if (targeted) {
    return {
      label: 'Monitor',
      rationale:
        'Tagged as affecting this program but currently low impact. Keep on the watch list; no immediate response needed.',
    };
  }
  return {
    label: 'Ignore for now',
    rationale:
      'General low-impact, sector-wide signal — ambient awareness only. Safe to deprioritise unless a stronger follow-up signal arrives.',
  };
}

// ---------------------------------------------------------------------------
// Main entry point.
// ---------------------------------------------------------------------------

export async function buildProgramDetailData(
  programId: string,
  facultyVisibility: 'full' | 'aggregates-only',
): Promise<ProgramDetailData | null> {
  const overview = await programOverview(programId);
  if (!overview) return null;

  // Fan out everything else in parallel; tolerate failures so a single
  // upstream blip doesn't kill the whole report.
  const [
    lifecycle,
    strategicNarrative,
    aiReadiness,
    demandFunnel,
    studentCohorts,
    tcasStats,
    recruitment,
    demographic,
    outcomes,
    skills,
    faculty,
    financials,
    peers,
    aiPeers,
    trends,
    decisions,
  ] = await Promise.all([
    programLifecycleVerdict(programId).catch(() => null),
    programStrategicNarrative(programId).catch(() => null),
    programAiReadiness(programId).catch(() => null),
    programDemandFunnel(programId).catch(() => null),
    programStudentCohorts(programId).catch(() => null),
    programTcasStats(programId).catch(() => null),
    programRecruitment(programId).catch(() => null),
    programDemographicOutlook(programId).catch(() => null),
    programOutcomes(programId).catch(() => null),
    programSkills(programId).catch(() => null),
    programFaculty(programId, facultyVisibility).catch(() => null),
    programFinancials(programId).catch(() => null),
    programPeers(programId).catch(() => null),
    programAiPeers(programId).catch(() => null),
    programTrends(programId).catch(() => null),
    programDecisions(programId).catch(() => null),
  ]);

  const generatedAt = new Date();

  // ── Cover ─────────────────────────────────────────────────────────
  const cover = {
    programCode: overview.program.code,
    nameTh: overview.program.nameTh,
    nameEn: overview.program.nameEn,
    level: LEVEL_LABEL[overview.program.level] ?? overview.program.level,
    status: overview.program.status,
    facultyTh: overview.program.faculty.nameTh,
    facultyEn: overview.program.faculty.nameEn,
    departmentTh: overview.program.department?.nameTh ?? '',
    departmentEn: overview.program.department?.nameEn ?? '',
    yearEstablished: overview.program.yearEstablished
      ? String(overview.program.yearEstablished)
      : '',
    dateLabel: fmtDate(overview.health?.latestFreshness ?? generatedAt),
    generatedAtLabel: generatedAt.toLocaleString('en-US', {
      dateStyle: 'long',
      timeStyle: 'short',
    }),
    methodologyVersion: overview.methodologyVersion,
  };

  // ── Executive snapshot ───────────────────────────────────────────
  const executiveSnapshot: ProgramDetailData['executiveSnapshot'] = [];
  if (overview.health) {
    executiveSnapshot.push({
      metric: 'Overall health score',
      value:
        overview.health.overall.score === null
          ? '—'
          : `${Math.round(overview.health.overall.score)} / 100`,
      notes: `data ${Math.round(overview.health.overall.dataCompletenessPct)}% complete`,
    });
  }
  if (lifecycle) {
    executiveSnapshot.push({
      metric: 'Lifecycle verdict',
      value: lifecycle.verdict,
      notes: `trajectory ${Math.round(lifecycle.trajectoryScore)} / 100`,
    });
  }
  if (aiReadiness) {
    const v =
      aiReadiness.overallScore >= 70
        ? 'Strong'
        : aiReadiness.overallScore >= 45
          ? 'Partial'
          : aiReadiness.overallScore >= 20
            ? 'Low'
            : 'Critical gap';
    executiveSnapshot.push({
      metric: 'AI readiness',
      value: `${Math.round(aiReadiness.overallScore)} / 100`,
      notes: v,
    });
  }
  if (outcomes?.latest) {
    executiveSnapshot.push({
      metric: 'Latest employment rate',
      value: fmtRatePct(outcomes.latest.employmentRate, 1),
      notes: `${fmtNum(outcomes.latest.sampleSize)} graduates surveyed · ${outcomes.latest.graduationYear} cohort`,
    });
  }
  if (financials) {
    const headlineRow = financials.latestFiscalYear
      ? financials.trend.find((t) => t.year === financials.latestFiscalYear)
      : financials.trend.at(-1);
    const tuition = headlineRow?.tuitionRevenue;
    if (tuition !== null && tuition !== undefined) {
      executiveSnapshot.push({
        metric: `Tuition revenue · FY ${financials.latestFiscalYear ?? '—'}`,
        value: `${fmtNum(tuition)} THB`,
        notes:
          financials.partialCurrentYearAvailable
            ? 'partial in-progress year exists in source data'
            : '',
      });
    }
    if (financials.governmentFacultySubsidy !== null) {
      executiveSnapshot.push({
        metric: 'Government faculty subsidy',
        value: `${fmtNum(financials.governmentFacultySubsidy)} THB / yr`,
        notes: 'block-grant-funded faculty salaries (not netted from tuition)',
      });
    }
  }
  if (faculty) {
    executiveSnapshot.push({
      metric: 'Currently teaching staff',
      value: fmtNum(faculty.totalActive),
      notes: `${faculty.retiringWithin5Years} retiring within 5 years (${fmtPct(faculty.successionRiskPct, 0)})`,
    });
  }

  // ── Health dimensions + drivers ──────────────────────────────────
  const healthDimensions: ProgramDetailData['healthDimensions'] = [];
  const healthDrivers: ProgramDetailData['healthDrivers'] = [];
  if (overview.health) {
    const dimNames = [
      ['attractiveness', 'Attractiveness'],
      ['financial', 'Financial'],
      ['capability', 'Capability'],
      ['outcomes', 'Outcomes'],
      ['relevance', 'Relevance'],
    ] as const;
    for (const [key, label] of dimNames) {
      const cell = overview.health.dimensions[key];
      const top = cell.drivers
        .filter((d) => d.value !== null)
        .slice()
        .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))[0];
      healthDimensions.push({
        dimension: label,
        score: cell.score === null ? '—' : String(Math.round(cell.score)),
        dataCompleteness: `${Math.round(cell.dataCompletenessPct)}%`,
        topDriver: top
          ? `${fmtDriverLabel(top.label)} (${top.value === null ? '—' : Math.round(top.value)})`
          : '—',
      });
      for (const d of cell.drivers) {
        healthDrivers.push({
          dimension: label,
          driver: fmtDriverLabel(d.label),
          value: d.value === null ? '—' : String(Math.round(d.value)),
        });
      }
    }
  }

  // ── Lifecycle verdict ────────────────────────────────────────────
  const lifecycleData: ProgramDetailData['lifecycle'] = lifecycle
    ? {
        verdict: lifecycle.verdict,
        trajectoryScore: String(Math.round(lifecycle.trajectoryScore)),
        methodologyVersion: lifecycle.methodologyVersion,
        generatedAt: fmtDate(lifecycle.generatedAt),
        narrative: lifecycle.narrative,
        drivers: lifecycle.drivers.map((d) => ({
          direction: d.contribution >= 0 ? 'lifting' : 'drag',
          label: fmtDriverPhrase(d.label),
          contribution:
            (d.contribution > 0 ? '+' : '') + d.contribution.toFixed(1),
        })),
      }
    : null;

  // ── Strategic narrative ──────────────────────────────────────────
  const strategicNarrativeData: ProgramDetailData['strategicNarrative'] =
    strategicNarrative
      ? {
          contentMarkdown: strategicNarrative.contentMarkdown,
          methodVersion: strategicNarrative.methodVersion,
          confidencePct: `${(strategicNarrative.confidence * 100).toFixed(0)}%`,
          generatedAt: fmtDate(strategicNarrative.generatedAt),
        }
      : null;

  // ── AI readiness ─────────────────────────────────────────────────
  const aiReadinessData: ProgramDetailData['aiReadiness'] = aiReadiness
    ? (() => {
        const totalSkills =
          aiReadiness.skillBreakdown.aiNative +
          aiReadiness.skillBreakdown.aiAugmented +
          aiReadiness.skillBreakdown.aiDisplaceable +
          aiReadiness.skillBreakdown.neutral;
        const verdict =
          aiReadiness.overallScore >= 70
            ? 'Strong AI readiness'
            : aiReadiness.overallScore >= 45
              ? 'Partial AI readiness'
              : aiReadiness.overallScore >= 20
                ? 'Low AI readiness'
                : 'Critical AI gap';
        const horizonLabel = (h: 'short' | 'medium' | 'long') =>
          h === 'short' ? '< 12 months' : h === 'medium' ? '12–24 months' : '24–36 months';
        return {
          overallScore: String(Math.round(aiReadiness.overallScore)),
          verdict,
          summary: aiReadiness.summary ?? '',
          methodologyVersion: aiReadiness.methodologyVersion,
          subScores: [
            {
              metric: 'Curriculum integration',
              value:
                aiReadiness.subScores.curriculumIntegration === null
                  ? 'no data'
                  : aiReadiness.subScores.curriculumIntegration.toFixed(0),
              notes: 'AI/ML coverage in program skills',
            },
            {
              metric: 'Skill resilience',
              value:
                aiReadiness.subScores.skillResilience === null
                  ? 'no data'
                  : aiReadiness.subScores.skillResilience.toFixed(0),
              notes: 'AI-augmented vs displaceable balance',
            },
            {
              metric: 'AI research presence',
              value:
                aiReadiness.subScores.researchPresence === null
                  ? 'no data'
                  : aiReadiness.subScores.researchPresence.toFixed(0),
              notes: `${aiReadiness.aiPublicationsLast3Years}/${aiReadiness.totalPublicationsLast3Years} publications (3y)`,
            },
            {
              metric: 'Pedagogical readiness',
              value:
                aiReadiness.subScores.pedagogicalReadiness === null
                  ? 'no data'
                  : aiReadiness.subScores.pedagogicalReadiness.toFixed(0),
              notes:
                aiReadiness.subScores.pedagogicalReadiness === null
                  ? 'data not yet collected'
                  : 'how staff and students adopt AI tools',
            },
          ],
          skillBreakdown:
            totalSkills > 0
              ? [
                  {
                    category: 'AI-native',
                    count: String(aiReadiness.skillBreakdown.aiNative),
                    share: fmtPct(
                      (aiReadiness.skillBreakdown.aiNative / totalSkills) * 100,
                      0,
                    ),
                  },
                  {
                    category: 'AI-augmented',
                    count: String(aiReadiness.skillBreakdown.aiAugmented),
                    share: fmtPct(
                      (aiReadiness.skillBreakdown.aiAugmented / totalSkills) * 100,
                      0,
                    ),
                  },
                  {
                    category: 'Neutral',
                    count: String(aiReadiness.skillBreakdown.neutral),
                    share: fmtPct(
                      (aiReadiness.skillBreakdown.neutral / totalSkills) * 100,
                      0,
                    ),
                  },
                  {
                    category: 'AI-displaceable',
                    count: String(aiReadiness.skillBreakdown.aiDisplaceable),
                    share: fmtPct(
                      (aiReadiness.skillBreakdown.aiDisplaceable / totalSkills) * 100,
                      0,
                    ),
                  },
                ]
              : [],
          gaps: aiReadiness.gaps.map((g) => ({
            topic: g.topic,
            severity: g.severity,
            observation: g.observation,
            peerReference: g.peerReference ?? '',
          })),
          recommendations: aiReadiness.recommendations.map((r) => ({
            priority: r.priority,
            title: r.title,
            detail: r.detail,
            effortHorizon: horizonLabel(r.effortHorizon),
          })),
        };
      })()
    : null;

  // ── Demand funnel ────────────────────────────────────────────────
  const demandFunnelData: ProgramDetailData['demandFunnel'] = demandFunnel
    ? {
        anchorEntryYearLabel:
          demandFunnel.anchorEntryYearBE !== null
            ? `BE ${demandFunnel.anchorEntryYearBE} (CE ${demandFunnel.anchorEntryYearCE})`
            : '—',
        cohortStatus: demandFunnel.cohortCompleted
          ? 'lifecycle complete'
          : 'in-progress cohort',
        programDurationYears:
          demandFunnel.programDurationYears !== null
            ? String(demandFunnel.programDurationYears)
            : '—',
        methodologyVersion: demandFunnel.methodologyVersion,
        stages: demandFunnel.stages
          .filter((s) => s.value > 0)
          .map((s) => ({ stage: s.label, value: fmtNum(s.value) })),
        conversions: demandFunnel.conversions.map((c) => ({
          from: c.fromKey,
          to: c.toKey,
          rate: c.rate === null ? '—' : fmtRatePct(c.rate, 1),
        })),
        alumniBreakdown: demandFunnel.alumniBreakdown.map((b) => ({
          bucket: b.bucket,
          count: fmtNum(b.count),
          share: fmtRatePct(b.pct, 1),
        })),
        cohortTrend: demandFunnel.cohortTrend.slice(-8).map((c) => ({
          cohortBE: String(c.entryYearBE),
          admitted: fmtNum(c.admittedTotal),
          enrolled: fmtNum(c.enrolled),
          graduated: fmtNum(c.graduated),
          dropped: fmtNum(c.droppedTotal),
          completed: c.cohortCompleted ? 'complete' : 'in progress',
        })),
      }
    : null;

  // ── Recruitment funnel (TCAS rounds 1–4) ────────────────────────
  const recruitmentData: ProgramDetailData['recruitment'] =
    recruitment && recruitment.byYear.length > 0
      ? {
          methodologyVersion: recruitment.methodologyVersion,
          inProgressNote:
            recruitment.inProgressRounds !== null
              ? `BE ${recruitment.inProgressRounds.entryYearBE} cycle is in progress — figures partial.`
              : '',
          byYear: [...recruitment.byYear]
            .sort((a, b) => b.entryYearBE - a.entryYearBE)
            .map((y) => {
              const fillVsPlan =
                y.planPerYear !== null && y.planPerYear > 0
                  ? y.regReported / y.planPerYear
                  : null;
              return {
                yearBE: `BE ${y.entryYearBE}`,
                status: y.isComplete ? 'complete' : 'in progress',
                planPerYear:
                  y.planPerYear !== null ? fmtNum(y.planPerYear) : '—',
                seats: fmtNum(y.enrollSeats),
                overAllocation:
                  y.overAllocationFactor !== null && y.overAllocationFactor > 1.05
                    ? `${y.overAllocationFactor.toFixed(2)}×`
                    : '',
                applicants: fmtNum(y.totalApplicants),
                competition:
                  y.competitionRatio !== null
                    ? `${y.competitionRatio.toFixed(2)}×`
                    : '—',
                passed: fmtNum(y.totalPassed),
                confirmCh: fmtNum(y.confirmClearinghouse),
                reported: fmtNum(y.regReported),
                vsPlan: fillVsPlan !== null ? fmtPct(fillVsPlan * 100, 0) : '—',
              };
            }),
          latestRoundsYear:
            recruitment.latestRounds !== null
              ? `BE ${recruitment.latestRounds.entryYearBE}`
              : '',
          latestRounds:
            recruitment.latestRounds !== null
              ? recruitment.latestRounds.rounds.map((r) => ({
                  round: r.round,
                  seats: r.enrollSeats !== null ? fmtNum(r.enrollSeats) : '—',
                  applicants:
                    r.totalApplicants !== null ? fmtNum(r.totalApplicants) : '—',
                  passed:
                    r.totalPassed !== null ? fmtNum(r.totalPassed) : '—',
                  confirmCh:
                    r.confirmClearinghouse !== null
                      ? fmtNum(r.confirmClearinghouse)
                      : '—',
                  reported:
                    r.regReported !== null ? fmtNum(r.regReported) : '—',
                }))
              : [],
        }
      : null;

  // ── TCAS3 ───────────────────────────────────────────────────────
  const tcasData: ProgramDetailData['tcas'] =
    tcasStats && tcasStats.history.length > 0
      ? {
          history: [...tcasStats.history]
            .sort(
              (a, b) =>
                b.entryYearBE - a.entryYearBE || b.round.localeCompare(a.round),
            )
            .map((h) => ({
              yearRound: `BE ${h.entryYearBE} R${h.round}`,
              quota: fmtNum(h.quota),
              applicants: fmtNum(h.applicants),
              competition: `${h.competitionRatio.toFixed(2)}×`,
              fillRate: fmtRatePct(h.fillRate, 1),
              minScore: h.minScorePass1 !== null ? h.minScorePass1.toFixed(2) : '—',
              maxScore: h.maxScorePass1 !== null ? h.maxScorePass1.toFixed(2) : '—',
            })),
          peers: [...tcasStats.peers]
            .sort((a, b) => b.competitionRatio - a.competitionRatio)
            .slice(0, 25)
            .map((p) => ({
              match: p.matchTier,
              institution: p.institutionName,
              programme: p.programmeName,
              quota: fmtNum(p.quota),
              applicants: fmtNum(p.applicants),
              competition: `${p.competitionRatio.toFixed(2)}×`,
              minScore:
                p.minScorePass1 !== null ? p.minScorePass1.toFixed(2) : '—',
            })),
          peerMatchKey: tcasStats.peerMatchKey ?? '',
        }
      : null;

  // ── Cohort distribution ──────────────────────────────────────────
  const cohortDistributionData: ProgramDetailData['cohortDistribution'] =
    studentCohorts && studentCohorts.cohorts.length > 0
      ? (() => {
          const total = studentCohorts.totalActive || 1;
          const statusLabel = (s: 'incoming' | 'on-track' | 'delayed') =>
            s === 'incoming' ? 'Incoming' : s === 'delayed' ? 'Delayed' : 'On track';
          return {
            totalActive: fmtNum(studentCohorts.totalActive),
            currentAcademicYearBE: String(studentCohorts.currentAcademicYearBE),
            programDurationYears:
              studentCohorts.programDurationYears !== null
                ? String(studentCohorts.programDurationYears)
                : '—',
            summary: [
              {
                metric: 'Incoming',
                value: fmtNum(studentCohorts.incomingCount),
                notes: `${fmtPct((studentCohorts.incomingCount / total) * 100, 1)} · Year 0 (admitted before June 1)`,
              },
              {
                metric: 'On-track',
                value: fmtNum(studentCohorts.onTrackCount),
                notes: studentCohorts.programDurationYears
                  ? `${fmtPct((studentCohorts.onTrackCount / total) * 100, 1)} · Years 1–${studentCohorts.programDurationYears}`
                  : `${fmtPct((studentCohorts.onTrackCount / total) * 100, 1)}`,
              },
              {
                metric: 'Delayed',
                value: fmtNum(studentCohorts.delayedCount),
                notes: studentCohorts.programDurationYears
                  ? `${fmtPct((studentCohorts.delayedCount / total) * 100, 1)} · Year ${studentCohorts.programDurationYears + 1}+`
                  : `${fmtPct((studentCohorts.delayedCount / total) * 100, 1)}`,
              },
            ],
            rows: [...studentCohorts.cohorts]
              .sort((a, b) => b.entryYearBE - a.entryYearBE)
              .map((c) => ({
                cohort: `BE ${c.entryYearBE} (CE ${c.entryYearCE})`,
                yearInProgram:
                  c.yearInProgramme <= 0 ? 'Year 0' : `Year ${c.yearInProgramme}`,
                status: statusLabel(c.status),
                students: fmtNum(c.studentCount),
                share: fmtPct((c.studentCount / total) * 100, 1),
              })),
          };
        })()
      : null;

  // ── Demographic outlook ──────────────────────────────────────────
  const demographicData: ProgramDetailData['demographic'] = demographic
    ? {
        catchment:
          demographic.catchmentRegion === 'Northeast'
            ? 'Northeast Thailand'
            : 'Thailand',
        ageCohort: demographic.ageCohort,
        source: demographic.source,
        baselineYearOneIntake:
          demographic.baselineYearOneIntake !== null
            ? fmtNum(demographic.baselineYearOneIntake)
            : '—',
        fifteenYearContraction: `−${demographic.fifteenYearContraction.toFixed(1)}%`,
        riskLevel: demographic.riskLevel.toUpperCase(),
        projections: demographic.projections.map((p, i) => ({
          year: i === 0 ? `${p.year} (today)` : String(p.year),
          cohortPopulation: `${(p.cohortPopulation / 1_000_000).toFixed(2)}M`,
          decline: p.cohortDeclinePct > 0 ? `−${p.cohortDeclinePct.toFixed(1)}%` : '0.0%',
          shareNeeded:
            p.requiredShareOfCohort !== null
              ? `${(p.requiredShareOfCohort * 100).toFixed(3)}%`
              : '—',
        })),
      }
    : null;

  // ── Outcomes ─────────────────────────────────────────────────────
  const outcomesData: ProgramDetailData['outcomes'] =
    outcomes?.latest
      ? {
          surveyYear: String(outcomes.latest.graduationYear),
          methodologyVersion: outcomes.latest.methodologyVersion,
          freshnessDate: fmtDate(outcomes.latest.freshnessDate),
          sampleSize: fmtNum(outcomes.latest.sampleSize),
          summary: [
            {
              metric: 'Employment rate',
              value: fmtRatePct(outcomes.latest.employmentRate, 1),
              notes: '~1 year after graduation',
            },
            {
              metric: 'Average starting salary',
              value: `${fmtNum(outcomes.latest.averageSalary)} THB / month`,
              notes: 'self-reported',
            },
            {
              metric: 'Job matches field of study',
              value: fmtRatePct(outcomes.latest.jobRelevanceScore, 0),
              notes: 'graduates working in their discipline',
            },
            {
              metric: 'Further study',
              value: fmtRatePct(outcomes.latest.furtherStudyRate, 0),
              notes: 'enrolled in postgraduate study',
            },
          ],
          salaryTrajectory: outcomes.salaryTrajectory.map((p) => ({
            year: String(p.graduationYear),
            salary: fmtNum(p.averageSalary),
          })),
          topEmployers: outcomes.topEmployers.slice(0, 15).map((e) => ({
            employer: e.name,
            year: String(e.year),
            satisfaction: fmtRatePct(e.satisfactionScore, 0),
          })),
        }
      : null;

  // ── Skills ───────────────────────────────────────────────────────
  const skillsData: ProgramDetailData['skills'] = skills
    ? (() => {
        const major = skills.taught
          .filter(
            (s) => s.pickedFromPlo || (s.compulsoryWeight ?? s.weight) >= 0.5,
          )
          .slice(0, 25);
        const minor = skills.taught
          .filter(
            (s) => !s.pickedFromPlo && (s.compulsoryWeight ?? s.weight) < 0.5,
          )
          .slice(0, 25);
        return {
          matchScore: String(Math.round(skills.matchScore)),
          demandSource: skills.demandSource,
          demandTier: skills.demandTier,
          careerFilterCount: String(skills.careerFilterCount),
          totalTaught: String(skills.taught.length),
          ploCount: String(skills.ploSkillCount),
          major: major.map((s) => ({
            skill: s.nameEn || s.nameTh,
            plo: s.pickedFromPlo ? 'Yes' : '',
            compulsoryWeight:
              s.compulsoryWeight === null
                ? '—'
                : s.compulsoryWeight.toFixed(2),
            electiveWeight:
              s.electiveWeight === null ? '—' : s.electiveWeight.toFixed(2),
            evidence: s.evidenceQuote
              ? s.evidenceQuote.length > 90
                ? `"${s.evidenceQuote.slice(0, 90)}…"`
                : `"${s.evidenceQuote}"`
              : '',
          })),
          minor: minor.map((s) => ({
            skill: s.nameEn || s.nameTh,
            electiveWeight:
              s.electiveWeight === null ? '—' : s.electiveWeight.toFixed(2),
          })),
          demanded: skills.demanded.slice(0, 20).map((s) => ({
            skill: s.nameEn || s.nameTh,
            peakDemand: fmtPct(s.peakDemandPct, 0),
            careerCount: String(s.careerCount),
            match:
              s.curriculumMatched === true
                ? 'taught'
                : s.curriculumMatched === false
                  ? 'gap'
                  : '—',
          })),
          gaps: skills.gaps.slice(0, 15).map((g) => ({
            skill: g.nameEn || g.nameTh,
            peakDemand: fmtPct(g.peakDemandPct, 0),
            careerCount: String(g.careerCount),
          })),
        };
      })()
    : null;

  // ── Faculty ──────────────────────────────────────────────────────
  const facultyData: ProgramDetailData['faculty'] = faculty
    ? (() => {
        const total = faculty.totalActive || 1;
        const seniorCount =
          (faculty.ranks.PROF ?? 0) + (faculty.ranks.ASSOC_PROF ?? 0);
        const seniorPct = (seniorCount / total) * 100;
        const seniorNote =
          seniorPct >= 40
            ? 'healthy senior centre of gravity'
            : seniorPct >= 25
              ? 'mid-band — typical for a teaching-heavy department'
              : 'top-heavy junior cohort — succession plan worth reviewing';
        const rosterScopeLabel: Record<typeof faculty.rosterScope, string> = {
          program: 'program-specific roster',
          department: 'department roster',
          faculty: 'faculty roster',
        };
        return {
          rosterScope: rosterScopeLabel[faculty.rosterScope],
          visibility:
            faculty.visibility === 'aggregates-only'
              ? 'aggregates only (role-gated)'
              : 'full detail',
          kpis: [
            {
              metric: 'Currently teaching',
              value: fmtNum(faculty.totalActive),
              notes: 'active staff members',
            },
            {
              metric: 'Publications (3 yr)',
              value: fmtNum(faculty.totalPublications),
              notes: 'across teaching staff',
            },
            {
              metric: 'Average age',
              value:
                faculty.averageAgeYears === null
                  ? '—'
                  : `${faculty.averageAgeYears.toFixed(0)} years`,
              notes: 'all teaching ranks',
            },
            {
              metric: 'Retiring within 5 years',
              value: fmtPct(faculty.successionRiskPct, 0),
              notes: `${faculty.retiringWithin5Years} of ${faculty.totalActive} staff`,
            },
            {
              metric: 'Senior share (Prof + Assoc Prof)',
              value: `${seniorCount}/${faculty.totalActive} (${seniorPct.toFixed(0)}%)`,
              notes: seniorNote,
            },
          ],
          rankDistribution: Object.entries(faculty.ranks)
            .filter(([, n]) => n > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([rank, count]) => ({
              rank: RANK_LABELS[rank] ?? rank,
              count: String(count),
              share: fmtPct((count / total) * 100, 0),
            })),
          roster:
            faculty.visibility === 'full'
              ? faculty.members.slice(0, 40).map((m) => ({
                  rank: RANK_LABELS[m.rank] ?? m.rank,
                  name: m.nameEn || m.nameTh || '—',
                  specialization: m.specialization ?? '',
                  retires: m.retirementDate ? fmtDate(m.retirementDate) : '',
                }))
              : [],
        };
      })()
    : null;

  // ── Financials ───────────────────────────────────────────────────
  const financialsData: ProgramDetailData['financials'] =
    financials && financials.waterfall.length > 0
      ? (() => {
          const headlineRow = financials.latestFiscalYear
            ? financials.trend.find(
                (t) => t.year === financials.latestFiscalYear,
              )
            : financials.trend.at(-1);
          const tuition = headlineRow?.tuitionRevenue ?? 0;
          const subsidy = financials.governmentFacultySubsidy ?? 0;
          return {
            methodologyVersion: financials.costMethodologyVersion,
            headlineFiscalYear:
              financials.latestFiscalYear !== null
                ? String(financials.latestFiscalYear)
                : '—',
            partialCurrentYearNote: financials.partialCurrentYearAvailable
              ? 'a more recent partial year is in progress'
              : '',
            kpis: [
              {
                metric: `Tuition revenue · FY ${financials.latestFiscalYear ?? '—'}`,
                value: `${fmtNum(tuition)} THB`,
                notes: 'direct income from enrolled students',
              },
              {
                metric: 'Government salary subsidy',
                value: `${fmtNum(subsidy)} THB / yr`,
                notes:
                  'block-grant-funded faculty salaries — not netted from tuition (Thai public-university model)',
              },
              {
                metric: 'Government investment / student',
                value: financials.costPerStudent
                  ? `${fmtNum(Math.round(financials.costPerStudent))} THB / yr`
                  : '—',
                notes: 'subsidised salary per enrolled head',
              },
            ],
            waterfall: financials.waterfall.map((s) => ({
              step: s.label,
              kind: s.kind,
              value: `${s.kind === 'negative' ? '−' : ''}${fmtNum(Math.abs(s.value))}`,
            })),
            sensitivity: financials.sensitivity
              ? `Sensitivity — if tuition rose 5%, net contribution becomes ${fmtNum(financials.sensitivity.tuitionPlus5Pct.netContribution)} THB (revenue ${fmtNum(financials.sensitivity.tuitionPlus5Pct.tuitionRevenue)} THB).`
              : '',
            trend: financials.trend.map((t) => ({
              year: String(t.year),
              tuition: t.tuitionRevenue !== null ? fmtNum(t.tuitionRevenue) : '—',
              subsidy:
                t.facultyCostSubsidy !== null
                  ? fmtNum(t.facultyCostSubsidy)
                  : '—',
              net:
                t.netContribution !== null ? fmtNum(t.netContribution) : '—',
            })),
          };
        })()
      : null;

  // ── Peers ────────────────────────────────────────────────────────
  const peersData: ProgramDetailData['peers'] =
    aiPeers || (peers && peers.peers.length > 0)
      ? {
          subjectSignature: aiPeers?.subjectSignature ?? '',
          rankingYear: aiPeers?.rankingYear ? String(aiPeers.rankingYear) : '',
          tiers: aiPeers
            ? (
                [
                  ['World tier', aiPeers.tiers.WORLD],
                  ['Asia tier', aiPeers.tiers.ASIA],
                  ['Southeast Asia', aiPeers.tiers.SOUTHEAST_ASIA],
                  ['Thailand', aiPeers.tiers.THAILAND_PEER],
                ] as const
              ).map(([label, entries]) => ({
                tier: label,
                entries: entries.map((p) => ({
                  rank: String(p.rankInTier),
                  institution: p.institutionName,
                  country: p.country,
                  qsWorld: p.qsWorldRank !== null ? String(p.qsWorldRank) : '—',
                  programme: p.peerProgramName,
                })),
              }))
            : [],
          aiReview: aiPeers?.review
            ? {
                confidencePct: `${(aiPeers.review.confidence * 100).toFixed(0)}%`,
                strengths: aiPeers.review.strengths.map((s) => ({
                  claim: s.claim,
                })),
                weaknesses: aiPeers.review.weaknesses.map((w) => ({
                  claim: w.claim,
                })),
                contentModernity: aiPeers.review.contentModernity
                  ? {
                      verdict:
                        aiPeers.review.contentModernity.verdict.replace(
                          /_/g,
                          ' ',
                        ),
                      narrative: aiPeers.review.contentModernity.narrative,
                    }
                  : null,
                summary: aiPeers.review.subjectBenchmarkSummary ?? '',
              }
            : null,
          curatedPeers: peers
            ? peers.peers.slice(0, 15).map((p) => ({
                institution: p.institution,
                country: p.country,
                programName: p.programName,
                ranking: p.ranking !== null ? String(p.ranking) : '—',
              }))
            : [],
        }
      : null;

  // ── Trends ───────────────────────────────────────────────────────
  const trendsData: ProgramDetailData['trends'] = trends
    ? trends.signals.map((s) => {
        const rec = trendRecommendation(s);
        const impactWord =
          s.impactScore > 0.7 ? 'High' : s.impactScore > 0.4 ? 'Moderate' : 'Low';
        return {
          title: s.title,
          type: SIGNAL_KIND_LABEL[s.signalType] ?? s.signalType,
          targeted: s.isTargetedAtProgram ? 'Targets this program' : 'Sector-wide',
          impact: `${(s.impactScore * 100).toFixed(0)} (${impactWord})`,
          recommendation: rec.label,
          detected: fmtDate(s.detectedDate),
          rationale: rec.rationale,
          summary: s.summaryEn || s.summaryTh || '',
        };
      })
    : [];

  // ── Decisions ────────────────────────────────────────────────────
  const decisionsData: ProgramDetailData['decisions'] = decisions
    ? decisions.decisions.slice(0, 20).map((d) => ({
        decisionType: d.decisionType.replace(/_/g, ' '),
        status: d.status,
        decidedBy: d.decidedBy,
        createdAt: fmtDate(d.createdAt),
        effectiveDate: d.effectiveDate ? fmtDate(d.effectiveDate) : '',
        rationale: d.rationaleEn || d.rationaleTh || '',
      }))
    : [];

  return {
    ...cover,
    executiveSnapshot,
    healthDimensions,
    healthDrivers,
    healthMethodologyVersion: overview.health?.methodologyVersion ?? '',
    lifecycle: lifecycleData,
    strategicNarrative: strategicNarrativeData,
    aiReadiness: aiReadinessData,
    demandFunnel: demandFunnelData,
    recruitment: recruitmentData,
    tcas: tcasData,
    cohortDistribution: cohortDistributionData,
    demographic: demographicData,
    outcomes: outcomesData,
    skills: skillsData,
    faculty: facultyData,
    financials: financialsData,
    peers: peersData,
    trends: trendsData,
    decisions: decisionsData,
  };
}
