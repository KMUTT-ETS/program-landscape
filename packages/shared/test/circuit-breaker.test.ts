import { describe, expect, it } from 'vitest';
import {
  CircuitBreaker,
  CircuitOpenError,
  registerBreaker,
  snapshotAllBreakers,
} from '../src/resilience/circuit-breaker';

// Deterministic clock — never use real Date.now in tests.
function fakeClock() {
  let t = 1_000_000;
  return {
    now: () => t,
    advance: (ms: number) => {
      t += ms;
    },
    set: (ms: number) => {
      t = ms;
    },
  };
}

describe('CircuitBreaker', () => {
  it('starts CLOSED and lets calls through', async () => {
    const cb = new CircuitBreaker({ name: 'test1', threshold: 3 });
    const r = await cb.execute(() => Promise.resolve('ok'));
    expect(r).toBe('ok');
    expect(cb.snapshot().state).toBe('CLOSED');
  });

  it('opens after `threshold` consecutive failures', async () => {
    const cb = new CircuitBreaker({ name: 'test2', threshold: 3 });
    for (let i = 0; i < 3; i++) {
      await expect(cb.execute(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    }
    expect(cb.snapshot().state).toBe('OPEN');
    // Next call short-circuits with CircuitOpenError, NOT 'boom'.
    await expect(cb.execute(() => Promise.resolve('ok'))).rejects.toBeInstanceOf(CircuitOpenError);
  });

  it('resets the failure counter on success', async () => {
    const cb = new CircuitBreaker({ name: 'test3', threshold: 3 });
    await expect(cb.execute(() => Promise.reject(new Error('a')))).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(new Error('b')))).rejects.toThrow();
    expect(cb.snapshot().consecutiveFailures).toBe(2);
    await cb.execute(() => Promise.resolve('ok'));
    expect(cb.snapshot().consecutiveFailures).toBe(0);
    expect(cb.snapshot().state).toBe('CLOSED');
  });

  it('transitions OPEN → HALF_OPEN → CLOSED on a successful probe', async () => {
    const clock = fakeClock();
    const cb = new CircuitBreaker({ name: 'test4', threshold: 2, cooldownMs: 5_000 });
    await expect(cb.execute(() => Promise.reject(new Error('x')), clock.now)).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(new Error('x')), clock.now)).rejects.toThrow();
    expect(cb.snapshot(clock.now).state).toBe('OPEN');

    // Before cooldown: still OPEN.
    clock.advance(2_000);
    await expect(cb.execute(() => Promise.resolve('ok'), clock.now))
      .rejects.toBeInstanceOf(CircuitOpenError);

    // After cooldown: HALF_OPEN — first call probes; success closes.
    clock.advance(4_000);
    const r = await cb.execute(() => Promise.resolve('ok'), clock.now);
    expect(r).toBe('ok');
    expect(cb.snapshot(clock.now).state).toBe('CLOSED');
  });

  it('snaps back to OPEN if the half-open probe fails', async () => {
    const clock = fakeClock();
    const cb = new CircuitBreaker({ name: 'test5', threshold: 1, cooldownMs: 1_000 });
    await expect(cb.execute(() => Promise.reject(new Error('x')), clock.now)).rejects.toThrow();
    expect(cb.snapshot(clock.now).state).toBe('OPEN');
    clock.advance(2_000);
    await expect(cb.execute(() => Promise.reject(new Error('y')), clock.now)).rejects.toThrow();
    expect(cb.snapshot(clock.now).state).toBe('OPEN');
    // The cooldown clock reset on the failed probe.
    expect(cb.snapshot(clock.now).cooldownRemainingMs).toBeGreaterThan(0);
  });

  it('isFailure(false) returns let through without counting', async () => {
    const cb = new CircuitBreaker({
      name: 'test6',
      threshold: 2,
      isFailure: (err) => !(err instanceof RangeError),
    });
    await expect(cb.execute(() => Promise.reject(new RangeError('caller fault')))).rejects.toThrow();
    await expect(cb.execute(() => Promise.reject(new RangeError('caller fault')))).rejects.toThrow();
    expect(cb.snapshot().state).toBe('CLOSED'); // RangeError didn't count
    expect(cb.snapshot().consecutiveFailures).toBe(0);
  });

  it('forceClose() resets state to CLOSED', async () => {
    const cb = new CircuitBreaker({ name: 'test7', threshold: 1 });
    await expect(cb.execute(() => Promise.reject(new Error('x')))).rejects.toThrow();
    expect(cb.snapshot().state).toBe('OPEN');
    cb.forceClose();
    const r = await cb.execute(() => Promise.resolve('ok'));
    expect(r).toBe('ok');
    expect(cb.snapshot().state).toBe('CLOSED');
  });

  it('snapshot() reports the right shape', async () => {
    const clock = fakeClock();
    const cb = new CircuitBreaker({ name: 'test8', threshold: 1, cooldownMs: 10_000 });
    await expect(
      cb.execute(() => Promise.reject(new Error('connection refused')), clock.now),
    ).rejects.toThrow();
    const s = cb.snapshot(clock.now);
    expect(s.name).toBe('test8');
    expect(s.state).toBe('OPEN');
    expect(s.consecutiveFailures).toBe(1);
    expect(s.lastErrorMessage).toBe('connection refused');
    expect(s.lastOpenedAt).not.toBeNull();
    expect(s.cooldownRemainingMs).toBe(10_000);
  });
});

describe('registerBreaker / snapshotAllBreakers', () => {
  it('registers and lists', () => {
    const cb = registerBreaker(new CircuitBreaker({ name: 'reg-canary' }));
    const all = snapshotAllBreakers();
    expect(all.some((s) => s.name === cb.name)).toBe(true);
  });
});
