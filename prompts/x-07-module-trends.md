> **GLOBAL UPDATES APPLY:** Before this prompt, read `GLOBAL-UPDATES.md` and `CLAUDE.md`. Apply all cross-cutting requirements: multi-level scope (university/faculty/department/program), English UI labels with Thai analysis content, light/dark theme support, modern SaaS UX patterns, KKU SSO auth, PostgreSQL DB, PDF as primary external data input, and Council-readiness rules.
>
> **Skills to invoke:** `frontend-design`, `pdf-reading` (for policy doc parsing)
>
> ---
>
# Prompt 07 — Module 3: Future Trends Radar

> **When to use:** After deep-dive. The most "AI-forward" module — continuously surfaces external signals and links them to KKU programs.

---

Build the **Future Trends Radar** — module 3 of 8.

A continuously updated feed of external signals (policy, research, market, tech, news) curated and explained by AI, with each trend explicitly linked to affected KKU programs.

### Page (`/trends`)

**Top: filter & summary bar**
- Filters: signal type, time window (7d/30d/90d/12mo), region (Global/Thailand/Northeast/Mekong), impact level
- Summary: "127 signals in last 30 days · 23 high-impact · 8 affecting programs in danger zone"

**Center: signal feed**
- Card-based feed, infinite scroll, sorted by impact × recency
- Each card:
  - Signal type badge (color-coded)
  - Title (Thai + English toggle)
  - 2-sentence AI summary
  - Source(s) with link
  - Detected date + freshness
  - Impact score with reasoning
  - Affected programs (chips, click → deep-dive)
  - Affected skills (chips, click → skill explorer)
  - Actions: "Add to scenario", "Annotate", "Mark as reviewed"

**Right rail: signal radar visualization**
- Circular radar chart with concentric rings (Now / 1yr / 3yr / 5yr+)
- Wedges by signal category
- Dots positioned by impact (closer to center = higher impact)
- Click dot → opens corresponding card

### Sub-pages
1. `/trends/sectors` — drill into sector-specific trend boards (BCG sectors, S-curve sectors)
2. `/trends/regions/[region]` — Northeast Thailand-specific trend board (your differentiator vs. Bangkok-centric universities)
3. `/trends/[signalId]` — full signal page with AI deep analysis, related signals, related research papers

### Continuous monitoring jobs
1. `MonitorPolicyDocsJob` — every 6 hours, fetch new MHESI/NESDC/NXPO/BOI/EECO publications
2. `MonitorJobMarketJob` — daily, recompute occupation demand trends, detect anomalies
3. `MonitorResearchJob` — weekly, scan OpenAlex for emerging research clusters in fields KKU teaches
4. `MonitorPeerProgramsJob` — weekly, check for new programs at peer institutions
5. `MonitorTechSignalsJob` — weekly, scan tech announcements (e.g., new AI capabilities) and assess curriculum impact
6. `MonitorPatentsJob` — monthly, scan patent activity in S-curve sectors

Each job creates `TrendSignal` rows with affected program/skill mappings, then triggers notification fan-out.

### AI analysis layer
For each detected signal, the AI must produce:
- Title (clear, neutral)
- Summary (Thai + English, 2 sentences)
- Impact assessment with reasoning (low/medium/high + why)
- Affected programs (with confidence per program)
- Affected skills (with confidence per skill)
- Recommended response options (e.g., "Add elective", "Update curriculum X", "Launch new track", "No action needed yet, monitor")
- Related historical signals (vector similarity)

All under the AI service abstraction, all logged to AiInference.

### Notifications
- New high-impact signals affecting a program → notify the program owner (faculty dean) via in-app inbox
- Weekly digest email to executives summarizing top signals
- "Signal subscriptions" — users can subscribe to particular sectors or programs

### Council-readiness features
- Every signal traceable to its source document(s)
- Confidence shown explicitly on every AI assessment
- "Show reasoning" expandable on every recommendation
- Export weekly trend digest as PDF in Council Pack format

### API endpoints
- `GET /api/v1/trends` (with filters)
- `GET /api/v1/trends/:id`
- `GET /api/v1/trends/by-program/:programId`
- `GET /api/v1/trends/by-skill/:skillId`
- `POST /api/v1/trends/:id/annotate`
- `POST /api/v1/trends/:id/mark-reviewed`
- `GET /api/v1/trends/digest/weekly` (returns generated digest)

### Tests
- Test signal detection from a mock policy doc → verifies impact scoring + program mapping
- Test that signals affecting program X surface on `/programs/X` deep-dive trend section
- Test notification fan-out

### Deliverables
- Working trends feed with at least 30 mock signals across categories
- Working radar chart visualization
- Sample weekly digest PDF
- 3 suggestions for next module — Demand-Supply Gap Analyzer is next
