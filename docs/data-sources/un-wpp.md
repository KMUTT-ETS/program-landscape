# UN World Population Prospects 2024

**Slug:** `un-wpp` · **Phase:** C · **Kind:** API (bulk CSV) · **Cadence:** monthly once a schedule is enabled (off by default) · **Status:** ✅ real

---

## What it is

The United Nations Population Division's projection of population by single age, medium variant, for every country. The connector reduces it to three cohorts for one country: 15-17 (next-year applicants), 18-22 (undergraduate age) and 23-29 (postgraduate age). They drive the demographic-ceiling view of the Program Deep-Dive, the scenario planner's demographic multiplier and the AI analyst's quick scenarios.

It is **national only**. The regional demographic health driver needs a regional series; upload the Population Projections spreadsheet for that (see `docs/data-import.md`).

## Access

| | |
|---|---|
| URL / endpoint | `https://population.un.org/wpp/assets/Excel%20Files/1_Indicator%20(Standard)/CSV_FILES/WPP2024_Population1JanuaryBySingleAgeSex_Medium_2024-2100.csv.gz` (override with `UN_WPP_CSV_URL`) |
| Auth | none |
| Credentials env vars | none. `UN_WPP_CSV_URL` and `UN_WPP_COUNTRY_ISO3` (default `THA`) are optional |
| Rate limits | one download per run |
| Concurrency we'll use | 1 |
| Request timeout | 15 minutes for the whole download (about 68 MB gzipped) |
| Data residency | public data, no personal information |

The UN Data Portal API needs a bearer token and is deliberately not used.

## Data shape (real source)

A UTF-8 CSV with a byte-order mark, one row per country, variant, year and single age. Columns used: `ISO3_code`, `Variant`, `Time`, `AgeGrpStart`, `PopTotal` (in **thousands** of persons).

Gotchas:

- The first header cell carries the BOM; it is stripped before reading.
- Fields may be quoted and may contain commas (country names).
- The file is streamed through gunzip and read line by line; it is never held in memory.

## Mapping to our schema

| Source field | Our target | Table(s) | Notes |
|---|---|---|---|
| `ISO3_code = UN_WPP_COUNTRY_ISO3`, `Variant = Medium` | filter | | other countries and variants are ignored |
| `Time` | `year` | `demographic_projections` | current year to current year + 25 |
| `AgeGrpStart` 15-17 / 18-22 / 23-29 | `ageCohort` | `demographic_projections` | single ages summed |
| `PopTotal` × 1000, rounded | `population` | `demographic_projections` | persons |
| | `region` = `TH`, `source` = `UN-WPP2024` | `demographic_projections` | national series |

Changing `UN_WPP_COUNTRY_ISO3` replaces the previous country's `UN-WPP2024` rows on the next run: each run swaps out everything this source wrote before loading the new country.
| run id | `ingestionRunId` | `demographic_projections` | stamped on every row |

## Snapshot semantics

Each run replaces its own previous rows (source `UN-WPP2024`, stamped with a run of this data source) in one transaction, and nothing else. Rows from the NESDC starter series or from a spreadsheet upload are never touched. A file with no rows for the chosen country fails the run before anything is deleted.

## Which source readers use

`pickProjectionSource` (`packages/db/src/projection-source.ts`) chooses per reader: a spreadsheet source (`xlsx:<name>`) first, then `UN-WPP2024`, then `NESDC-PopProj-2010-2040`, then anything else. A source qualifies only with a national `TH` row for the cohort in the current year; a reader that needs a region also requires that region. The Deep-Dive therefore shows national figures from the UN series and a regional comparator from a different edition when only that one carries the region.

## Backfill plan

- **Horizon**: the current year to +25; each run is a full snapshot.
- **Sanity check**: the 18-22 national figure for the current year should be close to the country's published 18-22 population.

## Monitoring after go-live

- Schema drift (a required column missing) fails the run with `SCHEMA_DRIFT` and does not retry.
- Freshness: the UN revises WPP roughly every two years; a monthly schedule is generous.

## Contact

| Role | Person | Contact |
|---|---|---|
| Owner | Institution administrator | set at `/admin/organization` |
