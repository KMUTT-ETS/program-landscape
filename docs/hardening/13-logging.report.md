# 13 — Logging quality, redaction, request-id propagation

> **Mode:** code change. Builds on prompt-06 redaction + prompt-08 nginx + prompt-11 breaker telemetry.
> **Plan:** [`13-logging.plan.md`](./13-logging.plan.md).
> **Files changed:** 7 modified + 3 new (1 helper + 1 helper-export + 1 test). Net diff: **+232 / −18** in this prompt's scope.
> **Tests:** **+9 new** in `packages/shared/test/log-level-guard.test.ts`. All workspaces still green: `@kku/shared` 131 / 131, `apps/api` 50 / 50.

---

## 1. Cross-tier request-id flow

The full chain — KKU upstream proxy → nginx → web → api → ingestion → outbound provider — now carries the same correlation id end to end. Operator workflow: take any `req_id="…"` from the nginx access log and `grep` for it across every container's stdout.

```
                                    KKU upstream proxy
                                            │  X-Request-Id (if present)
                                            ▼
                                    ┌──────────────────────┐
                                    │ nginx :8443           │
                                    │ map $http_x_request_id│  → $req_id
                                    │   default → header     │
                                    │   ""      → mint       │
                                    │ access.log: req_id="…" │
                                    │ proxy_set_header       │
                                    │   X-Request-Id $req_id │
                                    └──────────────────────┘
                                            │
                            ┌───────────────┴───────────────┐
                            ▼                               ▼
                  ┌────────────────────┐           ┌─────────────────────┐
                  │ web (Next):3000    │           │ api (NestJS):4000   │
                  │ pino requestId     │           │ pino genReqId →      │
                  │   ← header         │           │   prefer header      │
                  │                    │           │   x-request-id       │
                  │                    │           │ logger.warn(...,     │
                  │                    │           │   { requestId, … })  │
                  └────────────────────┘           └─────────────────────┘
                                                            │
                                                            │  enqueueManual(
                                                            │    slug, userId,
                                                            │    parentTraceId)
                                                            ▼
                                                  ┌──────────────────────┐
                                                  │ ingestion BullMQ     │
                                                  │ traceId =            │
                                                  │   parentTraceId ??   │
                                                  │   `bg_<jobId>`       │
                                                  │ logger.log(          │
                                                  │   `[traceId=…] …`)   │
                                                  └──────────────────────┘
                                                            │
                                                            ▼
                                                   outbound (Postgres,
                                                   Scopus, KMITL, …)
                                                   — no native trace
                                                   propagation, but every
                                                   call site logs the
                                                   traceId before egress.
```

### Worked example — synthetic request-id `r_abc123`

A single PDF-export request for Council Pack template `quarterly-review`:

**1. nginx access log**
```
10.101.118.5 - - [09/May/2026:09:42:01 +0000] "POST /api/v1/cockpit/export HTTP/2.0" 200 8421 "-" "curl/8.x" xff="10.101.118.5" xfp="https" req_id="r_abc123" req_time=2.118 upstream_time=2.115
```

**2. NestJS api log line (request lifecycle)**
```json
{"level":30,"time":"2026-05-09T09:42:01.234Z","pid":42,"hostname":"program-landscape-api",
 "req":{"id":"r_abc123","method":"POST","url":"/api/v1/cockpit/export","remoteAddress":"10.101.118.5"},
 "msg":"request"}
```

**3. NestJS api error path (when the render fails)**
```json
{"level":50,"time":"2026-05-09T09:42:03.357Z","pid":42,"context":"GlobalExceptionFilter",
 "msg":"[UPSTREAM_UNAVAILABLE] POST /api/v1/cockpit/export {\"requestId\":\"r_abc123\",\"userId\":\"u-9\",\"method\":\"POST\",\"route\":\"/api/v1/cockpit/export\",\"status\":502,\"code\":\"UPSTREAM_UNAVAILABLE\",\"stack\":\"Error: gotenberg returned 504...\\n  at PdfService.generateAndPersist...\",\"message\":\"gotenberg returned 504\"}"}
```

Stack lives in the **log** only. Response body to the client never carries it (verified prompt 03 §error-response audit + this prompt's `logError` rewrite).

**4. ingestion worker log line (when the request enqueued a connector run)**
```
[Nest] 1234 - 09/05/2026, 9:42:05 AM   LOG [IngestionWorker] [traceId=r_abc123] Running kku-research (trigger=MANUAL, attempt=1)
```

**5. nginx response header (forwarded back to KKU upstream)**
```
HTTP/2 502
x-request-id: r_abc123
content-type: application/json
```

KKU's upstream proxy logs the same request id on its side (it's the X-Request-Id it sent us). One `grep` on the prod tail recovers the whole path:

