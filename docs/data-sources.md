# Data sources

Every external data source this app consumes is listed below. The canonical
machine-readable version lives in
[`packages/shared/src/ingestion/catalog.ts`](../packages/shared/src/ingestion/catalog.ts)
— `pnpm data-sources:sync --apply` creates a `DataSource` row per entry
(`pnpm setup` runs it, and so does every deploy), so this document and the DB
never drift. **A fresh installation schedules nothing.** Rows are created with
scheduling off, and the sync never changes it on an existing row. To turn a
source on, open `/admin/data-sources`, set its mode and enable its schedule.
Mock connectors are refused (the run is recorded as `SKIPPED`,
`MOCK_NOT_ALLOWED`) unless `ALLOW_MOCK_CONNECTOR_RUNS=true`, which only KKU
developers set locally. Sources marked `kkuExample` describe KKU's own systems
and are of no use to other universities.

## Ingestion architecture

The ingestion framework (prompt 03) provides the plumbing. Connectors
implement `Connector` from `@kku/shared`:

```
healthCheck → fetch(since?) → transform(raw) → load(normalized[])
```

Each run writes an `IngestionRun` row with counts, duration, error code,
and (for PDF connectors) the `PdfDocument.id` it created. The admin
page at `/admin/data-sources` reads both tables and offers Run-now +
Pause/Resume + cadence editing.

### Routing rules

- `kind = 'API'` / inputFormat = JSON/XML → fetch parsed object, load to
  domain table directly (`programs`, `financial_metrics`, etc.).
- `kind = 'PDF'` or `inputFormat = 'PDF'` → fetch bytes, create a
  `PdfDocument(processingStatus = PENDING)` row. The **prompt 03b** PDF
  intake pipeline picks up PENDING rows and does OCR + extraction +
  routing to domain tables.
- `kind = 'SCRAPE'` → fetch + parse HTML, load normalized records; if a
  scraped page links a PDF brochure, enqueue a separate PDF job.
- `kind = 'CSV'` — manual file uploads (admin action).

### Schedule

Cadence is a standard 5-field cron string on `DataSource.cadenceCron`.
The BullMQ scheduler in `apps/ingestion` reads DataSource rows at boot
and registers one repeatable job per source where
`scheduleEnabled = true`. Changing cadence via the admin UI writes the
new value to `DataSource.cadenceCron` — the worker picks it up on its
next bounce (hot reconfiguration is deferred).

## Source matrix

Every connector below is currently **mocked** — `mocked: true` in the
catalog, `status = 'mocked'` in the DB. Real wiring lands in prompt 14.
Mocks return realistic sample data shaped like the real upstream so
modules can be built against them.

### Internal KKU systems

| Slug | Name | Kind | Format | Owner | Notes |
|---|---|---|---|---|---|
| `kku-registry` | KKU Registry (REG) | API | JSON | KKU Registrar | Programs, courses, enrollment, degree completion. Master source for student-body demographics. |
| `kku-finance` | KKU Finance | API | JSON | KKU Finance Office | Revenue, direct + shared cost allocation. Most sensitive resource — RBAC restricts to COUNCIL+. |
| `kku-hr` | KKU HR (Faculty roster) | API | JSON | KKU HR Office | Faculty members with rank + department + retirement projections. |
| `kku-alumni` | KKU Alumni Outcomes | API | MIXED | KKU Alumni & Career Services | Graduate employment survey + Student Loan Fund repayments. Some cohort summaries arrive as PDF. |
| `kku-research` | KKU Research Outputs | API | JSON | KKU Research & Graduate School | Publications / patents / grants. Real impl crosswalks to Scopus + OpenAlex. |
| `digital-transcript` | Thailand Digital Transcript | API | JSON | KKU Digital Transcript Team | Skill claims per student. Live in production — wiring here mirrors the existing claims feed. |

### National Thai (API)

| Slug | Name | Kind | Format | Owner | Notes |
|---|---|---|---|---|---|
| `mhesi-cisa` | MHESI CISA (Accreditation) | API | JSON | KKU Academic Standards & Quality | Curriculum accreditation. CISA already exposes an API — real wiring is cheap. |
| `jobthai` | JobThai (Job postings) | API | JSON | KKU Data Office | Skill demand + salary signals. Commercial feed, agreement TBD. |
| `jobsdb` | JobsDB (Job postings) | API | JSON | KKU Data Office | Regional coverage. Commercial API — budget pending. |

### National Thai (PDF — routed via prompt 03b intake)

