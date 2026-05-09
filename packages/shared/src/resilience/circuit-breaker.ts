// Tiny in-process circuit breaker. Three states (CLOSED, OPEN,
// HALF_OPEN) — failures advance toward OPEN; successes drop back to
// CLOSED. While OPEN, invocations short-circuit with a thrown
// `CircuitOpenError` instead of hitting the dependency.
//
// Why hand-roll instead of `cockatiel`: ~80 LOC, zero deps, exact-fit
// to our needs (single-process, single-replica prod). Move to a
// shared-state breaker (Redis-backed) when we ever scale to multiple
// api replicas.
//
// API:
//   const cb = new CircuitBreaker({ name: 'gemini', threshold: 5, cooldownMs: 30_000 });
//   await cb.execute(() => callDependency());
//   cb.snapshot();   // for /ready surfacing
//   cb.forceClose(); // operator escape hatch
//
// State transitions:
//   CLOSED → OPEN     after `threshold` consecutive failures
//   OPEN → HALF_OPEN  after `cooldownMs` elapsed since opening
//   HALF_OPEN → CLOSED on the probe success
//   HALF_OPEN → OPEN  on the probe failure (resets the cooldown)

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  /** Logical name — surfaces in /ready + thrown errors. */
  name: string;
  /** Consecutive failures before opening. Default 5. */
  threshold?: number;
  /** Cooldown before allowing a probe. Default 30s. */
  cooldownMs?: number;
  /**
   * Predicate to decide which thrown error counts as a failure for
   * the breaker. Default: every thrown error counts.
   * Use this to ignore validation errors (caller-fault), 4xx,
   * etc. — we only want infra failures to open the breaker.
   */
  isFailure?: (err: unknown) => boolean;
}

export interface CircuitSnapshot {
  name: string;
  state: CircuitState;
  consecutiveFailures: number;
  lastOpenedAt: Date | null;
  lastErrorMessage: string | null;
  cooldownRemainingMs: number;
}

export class CircuitOpenError extends Error {
  constructor(
    public readonly breakerName: string,
    public readonly cooldownRemainingMs: number,
  ) {
    super(`Circuit breaker open: ${breakerName} (cool-down ${cooldownRemainingMs}ms remaining)`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  readonly name: string;
  private readonly threshold: number;
  private readonly cooldownMs: number;
  private readonly isFailure: (err: unknown) => boolean;

  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private lastOpenedAt: number | null = null;
  private lastErrorMessage: string | null = null;
  /** Set when state === 'HALF_OPEN' to ensure only one probe at a time. */
  private probeInFlight = false;

  constructor(cfg: CircuitBreakerConfig) {
    this.name = cfg.name;
    this.threshold = cfg.threshold ?? 5;
    this.cooldownMs = cfg.cooldownMs ?? 30_000;
    this.isFailure = cfg.isFailure ?? (() => true);
  }

  async execute<T>(fn: () => Promise<T>, now: () => number = Date.now): Promise<T> {
    // Transition OPEN → HALF_OPEN if the cooldown has elapsed.
    if (this.state === 'OPEN' && this.lastOpenedAt !== null) {
      const elapsed = now() - this.lastOpenedAt;
      if (elapsed >= this.cooldownMs) {
        this.state = 'HALF_OPEN';
        this.probeInFlight = false;
      }
    }

    if (this.state === 'OPEN') {
      throw new CircuitOpenError(this.name, this.cooldownRemainingMs(now));
    }

    if (this.state === 'HALF_OPEN' && this.probeInFlight) {
      // A probe is already in flight; refuse the second concurrent call
      // until we know the dep is alive. Same effect as OPEN for the
      // caller.
      throw new CircuitOpenError(this.name, this.cooldownRemainingMs(now));
    }

    if (this.state === 'HALF_OPEN') {
      this.probeInFlight = true;
    }

    try {
      const result = await fn();
      // Success — reset.
      if (this.state !== 'CLOSED') {
        this.state = 'CLOSED';
        this.lastOpenedAt = null;
        this.lastErrorMessage = null;
      }
      this.consecutiveFailures = 0;
      this.probeInFlight = false;
      return result;
    } catch (err) {
      this.probeInFlight = false;
      if (!this.isFailure(err)) {
        // Caller-fault — don't count toward opening.
        throw err;
      }
      this.consecutiveFailures += 1;
      this.lastErrorMessage =
        err instanceof Error ? err.message.slice(0, 200) : String(err).slice(0, 200);
      // HALF_OPEN probe failed → snap back to OPEN, reset cooldown.
      // CLOSED → OPEN at the threshold.
      if (this.state === 'HALF_OPEN' || this.consecutiveFailures >= this.threshold) {
        this.state = 'OPEN';
        this.lastOpenedAt = now();
      }
      throw err;
    }
  }

  snapshot(now: () => number = Date.now): CircuitSnapshot {
    return {
      name: this.name,
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      lastOpenedAt: this.lastOpenedAt ? new Date(this.lastOpenedAt) : null,
      lastErrorMessage: this.lastErrorMessage,
      cooldownRemainingMs: this.cooldownRemainingMs(now),
    };
  }

  /**
   * Operator escape hatch: forcibly close the breaker (e.g. after a
   * dependency is fixed and we want immediate retry without waiting
   * out the cooldown).
   */
  forceClose(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.lastOpenedAt = null;
    this.lastErrorMessage = null;
    this.probeInFlight = false;
  }

  private cooldownRemainingMs(now: () => number): number {
    if (this.state !== 'OPEN' || this.lastOpenedAt === null) return 0;
    return Math.max(0, this.cooldownMs - (now() - this.lastOpenedAt));
  }
}

// ── Process-wide registry ────────────────────────────────────────────
// Centralised so /api/v1/ready can iterate all breakers for the report
// without each module having to register a callback.

const _registry = new Map<string, CircuitBreaker>();

export function registerBreaker(cb: CircuitBreaker): CircuitBreaker {
  _registry.set(cb.name, cb);
  return cb;
}

export function listBreakers(): CircuitBreaker[] {
  return Array.from(_registry.values());
}

export function snapshotAllBreakers(): CircuitSnapshot[] {
  return listBreakers().map((b) => b.snapshot());
}
