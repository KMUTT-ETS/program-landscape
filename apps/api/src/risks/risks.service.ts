import { Injectable, NotFoundException } from '@nestjs/common';
import { realDataSql, realDataWhere } from '@kku/db';
import {
  prisma,
  RISK_INDICATOR_CATALOG,
  RISK_SCORING_VERSION,
  Prisma,
  isInProgressBE,
  loadProgramRiskInputs,
  scoreL2AiDisruption,
  getUniversityAverages,
  type UniversityAverages,
  type KkuRiskLevel,
  type RiskTier,
  type ProgramLevel,
  type PortfolioRiskRow,
} from '@kku/db';
import { listPortfolioRisk } from '@kku/db';

/**
 * Risk module read-side service.
 *
 * Writes (running the AI assessment, persisting RiskAssessment +
 * RiskMeasure rows) live in the ingestion pipeline (`pnpm risks:assess`)
 * because they require the AI provider keys + AI quota tracking that the
 * worker has wired up. This service only reads.
 *
 * Exception: measure status transitions (PROPOSED → ACCEPTED / REJECTED /
 * IN_PROGRESS / COMPLETED) live here because they're cheap mutations
 * triggered from the UI.
 */
@Injectable()
export class RisksService {
  // ── Portfolio heatmap / matrix ────────────────────────────────────────

  async portfolio(opts: {
    level?: ProgramLevel;
    facultyId?: string;
    /** Multi-scope: UNION of programs in any of these faculties. */
    facultyIds?: string[];
    /** PROGRAM_USER scope clamp — narrows to a single program. */
    programId?: string;
    /** Multi-scope: UNION of these specific programs. */
    programIds?: string[];
    tier?: RiskTier;
  }): Promise<{
    rows: PortfolioRiskRow[];
    summary: {
      total: number;
      byTier: Record<RiskTier, number>;
      byKkuLevel: Record<KkuRiskLevel, number>;
      // 5×5 cell counts indexed [likelihood-1][impact-1]; row 0 = L1, row 4 = L5.
      kkuMatrixCells: number[][];
      totalRevenueAtRiskThb: number;
      totalStrandedCostThb: number;
      programsWithoutAssessment: number;
    };
    universityAverages: UniversityAverages;
    methodologyVersion: string;
  }> {
    const rows = await listPortfolioRisk(opts);

    const byTier: Record<RiskTier, number> = {
      NEEDS_DATA: 0,
      LOW: 0,
      MODERATE: 0,
      HIGH: 0,
      CRITICAL: 0,
    };
    const byKkuLevel: Record<KkuRiskLevel, number> = {
      NEEDS_DATA: 0,
      LOW: 0,
      MODERATE: 0,
      HIGH: 0,
      VERY_HIGH: 0,
    };
    const kkuMatrixCells = Array.from({ length: 5 }, () => Array(5).fill(0) as number[]);
    let totalRevenueAtRiskThb = 0;
    let totalStrandedCostThb = 0;
    for (const r of rows) {
      byTier[r.tier] += 1;
      byKkuLevel[r.kkuRiskLevel] += 1;
      if (r.likelihoodBin != null && r.impactBin != null) {
        kkuMatrixCells[r.likelihoodBin - 1]![r.impactBin - 1] = (kkuMatrixCells[r.likelihoodBin - 1]![r.impactBin - 1] ?? 0) + 1;
      }
      totalRevenueAtRiskThb += r.directRevenueAtRiskThb ?? 0;
      totalStrandedCostThb += r.strandedCostThb ?? 0;
    }

    // Total-programs count respects the same scope union as the rows.
    const facultyIdSet = [
      ...(opts.facultyId ? [opts.facultyId] : []),
      ...(opts.facultyIds ?? []),
    ];
    const programIdSet = [
      ...(opts.programId ? [opts.programId] : []),
      ...(opts.programIds ?? []),
    ];
    const totalPrograms = await prisma.program.count({
      where: {
        level: opts.level ?? 'BACHELOR',
        status: 'ACTIVE',
        ...(facultyIdSet.length > 0 || programIdSet.length > 0
          ? {
              OR: [
                ...(facultyIdSet.length > 0 ? [{ facultyId: { in: facultyIdSet } }] : []),
                ...(programIdSet.length > 0 ? [{ id: { in: programIdSet } }] : []),
              ],
            }
          : {}),
      },
    });

    const universityAverages = await getUniversityAverages(opts.level ?? 'BACHELOR');

    return {
      rows,
      summary: {
        total: rows.length,
        byTier,
        byKkuLevel,
        kkuMatrixCells,
        totalRevenueAtRiskThb,
        totalStrandedCostThb,
        programsWithoutAssessment: Math.max(0, totalPrograms - rows.length),
      },
      universityAverages,
      methodologyVersion: RISK_SCORING_VERSION,
    };
  }

  // ── Indicator catalog + recent breaches ──────────────────────────────

