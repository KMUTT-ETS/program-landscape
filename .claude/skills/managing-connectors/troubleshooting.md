# Troubleshooting

Run `pnpm connector:verify <slug>` first; fix the first FAIL.

## By `connector:verify` check

| Check | FAIL means | Fix |
|---|---|---|
| `registered` | Slug not in `INSTITUTION_CONNECTORS` / catalogue, or not a dataset API connector | Use the exact `api-<name>` slug; `pnpm connector:new --list` |
| `env` | No base URL in `CONNECTOR_<SLUG>_BASE_URL` nor on the data source | Human sets the variable (WARN on missing token is fine for open APIs) |
| `sources` | A `DataSource` row is missing or marked mocked | `pnpm data-sources:sync --apply`; catalogue entry must say `mocked: false` |
| `latest-run` | Never ran, or last run FAILED/SKIPPED (code shown) | See error codes below; then `pnpm connector:run <slug>` |
| `provenance` | A dataset was refused/not loaded, or its rows lack the import run id | Fix the first problem shown (record, column) |
| `visible` | Rows exist but `realDataWhere()` hides them | Their data source is mocked: `pnpm data-sources:audit`, then sync |
| `reaches-programme` (WARN) | Rows link to no canonical programme / faculty | Code mapping in `toRows`; load programmes/faculties first |

SKIP "no visibility check for this dataset yet" is not an error — the dataset is not in `apps/ingestion/src/scripts/connector-verify/visibility.ts`.

## By run error code

| Code | Meaning | Fix |
|---|---|---|
| `CONFIG` | No base URL, or `toRows` produced a dataset not in `datasets` | Set env / declare the dataset |
| `NOT_IMPLEMENTED` | Scaffold untouched | Write `fetchAll` / `toRows` |
| `HTTP_401`, `HTTP_403` | Token missing, expired or lacking rights (not retried) | Human replaces the token, restarts the worker |
| `HTTP_404` | Wrong path or base URL | Probe with curl |
| `HTTP_3xx` | Redirect | Set the base URL to the final address |
| `SCHEMA` | Response not JSON or not matching your Zod schema (paths listed) | Probe; update the schema |
| `VALIDATION` | Rows broke dataset rules — message names dataset, record, column | Fix the mapping; the row limit (`MAX_ROWS`, ceiling 100 000) and the shrink guard also report here |
| `LOAD` | Database refused the write | Read the run Log; often a code that no longer exists |
| `MOCK_NOT_ALLOWED` | Not a dataset API connector or slug resolved to a mock | Check registry entry |
| `UNHEALTHY` | Health check failed; run skipped | Upstream down or base URL wrong |
| `ORPHANED` | Worker died mid-run | Re-run |

## Symptoms

- **Deep-Dive empty after a "successful" run** → `visible` or `reaches-programme`.
- **Admin "Run now" does nothing new** → worker not restarted after code/env change.
- **Shrink refusal** → see "Maintain" in `SKILL.md`; never set `ALLOW_SHRINK` yourself.
- **Run log**: `/admin/data-sources/<slug>` → run → Log (values masked; counts and positions only).
