> **GLOBAL UPDATES APPLY:** Before this prompt, read `GLOBAL-UPDATES.md` and `CLAUDE.md`. Apply all cross-cutting requirements: multi-level scope (university/faculty/department/program), English UI labels with Thai analysis content, light/dark theme support, modern SaaS UX patterns, KKU SSO auth, PostgreSQL DB, PDF as primary external data input, and Council-readiness rules.
>
> **Skills to invoke:** `frontend-design`, `pdf`, `docx`, `pptx` (for Council Pack exports)
>
> ---
>
# Prompt 12 — Module 8: Decision Workspace

> **When to use:** Last module. Closes the loop — captures decisions, tracks follow-through, builds institutional memory.

---

Build the **Decision Workspace** — module 8 of 8.

The closing loop. Captures Council decisions, tracks follow-through, and builds institutional memory so future analyses learn from past decisions.

### Page (`/decisions`)

**Library view:**
- All Council decisions, filterable by date, faculty, scenario type, follow-up status
- Status: PROPOSED → COUNCIL_REVIEWED → APPROVED → IN_IMPLEMENTATION → COMPLETED → ARCHIVED
- Per-decision card: title, summary, affected programs, decision date, owner

**Decision detail (`/decisions/[id]`):**

1. **Header** — title, status, decision date, Council session reference, owner
2. **Strategic context** — what was the situation when the decision was made (snapshot of relevant cockpit/gap/trend data at decision time, frozen)
3. **Options considered** — link to scenarios reviewed
4. **Decision** — the actual approved direction, rationale, dissenting views (if recorded)
5. **Approvers** — Council members who approved (with role-appropriate visibility)
6. **Implementation plan** — milestones, owners, target dates
7. **Tracking** — current status of each milestone, evidence
8. **Outcomes review** — at 6mo/1yr/3yr post-implementation, AI generates a "what actually happened vs what was projected" comparison
9. **Discussion thread** — for ongoing context

### Workflow features
- Decision templates (sunset, merge, launch, reshape, rebalance) with pre-filled structure
- Approval workflow with notifications
- Document upload (Council resolution PDFs, board approvals)
- Versioning — decisions can be amended; history visible
- E-signature integration placeholder (for formal Council use)

### Annotations across the system
- The `Annotation` model (already in schema) lets users mark up any chart/insight in any module
- Annotations have visibility: PRIVATE / TEAM / COUNCIL
- Decision Workspace shows all annotations relevant to in-progress decisions

### Disagreement log
- Captures times when expert judgment overrode AI insight
- Each entry: AI insight, expert correction, rationale, outcome
- Used to (a) respect faculty expertise, (b) improve future model performance
- Browseable as a learning resource

### Outcomes review (the institutional memory feature)
- Scheduled job: 6 months / 1 year / 3 years after a decision's implementation date, AI generates a review:
  - Projected outcomes vs actual
  - What worked, what didn't
  - Lessons for future similar decisions
- Reviews surface in a "Lessons Learned" library searchable by future scenario authors

### Council Pack generation (consolidated)
- Move the Council Pack PDF generator from individual modules into a shared service
- Library of Council Pack templates: Quarterly Review, Annual Strategic Review, Single-Decision Pack, Faculty-Level Review
- Visual style: minimalist, graphic-heavy (matching the user's preference)
- Bilingual with Thai primary

### API endpoints
- `GET /api/v1/decisions`
- `POST /api/v1/decisions`
- `GET /api/v1/decisions/:id`
- `PATCH /api/v1/decisions/:id` (status transitions audit-logged)
- `POST /api/v1/decisions/:id/milestones`
- `PATCH /api/v1/decisions/:id/milestones/:milestoneId`
- `POST /api/v1/decisions/:id/approvers/:userId`
- `POST /api/v1/decisions/:id/outcome-review`
- `GET /api/v1/decisions/lessons-learned?topic=`
- `GET /api/v1/annotations` (filtered)
- `POST /api/v1/annotations`

### Tests
- Test status transitions enforce role permissions
- Test outcome review job runs at correct intervals
- Test that snapshot data is preserved with decision (doesn't change as underlying data changes)
- Test Council Pack PDF generation for each template

### Deliverables
- Working decision workspace with at least 3 sample decisions in different statuses
- One sample completed outcome review
- Sample Council Pack PDFs (4 templates)
- 3 suggestions for next session — system hardening (prompt 13) is next
