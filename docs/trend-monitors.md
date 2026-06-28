# Trend monitors — status & data sources

The Trends Radar is fed by two mechanisms:

1. **Connectors** (`apps/ingestion/src/connectors/sources/*`) — pull from external
   sources on a schedule (World Bank API, curated policy/research report catalogs,
   external-AI sources). These are **real** (see the no-mock policy).
2. **Monitors** (`apps/ingestion/src/trend-monitors/monitors.ts`) — periodically scan
   *internal* data for emergent patterns and emit `TrendSignal`s. There are six.

**No-mock stance:** a monitor with no real data source is **inert** — it returns
`signalsCreated: 0` and emits nothing. Inert ≠ mock: it does not fabricate signals.
A monitor is only made "real" when its underlying data source exists; until then it
stays a documented no-op.

## Monitor status

| Monitor | What it would surface | Real data source | Status |
|---|---|---|---|
| **research** | Faculties with a notable rise in high-quartile (Scopus Q1) output | `ResearchOutput` (kku-publications mirror) | ✅ **LIVE** |
| **policy** | New national policy direction affecting KKU programs | analysis of ingested POLICY PDFs | ⏸ **Deferred** |
| **job-market** | Labour-demand anomalies vs prior windows | per-posting job-vacancy data | ⛔ **Blocked** |
| **peer-programs** | New/changed competitor programs | peer-program catalogue scraper | ⛔ **Blocked** |
| **tech-signals** | Disruptive technology announcements | tech-news / vendor-announcement feed | ⛔ **Blocked** |
| **patents** | S-curve patent activity in target sectors | patent-office API | ⛔ **Blocked** |

## LIVE

### research  *(Phase 2, 2026-06-28)*
Aggregates Scopus-Q1 `ResearchOutput` counts per faculty for the latest **complete**
year vs the prior year, and emits a `RESEARCH` signal for each faculty whose Q1 output
rose by ≥ `RISE_RATIO` (1.2×) **and** ≥ `MIN_ABS_DELTA` (10 papers). Rises only — a
decline in the in-progress current year is an artifact. Deduped by a deterministic
title so weekly runs are idempotent. Granularity is **faculty-level** by design (per-paper
signals would flood the radar with 165k+ papers). Logic in `trend-monitors/research-trends.ts`
(pure, unit-tested) + `monitors.ts :: runResearchMonitor`.

## Deferred

### policy
The original design was "enqueue `ANALYZE_POLICY_DOC` for every POLICY `PdfDocument`
without a linked `TrendSignal`." Deferred because (a) the now-real **curated report
connectors** (`mhesi-policy`, `nesdc-reports`, `nxpo-reports`, `boi-sectoral`,
`eeco-reports`) already produce policy signals from the curated catalogs, and (b) there
is essentially no stream of ad-hoc POLICY PDFs in the system today (1 row). **To build:**
once a real pipeline of POLICY PDFs exists (e.g. an automated MHESI/NESDC PDF crawler
feeding PDF intake), wire the monitor to analyze the un-signalled ones. Until then it
would overlap the curated connectors and produce ~0 net signals.

## Blocked (need a real data source — do NOT fake)

### job-market
Would diff recent `JobPosting` rows against prior windows to flag labour-demand
anomalies → `MARKET` signals. **Blocked:** the per-posting feeds (`jobthai`, `jobsdb`)
are deprecated, and `kmitl-skill-mapping` provides only **aggregate percentages**, not
per-posting rows, so anomaly detection isn't possible. **To build:** a real per-posting
job-vacancy data source (a licensed feed or a permitted scraper).

### peer-programs
Would detect new or changed competitor programs from peer-institution catalogues →
signals. **Blocked:** `peer-programs-scraper` is mocked; there is no real peer-catalogue
feed. **To build:** a real peer-program scraper/import (the Benchmarking module's peer
data is currently seeded, not live).

### tech-signals
Would surface disruptive technology announcements relevant to KKU's S-curve sectors →
`TECH` signals. **Blocked:** no tech-news/vendor-announcement feed is wired. **To build:**
an external tech-news or vendor-announcement source (API or curated feed), then AI
classification into the relevant sectors.

### patents
Would track S-curve patent activity → signals. **Blocked:** needs a patent-office API
(access/procurement not in place). **To build:** secure patent-API access (e.g. a
national patent office or a commercial patent dataset), then a per-sector filter.

## Cadence
Schedules live in `MONITOR_CADENCE` (`monitors.ts`). The blocked/deferred monitors keep
their cron entries but are no-ops, so flipping one live is a body change, not new wiring.
