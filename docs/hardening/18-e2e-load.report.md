# 18 — End-to-end smoke + k6 load harness

> **Mode:** code change + operator-doc. Test scripts + CI wiring ship from this dev box;
> the run-against-staging numbers are documented as the operator gate (no live staging URL
> yet from this dev machine).
> **Plan:** [`18-e2e-load.plan.md`](./18-e2e-load.plan.md).
> **Files changed:** **0 modified + 6 new.** Net diff: +773 LOC (test + CI).
> **Tests:** existing suite stays green (no new vitest tests; the scope is e2e + load).

---

## 1. Playwright smoke — 7 new user journeys

`apps/web/e2e/council-day.spec.ts` (NEW, 150 LOC). Builds on the existing
`apps/web/e2e/smoke.spec.ts` (dev-credentials sign-in test from prompt 02). Each test is
independent + idempotent; uses the shared `signInWithDevCreds()` helper.

| # | Test | What it pins |
|---|---|---|
| 1 | dashboard cold load shows the home greeting | sign-in lands off `/signin`; admin lands on dev overview, council/dean lands on `/cockpit` |
| 2 | cockpit page loads with at least one chart container | `/cockpit` returns and `<main>` mounts |
| 3 | cockpit faculty filter — URL state is shareable | `?scope=faculty&scopeId=…` URL state survives a navigation |
| 4 | gap analyser page loads | `/gap-analysis` returns and mounts |
| 5 | profile cold load — page mounts | `/profile` returns and mounts |
| 6 | admin pages — admin can reach data-quality dashboard | admin user is NOT bounced to `/no-access` or `/signin` |
| 7 | sign-out — clears session and redirects to /signin | post-sign-out re-fetch of `/cockpit` redirects to `/signin` |

Plus the **gated Council-Pack export test** that auto-`test.skip`s when Gotenberg is
unreachable, so the suite stays green on CI environments without the full infra. When the
stack IS present, it fires `POST /api/v1/cockpit/export` and asserts the returned payload
either has a `downloadUrl` whose body is > 1 KB, or a non-empty inline payload.

### Why dev creds and not real OIDC

The dev-creds path (NextAuth `dev-credentials` provider) tests every downstream surface
identically — same JWT signing, same session cookie, same RBAC entry point. Standing up an
oidc-provider mock container would be ~½ day of work for marginal additional value. The real
OIDC sign-in path is the staging gate (CLAUDE.md notes the local-creds path hard-fails in
production via `assertLocalAuthSafe()`).

### Acceptance gate — operator runs

```bash
# Prereqs (one-time)
pnpm db:up && pnpm db:seed
pnpm --filter web exec playwright install --with-deps chromium

# In one terminal
pnpm dev

# In another
pnpm --filter web test:e2e
```

CI: `.github/workflows/e2e.yml` (NEW, 86 LOC) runs the suite on `workflow_dispatch`. Stack
boot ~90 s + Playwright run ~3 min = ~5 min wall-clock. Trace artifacts uploaded on failure.

---

## 2. k6 load harness

Two scripts under `tests/load/` (NEW). Each encodes pass thresholds in `options.thresholds`;
non-zero exit on breach.

### Scenario A — Council day (`tests/load/council-day.js`, 184 LOC)

Two parallel sub-scenarios:
- **`dashboard_readers`** — 30 VU ramping (30 s up / 5 min steady / 30 s down). Each VU loops
  through `cockpit/heatmap → gap-analysis/skills → programs/{KKU-SEQ-NNNN}/overview` with 1-3 s
  thinks between.
- **`pdf_exporters`** — 4 constant VU starting after a 15 s warm-up. Each iteration POSTs a
  `cockpit/export` (Council Pack) and waits ~60 s before the next.

| Metric | Threshold | Rationale |
|---|---|---|
| `cockpit_duration_ms` p95 | < 1500 ms | acceptance criterion |
| `gap_duration_ms` p95 | < 1500 ms | acceptance criterion |
| `program_duration_ms` p95 | < 1500 ms | acceptance criterion |
| `export_duration_ms` p95 | < 30 000 ms | Gotenberg + Chromium render dominate; SLO |
| `read_errors` rate | == 0 | acceptance criterion |
| `export_errors` rate | == 0 | acceptance criterion |
| `http_req_failed` rate | < 1 % | global guard rail |

### Scenario B — Ingestion overlap (`tests/load/ingestion-overlap.js`, 187 LOC)

Same readers + exporters PLUS:
- **`ingestion_cron`** — 1 VU repeatedly POSTing `/api/v1/data-sources/{slug}/runs` against
  the **mocked** connector safe-list (`jobthai`, `jobsdb`, `tcas-applications`,
  `world-bank-skills`, `ilo-statistics` — all `mocked: true`). The goal is to model BullMQ +
  Postgres pressure without actually hammering upstream APIs.

| Metric | Threshold | Rationale |
|---|---|---|
| read p95 | < 2500 ms | acceptance criterion (relaxed) |
| read errors | < 0.5 % | acceptance criterion (relaxed) |
| export p95 | < 60 000 ms | degraded SLO during cron window |
| export errors | < 1 % | degraded SLO |
| ingestion trigger p95 | < 5000 ms | trigger is async; only the enqueue is blocking |
| ingestion errors | < 5 % | mocked connectors should always succeed; allowance for transient locking |

### Per-endpoint Trends + tags