| Slug | Name | Kind | Format | Owner | Notes |
|---|---|---|---|---|---|
| `nso-labor-force` | NSO Labor Force Survey | PDF | PDF | KKU Data Office | Quarterly survey + annual employment stats. Heavily-tabled PDFs. |
| `tcas` | TCAS / TGAT-TPAT | PDF | MIXED | KKU Admissions Office | Annual national admission scores + programme-level cutoffs. |
| `tpqi` | TPQI Occupational Standards | PDF | MIXED | KKU TVET liaison | Thailand Professional Qualification Institute — portal API + PDF downloads. |
| `mhesi-policy` | MHESI Policy Announcements | PDF | PDF | KKU Strategic Planning | Daily noisy ministry announcements; intake pipeline filters. |
| `nesdc-reports` | NESDC Economic Plans | PDF | PDF | KKU Strategic Planning | 5-year plans + quarterly outlooks. Long PDFs (200+ pages). |
| `nxpo-reports` | NXPO R&D Policy | PDF | PDF | KKU Research & Innovation | R&D policy direction. |
| `boi-sectoral` | BOI Sectoral Data | PDF | MIXED | KKU Industry Liaison | Sector investment statistics. PDF + occasional Excel. S-curve input. |
| `eeco-reports` | EECO (Eastern Economic Corridor) | PDF | PDF | KKU Industry Liaison | Industrial development plans. Peripheral to Khon Kaen but workforce signals carry. |

### International (API + PDF)

| Slug | Name | Kind | Format | Owner | Notes |
|---|---|---|---|---|---|
| `wef-future-of-jobs` | WEF Future of Jobs Report | PDF | PDF | KKU Data Office | Annual foundational input for future-skill taxonomies. |
| `oecd-reports` | OECD Sectoral Reports | PDF | PDF | KKU Data Office | Thailand-specific reports preferred. |
| `world-bank` | World Bank Data | API | MIXED | KKU Data Office | Labor indicators + demographic projections. Free API + long-form PDFs. |
| `adb-gms` | ADB Greater Mekong Subregion | PDF | PDF | KKU Data Office | Laos/Myanmar/Cambodia peer context for some KKU programs. |
| `scopus` | Scopus | API | JSON | KKU Library (existing subscription) | Live (profile-page only). Requires `KKU_SCOPUS_API_KEY`. Reads via the Search API (`AU-ID(...)`, `query=TITLE("...")`, abstract retrieval by DOI). Bulk research metrics still come from kkuscholar to stay under the 20k req/week limit. |
| `openalex` | OpenAlex | API | JSON | KKU Data Office | Live (profile-page co-author fallback). `OPENALEX_MAILTO` enables the polite pool (10 req/s vs 1). |

### Scrape

| Slug | Name | Kind | Format | Owner | Notes |
|---|---|---|---|---|---|
| `peer-programs-scraper` | Peer University Program Pages | SCRAPE | MIXED | KKU Data Office | Scrapes public catalogues + downloads brochure PDFs. Respect robots.txt + ToS. |

## Adding a new source

1. Add an entry to `packages/shared/src/ingestion/catalog.ts` with a
   unique lowercase-kebab `slug`, `name`, `kind`, `inputFormat`, and
   `cadenceCron`.
2. Add a connector class under `apps/ingestion/src/connectors/sources/`
   extending the right base (`ApiConnector`, `PdfUploadConnector`, …).
3. Register it in `apps/ingestion/src/connectors/registry.ts`.
4. Run `pnpm data-sources:sync --apply` — the new DataSource row appears,
   with scheduling off. Switch it on at `/admin/data-sources`.
5. The admin UI at `/admin/data-sources` shows it immediately; admins
   can Run-now without restarting. Scheduled cadence takes effect
   after the ingestion worker's next bounce.

## When to flip a connector from mocked to real

When you wire a connector to its real upstream:

1. Replace the mock `fetch` / `transform` / `load` bodies.
2. Flip `mocked: true` → `mocked: false` in the catalog entry.
3. Change the seeded status from `'mocked'` to `'active'` (or `'paused'`
   if real data is available but the upstream hasn't been validated
   with KKU yet).
4. Add credentials to `.env.example` if needed (e.g. `ELSEVIER_API_KEY`).
5. Update this doc's row from "mocked" to include a line about the
   upstream agreement date and whoever signed it.

## Per-source rate limits + quotas

Deferred to prompt 14. Today the BullMQ worker has a global
concurrency of 4; when real connectors land, per-queue rate limits
become mandatory (JobsDB's commercial API ~= 5 req/s, Scopus has a
weekly quota, etc.).
