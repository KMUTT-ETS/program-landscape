// Soft sign-in lockout — second wall on top of nginx's per-IP
// `auth_zone` rate limit (prompt 08).
//
// Storage: piggybacks on the existing AuditLog table — no schema
// migration. We record one row per failed sign-in attempt with action
// `auth.signin.fail` and entityType `User`. The lockout query counts
// those rows in the last LOCKOUT_WINDOW_MINUTES; once the count breaches
// LOCKOUT_THRESHOLD, sign-ins for that user are refused for
// LOCKOUT_COOLDOWN_MINUTES.
//
// Soft by design: the counter ages out automatically (fixed window —
// the oldest failures fall outside `since` after the cooldown elapses).
// No permanent lock — avoids a self-DoS where a forgotten password +
// 5 retries gives an attacker a free permanent disable.
//
// Counters are per-user-id, so a credential-stuffing attempt that
// rotates emails has to find a real account first; the wall doesn't
// fire on unknown emails (which would let attackers enumerate the user
// table via the lockout signal).

import { prisma } from './index';

export const LOCKOUT_THRESHOLD = Number(process.env.SIGNIN_LOCKOUT_THRESHOLD) || 5;
export const LOCKOUT_WINDOW_MINUTES = Number(process.env.SIGNIN_LOCKOUT_WINDOW_MIN) || 15;
export const LOCKOUT_COOLDOWN_MINUTES =
  Number(process.env.SIGNIN_LOCKOUT_COOLDOWN_MIN) || 30;

const FAIL_ACTION = 'auth.signin.fail';
const SUCCESS_ACTION = 'auth.signin.ok';

export interface LockoutStatus {
  locked: boolean;
  /** When the lockout lifts (null when not locked). */
  unlockAt: Date | null;
  /** Failed-attempts within the current window. */
  failedAttemptsInWindow: number;
  threshold: number;
  windowMinutes: number;
  cooldownMinutes: number;
}

/**
 * Returns the current lockout posture for `userId`. Read-only. Call
 * this BEFORE attempting verification.
 */
export async function getSignInLockoutStatus(
  userId: string,
  now: Date = new Date(),
): Promise<LockoutStatus> {
  const since = new Date(now.getTime() - LOCKOUT_WINDOW_MINUTES * 60 * 1000);
  const count = await prisma.auditLog.count({
    where: {
      userId,
      action: FAIL_ACTION,
      createdAt: { gte: since },
    },
  });

  if (count < LOCKOUT_THRESHOLD) {
    return {
      locked: false,
      unlockAt: null,
      failedAttemptsInWindow: count,
      threshold: LOCKOUT_THRESHOLD,
      windowMinutes: LOCKOUT_WINDOW_MINUTES,
      cooldownMinutes: LOCKOUT_COOLDOWN_MINUTES,
    };
  }

  // Locked. The unlockAt is `latestFailureCreatedAt + cooldown`.
  const latest = await prisma.auditLog.findFirst({
    where: { userId, action: FAIL_ACTION, createdAt: { gte: since } },
    orderBy: { createdAt: 'desc' },
    select: { createdAt: true },
  });
  const unlockAt = latest
    ? new Date(latest.createdAt.getTime() + LOCKOUT_COOLDOWN_MINUTES * 60 * 1000)
    : new Date(now.getTime() + LOCKOUT_COOLDOWN_MINUTES * 60 * 1000);
  return {
    locked: now < unlockAt,
    unlockAt,
    failedAttemptsInWindow: count,
    threshold: LOCKOUT_THRESHOLD,
    windowMinutes: LOCKOUT_WINDOW_MINUTES,
    cooldownMinutes: LOCKOUT_COOLDOWN_MINUTES,
  };
}

/**
 * Record a failed sign-in attempt. Caller must already have resolved
 * `userId` from the email — we don't lock on unknown emails.
 *
 * Optional `payload` carries reason metadata for the operator (audit
 * trail). It is NOT used for the lockout decision — purely cosmetic.
 */
export async function recordSignInFailure(params: {
  userId: string;
  ipAddress?: string | null;
  reason?: string | null;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      action: FAIL_ACTION,
      entityType: 'User',
      entityId: params.userId,
      ipAddress: params.ipAddress ?? null,
      payloadJson: params.reason ? { reason: params.reason } : undefined,
    },
  });
}

/**
 * Record a successful sign-in. We DO NOT delete prior failure rows
 * (they're audit history) — the lockout query is window-based and the
 * old failures age out naturally. We just leave a marker for the
 * audit log.
 */
export async function recordSignInSuccess(params: {
  userId: string;
  ipAddress?: string | null;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      userId: params.userId,
      action: SUCCESS_ACTION,
      entityType: 'User',
      entityId: params.userId,
      ipAddress: params.ipAddress ?? null,
    },
  });
}
