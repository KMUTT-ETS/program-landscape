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
 * How far back a caller should read the fetch ledger before handing it to
 * `decideScholarQuota`.
 *
 * Lives here, next to WINDOW_MS, because the two are ordered by necessity:
 * read less than the window and the decision silently sees no blocking run
 * and lets a second fetch through. 90 days is 3x the window — headroom for
 * the window widening without anyone remembering to widen the query, while
 * still bounding it. Both the runner (packages/db/src/scholar-fetch.ts) and
 * GET /scholar/status/me import this rather than each keeping a copy; they
 * did keep copies, and the API one carried a comment asserting they matched.
 */
export const SCHOLAR_LEDGER_LOOKBACK_MS = 90 * 24 * 60 * 60 * 1000;

/** Binds allowed per person per rolling day when no cap is configured. */
export const DEFAULT_SCHOLAR_BIND_MAX_PER_DAY = 5;

const BIND_WINDOW_MS = 24 * 60 * 60 * 1000;

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


// ── Binding ────────────────────────────────────────────────────────────────

export interface ScholarBindAttemptSummary {
  createdAt: Date;
}

/**
 * Pure daily-cap decision for profile BINDING — no prisma, no clock of its own.
 *
 * A bind is metered separately from a fetch, and for a different reason. A
 * fetch is rationed because refreshing a publication list monthly is enough;
 * a bind is rationed because IT SPENDS BEFORE IT CAN SUCCEED. Verifying that a
 * profile belongs to the person means fetching page 1 (~15 credits) and
 * reading the name off it, so every rejected guess has already been billed.
 * Nothing else stands between a pasted URL and the ScrapingBee invoice.
 *
 * EVERY attempt in the window counts, refusals included — the opposite of
 * `decideScholarQuota`, and deliberately so. There, ignoring FAILED protects a
 * user from losing their month to a timeout that produced nothing. Here, the
 * attempts that produce nothing are precisely the ones that must be counted,
 * because "paste a wrong id, get billed, get a 400, repeat" is the abuse
 * shape. A user who has genuinely burned five binds in a day is not being
 * denied anything they can use: the fix is a correct URL, not another try.
 *
 * SUPER_ADMIN is exempt, matching decideScholarQuota's posture.
 */
export function decideScholarBindQuota(input: {
  actorRole: string;
  attempts: ScholarBindAttemptSummary[];
  now: Date;
  maxPerDay?: number;
}): ScholarQuotaDecision {
  const { actorRole, attempts, now } = input;
  if (actorRole === 'SUPER_ADMIN') return { allowed: true };

  const max =
    typeof input.maxPerDay === 'number' && Number.isFinite(input.maxPerDay) && input.maxPerDay > 0
      ? Math.floor(input.maxPerDay)
      : DEFAULT_SCHOLAR_BIND_MAX_PER_DAY;

  const inWindow = attempts
    .filter((a) => now.getTime() - a.createdAt.getTime() < BIND_WINDOW_MS)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  if (inWindow.length < max) return { allowed: true };

  // Rolling, not calendar: the allowance frees up as the OLDEST attempt in the
  // window ages out, so a person who used all five at 09:00 can try again from
  // 09:00 tomorrow rather than waiting for a midnight nobody told them about.
  const oldest = inWindow[0]!;
  return {
    allowed: false,
    reason:
      `Already tried to link a Scholar profile ${inWindow.length} time(s) in the last 24 hours ` +
      `(the limit is ${max}). Every attempt fetches a page from Google and is billed whether or not ` +
      'it matches, so this is capped. Check the profile URL before trying again.',
    retryAt: new Date(oldest.createdAt.getTime() + BIND_WINDOW_MS),
  };
}
