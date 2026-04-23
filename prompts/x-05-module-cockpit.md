# Prompt 05 — Module 1: Portfolio Overview Cockpit

> **When to use:** First analytical module. The landing page Council members see — must look polished, load fast, and earn trust on first impression.
>
> **Skills to invoke (critical):**
> - `frontend-design` — for visual quality
> - `pdf` — for the Council Pack export

---

Before starting, please read and apply:
- `/mnt/skills/public/frontend-design/SKILL.md`
- `/mnt/skills/public/pdf/SKILL.md`

Read `CLAUDE.md`, `GLOBAL-UPDATES.md`, `docs/design-system.md`, `/styleguide` page from prompt 02b.

---

Build the **Portfolio Overview Cockpit** — module 1 of 8.

The landing page after login for COUNCIL/EXECUTIVE/DEAN/DEPT_HEAD. Must visualize the portfolio at the **selected scope** (university / faculty / department / program) and let users grasp it in 30 seconds.

### Scope behavior (mandatory)
The page reads scope from URL via the global `<ScopeSelector>` (built in prompt 02b).
- **University scope:** all 297 programs visualized
- **Faculty scope:** only that faculty's programs (and that faculty's departments shown in heatmap rows)
- **Department scope:** only that department's programs
- **Program scope:** the cockpit redirects to Program Deep-Dive (prompt 06)

### Page structure (`/cockpit`)

Three view modes via `<SegmentedControl>`:
1. **Health Heatmap** (default)
2. **BCG-Style Strategic Matrix**
3. **Faculty/Department Rollup Tree**

Persistent left rail:
- Filters: level (Bachelor/Master/Doctoral), status (Active/Paused/Sunset), establishment year range
- Quick-search by program/department name (Thai or English) with `pg_trgm`
- Saved views (per user, persisted)
- Recent views

Top KPI strip (KPIs respect scope):
- Total active programs at scope
- Total enrollment (current academic year)
- Net contribution (current fiscal year)
- Programs in "danger zone" (count + % change)
- Programs with quality concerns
- Average curriculum age
Each KPI clickable → drills into filtered view.

### Health Heatmap
- **At University scope:** rows are faculties, expandable to departments, then programs
- **At Faculty scope:** rows are departments, expandable to programs
- **At Department scope:** rows are programs
- Columns: 5 health dimensions:
  1. Demand
  2. Financial
  3. Quality
  4. Relevance
  5. Capability
- Each cell colored 🟢🟡🔴 with score (0–100)
- Hover → tooltip with 3 metrics driving the score (Thai labels for metric meanings, English for axis labels)
- Click → drill (faculty → faculty heatmap; department → department heatmap; program → Program Deep-Dive)
- Use `<Heatmap>` from prompt 02b

### BCG-Style Strategic Matrix
- X: market growth (5-year demand trend for primary occupation cluster)
- Y: KKU competitive position (composite)
- Bubble size: annual revenue
- Bubble color: net contribution (negative = `data-negative`, positive = `data-positive`)
- Labels in English, hover content in Thai
- At Faculty/Department scope: bubbles are programs; at University scope: bubbles can be either programs or aggregated faculties (toggle)
- Click bubble → Program Deep-Dive

### Rollup Tree
- Hierarchical: University → Faculty → Department → Program
- Per node: total programs, total enrollment, net contribution, average health score
- Use `<DataTable>` with grouping or a custom tree view

### Council-readiness features (mandatory)

1. **Provenance everywhere** — every chart's `<ProvenanceButton>` opens the drawer (built in prompt 02b)
2. **"Generate Council brief" button** at top right:
   - Opens dialog with options: scope (defaults to current), brief style (Thai narrative, executive summary, full deep-dive), inclusion options
   - Calls AI, generates Thai-language brief with confidence indicators and citations
   - Saved to Decision Workspace (placeholder for now)
   - Uses AI service abstraction (prompt 04)
3. **"Export as Council Pack PDF"** — uses the `pdf` skill:
   - Visual style matches the design system (prompt 02b)
   - Thai primary, optional English appendix
   - Graphic-heavy minimal design
   - Cover page with KKU branding, scope, date, author
   - Embedded charts as SVG (not raster) for crispness
4. **Freshness indicator** in top bar: "Data current as of [date]"
5. **Assumption disclosure** — link to "How are health scores calculated?" methodology doc

### API endpoints (all scope-aware)
- `GET /api/v1/cockpit/kpis?scope=&scopeId=`
- `GET /api/v1/cockpit/heatmap?scope=&scopeId=`
- `GET /api/v1/cockpit/matrix?scope=&scopeId=`
- `GET /api/v1/cockpit/rollup?scope=&scopeId=`
- `POST /api/v1/cockpit/brief` — body: `{ scope, scopeId, style, includeOptions }`. Rate-limited, audit-logged.
- `POST /api/v1/cockpit/export` — generates Council Pack PDF

All respect role-based scope filtering (DEAN sees full data only for own faculty; DEPT_HEAD only for own department; COUNCIL/EXECUTIVE/ADMIN/ANALYST see all scopes).

### Health score calculation
Document in `docs/methodologies/health-score.md`. Weighted averages with explicit `null` handling — never fabricate. Surface "data completeness %" alongside every score. Methodology version on every score.

### Performance
- Cockpit loads < 2s on cached data at any scope
- Server components + streaming
- Cache aggregations in Redis (scope-keyed, 1-hour TTL, invalidated on ingestion)
- Use materialized views from prompt 01

### Accessibility & i18n
- All UI labels in English
- Tooltip content, hover descriptions, AI-generated insights in Thai (with EN toggle)
- All charts have a "Show data table" toggle (built into `<Chart>` component)
- WCAG AA in both light + dark themes (verified)
- Color choices work for color-blind users (icons + colors, not color alone)

### Tests
- Visual regression on heatmap and matrix in both themes (Playwright screenshots)
- Test scope switching changes data correctly
- Test role-based filtering for each role
- Test brief generation creates `AiInference` row, response includes confidence + sources
- Test PDF export renders correctly in both themes (PDF should always be light theme regardless of UI theme)

### Deliverables
- Working cockpit on seeded data at all four scopes
- Sample Council Pack PDF
- Sample AI-generated Thai brief
- Health score methodology decisions documented
- Screenshots in light + dark
- 3 suggestions for next module — Program Deep-Dive next
