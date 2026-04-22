# Claude Code Prompts — KKU Curriculum Landscape

A sequenced set of prompts for vibe-coding the KKU Curriculum Landscape app with Claude Code, incorporating multi-level scope (university/faculty/department/program), KKU SSO, light/dark theming, modern SaaS UX, English UI with Thai analysis content, and PDF as the primary external data input.

## Read these first (every session)

1. **`GLOBAL-UPDATES.md`** — cross-cutting requirements applied to every prompt
2. **`SKILLS.md`** — which Claude skills to invoke per session
3. **`WINDOWS-DEV.md`** — if your dev machine is Windows (read before KICKOFF)
4. **`CLAUDE.md`** (in your repo, after prompt 00) — your project's source of truth

## How to use these

1. **One prompt per session.** Don't paste multiple prompts at once.
2. **Run them in order.** Each builds on the previous.
3. **Always invoke the Claude skills listed at the top** of each prompt. This is what makes the difference between generic output and production quality.
4. **Read the deliverables.** Each prompt ends with explicit deliverables. Review before moving on.
5. **Iterate within a prompt.** Push back, refactor, request more tests.
6. **Skip or reorder modules** if priorities shift. Modules 5–12 are loosely coupled.

## Sequence (15 prompts)

| # | Prompt | Skills | What it builds |
|---|---|---|---|
| 00 | Bootstrap | `frontend-design`, `theme-factory` | Skeleton, CLAUDE.md, aesthetic direction |
| 01 | Data model | — | Full Prisma schema with Department + materialized views for scope rollups |
| 02 | Auth & API core | — | KKU SSO via next-auth, RBAC with DEPT_HEAD role, scope-aware endpoints |
| **02b** | **Design system** | `frontend-design`, `theme-factory`, `brand-guidelines` | **Tokens, light/dark, SaaS components, scope selector, AI insight surfaces** |
| **02c** | **PDF generation** | `pdf`, `frontend-design` | **Gotenberg service with TH Sarabun New embedded — all PDFs route through this** |
| 03 | Ingestion framework | — | Pluggable connectors with PDF routing |
| **03b** | **PDF intake pipeline** | `pdf-reading`, `frontend-design` | **Primary external data input — classification, OCR, domain extractors, review queue** |
| 04 | Skills & AI | `pdf-reading`, `frontend-design` | Skill taxonomy, LLM extraction, AI service abstraction with translation |
| 05 | Module 1: Cockpit | `frontend-design`, `pdf` | Health heatmap, BCG matrix, rollup tree — all scope-aware |
| 06 | Module 2: Deep-Dive | `frontend-design`, `pdf` | Per-program scorecard at unique URL |
| 07 | Module 3: Trends Radar | `frontend-design`, `pdf-reading` | AI-curated external signal feed |
| 08 | Module 4: Gap Analyzer | `frontend-design` | Demand-supply gaps with forecasting |
| 09 | Module 5: Scenario Planner | `frontend-design`, `pdf` | What-if simulation with assumptions |
| 10 | Module 6: Benchmarking | `frontend-design`, `pdf-reading` | Peer comparison and white-space detection |
| 11 | Module 7: AI Analyst | `frontend-design` | Conversational interface (Thai/English) |
| 12 | Module 8: Decision Workspace | `frontend-design`, `pdf`, `docx`, `pptx` | Decision capture, lessons learned, Council Pack |
| 13 | Hardening | — | Security, performance, governance |
| **13b** | **Deployment (Ubuntu)** | — | **Pack-and-ship bundle, docker-compose.prod, nginx, deploy/rollback/backup scripts** |
| 14 | Real data integration | `pdf-reading` per source | Parallel workstream after mock system works |

**Bold rows are new since the first version**, reflecting the requirements you added.

## Key changes vs. v1

