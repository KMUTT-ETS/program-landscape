# Data Sources

Per-source integration specs for Program Landscape. Every mock connector gets a real implementation during a **dedicated mini-session** (prompt 14). This directory is the working space — each source has its own `.md` with the integration spec, status, and operator notes.

Architectural overview of the ingestion pipeline lives at [`../data-sources.md`](../data-sources.md). This directory drills into each source individually.

---

## Status dashboard

Keep this table in sync as integrations land. The "Mode" column is the env-flag state (`CONNECTOR_<SLUG>_MODE`, or the global `CONNECTOR_MODE`).

| Phase | Slug | Owner / source | Mode today | Spec | Real implementation |
|---|---|---|---|---|---|
| **A** Internal | `kku-registry` | KKU Registration Division | `mocked` | [kku-registry.md](./kku-registry.md) | — |
| **A** Internal | `kku-finance` | KKU Finance Division | `mocked` | [kku-finance.md](./kku-finance.md) | Blocked on cost methodology v1.0 |
| **A** Internal | `kku-hr` | KKU Human Resources | `mocked` | [kku-hr.md](./kku-hr.md) | PDPA sign-off required |
| **A** Internal | `kku-alumni` | KKU Alumni Affairs | `mocked` | [kku-alumni.md](./kku-alumni.md) | — |
| **A** Internal | `kku-research` | KKU Research Affairs | `mocked` | [kku-research.md](./kku-research.md) | — |
| **A** Internal | `digital-transcript` | Thailand Digital Transcript | `mocked` | [digital-transcript.md](./digital-transcript.md) | — |
| **A** Internal | `mhesi-cisa` | MHESI CISA portal | `mocked` | [mhesi-cisa.md](./mhesi-cisa.md) | — |
| **B** National | `nso-labor-force` | NSO Thailand | `mocked` | [nso-labor-force.md](./nso-labor-force.md) | PDF pipeline |
| **B** National | `tpqi` | TPQI | `mocked` | [tpqi.md](./tpqi.md) | Mixed PDF + API |
| **B** National | `tcas` | ทปอ. / MUA | `mocked` | [tcas.md](./tcas.md) | PDF + XLSX |
| **B** National | `jobthai` | JobThai | `mocked` | [jobthai.md](./jobthai.md) | Paid access agreement |
| **B** National | `jobsdb` | JobsDB / SEEK | `mocked` | [jobsdb.md](./jobsdb.md) | Paid access agreement |
| **B** National | `mhesi-policy` | MHESI publications | `mocked` | [mhesi-policy.md](./mhesi-policy.md) | RSS / scrape |
| **B** National | `nesdc-reports` | NESDC | `mocked` | [nesdc-reports.md](./nesdc-reports.md) | PDF bulk-load |
| **B** National | `nxpo-reports` | NXPO | `mocked` | [nxpo-reports.md](./nxpo-reports.md) | PDF bulk-load |
| **B** National | `boi-sectoral` | BOI | `mocked` | [boi-sectoral.md](./boi-sectoral.md) | PDF bulk-load |
| **B** National | `eeco-reports` | EECO | `mocked` | [eeco-reports.md](./eeco-reports.md) | PDF bulk-load |
| **C** Intl | `openalex` | OpenAlex | `mocked` | [openalex.md](./openalex.md) | Free; priority target |
| **C** Intl | `wef-future-of-jobs` | World Economic Forum | `mocked` | [wef-future-of-jobs.md](./wef-future-of-jobs.md) | Annual PDF |
| **C** Intl | `oecd-reports` | OECD | `mocked` | [oecd-reports.md](./oecd-reports.md) | Mixed API + PDF |
| **C** Intl | `world-bank` | World Bank | `mocked` | [world-bank.md](./world-bank.md) | Open data API |
| **C** Intl | `adb-gms` | ADB Greater Mekong Subregion | `mocked` | [adb-gms.md](./adb-gms.md) | PDF reports |
| **C** Intl | `scopus` | Elsevier Scopus | `mocked` | [scopus.md](./scopus.md) | Paid (KKU Library) |
| **C** Intl | `peer-programs-scraper` | ASEAN + global peers | `mocked` | [peer-programs-scraper.md](./peer-programs-scraper.md) | Hand-curate first 20 |

Phase ordering tracks the prompt-14 priority list: A (highest-leverage internal) → B (national Thai) → C (regional + international).

---

## Adding a new source

1. Add the catalog entry in [`@kku/shared/ingestion/catalog.ts`](../../packages/shared/src/ingestion/catalog.ts).
2. Copy [`_template.md`](./_template.md) → `docs/data-sources/<slug>.md` and fill in.
3. Drop a mock connector class in the appropriate file under `apps/ingestion/src/connectors/sources/`.
4. Register the slug in [`apps/ingestion/src/connectors/registry.ts`](../../apps/ingestion/src/connectors/registry.ts).
5. Seed / migrate a `DataSource` row.
6. Update the status table above.

## Flipping a connector from mocked to real

Each integration session follows the workflow in [`../../prompts/14-integration-session-template.md`](../../prompts/14-integration-session-template.md). In short:

1. Read the spec doc for this source + sanity-check the mapping table.
2. Rename the existing class → `Mocked<Name>Connector`. Keep it alongside the real one.
3. Add the real `<Name>Connector` class with the same interface.
4. Register both slots in `registry.ts` (see the ENTRIES table).
5. Flip `CONNECTOR_<SLUG>_MODE=real` in `.env.prod`.
6. Run a small-slice test (1 day / 1 program / 1 region).
7. Backfill historical data.
8. Update the status dashboard above + the "Current status" in `CLAUDE.md`.
9. Commit with a conventional message.
