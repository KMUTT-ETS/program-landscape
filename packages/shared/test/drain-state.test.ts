import { afterEach, describe, expect, it } from 'vitest';
import {
  _resetDrainState_TESTING_ONLY,
  drainStartedAt,
  isDraining,
  markDraining,
} from '../src/observability/drain-state';

afterEach(() => {
  _resetDrainState_TESTING_ONLY();
});

describe('drain-state primitive', () => {
  it('starts CLEAN — isDraining=false, drainStartedAt=null', () => {
    expect(isDraining()).toBe(false);
    expect(drainStartedAt()).toBeNull();
  });

  it('markDraining flips the flag and records the start time', () => {
    const before = Date.now();
    markDraining();
    expect(isDraining()).toBe(true);
    const startedAt = drainStartedAt();
    expect(startedAt).not.toBeNull();
    expect(startedAt!.getTime()).toBeGreaterThanOrEqual(before);
  });

  it('markDraining is idempotent — second call does not change start time', () => {
    markDraining();
    const first = drainStartedAt()!.getTime();
    // Wait a tick so a buggy second-call would advance the timestamp.
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        markDraining();
        expect(drainStartedAt()!.getTime()).toBe(first);
        expect(isDraining()).toBe(true);
        resolve();
      }, 5);
    });
  });
});
