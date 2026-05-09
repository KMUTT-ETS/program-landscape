// PDPA retention sweep — enforces the windows declared in
// `docs/pdpa.md`:
//
//   AuditLog        — full-row retention 7 years (Thai Accounting Act)
//   AiInference     — payload-text 2 years; aggregate 7 years; then full delete
//
// The functions in this module are deliberately Prisma-typed but
// accept an injectable Prisma-shaped client so tests can mock without
// a real DB. The runner (scripts/pdpa/retention-sweep.ts) wires the
// real `prisma` from @kku/db.

export interface RetentionWindowsDays {
  /** Hard-delete AuditLog rows older than this many days. */
  auditLogFullRetention: number;
  /** Null-out prompt + response on AiInference rows older than this. */
  aiInferencePayloadRetention: number;
  /** Hard-delete AiInference rows (incl. aggregates) older than this. */
  aiInferenceFullRetention: number;
}

// Defaults from docs/pdpa.md §retention.
export const DEFAULT_WINDOWS: RetentionWindowsDays = {
  auditLogFullRetention: 7 * 365,
  aiInferencePayloadRetention: 2 * 365,
  aiInferenceFullRetention: 7 * 365,
};

// Resolved cut-off timestamps for a given `now`. Pure function — easy
// to unit-test the date math without touching the DB.
export interface RetentionCutoffs {
  auditLogDeleteBefore: Date;
  aiInferencePayloadRedactBefore: Date;
  aiInferenceDeleteBefore: Date;
}

export function computeRetentionCutoffs(
  now: Date,
  windows: RetentionWindowsDays = DEFAULT_WINDOWS,
): RetentionCutoffs {
  const ms = (days: number) => days * 24 * 60 * 60 * 1000;
  return {
    auditLogDeleteBefore: new Date(now.getTime() - ms(windows.auditLogFullRetention)),
    aiInferencePayloadRedactBefore: new Date(
      now.getTime() - ms(windows.aiInferencePayloadRetention),
    ),
    aiInferenceDeleteBefore: new Date(
      now.getTime() - ms(windows.aiInferenceFullRetention),
    ),
  };
}

// Minimum interface the sweeper needs from a Prisma client. Lets us
// inject a mock in tests. Loose `unknown` typing on `where` because
// the real Prisma client carries deeply-generic conditional types we
// don't want to reproduce here — unit tests bypass the DB anyway.
export interface RetentionPrismaLike {
  auditLog: {
    deleteMany(args: { where: unknown }): Promise<{ count: number }>;
  };
  aiInference: {
    updateMany(args: {
      where: unknown;
      data: Record<string, null>;
    }): Promise<{ count: number }>;
    deleteMany(args: { where: unknown }): Promise<{ count: number }>;
  };
}

export interface RetentionResult {
  cutoffs: RetentionCutoffs;
  auditLogDeleted: number;
  aiInferencePayloadRedacted: number;
  aiInferenceDeleted: number;
  dryRun: boolean;
  windowsDays: RetentionWindowsDays;
}

// Runs the sweep. Pure aside from the injected client + clock.
//
//   await runRetentionSweep({ prisma, now: new Date() });               // wet
//   await runRetentionSweep({ prisma, now: new Date(), dryRun: true }); // counts only
export async function runRetentionSweep(opts: {
  prisma: RetentionPrismaLike;
  now: Date;
  windows?: RetentionWindowsDays;
  dryRun?: boolean;
}): Promise<RetentionResult> {
  const { prisma, now } = opts;
  const windows = opts.windows ?? DEFAULT_WINDOWS;
  const dryRun = opts.dryRun ?? false;
  const cutoffs = computeRetentionCutoffs(now, windows);

  if (dryRun) {
    // For dry-run we'd ideally call countMany but the minimal interface
    // keeps the surface narrow. The runner script handles dry-run by
    // calling Prisma.count* directly (see scripts/pdpa/retention-sweep.ts).
    return {
      cutoffs,
      auditLogDeleted: 0,
      aiInferencePayloadRedacted: 0,
      aiInferenceDeleted: 0,
      dryRun: true,
      windowsDays: windows,
    };
  }

  // Order matters:
  //   1. Hard-delete AiInference rows past full retention FIRST so we
  //      don't waste a redact pass on rows that are about to be deleted.
  //   2. Redact payload on the remaining old AiInference rows.
  //   3. Hard-delete AuditLog past full retention.
  //
  // The `OR` payload-redact clause only matches rows that still hold
  // text in `prompt` or `response`; running again is idempotent.
  const aiInferenceDeleted = (
    await prisma.aiInference.deleteMany({
      where: { createdAt: { lt: cutoffs.aiInferenceDeleteBefore } },
    })
  ).count;

  const aiInferencePayloadRedacted = (
    await prisma.aiInference.updateMany({
      where: {
        createdAt: { lt: cutoffs.aiInferencePayloadRedactBefore },
        OR: [{ prompt: { not: null } }, { response: { not: null } }],
      },
      data: { prompt: null, response: null },
    })
  ).count;

  const auditLogDeleted = (
    await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoffs.auditLogDeleteBefore } },
    })
  ).count;

  return {
    cutoffs,
    auditLogDeleted,
    aiInferencePayloadRedacted,
    aiInferenceDeleted,
    dryRun: false,
    windowsDays: windows,
  };
}
