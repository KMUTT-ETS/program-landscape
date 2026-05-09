// Tiny in-process counting semaphore. No deps, FIFO fairness, async.
//
// Used by PdfService to cap concurrent Gotenberg renders across the
// whole instance (prompt 09 — abuse controls). Headless Chromium peaks
// at ~200 MB per render and competes for CPU; without a cap a Council
// session generating 10 simultaneous Council Pack PDFs can exhaust the
// container's memory limit and trigger OOM-kills.
//
// API:
//   const sem = new AsyncSemaphore(4);
//   const release = await sem.acquire();
//   try { ...do work... } finally { release(); }
//
// `stats()` exposes the depth for /admin/system-status to surface live
// queue length.

export class AsyncSemaphore {
  private inFlight = 0;
  private readonly waiters: Array<() => void> = [];

  constructor(public readonly maxConcurrent: number) {
    if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1) {
      throw new Error('AsyncSemaphore: maxConcurrent must be a positive integer');
    }
  }

  async acquire(): Promise<() => void> {
    if (this.inFlight < this.maxConcurrent) {
      this.inFlight += 1;
      return () => this.release();
    }
    // Queue up.
    return new Promise<() => void>((resolve) => {
      this.waiters.push(() => {
        this.inFlight += 1;
        resolve(() => this.release());
      });
    });
  }

  private release(): void {
    this.inFlight = Math.max(0, this.inFlight - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  stats(): { inFlight: number; waiting: number; max: number } {
    return {
      inFlight: this.inFlight,
      waiting: this.waiters.length,
      max: this.maxConcurrent,
    };
  }
}

// Process-singleton semaphore for Gotenberg. Capped via env
// `GOTENBERG_MAX_CONCURRENCY` (default 4) — matches the upstream
// Gotenberg's single-process Chromium-pool sizing in our compose.
function gotenbergMaxConcurrency(): number {
  const raw = Number(process.env.GOTENBERG_MAX_CONCURRENCY);
  return Number.isFinite(raw) && raw > 0 ? raw : 4;
}

let _gotenberg: AsyncSemaphore | null = null;

export function gotenbergSemaphore(): AsyncSemaphore {
  if (!_gotenberg) _gotenberg = new AsyncSemaphore(gotenbergMaxConcurrency());
  return _gotenberg;
}