  async listIndicators(): Promise<{
    indicators: Array<{
      slug: string;
      labelTh: string;
      labelEn: string;
      descriptionTh: string;
      descriptionEn: string;
      formula: string;
      warnThreshold: number;
      criticalThreshold: number;
      alarmDirection: string;
      methodologyVersion: string;
      latestBreaches: {
        critical: number;
        warn: number;
        ok: number;
        total: number;
      };
    }>;
    methodologyVersion: string;
  }> {
    const dbIndicators = await prisma.riskIndicator.findMany({
      orderBy: { slug: 'asc' },
    });

    // Per-indicator latest breach counts at portfolio level (one row per
    // program × indicator — most recent observation).
    const latestPerProgram = await prisma.$queryRaw<
      Array<{ indicator_slug: string; severity: 'OK' | 'WARN' | 'CRITICAL' }>
    >(Prisma.sql`
      SELECT DISTINCT ON (program_id, indicator_slug)
        indicator_slug, severity
      FROM risk_indicator_breaches b
      JOIN programs p ON p.id = b.program_id
      WHERE p.status = 'ACTIVE'
      ORDER BY program_id, indicator_slug, observed_at DESC
    `);

    const counts = new Map<string, { critical: number; warn: number; ok: number; total: number }>();
    for (const ind of dbIndicators) {
      counts.set(ind.slug, { critical: 0, warn: 0, ok: 0, total: 0 });
    }
    for (const r of latestPerProgram) {
      const c = counts.get(r.indicator_slug);
      if (!c) continue;
      c.total += 1;
      if (r.severity === 'CRITICAL') c.critical += 1;
      else if (r.severity === 'WARN') c.warn += 1;
      else c.ok += 1;
    }

    return {
      indicators: dbIndicators.map((i) => ({
        slug: i.slug,
        labelTh: i.labelTh,
        labelEn: i.labelEn,
        descriptionTh: i.descriptionTh,
        descriptionEn: i.descriptionEn,
        formula: i.formula,
        warnThreshold: i.warnThreshold,
        criticalThreshold: i.criticalThreshold,
        alarmDirection: i.alarmDirection,
        methodologyVersion: i.methodologyVersion,
        latestBreaches: counts.get(i.slug) ?? { critical: 0, warn: 0, ok: 0, total: 0 },
      })),
      methodologyVersion: RISK_SCORING_VERSION,
    };
  }

