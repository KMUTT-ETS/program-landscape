# Plan — Prompt 11: Outbound timeouts, retries, circuit breakers

**Mode:** code change. Targeted to gaps in the existing reliability stack.

## What's already in place

- **AI transient fallback** (prompt 13) — `wrapWithTransientFallback` catches 429/5xx/timeouts on the primary provider and switches to the secondary.
- **Gotenberg request timeout** — `GOTENBERG_REQUEST_TIMEOUT_MS` (default 60s, also surfaced in compose `API_TIMEOUT: 60s`).
- **Gotenberg concurrency cap** (prompt 09) — process semaphore at 4.
- **Postgres helper** (`apps/ingestion/src/lib/postgres-client.ts`) — `PG_QUERY_TIMEOUT_MS` (default 240s for analytical queries on the kkuscholar mirror).
- **`/api/v1/ready`** — already probes Postgres, Redis, MinIO, Gotenberg, AI provider; returns 503 + per-dep verdict on failure.

## What this prompt adds

| Scope item | Status | Action |
|---|---|---|
| 1. Explicit connect/read timeouts on every outbound HTTP | partial | Audit; document; tighten where missing. |
| 2. DB pool size + idle + query timeout | partial | Verify per-driver config. |
| 3. Bounded retries with backoff + jitter on idempotent calls | partial (BullMQ does this for jobs) | Add a tiny `retryWithJitter` helper for one-shot HTTP calls. |
| 4. **Circuit breakers** | **missing** | Build `CircuitBreaker` primitive in `@kku/shared/resilience/`; wrap AI providers + Scopus + kkuscholar reads. |
| 5. Fallback mapping documented + tested | partial (fallback exists; tests don't) | Write a unit test for `wrapWithTransientFallback`. Document Scopus → kkuscholar + OpenAlex → cache-only. |
| 6. Gotenberg hard timeout + queue cap | done in prompts 02c + 09 | Verify; document. |

## Approach

1. **Tiny circuit breaker** — `@kku/shared/resilience/circuit-breaker.ts`. 3-state (CLOSED, OPEN, HALF_OPEN), threshold N consecutive failures, cooldown D ms, single half-open probe. No external deps. ~80 LOC + tests.
2. **Wire the breaker** at the provider boundary — wrap `wrapWithTransientFallback` so the fallback chain itself is breaker-protected. Exposed singletons:
   - `aiPrimaryBreaker` (Google or Anthropic per `AI_PROVIDER`)
   - `aiSecondaryBreaker` (the other)
   - `scopusBreaker` (profile-page only)
   - `openalexBreaker` (profile-page only)
   - `kkuscholarBreaker` (the postgres-client used for `kku-research`)
3. **`/ready` extension** — add a `breakers` field listing any currently-OPEN breaker. Return `status: 'degraded'` when ≥1 is open.
4. **Tests** — unit test the breaker; unit-test the AI fallback path with both providers throwing; integration test for `/ready` reporting an open breaker.

## Out of scope

- Replacing BullMQ's built-in retry/backoff (already correct).
- Retrofitting every fetch() call site (there are dozens). Focus on the ones the prompt names — AI providers + Scopus + OpenAlex + KMITL + kkuscholar.
- Multi-host load-balancing or active-passive failover.
