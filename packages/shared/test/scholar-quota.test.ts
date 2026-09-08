import { describe, it, expect } from 'vitest';
import {
  DEFAULT_SCHOLAR_BIND_MAX_PER_DAY,
  SCHOLAR_LEDGER_LOOKBACK_MS,
  decideScholarBindQuota,
  decideScholarQuota,
} from '../src/scholar/quota';

const NOW = new Date('2026-09-08T10:00:00Z');
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 24 * 60 * 60 * 1000);

describe('decideScholarQuota', () => {
  it('allows a first self-fetch', () => {
    const d = decideScholarQuota({ trigger: 'SELF', actorRole: 'UNIVERSITY_USER', runs: [], now: NOW });
    expect(d.allowed).toBe(true);
  });

  it('refuses a second self-fetch inside 30 days and names the retry date', () => {
    const d = decideScholarQuota({
      trigger: 'SELF', actorRole: 'UNIVERSITY_USER',
      runs: [{ trigger: 'SELF', status: 'SUCCEEDED', startedAt: daysAgo(10) }], now: NOW,
    });
    expect(d.allowed).toBe(false);
    expect(d.retryAt?.toISOString()).toBe(new Date(daysAgo(10).getTime() + 30 * 864e5).toISOString());
  });

  it('allows a self-fetch once 30 days have passed', () => {
    const d = decideScholarQuota({
      trigger: 'SELF', actorRole: 'UNIVERSITY_USER',
      runs: [{ trigger: 'SELF', status: 'SUCCEEDED', startedAt: daysAgo(31) }], now: NOW,
    });
    expect(d.allowed).toBe(true);
  });

  it('does NOT count a FAILED run against the allowance', () => {
    const d = decideScholarQuota({
      trigger: 'SELF', actorRole: 'UNIVERSITY_USER',
      runs: [{ trigger: 'SELF', status: 'FAILED', startedAt: daysAgo(1) }], now: NOW,
    });
    expect(d.allowed).toBe(true);
  });

  it('does NOT count a REFUSED run either', () => {
    const d = decideScholarQuota({
      trigger: 'SELF', actorRole: 'UNIVERSITY_USER',
      runs: [{ trigger: 'SELF', status: 'REFUSED', startedAt: daysAgo(1) }], now: NOW,
    });
    expect(d.allowed).toBe(true);
  });

  it('counts a PARTIAL run — it produced data', () => {
    const d = decideScholarQuota({
      trigger: 'SELF', actorRole: 'UNIVERSITY_USER',
      runs: [{ trigger: 'SELF', status: 'PARTIAL', startedAt: daysAgo(2) }], now: NOW,
    });
    expect(d.allowed).toBe(false);
  });

  it('an ADMIN run does not consume the user self-service allowance', () => {
    const d = decideScholarQuota({
      trigger: 'SELF', actorRole: 'UNIVERSITY_USER',
      runs: [{ trigger: 'ADMIN_BULK', status: 'SUCCEEDED', startedAt: daysAgo(2) }], now: NOW,
    });
    expect(d.allowed).toBe(true);
  });

  it('and a SELF run does not consume the admin allowance', () => {
    const d = decideScholarQuota({
      trigger: 'ADMIN', actorRole: 'SYSTEM_ADMIN',
      runs: [{ trigger: 'SELF', status: 'SUCCEEDED', startedAt: daysAgo(2) }], now: NOW,
    });
    expect(d.allowed).toBe(true);
  });

  it('limits SYSTEM_ADMIN to one admin fetch per target per 30 days', () => {
    const d = decideScholarQuota({
      trigger: 'ADMIN', actorRole: 'SYSTEM_ADMIN',
      runs: [{ trigger: 'ADMIN', status: 'SUCCEEDED', startedAt: daysAgo(3) }], now: NOW,
    });
    expect(d.allowed).toBe(false);
  });

  it('SUPER_ADMIN bypasses both counters', () => {
    const d = decideScholarQuota({
      trigger: 'ADMIN', actorRole: 'SUPER_ADMIN',
      runs: [
        { trigger: 'ADMIN', status: 'SUCCEEDED', startedAt: daysAgo(1) },
        { trigger: 'SELF', status: 'SUCCEEDED', startedAt: daysAgo(1) },
      ],
      now: NOW,
    });
    expect(d.allowed).toBe(true);
  });
});

