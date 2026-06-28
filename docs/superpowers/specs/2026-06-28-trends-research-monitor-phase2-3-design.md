# Trends monitors — research monitor (Phase 2) + document blocked monitors (Phase 3)

> Date: 2026-06-28 · Status: draft for review
> Phases 2 & 3 of the no-mock trends workstream (Phase 1 shipped in #4).

## Context

The 6 trend monitors (`policy`, `research`, `job-market`, `peer-programs`, `tech-signals`, `patents`) are inert stubs returning `signalsCreated: 0`. Investigation of their real data sources:

| Monitor | Real source | Status |
|---|---|---|
| research | `ResearchOutput` (165,775 rows; year, citations, Scopus quartile, faculty link) | **Phase 2 — build** |
| policy | analyze ingested POLICY PdfDocuments | **deferred** — 1 POLICY PDF exists; the now-real curated connectors (mhesi/nesdc/nxpo) already produce policy signals → overlap. Document. |
| job-market | per-posting job data | blocked — jobthai/jobsdb deprecated; kmitl is aggregate-only |
| peer-programs | peer-programs-scraper | blocked — mocked, no real feed |
| tech-signals | tech-news/vendor feed | blocked — none wired |
| patents | patent API | blocked — needs access/procurement |

Per the no-mock policy, blocked monitors stay inert (return 0 — honest, not faked), with blockers documented.

## Phase 2 — research monitor (faculty-level Q1 trend signals)

Granularity (decided): **faculty-level trends**, not per-paper (165k papers would flood the radar).

### Logic — `apps/ingestion/src/trend-monitors/monitors.ts :: runResearchMonitor()`
Replace the stub body with:
1. **Aggregate** Scopus-Q1 (`quartile = 1`) `ResearchOutput` counts per faculty, for the two most recent years present in the data (`Y` = max year, `Y-1`). Join `research_outputs → faculty_members → faculties`. (Validated query — Faculty of Medicine: 332 (2025) vs 235 (2024); Agriculture: 95 vs 58.)
2. **Detect rises** via a PURE, testable helper `detectResearchTrends(rows, opts)`:
   - Input: `[{ facultyId, facultyNameEn, facultyNameTh, yCount, prevCount }]`.
   - Emit a trend when `yCount >= prevCount * RISE_RATIO` **AND** `yCount - prevCount >= MIN_ABS_DELTA` (defaults: `RISE_RATIO = 1.20`, `MIN_ABS_DELTA = 10` — avoids small-faculty noise). **Rises only** (a decline in the possibly-incomplete current year is likely an artifact, not a signal).
   - Returns `[{ facultyId, facultyNameEn, facultyNameTh, year, yCount, prevCount, pct }]`.
3. **Emit** one RESEARCH signal per detected faculty via the existing `createSignal()`:
   - `signalType: 'RESEARCH'`
   - `title`: `"Faculty of X — rise in high-quartile (Q1) research output (<Y-1>→<Y>)"` — deterministic (drives dedup).
   - `summaryEn`: `"KKU's Faculty of X recorded <yCount> Scopus-Q1 publications in <Y>, up from <prevCount> in <Y-1> (+<pct>%)."`; `summaryTh`: Thai equivalent.
   - `impactScore`: `min(0.85, 0.45 + pct/200)` (scaled by magnitude; documented).
   - `affectedProgramIds`: programs in that faculty (cheap lookup) — or `[]` if simpler; **keep faculty-level**, don't fan to skills.
   - `sourceUrl`: `null` (internal data).
4. **Dedup (idempotent re-runs):** before `createSignal`, skip if a `TrendSignal` with the same `signalType='RESEARCH'` + exact `title` already exists (`findFirst`). The deterministic title (faculty + year-pair) makes the monitor safe to run weekly without duplicating.
5. Return `{ kind: 'research', signalsCreated, notificationsSent }` (real counts).

### Wiring
The monitor is already scheduled (`MONITOR_CADENCE.research`, weekly) and invoked by the trend-monitors queue/runner — replacing the stub body makes it live. Verify the runner calls `runResearchMonitor()` and surfaces its outcome (no new wiring expected).

### Test
- Unit test `detectResearchTrends` (pure, no DB): rise above threshold → emitted; below ratio → not; below abs-delta → not (small faculty); decline → not; tie → not. Locks the thresholds.

## Phase 3 — document blocked/deferred monitors

- **New doc `docs/trend-monitors.md`** — one section per monitor: what it would detect, its real data source, current status (LIVE / deferred / blocked), and for blocked ones **exactly what's needed to build it** (the table above, expanded). States the no-mock stance: inert ≠ mock; these produce nothing until their real source exists.
- **Update the 5 deferred monitor stubs' comments** in `monitors.ts` to reference `docs/trend-monitors.md` and state they're intentionally inert pending a real source (not mock), instead of the current "(mocked)" log wording which is misleading (they don't emit mock data — they emit nothing).
- Update `apps/web/app/changelog/page.tsx`? No — defer changelog to the release that ships this.

## Non-goals
- No per-paper research signals (decided: faculty-level).
- No building of the 4 blocked monitors (no data sources).
- No policy-PDF monitor (curated connectors cover policy; revisit if a POLICY-PDF stream appears).
- No citation-milestone or research-area-concept signals (ResearchOutput has no area/concept tags; faculty is the available dimension).

## Risks / notes
- **Year granularity:** `ResearchOutput.year` is an Int (no finer dates), so trends are year-over-year, not "this quarter." The current year may be incomplete; emitting **rises only** + the dedup title avoids re-signalling and false declines.
- **Re-run safety:** deterministic titles + the dedup check make weekly runs idempotent.
- **Threshold tuning:** `RISE_RATIO`/`MIN_ABS_DELTA` are documented constants; adjust if the radar gets too sparse/noisy.
