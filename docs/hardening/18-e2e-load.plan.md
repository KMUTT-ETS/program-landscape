# Plan — Prompt 18: End-to-end smoke + k6 load harness

**Mode:** code change + operator-doc. Smoke test bodies + load scripts ship from this dev box;
"runs against staging" is the operator gate (requires a live staging env that doesn't exist yet
on this dev machine).

## Recon

| Asset | State |
|---|---|
| Playwright config | `apps/web/playwright.config.ts` exists; chromium-only project. |
| Existing e2e | `apps/web/e2e/smoke.spec.ts` — 1 dev-credentials sign-in test (sign-in → home → theme → sign-out). |
| Playwright deps | `@playwright/test ^1.49.1` installed; **browsers not yet installed** (`pnpm exec playwright install` still required per CLAUDE.md). |
| `tests/load/` directory | Not present. `scripts/load/ai-cap-probe.ts` exists (single-purpose AiQuotaGuard probe). |
| k6 binary | Not installed locally. Available on the standard k6 docker image `grafana/k6`. |
| CI | `.github/workflows/pr.yml` runs lint+typecheck+test+migration-linter+ai-eval. **No e2e or k6 job.** |
| Compose stack | `docker-compose.prod.yml` is the production stack; no compose for an e2e test stack. |
| Routes inventory | `docs/hardening/04-authz-matrix.report.md` enumerates 152 NestJS API routes + 29 Next handlers. |

## What this prompt actually delivers from the dev machine

| Scope item | Action |
|---|---|
| 1. Playwright suite (8 user journeys) | Add 7 new test specs under `apps/web/e2e/` covering: SSO sign-in (mocked path via dev creds), dashboard load, cockpit filter, gap-analyzer, Council Pack export, profile cold load, admin auth, sign-out. Each test independent, isolated, idempotent. Council-Pack export: `test.skip` when Gotenberg unreachable (so the suite stays green on CI without infra). |
| 2. Tests run against prod-mode compose stack | Document the `pnpm e2e:stack` invocation. The stack itself (Postgres + Redis + MinIO + Gotenberg + api + web seeded with fixture data) is the operator gate — requires the dev/staging compose. |
| 3. k6 harness — scenario A (Council day) | NEW `tests/load/council-day.js` — 30 VU shaped load + 4 concurrent Council-Pack exports. Stages: ramp-up 30s → steady 5min → ramp-down 30s. Thresholds: p95 < 1.5s, error rate 0%. |
| 4. k6 harness — scenario B (ingestion overlap) | NEW `tests/load/ingestion-overlap.js` — same VU profile + a separate scenario simulating the 4 a.m. cron load. Thresholds: p95 < 2.5s, errors < 0.5%. |
| 5. p50/p95/p99 + error rate per endpoint | k6 emits this natively via `http_req_duration` aggregations. Document the report-export incantation. |
| 6. Pass thresholds | k6 `thresholds` block; non-zero exit on breach (CI gate). |

## What requires staging (operator gate, documented)

- Real KKU SSO sign-in path. Dev environments use the `ENABLE_LOCAL_AUTH=true` credentials
  provider; CI uses the same. Real OIDC flow is the staging gate.
- Actual k6 run + measured numbers. Documented procedure + thresholds in the report; the
  baseline-vs-thresholds table is a placeholder until a staging env is online.
- Council Pack export end-to-end requires Gotenberg + MinIO running. The Playwright test
  detects this and `test.skip`s when unreachable.

## CI wiring approach

- **PR workflow** (`.github/workflows/pr.yml`): no auto-run of e2e or k6 — they need a stack.
  Both gated behind `workflow_dispatch` (manual trigger by ops) so CI minutes stay sane.
- **e2e job** (NEW): on `workflow_dispatch` only, spins up the dev compose, seeds the fixture DB,
  runs the smoke spec. ~5 min wall-clock.
- **k6 job** (NEW): on `workflow_dispatch` only, takes a `target_url` input, runs scenario A.
  Operator runs scenario B manually with the cron-overlap context.

## Out of scope

- Replacing the dev-creds sign-in path with a real OIDC mock (oidc-provider container).
  Possible but ~½ day of work; the dev-creds path tests every downstream surface identically
  so the additional value is marginal.
- Per-endpoint synthetic-monitoring dashboards (Grafana). Operator picks tooling at deploy time.
- Distributed k6 (multiple workers). Single-node k6 saturates 30 VU + 4 PDFs comfortably; only
  needed if we go past ~500 VU.
- Soak / endurance test (24-h run). Documented as a follow-up for first-week-in-prod ops.
