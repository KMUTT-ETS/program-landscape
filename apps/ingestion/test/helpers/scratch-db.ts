import { describe } from 'vitest';

/**
 * True only when DATABASE_URL names a database ending in `_test`. The URL is
 * parsed, never printed: it carries credentials.
 */
function pointsAtScratchDb(): boolean {
  const raw = process.env.DATABASE_URL;
  if (!raw) return false;
  try {
    const name = decodeURIComponent(new URL(raw).pathname.replace(/^\//, ''));
    return name.endsWith('_test');
  } catch {
    return false;
  }
}

/** Whether DB-touching hooks and tests may run against the current database. */
export const SCRATCH_DB: boolean = pointsAtScratchDb();

/**
 * `describe` for suites that write to the database: skipped unless the
 * database name ends with `_test`. Top-level hooks in the same file must also
 * check `SCRATCH_DB`, because hooks outside the suite are not skipped by it.
 */
export const describeScratchDb = describe.skipIf(!SCRATCH_DB);
