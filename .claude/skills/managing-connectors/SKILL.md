---
name: managing-connectors
description: Use when an institution wants its own data in Program Landscape from an HTTP/JSON API — creating, fixing, extending or retiring a dataset API connector (api-<name>), when a connector run failed or was refused, a token expired, the API changed, or the Program Deep-Dive is empty after a load.
---

# Managing dataset API connectors

## Overview

A dataset API connector (`DatasetApiConnector`, slug `api-<name>`) fills one or more import datasets from an institution's own API. Validation and loading reuse the XLSX upload pipeline, so every upload rule applies. **A connector is done when `pnpm connector:verify <slug>` reports no FAIL** — not when a test passes or a run succeeds.

The code is the source of truth; when a doc disagrees with it, follow the code:
`apps/ingestion/src/connectors/base/dataset-api-connector.ts`, `apps/ingestion/src/connectors/base/api-client.ts`, `apps/ingestion/src/scripts/connector-new/`, `packages/db/src/import/datasets/<dataset>.ts`.

## Scope — decide first

| The human has | Do |
|---|---|
| API docs and/or a sample JSON response | Continue below |
| Only database access, no HTTP API | Stop. They export to XLSX and upload (`docs/data-import.md`). No connector. |
| A KKU-internal DB connector, scraper, PDF source | Not this skill — `docs/guides/write-a-connector.md` |

New or existing? `pnpm connector:new --list` and `packages/shared/src/ingestion/institution-catalog.ts`. Which dataset holds what: the table in `docs/data-import.md` ("What you can import today").

**Env names.** Every variable is `CONNECTOR_<SLUG>_<NAME>` with the slug upper-cased and `-` → `_`: slug `api-registrar` → `CONNECTOR_API_REGISTRAR_BASE_URL`, `_TOKEN`, `_MAX_ROWS`, `_ALLOW_SHRINK`.

**Deadline?** A connector that cannot reach no-FAIL in time is not demoed. The same data can be uploaded as XLSX (`docs/data-import.md`) meanwhile.

## Rules

- No real personal data in fixtures, logs, run metadata, chat or commits — see `pii.md`.
- Never print env-file values. Refer to variables by name (`CONNECTOR_<SLUG>_TOKEN`). Ask the human to set them.
- Never set `CONNECTOR_<SLUG>_ALLOW_SHRINK` yourself. Only the data owner decides, for one run, and it is unset afterwards.
- Destructive DB commands (reset, drop, migrate diff) go to the operator. If you may not run `data-sources:sync` / `connector:run` yourself, give the human the exact commands and read back their output.

## Create

1. **Plan the mapping.** `pnpm connector:new --list` → pick dataset(s). Read each dataset's declaration and write a mapping table — see `field-mapping.md`. Datasets load in `IMPORT_DATASETS` order; a dataset that names programmes or faculties needs those loaded first.
2. **Probe the live API once** before writing code. Docs and samples drift from the real API:
   ```bash
   curl -sS -H "Authorization: Bearer $CONNECTOR_API_<NAME>_TOKEN" "$CONNECTOR_API_<NAME>_BASE_URL/<path>?limit=2"
   ```
   (export the two variables in your shell first; never paste the token into the command.) If the human pasted a sample containing personal data, say so once, do not repeat it, and leave those fields out of everything you write. Note paging (cursor/page/offset), the envelope (`data`, `items`), year basis and code formats. Show the human field *names*, not values.
3. **Scaffold:** `pnpm connector:new --name <name> --dataset <slug[,slug]> --dry-run`, then without `--dry-run`.
4. **Implement** `fetchAll` (one Zod schema per endpoint listing only the fields you map; paging through `api.getJson`/`api.paginate`; for per-parent endpoints such as `/programmes/{code}/…`, get the code list from a list endpoint of the API if it has one, else from loaded programmes, and skip `HTTP_404` per parent deliberately) and `toRows` (header text exactly as the dataset declares). Log via `ctx.log` with counts only.
5. **Fixture + test.** Fixture from the sample with every value invented (`pii.md`). Remove `describe.skip`. Assert on the **outgoing request** (path, query, paging, auth header present) with a fetch stub, and on `toRows` output. A mocked `fetch` that only returns data hides real-API constraints.
6. **Configure:** the human sets `CONNECTOR_API_<NAME>_BASE_URL` and `_TOKEN` (production: compose secrets — `DEPLOYMENT.md`).
7. **Run and verify** — loop until no FAIL:
   ```bash
   pnpm data-sources:sync --apply
   pnpm connector:run api-<name>
   pnpm connector:verify api-<name>
   ```
8. **Look:** open `/programs/<id>` for a loaded programme and confirm the figures show.
9. **Record:** `docs/data-sources/api-<name>.md` from `docs/data-sources/_template.md` (endpoints, mapping table, quirks — no values), then the CLAUDE.md docs-impact check.

## Maintain

- **API changed** (SCHEMA / VALIDATION errors, counts drop): probe again (step 2), compare with the fixture, update schema + `toRows` + fixture, re-run, re-verify.
- **401 / 403 (`HTTP_401`, `HTTP_403`, not retried):** token expired or lacks rights. Tell the human which variable to replace and to restart the ingestion worker. Do not print or guess the value.
- **Shrink guard refused the load:** the API returned much less than is stored. Find out why (paging stopped early, a filter, a 404 skipped, wrong term). Fix the cause. If the owner confirms the smaller set is correct, *they* set `ALLOW_SHRINK=true` for one run, then remove it.
- **Add a dataset:** add its slug to `datasets`, map it in `toRows`, extend fixture and test, `data-sources:sync --apply`, re-verify. Split into a second connector when the endpoints or schedule differ.
- **Retire:** in the catalogue entry set `scheduleEnabled: false` and `deprecated: true`. Never delete the DataSource row or past runs — loaded rows stay attributed to them.

## Reading `connector:verify`

Each line is `PASS | FAIL | WARN | SKIP  <check>`, with `→` the next action. Fix the first FAIL; later checks SKIP until it passes. `troubleshooting.md` maps every check and error code to its cause. `--json` gives the same results machine-readable.

## Red flags — stop

- "The test passes, so it works" → run `connector:verify`.
- "The sample is enough, no need to probe" → probe.
- "Just set ALLOW_SHRINK to get the demo working" → no; find the cause.
- "I'll paste the real response as the fixture" → invent the values.
