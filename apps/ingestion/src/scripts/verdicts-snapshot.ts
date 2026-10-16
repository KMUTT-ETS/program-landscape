// ─────────────────────────────────────────────────────────────────────────────
// verdicts:snapshot — capture every canonical program's current verdicts.
//
// Closes the writer half of evaluation-pipeline.md §13 gap #6. Quarterly
// snapshots feed `pnpm verdicts:diff`, which produces an analyst worklist
// of programs whose verdicts flipped or whose drivers moved 20+ pts
// without flipping (band-edge instability).
//
// What's captured per program:
//   - Health Score (overall + 5 dimensions + completeness %)
//   - Lifecycle Verdict (verdict + trajectory + full driver payload)
//   - Risk Score (latest RiskAssessment row's tier + composite + L1/L2/L3)
//   - Methodology bundle stamp (LANDSCAPE_METHODOLOGY_BUNDLE tag + fingerprint)
//
// Risk numbers are read from the latest RiskAssessment row (the
// analyst-driven `pnpm risks:assess` writes those). Health + Lifecycle
// are re-computed from scratch — they're fast and deterministic.
//
// Usage:
//   pnpm verdicts:snapshot                # all canonical programs
//   pnpm verdicts:snapshot --limit 10     # smoke-test with 10 programs
//   pnpm verdicts:snapshot --program <code-or-id>
// ─────────────────────────────────────────────────────────────────────────────

import { loadOrganization,
  prisma,
  computeHealthScores,
  programLifecycleVerdict,
  LANDSCAPE_METHODOLOGY_BUNDLE,
  Prisma,
  type RiskTier,
} from '@kku/db';

interface CliArgs {
  limit: number | null;
  programArg: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { limit: null, programArg: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit') args.limit = Number(argv[++i] ?? 0) || null;
    else if (a === '--program') args.programArg = String(argv[++i] ?? '');
  }
  return args;
}

async function main(): Promise<void> {
  await loadOrganization();
  const args = parseArgs(process.argv.slice(2));

  const where: Prisma.ProgramWhereInput = {
    status: 'ACTIVE',
    sequenceNoFromSheet: { not: null },
  };
  if (args.programArg) {
    where.OR = [{ code: args.programArg }, { id: args.programArg }];
  }
  const programs = await prisma.program.findMany({
    where,
    select: { id: true, code: true, nameEn: true, level: true },
    orderBy: { code: 'asc' },
    ...(args.limit ? { take: args.limit } : {}),
  });
  console.log(`Snapshot universe: ${programs.length} canonical programs`);
  console.log(`Bundle: ${LANDSCAPE_METHODOLOGY_BUNDLE.tag}+${LANDSCAPE_METHODOLOGY_BUNDLE.fingerprint}`);
  console.log('');

  const snapshotAt = new Date();
  let written = 0;
  let failed = 0;
  let withRisk = 0;

  for (const p of programs) {
    try {
      const [healthRows, lifecycle, latestRisk] = await Promise.all([
        computeHealthScores('program', p.id),
        programLifecycleVerdict(p.id).catch(() => null),
        prisma.riskAssessment.findFirst({
          where: { programId: p.id },
          orderBy: { assessedAt: 'desc' },
          select: {
            tier: true,
            compositeScore: true,
            l1RecruitmentScore: true,
            l2AiDisruptionScore: true,
            l3DemographicScore: true,
          },
        }),
      ]);
      const health = healthRows[0] ?? null;
      if (latestRisk) withRisk += 1;

      const payload = {
        bundle: {
          tag: LANDSCAPE_METHODOLOGY_BUNDLE.tag,
          fingerprint: LANDSCAPE_METHODOLOGY_BUNDLE.fingerprint,
          previewMethodologies: LANDSCAPE_METHODOLOGY_BUNDLE.previewMethodologies,
        },
        health,
        lifecycle,
        risk: latestRisk,
      };

      await prisma.verdictSnapshot.create({
        data: {
          programId: p.id,
          snapshotAt,
          bundleTag: LANDSCAPE_METHODOLOGY_BUNDLE.tag,
          bundleFingerprint: LANDSCAPE_METHODOLOGY_BUNDLE.fingerprint,
          healthOverall: health?.overall.score ?? null,
          healthAttractiveness: health?.dimensions.attractiveness.score ?? null,
          healthFinancial: health?.dimensions.financial.score ?? null,
          healthCapability: health?.dimensions.capability.score ?? null,
          healthOutcomes: health?.dimensions.outcomes.score ?? null,
          healthRelevance: health?.dimensions.relevance.score ?? null,
          healthCompletenessPct: health?.overall.dataCompletenessPct ?? 0,
          lifecycleVerdict: lifecycle?.verdict ?? null,
          lifecycleTrajectory: lifecycle?.trajectoryScore ?? null,
          riskTier: (latestRisk?.tier ?? null) as RiskTier | null,
          riskComposite: latestRisk?.compositeScore ?? null,
          riskL1: latestRisk?.l1RecruitmentScore ?? null,
          riskL2: latestRisk?.l2AiDisruptionScore ?? null,
          riskL3: latestRisk?.l3DemographicScore ?? null,
          payloadJson: payload as unknown as Prisma.InputJsonValue,
        },
      });
      written += 1;
      if (written % 25 === 0) {
        console.log(`  ${written}/${programs.length} written…`);
      }
    } catch (err) {
      failed += 1;
      console.error(`  ✗ ${p.code} failed:`, err instanceof Error ? err.message : err);
    }
  }

  console.log(`\nDone. ${written} written, ${failed} failed (${withRisk} carried risk data).`);
  console.log(`Snapshot timestamp: ${snapshotAt.toISOString()}`);
  console.log(`\nNext step: \`pnpm verdicts:diff\` once a second snapshot exists.`);

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
