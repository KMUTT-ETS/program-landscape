// PDPA retention sweep — wired runner.
//
// Usage:
//   pnpm tsx scripts/pdpa/retention-sweep.ts            # apply
//   pnpm tsx scripts/pdpa/retention-sweep.ts --dry-run  # report what would happen
//
// The window logic + the actual deleteMany / updateMany live in
// `@kku/db/retention` so they can be unit-tested without a real DB.
// This file is the operator-facing entry point.

import { prisma } from '@kku/db';
import {
  computeRetentionCutoffs,
  DEFAULT_WINDOWS,
  runRetentionSweep,
} from '@kku/db';

async function main(): Promise<void> {
  const dryRun = process.argv.includes('--dry-run');
  const now = new Date();

  if (dryRun) {
    const cutoffs = computeRetentionCutoffs(now, DEFAULT_WINDOWS);
    const [auditLogToDelete, aiPayloadToRedact, aiToDelete] = await Promise.all([
      prisma.auditLog.count({
        where: { createdAt: { lt: cutoffs.auditLogDeleteBefore } },
      }),
      prisma.aiInference.count({
        where: {
          createdAt: { lt: cutoffs.aiInferencePayloadRedactBefore },
          OR: [{ prompt: { not: null } }, { response: { not: null } }],
        },
      }),
      prisma.aiInference.count({
        where: { createdAt: { lt: cutoffs.aiInferenceDeleteBefore } },
      }),
    ]);

    process.stdout.write(
      JSON.stringify(
        {
          dryRun: true,
          generatedAt: now.toISOString(),
          windowsDays: DEFAULT_WINDOWS,
          cutoffs: {
            auditLogDeleteBefore: cutoffs.auditLogDeleteBefore.toISOString(),
            aiInferencePayloadRedactBefore: cutoffs.aiInferencePayloadRedactBefore.toISOString(),
            aiInferenceDeleteBefore: cutoffs.aiInferenceDeleteBefore.toISOString(),
          },
          wouldDelete: {
            auditLog: auditLogToDelete,
            aiInference: aiToDelete,
          },
          wouldRedactPayload: {
            aiInference: aiPayloadToRedact,
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    const result = await runRetentionSweep({ prisma, now });
    process.stdout.write(
      JSON.stringify(
        {
          ...result,
          generatedAt: now.toISOString(),
          cutoffs: {
            auditLogDeleteBefore: result.cutoffs.auditLogDeleteBefore.toISOString(),
            aiInferencePayloadRedactBefore: result.cutoffs.aiInferencePayloadRedactBefore.toISOString(),
            aiInferenceDeleteBefore: result.cutoffs.aiInferenceDeleteBefore.toISOString(),
          },
        },
        null,
        2,
      ) + '\n',
    );
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  process.stderr.write(
    `retention-sweep failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  await prisma.$disconnect();
  process.exit(2);
});
