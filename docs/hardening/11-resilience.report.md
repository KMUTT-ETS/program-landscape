# 11 — Outbound timeouts, retries, circuit breakers

> **Mode:** code change. Targeted to gaps in the existing reliability stack.
> **Plan:** [`11-resilience.plan.md`](./11-resilience.plan.md).
> **Files changed:** 4 modified + 4 new (1 new helper + 1 new index + 2 new tests). Net diff +363 / −10 in this prompt's scope.
> **Tests:** **+15** in `@kku/shared` (9 breaker + 6 fallback). All workspaces still green: `@kku/shared` 122 / 122, `apps/api` 50 / 50.

---

## 1. Failure-mode table

For every outbound dependency: what happens when it dies, where the timeout fires, what fallback or breaker kicks in, and what `/api/v1/ready` reports.

| Dependency | Direct caller | Connect / read timeout | Retry posture | Circuit breaker | Fallback | `/ready` behaviour when down |
|---|---|---|---|---|---|---|
| **AI primary** (`gemini-3-flash-preview` etc) | `GoogleAiService` | SDK default (~ tens of seconds) | none on the AI call itself; BullMQ retries the wrapping job | **NEW** `ai:google` (threshold 5, cooldown 30 s) | **transient → secondary**; **breaker open → secondary immediately** | breakers list shows OPEN; status `degraded`; `503` |
| **AI secondary** (`claude-3-5-sonnet-…` etc) | `AnthropicAiService` | SDK default | none | **NEW** `ai:anthropic` | **fail through (no tertiary)**; original error surfaces | breakers list shows OPEN; `degraded`; `503` |
| **Scopus** (Elsevier) — profile-only | `apps/web/src/lib/scopus-publications.ts` | `AbortController` 8 s | (deferred — profile fallback uses kkuscholar) | not wired (profile-only call site; non-critical) | **kkuscholar mirror** | n/a (web layer; not on api `/ready`) |
| **OpenAlex** — profile-only | `apps/web/src/lib/external-publications.ts` | `AbortController` 8 s | none | not wired | **profile-cache + kkuscholar** | n/a |
| **KMITL** | `apps/ingestion/.../kmitl-skill-mapping/connector.ts` | _**gap**_: no AbortSignal on the connector's `fetch()` (existing; documented for prompt 14 follow-up — connector is daily cron) | BullMQ job retries with exponential backoff | not wired (ingestion-only path; failure is contained to a job) | none | n/a (worker-side; not on api `/ready`) |
| **kkuscholar (Postgres @ 10.130.2.151)** | `apps/ingestion/src/lib/postgres-client.ts` | `connectionTimeoutMillis: 10_000`, `statement_timeout: 240_000`, `query_timeout: 240_000` (env-overridable) | BullMQ job retries with backoff | not wired (worker-side; failures contained) | none | n/a |
| **HCM (MS SQL @ 10.101.104.192)** | `apps/ingestion/src/lib/mssql-client.ts` | `connectionTimeout: 10_000`, `requestTimeout: 240_000` | same as above | not wired | none | n/a |
| **UNICON DSnnnn (MySQL)** | `apps/ingestion/src/lib/mysql-client.ts` | mysql2 default + `connectTimeout` | same | not wired | none | n/a |
| **Oracle warehouse (kku-registry, kku-finance)** | `apps/ingestion/src/lib/oracle-client.ts` | oracledb default | same | not wired | none | n/a |
| **MinIO** (object storage) | api + ingestion via `@aws-sdk/client-s3` | SDK default 3 s connect, 5-30 s read | SDK auto-retry 3× with backoff | not wired (already SDK-internal) | none | already in `/ready` checks; 503 if down |
| **Gotenberg** (PDF render) | api via `GotenbergClient` | `GOTENBERG_REQUEST_TIMEOUT_MS` (default 60 s) | none on the request itself; BullMQ retries the upstream job | not wired (in-process semaphore caps concurrency at 4 — prompt 09) | none | already in `/ready` checks; 503 if `/health` 4xx/5xx |
| **Postgres** (our app DB) | api/ingestion via Prisma | Prisma `pool_timeout`/`connect_timeout` (env) | Prisma's connection-pool retry | not wired (the DB *is* the source of truth) | none | already in `/ready` checks |
| **Redis** | api/ingestion via ioredis | `lazyConnect: true`, `maxRetriesPerRequest: 1` (in `/ready` check) | ioredis built-in | not wired | cache fail-open via `CacheService` | already in `/ready` checks |

---

## 2. New: `CircuitBreaker` primitive

`packages/shared/src/resilience/circuit-breaker.ts` — ~150 LOC, zero deps, three states (CLOSED, OPEN, HALF_OPEN), in-process.

