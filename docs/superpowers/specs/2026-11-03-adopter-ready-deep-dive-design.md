# Adopter-ready Program Deep-Dive — design

Date: 2026-11-03 · Branch: `feat/generic-adoptor` · Status: draft for owner review

## 1. Intent

Program Landscape was built by KKU and is wired into KKU's internal systems. KMUTT is adopting it,
and will then run a **hands-on workshop** where other Thai universities set it up for themselves.
The goal is an application that is **completely detached from KKU in behaviour**: a fresh install
runs nothing KKU-specific, shows no KKU text, and gets all of its data either from the adopting
university's own spreadsheets or from real public sources.

The first feature to make adopter-ready is the **Program Deep-Dive** (`/programs/:id`), including the
health score breakdown and health radar.

**Workshop success (owner):** each attendee, on their own laptop (Windows or Mac, Docker installed),
with their own AI key and their own exported data, follows the tutorial to set the app up locally,
loads their data, pulls the public data, and ends with **every section of the deep-dive for one of
their programmes showing data**.

## 2. Decisions made by the owner

| # | Decision |
|---|---|
| O1 | Institution-specific data (e.g. student satisfaction, digital competency) is uploaded from **XLSX** via the admin UI (an API pull may come later). |
| O2 | Public/external data is **pulled from the internet** where a source exists. If the pull needs a credential, the key goes in `.env.example`. If no usable public source exists, it is **uploadable from a spreadsheet**. |
| O3 | Publications: **both** — the existing XLSX dataset and a pull from OpenAlex. |
| O4 | "Verified" means **every deep-dive section shows data**. |
| O5 | A **per-programme setup checklist** is built and is the workshop's sign-off. |
| O6 | Tutorial and adopter docs in **Thai and English, side by side**. |
| O7 | KKU-specific code (connectors, seed, org reference) **stays in the repo as optional examples, switched off by default**. Not deleted. |
| O8 | Test end-to-end in a **separate fresh database**; the current dev database stays untouched. |
| O9 | Test target: KMUTT **B.Eng. Mechanical Engineering** (programme code `2514001`) using `/kmutt-data` (gitignored). Only this programme's curriculum PDF is available; the spreadsheets cover almost all KMUTT programmes. |
| O10 | Extra worksheets in an upload are ignored by the importer (owner-confirmed); `/kmutt-data` files are not modified. |
| O11 | The KMITL Skill Mapping key already configured is KMUTT's, and attendees can obtain their own (for now). KMITL stays the **primary** skill-demand path; the spreadsheet is the fallback. |
| O12 | No human Thai review before the workshop: Thai pages must be **safe without review** (see 7.5). |

## 3. Goals

1. A fresh clone → setup → `/setup` wizard install contains **no KKU data and runs no KKU job**.
2. Every input the deep-dive reads has a non-KKU path: an XLSX dataset, a public pull, or both.
3. A setup checklist per programme tells the attendee which section is empty, what it waits on, and
   links to the fix.
4. The deep-dive path (deep-dive page, its print page, sign-in, setup, data-setup, programme admin)
   shows the adopter's organisation name, never "KKU".
5. A verified, bilingual tutorial that a workshop attendee can follow start to finish.
6. Proven on KMUTT Mechanical Engineering in a fresh database: all checklist items green.

## 4. Non-goals

- Other modules (Cockpit, Gap Analyzer, Scenarios, Benchmarking module, Analyst, Decisions) beyond
  what the deep-dive needs. Shared code they use may change; their KKU text may stay for now.