  async indicatorBreaches(
    slug: string,
    opts: {
      facultyId?: string;
      facultyIds?: string[];
      programId?: string;
      programIds?: string[];
    } = {},
    limit = 200,
  ): Promise<{
    indicator: {
      slug: string;
      labelTh: string;
      labelEn: string;
      descriptionTh: string;
      descriptionEn: string;
      formula: string;
      warnThreshold: number;
      criticalThreshold: number;
      alarmDirection: string;
    };
    severityCounts: { critical: number; warn: number; ok: number; total: number };
    valueHistogram: Array<{ range: string; count: number; severity: 'OK' | 'WARN' | 'CRITICAL' }>;
    breaches: Array<{
      programId: string;
      programCode: string;
      programNameTh: string;
      programNameEn: string;
      facultyId: string;
      facultyNameTh: string;
      value: number | null;
      severity: 'OK' | 'WARN' | 'CRITICAL';
      observedAt: Date;
      freshnessDate: Date;
    }>;
  }> {
    const indicator = await prisma.riskIndicator.findUnique({ where: { slug } });
    if (!indicator) {
      throw new NotFoundException(`indicator not found: ${slug}`);
    }
    // Scope clamp: FACULTY_USER / PROGRAM_USER pass facultyId / programId
    // here; admin-grade + UNIVERSITY_USER pass nothing and see all rows.
    // Same clamp is applied to BOTH the breaches list AND the severity-
    // counts + value-histogram queries below — otherwise a FACULTY_USER
    // would see "3 programs in CRITICAL" in their breach list but the
    // histogram would say "27 CRITICAL programs" (university-wide), which
    // is misleading.
    // Scope union — same logic as `drivers` / `portfolio`.
    const facultyIdSet = [
      ...(opts.facultyId ? [opts.facultyId] : []),
      ...(opts.facultyIds ?? []),
    ];
    const programIdSet = [
      ...(opts.programId ? [opts.programId] : []),
      ...(opts.programIds ?? []),
    ];
    const hasAnyScope = facultyIdSet.length > 0 || programIdSet.length > 0;
    const breaches = await prisma.riskIndicatorBreach.findMany({
      where: {
        indicatorSlug: slug,
        ...(hasAnyScope
          ? {
              OR: [
                ...(facultyIdSet.length > 0
                  ? [{ program: { facultyId: { in: facultyIdSet } } }]
                  : []),
                ...(programIdSet.length > 0
                  ? [{ programId: { in: programIdSet } }]
                  : []),
              ],
            }
          : {}),
      },
      include: {
        program: { select: { code: true, nameTh: true, nameEn: true, facultyId: true, faculty: { select: { nameTh: true } } } },
      },
      orderBy: { observedAt: 'desc' },
      take: limit,
    });
    // Latest-per-program counts (for severity breakdown). Same clamp as
    // the breaches query above — fold OR-of-arrays into one SQL clause.
    let scopeClause: Prisma.Sql = Prisma.empty;
    if (facultyIdSet.length > 0 && programIdSet.length > 0) {
      scopeClause = Prisma.sql`AND (p.faculty_id IN (${Prisma.join(facultyIdSet)}) OR p.id IN (${Prisma.join(programIdSet)}))`;
    } else if (facultyIdSet.length > 0) {
      scopeClause = Prisma.sql`AND p.faculty_id IN (${Prisma.join(facultyIdSet)})`;
    } else if (programIdSet.length > 0) {
      scopeClause = Prisma.sql`AND p.id IN (${Prisma.join(programIdSet)})`;
    }
    const facultyClause = scopeClause;
    const programClause = Prisma.empty;
    const latest = await prisma.$queryRaw<
      Array<{ severity: 'OK' | 'WARN' | 'CRITICAL'; value: number | null }>
    >(Prisma.sql`
      SELECT DISTINCT ON (program_id) severity, value
      FROM risk_indicator_breaches b
      JOIN programs p ON p.id = b.program_id
      WHERE b.indicator_slug = ${slug}
        AND p.status = 'ACTIVE'
        AND p.level = 'BACHELOR'
        ${facultyClause}
        ${programClause}
      ORDER BY program_id, observed_at DESC
    `);
    const severityCounts = {
      critical: latest.filter((l) => l.severity === 'CRITICAL').length,
      warn: latest.filter((l) => l.severity === 'WARN').length,
      ok: latest.filter((l) => l.severity === 'OK').length,
      total: latest.length,
    };

    // Build a value histogram bucketed around the thresholds.
    // For LOW alarm-direction (KRIs 1, 2, 5), buckets stretch from 0 upward.
    // For HIGH alarm-direction (KRIs 3, 4), bucketing is symmetric.
    const alarmIsLow = indicator.alarmDirection === 'low';
    const values = latest.map((l) => l.value).filter((v): v is number => v != null);
    const max = Math.max(
      values.length > 0 ? Math.max(...values) : 0,
      alarmIsLow ? indicator.warnThreshold * 2 : indicator.criticalThreshold * 1.5,
    );
    const bucketCount = 8;
    const step = max / bucketCount;
    const valueHistogram: Array<{ range: string; count: number; severity: 'OK' | 'WARN' | 'CRITICAL' }> = [];
    for (let i = 0; i < bucketCount; i += 1) {
      const lo = step * i;
      const hi = step * (i + 1);
      const count = values.filter((v) => v >= lo && (i === bucketCount - 1 ? v <= hi : v < hi)).length;
      // Determine which severity band this bucket midpoint lands in.
      const mid = (lo + hi) / 2;
      let severity: 'OK' | 'WARN' | 'CRITICAL';
      if (alarmIsLow) {
        if (mid <= indicator.criticalThreshold) severity = 'CRITICAL';
        else if (mid <= indicator.warnThreshold) severity = 'WARN';
        else severity = 'OK';
      } else {
        if (mid >= indicator.criticalThreshold) severity = 'CRITICAL';
        else if (mid >= indicator.warnThreshold) severity = 'WARN';
        else severity = 'OK';
      }
      valueHistogram.push({
        range: `${lo.toFixed(lo < 1 ? 2 : 0)}–${hi.toFixed(hi < 1 ? 2 : 0)}`,
        count,
        severity,
      });
    }

    return {
      indicator: {
        slug: indicator.slug,
        labelTh: indicator.labelTh,
        labelEn: indicator.labelEn,
        descriptionTh: indicator.descriptionTh,
        descriptionEn: indicator.descriptionEn,
        formula: indicator.formula,
        warnThreshold: indicator.warnThreshold,
        criticalThreshold: indicator.criticalThreshold,
        alarmDirection: indicator.alarmDirection,
      },
      severityCounts,
      valueHistogram,
      breaches: breaches.map((b) => ({
        programId: b.programId,
        programCode: b.program.code,
        programNameTh: b.program.nameTh,
        programNameEn: b.program.nameEn,
        facultyId: b.program.facultyId,
        facultyNameTh: b.program.faculty.nameTh,
        value: b.value,
        severity: b.severity,
        observedAt: b.observedAt,
        freshnessDate: b.freshnessDate,
      })),
    };
  }

  // ── Drivers transparency page ────────────────────────────────────────

