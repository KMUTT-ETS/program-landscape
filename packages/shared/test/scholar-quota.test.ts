import { describe, it, expect } from 'vitest';
import { decideScholarQuota } from '../src/scholar/quota';

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
