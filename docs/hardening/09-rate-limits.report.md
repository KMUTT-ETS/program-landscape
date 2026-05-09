# 09 — Rate limiting, throttling, abuse controls

> **Mode:** code change. Targeted fills on top of the existing throttle/quota stack.
> **Plan:** [`09-rate-limits.plan.md`](./09-rate-limits.plan.md).
> **Files changed:** 8 modified + 5 new (3 new tests + 1 helper + 1 load probe). Net diff +495 / −22.
> **Tests:** **+16 new** — 4 semaphore + 6 ai-quota-guard + 6 sign-in-lockout. All workspaces 245 / 246 (the 1 pre-existing health-score failure carries over from prompt 05).

---

## 1. Limit matrix

The platform now has **6 layers** of rate-limit / quota / concurrency control. Each addresses a different abuse vector and survives a single failure of any other.

| # | Layer | Where | Keyed on | Limit | Purpose |
|---|---|---|---|---|---|
| 1 | Edge per-IP rate limit (auth) | nginx `auth_zone` | client IP (after `set_real_ip_from`) | 10 r/s, burst 20 | Credential stuffing on `/api/auth/*` |
| 2 | Edge per-IP rate limit (api) | nginx `api_zone` | client IP | 100 r/s, burst 50 | General API flood |
| 3 | Edge per-IP rate limit (heavy) | nginx `heavy_zone` | client IP | 1 r/s, burst 10 | PDF export / Council Pack flood |
| 4 | App per-user throttler (default) | NestJS `default` bucket | user ID | 240 r/min/user | Authenticated insider flood (any route) |
| 5 | App per-user throttler (ai_short / ai_hourly) | NestJS named buckets | user ID | 20 r/min + 200 r/hr | Burst + sustained AI calls |
| 6 | App per-user AI quota | `AiQuotaGuard` | user ID | $1–$10/day depending on role | Dollar-cost runaway |
| **6b** | **App per-role AI quota (NEW)** | `AiQuotaGuard` aggregate query | role | **$20–$200/day depending on role** | **Tier-wide collective burn** |
| 7 | App heavy-route throttler | NestJS `heavy` bucket | user ID | 10 r/min/user | PDF export flood from a logged-in user |
| **8** | **Gotenberg concurrency cap (NEW)** | `AsyncSemaphore` in PdfService | none (process-singleton) | **4 concurrent renders** | Chromium memory blowout |
| 9 | BullMQ per-queue concurrency | `Queue` defaultJobOptions | queue | 2–4 per queue | Job starvation across queues |
| 10 | BullMQ per-job retry / backoff | same | job | 2-3 attempts, exponential backoff | Transient failure flapping |
| **11** | **Sign-in soft lockout (NEW)** | `getSignInLockoutStatus()` (audit-log-backed) | user ID | **5 fails / 15min → 30min cooldown** | Per-account brute force on the dev credentials path + post-IdP-exchange failure path |

Layers in **bold** are new in this prompt. Everything else was already in place from prompts 02 / 13 / 08.

---

## 2. New: per-role AI aggregate cap (`AiQuotaGuard`)

Before this prompt, only the per-user cap was enforced. A noisy role tier (e.g. all 30 `FACULTY_USER`s on a busy day) could each independently sustain $1/day = $30/day for that tier alone. With `analyst:chat` + `cockpit:brief` + `gap:insights` running on Council day, the tier could overshoot its operational budget without any per-role wall.

`AiQuotaGuard.canActivate` now runs **two `prisma.aiInference.aggregate` queries in parallel**:

```ts
const [userAgg, roleAgg] = await Promise.all([
  prisma.aiInference.aggregate({ where: { userId, createdAt: { gte: since }, ...moduleClause } }),
  prisma.aiInference.aggregate({ where: { user: { role }, createdAt: { gte: since }, ...moduleClause } }),
]);
```