  async drivers(opts: {
    facultyId?: string;
    facultyIds?: string[];
    programId?: string;
    programIds?: string[];
  } = {}): Promise<{
    methodology: { version: string; docPath: string };
    cohort: {
      yearlyDeclinePct: number;
      fiveYearProjectionPct: number;
      source: string;
      // Year-by-year cohort projection (BE) for the next 5 years.
      projection: Array<{ yearBE: number; cohortIndex: number }>;
    };
    automationRisk: {
      total: number;
      counts: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN', number>;
      sampleByTier: Record<'LOW' | 'MEDIUM' | 'HIGH', Array<{ id: string; nameEn: string; nameTh: string }>>;
    };
    competitiveness: {
      programsRankedCount: number;
      level: string;
      // Histogram of competition ratios (latest complete cycle).
      ratioHistogram: Array<{ range: string; count: number }>;
    };
    aiReadiness: {
      // Distribution of relevanceScore across undergraduate programs.
      total: number;
      buckets: Array<{ range: string; count: number; meanScore: number }>;
      severityCounts: { major: number; moderate: number; minor: number };
    };
  }> {
    // Scope clauses — union of all granted faculty/program IDs.
    // Empty when admin-grade / UNIVERSITY_USER (caller passes nothing).
    const facultyIdSet = [
      ...(opts.facultyId ? [opts.facultyId] : []),
      ...(opts.facultyIds ?? []),
    ];
    const programIdSet = [
      ...(opts.programId ? [opts.programId] : []),
      ...(opts.programIds ?? []),
    ];
    let scopeClause: Prisma.Sql = Prisma.empty;
    if (facultyIdSet.length > 0 && programIdSet.length > 0) {
      scopeClause = Prisma.sql`AND (p.faculty_id IN (${Prisma.join(facultyIdSet)}) OR p.id IN (${Prisma.join(programIdSet)}))`;
    } else if (facultyIdSet.length > 0) {
      scopeClause = Prisma.sql`AND p.faculty_id IN (${Prisma.join(facultyIdSet)})`;
    } else if (programIdSet.length > 0) {
      scopeClause = Prisma.sql`AND p.id IN (${Prisma.join(programIdSet)})`;
    }
    // Aliases kept for readability — existing SQL templates below
    // reference `facultyClause` / `programClause` for clarity.
    const facultyClause = scopeClause;
    const programClause = Prisma.empty;

    // Automation-risk distribution. Two modes:
    //   - Admin-grade (no scope clamp): the global skill taxonomy
    //     distribution. Cheap groupBy on the Skill table.
    //   - Faculty-/program-scoped: count only skills taught by
    //     programs in the user's scope (via ProgramSkill linkage).
    //     A skill teaching multiple programs in scope counts once.
    const counts: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN', number> = {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      UNKNOWN: 0,
    };
    let total = 0;
    if (!opts.facultyId && !opts.programId) {
      const grouped = await prisma.skill.groupBy({
        by: ['automationRisk'],
        _count: { _all: true },
      });
      for (const g of grouped) {
        counts[g.automationRisk] = g._count._all;
        total += g._count._all;
      }
    } else {
      const scopedRows = await prisma.$queryRaw<
        Array<{ automation_risk: 'LOW' | 'MEDIUM' | 'HIGH' | 'UNKNOWN'; count: bigint }>
      >(Prisma.sql`
        SELECT s.automation_risk, COUNT(DISTINCT s.id) AS count
        FROM skills s
        JOIN program_skills ps ON ps.skill_id = s.id
        JOIN programs p ON p.id = ps.program_id
        WHERE p.level = 'BACHELOR' AND p.status = 'ACTIVE'
          ${facultyClause}
          ${programClause}
        GROUP BY s.automation_risk
      `);
      for (const r of scopedRows) {
        counts[r.automation_risk] = Number(r.count);
        total += Number(r.count);
      }
    }

