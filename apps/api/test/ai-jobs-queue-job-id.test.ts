import { describe, expect, it } from 'vitest';

/**
 * BullMQ rejects a custom job id containing a colon.
 *
 * `Job.validateOptions` throws `Error: Custom Id cannot contain :` — BullMQ
 * namespaces its own Redis keys with colons, so one inside a caller-supplied id
 * would collide with that scheme.
 *
 * WHY THIS TEST EXISTS. The deterministic id added to stop two jobs walking one
 * Scholar profile was first written `scholar-fetch:<userId>`. Every enqueue
 * threw HTTP 500. Nothing caught it: `bullmq` is mocked in the service tests, a
 * mocked `queue.add` accepts any options object, and a typecheck cannot see a
 * runtime validation rule. It surfaced only when a human pressed the button
 * three times.
 *
 * So this asserts the CONSTRAINT rather than the current string. A future
 * deterministic id — for a different job kind, or a scoped variant of this one
 * — gets the same guard for free, which is the point.
 */

/** Mirrors BullMQ's own check (bullmq/src/classes/job.ts, validateOptions). */
function bullMqWouldReject(jobId: string): boolean {
  return jobId.includes(':');
}

/**
 * The id template the queue service uses. Kept as a function so the test states
 * the shape it is guarding; the source of truth is
 * `apps/api/src/ai-jobs/ai-jobs-queue.service.ts`, and the last case below is
 * what fails if the two drift apart.
 */
const scholarFetchJobId = (userId: string): string => `scholar-fetch-${userId}`;

describe('deterministic BullMQ job ids', () => {
  it('does not contain a colon, for a realistic cuid user id', () => {
    // A real id from the dev database's `users` table shape.
    const jobId = scholarFetchJobId('cmovooxcp0001666ib7n4b7s1');
    expect(bullMqWouldReject(jobId)).toBe(false);
  });

  it('stays collision-free across users while remaining stable per user', () => {
    // Both halves matter: stable, or the duplicate-collapse does nothing;
    // distinct, or two people share one job slot.
    expect(scholarFetchJobId('user-a')).toBe(scholarFetchJobId('user-a'));
    expect(scholarFetchJobId('user-a')).not.toBe(scholarFetchJobId('user-b'));
  });

  it('proves the guard actually detects the rejected shape', () => {
    // Without this, a template that stopped using a separator entirely would
    // pass the first case vacuously and the test would guard nothing.
    expect(bullMqWouldReject('scholar-fetch:cmovooxcp0001666ib7n4b7s1')).toBe(true);
  });

  it('matches the template the queue service actually sends', async () => {
    // Reads the source rather than the runtime, because constructing the
    // service needs a live Redis connection. If someone edits the template in
    // the service and not here, this fails and points at the drift.
    const { readFileSync } = await import('node:fs');
    const path = await import('node:path');
    const source = readFileSync(
      path.join(__dirname, '..', 'src', 'ai-jobs', 'ai-jobs-queue.service.ts'),
      'utf8',
    );
    const match = source.match(/jobId:\s*`([^`]+)`/);
    expect(match, 'no jobId template found in ai-jobs-queue.service.ts').not.toBeNull();

    const template = match?.[1] ?? '';
    // The `${...}` interpolation is the only place a value enters; the literal
    // part is what must be colon-free.
    expect(bullMqWouldReject(template.replace(/\$\{[^}]*\}/g, 'X'))).toBe(false);
    expect(template).toBe('scholar-fetch-${data.entityId}');
  });
});