Each script defines explicit `Trend` metrics (`cockpit_duration_ms`, `gap_duration_ms`,
`program_duration_ms`, `export_duration_ms`) on top of k6's default `http_req_duration`. Each
request also carries a `tags: { endpoint: 'cockpit' }` so the JSON export can be sliced by
endpoint in downstream tooling.

`summaryTrendStats: ['avg', 'p(50)', 'p(95)', 'p(99)', 'max']` — k6's default omits p99; we
override to surface the long tail.

### Pass-fail signal

```
✓ cockpit_duration_ms.....: avg=312ms  p(50)=287ms  p(95)=798ms   ...
✗ export_duration_ms......: avg=12.3s  p(50)=11.8s  p(95)=33s     ...
                                                          ↑
                                            threshold breached
```

`✗` → exit 99 → CI job fails. Operator interprets which threshold breached and what
remediation (more Gotenberg replicas, raise the SLO budget, tune the connector …).

### Acceptance gate — operator runs (against staging)

Documented in `tests/load/README.md` (NEW, 80 LOC). Procedure:
1. Sign in via Playwright (or browser); copy `__Secure-authjs.session-token` from DevTools.
2. `K6_BASE_URL=… K6_JWT=… k6 run tests/load/council-day.js`.
3. For scenario B: also need `K6_ADMIN_JWT=…` (admin has `ingestion:trigger`).
4. CI alternative: `.github/workflows/load.yml` (NEW, 49 LOC) on `workflow_dispatch`,
   takes `target_url` + `scenario` inputs, reads JWTs from
   `secrets.LOAD_TEST_USER_JWT` / `secrets.LOAD_TEST_ADMIN_JWT`.

---

## 3. CI wiring

| Workflow | Trigger | Why not on PR? |
|---|---|---|
| `.github/workflows/e2e.yml` | `workflow_dispatch` | Stack boot is ~90 s of CI minutes per run. Behaviour-tests from prompt 17 catch most regressions cheaper. Ops triggers e2e before tagging a release. |
| `.github/workflows/load.yml` | `workflow_dispatch` (with `target_url` + `scenario` inputs) | Load tests against staging are destructive (consume throughput, generate audit-log entries, may trip rate limits). Threshold breaches need operator interpretation. |

Both jobs upload artefacts on completion — Playwright traces on failure (e2e), k6 JSON
summaries always (load).

---

## 4. Files changed (this prompt)

```
 apps/web/e2e/council-day.spec.ts            (NEW)  | +150
 tests/load/council-day.js                   (NEW)  | +184
 tests/load/ingestion-overlap.js             (NEW)  | +187
 tests/load/README.md                        (NEW)  | +80
 .github/workflows/e2e.yml                   (NEW)  | +86
 .github/workflows/load.yml                  (NEW)  | +49
 docs/hardening/18-e2e-load.{plan,report}.md (NEW)  | this report + plan
 docs/hardening/18-e2e-load.bench/                  | empty — populated on first staging run
 ────────────────────────────────────────────────────
 6 source files (all new) + 2 docs + 1 empty bench dir
```

---

## 5. Acceptance criteria check

| Criterion | Status |
|---|---|
| Full smoke suite passes against staging | **operator gate** — 7 new test specs + 1 gated Council-Pack export test ship from this dev box. Run via `pnpm --filter web test:e2e` (local) or `.github/workflows/e2e.yml` (CI). Tests deliberately use the dev-creds path; real OIDC sign-in is the staging-only run. |
| Scenario A: p95 < 1.5 s and 0 % errors | **threshold encoded** in `tests/load/council-day.js`. k6 exits non-zero on breach. Run procedure documented in `tests/load/README.md`. The numerical baseline is filled in after the first staging run lands `summary.json` under `docs/hardening/18-e2e-load.bench/`. |
| Scenario B: p95 < 2.5 s and < 0.5 % errors | **threshold encoded** in `tests/load/ingestion-overlap.js`. Same gate as scenario A. |
| Per-endpoint p50 / p95 / p99 + error rate | ✅ k6's `summaryTrendStats: ['avg','p(50)','p(95)','p(99)','max']` + per-endpoint `Trend` metrics + endpoint tags. |
| Explicit pass thresholds; fail on breach | ✅ `options.thresholds` blocks; k6 exits 99 → CI fails. |

---

## 6. What this prompt does NOT do

- **Run the actual measurements.** Both scripts are operator-runnable and CI-runnable, but
  the staging URL doesn't exist on this dev machine. The bench dir
  (`docs/hardening/18-e2e-load.bench/`) is created empty; first staging run lands
  `summary.json` there, then a follow-up commit appends the measured table to this report's
  §2 alongside the thresholds.
- **Real OIDC sign-in mock.** Dev-creds path covers every downstream surface; oidc-provider
  container is ~½ day of additional work. Real OIDC is the staging-only path.
- **Distributed k6.** Single-node saturates 30 VU + 4 PDFs comfortably; only needed past
  ~500 VU.
- **Soak / endurance test.** First-week-in-prod ops follow-up.
- **Browser-based k6 (xk6-browser).** Not needed — Playwright covers UI paths, k6 covers API
  throughput. Two specialised tools beat one fragile generalist.
- **Per-endpoint synthetic-monitoring.** Operator picks tooling at deploy time (Grafana
  Cloud, Datadog Synthetics, etc.).
