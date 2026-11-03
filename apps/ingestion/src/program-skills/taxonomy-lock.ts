import { prisma } from '@kku/db';

/** Constant key of the cross-process lock that serialises skill taxonomy builds. */
export const SKILL_TAXONOMY_LOCK_KEY = 'skill-taxonomy-build';

// A normaliser run makes model calls for minutes; the lock is held that long.
const LOCK_HOLD_MS = 6 * 60 * 60 * 1000;

interface LockTx {
  $executeRaw: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<unknown>;
}

export interface LockClient {
  $transaction: <T>(
    fn: (tx: LockTx) => Promise<T>,
    options: { timeout: number; maxWait: number },
  ) => Promise<T>;
}

/**
 * Runs `fn` while holding a Postgres advisory transaction lock, so concurrent
 * pipeline jobs (AI_JOBS_CONCURRENCY > 1) and the normaliser CLI never run the
 * find-then-create skill promotion at the same moment. A second caller waits,
 * then finds the first caller's skills already present by name. The work inside
 * `fn` uses its own connections; the transaction exists only to hold the lock.
 * Do NOT nest calls: the inner one would wait on the outer for ever.
 */
export async function withSkillTaxonomyLock<T>(
  fn: () => Promise<T>,
  client: LockClient = prisma as unknown as LockClient,
): Promise<T> {
  return client.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${SKILL_TAXONOMY_LOCK_KEY}))`;
      return fn();
    },
    { timeout: LOCK_HOLD_MS, maxWait: LOCK_HOLD_MS },
  );
}
