# Plan — Prompt 13: Logging quality, redaction, request-id propagation

**Mode:** code change. Builds on prompt-06 redaction + prompt-08 nginx work.

## What's already in place

- **NestJS pino** (`apps/api/src/common/logger.module.ts`) — `genReqId` reads `x-request-id` / `x-correlation-id` from headers OR mints `req_<base36>`. Sets the response `x-request-id` header on the way out. Already in prod.
- **Ingestion pino** (`apps/ingestion/src/app.module.ts`) — same redaction config; no HTTP surface so no request id, but BullMQ logger picks up child contexts.
- **Redaction list** (`packages/shared/src/observability/log-redaction.ts`, prompt 06) — `REDACT_PATHS` + `scrubLogObject()` applied to both pino configs.
- **ISO timestamps** in pino output (prompt 06).
- **Global exception filter** (`apps/api/src/common/exception.filter.ts`) — logs the stack via `this.logger.error` + emits a generic 500 body in prod (no stack leak).
- **nginx access log** (prompt 08) emits `xff`, `xfp`, `req_time`, `upstream_response_time` — but **not the request id**.

## What this prompt adds

| Scope item | Status | Action |
|---|---|---|
| 1. Request ID at every layer (nginx → web → api → ingestion) | partial — nginx absent | nginx: pass through `$http_x_request_id` if present; mint via `$request_id` otherwise; emit in access log; forward to upstream as `X-Request-Id`. |
| 2. Trace context — log `traceId` field | partial | `traceId` = request id for HTTP; for BullMQ jobs, the producer puts `parentTraceId` in `job.data` so worker logs can chain back. |
| 3. Redaction list applied uniformly | done in prompt 06 | Add a sample log line to the report; the existing 10 redaction tests already cover the assertion. |
| 4. Log-level startup guard | **missing** | New helper `assertLogLevelSafe()` — refuses to boot in prod with `LOG_LEVEL=debug` or `trace`. Called from each app's bootstrap. |
| 5. Error envelope log shape | partial | Extend `GlobalExceptionFilter` to log `{ level: 'error', requestId, userId, route, code, stack }` on every caught error. Body still omits stack in prod (verified prompt 03). |
| 6. nginx access log format | partial | Add `request_id="$req_id"` to `log_format main`. |

## Approach

1. **`infra/nginx/nginx.conf` + `conf.d/program-landscape.conf`** — emit `$request_id` (nginx auto-mint when `$http_x_request_id` is empty) into the access-log + forward as `X-Request-Id` to upstream. NestJS already prefers a header over the mint.
2. **`packages/shared/src/observability/log-level-guard.ts`** (new) — `assertLogLevelSafe()` throws if `NODE_ENV=production` AND `LOG_LEVEL ∈ {debug, trace, silly}`. Imported from each `main.ts`.
3. **`apps/api/src/common/exception.filter.ts`** — add `requestId`, `userId`, `route`, `code` to the `logger.error` call. Body shape unchanged.
4. **`apps/ingestion/src/queue/queue.ts` + sibling queue.ts files** — extend `IngestionJobData` (et al) with optional `parentTraceId?: string`. Worker reads it into a child logger.
5. **Tests:**
   - `log-level-guard.test.ts` — refuses in prod with debug; passes in dev with debug.
   - 1 unit test added to `log-redaction.test.ts` covering each redacted key (already covers most; verify each canonical key).
6. **Report** — `13-logging.report.md` with a synthetic request-id walkthrough showing the trace id flow nginx → api → ingestion → outbound.

## Out of scope

- OpenTelemetry instrumentation (planned for prompt 14 ops polish).
- Forwarding Redis / Postgres slow-query logs into the central pipeline.
- Correlating client-side errors (no client logger today).
