# Connector skill for adopters — design

Date: 2026-11-12 · Branch context: `feat/api-dataset-connectors` (not merged)

## Intent

An IT person at an adopting university (e.g. KMUTT, a workshop participant) has cloned Program Landscape and wants their institution's own data in it. They will ask an AI coding agent (Claude Code or similar) to build and look after the connector. Today neither of them knows where to start, what to check or how to prove it worked: the knowledge is spread over the code, `docs/guides/write-a-connector.md`, the decisions log and the "Standing traps" in `CLAUDE.md`, and some older guidance no longer matches the code.

The skill is the map: which steps, in what order, which checks prove each step, and how to keep the connector healthy afterwards. Success is an adopter's agent going from "here are our API docs and a sample response" to rows visible in the Program Deep-Dive, without help from the KKU team, and the IT person being able to tell from one command's output that it really worked.

Timing: the adopter workshop (~2026-11-21) is the first real audience.

## Goals

1. Guide an agent through the full life of a **dataset API connector** (`DatasetApiConnector`, `api-<name>` slugs): plan → create → verify → maintain.
2. Start from what the IT person actually has: **API docs and/or a sample JSON response**.
3. Make "done" checkable by one deterministic command, `pnpm connector:verify <slug>`, so neither the agent nor the human can misread success.
4. Bring the "Adding a new source" steps in `docs/data-sources/README.md` up to date and point them at the skill.

## Non-goals

- KKU internal database connectors (mock/real pairs), public-API connectors, scrapers, PDF report sources. Out of scope; KKU developers keep using existing guidance.
- **Database-only access.** If the institution has only database access (no HTTP API), the skill tells them to export to XLSX and use the existing upload (`docs/data-import.md`), then stops. It does not help build an API and does not offer direct DB connectors.
- No `connector:probe` command. Pre-code probing is a `curl` call the skill shows.
- `prompts/*` is left as is (including the out-of-date `prompts/14-integration-session-template.md`).
- No change to the import pipeline, dataset declarations or `DatasetApiConnector` itself (beyond what `verify` needs to read).

## Anti-goals (failure even if it technically works)

- The agent reports "done" while the Deep-Dive is empty (silent-empty UI: `mocked=true`, missing `ingestion_run_id`, missing `xlsx-<slug>` source).
- Real personal data ends up in a committed fixture, a log, run metadata, chat output or a commit message (PDPA; org PII policy).
- The agent sets `CONNECTOR_<SLUG>_ALLOW_SHRINK` on its own to get past the shrink guard, or prints `.env` values.
- The agent runs destructive DB commands (the dev guard denies them; they go to the operator).
- The skill restates code facts that drift; it should point at code (scaffolder, base class, dataset declarations) as the source of truth.

## Constraints

- Code is the source of truth. Key files: `apps/ingestion/src/connectors/base/dataset-api-connector.ts`, `apps/ingestion/src/scripts/connector-new/{generate,templates}.ts`, `apps/ingestion/src/connectors/sources/institution/index.ts`, `packages/shared/src/ingestion/institution-catalog.ts`, `packages/db/src/import/datasets/*.ts`, `packages/db/src/data-quality.ts` (`realDataWhere`), `apps/ingestion/src/connectors/run-log.ts`.
- Rows from a dataset API connector load under the dataset's `xlsx-<slug>` DataSource (not a per-connector one), with run metadata `via: 'api'`. `verify` must check visibility accordingly.
- Env vars per connector: `CONNECTOR_<SLUG>_{BASE_URL,TOKEN,MAX_ROWS,ALLOW_SHRINK}`. 401/403 are not retried by design.
- Cross-platform (Windows/WSL2 primary): `verify` is a Node/tsx `pnpm` script, `path.join`, no POSIX-only shell. Zod-validate any `$queryRaw` results. No `any`.
- `verify` is read-only: no writes to the DB, no running the connector. (It may tell the user which command to run next.)
- Docs-impact rule from `CLAUDE.md` applies; `pnpm docs:build` must pass.

## Decided by the user

