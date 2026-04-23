> **GLOBAL UPDATES APPLY:** Before this prompt, read `GLOBAL-UPDATES.md` and `CLAUDE.md`. Apply all cross-cutting requirements: multi-level scope (university/faculty/department/program), English UI labels with Thai analysis content, light/dark theme support, modern SaaS UX patterns, KKU SSO auth, PostgreSQL DB, PDF as primary external data input, and Council-readiness rules.
>
> **Skills to invoke:** `frontend-design`
>
> ---
>
# Prompt 08 — Module 4: Demand-Supply Gap Analyzer

> **When to use:** After trends. Quantitative complement to trends — answers "are we producing the right people for the market?"

---

Build the **Demand-Supply Gap Analyzer** — module 4 of 8.

Quantifies labor market demand against KKU graduate supply at occupation, skill, and regional levels.

### Page (`/gap-analysis`)

**Top: scope selector**
- Dimension: Skills | Occupations | Sectors
- Region: Thailand | Northeast | Mekong | Specific province (dropdown)
- Time horizon: Current | 3-year forecast | 5-year forecast | 10-year forecast
- Comparison: Absolute gap | Per-capita gap | Growth-adjusted gap

**Center: gap visualization**

For **Skills view:**
- Two-column horizontal bar chart
- Left side (red, growing left): Demand exceeds supply (gap = opportunity)
- Right side (blue, growing right): Supply exceeds demand (gap = risk)
- Top 30 by absolute gap
- Hover → tooltip: which programs supply this skill, which job postings demand it
- Click → drill to skill detail

For **Occupations view:**
- Same format, plus mapping to ISCO-08 codes
- Show Thailand average vs KKU production share

For **Sectors view:**
- Sectoral panel: BCG sectors (B-Bio, C-Circular, G-Green) and S-curve sectors
- Per sector: total demand index, total KKU supply, gap, contributing programs, growing/shrinking trend

**Right rail: regional map**
- Thailand map (Northeast highlighted as KKU's primary mandate region)
- Choropleth: gap intensity by province
- Toggle between demand and supply views
- Click province → filtered view

### Cross-cutting analyses

1. **Forecast vs reality**
   - Compare last year's forecast against actual outcomes
   - Build trust by showing model accuracy over time

2. **Underserved skills page** (`/gap-analysis/opportunities`)
   - Skills with high demand growth, no/few KKU programs covering
   - For each: AI-generated proposal for how KKU could address (new course, new track, new program)
   - Estimated demand size, peer programs already addressing, fit with KKU strengths

3. **Oversupply page** (`/gap-analysis/risks`)
   - Programs producing graduates exceeding regional demand
   - Demographic-adjusted risk (account for declining youth cohort)
   - AI suggestions: rebalance, repurpose, reduce intake

### Data sources required (note any not yet ingested)
- Job postings → Occupation/Skill demand (from extraction pipeline)
- KKU graduate counts by program (already in EnrollmentMetric)
- Program → Skill mapping (already from extraction)
- Labor market forecasts (LaborMarketForecast table — may be sparse, fall back to trend extrapolation with explicit "low confidence" labels)
- Demographic projections (DemographicProjection table)
- Provincial GPP composition (NESDC data, ingested via NsoConnector or new connector)

### Forecasting layer
Build `apps/forecast` (Python service or TypeScript with simple-statistics) for:
- Demand projection: ARIMA / exponential smoothing on occupation demand time series
- Supply projection: linear projection of program enrollment with demographic adjustment
- Confidence intervals on every forecast
- Methodology documented in `docs/methodologies/forecasting.md`

### Council-readiness features
- Every gap number has provenance + freshness
- Forecast confidence bands always visible
- "How is this calculated?" link on every metric
- Filter to "high confidence only" toggle
- Export Gap Report PDF (per region, per sector, per faculty)

### AI insight layer
- "Top 5 strategic gaps for KKU this quarter" — AI-curated list with reasoning
- Per-program: "Skills this program should add" — extraction from job posts demanding skills missing from program curriculum
- Sector deep-dive briefs: 1-page Thai analysis per sector (BCG, S-curve)

### API endpoints
- `GET /api/v1/gap/skills`
- `GET /api/v1/gap/occupations`
- `GET /api/v1/gap/sectors`
- `GET /api/v1/gap/regional/:province`
- `GET /api/v1/gap/opportunities`
- `GET /api/v1/gap/risks`
- `GET /api/v1/gap/forecast-accuracy`
- `POST /api/v1/gap/insights/generate`

### Tests
- Test gap calculation with known inputs
- Test forecast confidence interval calculation
- Test that demographic adjustment changes supply projections correctly
- Test regional filtering aggregates correctly

### Deliverables
- Working gap analyzer on seeded data showing realistic patterns (some clear oversupply, some clear opportunities)
- Sample sectoral brief PDF
- Forecast accuracy backtest results
- 3 suggestions for next module — Strategic Scenario Planner is next, and is the most important Council-facing module
