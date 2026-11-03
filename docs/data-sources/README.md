# Data Sources

Per-source integration specs for Program Landscape. Every mock connector gets a real implementation during a **dedicated mini-session** (prompt 14). This directory is the working space — each source has its own `.md` with the integration spec, status, and operator notes.

Architectural overview of the ingestion pipeline lives at [`../data-sources.md`](../data-sources.md). This directory drills into each source individually.

---

## Status dashboard

Keep this table in sync as integrations land. The "Mode" column is read from `data_sources` (`status` + `mocked`) and was last reconciled against the database on **2026-09-22**, when 19 rows were found stale — several connectors driving Council-facing numbers still read `mocked` here long after they were flipped. **Reconcile this column against the database, not against memory**; the two flags must move together (see the `data_sources` drift audit).

All 40 catalog sources are now listed. Rows marked *(no spec yet)* have a connector and a `data_sources` row but no per-source spec document.

| Phase | Slug | Owner / source | Mode today | Spec | Real implementation |
|---|---|---|---|---|---|
| **A** Internal | `kku-registry` | KKU Registration Division | **`real`** | [kku-registry.md](./kku-registry.md) | — |
| **A** Internal | `kku-finance` | KKU Finance Division | **`real`** | [kku-finance.md](./kku-finance.md) | Blocked on cost methodology v1.0 |
| **A** Internal | `kku-hr` | KKU Human Resources | **`real`** | [kku-hr.md](./kku-hr.md) | PDPA sign-off required |
| **A** Internal | `kku-alumni` | KKU Alumni Affairs | **`real`** | [kku-alumni.md](./kku-alumni.md) | — |
| **A** Internal | `kku-research` | KKU Research Affairs | **`real`** | [kku-research.md](./kku-research.md) | — |
| **A** Internal | `kku-evaluations` | KKU Student Evaluations (Teaching & Learning) | **`real`** | [kku-evaluations.md](./kku-evaluations.md) | Phase 0 complete 2026-05-19 |
| **A** Internal | `kku-research-services` | KKU Research & Academic Services (external grants) | **`real`** | [kku-research-services.md](./kku-research-services.md) | MySQL views, daily 04:00 |
| **A** Internal | `xlsx-faculties` | Spreadsheet import — faculties | **`real`** | [../data-import.md](../data-import.md) | Adopter upload path |
| **A** Internal | `xlsx-departments` | Spreadsheet import — departments | **`real`** | [../data-import.md](../data-import.md) | Adopter upload path |
| **A** Internal | `xlsx-programmes` | Spreadsheet import — programmes | **`real`** | [../data-import.md](../data-import.md) | Adopter upload path |
| **A** Internal | `digital-transcript` | Thailand Digital Transcript | `mocked` | [digital-transcript.md](./digital-transcript.md) | — |
| **A** Internal | `mhesi-cisa` | MHESI CISA portal | `mocked` | [mhesi-cisa.md](./mhesi-cisa.md) | — |
| **B** National | `nso-labor-force` | NSO Thailand | `mocked` | [nso-labor-force.md](./nso-labor-force.md) | PDF pipeline |
| **B** National | `tpqi` | TPQI | `mocked` | [tpqi.md](./tpqi.md) | Mixed PDF + API |
| **B** National | `tcas` | ทปอ. / MUA | **`real`** | [tcas.md](./tcas.md) | PDF + XLSX |
| **B** National | `jobthai` | JobThai | **`real`** | [jobthai.md](./jobthai.md) | Paid access agreement |
| **B** National | `jobsdb` | JobsDB / SEEK | `mocked` | [jobsdb.md](./jobsdb.md) | Paid access agreement |
| **B** National | `mhesi-policy` | MHESI publications | **`real`** | [mhesi-policy.md](./mhesi-policy.md) | RSS / scrape |
| **B** National | `nesdc-reports` | NESDC | **`real`** | [nesdc-reports.md](./nesdc-reports.md) | PDF bulk-load |
| **B** National | `nxpo-reports` | NXPO | **`real`** | [nxpo-reports.md](./nxpo-reports.md) | PDF bulk-load |
| **B** National | `boi-sectoral` | BOI | **`real`** | [boi-sectoral.md](./boi-sectoral.md) | PDF bulk-load |
| **B** National | `eeco-reports` | EECO | **`real`** | [eeco-reports.md](./eeco-reports.md) | PDF bulk-load |
| **C** Intl | `openalex` | OpenAlex | `deprecated` | [openalex.md](./openalex.md) | Free; priority target |
| **C** Intl | `wef-future-of-jobs` | World Economic Forum | **`real`** | [wef-future-of-jobs.md](./wef-future-of-jobs.md) | Annual PDF |
| **C** Intl | `oecd-reports` | OECD | **`real`** | [oecd-reports.md](./oecd-reports.md) | Mixed API + PDF |
| **C** Intl | `world-bank` | World Bank | **`real`** | [world-bank.md](./world-bank.md) | Open data API |
| **C** Intl | `adb-gms` | ADB Greater Mekong Subregion | **`real`** | [adb-gms.md](./adb-gms.md) | PDF reports |
| **C** Intl | `scopus` | Elsevier Scopus | `deprecated` | [scopus.md](./scopus.md) | Paid (KKU Library) |
| **C** Intl | `peer-programs-scraper` | ASEAN + global peers | `mocked` | [peer-programs-scraper.md](./peer-programs-scraper.md) | Hand-curate first 20 |
| **A** Internal | `unicon-ds1001` | UNICON DS1001 — Student information | **`real`** | — *(no spec yet)* | UNICON feed |
| **A** Internal | `unicon-ds2001` | UNICON DS2001 — Staff master record | **`real`** | — *(no spec yet)* | UNICON feed |
| **A** Internal | `unicon-ds2003` | UNICON DS2003 — Employee education qualifications | **`real`** | — *(no spec yet)* | UNICON feed |
| **A** Internal | `unicon-ds2004` | UNICON DS2004 — Academic staff per program | **`real`** | — *(no spec yet)* | UNICON feed |
| **A** Internal | `kku-admission-campaigns` | KKU Actual Recruitment Campaigns | **`real`** | — *(no spec yet)* | — |
| **A** Internal | `kku-dq` | KKU Digital Intelligence (DQ) Student Scores | **`real`** | — *(no spec yet)* | — |
| **A** Internal | `kku-hr-processed` | KKU HR Processed — salary aggregate | **`real`** | — *(no spec yet)* | — |
| **A** Internal | `kku-tcas-funnel` | KKU TCAS Admission Funnel | `deprecated` | — *(no spec yet)* | Superseded by `tcas` |
| **B** National | `job-108` | Job-108 — Thai government job announcements | **`real`** | [job-108.md](./job-108.md) | Public web, honest UA, no proxy |
| **B** National | `kmitl-skill-mapping` | LinkedIn Labour-Market Insights (MHESI subscription, KMITL-hosted) | **`real`** | [kmitl-skill-mapping.md](./kmitl-skill-mapping.md) | Institutional-partner API |
| **B** National | `thailand-demographics` | Thailand Demographics (DOPA · NESDC · BOI repost) | `deprecated` | [un-wpp.md](./un-wpp.md) | Never had a connector; use `un-wpp` or the Population Projections spreadsheet |
| **C** International | `un-wpp` | UN World Population Prospects 2024 | **`real`** | [un-wpp.md](./un-wpp.md) | Public bulk CSV, national cohorts |
| **C** International | `the-rankings` | Times Higher Education (THE) Subject Rankings | `mocked` | — *(no spec yet)* | Subscription |
| **C** International | `qs-rankings` | QS Subject Rankings | `mocked` | — *(no spec yet)* | Subscription |
| **C** International | `scimago` | SCImago Journal & Institution Rankings | `mocked` | — *(no spec yet)* | Public |
| **C** International | `imd-rankings` | IMD World Competitiveness Rankings | **`real`** | — *(no spec yet)* | Subscription |

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