- **Multi-level scope baked in everywhere.** Added `Department` model, `DEPT_HEAD` role, `<ScopeSelector>` shared component, scope-aware API contracts, and materialized views for fast rollups.
- **English UI / Thai analysis content.** Pragmatic split: stable English labels for the digital team, Thai-primary insights for Council. EN translation toggle for AI content only.
- **Light + dark from day one.** Token system in `packages/design`, theme provider with no flash, every chart and PDF preview tested in both modes. Per-user theme preference.
- **KKU SSO via next-auth v5.** Configurable OIDC provider with claim mapping to faculty/department codes. Local credentials limited to dev only.
- **PostgreSQL only.** With `postgis` (regional), `pgvector` (embeddings), `pg_trgm` (fuzzy Thai search). Real PostgreSQL in tests via testcontainers.
- **PDF as a first-class data input.** New prompt 03b builds the full intake pipeline: storage, dedup, classification, OCR with Thai language support, structure detection, domain-specific extractors, confidence-based review queue, linkage to internal entities.
- **Modern SaaS UX.** New prompt 02b builds the design system following Linear/Vercel/Stripe/Retool/Notion conventions: command palette, density tuning, side panels, skeleton loading, keyboard shortcuts.
- **Thai-grade PDF generation.** New prompt 02c stands up Gotenberg as a Docker service with TH Sarabun New (the Cabinet-mandated Thai government font) embedded. All PDFs in the system route through one service — no in-process PDF libraries that mishandle Thai diacritics or word-wrap.
- **Pack-and-ship deployment.** New prompt 13b covers the full production deployment: multi-stage Dockerfiles, `docker-compose.prod.yml` with healthchecks and resource limits, **end-to-end TLS** (KKU's university reverse proxy fronts public HTTPS, re-encrypts to our server on `:8443` with a self-signed cert), internal nginx for path-based routing, and `pnpm build:release <version>` script that bundles all images into one tarball. The prod server never pulls from Docker Hub — everything travels in the bundle. Public URL: `https://program-landscape.kku.ac.th`. GitHub org: `khon-kaen-university`. Container images: `ghcr.io/khon-kaen-university/program-landscape-<service>:<version>`.
- **Claude skills invoked explicitly.** `frontend-design` for every UI session, `pdf-reading` for ingestion, `pdf`/`docx`/`pptx` for exports. Mapped per prompt in `SKILLS.md`.

## Tips for working with Claude Code

- **Start in a fresh repo.** Don't run prompt 00 inside an existing project.
- **Pin skill invocations in `CLAUDE.md`** so every session inherits.
- **Check git status often.** Have Claude commit at logical checkpoints.
- **When something breaks**, paste the error and ask Claude to diagnose. Don't manually fix — let it debug.
- **Track AI cost.** Use Claude Code session summaries to monitor.
- **Real data swaps**: every connector starts mocked. Plan dedicated sessions to wire real APIs (KKU REG, MHESI-CISA, JobsDB) one at a time.

## Suggested cadence

If you're doing this evenings/weekends:
- **Week 1:** Prompts 00 + 01 + 02 (foundation)
- **Week 2:** Prompts 02b + 02c + 03 + 03b (design system + PDF service + ingestion + PDF intake)
- **Week 3:** Prompt 04 (AI backbone)
- **Weeks 4–7:** One module per week (prompts 05–08, then 09–12 in following weeks)
- **Final week:** Prompt 13, then real data integration

If you have a small team in sprints, parallelize after prompt 04: ingestion connectors / PDF extractors can run alongside module work.

## Real data integration (parallel workstream)

These prompts produce a working system on **mock data**. To make it real for the Council:

1. KKU REG / Finance / HR / Alumni API access
2. MHESI-CISA integration (your existing system)
3. Digital Transcript skill claims wiring (your existing infrastructure)
4. JobsDB / JobThai access agreements
5. Scopus or OpenAlex (free) decision
6. PDF source bulk loading: harvest the last 24 months of MHESI/NESDC/NXPO/BOI publications and run them through the PDF pipeline
7. **Cost model methodology** with Finance Division — likely the longest pole; consider as a Phase 0 effort

## A note on this design

These prompts encode the design choices from our conversation:
- Council-readiness over feature count (provenance, confidence, evidence chains everywhere)
- English UI for the digital team, Thai analysis for the Council
- Light + dark from day one
- Modern SaaS aesthetic (Linear/Vercel/Stripe quality)
- Multi-level analytical scope at every layer
- AI used as a force multiplier, not a decision-maker
- PDF as a first-class input mechanism (Thailand reality)
- Institutional memory built in from the start

If you change strategic direction, update `CLAUDE.md` and `GLOBAL-UPDATES.md` so subsequent sessions inherit the change.

Build something Council can trust.