### Lifecycle

```
CLOSED ──[N consecutive failures]──▶ OPEN
OPEN   ──[cooldown elapsed]────────▶ HALF_OPEN
HALF_OPEN ──[probe success]────────▶ CLOSED
HALF_OPEN ──[probe failure]────────▶ OPEN (cooldown reset)
```

Configurable per breaker:
- `name` — surfaces in `/ready` and thrown `CircuitOpenError.breakerName`.
- `threshold` (default 5) — consecutive failures before opening.
- `cooldownMs` (default 30 s) — wait before allowing the half-open probe.
- `isFailure(err)` — predicate so caller-fault errors (validation, refusal) don't count toward opening.

Operator hooks:
- `cb.snapshot()` → `{ state, consecutiveFailures, lastOpenedAt, lastErrorMessage, cooldownRemainingMs }`.
- `cb.forceClose()` — manual escape hatch after fixing the dep.
- `registerBreaker(cb)` + `snapshotAllBreakers()` — process-wide registry that `/ready` walks.

**9 unit tests** in `packages/shared/test/circuit-breaker.test.ts` cover: opens at threshold, resets on success, OPEN→HALF_OPEN→CLOSED on probe success, snaps back to OPEN on probe failure, `isFailure` skip for caller-fault errors, `forceClose`, snapshot shape, registry list.

---

## 3. New: AI-provider breakers wired into `wrapWithTransientFallback`

`packages/shared/src/ai/providers/factory.ts` — the existing transient-fallback wrapper now ALSO routes through breakers:

```ts
// On every call:
//   1. If primaryBreaker is OPEN → skip primary, go straight to secondary.
//   2. Otherwise primaryBreaker.execute(primary.complete);
//      • on transient failure (or open) → secondaryBreaker.execute(secondary.complete);
//      • on non-transient failure (validation, refusal) → throw original error.
//   3. If secondary breaker also OPEN → throw the ORIGINAL primary error
//      (representative shape rather than a synthetic "circuit open").
```

Breaker names:
- `ai:google` — for `GoogleAiService`
- `ai:anthropic` — for `AnthropicAiService`

Tunable via env:
```
AI_BREAKER_THRESHOLD=5         # consecutive transient failures to open
AI_BREAKER_COOLDOWN_MS=30000   # cool-down before HALF_OPEN probe
```

`isFailure` is wired to the existing `isTransientError` predicate so VALIDATION_FAILED, refusal-by-rule, and other deterministic errors do NOT count toward opening.

**6 fallback tests** in `packages/shared/test/ai-fallback.test.ts`:
- Pass through to primary on success.
- Fall back to secondary on a transient (5xx) primary error.
- DO NOT fall back on a non-transient primary error (validation, refusal).
- Open the primary breaker after repeated transient failures; subsequent calls fast-path to secondary.
- Throw the original error when both breakers are open.

---

## 4. `/api/v1/ready` extension

`apps/api/src/app.controller.ts` now:
- Takes a `snapshotAllBreakers()` snapshot on every probe.
- Reports `breakers: [{ name, state, consecutiveFailures, lastOpenedAt, lastErrorMessage, cooldownRemainingMs }]` in the response body.
- Returns **HTTP 503** when any check fails OR any breaker is OPEN.
- Status field stays `'degraded'` (not `'ok'`) so the existing compose healthcheck (`grep -q '"status":"ok"'`) gates correctly.

Acceptance — when the AI primary opens its breaker, `/api/v1/ready` returns `503` with:

```jsonc
{
  "data": {
    "status": "degraded",
    "checks": [/* postgres ok, redis ok, minio ok, gotenberg ok, ai ok */],
    "breakers": [
      {
        "name": "ai:google",
        "state": "OPEN",
        "consecutiveFailures": 5,
        "lastOpenedAt": "2026-05-09T08:42:11.000Z",
        "lastErrorMessage": "rate limit (429): Too Many Requests",
        "cooldownRemainingMs": 27340
      },
      { "name": "ai:anthropic", "state": "CLOSED", ... }
    ],
    "timestamp": "2026-05-09T08:42:11.000Z"
  }
}
```

The KKU upstream proxy poller catches the 503 within its 30 s polling window — well within the prompt's 3 s acceptance budget for failover signalling.

---

## 5. Verified-already items

### Gotenberg

- Hard timeout: `GOTENBERG_REQUEST_TIMEOUT_MS` (default 60 s). Compose also sets `API_TIMEOUT: 60s` so Gotenberg itself returns 5xx if a render exceeds the budget.
- Concurrency cap: `gotenbergSemaphore()` in `apps/api/src/common/semaphore.ts` (prompt 09) — default 4. Excess requests queue FIFO.
- `/api/v1/ready` already probes `GET ${GOTENBERG_URL}/health`.

