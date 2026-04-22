> **GLOBAL UPDATES APPLY:** Before this prompt, read `GLOBAL-UPDATES.md` and `CLAUDE.md`. Apply all cross-cutting requirements: multi-level scope (university/faculty/department/program), English UI labels with Thai analysis content, light/dark theme support, modern SaaS UX patterns, KKU SSO auth, PostgreSQL DB, PDF as primary external data input, and Council-readiness rules.
>
> **Skills to invoke:** `frontend-design`, `pdf` (for printable scorecard)
>
> ---
>
# Prompt 06 — Module 2: Program Deep-Dive

> **When to use:** After cockpit. The shareable per-program scorecard — every program gets one URL.

---

Build the **Program Deep-Dive** — module 2 of 8.

Per-program strategic scorecard at `/programs/[programId]`. The URL must be shareable; opening it from a Council document or email goes straight to the program's analysis.

### Page sections (vertical scroll, anchored nav on the left)

1. **Header**
   - Program name (Thai + English), code, faculty, level, year established
   - Status badge (Active/Paused/Sunset)
   - Overall health score (composite) + 5 dimension breakdown as a small radar chart
   - Quick actions: "Generate brief", "Add to scenario", "Annotate", "Share"

2. **Strategic narrative** (AI-generated, regenerable)
   - 1-paragraph Thai summary of the program's current strategic position
   - Auto-regenerates when underlying data changes
   - Editable by EXECUTIVE/ANALYST roles, with edit history
   - Confidence + sources visible

3. **Demand funnel** (5-year trend)
   - Sankey or funnel chart: Applications → Admitted → Enrolled → Year 2 retained → Graduated on time
   - Conversion rates between each stage
   - Compared against faculty average and KKU average
   - TGAT/TPAT score distribution of admitted students

4. **Financial waterfall** (current fiscal year + 5-year trend)
   - Tuition revenue → Direct costs → Allocated faculty → Allocated facilities → Allocated overhead → Net contribution
   - Cost per student vs revenue per student
   - Cost methodology version explicitly displayed (link to `CostMethodology` doc)
   - Sensitivity: "If tuition raised 5%, net contribution becomes…"

5. **Skills coverage** (the AI insight section)
   - Two stacked horizontal bar charts:
     - Top 20 skills the program *teaches* (from curriculum extraction)
     - Top 20 skills the relevant labor market *demands* (from job posting extraction)
   - Highlight gaps (demanded but not taught) and surplus (taught but not demanded)
   - Match score (0–100) with explanation
   - Top 5 specific recommendations from AI (e.g., "Add a course covering X — currently demanded by Y job posts in NE Thailand and offered by 3 peer programs")

6. **Outcomes**
   - Employment rate at 1yr and 5yr post-graduation
   - Average salary trajectory
   - Job relevance score (graduate self-rating)
   - Geographic distribution of graduates (where they're working — heatmap of Thailand)
   - Top employers
   - Employer feedback summary (AI-extracted themes from open-ended feedback)

7. **Faculty capability**
   - Faculty roster: count by rank, average age, retirement projection (5-year), research output
   - Succession risk score (% of faculty retiring within 5 years vs. pipeline)
   - Research alignment with program (% of faculty publications aligned with curriculum skills)
   - **Important:** COUNCIL role does NOT see individual salaries; aggregates only

8. **Peer comparison**
   - Side-by-side with up to 5 peer programs (auto-suggested + manually addable)
   - Peers can be Thai, ASEAN, or global
   - Compare: curriculum structure, credits, ranking, research, distinctive features
   - "What peers have that we don't" — explicit gap callout

9. **Trend exposure**
   - Top 5 `TrendSignal` rows affecting this program
   - For each: signal description, source, impact score, AI-suggested response
   - Filterable by signal type (policy/research/market/tech)

10. **Decision history**
    - Past Council decisions affecting this program
    - Pending scenarios that include this program
    - Annotations from executives, deans, analysts (respecting visibility rules)

### Council-readiness features (every section)
- Provenance ⓘ on every chart
- "Last updated" + "Data completeness %" for each section
- AI sections show confidence + reasoning chain expandable
- "Disagree with this insight?" button → opens dialog to capture expert correction → routes to model improvement queue

### API endpoints
- `GET /api/v1/programs/:id/overview`
- `GET /api/v1/programs/:id/demand-funnel`
- `GET /api/v1/programs/:id/financials`
- `GET /api/v1/programs/:id/skills`
- `GET /api/v1/programs/:id/outcomes`
- `GET /api/v1/programs/:id/faculty` (role-filtered)
- `GET /api/v1/programs/:id/peers`
- `GET /api/v1/programs/:id/trends`
- `GET /api/v1/programs/:id/decisions`
- `POST /api/v1/programs/:id/narrative` (regenerate AI narrative)
- `POST /api/v1/programs/:id/disagreements` (capture expert correction)

### Print/PDF view
- Dedicated `/programs/[programId]/print` route optimized for A3 printing
- Single-page Council brief format
- Includes QR code linking back to live URL

### Tests
- Snapshot test for the page rendering with seed data
- Test role filtering on faculty section (COUNCIL doesn't see salaries)
- Test narrative regeneration creates AiInference row
- Test disagreement submission creates audit entry

### Deliverables
- Working deep-dive for at least 3 seeded programs (one strong, one weak, one ambiguous so we can see how visualization handles the spectrum)
- Printable PDF sample
- 3 suggestions for next module — Future Trends Radar is next
