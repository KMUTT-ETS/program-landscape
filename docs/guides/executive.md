# Executive Guide — VPs & Deans

Program Landscape is a strategic decision-support app covering all 297 KKU programs. This guide is for Vice Presidents, Deans, and Department Heads who actively use the system between Council sessions.

---

## Your role-shaped view

The app shows you what you're authorised to see:

- **EXECUTIVE** (VPs / President): all 297 programs, all financials, can create scenarios and propose decisions.
- **DEAN**: full data for **your faculty** + aggregated-only for other faculties. Can attach documents to programs within your faculty.
- **DEPT_HEAD**: full data for **your department** + read-only for your faculty.

Scope switches everywhere: use the **scope selector** in the top bar (`university / faculty / department / program`). The URL is shareable — send `?scope=faculty&scopeId=eng` to a colleague and they land on the same view.

---

## Weekly workflow

| Monday AM | Before Council meeting | End of quarter |
|---|---|---|
| Open **Trends Radar** → scan policy / market / research signals from the last week | Pull up **Portfolio Cockpit** at `scope=faculty` → review heatmap; flag red/amber programs for the agenda | Run **Outcome Reviews** on decisions approved 6mo / 1yr / 3yr ago → identify systematic bias in our forecasting |
| Check **Data Quality** (`/admin/data-quality`) to see if new numbers landed | Export **Council Pack** PDF in Thai | Rotate quarterly audit: rejected AI extractions, open decisions, pending data gaps |

---

## The 8 modules

### 1. Portfolio Cockpit (`/cockpit`)
Heatmap of program health across 5 dimensions: demand · financial · quality · relevance · capability. Each program gets a composite score 0-100 (methodology: `docs/methodologies/health-score.md`). Nulls are respected — a program with sparse data shows `—`, not a guessed number.

### 2. Program Deep-Dive (`/programs/[id]`)
10-section scorecard: identity, enrollment funnel, outcomes, financials, faculty, trends, peers, scenarios, recent decisions, disagreements. Print or export PDF for off-line sharing. Faculty-member detail is role-gated — COUNCIL sees aggregate ranks only.

### 3. Trends Radar (`/trends`)
External signals (policy / research / market / tech / news) feeding into KKU's portfolio. Subscribe to specific filters (by sector, by program, by signal type) via `/inbox`. Weekly digest at `/trends/digest/weekly`.

### 4. Gap Analyzer (`/gap-analysis`)
Demand (labor market skills) vs supply (KKU graduates with those skills). Flags skill gaps and "opportunity skills" we could teach but don't. Gap methodology: `docs/methodologies/forecasting.md`.

### 5. Scenario Planner (`/scenarios`)
Dry-run interventions (sunset / launch / merge / reshape / rebalance) before committing. Tornado sensitivity + Monte Carlo uncertainty. Every scenario has an owner; the workflow goes DRAFT → SHARED → COUNCIL_REVIEWED → DECIDED.

### 6. Benchmarking (`/benchmarking`)
Peer-programs comparison across Thai Top-10 / ASEAN Top-20 / Global Subject Leaders. White-space detection: skills our peers teach that we don't. Distinctiveness score: how much of our curriculum is unique.

### 7. AI Analyst (`/analyst`)
Conversational interface. Tool-use agent calls `query_programs`, `compare_peers`, `run_quick_scenario`, etc. Bilingual (Thai/English). Every answer carries a confidence badge + an evidence rail showing every underlying tool call.

### 8. Decision Workspace (`/decisions`)
Council decisions with full lifecycle: proposal → Council review → approval → implementation → outcome review at 6mo / 1yr / 3yr. Each decision captures a **snapshot** of the portfolio state at approval time so we can compare actual vs projected honestly.

---

## Admin surfaces you might use

- `/admin/programs` — if you can attach PDFs to programs (DEAN / DEPT_HEAD / ANALYST / ADMIN).
- `/admin/system-status` — operational health: freshness of data, recent decisions, pending AI reviews.
- `/admin/data-quality` — completeness % per metric, ingestion failures, anomaly flags.
- `/admin/extraction-review` — approve / reject / edit AI extractions before they affect downstream analytics.

---

## Getting the best out of the AI Analyst

**Do:**
- Ask scope-aware questions: "What are the top 3 programs at financial risk in Faculty of Engineering?"
- Ask comparative questions: "Compare BSc Math to BSc Statistics on demand + supply trajectory."
- Ask for explanations: "Why did the health score for BSc History drop this quarter?"

**Don't:**
- Ask for personal info about faculty members (salary, contact, performance reviews) — the system refuses.
- Ask it to *decide* — the system will refuse a commit and redirect you to Scenarios + Decisions.
- Expect the analyst to write externally-facing copy — communications pieces go through a separate review.

---

## Your role in keeping the system honest

1. **Use the "Disagree" button** — every AI output has it. If something's wrong, flag it. Your feedback goes into the methodology version-bump cycle.
2. **Attach the source PDF** when adding a program or updating a curriculum — the system tracks provenance back to the original document.
3. **Record decisions with real reasoning** — the snapshot captured at approval becomes the audit record; reviewers later see what you knew and when.

---

## When something looks off

- **Numbers don't match what IT sent me** → check the Freshness badge on the chart. The system only shows what's been ingested; IT's extract may be newer.
- **A program I know exists isn't listed** → check `/admin/programs?status=SUNSET` (sunset programs are hidden from the main lists).
- **AI gave me an answer I don't trust** → expand the "show reasoning" panel → click the inference id → see the raw prompt + response + sources. If still wrong, hit Disagree.