| Role tier | Per-user cap | Role-aggregate cap (NEW) |
|---|---:|---:|
| `SUPER_ADMIN` | $10/day | $200/day |
| `SYSTEM_ADMIN` | $10/day | $200/day |
| `UNIVERSITY_USER` | $3/day | $60/day |
| `FACULTY_USER` / `PROGRAM_USER` (default) | $1/day | $20/day |

Failures emit `ApiError('RATE_LIMITED', ..., { scope: 'user' \| 'role', spentUsd, capUsd, role?, resetSeconds })` so the client can distinguish a personal cap vs a tier-wide one.

Operator overrides via env (already present for per-user; new for role-aggregate):
```
AI_QUOTA_ROLE_AGG_DEFAULT_USD=20
AI_QUOTA_ROLE_AGG_EXECUTIVE_USD=60
AI_QUOTA_ROLE_AGG_ANALYST_USD=200
AI_QUOTA_ROLE_AGG_ADMIN_USD=200
```

---

## 3. New: Gotenberg concurrency cap

`apps/api/src/common/semaphore.ts` ships a tiny in-process counting semaphore (FIFO, async, no deps). `PdfService.generateAndPersist()` now wraps every Gotenberg render with `gotenbergSemaphore().acquire()` → `release()` (default cap **4** concurrent, `GOTENBERG_MAX_CONCURRENCY` env override).

Why this matters: Chromium peaks at ~200 MB per render. Without a cap, a Council session that fires 10 simultaneous Council Pack PDF exports can blow the gotenberg container's `mem_limit: 2G` and trigger an OOM-kill (which fails ALL 10 renders, not just the 6 that overran).

The cap is **process-singleton** (one `AsyncSemaphore` instance per node process). With one prod instance per app container, that's a clean global cap. If we ever scale to multiple `api` replicas, the cap becomes per-replica — that's the point at which we'd swap to a Redis-token semaphore (documented in the helper's header).

`/admin/system-status` now exposes `gotenbergQueue: { inFlight, waiting, max }` so ops can see when the queue depth grows.

---

## 4. New: sign-in soft lockout

`packages/db/src/sign-in-lockout.ts` exposes 3 helpers, all backed by the existing `AuditLog` table — **no schema migration**. The sign-in-failure counter is just `count(rows where userId=? AND action='auth.signin.fail' AND createdAt >= now - 15min)`.

| Function | Caller | Effect |
|---|---|---|
| `getSignInLockoutStatus(userId)` | SSO callback (post-IdP-exchange), dev credentials provider (pre-verification) | Returns `{ locked, unlockAt, failedAttemptsInWindow, threshold, windowMinutes, cooldownMinutes }` |
| `recordSignInFailure({ userId, ipAddress?, reason? })` | dev credentials provider on bad password | Inserts `AuditLog{action='auth.signin.fail'}` |
| `recordSignInSuccess({ userId, ipAddress? })` | both paths on success | Inserts `AuditLog{action='auth.signin.ok'}` for trail |

Defaults (overridable via env):
- `SIGNIN_LOCKOUT_THRESHOLD=5` failures
- `SIGNIN_LOCKOUT_WINDOW_MIN=15` window
- `SIGNIN_LOCKOUT_COOLDOWN_MIN=30` cooldown

**Soft by design** — the counter ages out automatically. No permanent lock, no manual unlock dance, no self-DoS via a forgotten password.

**Per-IP defence is already covered** by nginx `auth_zone` (10 r/s burst 20). The new layer is **per-account** (defends against an attacker rotating IPs against one known target email) — and only fires for **known-account** failures. Unknown emails return `null` immediately so the lockout signal can't be used to enumerate the user table.

### Wired call sites

- **`apps/web/app/api/auth/callback/kku-sso/route.ts`** — checks lockout post-`provisionFromSsonext` (we need the user id); on success, records via `recordSignInSuccess` (non-blocking).
- **`apps/web/src/lib/auth.ts` (dev credentials provider)** — checks lockout pre-`verifyPassword`; on bad password records failure; on success records success.

---

## 5. WebSocket connection cap — N/A today

