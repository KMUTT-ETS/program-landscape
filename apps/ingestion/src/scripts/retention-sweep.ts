// PDPA retention sweep — wired runner.
//
// Usage:
//   pnpm tsx scripts/pdpa/retention-sweep.ts            # dry-run (default; reports only)
//   pnpm tsx scripts/pdpa/retention-sweep.ts --dry-run  # same, explicit
//   pnpm tsx scripts/pdpa/retention-sweep.ts --apply    # actually delete / redact
//
// Dry-run unless --apply is given — every operator script here is read-only
// by default (house rule). Any argument other than --dry-run / --apply is
// rejected rather than silently ignored, so a typo like --dryrun can never
// be misread as --apply.
//
// Lives under apps/ingestion/src/scripts/ (rather than scripts/pdpa/) so it
// is picked up by apps/ingestion/scripts/bundle-pipeline-scripts.ts and
// shipped self-contained inside the ingestion prod image — see the TARGETS
// comment there. scripts/pdpa/retention-sweep.ts is a two-line shim that
// re-exports this file so the `pnpm tsx scripts/pdpa/retention-sweep.ts`
// dev invocation keeps working unchanged.
//
// The window logic + the actual deleteMany / updateMany live in
// `@kku/db/retention` so they can be unit-tested without a real DB.
// This file is the operator-facing entry point.

import { prisma } from '@kku/db';
import {
  computeRetentionCutoffs,
  DEFAULT_WINDOWS,
  REDACTED_TEXT,
  runRetentionSweep,
  type RetentionPrismaLike,
} from '@kku/db';

async function main(): Promise<void> {
  // Dry-run unless --apply is given (house rule: every operator script is
  // read-only by default). Unknown flags are rejected rather than ignored —
  // a mistyped `--dryrun` must never become a delete.
  const argv = process.argv.slice(2);
  const unknown = argv.filter((a) => a !== '--dry-run' && a !== '--apply');
  if (unknown.length > 0) {
    process.stderr.write(`retention-sweep: unrecognised argument(s): ${unknown.join(' ')}\n`);
    process.exit(1);
  }
  const dryRun = argv.includes('--dry-run') || !argv.includes('--apply');
  const now = new Date();

  if (dryRun) {
    const cutoffs = computeRetentionCutoffs(now, DEFAULT_WINDOWS);
    const [
      auditLogToDelete,
      aiPayloadToRedact,
      aiToDelete,
      scholarArchiveToDelete,
      scholarBindTextToRedact,
    ] = await Promise.all([
      prisma.auditLog.count({
        where: { createdAt: { lt: cutoffs.auditLogDeleteBefore } },
      }),
      prisma.aiInference.count({
        where: {
          createdAt: { lt: cutoffs.aiInferencePayloadRedactBefore },
          OR: [
            { prompt: { not: REDACTED_TEXT } },
            { response: { not: REDACTED_TEXT } },
          ],
        },
      }),
      prisma.aiInference.count({
        where: { createdAt: { lt: cutoffs.aiInferenceDeleteBefore } },
      }),
      prisma.scholarFetchArchive.count({
        where: { createdAt: { lt: cutoffs.scholarArchiveDeleteBefore } },
      }),
      prisma.scholarBindAttempt.count({
        where: {
          createdAt: { lt: cutoffs.scholarBindAttemptRedactBefore },
          url: { not: REDACTED_TEXT },
        },
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
            scholarArchiveDeleteBefore: cutoffs.scholarArchiveDeleteBefore.toISOString(),
            scholarBindAttemptRedactBefore:
              cutoffs.scholarBindAttemptRedactBefore.toISOString(),
          },
          wouldDelete: {
            auditLog: auditLogToDelete,
            aiInference: aiToDelete,
            scholarFetchArchive: scholarArchiveToDelete,
          },
          wouldRedactPayload: {
            aiInference: aiPayloadToRedact,
            scholarBindAttempt: scholarBindTextToRedact,
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    // RetentionPrismaLike types `where` as unknown, which strictFunctionTypes
    // rejects for the real client (contravariance). Build the pick explicitly
    // so a renamed delegate still fails typecheck; a later task widens the type.
    const client = {
      auditLog: prisma.auditLog,
      aiInference: prisma.aiInference,
      scholarFetchArchive: prisma.scholarFetchArchive,
      scholarBindAttempt: prisma.scholarBindAttempt,
    } as unknown as RetentionPrismaLike;
    const result = await runRetentionSweep({ prisma: client, now });
    process.stdout.write(
      JSON.stringify(
        {
          ...result,
          generatedAt: now.toISOString(),
          cutoffs: {
            auditLogDeleteBefore: result.cutoffs.auditLogDeleteBefore.toISOString(),
            aiInferencePayloadRedactBefore: result.cutoffs.aiInferencePayloadRedactBefore.toISOString(),
            aiInferenceDeleteBefore: result.cutoffs.aiInferenceDeleteBefore.toISOString(),
            scholarArchiveDeleteBefore: result.cutoffs.scholarArchiveDeleteBefore.toISOString(),
            scholarBindAttemptRedactBefore:
              result.cutoffs.scholarBindAttemptRedactBefore.toISOString(),
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
  process.exit(1);
});