- Production deployment for adopters (`DEPLOYMENT.md` stays KKU's runbook; a pointer is enough).
- Live API pulls of institution-specific data (O1 — later).
- Removing KKU code (O7).
- Renaming the internal `@kku/*` package scope.

## 5. Anti-goals (would make this a failure even if it "works")

- A section that shows data because **mock or seed** rows leaked in. "Green" must mean real data
  the adopter loaded or pulled. Mock connectors must never make a section or checklist item green.
- A fresh install that silently starts scraping or calling anything the operator did not turn on.
- A tutorial step that was never actually run.
- Any PII from `/kmutt-data` in docs, screenshots, commits, fixtures or chat (org PII policy).
  Screenshots in docs must not show staff names next to employee codes.
- Breaking KKU's own production behaviour. KKU must be able to keep running its connectors by
  turning them on.

## 6. Constraints

- Everything in `CLAUDE.md`: no `any`, Zod at I/O, `@AuditLog()` on mutations, `@AiCall()` on AI,
  provenance + freshness on charts, design tokens only, cross-platform scripts, methodology
  versioning (a formula change bumps the methodology version and updates `docs/methodologies/`).
- The XLSX import framework's existing rules (`docs/data-import.md`, decisions log): one declaration
  per dataset in `packages/db/src/import/datasets/`, an `xlsx-<slug>` catalogue entry per dataset
  (so `realDataWhere()` sees the rows), refuse unknown columns, national-ID scan, group-size floor
  on headcount-like columns, upsert by default, start-over per dataset.
- Docs-site rules: `pnpm docs:build` must pass (dead links, retired names).
- Dev-safety guard blocks destructive DB commands; the fresh test database is created alongside the
  existing one (e.g. `program_landscape_adopter_test`), never by resetting the current one.

## 7. Work streams

### 7.1 Detach a fresh install from KKU (behind switches, per O7)

Found in recon (file references in the session notes; builder should re-verify):

- **Scheduling.** On `pnpm dev` the ingestion scheduler registers every catalog source with a cron,
  including all KKU internal connectors (run as mocks that record fake SUCCEEDED runs and bump
  `lastSyncedAt`), four slugs with no registered connector (`the-rankings`, `qs-rankings`,
  `scimago`, `thailand-demographics` — throw every run), and public scrapers enabled in
  `.env.example` with no operator opt-in.
  **Want:** on a fresh install nothing is scheduled until an operator turns it on (per source, in
  the admin data-source page, audited). KKU connectors are marked as KKU examples and stay off.
  Slugs without a connector are not scheduled. Mock connectors no longer write SUCCEEDED runs that
  make a source look synced (either they are not runnable outside test/dev-with-mocks, or their
  runs are clearly marked and excluded from freshness). KKU's production keeps working by turning
  its sources on — builder decides the mechanism (catalog flag, env, or DB setting) and documents
  how KKU re-enables.
- **Seeding.** `pnpm db:reset` still runs the KKU seed (org tree, `@kku.ac.th` users incl. a
  SUPER_ADMIN, KKU SSO mappings), which also closes `/setup`. **Want:** the default seed path seeds
  nothing institution-specific; the KKU seed is an explicit opt-in (`SEED_KKU=1` or a separate
  script). Generic reference data (skill taxonomy, sectors) may stay in a generic seed if the
  deep-dive needs it — builder decides, but nothing KKU-named.
- **Migration data.** `recruitment_program_overrides` gets one KKU row from a migration. Make it
  harmless for adopters (it matches no adopter programme; at minimum confirm and document).
- **Pipeline phase 4** (`link-program-cohorts/alumni/financials`) only talks to KKU Oracle/MSSQL.
  **Want:** skipped with a clear "not configured — use the XLSX datasets" reason when its env is
  absent, not failed; the checklist and pipeline UI must not show it as a failure.
- **Hard-coded KKU behaviour in scoring:**
  - `demographic_resilience` uses region `'Northeast'` → use the organisation profile's region
    (`OrganizationProfile.regionEn`), national when unset.
  - Capability `student_faculty_ratio` strictness band keys on KKU faculty codes → make it data-
    driven (e.g. use the existing `Faculty.kind` or a new faculty attribute in the faculties
    dataset); KKU's mapping preserved.
  - Ranked-university "Thai tier" defined relative to KKU → relative to the adopter's own ranked
    row (or configured rank), falling back sensibly when unranked.
  - `jobthai.ts` hard-codes province `ขอนแก่น` as "local" → organisation's province/region.
  - Each of these is a methodology change: bump the version, update the methodology doc.
- **Text.** Replace "KKU"/"มข." on the deep-dive path with the organisation's short name from
  `OrganizationProfile` (breadcrumb, "Competition vs KKU", "KKU min score", intake-floor copy,
  "Same-level KKU programmes", print page "internal KKU use", empty states naming KKU views or
  connectors — those should point to the XLSX dataset or the public connector instead). Sign-in:
  no pre-filled `admin@kku.ac.th`, no KKU dev-account list on a fresh install, SSO button labelled
  from config, contact mailto from `OrganizationProfile.contactEmail`. `/admin/data-setup`,
  `/admin/programs`, `/programs` copy ("297 KKU programs"). Other modules' KKU text is out of scope.
- **`.env.example`.** Generic defaults (DB user/password, dev password), KKU blocks grouped under a
  clearly labelled "KKU example connectors (off)" section, stale/mismatched SSO keys fixed (code
  uses `KKU_SSO_WEB_BASE/...`, example declares `KKU_SSO_ISSUER/...`). New external keys added
  (7.3).

### 7.1b Seeds, classified (owner asked, 2026-11-03)

Every seed was classified (recon notes in session). `pnpm setup` runs no seed today; only
`pnpm db:reset` runs `prisma/seed.ts`. **Want:** seeds split by purpose, each with its own explicit
command, and the tutorial runs exactly the ones an adopter needs.

| Seed | Class | Target |
|---|---|---|
| KKU faculties (24), departments (12), `@kku.ac.th` users incl. SUPER_ADMIN, `kku_org_code_mappings` (unread), KKU skill taxonomy (~60), `programs:seed-from-sheet`, `hr:`/`registry:seed-mappings`, `org:seed-kku` | KKU | KKU-only seed command, opt-in, never run by setup or the tutorial. |
| 500 synthetic skills (currently **always** seeded), `SEED_MOCKS` content (programmes, metrics, job postings, peer sets, scenarios, decisions), "NESDC-v1" demographics (32 synthetic rows) | MOCK | Mock/demo seed only, for dev and tests. Never on a fresh adopter install. |
| BCG / S-curve sectors (8, Thai policy; `demandMultiplier` hand-picked) and skill→sector tagging | UNIVERSAL (Thailand) | Generic reference seed run by setup (or the tutorial); tagging re-run after skills are built from the adopter's own curricula. Multipliers documented as a judgement. |
| `demographics:seed` (NESDC 2010–2040 edition anchors, 5 regions × 3 cohorts, 2020–2045) | UNIVERSAL (Thailand), aging | Kept as an optional "Thailand starter" load with its edition stated; the primary paths are the population pull + spreadsheet (7.3). Without any of them the demographic outlook and `demographic_resilience` are empty. |
| `peers:seed-universities` (QS/THE 2025, ~57 rows, KKU-relative Thai tier) | UNIVERSAL, aging | Shipped as a starter workbook for the ranked-universities dataset (7.3) instead of a hard-coded list; Thai tier anchored on the adopter (7.1). |
| Cost methodology 'v1' (KKU wording), `academic_year.next_start_date` = 2026-06-16, external AI sources (6, PAUSED) | CONFIG | Generic reference seed with neutral wording; the academic-year start becomes a value the adopter sets (organisation settings or the tutorial), not a fixed 2026 date. |
| `skills:seed-automation-risk`, `risks:seed-measures`, `scenarios:seed-templates`, `imd:seed` | UNIVERSAL logic | Unchanged; run after their inputs exist. Only automation-risk matters near the deep-dive; tutorial runs it after skills are built. |
| AI model catalog (self-seeds at runtime), data-source catalog sync (setup), `mv_refresh_log` rows (migration) | CONFIG | Unchanged. |
| Migration rows: one KKU `recruitment_program_overrides` row; `ds_jobthai` with owner "KKU Data Office" | KKU leak | Made inert for adopters (no match) and owner text neutral via catalog sync; covered by the D9 test's allowlist. |

Also: docs that still tell people to run `db:seed` (`README.md`, `docs/data-sources.md`,
`docs/migration-policy.md`) are corrected.

### 7.2 New XLSX datasets for institution-specific data

Each one: declaration + `xlsx-<slug>` catalogue entry + template + guide sheet + reader wired so the
deep-dive section and the health driver read it with `realDataWhere()` + start-over + docs entry
+ tests (including the "upload → deep-dive shows it" end-to-end assertion the earlier phases used).

| Dataset (working name) | Feeds | Notes |
|---|---|---|
| Course evaluations | `student_satisfaction` driver; Outcomes | Existing table `evaluation_response_summaries` is KKU-registrar-shaped (many NOT NULL registrar ids). Builder decides: relax/derive those columns, or a new adopter-shaped table the driver also reads. Grain my suggestion: course code × academic year × semester × average rating (scale stated) × respondents, joined to the programme via `program_courses` as today. Group-size floor on respondents. No instructor identity. |
| Digital competency results | `dq_digital_competency` driver; Digital competency section | Mirrors `dq_student_cube`: programme × cohort entry year × students tested × with scores × passed. Name it generically ("digital competency test") — the test may not be DQ. Bachelor-only rule unchanged. |
| External grants (projects + team) | Financial grant award | Mirrors `research_service_projects` / `_members`: project id, title, type (research / academic service), fiscal year, budget, funder; team rows by employee code + role. Probably two sheets or two datasets — builder decides. The award's "source synced once" check must accept the XLSX source. No citizen ids. |
| Employer feedback | Outcomes section | `employer_feedback` has no writer. Programme × year × satisfaction score × sample size; employer names optional (aggregate rows allowed). Group-size floor. |
| Staff salary by funding | Financials "salary by funding" | Reads `staff_compensation_cube` (KKU HR), not `faculty_compensation` (existing XLSX). Builder decides: extend the existing compensation dataset to feed this reader, or a new dataset. Headcount floor ≥ 5 as today; never per-person salary. |

### 7.3 External / public data (O2)

| Need | Pull | Credential → `.env.example` | Spreadsheet fallback |
|---|---|---|---|
| Youth population projections | National: UN World Population Prospects (data-portal API with token, or bulk CSV without) | `UN_WPP_TOKEN` (optional) | Yes — region/province projections dataset (no machine-readable Thai regional projection found). Region matches the organisation profile region. |
| Skill demand (labour-market & strategic-sector alignment, skills coverage) | KMITL Skill Mapping API (already exists) | `KMITL_SKILL_MAPPING_CLIENT_ID/SECRET_KEY` (exists; document how to request from KMITL) | Yes — career × skill demand dataset in the shape `kmitl_career_skill_demand` holds, so a university without credentials can still fill these drivers. |
| Job postings (JobThai alignment) | JobThai: no public API; existing connector takes hand-delivered files | — | Yes — the JobThai XLSX upload must be doable from the admin UI (verify; today files go to MinIO). job-108 (public government jobs) stays a pull, opt-in. |
| TCAS admission stats | Existing public connector (mytcas assets) | — | Keep URL list; document adding a year. Ensure it works for any Thai institution name. |
| University rankings (peer selection) | SCImago Institutions Rankings downloads (public) where feasible | — | Yes — ranked-universities dataset (QS/THE have no public data). Replaces the static KKU-relative seed for adopters. |
| Publications (O3) | OpenAlex by the adopter's institution id (new field on the organisation profile; e.g. KMUTT `I60837268`), author matching via staff records, writing `research_outputs` stamped with a real ingestion run | `OPENALEX_MAILTO` | Existing `research-outputs` dataset. Builder decides dedupe between the two (DOI first). |
| Graduate outcomes | No per-programme public source | — | Existing dataset (already covered). |

Research notes behind this table are in the session; items marked unverified there (UN token
process, SCImago terms) must be checked before building.

### 7.3b Curriculum PDFs in other universities' formats (owner, 2026-11-03)

Each university's curriculum document (มคอ.2 / TQF2 or its successor) differs in layout, section
headings, course-code shape (KKU `000101`, KMUTT `MEE 221`) and language mix. Today phase 2b
(courses) locates the รายวิชา section and course codes with KKU-shaped regexes and refuses the KMUTT
PDF; other PDF phases (digest, faculty roster, skills, pedagogy, PLOs) are AI over the text but may
still lean on KKU headings or code patterns.

**Want:** every PDF-driven pipeline phase works on a reasonably formatted curriculum PDF from any
Thai university, without per-university code. Builder audits each PDF phase for KKU-specific
assumptions (section anchors, code regexes, page-range heuristics, prompt examples) and replaces
them with structure-agnostic handling (e.g. AI-located sections, code-shape inferred from the
document). Prompt changes bump their prompt versions. Where a phase still cannot extract reliably,
it degrades with a clear reason and the checklist points to the spreadsheet fallback (course lists
already have one; staff roster has `program-faculty`). Proven on the KMUTT `2514001` PDF; a
non-KKU sample in tests must not contain real people's names.

### 7.4 Per-programme setup checklist (O4, O5)

- One row per deep-dive section **and** per health-score driver, each with status (has real data /
  empty / not applicable for this level), what it waits on (dataset slug, connector slug, pipeline
  phase, organisation setting, or "needs another programme" for overlap), and a link to the fix
  (template download / upload page, data-source page with Run now, pipeline run, org settings).
- "Has data" uses the same queries the section uses (including `realDataWhere()`), so green on the
  checklist means the section really renders data.
- Not-applicable items (e.g. digital competency for postgraduate, TCAS for postgraduate) are shown as
  N/A, not red, so "all green" is reachable.
- Lives where an admin finds it from the programme — builder decides (programme admin tab, or a
  panel/link on the deep-dive visible to admins/analysts). Respects scope/RBAC.
- Also serves as the tutorial's last step.

### 7.5 Documentation (O6)

- **Bilingual pages, side by side** — builder decides the mechanism (paired `.th.md` pages with a
  language switch, or two columns), but both languages must render on the docs site (today
  `adopters/README.th.md` is excluded) and stay in sync (a check that paired pages exist).
- **Rewrite and verify:**
  - Getting started (fresh checkout → `/setup`), merged/aligned with `guides/fresh-checkout-setup.md`
    and the adopter guide (they disagree on time budget, `DEV_AUTH_PASSWORD`, markitdown port).
  - Program Deep-Dive tutorial in the order that actually works: organisation profile → faculties →
    departments → programmes → staff → programme staff → metrics datasets → course lists → public
    pulls (TCAS after the org profile; then re-check match count) → curriculum PDF → AI key →
    pipeline → checklist all green. Includes TCAS Thai-spelling rule where faculties/programmes
    are created, data-source switches, cost estimate per programme.
  - `docs/data-import.md`: new datasets, slugs, raw-data URLs, year-era rules, gen-ed prefix note
    (GE/LI/00 is KKU-specific → use Category).
  - `.env.example` keys explained, including how to obtain each external credential.
  - KKU registrar connector tutorial kept, labelled "advanced / optional, KKU example".
- **Thai written to be safe unreviewed (O12):** plain, short sentences; terms taken from
  `docs/glossary-th-en.md`; UI labels, commands, file names, column headers and env keys kept
  verbatim in English (the UI is English-only); each Thai page mirrors its English page section by
  section so a reader can always cross-check; no Thai-only content; a check that paired pages have
  the same headings count and identical code blocks.
- **Workshop pack:** a short facilitator page (agenda, prerequisites to send in advance, common
  failures and fixes found during the KMUTT run).
- Every step in the tutorial is executed during the KMUTT verification (7.6); fixes found go back
  into the docs.

### 7.6 Verification on KMUTT Mechanical Engineering (O8, O9)

- Fresh separate Postgres database (+ separate MinIO bucket prefix or buckets if needed); the
  current dev DB untouched.
- Follow the tutorial literally, using `/kmutt-data` files and the `2514001` PDF.
- Pull TCAS, demographics, skill demand (KMITL key in `.env` if valid for KMUTT; otherwise the
  spreadsheet fallback), OpenAlex publications.
- Run the AI pipeline for `2514001` (expected ≈ USD 1 on the configured provider).
- Done when the checklist for `2514001` is all green or N/A, every deep-dive section shows data, and
  the tutorial needed no undocumented step. Datasets KMUTT has no file for (e.g. evaluations,
  digital competency, grants, employer feedback, salary by funding, demographics region, rankings)
  are tested with a **synthetic test workbook** generated by the builder — clearly fictional values,
  no real people — kept out of git if derived from KMUTT data.
- Record what was run and the result in the decisions log.

## 8. Calls made by the designer (not the owner) — check these

| # | Call |
|---|---|
| D1 | **Existing installs keep their schedules.** "Off by default" applies to sources a fresh install has never run. The upgrade must not stop KKU's live syncs: a source with a real successful run (or explicitly enabled) stays enabled. KKU's release notes say how to switch the KKU examples on for a new KKU install. |
| D2 | **Mock connectors stay for KKU dev and tests**, behind an explicit mock flag; a fresh adopter install never schedules them. Mock runs are excluded from freshness and `lastSyncedAt` (and from the checklist). Old mock run rows are excluded by query, not deleted. |
| D3 | **KKU scores must not move.** Where a hard-code becomes an organisation setting (region, local province, Thai tier anchor), an unset setting falls back to national/neutral for adopters, and KKU's profile is set (or backfilled at deploy) to today's values so its scores are identical. The methodology version still bumps and the doc records "no change for KKU". |
| D4 | **Faculty strictness for the student:faculty ratio** becomes a new **optional** column on the faculties dataset (existing `Faculty.kind` is ACADEMIC/ADMIN/INSTITUTE/RESEARCH_CENTER, a different idea). Default when blank = today's default band. Bands themselves stay in code, not adopter-tunable. |
| D5 | **Do not relax KKU-shaped live tables.** Course evaluations and salary-by-funding get adopter-shaped tables (or adopter rows that fit without touching KKU's NOT NULL columns); readers take both sources, the way publications already do. Precedence when both exist for one programme-year: the source KKU-or-adopter configured as primary — in practice only one exists per install. |
| D6 | **A pull that turns out unusable is dropped for its spreadsheet fallback** (rule O2). The workshop never blocks on an unverified pull; every external need in 7.3 has a spreadsheet path, so "all green" is always reachable. |
| D7 | **Overlap** counts as green when the programme has a course list and at least one same-level sibling with a course list exists; if the institution has no such sibling it is **N/A**, not red. KMUTT's course-list workbook covers many programmes, so the test run should reach green. |
| D8 | **Degraded AI output counts as green when the section renders content**, and the checklist shows a "degraded — reason" note. No new per-attendee cost cap beyond the existing AI quota; the tutorial states the expected cost per programme. |
| D9 | **A CI test guards the fresh-install promise**: after migrate + default seed + data-source sync, no KKU-named rows except the documented migration row (7.1), and no source scheduled. Plus the docs-site build covers Thai pages (links, retired names, paired-page check). |

## 9. Left to the builder

Mechanisms marked "builder decides" above; table design for the new datasets within the stated
grain; checklist placement and UI; the switch mechanism for KKU connectors; docs language-switch
mechanism; order of work; test structure. Follow existing patterns (import framework, connector
registry, data-source admin page) rather than inventing new ones.