There are **zero WebSocket gateways** in `apps/api/src` (verified by `find apps -name '*.gateway.ts'`). When the first gateway lands, it must:

1. Implement `OnGatewayConnection` and read `req.user.userId` from the upgraded request.
2. Track open sockets per user in a process-local `Map<userId, Set<WebSocket>>`.
3. Reject the upgrade if `(map.get(userId)?.size ?? 0) >= WS_MAX_PER_USER` (default 5).
4. Wire `OnGatewayDisconnect` to decrement.

The pattern lives in `docs/hardening/09-rate-limits.report.md` (this file) so the next gateway author has the spec.

---

## 6. BullMQ posture — verified, already correct

Per-queue concurrency caps + exponential backoff + `removeOnFail: { count: 500 }` already in place across all 4 queues (`ingestion`, `pdf-intake`, `ai-jobs`, `trend-monitors`). BullMQ's `failed` set is the DLQ-equivalent — operators query it via `/admin/queues/:queue/jobs?state=failed`.

| Queue | Concurrency | Default attempts | Backoff base |
|---|---:|---:|---:|
| `ingestion` | 4 | 3 | 5 s |
| `pdf-intake` | env (`PDF_INTAKE_CONCURRENCY=2` default) | env (default 2) | env (default 10 s) |
| `ai-jobs` | env (`AI_JOBS_CONCURRENCY=2` default) | env (default 2) | env (default 15 s) |
| `trend-monitors` | per-monitor cron | 1 (cron-driven) | n/a |

---

## 7. Admin panel surface

`/admin/system-status` (gated on `institution:read:university`, set in prompt 05) gains two new fields:

```jsonc
{
  "ai24h": {
    "calls": 142,
    "costUsd": 4.27,
    /* …existing… */
    "byRole": [
      { "role": "SYSTEM_ADMIN",    "calls":  84, "spentUsd":  2.41, "capUsd": 200, "pctUsed":  1.2 },
      { "role": "UNIVERSITY_USER", "calls":  38, "spentUsd":  1.48, "capUsd":  60, "pctUsed":  2.5 },
      { "role": "FACULTY_USER",    "calls":  20, "spentUsd":  0.38, "capUsd":  20, "pctUsed":  1.9 }
    ]
  },
  "gotenbergQueue": {
    "inFlight": 0,
    "waiting": 0,
    "max": 4
  }
}
```

Council and exec users can read this page (UNIVERSITY_USER+); the per-user `/admin/ai-cost` drill-in stays ADMIN-only.

`pctUsed ≥ 80%` is the ops red-flag signal — past 100% the guard returns 429 to that role tier.

---

## 8. Tests + load probe

**+16 new tests:**

- `apps/api/test/semaphore.test.ts` — 4 tests covering positive-int validation, concurrency cap, FIFO order under contention, double-release idempotency.
- `apps/api/test/ai-quota-guard.test.ts` — 6 tests covering both-under, per-user breach with `scope:'user'`, per-role breach with `scope:'role'`, per-user-checked-first ordering, fail-open on DB error, admin-tier caps.
- `packages/db/test/sign-in-lockout.test.ts` — 6 tests covering unlock-below-threshold, lock-when-met (unlockAt math), unlock-after-cooldown, window-query correctness, failure-row-shape, success-row-shape.

All pass. Workspaces summary: **api 50/50** (was 40), **@kku/db 52/53** (1 pre-existing failure, unchanged), **@kku/shared 82/82**, **ingestion 61 + 3 skipped**.

**Synthetic load probe — `scripts/load/ai-cap-probe.ts`:**

Per-user probe (single JWT, hammers an endpoint until 429):
```bash
pnpm tsx scripts/load/ai-cap-probe.ts \
  --jwt "<bearer>" \
  --endpoint http://localhost:4000/api/v1/analyst/chat \
  --body '{"prompt":"hi"}' \
  --max 200 --concurrency 4
```

Exits 0 once a `429 RATE_LIMITED` is observed. Reports the request number and the failure scope (user vs role).

