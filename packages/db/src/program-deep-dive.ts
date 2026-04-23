import { z } from 'zod';
import { prisma } from './index';
import { computeHealthScores, HEALTH_SCORE_VERSION, type HealthScoreRow } from './health-score';
import { queryMetricByScope } from './scope';

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
    level: 'BACHELOR' | 'MASTER' | 'DOCTORAL';
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
  totalActive: number;
  ranks: Record<string, number>;
  averageAgeYears: number | null;
  retiringWithin5Years: number;
  successionRiskPct: number;
  members: FacultyMemberSummary[];
}

export interface ProgramPeersResult {
  peers: Array<{
    id: string;
    institution: string;
    country: string;
    programName: string;
    programLevel: 'BACHELOR' | 'MASTER' | 'DOCTORAL';
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
// time. Rolled across the last 5 years to compute both current and
// trend.
export async function programDemandFunnel(programId: string) {
  const metrics = await queryMetricByScope({
    scope: 'program',
    scopeId: programId,
    family: 'enrollment',
  });
  const recent = metrics.slice(-5);
  const latest = recent.at(-1);

  const stages = latest
    ? [
        { key: 'applications', label: 'Applications', value: latest.applicationsTotal ?? 0 },
        { key: 'admitted', label: 'Admitted', value: latest.admittedTotal ?? 0 },
        { key: 'enrolled', label: 'Enrolled', value: latest.enrolledTotal ?? 0 },
        { key: 'retained_year2', label: 'Year 2 retained', value: latest.retainedYear2Total ?? 0 },
        { key: 'graduated_on_time', label: 'Graduated on time', value: latest.graduatedOnTimeTotal ?? 0 },
      ]
    : [];

  // Conversion ratio stage-to-stage.
  const conversions = [];
  for (let i = 1; i < stages.length; i++) {
    const prev = stages[i - 1]!;
    const curr = stages[i]!;
    conversions.push({
      fromKey: prev.key,
      toKey: curr.key,
      rate: prev.value > 0 ? curr.value / prev.value : null,
    });
  }

  return {
    stages,
    conversions,
    fiveYearTrend: recent.map((r) => ({
      year: r.year,
      applications: r.applicationsTotal,
      admitted: r.admittedTotal,
      enrolled: r.enrolledTotal,
      retainedYear2: r.retainedYear2Total,
      graduatedOnTime: r.graduatedOnTimeTotal,
    })),
    latestFreshness: latest?.latestFreshness ?? null,
    // Faculty / university benchmark at the same year.
    benchmarks: await benchmarkEnrolment(programId, latest?.year),
    methodologyVersion: HEALTH_SCORE_VERSION,
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

// ── Financial waterfall ────────────────────────────────────────────────
// Current year snapshot + 5-year trend. The detailed allocation split
// (tuition → direct → faculty alloc → facilities alloc → overhead →
// net) needs the cost-methodology breakout which prompt 14's real
// Finance connector populates. For v1 we show the three totals we
// actually have.
export async function programFinancials(programId: string) {
  const rows = await queryMetricByScope({
    scope: 'program',
    scopeId: programId,
    family: 'financial',
  });
  const latest = rows.at(-1);
  const trend = rows.slice(-5).map((r) => ({
    year: r.year,
    tuitionRevenue: r.tuitionRevenueTotal,
    totalCost: r.totalCostTotal,
    netContribution: r.netContributionTotal,
  }));

  // Naive waterfall stages from what we have. When prompt 14 adds the
  // allocated-faculty / allocated-facilities / overhead splits, this
  // expands without breaking callers.
  const waterfall = latest
    ? [
        { label: 'Tuition revenue', value: latest.tuitionRevenueTotal ?? 0, kind: 'positive' as const },
        { label: 'Total cost', value: -(latest.totalCostTotal ?? 0), kind: 'negative' as const },
        { label: 'Net contribution', value: latest.netContributionTotal ?? 0, kind: 'total' as const },
      ]
    : [];

  // Sensitivity: what happens if tuition rose 5%?
  const sensitivity = latest
    ? {
        tuitionPlus5Pct: {
          tuitionRevenue: (latest.tuitionRevenueTotal ?? 0) * 1.05,
          netContribution:
            (latest.tuitionRevenueTotal ?? 0) * 1.05 - (latest.totalCostTotal ?? 0),
        },
      }
    : null;

  return {
    waterfall,
    trend,
    costPerStudent: latest?.totalCostTotal && latest?.programCount
      ? latest.totalCostTotal / Math.max(1, latest.programCount)
      : null,
    sensitivity,
    costMethodologyVersion: 'cost-allocation.v1 (real split in prompt 14)',
    latestFreshness: latest?.latestFreshness ?? null,
  };
}

// ── Skills coverage ────────────────────────────────────────────────────
// Top 20 skills the program teaches vs. top 20 demanded by the labor
// market (derived from job postings linked to ProgramSkill via skill
// overlap). Match score = cosine-ish intersection over union.
export async function programSkills(programId: string) {
  // Reads from ProgramSkill which the prompt-04 extraction populates.
  // If no rows exist yet, the UI renders an empty state pointing to
  // /admin/extraction-review.
  const taught = await prisma.programSkill.findMany({
    where: { programId },
    include: { skill: true },
    orderBy: { weight: 'desc' },
    take: 20,
  });

  // Market demand — top skills across JobPostingSkill. For now treat
  // the whole KKU market uniformly; a future version filters by ISCO
  // code alignment with the program's target occupation cluster.
  const demand = await prisma.jobPostingSkill.groupBy({
    by: ['skillId'],
    _count: { skillId: true },
    orderBy: { _count: { skillId: 'desc' } },
    take: 20,
  });
  const demandIds = demand.map((d) => d.skillId);
  const demandSkills = await prisma.skill.findMany({
    where: { id: { in: demandIds } },
    select: { id: true, nameEn: true, nameTh: true, category: true },
  });
  const demandById = new Map(demandSkills.map((s) => [s.id, s]));

  const taughtIds = new Set(taught.map((t) => t.skillId));
  const demandSet = new Set(demandIds);

  const intersection = [...demandSet].filter((id) => taughtIds.has(id));
  const union = new Set([...taughtIds, ...demandSet]);
  const matchScore = union.size === 0 ? 0 : (intersection.length / union.size) * 100;

  return {
    taught: taught.map((ps) => ({
      skillId: ps.skillId,
      nameEn: ps.skill.nameEn,
      nameTh: ps.skill.nameTh,
      category: ps.skill.category,
      weight: ps.weight,
    })),
    demanded: demand.map((d) => {
      const s = demandById.get(d.skillId);
      return {
        skillId: d.skillId,
        nameEn: s?.nameEn ?? d.skillId,
        nameTh: s?.nameTh ?? '',
        category: s?.category ?? null,
        jobCount: d._count.skillId,
      };
    }),
    gaps: demand
      .filter((d) => !taughtIds.has(d.skillId))
      .slice(0, 10)
      .map((d) => {
        const s = demandById.get(d.skillId);
        return {
          skillId: d.skillId,
          nameEn: s?.nameEn ?? d.skillId,
          nameTh: s?.nameTh ?? '',
          jobCount: d._count.skillId,
        };
      }),
    surplus: taught
      .filter((t) => !demandSet.has(t.skillId))
      .slice(0, 10)
      .map((t) => ({
        skillId: t.skillId,
        nameEn: t.skill.nameEn,
        nameTh: t.skill.nameTh,
        weight: t.weight,
      })),
    matchScore,
    // Real "top 5 specific recommendations" text needs an AI call —
    // the narrative regen endpoint produces that; this method returns
    // the raw data the LLM needs.
  };
}

// ── Outcomes ──────────────────────────────────────────────────────────
export async function programOutcomes(programId: string) {
  const outcomes = await prisma.graduateOutcome.findMany({
    where: { programId },
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
  const members = await prisma.programFaculty.findMany({
    where: { programId },
    include: {
      facultyMember: {
        select: {
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
        },
      },
    },
  });

  // Aggregates every role can see.
  const ranks: Record<string, number> = {};
  const activeMembers = members
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

  return {
    visibility,
    totalActive: activeMembers.length,
    ranks,
    averageAgeYears: avgAgeYears,
    retiringWithin5Years: retiringWithin5,
    successionRiskPct:
      activeMembers.length === 0 ? 0 : (retiringWithin5 / activeMembers.length) * 100,
    // Individual list — respects role. COUNCIL sees anonymised rows
    // (employeeCode + ranks only; no names, no specialisation).
    members: members.map((m) => ({
      id: m.facultyMember.id,
      rank: m.facultyMember.rank,
      nameEn: visibility === 'full' ? m.facultyMember.nameEn : null,
      nameTh: visibility === 'full' ? m.facultyMember.nameTh : null,
      employeeCode: visibility === 'full' ? m.facultyMember.employeeCode : null,
      specialization: visibility === 'full' ? m.facultyMember.specialization : null,
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
