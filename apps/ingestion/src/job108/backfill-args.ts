// ─────────────────────────────────────────────────────────────────────────────
// Argument parsing for `pnpm job108:backfill` (apps/ingestion/src/scripts/
// job108-backfill.ts), split into its own module — same reason
// `jobthai/fields.ts` holds `parseFieldsArgs` rather than the CLI script: the
// script file itself calls `main()` at module load, so importing it for a
// unit test would run the real thing. This module has no side effects and is
// safe to import directly from a test.
//
// These flags decide whether money gets spent, so the accept/reject rules are
// unit tested directly rather than trusted. --apply is required to fetch an
// announcement page, spend a model call, or write anything. Any flag other
// than --apply / --limit=N / --retry-failed is refused outright — a typo
// that silently dry-ran would waste an operator's afternoon, and one that
// silently applied would waste their money.
// ─────────────────────────────────────────────────────────────────────────────

export interface Job108BackfillArgs {
  apply: boolean;
  limit: number | null;
  retryFailed: boolean;
}

export type ParsedJob108BackfillArgs =
  | { ok: true; args: Job108BackfillArgs }
  | { ok: false; error: string };

const ACCEPTED_FLAGS = '--apply, --limit=N (N a positive integer), --retry-failed';

export function parseBackfillArgs(argv: string[]): ParsedJob108BackfillArgs {
  let apply = false;
  let limit: number | null = null;
  let retryFailed = false;

  for (const arg of argv) {
    if (arg === '--apply') {
      apply = true;
    } else if (arg === '--retry-failed') {
      retryFailed = true;
    } else if (arg.startsWith('--limit=')) {
      const raw = arg.slice('--limit='.length);
      const n = Number(raw);
      if (!Number.isInteger(n) || n <= 0) {
        return {
          ok: false,
          error: `--limit must be a positive integer, got "${raw}". Accepted flags: ${ACCEPTED_FLAGS}`,
        };
      }
      limit = n;
    } else {
      return { ok: false, error: `Unrecognised flag "${arg}". Accepted flags: ${ACCEPTED_FLAGS}` };
    }
  }

  return { ok: true, args: { apply, limit, retryFailed } };
}