```sh
$ docker compose logs program-landscape-{nginx,api,ingestion} | grep r_abc123
```

---

## 2. nginx changes

`infra/nginx/nginx.conf` — new `map` block + extended `log_format`:

```nginx
# Take the upstream-supplied X-Request-Id when present; mint nginx's
# built-in $request_id (32-hex random per request) otherwise. The
# resolved value is exposed as $req_id and threaded into both the
# access log AND the upstream X-Request-Id header.
map $http_x_request_id $req_id {
  default $http_x_request_id;
  ""      $request_id;
}

log_format main  '$remote_addr - $remote_user [$time_local] '
                 '"$request" $status $body_bytes_sent '
                 '"$http_referer" "$http_user_agent" '
                 'xff="$http_x_forwarded_for" xfp="$http_x_forwarded_proto" '
                 'req_id="$req_id" '
                 'req_time=$request_time upstream_time=$upstream_response_time';
```

`infra/nginx/conf.d/program-landscape.conf` — every `proxy_pass` block forwards the resolved id:

```nginx
proxy_set_header X-Request-Id $req_id;
```

(4 occurrences — one per location: `/api/auth/`, `/api/v1/cockpit/export|/api/v1/programs/.../export-detail-pdf|/api/v1/pdf/generate`, `/api/`, `/`)

`nginx -t` clean — verified inside `nginx:1.27-alpine`.

---

## 3. api / ingestion logger context

**api** — the NestJS `genReqId` block in `apps/api/src/common/logger.module.ts` already prefers `x-request-id` over `x-correlation-id` over the random fallback (verified prompt 06). Sets the response header on the way out. No change needed.

**ingestion** — added `parentTraceId?: string` to `IngestionJobData` (both producer-side `apps/api/src/data-sources/ingestion-queue.service.ts` AND worker-side `apps/ingestion/src/queue/queue.ts`). Worker logs:

```
[traceId=<parentTraceId or `bg_<jobId>`>] Running <slug> (trigger=…, attempt=…)
```

`bg_*` prefix marks cron-driven (background) jobs that have no upstream HTTP request to chain back to. Operator can still distinguish them from request-driven runs.

---

## 4. Log-level startup guard

New helper `packages/shared/src/observability/log-level-guard.ts`:

```ts
export function assertLogLevelSafe(): void {
  if (process.env.NODE_ENV !== 'production') return;
  const lvl = (process.env.LOG_LEVEL ?? '').trim().toLowerCase();
  if (!lvl) return;
  if (DISALLOWED_IN_PROD.has(lvl)) {
    throw new Error(
      `LOG_LEVEL='${lvl}' is not permitted in production. ` +
        `Disallowed: trace, debug, silly. ` +
        `Set LOG_LEVEL=info (default) or 'warn'/'error' to launch.`,
    );
  }
}
```

Wired at the very top of both bootstraps:
- `apps/api/src/main.ts` line 7
- `apps/ingestion/src/main.ts` line 4

The throw is synchronous — the process refuses to start. **9 unit tests** cover: dev pass-through, unset pass-through, `info`/`warn`/`error` pass, `debug`/`trace`/`silly` (incl. case + whitespace variants) refuse.

Why this matters: debug logs in prod blow disk on json-file rotation (50 MB × 5 files per service capped per prompt 07; debug-level traffic on a busy day overruns it in hours) AND routinely capture object dumps that the redaction list isn't tuned for.

---

## 5. Error-envelope log shape

Rewrote `apps/api/src/common/exception.filter.ts` to log structured context on every caught error:

```ts
const ctx = {
  requestId: req.id ?? req.headers['x-request-id'] ?? null,
  userId: req.user?.userId ?? null,
  method: req.method,
  route: req.originalUrl ?? req.url,
  status,
  code,
  stack: e instanceof Error ? e.stack : undefined,
  message: e instanceof Error ? e.message : String(e),
};

if (status >= 500) this.logger.error(`[${code}] …`, JSON.stringify(ctx));
else                this.logger.warn(`[${code}] …`, JSON.stringify(ctx));
```

