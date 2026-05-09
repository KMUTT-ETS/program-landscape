#!/usr/bin/env tsx
// ─────────────────────────────────────────────────────────────────────────────
// Risk assessment pipeline — risk-scoring.v1 + risk-assessment.v1
//
// Per program:
//   1. Load inputs (TCAS funnel, enrollment, financials, skills, peer subject,
//      white-spaces, sector outlook).
//   2. Compute deterministic L1/L2/L3/composite/tier + impact via
//      risk-scoring.v1 (pure function in @kku/db).
//   3. Evaluate KRIs and persist RiskIndicatorBreach rows.
//   4. (Optional, --no-ai to skip) Call Gemini with risk-assessment.v1 to
//      get narrative + 2-4 specific measures. Persist RiskAssessment +
//      RiskMeasure rows linked back to the AiInference record.
//   5. After batch: normaliseImpactScores() to fill 0-100 normalised impact.
//
// Usage:
//   pnpm risks:assess <code|seq|id>           # single program
//   pnpm risks:assess --all                   # all undergraduate programs
//   pnpm risks:assess --all --limit 10        # cap
//   pnpm risks:assess --all --no-ai           # deterministic only
//   pnpm risks:assess --all --faculty <id>    # one faculty
//   pnpm risks:assess --all --dry-run         # no DB writes
//
// Idempotent. Each run inserts NEW RiskAssessment + breach rows. Old rows
// retained for audit; the UI shows "latest assessment" via DISTINCT ON.
// ─────────────────────────────────────────────────────────────────────────────

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

loadDotEnv(path.resolve(process.cwd(), '.env'));

