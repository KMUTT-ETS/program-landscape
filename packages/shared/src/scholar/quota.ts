export type ScholarTrigger = 'SELF' | 'ADMIN' | 'ADMIN_BULK';
export type ScholarStatus = 'SUCCEEDED' | 'PARTIAL' | 'FAILED' | 'REFUSED';

export interface ScholarRunSummary {
  trigger: ScholarTrigger;
  status: ScholarStatus;
  startedAt: Date;
}

export interface ScholarQuotaDecision {
  allowed: boolean;
  reason?: string;
  /** When the caller may try again. Only set when allowed === false. */
  retryAt?: Date;
}

const WINDOW_DAYS = 30;
const WINDOW_MS = WINDOW_DAYS * 24 * 60 * 60 * 1000;

/**
 * Pure quota decision — no prisma, no clock of its own.
 *
 * Two independent counters, which is the point: a SELF run and an ADMIN run
 * never consume each other's allowance, so an admin bulk refresh cannot lock
 * people out of refreshing their own record.
 *
 * FAILED and REFUSED runs do not count. Burning someone's month on a
 * ScrapingBee timeout would be indefensible. PARTIAL does count — it produced
 * data.
 */
export function decideScholarQuota(input: {
  trigger: ScholarTrigger;
  actorRole: string;
  runs: ScholarRunSummary[];
  now: Date;
}): ScholarQuotaDecision {
  const { trigger, actorRole, runs, now } = input;

  if (actorRole === 'SUPER_ADMIN') return { allowed: true };

  const counts = (r: ScholarRunSummary) =>
    (r.status === 'SUCCEEDED' || r.status === 'PARTIAL') &&
    (trigger === 'SELF' ? r.trigger === 'SELF' : r.trigger !== 'SELF');

  const blocking = runs
    .filter(counts)
    .filter((r) => now.getTime() - r.startedAt.getTime() < WINDOW_MS)
    .sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime())[0];

  if (!blocking) return { allowed: true };

  const retryAt = new Date(blocking.startedAt.getTime() + WINDOW_MS);
  return {
    allowed: false,
    reason:
      trigger === 'SELF'
        ? `Already fetched on ${blocking.startedAt.toISOString().slice(0, 10)}. One fetch per ${WINDOW_DAYS} days.`
        : `An administrator already fetched this person on ${blocking.startedAt.toISOString().slice(0, 10)}.`,
    retryAt,
  };
}
