# Adopter Guide — Program Landscape

**For a developer or small development team at a Thai university that has just been granted access to this repository and has never seen the codebase before.**

This document is your path *through* the existing documentation, not a replacement for it. Where `docs/` already covers something properly, this guide points at it and tells you what to read it for.

> **ภาษาไทย:** มีฉบับภาษาไทยของคู่มือนี้ที่ [ฉบับภาษาไทย](../th/adopters/README.md)

Written 2026-08-27 against the `main` branch. Where a claim below could drift, the file path is given so you can re-verify it against the code you actually received.

## Read this first

**The single most useful fact for a Thai university adopting this platform:** four of the connectors read **MHESI UniCon national-standard datasets** — the same datasets your institution already submits to the Ministry, in the same schema. Those four are near drop-in. Change the host and database name; do not change the table structure.

| Connector | Dataset | What it carries |
|---|---|---|
| `unicon-ds1001` | DS1001 | Student information, one row per (student × academic year × semester) |
| `unicon-ds2001` | DS2001 | Staff master record — rank, contract, funding source, lifecycle |
| `unicon-ds2003` | DS2003 | Education qualifications of all employees |
| `unicon-ds2004` | DS2004 | Academic staff per programme (curriculum committee membership) |

Verify by reading the header comment of `apps/ingestion/src/connectors/sources/unicon-ds2001/connector.ts` — the source URL, the exact column projection, and the PDPA handling are all documented in the file.

Everything institution-specific — the registrar warehouse, HR, finance, course evaluations, digital-competency scores — is bespoke to KKU's systems and needs rewriting against your equivalents. [Data integration: the four tiers of adoption effort](./data-tiers.md) sorts all 39 catalogued sources into tiers by how much work each one is.

**You do not have to write those connectors before you see results.** Sixteen datasets can be uploaded as Excel spreadsheets from `/admin/data-setup`: your faculties, departments and programmes, then enrolment, finance, graduate outcomes, cohorts, admissions, staff, compensation, budgets, publications, class offerings, programme teaching teams and programme course lists. No code edits are needed. An upload produces the same provenance-stamped rows a connector would, so the dashboards treat both the same way. Most adopters should start there and write connectors later, to automate whatever they find themselves re-uploading. [Importing from spreadsheets](../data-import.md) is the guide.

**Three things to internalise before you start:**

