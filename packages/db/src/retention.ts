// PDPA retention sweep — enforces the windows declared in
// `docs/pdpa.md`:
//
//   AuditLog             — full-row retention 7 years (Thai Accounting Act)
//   AiInference          — payload-text 2 years; aggregate 7 years; then full delete
//   ScholarFetchArchive  — full-row retention 90 days
//   ScholarBindAttempt   — free-text redaction at 90 days; row kept
//
// WHY THE TWO SCHOLAR RULES DIFFER, AND WHY ScholarFetchRun HAS NONE.
//
// `ScholarFetchArchive` holds a whole scraped Google Scholar page verbatim.
// It exists so a parse that turns out to be wrong months later can be
// reprocessed instead of re-scraped, and that value expires: past 90 days the
// profile has moved on and a re-fetch is both cheaper and more accurate than
// the stale copy. It is also the largest personal-data payload this feature
// writes — a person's full publication list, as displayed — so it is a hard
// delete, not a redaction.
//
// `ScholarBindAttempt` is a COST ledger: it records the ScrapingBee credits
// each verification page billed, including on refusals, which is the entire
// reason the table exists. Deleting the row would delete the spend record, so
// the rule redacts only the identifying free text — the pasted URL, the
// profile name it displayed, and the error text — and keeps the row. This is
// the same aggregate-survives-the-payload shape the AiInference rule already
// uses; adding a second mechanism here is how one of them stops running
// unnoticed.
//
// `ScholarFetchRun` is deliberately NOT swept. It is the QUOTA ledger — the
// rolling-30-day allowance is computed by querying it — so deleting old rows
// would hand people a fresh allowance, and it carries no free text beyond an
// error string and the search query already implied by the staff record.
//
// The functions in this module are deliberately Prisma-typed but
// accept an injectable Prisma-shaped client so tests can mock without
// a real DB. The runner (scripts/pdpa/retention-sweep.ts) wires the
// real `prisma` from @kku/db.

export interface RetentionWindowsDays {
  /** Hard-delete AuditLog rows older than this many days. */
  auditLogFullRetention: number;
  /** Redact prompt + response on AiInference rows older than this. */
  aiInferencePayloadRetention: number;
  /** Hard-delete AiInference rows (incl. aggregates) older than this. */
  aiInferenceFullRetention: number;
  /** Hard-delete ScholarFetchArchive rows (raw scraped pages) older than this. */
  scholarArchiveFullRetention: number;
  /** Redact url / profileName / errorText on ScholarBindAttempt rows older
   *  than this. The row — and with it the credit ledger — is kept. */
  scholarBindAttemptTextRetention: number;
}

// Defaults from docs/pdpa.md §retention.
export const DEFAULT_WINDOWS: RetentionWindowsDays = {
  auditLogFullRetention: 7 * 365,
  aiInferencePayloadRetention: 2 * 365,
  aiInferenceFullRetention: 7 * 365,
  scholarArchiveFullRetention: 90,
  scholarBindAttemptTextRetention: 90,
};

/** Written over a free-text column once its row passes the retention window.
 *
 *  A SENTINEL, not a null, because the columns this replaces are NOT NULL:
 *  `ScholarBindAttempt.url`, `AiInference.prompt` and `AiInference.response`
 *  all are. A visible marker is preferable anyway — an operator reading the
 *  row can tell the difference between "nobody typed anything" and "we no
 *  longer keep what they typed".
 *
 *  FIXED 2026-09-08. The AiInference rule previously wrote `null` into those
 *  two NOT NULL columns, so `updateMany` threw and the payload redaction has
 *  never actually run; the dry-run report threw on the matching
 *  `{ not: null }` predicate for the same reason. Both now go through this
 *  sentinel. See docs/pdpa.md §"Audit log retention". */
export const REDACTED_TEXT = '[redacted]';

// Resolved cut-off timestamps for a given `now`. Pure function — easy
// to unit-test the date math without touching the DB.
export interface RetentionCutoffs {
  auditLogDeleteBefore: Date;
  aiInferencePayloadRedactBefore: Date;
  aiInferenceDeleteBefore: Date;
  scholarArchiveDeleteBefore: Date;
  scholarBindAttemptRedactBefore: Date;
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
    scholarArchiveDeleteBefore: new Date(
      now.getTime() - ms(windows.scholarArchiveFullRetention),
    ),
    scholarBindAttemptRedactBefore: new Date(
      now.getTime() - ms(windows.scholarBindAttemptTextRetention),
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
      data: Record<string, string | null>;
    }): Promise<{ count: number }>;
    deleteMany(args: { where: unknown }): Promise<{ count: number }>;
  };
  scholarFetchArchive: {
    deleteMany(args: { where: unknown }): Promise<{ count: number }>;
  };
  scholarBindAttempt: {
    updateMany(args: {
      where: unknown;
      data: Record<string, string | null>;
    }): Promise<{ count: number }>;
  };
}

export interface RetentionResult {
  cutoffs: RetentionCutoffs;
  auditLogDeleted: number;
  aiInferencePayloadRedacted: number;
  aiInferenceDeleted: number;
  scholarArchiveDeleted: number;
  scholarBindAttemptTextRedacted: number;
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
      scholarArchiveDeleted: 0,
      scholarBindAttemptTextRedacted: 0,
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
  // The `OR` payload-redact clause only matches rows that still hold real
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
        OR: [
          { prompt: { not: REDACTED_TEXT } },
          { response: { not: REDACTED_TEXT } },
        ],
      },
      data: { prompt: REDACTED_TEXT, response: REDACTED_TEXT },
    })
  ).count;

  const auditLogDeleted = (
    await prisma.auditLog.deleteMany({
      where: { createdAt: { lt: cutoffs.auditLogDeleteBefore } },
    })
  ).count;

  // 4. Google Scholar. The archive is a hard delete; the bind-attempt rule
  //    only rewrites free text, and its `NOT REDACTED_TEXT` clause is what
  //    makes re-running it a no-op rather than a full-table update.
  const scholarArchiveDeleted = (
    await prisma.scholarFetchArchive.deleteMany({
      where: { createdAt: { lt: cutoffs.scholarArchiveDeleteBefore } },
    })
  ).count;

  const scholarBindAttemptTextRedacted = (
    await prisma.scholarBindAttempt.updateMany({
      where: {
        createdAt: { lt: cutoffs.scholarBindAttemptRedactBefore },
        url: { not: REDACTED_TEXT },
      },
      data: { url: REDACTED_TEXT, profileName: null, errorText: null },
    })
  ).count;

  return {
    cutoffs,
    auditLogDeleted,
    aiInferencePayloadRedacted,
    aiInferenceDeleted,
    scholarArchiveDeleted,
    scholarBindAttemptTextRedacted,
    dryRun: false,
    windowsDays: windows,
  };
}