- Primary audience: **adopting universities' IT people** using an AI agent, working through **dataset API connectors**.
- Inputs the skill must handle: API docs, a sample JSON response (direct DB access → XLSX fallback, see Non-goals).
- Shape: **instructions + one new command `connector:verify`**; no probe command.
- Leave `prompts/*` alone; update "Adding a new source" in `docs/data-sources/README.md`.

## Design

### 1. Skill files — `.claude/skills/managing-connectors/`

*(Name and exact file split are the builder's call; below is the intended content.)*

- **`SKILL.md`** — frontmatter `name` + a `description` that triggers on adding, fixing, extending or retiring a connector / loading institution data from an API. Body:
  - **Triage first.** What do you have? API docs / sample JSON → continue. DB access only → XLSX fallback, stop. Is this a new connector or an existing one (`pnpm connector:new --list`, the institution catalog)? Route to the matching flow.
  - **Flow: create.**
    1. Plan — pick dataset(s) from `connector:new --list`; read each dataset's declaration for required columns, codes and year basis; write the field-mapping table (source field → dataset column, transform, notes such as BE vs CE, Thai/English names).
    2. Probe — one `curl` against the live API using the token from env (never echo it); compare to the docs/sample. Live API vs written spec drift is expected.
    3. Scaffold — `pnpm connector:new --name … --dataset …` (dry-run first).
    4. Implement `fetchAll` (paging, auth) and `toRows` (mapping; aggregate/drop personal fields at source). Logging via `ctx.log`, never `console`, never whole rows.
    5. Fixture + test — fixture derived from the sample with personal data replaced by invented values; test asserts on the outgoing request (URL, headers, paging), not just on a mocked `fetch` return.
    6. Configure env (`.env` in dev; compose secrets with absolute paths in prod — point at the adopter deploy docs).
    7. `pnpm data-sources:sync --apply`, `pnpm connector:run <slug>`, then `pnpm connector:verify <slug>` until all checks pass.
    8. Record — per-connector note (what it maps, from which endpoints, known quirks) in `docs/data-sources/<slug>.md` from `_template.md`; docs-impact check.
  - **Flow: maintain** — one short section per situation:
    - API changed (run fails / counts drop / column errors) → fresh `curl`, diff with fixture, update `toRows` + fixture, re-run, re-verify.
    - Token expired/rotated (401/403) → tell the human which env var to change and to restart the worker; never print `.env`.
    - Shrink guard tripped → investigate whether the shrink is real; `ALLOW_SHRINK` only with the human's explicit say-so, then unset it.
    - Add a dataset to an existing connector, or split one off.
    - Retire → `scheduleEnabled: false`, `deprecated: true` in the catalog; never delete the DataSource row or past runs.
  - **Hard rules** (short list): code over docs; no real PII in fixtures/logs/metadata/chat; no `.env` printing; destructive DB commands go to the operator; never call it done before `verify` passes. These rules are stable, so the skill states them itself rather than relying on `CLAUDE.md` being read. Adopters clone the whole repo, so `CLAUDE.md` and `.claude/settings.json` are normally present too. For volatile facts (paths, flags, limits) the skill points at code.
- **Reference pages** (loaded on demand), e.g.:
  - `field-mapping.md` — how to read a dataset declaration, the mapping-table format, common traps (Buddhist Era years, academic vs fiscal year, programme/faculty code matching, `nameTh`/`nameEn`).
  - `troubleshooting.md` — symptom → cause → fix, keyed to `verify` check names (empty Deep-Dive, SKIPPED runs, `MOCK_NOT_ALLOWED`, `UNHEALTHY`, `EMPTY_DATA`, 401/403, shrink guard, row-cap).
  - `pii.md` — what counts as personal data (per org policy), how to anonymise a sample into a fixture, aggregate-at-source in `toRows`.

### 2. `pnpm connector:verify <slug>` (new code)

Read-only diagnostic for a dataset API connector. Prints one line per check — `PASS` / `FAIL` / `WARN` / `SKIP` with a one-line reason and the next action — and exits non-zero if any check fails. A `--json` flag for machine-readable output (so the agent can parse it) is the builder's call.

Checks, in order (later checks `SKIP` when an earlier one they depend on fails):

1. **Registered** — slug present in the institution registry and institution catalog.
2. **Env present** — required `CONNECTOR_<SLUG>_*` names set (report names only, never values).
3. **Catalog ↔ DB agree** — `DataSource` row(s) exist for each target `xlsx-<dataset>` source and are `mocked=false`; otherwise point to `pnpm data-sources:sync --apply`.
4. **Latest run** — most recent `IngestionRun` for the slug: status, error code/message, `recordsFetched/Loaded/Failed`, per-dataset counts and `totalErrors` from metadata. No run yet → `FAIL` with "run `pnpm connector:run <slug>`"; checks 5–7 then `SKIP`, and the exit code is non-zero. That is the intended pre-run state, so no separate pre-run mode is needed.
5. **Rows carry provenance** — rows are stamped with the **per-dataset import run**, not the connector run. `DatasetApiConnector` passes the connector run as `parentRunId` to `runImportLoad` and records each child id as `metadata.datasets[<slug>].importRunId` (`dataset-api-connector.ts` ~L208–214). `verify` follows connector run → `importRunId` per dataset → rows.
6. **Visible to the app** — rows from each import run are returned through `realDataWhere()` (the filter the Deep-Dive uses). Rows are looked up through a small per-dataset check table (dataset slug → Prisma model + where-clause) kept **inside the verify script**; no changes to `packages/db` dataset declarations. A dataset not in that table → `SKIP` with reason "no visibility check for this dataset yet". Start with the datasets the Deep-Dive reads and that `workshop:mock-api` serves; the builder picks the exact list.
7. **Reaches a programme (WARN-level)** — only for datasets keyed by programme or faculty: at least one canonical programme/faculty is linked to the loaded rows. This catches code-mismatch mapping errors that load fine but join to nothing. Datasets without such a key (e.g. `population-projections`, `ranked-universities`, `career-skill-demand`) → `SKIP`.

Exact queries are left to the builder.

### 3. Docs

- `docs/data-sources/README.md` — rewrite "Adding a new source" for the current flow: for an institution API, use the skill / `connector:new` → … → `connector:verify`; for other kinds, the current catalog → registry → `data-sources:sync` steps (fix the stale "drop a mock connector class" step). Leave "Flipping a connector from mocked to real" alone except where it is factually wrong *(builder's call how far to go; keep it minimal)*.
- `docs/guides/write-a-connector.md` and its Thai twin `docs/th/guides/write-a-connector.md` — add a short pointer to the skill and to `connector:verify` in the dataset-API section. Mirror the headings in both. This guide is also the entry point for non-Claude agents, since there is no `AGENTS.md`.
- `connector:verify` documented wherever `connector:run` is documented for adopters (e.g. `docs/tutorials/load-data-from-an-api.md`).
- `pnpm docs:build` must pass.

## Left to the builder

- Skill folder name, file split, wording, and `description` tuning (follow `superpowers:writing-skills`, including testing the skill with a fresh agent on a realistic task — e.g. the `workshop:mock-api` server as the "institution API").
- `connector:verify` internals, output format, `--json`.
- Whether `verify` lives under `apps/ingestion/src/scripts/` next to `connector:new` (expected).

## Calls I made (not discussed with the user)

- Skill location `.claude/skills/`, plain markdown so non-Claude agents can read it; written in English.
- No help building a minimal API for DB-only adopters — XLSX fallback only (user's direction, applied strictly).
- `verify` is strictly read-only and does not trigger runs.
- Test the skill against `pnpm workshop:mock-api` as a stand-in institution API. **It passes when** a fresh agent, given only "here is our API at <url>, token in env, load programmes and enrollment", reaches all-PASS (or justified SKIP) from `connector:verify` without human help. It must also handle at least the 401 maintain flow, set up by giving it a wrong token. Other maintain flows are reviewed on paper.
- The run-id chain (connector run → `importRunId` → rows), the per-dataset check table inside `verify`, `SKIP` for unsupported datasets, and `SKIP` for check 7 on datasets without a programme or faculty key. These came from the builder check.
- The skill restates the stable hard rules itself; volatile facts stay in code.
