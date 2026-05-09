import { describe, expect, it } from 'vitest';
import { AsyncSemaphore } from '../src/common/semaphore';

describe('AsyncSemaphore', () => {
  it('rejects non-positive concurrency', () => {
    expect(() => new AsyncSemaphore(0)).toThrow();
    expect(() => new AsyncSemaphore(-1)).toThrow();
    expect(() => new AsyncSemaphore(1.5)).toThrow();
  });

  it('caps simultaneous holders at maxConcurrent', async () => {
    const sem = new AsyncSemaphore(2);
    const r1 = await sem.acquire();
    const r2 = await sem.acquire();
    expect(sem.stats()).toEqual({ inFlight: 2, waiting: 0, max: 2 });

    let acquired3 = false;
    const p3 = sem.acquire().then((r) => {
      acquired3 = true;
      return r;
    });

    // p3 must NOT have resolved yet (cap hit).
    await new Promise((r) => setImmediate(r));
    expect(acquired3).toBe(false);
    expect(sem.stats()).toEqual({ inFlight: 2, waiting: 1, max: 2 });

    // Release one — p3 should now resolve in FIFO order.
    r1();
    const r3 = await p3;
    expect(acquired3).toBe(true);
    expect(sem.stats()).toEqual({ inFlight: 2, waiting: 0, max: 2 });

    r2();
    r3();
    expect(sem.stats()).toEqual({ inFlight: 0, waiting: 0, max: 2 });
  });

  it('preserves FIFO order under contention', async () => {
    const sem = new AsyncSemaphore(1);
    const r1 = await sem.acquire();
    const order: number[] = [];

    const t2 = sem.acquire().then((r) => {
      order.push(2);
      r();
    });
    const t3 = sem.acquire().then((r) => {
      order.push(3);
      r();
    });
    const t4 = sem.acquire().then((r) => {
      order.push(4);
      r();
    });

    // Release the first holder — chain runs in 2,3,4 order.
    r1();
    await Promise.all([t2, t3, t4]);
    expect(order).toEqual([2, 3, 4]);
  });

  it('release() is idempotent against double-release', async () => {
    const sem = new AsyncSemaphore(1);
    const r = await sem.acquire();
    r();
    r();
    // inFlight should clamp at 0, not -1.
    expect(sem.stats().inFlight).toBe(0);
  });
});
