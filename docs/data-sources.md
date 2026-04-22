# Data sources

Every external data source gets an entry here once wired. For each, document:

- **Source** (MHESI, NESDC, NXPO, BOI, NSO, JobsDB, Scopus/OpenAlex, KKU REG, …)
- **Format** (API, PDF, CSV, web scrape)
- **Ingestion path** (connector in `apps/ingestion/` or PDF pipeline in
  prompt 03b)
- **Refresh cadence** and freshness expectation
- **Provenance metadata** surfaced on charts that use this source
- **Licence / access notes** and the KKU contact who owns the agreement

## Source inventory (placeholder — filled during prompts 03 → 14)

| Source | Type | Status |
|---|---|---|
| KKU REG (students, graduates) | API | not wired |
| KKU Finance (program cost) | API | not wired |
| KKU HR (faculty demographics) | API | not wired |
| MHESI-CISA | PDF + API | not wired |
| MHESI/NESDC/NXPO/BOI policies | PDF | not wired |
| NSO labor force survey | PDF + CSV | not wired |
| JobsDB / JobThai | API | not wired |
| Scopus or OpenAlex | API | decision pending |
