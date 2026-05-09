// Process-singleton drain flag.
//
// SIGTERM handlers flip this to TRUE. `/api/v1/ready` reads it and
// returns 503 immediately so the KKU upstream proxy stops sending NEW
// requests within its polling window — while in-flight requests
// continue to drain via Nest's `app.close()` deadline.
//
// Two states:
//   - !isDraining (boot default)  — /ready behaves normally
//   - isDraining                  — /ready forces 503 with reason='draining'
//
// markDraining() is idempotent — calling twice has no effect.

let _draining = false;
let _drainStartedAt: Date | null = null;

export function markDraining(): void {
  if (_draining) return;
  _draining = true;
  _drainStartedAt = new Date();
}

export function isDraining(): boolean {
  return _draining;
}

export function drainStartedAt(): Date | null {
  return _drainStartedAt;
}

// Test-only: reset state. Production code never calls this.
export function _resetDrainState_TESTING_ONLY(): void {
  _draining = false;
  _drainStartedAt = null;
}
