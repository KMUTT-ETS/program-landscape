# Plan — Prompt 14: Graceful shutdown + readiness probes

**Mode:** code change. Builds on prompts 07 (compose healthchecks) + 11 (`/ready` 503 on breaker open).

## What's already in place

- `apps/api/src/main.ts` — `app.enableShutdownHooks()` registers SIGINT/SIGTERM listeners that call `app.close()` (which waits for in-flight requests + invokes `onModuleDestroy` hooks).
- `apps/ingestion/src/main.ts` — has manual `SIGTERM` / `SIGINT` handlers that call `app.close()`.
- Compose `depends_on: { condition: service_healthy }` (prompt 07) — every service waits for its deps.
- `/api/v1/healthz` (liveness, dumb 200) + `/api/v1/ready` (readiness, deep probe, **503** when any check fails OR any breaker open per prompt 11).
- `restart: unless-stopped` on every container — idempotent boot.

## What this prompt adds

| Scope item | Status | Action |
|---|---|---|
| 1. SIGTERM drains in-flight | partial — Nest does it; ingestion worker close path needs verification | Verify `IngestionService.onModuleDestroy` closes the BullMQ worker; if not, add it. |
| 2. Liveness vs readiness — compose healthcheck on the right one | **wrong target** — compose `api.healthcheck` currently calls `/api/v1/ready`. That makes a single dep flapping flap the api container. | Switch compose healthcheck to `/api/v1/healthz`. nginx already gates on whatever the upstream returns; readiness is for the KKU upstream proxy poller, not for compose. |
| 3. Startup ordering | done | Verify; document. |
| 4. Drain on deploy | partial — `docker compose up -d` swaps in-place; no explicit `stop --timeout 30` | Add `docker compose stop --timeout 30` step before the new images come up (only for the existing-deploy path). |
| 5. Idempotent boot | done | Document. |
| **NEW:** drain mode → `/ready` 503 immediately on SIGTERM | **missing** | Set a process-level `isDraining` flag on SIGTERM. `/ready` returns 503 the moment the flag flips, even before in-flight requests complete. KKU upstream proxy then stops sending NEW requests within its 30 s polling window. |

## Approach

1. **`packages/shared/src/observability/drain-state.ts`** (new) — process-singleton flag. `markDraining()` flips. `isDraining()` reads. Two unit tests.
2. **`apps/api/src/app.controller.ts`** — `/ready` returns 503 when `isDraining()` is true.
3. **`apps/api/src/main.ts`** — SIGTERM/SIGINT handler calls `markDraining()` then `app.close()`.
4. **`apps/ingestion/src/main.ts`** — same pattern. Worker `close()` waits for active jobs.
5. **`apps/ingestion/src/ingestion.service.ts`** — verify `onModuleDestroy` closes the worker.
6. **`docker-compose.prod.yml`** — flip api healthcheck to `/healthz` (liveness only). Keep web's healthcheck on `/api/auth/providers` (also a liveness probe).
7. **`scripts/deploy.sh`** — add `docker compose stop --timeout 30` before the symlink swap, only when `current` exists.

## Acceptance test plan

The synthetic 50-concurrent-request test requires a live container. Document the procedure in the report:

```bash
# 1. Boot the api in dev mode.
# 2. Fire 50 concurrent /api/v1/programs?scope=university requests via xargs/curl.
# 3. While they're in flight (long enough to be drainable):
#    docker kill --signal=SIGTERM program-landscape-api
# 4. Assert: all 50 complete with 2xx within the 30s drain window.
# 5. New requests during drain: receive 503 from /ready (KKU upstream
#    poller stops forwarding within the polling window).
```

We can't run the full test from this audit context (no live prod compose), so the deliverable is the documented procedure + the unit tests for the drain-state primitive.

## Out of scope

- True zero-downtime blue/green deploy (single-host single-instance prod).
- Kubernetes-style preStop hooks (we run docker-compose).
- Per-request load shedding beyond the throttler chain (already in place from prompt 09).
