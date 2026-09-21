import { describe, expect, it } from 'vitest';

// Regression coverage for the "job stalled more than allowable limit"
// failure hit on dev 2026-09-20: RUN_JOBTHAI_FULL_REFRESH
// (refreshJobThaiDerived) takes ~11 minutes and the worker was created
// with no `lockDuration`, so BullMQ's 30-second default applied. See the
// doc comment on AI_JOBS_WORKER_LOCK_DURATION_MS in ../src/ai-jobs/queue.ts
// for the full reasoning.
import { AI_JOBS_WORKER_LOCK_DURATION_MS, aiJobsWorkerOptions } from '../src/ai-jobs/queue';

// The longest known job on this queue, measured on dev with 47k postings
// (see apps/ingestion/src/connectors/sources/jobthai/connector.ts).
const MEASURED_LONGEST_JOB_MS = 11 * 60 * 1000;

describe('aiJobsWorkerOptions', () => {
  it('sets a lockDuration comfortably above the longest known job (RUN_JOBTHAI_FULL_REFRESH, ~11 minutes)', () => {
    const options = aiJobsWorkerOptions({
      redisUrl: 'redis://localhost:6379',
      maxAttempts: 3,
      backoffBaseMs: 1000,
      concurrency: 2,
    });

    expect(options.lockDuration).toBeDefined();
    expect(options.lockDuration).toBeGreaterThan(MEASURED_LONGEST_JOB_MS);
    // Explicit headroom check, not just "greater than": a lock that expires
    // 10ms after the job finishes is not comfortable headroom.
    expect(options.lockDuration! - MEASURED_LONGEST_JOB_MS).toBeGreaterThanOrEqual(5 * 60 * 1000);
  });

  it('never regresses to BullMQ\'s 30-second default', () => {
    const options = aiJobsWorkerOptions({
      redisUrl: 'redis://localhost:6379',
      maxAttempts: 3,
      backoffBaseMs: 1000,
      concurrency: 2,
    });

    expect(options.lockDuration).not.toBe(30_000);
    expect(options.lockDuration).toBe(AI_JOBS_WORKER_LOCK_DURATION_MS);
  });

  it('still carries the configured concurrency through', () => {
    const options = aiJobsWorkerOptions({
      redisUrl: 'redis://localhost:6379',
      maxAttempts: 3,
      backoffBaseMs: 1000,
      concurrency: 7,
    });

    expect(options.concurrency).toBe(7);
  });
});
