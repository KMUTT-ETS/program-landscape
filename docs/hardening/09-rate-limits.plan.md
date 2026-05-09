# Plan — Prompt 09: Rate limiting, throttling, abuse controls

**Mode:** code change. Targeted to gaps in the existing throttle/quota stack.

## What's already in place (from prompt 13 + prompt 05)

- `@nestjs/throttler` v6, **4 named buckets** (`default` / `ai_short` / `ai_hourly` / `heavy`), opt-in per-route via metadata, **keyed by user id** via `UserAwareThrottlerGuard` (`apps/api/src/common/user-aware-throttler.guard.ts`).
- `AiQuotaGuard` enforces a **per-user** daily USD cap based on the role tier. Caps in env: `AI_QUOTA_VIEWER_USD` … `AI_QUOTA_ADMIN_USD`.
- nginx `auth_zone` (10 r/s, burst 20) on `/api/auth/*` (prompt 08).
- BullMQ queues `ingestion` / `pdf-intake` / `ai-jobs` / `trend-monitors` exist with per-queue concurrency caps + retries.

## What this prompt adds

| # | Scope item | Status | Action |
|---|---|---|---|
| 1 | Per-user rate limit at NestJS, keyed by user-id | **already in place** (`UserAwareThrottlerGuard`) | Verify + document. |
| 2 | AI quota — per user | already in place | Add **per-role daily aggregate** as a second wall (so a noisy FACULTY_USER doesn't exhaust the whole faculty pool). |
| 3 | Council Pack concurrent Gotenberg cap | not present | Add a **process-level async semaphore** in `PdfService` (default 4); surface depth at `/admin/system-status`. |
| 4 | BullMQ per-queue cap + retries + DLX | partially in place | Verify; add **DLX (failed jobs queue)** if missing; ensure `removeOnFail` policy. |
| 5 | Sign-in brute-force soft lockout | not present | Per-account counter in Redis + soft-lockout window on the SSO callback + dev credentials path. nginx already covers per-IP. |
| 6 | WebSocket connection cap | n/a today (zero gateways per prompt-04) | Document a future-proofing guard pattern. |

## Tests + load

- Unit tests for the new role-aggregate quota path (`AiQuotaGuard`) + the Gotenberg semaphore + the soft-lockout counter — vitest, no live DB.
- Synthetic load probe `scripts/load/ai-cap-probe.ts` that calls `/api/v1/analyst/chat` repeatedly with a fake JWT until the cap fires. Reports the 429-cutoff request count.

## Out of scope

- Migrating throttler to a Redis-backed store (currently in-memory; survives only within one container). Documented as a follow-up; with a single-instance prod posture we don't yet need cluster-shared throttle state.
- Auth lock-out on KKU-SSO (the IdP itself rate-limits; we lock per-account on **our** callback after repeated failed exchanges).
- WS infrastructure — adding a guard before any gateway exists is YAGNI; documented for whoever ships the first gateway.