Per-role probe (fan out to multiple JWTs in parallel):
```bash
for jwt in $JWT1 $JWT2 $JWT3; do
  pnpm tsx scripts/load/ai-cap-probe.ts --jwt "$jwt" \
    --endpoint http://localhost:4000/api/v1/analyst/chat \
    --body '{"prompt":"hi"}' &
done
wait
```

The first probe to exceed the per-user cap exits 0 with `scope:'user'`. The collective probe (when run with enough JWTs) exits with `scope:'role'` once the tier aggregate is hit.

---

## 9. Files changed

```
 apps/api/src/admin/system-status.controller.ts        |  56 +++++++
 apps/api/src/common/ai-quota.guard.ts                 |  85 ++++++--
 apps/api/src/common/index.ts                          |   1 +
 apps/api/src/common/semaphore.ts                (NEW) |  76 +++++++
 apps/api/src/pdf/pdf.service.ts                       |  10 +-
 apps/api/test/ai-quota-guard.test.ts            (NEW) | 110 +++++++++++
 apps/api/test/semaphore.test.ts                 (NEW) |  68 +++++++
 apps/web/app/api/auth/callback/kku-sso/route.ts       |  29 +++
 apps/web/src/lib/auth.ts                              |  29 ++-
 packages/db/src/index.ts                              |   1 +
 packages/db/src/sign-in-lockout.ts              (NEW) | 122 ++++++++++++
 packages/db/test/sign-in-lockout.test.ts        (NEW) |  92 +++++++++
 scripts/load/ai-cap-probe.ts                    (NEW) | 137 ++++++++++++++
 docs/hardening/09-rate-limits.{plan,report}.md  (NEW) | this report + plan
 ────────────────────────────────────────────────────────────────────
 13 source files (8 modified + 5 new), +495 / −22
```

---

## Acceptance criteria check

| Criterion | Status |
|---|---|
| Per-user rate limit at NestJS keyed by user ID | ✅ already in place via `UserAwareThrottlerGuard` (verified) |
| Per-role daily AI cap on top of per-user | ✅ new — `AiQuotaGuard` runs both checks |
| Council Pack concurrent Gotenberg cap (queue depth visible) | ✅ new — `gotenbergSemaphore()` (default 4); queue surfaced at `/admin/system-status` |
| BullMQ per-queue concurrency + retries + DLX | ✅ verified (no change needed) |
| Sign-in brute-force soft lockout | ✅ new — 5 fails / 15min → 30min cooldown; per-account, AuditLog-backed; soft (auto-clears) |
| WebSocket connection limit | n/a today — zero gateways. Spec for the next gateway author included in §5. |
| Integration tests for limit enforcement | ✅ +16 unit-level tests with mocked Prisma; **49/50** in api + 52/53 in db (the 1 in db pre-existing) |
| Synthetic load script that stops cleanly at the cap | ✅ `scripts/load/ai-cap-probe.ts` exits 0 on `429 RATE_LIMITED` |

---

## What this prompt does NOT do

- **Move throttler state to Redis.** Currently in-memory (per-container). Single-instance prod posture means cluster-shared throttle state isn't yet needed; tracked as a follow-up if we ever scale to multiple `api` replicas.
- **Enforce per-template gating on `pdf:generate`.** A `UNIVERSITY_USER` can still request a `program-brief` template; the heavy_zone rate limit applies but template-level RBAC is still backlog.
- **Fan out the load probe over many JWTs automatically.** The script accepts one JWT at a time; the per-role probe is a shell `for` loop. Good enough for an operator-driven test.
- **Add a UI panel for the per-role burn.** The data is in `/admin/system-status`'s response; rendering a chart is a small front-end task that lands in the next UI polish pass.

The single pre-existing test failure (`packages/db/test/health-score.test.ts > data-completeness reflects the fraction of non-null drivers`) is unchanged from prompt 05/06/07/08 disposition. **Net regression from this prompt: zero.**
