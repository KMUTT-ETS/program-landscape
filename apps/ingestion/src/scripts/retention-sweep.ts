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
// `@kku/db/retention` so they can be unit-tested without a real DB; the
// page-view roll-up-then-delete rule lives in `@kku/db/usage-retention`.
// This file is the operator-facing entry point.

import { prisma } from '@kku/db';
import {
  computeRetentionCutoffs,
  DEFAULT_WINDOWS,
  REDACTED_TEXT,
  rollupPageViews,
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
      pageViewPlan,
    ] = await Promise.all([
      prisma.auditLog.count({
        where: { createdAt: { lt: cutoffs.auditLogDeleteBefore } },
      }),
      prisma.aiInference.count({
        where: {
          createdAt: { lt: cutoffs.aiInferencePayloadRedactBefore },
          OR: [{ prompt: { not: REDACTED_TEXT } }, { response: { not: REDACTED_TEXT } }],
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
      // The page-view rule is a roll-up, not a count, so its dry run is the
      // rule itself with `dryRun: true` rather than a separate `count()` that
      // could drift from what the wet run would actually do.
      rollupPageViews({ prisma, cutoff: cutoffs.pageViewRollupBefore, dryRun: true }),
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
            scholarBindAttemptRedactBefore: cutoffs.scholarBindAttemptRedactBefore.toISOString(),
            pageViewRollupBefore: cutoffs.pageViewRollupBefore.toISOString(),
          },
          wouldDelete: {
            auditLog: auditLogToDelete,
            aiInference: aiToDelete,
            scholarFetchArchive: scholarArchiveToDelete,
            // Only ever deleted after the day they belong to is written to
            // page_view_daily — the two numbers below move together.
            pageViews: pageViewPlan.rowsDeleted,
          },
          wouldRedactPayload: {
            aiInference: aiPayloadToRedact,
            scholarBindAttempt: scholarBindTextToRedact,
          },
          wouldRollUp: {
            pageViewDays: pageViewPlan.daysRolledUp,
            days: pageViewPlan.days,
          },
        },
        null,
        2,
      ) + '\n',
    );
  } else {
    // An explicit pick rather than `prisma` itself, so the sweep can only
    // reach the four delegates the rules are allowed to touch (notably NOT
    // `scholarFetchRun`, the quota ledger) and a renamed one fails typecheck.
    // The raw trio is the page-view rule's surface; the methods are wrapped in
    // arrows rather than passed by reference so they keep their `this`.
    const client: RetentionPrismaLike = {
      auditLog: prisma.auditLog,
      aiInference: prisma.aiInference,
      scholarFetchArchive: prisma.scholarFetchArchive,
      scholarBindAttempt: prisma.scholarBindAttempt,
      $queryRaw: (q) => prisma.$queryRaw(q),
      $executeRaw: (q) => prisma.$executeRaw(q),
      $transaction: (fn, options) => prisma.$transaction(fn, options),
    };
    const result = await runRetentionSweep({ prisma: client, now });
    process.stdout.write(
      JSON.stringify(
        {
          ...result,
          generatedAt: now.toISOString(),
          cutoffs: {
            auditLogDeleteBefore: result.cutoffs.auditLogDeleteBefore.toISOString(),
            aiInferencePayloadRedactBefore:
              result.cutoffs.aiInferencePayloadRedactBefore.toISOString(),
            aiInferenceDeleteBefore: result.cutoffs.aiInferenceDeleteBefore.toISOString(),
            scholarArchiveDeleteBefore: result.cutoffs.scholarArchiveDeleteBefore.toISOString(),
            scholarBindAttemptRedactBefore:
              result.cutoffs.scholarBindAttemptRedactBefore.toISOString(),
            pageViewRollupBefore: result.cutoffs.pageViewRollupBefore.toISOString(),
          },
        },
        null,
        2,
      ) + '\n',
    );

    // A partial night is still a reported night: the JSON above is already on
    // stdout (and so in the tee'd evidence file) with the four destructive
    // rules' counts and the days that did commit. What must not happen is
    // exiting 0 — the days from `pageViewFailedDay` onwards are still raw, and
    // only a non-zero status makes systemd record the failure and an operator
    // look at the report.
    if (result.pageViewFailedDay !== undefined) {
      process.stderr.write(
        `retention-sweep: page-view roll-up stopped at ${result.pageViewFailedDay}: ${result.pageViewFailedReason}\n`,
      );
      await prisma.$disconnect();
      process.exit(1);
    }
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  const message = err instanceof Error ? err.message : String(err);
  // The tee'd file is the evidence the control ran; a failed night must leave a
  // readable record, not a 0-byte file. Without this the only trace is on
  // stderr, which `tee` never sees.
  process.stdout.write(
    JSON.stringify({ ok: false, generatedAt: new Date().toISOString(), error: message }, null, 2) +
      '\n',
  );
  process.stderr.write(`retention-sweep failed: ${message}\n`);
  await prisma.$disconnect();
  process.exit(1);
});