    // Top-12 representative skills per tier — same scope clamp as
    // counts above (so a FACULTY_USER sees skills their programs
    // actually teach, not the global taxonomy).
    const sampleByTier: Record<'LOW' | 'MEDIUM' | 'HIGH', Array<{ id: string; nameEn: string; nameTh: string }>> = {
      LOW: [],
      MEDIUM: [],
      HIGH: [],
    };
    for (const tier of ['LOW', 'MEDIUM', 'HIGH'] as const) {
      let samples;
      if (!opts.facultyId && !opts.programId) {
        samples = await prisma.skill.findMany({
          where: { automationRisk: tier },
          orderBy: { nameEn: 'asc' },
          take: 12,
          select: { id: true, nameEn: true, nameTh: true },
        });
      } else {
        samples = await prisma.$queryRaw<
          Array<{ id: string; name_en: string; name_th: string }>
        >(Prisma.sql`
          SELECT DISTINCT s.id, s.name_en, s.name_th
          FROM skills s
          JOIN program_skills ps ON ps.skill_id = s.id
          JOIN programs p ON p.id = ps.program_id
          WHERE s.automation_risk = ${tier}::"AutomationRisk"
            AND p.level = 'BACHELOR' AND p.status = 'ACTIVE'
            ${facultyClause}
            ${programClause}
          ORDER BY s.name_en
          LIMIT 12
        `).then((rows) =>
          rows.map((r) => ({ id: r.id, nameEn: r.name_en, nameTh: r.name_th })),
        );
      }
      sampleByTier[tier] = samples;
    }
    const competRows = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
      SELECT COUNT(DISTINCT p.id) AS count
      FROM programs p
      JOIN tcas_admission_funnels t ON t.program_id = p.id
      WHERE p.level = 'BACHELOR' AND p.status = 'ACTIVE'
        AND ${realDataSql('t')}
      ${facultyClause}
      ${programClause}
    `);
    const programsRankedCount = competRows.length > 0 ? Number(competRows[0]!.count) : 0;

    // Cohort decline constant (mirrors risk-scoring.ts).
    const yearlyDeclinePct = 1.8;
    const fiveYrShrinkagePct = (1 - Math.pow(1 - yearlyDeclinePct / 100, 5)) * 100;
    const currentBE = new Date().getFullYear() + 543;
    const projection: Array<{ yearBE: number; cohortIndex: number }> = [];
    for (let i = 0; i <= 5; i += 1) {
      projection.push({
        yearBE: currentBE + i,
        cohortIndex: Math.round(Math.pow(1 - yearlyDeclinePct / 100, i) * 1000) / 10,
      });
    }

    // Competition ratio histogram (latest complete cycle).
    const ratioRows = await prisma.$queryRaw<Array<{ ratio: number }>>(Prisma.sql`
      WITH latest AS (
        SELECT p.id AS program_id, MAX(t.entry_year_be) AS year_be
        FROM programs p
        JOIN tcas_admission_funnels t ON t.program_id = p.id
        WHERE p.level = 'BACHELOR' AND p.status = 'ACTIVE'
          AND t.entry_year_be < (EXTRACT(YEAR FROM CURRENT_DATE)::int + 543)
          AND ${realDataSql('t')}
        GROUP BY p.id
      )
      SELECT
        SUM(COALESCE(t.total_applicants, 0))::float / NULLIF(MAX(COALESCE(t.plan_per_year, 0)), 0) AS ratio
      FROM programs p
      JOIN latest l ON l.program_id = p.id
      JOIN tcas_admission_funnels t ON t.program_id = p.id AND t.entry_year_be = l.year_be
      WHERE p.level = 'BACHELOR' AND p.status = 'ACTIVE'
        AND ${realDataSql('t')}
      ${facultyClause}
      ${programClause}
      GROUP BY p.id
    `);
    const ratioBuckets = [
      { range: '<0.5', lo: 0, hi: 0.5, count: 0 },
      { range: '0.5–1', lo: 0.5, hi: 1, count: 0 },
      { range: '1–1.5', lo: 1, hi: 1.5, count: 0 },
      { range: '1.5–3', lo: 1.5, hi: 3, count: 0 },
      { range: '3–6', lo: 3, hi: 6, count: 0 },
      { range: '≥6', lo: 6, hi: Infinity, count: 0 },
    ];
    for (const r of ratioRows) {
      if (r.ratio == null) continue;
      const b = ratioBuckets.find((b) => r.ratio >= b.lo && r.ratio < b.hi);
      if (b) b.count += 1;
    }

    // AI readiness distribution
    const readinessRows = await prisma.$queryRaw<Array<{ score: number; gaps: number[] }>>(Prisma.sql`
      SELECT
        r.relevance_score::float AS score,
        ARRAY(
          SELECT (jsonb_array_elements(r.payload_json->'gaps')->>'severity')::text
        ) AS gaps
      FROM program_ai_readiness_assessments r
      JOIN programs p ON p.id = r.program_id
      WHERE p.level = 'BACHELOR' AND p.status = 'ACTIVE'
      ${facultyClause}
      ${programClause}
    `).catch(() => [] as Array<{ score: number; gaps: string[] }>);
    const readinessBucketDefs = [
      { range: '<30 (low)', lo: 0, hi: 30 },
      { range: '30–49', lo: 30, hi: 50 },
      { range: '50–69', lo: 50, hi: 70 },
      { range: '70+ (strong)', lo: 70, hi: 101 },
    ];
    const readinessBuckets = readinessBucketDefs.map((b) => ({
      range: b.range,
      count: 0,
      sumScore: 0,
    }));
    const severityCounts = { major: 0, moderate: 0, minor: 0 };
    for (const r of readinessRows) {
      const score = Number(r.score);
      if (Number.isFinite(score)) {
        for (let i = 0; i < readinessBucketDefs.length; i += 1) {
          const def = readinessBucketDefs[i]!;
          if (score >= def.lo && score < def.hi) {
            readinessBuckets[i]!.count += 1;
            readinessBuckets[i]!.sumScore += score;
            break;
          }
        }
      }
      const gapsAny = r.gaps as unknown as string[] | null;
      if (Array.isArray(gapsAny)) {
        for (const sev of gapsAny) {
          if (sev === 'major' || sev === 'moderate' || sev === 'minor') {
            severityCounts[sev] += 1;
          }
        }
      }
    }

    return {
      methodology: {
        version: RISK_SCORING_VERSION,
        docPath: 'docs/methodologies/risk-scoring.md',
      },
      cohort: {
        yearlyDeclinePct,
        fiveYearProjectionPct: Math.round(fiveYrShrinkagePct * 10) / 10,
        source: 'NESDC Population Projection 2010–2040, Thailand 18-22 cohort',
        projection,
      },
      automationRisk: {
        total,
        counts,
        sampleByTier,
      },
      competitiveness: {
        programsRankedCount,
        level: 'BACHELOR',
        ratioHistogram: ratioBuckets.map((b) => ({ range: b.range, count: b.count })),
      },
      aiReadiness: {
        total: readinessRows.length,
        buckets: readinessBuckets.map((b) => ({
          range: b.range,
          count: b.count,
          meanScore: b.count > 0 ? Math.round(b.sumScore / b.count) : 0,
        })),
        severityCounts,
      },
    };
  }

  // ── Per-program profile ──────────────────────────────────────────────

  async programProfile(programId: string): Promise<{
    program: {
      id: string;
      code: string;
      nameTh: string;
      nameEn: string;
      facultyId: string;
      facultyNameTh: string;
      facultyNameEn: string;
      level: string;
      durationYears: number | null;
      totalCredits: number | null;
      recruitmentSummaryTh: string | null;
    };
    latestAssessment: {
      id: string;
      assessedAt: Date;
      l1RecruitmentScore: number | null;
      l1RecruitmentConfidence: number | null;
      l2AiDisruptionScore: number | null;
      l2AiDisruptionConfidence: number | null;
      l3DemographicScore: number | null;
      l3DemographicConfidence: number | null;
      composite: number | null;
      tier: RiskTier;
      directRevenueAtRiskThb: number | null;
      strandedCostThb: number | null;
      impactScore: number | null;
      // KKU 5×5 institutional matrix view alongside the composite tier.
      likelihoodBin: number | null;
      impactBin: number | null;
      kkuMatrixScore: number | null;
      kkuRiskLevel: KkuRiskLevel;
      narrativeTh: string | null;
      narrativeEn: string | null;
      dataGaps: unknown;
      methodologyVersion: string;
      confidence: number | null;
      measures: Array<{
        id: string;
        kind: string;
        titleTh: string;
        titleEn: string;
        rationaleTh: string;
        rationaleEn: string | null;
        costClass: string | null;
        horizon: 'SHORT_TERM' | 'MEDIUM_TERM' | 'LONG_TERM';
        expectedDeltaThb: number | null;
        priority: number;
        status: string;
        decisionId: string | null;
        evidence: unknown;
      }>;
    } | null;
    history: Array<{
      id: string;
      assessedAt: Date;
      composite: number | null;
      tier: RiskTier;
    }>;
    // Latest breach per indicator — full catalog, not just fired ones, so the
    // dashboard can show every KRI's status (OK / WARN / CRITICAL / no-data).
    indicatorStatus: Array<{
      slug: string;
      labelEn: string;
      labelTh: string;
      severity: 'OK' | 'WARN' | 'CRITICAL' | null;
      value: number | null;
      warnThreshold: number;
      criticalThreshold: number;
      alarmDirection: string;
      observedAt: Date | null;
    }>;
    // 5y TCAS funnel (per year) for the sparkline.
    tcasYears: Array<{
      year: number;
      plan: number | null;
      applicants: number | null;
      reported: number | null;
      // True for the BE year currently being filled (TCAS round 1–4 still
      // running). Counts are partial — excluded from L1 / KRIs / percentile
      // by the scoring engine. UI should still show it but flag visually.
      inProgress: boolean;
    }>;
    // Skill automation distribution (counts + weighted shares).
    skillAutomation: {
      total: number;
      counts: { LOW: number; MEDIUM: number; HIGH: number; UNKNOWN: number };
      weightedShares: { LOW: number; MEDIUM: number; HIGH: number; UNKNOWN: number };
      topHighRiskSkills: Array<{ skillId: string; nameEn: string; nameTh: string; weight: number }>;
    };
    // L2 v1.3 component breakdown — three weighted parts of the AI risk score.
    // Computed live each request from latest inputs.
    l2Breakdown: {
      overallScore: number | null;
      composition: Array<{
        key: 'skillPressure' | 'readinessDeficit' | 'disruptionSignal';
        value: number;
        weight: number;
      }>;
      readinessRelevanceScore: number | null;
      readinessSummary: string | null;
      readinessMethodVersion: string | null;
      topGaps: Array<{ topic: string; severity: 'major' | 'moderate' | 'minor'; observation: string }>;
      topRecommendations: Array<{
        priority: 'high' | 'medium' | 'low';
        title: string;
        detail: string;
      }>;
    };
    universityAverages: UniversityAverages;
  }> {
    const program = await prisma.program.findUnique({
      where: { id: programId },
      select: {
        id: true,
        code: true,
        nameTh: true,
        nameEn: true,
        facultyId: true,
        faculty: { select: { nameTh: true, nameEn: true } },
        level: true,
        durationYears: true,
        totalCredits: true,
        recruitmentSummaryTh: true,
      },
    });
    if (!program) throw new NotFoundException(`program not found: ${programId}`);

    const latest = await prisma.riskAssessment.findFirst({
      where: { programId },
      orderBy: { assessedAt: 'desc' },
      include: {
        measures: { orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }] },
      },
    });

    const history = await prisma.riskAssessment.findMany({
      where: { programId },
      orderBy: { assessedAt: 'desc' },
      take: 12,
      select: {
        id: true,
        assessedAt: true,
        compositeScore: true,
        tier: true,
      },
    });

    // Build full per-indicator status: pull latest breach per slug, fill in
    // the catalog metadata (thresholds, labels). Indicators that never fired
    // for this program show severity=null so the UI renders a "no data" tile.
    const indicators = await prisma.riskIndicator.findMany({
      orderBy: { slug: 'asc' },
    });
    const latestBreaches = await prisma.$queryRaw<
      Array<{
        indicator_slug: string;
        value: number | null;
        severity: 'OK' | 'WARN' | 'CRITICAL';
        observed_at: Date;
      }>
    >(Prisma.sql`
      SELECT DISTINCT ON (indicator_slug) indicator_slug, value, severity, observed_at
      FROM risk_indicator_breaches
      WHERE program_id = ${programId}
      ORDER BY indicator_slug, observed_at DESC
    `);
    const breachBySlug = new Map(latestBreaches.map((b) => [b.indicator_slug, b]));
    const indicatorStatus = indicators.map((i) => {
      const b = breachBySlug.get(i.slug);
      return {
        slug: i.slug,
        labelEn: i.labelEn,
        labelTh: i.labelTh,
        severity: b ? b.severity : null,
        value: b ? b.value : null,
        warnThreshold: i.warnThreshold,
        criticalThreshold: i.criticalThreshold,
        alarmDirection: i.alarmDirection,
        observedAt: b ? b.observed_at : null,
      };
    });

    // TCAS funnel rolled up per year for the sparkline.
    const tcasRaw = await prisma.tcasAdmissionFunnel.findMany({
      where: { programId, ...realDataWhere() },
      select: { entryYearBE: true, planPerYear: true, totalApplicants: true, regReported: true },
    });
    const yearMap = new Map<number, { plan: number | null; applicants: number; reported: number }>();
    for (const r of tcasRaw) {
      const cur = yearMap.get(r.entryYearBE) ?? { plan: null, applicants: 0, reported: 0 };
      if (r.planPerYear != null) cur.plan = Math.max(cur.plan ?? 0, r.planPerYear);
      cur.applicants += r.totalApplicants ?? 0;
      cur.reported += r.regReported ?? 0;
      yearMap.set(r.entryYearBE, cur);
    }
    const tcasYears = [...yearMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .slice(-5)
      .map(([year, v]) => ({
        year,
        plan: v.plan,
        applicants: v.applicants > 0 ? v.applicants : null,
        reported: v.reported > 0 ? v.reported : null,
        inProgress: isInProgressBE(year),
      }));

    // Recompute L2 components live — gives the UI the per-component breakdown
    // (skill pressure / readiness deficit / disruption signal) without
    // persisting it on every assessment row. Cheap: single program lookup
    // with includes, runs in ~30ms.
    const liveInputs = await loadProgramRiskInputs(programId);
    const liveL2 = liveInputs ? scoreL2AiDisruption(liveInputs) : null;

    // Skill automation distribution + top HIGH-risk skills.
    const psRows = await prisma.programSkill.findMany({
      where: { programId },
      select: {
        weight: true,
        skill: { select: { id: true, nameEn: true, nameTh: true, automationRisk: true } },
      },
    });
    const counts = { LOW: 0, MEDIUM: 0, HIGH: 0, UNKNOWN: 0 };
    const weightedSums = { LOW: 0, MEDIUM: 0, HIGH: 0, UNKNOWN: 0 };
    let totalWeight = 0;
    const topHigh: Array<{ skillId: string; nameEn: string; nameTh: string; weight: number }> = [];
    for (const ps of psRows) {
      counts[ps.skill.automationRisk] += 1;
      weightedSums[ps.skill.automationRisk] += ps.weight;
      totalWeight += ps.weight;
      if (ps.skill.automationRisk === 'HIGH') {
        topHigh.push({
          skillId: ps.skill.id,
          nameEn: ps.skill.nameEn,
          nameTh: ps.skill.nameTh,
          weight: ps.weight,
        });
      }
    }
    topHigh.sort((a, b) => b.weight - a.weight);
    const tw = totalWeight > 0 ? totalWeight : 1;
    const skillAutomation = {
      total: psRows.length,
      counts,
      weightedShares: {
        LOW: weightedSums.LOW / tw,
        MEDIUM: weightedSums.MEDIUM / tw,
        HIGH: weightedSums.HIGH / tw,
        UNKNOWN: weightedSums.UNKNOWN / tw,
      },
      topHighRiskSkills: topHigh.slice(0, 12),
    };

    return {
      program: {
        id: program.id,
        code: program.code,
        nameTh: program.nameTh,
        nameEn: program.nameEn,
        facultyId: program.facultyId,
        facultyNameTh: program.faculty.nameTh,
        facultyNameEn: program.faculty.nameEn,
        level: program.level,
        durationYears: program.durationYears,
        totalCredits: program.totalCredits,
        recruitmentSummaryTh: program.recruitmentSummaryTh,
      },
      latestAssessment: latest
        ? {
            id: latest.id,
            assessedAt: latest.assessedAt,
            l1RecruitmentScore: latest.l1RecruitmentScore,
            l1RecruitmentConfidence: latest.l1RecruitmentConfidence,
            l2AiDisruptionScore: latest.l2AiDisruptionScore,
            l2AiDisruptionConfidence: latest.l2AiDisruptionConfidence,
            l3DemographicScore: latest.l3DemographicScore,
            l3DemographicConfidence: latest.l3DemographicConfidence,
            composite: latest.compositeScore,
            tier: latest.tier,
            directRevenueAtRiskThb: latest.directRevenueAtRiskThb?.toNumber() ?? null,
            strandedCostThb: latest.strandedCostThb?.toNumber() ?? null,
            impactScore: latest.impactScore,
            likelihoodBin: latest.likelihoodBin,
            impactBin: latest.impactBin,
            kkuMatrixScore: latest.kkuMatrixScore,
            kkuRiskLevel: latest.kkuRiskLevel,
            narrativeTh: latest.narrativeTh,
            narrativeEn: latest.narrativeEn,
            dataGaps: latest.dataGapsJson,
            methodologyVersion: latest.methodologyVersion,
            confidence: latest.confidence,
            measures: latest.measures.map((m) => ({
              id: m.id,
              kind: m.kind,
              titleTh: m.titleTh,
              titleEn: m.titleEn,
              rationaleTh: m.rationaleTh,
              rationaleEn: m.rationaleEn,
              costClass: m.costClass,
              horizon: m.horizon,
              expectedDeltaThb: m.expectedDeltaThb?.toNumber() ?? null,
              priority: m.priority,
              status: m.status,
              decisionId: m.decisionId,
              evidence: m.evidenceJson,
            })),
          }
        : null,
      history: history.map((h) => ({
        id: h.id,
        assessedAt: h.assessedAt,
        composite: h.compositeScore,
        tier: h.tier,
      })),
      universityAverages: await getUniversityAverages(program.level),
      indicatorStatus,
      tcasYears,
      skillAutomation,
      l2Breakdown: {
        overallScore: liveL2?.score ?? null,
        composition:
          ((liveL2?.detail as Record<string, unknown> | undefined)?.composition as
            | Array<{
                key: 'skillPressure' | 'readinessDeficit' | 'disruptionSignal';
                value: number;
                weight: number;
              }>
            | undefined) ?? [],
        readinessRelevanceScore:
          ((liveL2?.detail as { readinessDeficit?: { relevanceScore?: number } } | undefined)?.readinessDeficit
            ?.relevanceScore as number | undefined) ?? null,
        readinessSummary:
          ((liveL2?.detail as { readinessSummary?: string | null } | undefined)?.readinessSummary as
            | string
            | null
            | undefined) ?? null,
        readinessMethodVersion:
          ((liveL2?.detail as { readinessDeficit?: { methodVersion?: string } } | undefined)?.readinessDeficit
            ?.methodVersion as string | undefined) ?? null,
        topGaps:
          ((liveL2?.detail as { topAiReadinessGaps?: Array<{ topic: string; severity: 'major' | 'moderate' | 'minor'; observation: string }> } | undefined)?.topAiReadinessGaps) ?? [],
        topRecommendations:
          ((liveL2?.detail as { topAiReadinessRecommendations?: Array<{ priority: 'high' | 'medium' | 'low'; title: string; detail: string }> } | undefined)?.topAiReadinessRecommendations) ?? [],
      },
    };
  }

  // ── Measure status transitions ───────────────────────────────────────

  async setMeasureStatus(
    measureId: string,
    status: 'PROPOSED' | 'ACCEPTED' | 'REJECTED' | 'IN_PROGRESS' | 'COMPLETED',
    decisionId?: string,
  ): Promise<{ id: string; status: string; decisionId: string | null }> {
    const measure = await prisma.riskMeasure.findUnique({ where: { id: measureId } });
    if (!measure) throw new NotFoundException(`measure not found: ${measureId}`);

    const updated = await prisma.riskMeasure.update({
      where: { id: measureId },
      data: { status, decisionId: decisionId ?? measure.decisionId ?? null },
      select: { id: true, status: true, decisionId: true },
    });
    return updated;
  }

  // ── Bootstrap helpers ────────────────────────────────────────────────

  /**
   * Idempotently seed the indicator catalog. Called by the pipeline on
   * first run, and safe to re-run after a methodology bump.
   */
  async upsertIndicatorCatalog(): Promise<{ inserted: number; updated: number }> {
    let inserted = 0;
    let updated = 0;
    for (const def of RISK_INDICATOR_CATALOG) {
      const existing = await prisma.riskIndicator.findUnique({ where: { slug: def.slug } });
      if (!existing) {
        await prisma.riskIndicator.create({
          data: {
            slug: def.slug,
            labelTh: def.labelTh,
            labelEn: def.labelEn,
            descriptionTh: def.descriptionTh,
            descriptionEn: def.descriptionEn,
            formula: def.formula,
            warnThreshold: def.warnThreshold,
            criticalThreshold: def.criticalThreshold,
            alarmDirection: def.alarmDirection,
            methodologyVersion: RISK_SCORING_VERSION,
          },
        });
        inserted += 1;
      } else {
        await prisma.riskIndicator.update({
          where: { slug: def.slug },
          data: {
            labelTh: def.labelTh,
            labelEn: def.labelEn,
            descriptionTh: def.descriptionTh,
            descriptionEn: def.descriptionEn,
            formula: def.formula,
            warnThreshold: def.warnThreshold,
            criticalThreshold: def.criticalThreshold,
            alarmDirection: def.alarmDirection,
            methodologyVersion: RISK_SCORING_VERSION,
          },
        });
        updated += 1;
      }
    }
    return { inserted, updated };
  }
}
