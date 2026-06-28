# Trends Radar — real signals, no mock (Phase 1) — design spec

> Date: 2026-06-28 · Status: draft for review
> Part of the "no mock data; real signal connectors" workstream (Phase 1 of 3).
> Phase 2 = policy + research monitors; Phase 3 = document the 4 blocked monitors.

## Problem

The Trends Radar (`/trends`) is dominated by **mock signals that can't be managed**. Root cause, confirmed by inspecting the live dev DB (91 signals):
- The radar's mock data comes from the **9 external-signal connectors running in MOCK mode** (`CONNECTOR_MODE=mocked`, no per-slug override). Their mock output uses **real-looking URLs** (`data.worldbank.org/...`, `eeco.or.th/...`, `oecd.org/...`) so it isn't obviously fake. **79 of 91** dev signals are this connector-mock output.
- The seed's 29 sample signals are **already gated** behind `SEED_MOCKS` (default false, set nowhere) — **zero** seed-mock signals are actually present (0 `example.*` URLs found). So the seed is NOT the culprit; the existing `SEED_MOCKS` guard already aligns with the no-mock policy for seeded data.
- The 11 external-AI-source signals are **real** (real admin-configured URLs, real browser resolution + AI summary); 1 is document-backed (real).
- `/admin/trend-documents` Remove only reaches the 1 document-backed signal — the other 90 can't be removed.

Per the project no-mock-data policy ([[feedback-no-mock-data-policy]]): no mock/placeholder data on dev or prod; wire the real source; blocked sources stay empty, not faked. **The fix is to flip the 9 connectors real (so they emit real signals), purge the accumulated mock-connector signals, and add a way to remove any signal.**

## Goals (Phase 1)

1. **Flip all 9 external-signal connectors to real** on dev + prod, so the radar emits real signals instead of mock.
2. **Purge** the accumulated mock-connector signals (the ~79 non-document/non-external-AI rows) on dev/prod; remove the dead seed-mock-signal block.
3. **Make their live fetch healthy** (verified fixes): a shared browser User-Agent + 3 refreshed catalog URLs. OECD stays signal-only (still real curated metadata).
4. **Option A — Remove any signal** from `/trends` (admin/analyst), with a recurrence warning.

Non-goals (later phases): real monitor auto-discovery (Phase 2/3); building data sources for the 4 blocked monitors.

## Verified facts (probed 2026-06-28)

All 9 produce **real** signals (world-bank from live API; the 8 curated from committed real catalogs, degrading to "signal-only" when a document download fails — the catalog metadata is real, not mock). Live-document reachability after fixes:

| Connector | Fix | Verified |
|---|---|---|
| world-bank | none | live API 200, 10 rows/indicator |
| boi-sectoral | none | PDF 200 |
| mhesi-policy | UA header | 200 (was 403) |
| wef-future-of-jobs | UA header | 200 (was 000) |
| nesdc-reports | none | 302 landing → signal-only |
| nxpo-reports | refresh URL → `https://www.nxpo.or.th/th/en/43052/` | 200 (signal-only) |
| eeco-reports | refresh URL → `https://www.eeco.or.th/en/home/` | 200 (signal-only) |
| adb-gms | refresh URL → `https://www.adb.org/sites/default/files/institutional-document/678631/gms-economic-cooperation-strategic-framework-2030.pdf` | 200 PDF |
| oecd-reports | none viable (403 anti-bot even with UA) | signal-only (acceptable — real metadata) |

## Components

