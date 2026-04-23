# Prompt 03 — Data Ingestion Framework

> **When to use:** After design system. Builds the connector framework. Prompt 03b builds the PDF intake on top of this.
> **Skills to invoke:** none specific (architecture session)

---

Read `CLAUDE.md` and `GLOBAL-UPDATES.md`.

Build the data ingestion framework. The spine of the system. Every analytical module depends on data flowing in reliably.

Note: PDF intake is the **primary external data input** for this project (most Thai government and policy data arrives as PDFs). The PDF-specific pipeline gets its own dedicated prompt (03b) that sits on top of the framework you build here.

### Architecture
1. New service: `apps/ingestion` (NestJS standalone, runs as a worker)
2. BullMQ for orchestration with Redis
3. Each data source as a `Connector` class implementing:
   ```ts
   interface Connector {
     readonly source: DataSourceConfig;
     healthCheck(): Promise<HealthStatus>;
     fetch(since?: Date): Promise<RawRecord[]>;
     transform(raw: RawRecord): Promise<NormalizedRecord>;
     load(normalized: NormalizedRecord[]): Promise<LoadResult>;
   }
   ```
4. Cron-driven scheduler with per-connector cadence
5. Every run writes to `DataSource.lastSyncedAt` and `IngestionRun` table
6. Failures retry with exponential backoff; hard failures alert (console log for now)
7. Connector kinds: `API`, `WEB_SCRAPE`, `CSV_FILE`, `PDF_UPLOAD`, `MANUAL_ENTRY`. Each has a base class.

### Connectors to scaffold (mocked for now, real wiring later)

For each, document the real source in `docs/data-sources.md` (source URL, access method, credentials needed, expected cadence, data quality notes, **typical format — most are PDF for Thai sources**).

**Internal KKU systems:**
1. `KkuRegistryConnector` — programs, courses, enrollment from REG (API mock)
2. `KkuFinanceConnector` — revenue, costs (API mock)
3. `KkuHrConnector` — faculty roster (API mock)
4. `KkuAlumniConnector` — graduate outcomes (API mock — survey data may also arrive as PDF)
5. `KkuResearchConnector` — research outputs (API mock — wires to Scopus later)
6. `DigitalTranscriptConnector` — skill claims from Thailand Digital Transcript infrastructure (your existing system)

**National Thai (most are PDF-heavy):**
7. `MhesiCisaConnector` — accreditation data (your existing CISA system, API)
8. `NsoConnector` — labor force survey, demographics (mostly PDF reports — routes through PDF pipeline)
9. `TcasConnector` — TGAT/TPAT scores (PDF + some API)
10. `TpqiConnector` — occupational standards (PDF + API)
11. `JobThaiConnector` / `JobsDbConnector` — job postings (API/scrape, JSON)
12. `MhesiPolicyConnector` — MHESI policy announcements (mostly PDF)
13. `NesdcReportConnector` — economic plans (almost entirely PDF)
14. `NxpoReportConnector` — research/innovation policy (PDF)
15. `BoiSectoralConnector` — investment promotion data (PDF + Excel)
16. `EecoReportConnector` — Eastern Economic Corridor plans (PDF)

**Regional/international:**
17. `WefFutureOfJobsConnector` — annual report (PDF)
18. `OecdReportConnector` — sectoral reports (PDF)
19. `WorldBankConnector` — labor data (API + PDF)
20. `AdbGmsConnector` — Greater Mekong Subregion (PDF)
21. `ScopusConnector` — research output (API, requires key)
22. `OpenAlexConnector` — open scholarly metadata (API, free)
23. `PeerProgramScraperConnector` — peer university program pages (web + downloaded PDF brochures)

For each connector:
- Class file with mocked behavior (returns realistic sample data)
- Documented in `docs/data-sources.md`
- Marked clearly in code which are mocked vs real

### PDF-routing
Connectors flagged with `inputFormat: 'PDF'` route their fetched files into the PDF intake pipeline (built in prompt 03b) instead of doing direct extraction themselves. They register the PDF in `PdfDocument` with appropriate `sourceCategory` and metadata, then the PDF pipeline takes over extraction.

### Admin UI
Build `/admin/data-sources` (ADMIN role, also visible to ANALYST):
- Table: name, kind (API/PDF/etc), status, last sync, next sync, records last loaded
- Per-source: "Run now", view recent runs, view error log, edit cadence
- Bulk pause/resume
- "Connector health overview" widget at top

Use the components from prompt 02b (DataTable, KPI, etc). Polished SaaS feel.

### Provenance
- Every record loaded gets `sourceId`, `freshnessDate`, optional `sourcePdfId`
- Utility `getProvenance(entityType, entityId)` returns the chain — used by the provenance drawer everywhere

### Tests
- Unit test one connector end-to-end
- Test provenance lookup
- Test BullMQ scheduler triggers correctly (fake timers)
- Test PDF-routing: a `PDF`-flagged connector creates a `PdfDocument` row instead of trying direct extraction

### Deliverables
- Updated `docs/data-sources.md` with full source matrix (one row per source: name, kind, owner, access, format, cadence, status, notes)
- Folder tree of `apps/ingestion`
- Working admin UI on `/admin/data-sources`
- 3 suggestions for next session — my plan is PDF intake pipeline (prompt 03b)
