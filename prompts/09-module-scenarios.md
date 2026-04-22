> **GLOBAL UPDATES APPLY:** Before this prompt, read `GLOBAL-UPDATES.md` and `CLAUDE.md`. Apply all cross-cutting requirements: multi-level scope (university/faculty/department/program), English UI labels with Thai analysis content, light/dark theme support, modern SaaS UX patterns, KKU SSO auth, PostgreSQL DB, PDF as primary external data input, and Council-readiness rules.
>
> **Skills to invoke:** `frontend-design`, `pdf` (for scenario pack export)
>
> ---
>
# Prompt 09 — Module 5: Strategic Scenario Planner

> **When to use:** After gap analyzer. The most important Council-facing module — where decisions get simulated before they're made.

---

Build the **Strategic Scenario Planner** — module 5 of 8.

The most decision-consequential module. Lets executives and Council simulate "what if" interventions on the program portfolio and compare outcomes.

### Scenario types
1. **Sunset** — close a program. Effects: revenue loss, faculty redeployment, student transition.
2. **Merge** — combine two or more programs. Effects: consolidated economics, curriculum overlap analysis, complaint/disruption risk.
3. **Launch** — start a new program. Inputs: target skills, target intake, faculty plan, capital needs. Effects: demand projection, competitive position, breakeven horizon.
4. **Reshape** — keep program but modify (intake size, tuition, curriculum overhaul, repositioning). Effects: changes in projected outcomes.
5. **Portfolio rebalance** — bulk action across many programs (e.g., apply demographic stress test).

### Page structure (`/scenarios`)

**Library view:**
- All scenarios visible to user (private + shared + Council-reviewed)
- Filter by status, creator, affected programs
- "Create new scenario" → wizard

**Scenario editor (`/scenarios/[id]`):**
- Tabs: Setup | Assumptions | Simulation | Comparison | Discussion

**Setup tab:**
- Name, description
- Type (one of the five above)
- Affected programs picker
- Time horizon (5/10 years)
- Owner, collaborators

**Assumptions tab:**
- Editable assumption table — every assumption has: label, current value, scenario value, unit, source/rationale
- Examples: tuition annual growth, salary inflation, demand growth per occupation, retention rates, demographic projections
- Default assumptions inherited from system; user can override
- AI assist: "Suggest assumptions for this scenario type" — generates rationale-backed defaults
- Every assumption change tracked in audit log

**Simulation tab:**
- Run button → executes simulation (BullMQ job for long runs)
- Outputs:
  - Year-by-year projection table
  - Revenue, cost, net contribution, enrollment, graduate output, skill production
  - Compared against baseline (status quo)
  - Sensitivity analysis: tornado chart of which assumptions matter most
  - Risk register: AI-identified risks of this scenario (faculty resistance, student disruption, brand impact, regulatory)

**Comparison tab:**
- Compare up to 4 scenarios side-by-side
- Same metrics, same time horizon
- AI summary of trade-offs
- Recommendation framework: not "which is best" but "which best matches which strategic priority"

**Discussion tab:**
- Threaded comments
- Ability to attach evidence (link to Trends, Gap analyses, Program Deep-Dives)
- Workflow: DRAFT → SHARED → COUNCIL_REVIEWED → DECIDED
- On COUNCIL_REVIEWED → notification to all Council members
- On DECIDED → links to a CouncilDecision record

### Special scenarios (templates)
1. **Demographic stress test** — applies Thailand 2030/2040 cohort projections to all 297 programs; identifies which become unsustainable
2. **Financial stress test** — apply -20% revenue shock; show survival ranking
3. **AI disruption test** — apply AI labor displacement projections to graduate employment forecasts
4. **Mekong expansion** — model expansion of programs into Lao/Cambodia markets

### Engine
Scenario engine in `apps/forecast` (or extend it):
- Pure function: `runScenario(baseline, assumptions, interventions) → projection`
- Deterministic given same inputs
- Audit log every run with full inputs + outputs
- Methodology version tracked

### Council-readiness features
- **Assumption transparency** — full assumption diff vs baseline always visible
- **Methodology version** displayed on every projection
- **Confidence intervals** on every projection (Monte Carlo with N=1000 default)
- **Critical caveats** — AI surfaces what the model can't capture (e.g., political risk, brand impact, faculty morale)
- **"What would change my mind?"** — AI generates the conditions under which a recommended decision would be wrong
- **Council Pack export** — full scenario pack as PDF: 1-page exec summary + assumptions + projections + risks + recommendation

### AI assistance throughout
- Suggest assumptions
- Identify hidden risks
- Compare scenarios narratively
- Generate Council brief
- Devil's advocate mode — argue against the apparent best scenario
- All AI calls logged, all responses include confidence + sources

### API endpoints
- `GET /api/v1/scenarios`
- `POST /api/v1/scenarios`
- `GET /api/v1/scenarios/:id`
- `PATCH /api/v1/scenarios/:id`
- `POST /api/v1/scenarios/:id/run`
- `GET /api/v1/scenarios/:id/results`
- `POST /api/v1/scenarios/:id/compare` (with other scenario IDs)
- `POST /api/v1/scenarios/:id/share`
- `POST /api/v1/scenarios/:id/decide`
- `POST /api/v1/scenarios/:id/brief`
- `GET /api/v1/scenarios/templates`

### Tests
- Test deterministic engine: same inputs → same outputs
- Test sunset scenario: revenue projection drops by program revenue
- Test merge scenario: combined cost is less than sum (synergy assumption)
- Test demographic stress test on all programs runs in < 30s
- Test that DECIDED scenario creates CouncilDecision record
- Test role gating: only EXECUTIVE/ADMIN can mark COUNCIL_REVIEWED

### Deliverables
- Working scenario planner with all 5 types
- Demographic stress test runnable on full seed data
- Sample scenario pack PDF for a sunset scenario
- 3 suggestions for next module — Competitive Benchmarking is next