### 1. Seed — already mock-gated; minor cleanup only
- The 29 sample signals live under `if (SEED_MOCKS)` (default false) and are **not** present in any real run — **no functional change required**. To fully honor the no-mock policy (remove the *capability* to create them), **delete the `trendSignalSeeds` array + its `if (SEED_MOCKS)` block** (~lines 758–1107) as dead-code cleanup. Verify nothing else in the seed references those signals (the block is self-contained — the `for` loop only reads `trendSignalSeeds`). Leave the broader `SEED_MOCKS` apparatus (peer programs, scenarios, etc.) alone — that's a separate no-mock-on-dev sweep, out of Phase 1 scope.
- Confirm `SEED_MOCKS` is **not** set to `true` in `.env`, `.env.prod.example`, or the deploy flow (it isn't today) — document that it must stay false/unset.

### 2. Purge the accumulated mock-connector signals — `apps/ingestion/src/scripts/purge-mock-signals.ts` (new)
- The real mock data is the **79 connector-mock signals** (real-looking URLs, so not filterable by `example.*`). Because the 9 connectors run in mock mode *now*, **every** non-document, non-externalAI signal currently on the radar is mock-connector (or inert-monitor) output. Purge predicate: delete `TrendSignal` where it has **no** backing `TrendDocument` **and** `externalAiSourceId IS NULL` (i.e. connector/monitor/seed origin) — these get regenerated as real by the connector runs in §7. Keep external-AI signals (real) + document-backed signals (real).
- Also delete the purged signals' `Notification` rows (`entityId = signalId`). Dry-run by default; `--apply` to delete; print counts by origin. `pnpm trends:purge-mock`.
- Run on dev (before the real connector runs); run on prod once (operator) after deploy + before/with the first real connector runs.

### 3. Flip 9 connectors real — env + data_sources atomicity
- **`.env.example` + `.env.prod.example`:** add `CONNECTOR_<SLUG>_MODE=real` for: `world-bank`, `mhesi-policy`, `nesdc-reports`, `nxpo-reports`, `boi-sectoral`, `eeco-reports`, `wef-future-of-jobs`, `oecd-reports`, `adb-gms` (slug→env: uppercase, `-`→`_`, prefix `CONNECTOR_`, suffix `_MODE`).
- **`data_sources` atomicity** ([[feedback_data_sources_drift_audit]]): flipping a connector real must set BOTH `status='real'` AND `mocked=false` for that slug. Update the catalog entries (`packages/shared/src/ingestion/catalog.ts`) so the seed sets them correctly, AND the purge/flip path updates existing `data_sources` rows on dev/prod (a small update in the purge script or a dedicated `pnpm trends:flip-real` step). Run the comprehensive drift audit after.

### 4. Shared User-Agent header — `apps/ingestion/src/connectors/sources/external-reports/curated-report-connector.ts`
- Add a realistic browser `User-Agent` (+ `Accept`) header to the `fetch()` call that downloads documents. Verified to turn `mhesi` 403→200 and `wef` 000→200. Keep the existing graceful degrade-to-signal-only on any remaining failure.

### 5. Refresh 3 dead catalog URLs — `.../external-reports/catalogs/{nxpo-reports,eeco-reports,adb-gms}.json`
- Replace the dead `sourceUrl`s with the verified ones in the table above. (Keep the other catalog fields; update `title`/`summary` if the target changed materially.)

### 6. Option A — Remove any signal
- **API:** `DELETE /trends/signals/:id` in `apps/api/src/trends/trends.controller.ts` (+ service). Removes: the `TrendSignal`, its `Notification` rows (`entityId=signalId`), and — if a `TrendDocument` points at it — that document + its MinIO object (reuse the logic from `trend-documents.service.ts :: remove`, re-keyed on signalId). `@AuditLog`. Gate: `pdf:upload` (analyst+admin, matching the existing trend-document remove).
- **Web:** `/trends` client — an admin/analyst-gated **Remove** action per signal (two-step confirm), with a **recurrence note**: "Connector- or monitor-sourced signals may reappear on the next ingestion run; seeded/document signals stay removed." Success toast; optimistic removal from the view. Tokens only; no raw hex.
- **Web proxy:** `apps/web/app/api/trends-signals/[id]/route.ts` (DELETE) forwarding to the API, mirroring the existing admin proxy pattern.

### 7. Verification
- `pnpm connector:run <slug>` for all 9 on dev → each SUCCEEDS and creates real signals (or signal-only); capture per-connector record counts.
- After purge + connector runs: `/trends` shows real signals only; `0` rows with `example.*` URLs.
- Remove a signal via the UI → it's gone + its notifications cleared; a connector signal may reappear on re-run (expected — warned).
- `pnpm check` (lint changed-files + typecheck + tests) green.

## Risks / notes
- **Recurrence is by design** (connectors dedup by existence and recreate). The UI warns; durable suppression is explicitly out of scope (the user chose Option A = accept recurrence).
- **OECD** document download stays blocked (signal-only) — real metadata, flagged in its catalog/notes.
- **External network** from dev/prod must reach these hosts; verified reachable from dev today. If prod's network blocks some, those degrade to signal-only (still real) — not a failure.
- **Drift audit** must pass after flipping the 9 (status+mocked atomic).

## YAGNI / non-goals
- No durable signal suppression/tombstones (Option B — rejected).
- No monitor auto-discovery (Phase 2/3).
- No new data sources for blocked monitors.