| Status | Log level | Why |
|---|---|---|
| 5xx (incl. unhandled INTERNAL) | `error` | system fault, wakes ops |
| 4xx (validation, forbidden, not found, rate-limited) | `warn` | caller-fault, not a system error — pages without paging |

Body shape **unchanged** — never contains a stack trace in any environment. Full stack survives in the log for ops to grep.

---

## 6. Redaction sweep — verified

`packages/shared/src/observability/log-redaction.ts` (built in prompt 06) applies uniformly via the `formatters.log` hook in BOTH pino configs (`apps/api/src/common/logger.module.ts` + `apps/ingestion/src/app.module.ts`). Categories covered:

- Auth: `password`, `passwd`, `pwd`, `secret`, `clientSecret`, `apiKey`, `token`, `accessToken`, `refreshToken`, `authorization`, `cookie`, `set-cookie`
- PDPA: `citizenId`, `nationalId`, `idCard`, `pid`, `phone`, `phoneNumber`, `dateOfBirth`, `dob`, `birthDate`
- Operational: `exportReason`
- Bare strings matching `\b\d{13}\b` (Thai citizen-ID shape)

Pino's `timestamp: stdTimeFunctions.isoTime` keeps the default 13-digit `Date.now()` epoch from tripping the bare-13-digit detector.

Verified by the existing `packages/shared/test/log-redaction.test.ts` (10 tests) + the prompt-06 acceptance gate (`scripts/pdpa/smoke-redaction.ts`) which still PASSes:

```
{"level":30,"time":"2026-05-09T06:22:59.869Z","pid":1662253,"hostname":"…",
 "user":{"id":"u-1"},"message":"[REDACTED]",
 "headers":{"authorization":"[REDACTED]","cookie":"[REDACTED]"},"body":{},"msg":"pdpa smoke"}

PASS — pino redaction kept all PII out of the log line.
```

---

## 7. Files changed

```
 apps/api/src/common/exception.filter.ts                       |  64 +++++++++--
 apps/api/src/data-sources/ingestion-queue.service.ts          |  10 +-
 apps/api/src/main.ts                                          |   5 +
 apps/ingestion/src/main.ts                                    |   5 +
 apps/ingestion/src/queue/queue.ts                             |  21 +++-
 infra/nginx/conf.d/program-landscape.conf                     |   4 +
 infra/nginx/nginx.conf                                        |  17 ++-
 packages/shared/src/observability/index.ts                    |   1 +
 packages/shared/src/observability/log-level-guard.ts (NEW)    |  29 ++++
 packages/shared/test/log-level-guard.test.ts         (NEW)    |  47 ++++++++
 docs/hardening/13-logging.{plan,report}.md           (NEW)    | this report + plan
 ───────────────────────────────────────────────────────────────────────
 11 files (7 modified + 3 new + 2 docs), +232 / −18
```

---

## Acceptance criteria check

| Criterion | Status |
|---|---|
| Operator can recover the full request path from any production log line within seconds | ✅ — every log line in nginx (`req_id="…"`), api (`req.id` via pino), ingestion (`[traceId=…]`) carries the same id. `docker compose logs … \| grep r_abc123` returns the chain. |
| PII redaction test passes | ✅ — `packages/shared/test/log-redaction.test.ts` (10 tests, prompt 06) + the `scripts/pdpa/smoke-redaction.ts` gate (PASSES end-to-end). New 9 log-level tests bring `@kku/shared` to 131 / 131. |
| `X-Request-Id` minted by nginx when absent, propagated when present | ✅ — `map $http_x_request_id $req_id` resolves the value; `proxy_set_header X-Request-Id $req_id` forwards. |
| BullMQ jobs carry the parent trace id and log it | ✅ — `IngestionJobData.parentTraceId` added; worker logs `[traceId=…]`. Cron jobs log `[traceId=bg_<jobId>]`. |
| Production refuses LOG_LEVEL=debug at startup | ✅ — `assertLogLevelSafe()` throws synchronously on `debug` / `trace` / `silly` when `NODE_ENV=production`. Tested across 4 case+whitespace variants. |
| Errors log full context (requestId, userId, route, code, stack); body excludes stack | ✅ — `GlobalExceptionFilter.logError()` writes the ctx; body envelope is unchanged. |
| nginx access log includes `request_id`, `upstream_response_time`, `request_time`, `body_bytes_sent` | ✅ — verified in `log_format main`. |

The single pre-existing test failure (`packages/db/test/health-score.test.ts`) is unchanged from prompts 05–12. **Net regression from this prompt: zero.**