function loadDotEnv(envPath: string): void {
  if (!existsSync(envPath)) return;
  const content = readFileSync(envPath, 'utf8');
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

import {
  prisma,
  PrismaAiInferenceRecorder,
  loadProgramRiskInputs,
  scoreProgramRisk,
  evaluateKris,
  normaliseImpactScores,
  isInProgressBE,
  latestCompleteEntryYearBE,
  RISK_INDICATOR_CATALOG,
  RISK_SCORING_VERSION,
  Prisma,
  type ProgramRiskInputs,
  type ProgramRiskResult,
} from '@kku/db';
import {
  createAiService,
  buildRiskAssessmentMessages,
  RISK_ASSESSMENT_VERSION,
  RiskAssessmentSchema,
  type AiProviderId,
  type RiskAssessmentInput,
} from '@kku/shared';

const args = process.argv.slice(2);
const all = args.includes('--all');
const dryRun = args.includes('--dry-run');
const noAi = args.includes('--no-ai');
const skipAiDone = args.includes('--skip-ai-done');
const limit = readFlag('--limit');
const facultyArg = readFlag('--faculty');
const positional = args.find((a) => !a.startsWith('--'));

function readFlag(name: string): string | undefined {
  const idx = args.findIndex((a) => a === name || a.startsWith(`${name}=`));
  if (idx === -1) return undefined;
  const arg = args[idx]!;
  if (arg.includes('=')) return arg.split('=')[1];
  return args[idx + 1];
}

const LOG_DIR = path.resolve(process.cwd(), 'logs');
const LOG_PATH = path.join(LOG_DIR, `risks-assess-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`);
mkdirSync(LOG_DIR, { recursive: true });

function logLine(obj: Record<string, unknown>): void {
  appendFileSync(LOG_PATH, JSON.stringify(obj) + '\n');
}

// ── Resolve program list ────────────────────────────────────────────────

async function resolveTargets(): Promise<Array<{ id: string; code: string; nameTh: string }>> {
  if (all) {
    if (skipAiDone) {
      // Resume mode: only programs whose latest assessment lacks an
      // ai_inference_id. Useful for chunked AI sweeps.
      // SAFETY: $queryRawUnsafe with a fully hardcoded SQL string (no
      // user input). Operator-only one-shot script.
      const rows = await prisma.$queryRawUnsafe<
        Array<{ id: string; code: string; name_th: string }>
      >(`
        WITH latest AS (
          SELECT DISTINCT ON (program_id) id, program_id, ai_inference_id
          FROM risk_assessments ORDER BY program_id, assessed_at DESC
        )
        SELECT p.id, p.code, p.name_th
        FROM programs p
        LEFT JOIN latest l ON l.program_id = p.id
        WHERE p.level = 'BACHELOR' AND p.status = 'ACTIVE'
          AND (l.ai_inference_id IS NULL)
          ${facultyArg ? `AND p.faculty_id = '${facultyArg}'` : ''}
        ORDER BY p.faculty_id ASC, p.code ASC
        ${limit ? `LIMIT ${parseInt(limit, 10)}` : ''}
      `);
      return rows.map((r) => ({ id: r.id, code: r.code, nameTh: r.name_th }));
    }
    const where: Prisma.ProgramWhereInput = {
      level: 'BACHELOR',
      status: 'ACTIVE',
      ...(facultyArg ? { facultyId: facultyArg } : {}),
    };
    const programs = await prisma.program.findMany({
      where,
      select: { id: true, code: true, nameTh: true },
      orderBy: [{ facultyId: 'asc' }, { code: 'asc' }],
      take: limit ? parseInt(limit, 10) : undefined,
    });
    return programs;
  }
  if (!positional) {
    console.error('Usage: pnpm risks:assess <code|seq|id>  OR  pnpm risks:assess --all [--limit N]');
    process.exit(1);
  }
  const seqNo = Number(positional);
  const program = await prisma.program.findFirst({
    where: {
      OR: [
        { id: positional },
        { code: positional },
        { mhesiCode: positional },
        ...(Number.isInteger(seqNo) ? [{ sequenceNoFromSheet: seqNo }] : []),
      ],
    },
    select: { id: true, code: true, nameTh: true },
  });
  if (!program) {
    console.error(`Program not found: ${positional}`);
    process.exit(1);
  }
  return [program];
}

// ── AI call wrapper ─────────────────────────────────────────────────────

async function buildAiInput(
  programId: string,
  scores: ProgramRiskResult,
): Promise<RiskAssessmentInput | null> {
  const program = await prisma.program.findUnique({
    where: { id: programId },
    select: {
      code: true,
      nameTh: true,
      nameEn: true,
      level: true,
      durationYears: true,
      totalCredits: true,
      recruitmentSummaryTh: true,
      faculty: { select: { nameTh: true } },
      department: { select: { nameTh: true } },
      programSkills: {
        select: {
          weight: true,
          skill: { select: { id: true, nameEn: true, nameTh: true, automationRisk: true } },
        },
        take: 80,
      },
      aiReadinessAssessment: {
        select: { relevanceScore: true, methodVersion: true, payloadJson: true },
      },
      tcasAdmissionFunnels: {
        select: {
          entryYearBE: true,
          round: true,
          planPerYear: true,
          totalApplicants: true,
          regReported: true,
        },
      },
    },
  });
  if (!program) return null;

  const yearMap = new Map<
    number,
    { plan: number | null; applicants: number | null; reported: number | null }
  >();
  for (const r of program.tcasAdmissionFunnels) {
    const cur = yearMap.get(r.entryYearBE) ?? { plan: null, applicants: null, reported: null };
    if (r.planPerYear != null) cur.plan = Math.max(cur.plan ?? 0, r.planPerYear);
    if (r.totalApplicants != null) cur.applicants = (cur.applicants ?? 0) + r.totalApplicants;
    if (r.regReported != null) cur.reported = (cur.reported ?? 0) + r.regReported;
    yearMap.set(r.entryYearBE, cur);
  }
  // Drop in-progress cycle from the AI's view of "the trend" — keeps
  // recommendations anchored on completed cycles. The latest-complete BE
  // year is appended to dataGaps so the AI knows it was excluded.
  const completeThroughBE = latestCompleteEntryYearBE();
  const tcasYears = [...yearMap.entries()]
    .filter(([year]) => year <= completeThroughBE)
    .sort((a, b) => a[0] - b[0])
    .slice(-5)
    .map(([year, v]) => ({
      year,
      plan: v.plan,
      applicants: v.applicants,
      reported: v.reported,
      competitionRatio: v.applicants && v.plan ? v.applicants / v.plan : null,
      fillRate: v.reported != null && v.plan ? v.reported / v.plan : null,
    }));
  const droppedInProgress = [...yearMap.keys()].filter((y) => isInProgressBE(y));

  const dataGaps: Array<{ field: string; reason: string }> = [
    ...scores.l1Recruitment.gaps,
    ...scores.l2AiDisruption.gaps,
    ...scores.l3Demographic.gaps,
    ...scores.impact.gaps,
  ];
  if (droppedInProgress.length > 0) {
    dataGaps.push({
      field: 'tcasFunnel',
      reason: `BE ${droppedInProgress.join(', ')} excluded — TCAS cycle in progress, partial counts not reliable for scoring`,
    });
  }

  // KRIs are recomputed at the input layer for the AI's reference (the
  // pipeline persists its own copy via evaluateKris below).
  const kriResults = evaluateKris(
    {
      programId,
      level: program.level,
      status: 'ACTIVE',
      tcasFunnel: program.tcasAdmissionFunnels.map((r) => ({
        entryYearBE: r.entryYearBE,
        round: r.round,
        planPerYear: r.planPerYear,
        totalApplicants: r.totalApplicants,
        totalPassed: null,
        regReported: r.regReported,
      })),
      enrollment: [],
      skills: program.programSkills.map((ps) => ({
        skillId: ps.skill.id,
        nameEn: ps.skill.nameEn,
        nameTh: ps.skill.nameTh,
        automationRisk: ps.skill.automationRisk,
        weight: ps.weight ?? 0.5,
      })),
      aiReadiness: null, // KRI evaluator doesn't read aiReadiness; only L2 does.
      financial: [],
      competitivenessPercentile: null,
    },
    new Date(),
  );

  // Pull program's own HIGH-risk skills, ranked by curriculum weight.
  const topAutomationRiskSkills = program.programSkills
    .filter((ps) => ps.skill.automationRisk === 'HIGH')
    .map((ps) => ({ nameEn: ps.skill.nameEn, nameTh: ps.skill.nameTh, weight: ps.weight ?? 0.5 }))
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 12);

  // Build the aiReadinessSnapshot block — used by the AI prompt to ground
  // L2-related recommendations in deep-dive analysis instead of inventing
  // generic AI guidance.
  type AiReadinessPayload = {
    summary?: string;
    gaps?: Array<{ topic: string; severity: 'major' | 'moderate' | 'minor'; observation: string }>;
    recommendations?: Array<{
      priority: 'high' | 'medium' | 'low';
      title: string;
      detail: string;
    }>;
  };
  const SEV_W: Record<'major' | 'moderate' | 'minor', number> = { major: 3, moderate: 2, minor: 1 };
  const PRIO_W: Record<'high' | 'medium' | 'low', number> = { high: 3, medium: 2, low: 1 };
  let aiReadinessSnapshot: RiskAssessmentInput['aiReadinessSnapshot'] = null;
  if (program.aiReadinessAssessment) {
    const payload = program.aiReadinessAssessment.payloadJson as AiReadinessPayload;
    const allGaps = Array.isArray(payload?.gaps) ? payload.gaps : [];
    const allRecs = Array.isArray(payload?.recommendations) ? payload.recommendations : [];
    aiReadinessSnapshot = {
      relevanceScore: program.aiReadinessAssessment.relevanceScore,
      summary: payload?.summary ?? null,
      methodVersion: program.aiReadinessAssessment.methodVersion,
      topGaps: [...allGaps].sort((a, b) => SEV_W[b.severity] - SEV_W[a.severity]).slice(0, 4),
      topRecommendations: [...allRecs]
        .sort((a, b) => PRIO_W[b.priority] - PRIO_W[a.priority])
        .slice(0, 4),
    };
  }

  return {
    program: {
      code: program.code,
      nameTh: program.nameTh,
      nameEn: program.nameEn,
      facultyNameTh: program.faculty.nameTh,
      departmentNameTh: program.department?.nameTh ?? null,
      levelTh: levelToTh(program.level),
      durationYears: program.durationYears,
      totalCredits: program.totalCredits,
      recruitmentSummaryTh: program.recruitmentSummaryTh,
    },
    scores: {
      l1RecruitmentScore: scores.l1Recruitment.score,
      l2AiDisruptionScore: scores.l2AiDisruption.score,
      l3DemographicScore: scores.l3Demographic.score,
      composite: scores.composite,
      tier: scores.tier,
      impact: {
        directRevenueAtRiskThb: scores.impact.directRevenueAtRiskThb,
        strandedCostThb: scores.impact.strandedCostThb,
      },
    },
    driverDetail: {
      l1: scores.l1Recruitment.detail,
      l2: scores.l2AiDisruption.detail,
      l3: scores.l3Demographic.detail,
    },
    tcasYears,
    skills: program.programSkills.map((ps) => ({
      nameEn: ps.skill.nameEn,
      nameTh: ps.skill.nameTh,
      automationRisk: ps.skill.automationRisk,
      weight: ps.weight ?? 0.5,
    })),
    topAutomationRiskSkills,
    aiReadinessSnapshot,
    peerPrograms: [],
    whitespaceSkills: [],
    sectorOutlook: [],
    kriBreaches: kriResults.map((k) => ({
      slug: k.indicatorSlug,
      severity: k.severity,
      value: k.value,
    })),
    dataGaps,
  };
}