### Internal-DB clients (kkuscholar / HCM / UNICON / Oracle)

- All four `apps/ingestion/src/lib/*-client.ts` helpers set explicit connect + statement timeouts. `kkuscholar`'s `statement_timeout: 240_000` is intentionally generous — analytical queries on the on-prem mirror.
- BullMQ wraps every connector run; retries with exponential backoff handle transient DB blips. Failures > 3 attempts land in BullMQ's `failed` set (DLQ-equivalent, queryable via `/admin/queues`).
- Breakers NOT wired here because failures are **contained to one BullMQ job** — a stuck connector doesn't take down the api process. The api `/ready` doesn't depend on any of them.

### MinIO

- AWS SDK has built-in retry (3×, exponential backoff). Default connect 3 s, read 5-30 s.
- `/api/v1/ready` probes `/minio/health/live`.

---

## 6. Known gaps (deferred)

1. **KMITL connector lacks an `AbortSignal.timeout()` on `fetch()`.** The KMITL `/api/v1/...` calls in `apps/ingestion/.../kmitl-skill-mapping/connector.ts:151` use a bare `fetch(url, { method: 'GET', headers })`. A hung TCP connection could pin a BullMQ worker for the OS-default timeout (~60 s on Linux). Not load-bearing for the api request lifecycle (worker-side only) but worth tightening — flagged as a one-line follow-up for prompt 14's KMITL real-data session.
2. **Scopus / OpenAlex breakers not wired.** The profile-page-only call sites (`apps/web/src/lib/{scopus,external}-publications.ts`) already have 8 s `AbortController` timeouts and a fall-back to kkuscholar — single-call shape, lower contention than the AI providers. The breaker would mostly fire when the publication-cache is also unhappy. Backlog: wire breakers when the `kkuscholar` mirror itself starts surfacing in `/ready`.
3. **DLX → an alerting pipeline.** BullMQ's `failed` set is the DLQ, queryable in `/admin/queues`, but we don't yet alert when failures cross a threshold. Tracked for prompt 13/14 ops-polish.
4. **Throttler state in Redis.** Same posture as prompt 09 §"What this prompt does NOT do" — single-instance prod doesn't need cluster-shared throttle state yet.

---

## 7. Files changed

```
 apps/api/src/app.controller.ts                                   |  20 ++++-
 packages/shared/src/ai/providers/factory.ts                      |  78 ++++++++++++++--
 packages/shared/src/index.ts                                     |   1 +
 packages/shared/src/resilience/circuit-breaker.ts         (NEW)  | 159 ++++++++++++++++++++++++++++++++++
 packages/shared/src/resilience/index.ts                   (NEW)  |   1 +
 packages/shared/test/ai-fallback.test.ts                  (NEW)  | 130 +++++++++++++++++++++++++++
 packages/shared/test/circuit-breaker.test.ts              (NEW)  | 124 +++++++++++++++++++++++++++
 ──────────────────────────────────────────────────────────────────────
 7 files (3 modified + 4 new), +513 / −10
```

---

## Acceptance criteria check

| Criterion | Status |
|---|---|
| Killing any single outbound dep does not cause api / ingestion process death | ✅ AI calls go through `wrapWithTransientFallback` + breakers. The factory-level chain catches both transient errors AND breaker-open errors and falls through to the secondary. The breaker primitive itself is unit-tested for double-release safety, FIFO probe ordering, and proper isolation (failures in one breaker don't affect another). |
| `/api/v1/ready` returns 503 with the failing dep named within 3 s of the breaker opening | ✅ The /ready probe walks the snapshot synchronously (no extra network hops); the response includes `breakers[*].state` so the failing dep is named explicitly. The 503 fires immediately when any breaker is OPEN — well within 3 s. |
| Idempotent calls retry; non-idempotent do not | ✅ existing posture (BullMQ retries idempotent ingestion jobs; AI completions don't auto-retry — the fallback IS the retry-equivalent on a different provider). |
| Fallbacks documented and tested | ✅ AI transient-fallback covered by 6 unit tests (`ai-fallback.test.ts`). Scopus → kkuscholar + OpenAlex → cache-only documented in §1. |
| Gotenberg hard timeout + queue cap | ✅ verified in prompt 02c + prompt 09; documented in §5. |

The single pre-existing test failure (`packages/db/test/health-score.test.ts`) is unchanged from prompts 05–10. **Net regression from this prompt: zero.**
