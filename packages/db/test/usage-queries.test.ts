import { describe, expect, it } from 'vitest';
import { Prisma } from '@prisma/client';
import { prisma } from '../src/index';
import {
  bangkokDay,
  branchBoundary,
  usageSummary,
  windowFor,
  RAW_RETENTION_DAYS,
  USAGE_WINDOWS,
} from '../src/usage';

describe('bangkokDay', () => {
  it('buckets by Asia/Bangkok, not UTC', () => {
    // 2026-09-13 20:30 UTC is 2026-09-14 03:30 in Bangkok.
    expect(bangkokDay(new Date('2026-09-13T20:30:00Z'))).toBe('2026-09-14');
    expect(bangkokDay(new Date('2026-09-13T16:59:59Z'))).toBe('2026-09-13');
    expect(bangkokDay(new Date('2026-09-13T17:00:00Z'))).toBe('2026-09-14');
  });
});

describe('windowFor', () => {
  const now = new Date('2026-09-14T09:00:00Z');
  it('returns the current and previous windows of equal length', () => {
    const w = windowFor(7, now);
    expect(w.to).toEqual(now);
    expect((w.to.getTime() - w.from.getTime()) / 86_400_000).toBe(7);
    expect((w.from.getTime() - w.prevFrom.getTime()) / 86_400_000).toBe(7);
  });
  it('reports where roll-ups stop and raw begins, only when the window outlasts raw retention', () => {
    expect(RAW_RETENTION_DAYS).toBe(120);
    expect(windowFor(30, now).rollupFrom).toBeNull();
    const w = windowFor(365, now);
    expect(w.rollupFrom).not.toBeNull();
    expect(bangkokDay(w.rollupFrom!)).toBe(bangkokDay(new Date(now.getTime() - 120 * 86_400_000)));
  });
  it('anchors rawFrom to the real now, not to the window end', () => {
    // It must survive `{ ...w, from, to }` — the previous-period sub-window
    // narrows `to` to `from`, and a rawFrom derived from `to` would slide the
    // raw/roll-up split 7/30/90/365 days back with it.
    for (const days of USAGE_WINDOWS) {
      const w = windowFor(days, now);
      expect(w.rawFrom.getTime()).toBe(now.getTime() - RAW_RETENTION_DAYS * 86_400_000);
    }
  });
  it('rejects unsupported windows', () => {
    expect(() => windowFor(45 as never, now)).toThrow();
  });
});

describe('branchBoundary', () => {
  it('serves every Bangkok day in the window from exactly one branch', () => {
    const now = new Date('2026-09-14T20:30:00Z'); // 03:30 Bangkok next day — the failing hour
    for (const days of USAGE_WINDOWS) {
      const w = windowFor(days, now);
      for (const [from, to] of [
        [w.from, w.to],
        [w.prevFrom, w.from],
      ] as const) {
        const b = branchBoundary({ ...w, from, to });
        expect(b.rawFrom.getTime()).toBeGreaterThanOrEqual(from.getTime());
        expect(b.rawFrom.getTime()).toBeLessThanOrEqual(to.getTime());
        expect(b.rawFrom.getTime()).toBeGreaterThanOrEqual(
          Math.min(now.getTime() - RAW_RETENTION_DAYS * 86_400_000, to.getTime()),
        );
        expect(b.rollupUntilDay).toBe(bangkokDay(b.rawFrom));
      }
    }
  });
});

/**
 * Sign-ins come from audit_logs for the WHOLE window, never from the day
 * roll-up. Reading them off `rawFrom` instead of `from` silently truncated a
 * 365-day count to its last 120 days (measured on dev: 1244 against 1438).
 *
 * Needs the database, deliberately — the bug was in the SQL. It is vacuous
 * where audit_logs is empty, which is the honest outcome there.
 */
const postgresUp: boolean = await (async () => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!postgresUp)('usageSummary sign-ins', () => {
  it('counts the same sign-ins audit_logs does, across the whole window', async () => {
    const now = new Date();
    const w = windowFor(365, now);
    const [row] = await prisma.$queryRaw<Array<{ n: number }>>(Prisma.sql`
      SELECT COUNT(*)::int AS n FROM audit_logs
      WHERE action = 'auth.signin.ok' AND created_at >= (${w.from} AT TIME ZONE 'UTC') AND created_at < (${w.to} AT TIME ZONE 'UTC')`);
    expect((await usageSummary(365, false, now)).current.signins).toBe(row!.n);
  });
});