function levelToTh(level: string): string {
  switch (level) {
    case 'BACHELOR':
      return 'ปริญญาตรี';
    case 'MASTER':
      return 'ปริญญาโท';
    case 'DOCTORAL':
      return 'ปริญญาเอก';
    case 'HIGHER_GRAD_DIPLOMA':
      return 'ประกาศนียบัตรบัณฑิตชั้นสูง';
    default:
      return level;
  }
}

// ── Indicator catalog seeder ────────────────────────────────────────────

async function ensureIndicatorCatalog(): Promise<void> {
  for (const def of RISK_INDICATOR_CATALOG) {
    await prisma.riskIndicator.upsert({
      where: { slug: def.slug },
      create: {
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
      update: {
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
  }
}

// ── Main ────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log(`[risks-assess] mode=${dryRun ? 'DRY-RUN' : 'APPLY'}, ai=${noAi ? 'OFF' : 'ON'}`);
  console.log(`[risks-assess] log → ${LOG_PATH}\n`);

  if (!dryRun) {
    await ensureIndicatorCatalog();
  }

  const targets = await resolveTargets();
  console.log(`[risks-assess] ${targets.length} program(s) to process`);

  const recorder = new PrismaAiInferenceRecorder();
  const providerId = (process.env.AI_PROVIDER ?? 'google') as AiProviderId;
  const ai = !noAi
    ? createAiService({
        recorder,
        providerId,
        apiKeys: {
          google: process.env.GOOGLE_AI_API_KEY,
          anthropic: process.env.ANTHROPIC_API_KEY,
          openrouter: process.env.OPENROUTER_API_KEY,
        },
      })
    : null;

  let succeeded = 0;
  let failed = 0;
  let skippedNoData = 0;
  let aiCallCost = 0;

  for (const t of targets) {
    const start = Date.now();
    try {
      const inputs = await loadProgramRiskInputs(t.id);
      if (!inputs) {
        console.log(`  [SKIP] ${t.code} ${t.nameTh}  (program not found)`);
        skippedNoData += 1;
        logLine({ programId: t.id, code: t.code, status: 'SKIPPED', reason: 'program not found' });
        continue;
      }

      const scores = scoreProgramRisk(inputs);
      const breaches = evaluateKris(inputs, new Date());

      // Don't bother with AI if all three drivers are null AND no impact
      // — output would be vacuous.
      const allLNull =
        scores.l1Recruitment.score == null &&
        scores.l2AiDisruption.score == null &&
        scores.l3Demographic.score == null;
      const noImpact = scores.impact.totalThb == null || scores.impact.totalThb === 0;
      const insufficient = allLNull && noImpact;

      let aiNarrativeTh: string | null = null;
      let aiNarrativeEn: string | null = null;
      let aiMeasures: ReturnType<typeof RiskAssessmentSchema.parse>['measures'] = [];
      let aiConfidence: number | null = null;
      let aiInferenceId: string | null = null;
      let aiPayload: unknown = null;

      if (ai && !insufficient && !dryRun) {
        try {
          const aiInput = await buildAiInput(t.id, scores);
          if (aiInput) {
            const messages = buildRiskAssessmentMessages(aiInput);
            const response = await ai.extractStructured(
              {
                ctx: {
                  module: 'risks',
                  kind: 'risk-assessment',
                  userId: null,
                  traceId: `risk-assessment-${t.id}`,
                },
                messages,
                methodVersion: RISK_ASSESSMENT_VERSION,
                maxOutputTokens: 8000,
              },
              RiskAssessmentSchema,
            );
            aiInferenceId = response.aiInferenceId;
            aiCallCost += response.cost.usd;
            aiNarrativeTh = response.parsed.narrativeTh;
            aiNarrativeEn = response.parsed.narrativeEn;
            aiMeasures = response.parsed.measures;
            aiConfidence = response.parsed.confidence;
            aiPayload = response.parsed;
          }
        } catch (aiErr) {
          console.warn(`    AI call failed: ${(aiErr as Error).message}`);
        }
      }

      // Persist
      if (!dryRun) {
        const dataGaps = [
          ...scores.l1Recruitment.gaps,
          ...scores.l2AiDisruption.gaps,
          ...scores.l3Demographic.gaps,
          ...scores.impact.gaps,
        ];

        const created = await prisma.riskAssessment.create({
          data: {
            programId: t.id,
            l1RecruitmentScore: scores.l1Recruitment.score,
            l1RecruitmentConfidence: scores.l1Recruitment.confidence,
            l2AiDisruptionScore: scores.l2AiDisruption.score,
            l2AiDisruptionConfidence: scores.l2AiDisruption.confidence,
            l3DemographicScore: scores.l3Demographic.score,
            l3DemographicConfidence: scores.l3Demographic.confidence,
            compositeScore: scores.composite,
            tier: scores.tier,
            directRevenueAtRiskThb:
              scores.impact.directRevenueAtRiskThb != null
                ? new Prisma.Decimal(scores.impact.directRevenueAtRiskThb)
                : null,
            strandedCostThb:
              scores.impact.strandedCostThb != null
                ? new Prisma.Decimal(scores.impact.strandedCostThb)
                : null,
            methodologyVersion: RISK_SCORING_VERSION,
            aiInferenceId,
            confidence: aiConfidence,
            narrativeTh: aiNarrativeTh,
            narrativeEn: aiNarrativeEn,
            dataGapsJson: dataGaps,
            payloadJson: aiPayload as Prisma.InputJsonValue,
          },
        });

        if (aiMeasures.length > 0) {
          await prisma.riskMeasure.createMany({
            data: aiMeasures.map((m) => ({
              assessmentId: created.id,
              kind: m.kind,
              titleTh: m.titleTh,
              titleEn: m.titleEn,
              rationaleTh: m.rationaleTh,
              rationaleEn: m.rationaleEn || null,
              costClass: m.costClass,
              horizon: m.horizon,
              expectedDeltaThb:
                m.expectedDeltaThb != null ? new Prisma.Decimal(m.expectedDeltaThb) : null,
              priority: m.priority,
              evidenceJson: m.evidence as Prisma.InputJsonValue,
            })),
          });
        }

        if (breaches.length > 0) {
          await prisma.riskIndicatorBreach.createMany({
            data: breaches.map((b) => ({
              programId: b.programId,
              indicatorSlug: b.indicatorSlug,
              value: b.value,
              severity: b.severity,
              freshnessDate: b.freshnessDate,
              methodologyVersion: RISK_SCORING_VERSION,
            })),
          });
        }
      }

      const elapsedMs = Date.now() - start;
      console.log(
        `  [OK]   ${t.code} ${t.nameTh.slice(0, 40).padEnd(40)} composite=${scores.composite?.toFixed(0) ?? '-'} tier=${scores.tier} measures=${aiMeasures.length} (${(elapsedMs / 1000).toFixed(1)}s)`,
      );
      logLine({
        programId: t.id,
        code: t.code,
        status: 'OK',
        composite: scores.composite,
        tier: scores.tier,
        l1: scores.l1Recruitment.score,
        l2: scores.l2AiDisruption.score,
        l3: scores.l3Demographic.score,
        directThb: scores.impact.directRevenueAtRiskThb,
        strandedThb: scores.impact.strandedCostThb,
        aiMeasures: aiMeasures.length,
        aiConfidence,
        aiCostUsd: aiCallCost,
        elapsedMs,
      });
      succeeded += 1;
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      console.log(`  [FAIL] ${t.code} ${t.nameTh}  ${message}`);
      logLine({ programId: t.id, code: t.code, status: 'FAILED', error: message });
      failed += 1;
    }
  }

  if (!dryRun && succeeded > 0) {
    const normalised = await normaliseImpactScores('BACHELOR');
    console.log(`\n[risks-assess] normalised impactScore for ${normalised} program(s)`);
  }

  console.log('');
  console.log(`[risks-assess] DONE`);
  console.log(`  succeeded:        ${succeeded}`);
  console.log(`  failed:           ${failed}`);
  console.log(`  skipped (no data): ${skippedNoData}`);
  console.log(`  AI cost (USD):    $${aiCallCost.toFixed(4)}`);
  console.log(`  log:              ${LOG_PATH}`);
}

main()
  .catch((err) => {
    console.error('[risks-assess] failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