const hoursAgo = (n: number) => new Date(NOW.getTime() - n * 60 * 60 * 1000);

describe('SCHOLAR_LEDGER_LOOKBACK_MS', () => {
  it('reaches strictly further back than the 30-day quota window', () => {
    // Ordered by necessity: read less than the window and the decision
    // silently sees no blocking run and lets a second fetch through. Both the
    // runner and GET /scholar/status/me import this constant rather than
    // keeping a copy, which is what this asserts is safe to do.
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    expect(SCHOLAR_LEDGER_LOOKBACK_MS).toBeGreaterThan(thirtyDays);
  });
});

describe('decideScholarBindQuota', () => {
  it('allows a first bind', () => {
    const d = decideScholarBindQuota({ actorRole: 'FACULTY_USER', attempts: [], now: NOW });
    expect(d.allowed).toBe(true);
  });

  it('allows the attempt that lands exactly ON the default cap', () => {
    // Four prior attempts against a cap of five: the fifth must go through,
    // or the cap is really four.
    const attempts = [1, 2, 3, 4].map((h) => ({ createdAt: hoursAgo(h) }));
    expect(decideScholarBindQuota({ actorRole: 'FACULTY_USER', attempts, now: NOW }).allowed).toBe(true);
  });

  it('refuses once the cap is reached', () => {
    const attempts = [1, 2, 3, 4, 5].map((h) => ({ createdAt: hoursAgo(h) }));
    const d = decideScholarBindQuota({ actorRole: 'FACULTY_USER', attempts, now: NOW });
    expect(d.allowed).toBe(false);
    expect(d.reason).toMatch(/billed whether or not/);
  });

  it('COUNTS refusals — the opposite of the fetch quota, and deliberately so', () => {
    // A bind is billed before the name check that can reject it, so the
    // attempts that produce nothing are exactly the ones that must count.
    // There is no outcome field on the summary at all: every row counts.
    const attempts = [1, 2, 3, 4, 5].map((h) => ({ createdAt: hoursAgo(h) }));
    expect(decideScholarBindQuota({ actorRole: 'FACULTY_USER', attempts, now: NOW }).allowed).toBe(false);
  });

  it('rolls: the allowance frees as the OLDEST attempt in the window ages out', () => {
    const attempts = [23.5, 5, 4, 3, 2].map((h) => ({ createdAt: hoursAgo(h) }));
    const d = decideScholarBindQuota({ actorRole: 'FACULTY_USER', attempts, now: NOW });
    expect(d.allowed).toBe(false);
    // 24h after the oldest, not midnight.
    expect(d.retryAt?.toISOString()).toBe(new Date(hoursAgo(23.5).getTime() + 24 * 60 * 60 * 1000).toISOString());
  });

  it('ignores attempts older than 24 hours', () => {
    const attempts = [25, 26, 27, 28, 29].map((h) => ({ createdAt: hoursAgo(h) }));
    expect(decideScholarBindQuota({ actorRole: 'FACULTY_USER', attempts, now: NOW }).allowed).toBe(true);
  });

  it('honours an explicit cap, and falls back on a nonsense one', () => {
    const attempts = [1].map((h) => ({ createdAt: hoursAgo(h) }));
    expect(decideScholarBindQuota({ actorRole: 'FACULTY_USER', attempts, now: NOW, maxPerDay: 1 }).allowed).toBe(false);
    expect(decideScholarBindQuota({ actorRole: 'FACULTY_USER', attempts, now: NOW, maxPerDay: 0 }).allowed).toBe(true);
    expect(decideScholarBindQuota({ actorRole: 'FACULTY_USER', attempts, now: NOW, maxPerDay: Number.NaN }).allowed).toBe(true);
  });

  it('exempts SUPER_ADMIN, matching decideScholarQuota', () => {
    const attempts = Array.from({ length: 50 }, (_, i) => ({ createdAt: hoursAgo(i % 20) }));
    expect(decideScholarBindQuota({ actorRole: 'SUPER_ADMIN', attempts, now: NOW }).allowed).toBe(true);
    expect(DEFAULT_SCHOLAR_BIND_MAX_PER_DAY).toBe(5);
  });
});