- This is a **decision-support system for high-stakes decisions** — programme closures, mergers, faculty livelihoods. The codebase is built around provenance, audit logging, methodology versioning, and confidence disclosure. Those are not decorations; if you strip them out you have a dashboard that nobody in your Council will trust.
- **There is no mock-data escape hatch by policy.** The project rule is that blocked data sources stay *empty*, not faked. Empty sections render an explicit "no data — run this connector" state. Resist the urge to seed plausible numbers; the whole provenance chain (see [`realDataWhere()`](./traps.md#trap-2-realdatawhere--empty-sections-with-rows-in-the-database)) is designed to catch exactly that.
- **The code is released under CC BY-NC-SA 4.0, which carries real obligations** — attribution, ShareAlike, non-commercial use — and does *not* license KKU's trademarks, the dependency tree, or any KKU data. Read the licence section below before you do anything public with this code.

## Licence — CC BY-NC-SA 4.0

The repository's `LICENSE` file is **Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International (CC BY-NC-SA 4.0)**, with a Khon Kaen University header in front of the verbatim legal code. Copyright © 2026 Khon Kaen University.

**What that means for you, in four obligations:**

- **Attribute.** Credit KKU, name the licence, and link to it, in your repository, your documentation, and any user-visible about/credits screen. The `LICENSE` header gives you the exact string to paste — use it rather than inventing wording.
- **ShareAlike.** If you adapt the work, your adaptation goes out under CC BY-NC-SA 4.0 too, and you must say what you changed.
- **NonCommercial.** You may not use the work primarily for commercial advantage or monetary compensation. What that means for a university is genuinely ambiguous — see below.
- **Leave the notices intact.** Keep the copyright notice, the attribution notice, and the licence notice in anything you redistribute.

**Three things the licence does NOT give you, each of which will catch someone on your team:**

- **KKU's marks are not licensed.** "Khon Kaen University", "มหาวิทยาลัยขอนแก่น", "KKU", the crest, and the logo files in `apps/web/public/brand/` are expressly reserved. Copyright licences do not grant trademark rights, and CC's Section 2(b)(2) says so explicitly. You must remove or replace them in your deployment — [Rebrand the platform](../guides/rebrand.md) is the checklist, and roughly 101 files under `apps/web` mention KKU by name.
- **The dependency tree is not licensed by KKU.** `node_modules`, container base images, and fonts carry their own terms. TH Sarabun New in particular is not in the repository and has its own conditions. Audit before you redistribute.
- **No KKU data comes with the code.** The 297-programme catalogue, student and staff records, and every evaluation result derived from them are outside this release entirely. [Scope and effort](./scope-and-effort.md#what-you-are-not-getting) is the full list.

**On "NonCommercial", read this before you assume.** The term is not defined precisely enough for a university context, and your institution does things that sit near the line: tuition-funded operations, contract research, executive education, paid short courses, spin-offs. KKU has not yet published its own interpretation of the term for this work. **If your intended use is anywhere near that line, get it in writing from KKU's licensing contact before you build on it** — the licensing contact is named at the end of `LICENSE`.

**For your legal office, and KKU's.** CC BY-NC-SA is a *content* licence being used for software. Creative Commons themselves recommend against that. The consequences — no patent grant, no corresponding-source obligation, an undefined ShareAlike boundary for linking, and the NonCommercial ambiguity above — are set out with recommended mitigations in [`docs/licensing.md`](../licensing.md). That document is engineering guidance, not legal advice; treat it as the briefing note you hand your counsel, not the answer.

## What the platform actually is

Program Landscape analyses an entire academic programme portfolio — at KKU, 297 programmes — against future skill demand, financial sustainability, demographic pressure, and peer benchmarks, and presents the result to a University Council in a form defensible enough to close a programme on.

**Eight modules** (all live):

| # | Module | What it answers |
|---|---|---|
| 1 | Portfolio Overview Cockpit | Health heatmap, BCG matrix, rollup tree |
| 2 | Program Deep-Dive | Per-programme shareable scorecard |
| 3 | Future Trends Radar | AI-curated external signal feed |
| 4 | Demand-Supply Gap Analyzer | Labour-market demand vs. graduate production |
| 5 | Strategic Scenario Planner | What-if simulation (sunset, merge, launch, reshape, rebalance) |
| 6 | Competitive Benchmarking | Peer comparison, white-space detection |
| 7 | AI Analyst | Conversational tool-use interface over the same data |
| 8 | Decision Workspace | Decision capture, approvals, outcome review |

**Every analytical surface works at four scopes** — university, faculty, department, programme — with scope in the URL (`?scope=faculty&scopeId=<id>`) so any view is shareable. This is a hard architectural rule, not a convention; see `CLAUDE.md` § *Multi-level analytical scope*.

**Stack**, verified against `package.json` and the workspace manifests:

| Layer | Choice |
|---|---|
| Frontend | Next.js 14 App Router, TypeScript strict (no `any`), Tailwind, shadcn-derived UI, Recharts + inline SVG |
| Backend | NestJS |
| Database | PostgreSQL 16 with `postgis`, `pgvector`, `pg_trgm`, `btree_gin` |
| ORM | Prisma (106 migrations as shipped) |
| Cache / queue | Redis + BullMQ |
| Object storage | MinIO (S3-compatible) |
| PDF output | Gotenberg (headless Chromium) with TH Sarabun New embedded |
| Auth | `next-auth` v5, OIDC SSO; local credentials **dev-only, hard-fails in production** |
| AI | `AiService` abstraction over Google Gemini / Anthropic Claude |
| Tests | Vitest (118 test files, ~1,400 `it()`/`test()` cases), Playwright for e2e |
| Monorepo | pnpm workspaces — `apps/{web,api,ingestion}`, `packages/{shared,db,ui,design,pdf-templates}` |

For architecture beyond this table, read `docs/architecture.md`. For how the scoring modules interlock, `docs/evaluation-pipeline.md` is the cross-module map and is the single most useful document before you change anything that touches more than one module.

## Choose your path

- **Deciding whether to adopt:** read [Scope and effort](./scope-and-effort.md) for what you get, what you do not, and how long each step takes.
- **Installing it:** follow [Getting started](../tutorials/getting-started.md), then [Get Program Deep-Dive working](../tutorials/program-deep-dive.md).
- **Loading your data:** read [Data integration: the four tiers](./data-tiers.md), then [Importing from spreadsheets](../data-import.md).
- **Running it in production:** read [Deploy and size the infrastructure](../guides/deploy.md) and [PDPA and governance](./pdpa-and-governance.md).
- **Changing it:** [Fork and take upstream fixes](../guides/upstream-fixes.md), [How the codebase is laid out](./codebase-layout.md) and [Traps that will cost you days](./traps.md).

## Where did section N go?

This guide used to be one long page with 21 numbered sections. Links into the old sections land on this page; use the table to find where each one went.

| Old section | Now |
|---|---|
| 1. Read this first | this page |
| 2. Licence — CC BY-NC-SA 4.0 | this page |
| 3. What the platform actually is | this page |
| 4. Getting access, forking, and taking future upstream fixes | [Fork and take upstream fixes](../guides/upstream-fixes.md) |
| 5. First run — clone to a working local instance | [Getting started](../tutorials/getting-started.md) |
| 6. How the codebase is laid out | [How the codebase is laid out](./codebase-layout.md) |
| 7. Configuration and environment | [Configuration and environment](../guides/configuration.md) |
| 8. Data integration — the four tiers of adoption effort | [Data integration: the four tiers of adoption effort](./data-tiers.md) |
| 9. The connector contract, and how to write one | [Write a connector](../guides/write-a-connector.md) |
| 10. Programme documents and the AI digest pipeline | [Curriculum documents and the AI digest pipeline](../guides/curriculum-pdfs-and-ai-digest.md) |
| 11. Branding and UI adaptation | [Rebrand the platform](../guides/rebrand.md) |
| 12. Methodologies — adapting the scoring to your institution | [Adapt a methodology to your institution](../guides/adapt-a-methodology.md) |
| 13. The AI layer | [Configure the AI layer](../guides/configure-ai.md) |
| 14. Traps that will cost you days | [Traps that will cost you days](./traps.md) |
| 15. Testing and CI | [Testing and CI](../guides/testing-and-ci.md) |
| 16. Deployment and infrastructure sizing | [Deploy and size the infrastructure](../guides/deploy.md) |
| 17. PDPA and governance | [PDPA and governance](./pdpa-and-governance.md) |
| 18. Extending the platform with Claude Code | [Extend the platform with Claude Code](../guides/extend-with-claude-code.md) |
| 19. What you are NOT getting | [Scope and effort](./scope-and-effort.md) |
| 20. Suggested order of work, with effort estimates | [Scope and effort](./scope-and-effort.md) |
| 21. Appendix — documentation map | Documentation map (use the sidebar instead) |

## Attribution

Program Landscape was built at Khon Kaen University as a decision-support platform for the University Council. This adopter guide describes the codebase as of 2026-08-27 on the `main` branch.

If you adopt it, KKU would benefit from knowing what broke, what you had to rewrite, and what turned out to transfer better or worse than this guide predicted — particularly on the UniCon connectors, where every Thai university's experience is directly comparable.
