# KKU Curriculum Intelligence Platform — Program Landscape

**User manual — v1.0 · 2026-04-24**

This manual covers every role that uses the application, the features each can reach, and — for administrators — the end-to-end workflow for processing input documents and managing the data pipeline.

---

## Table of contents

1. [What this application is](#1-what-this-application-is)
2. [Who uses it — roles at a glance](#2-who-uses-it--roles-at-a-glance)
3. [The eight modules](#3-the-eight-modules)
   - 3.1 [Analytical surfaces added since the original eight](#31-analytical-surfaces-added-since-the-original-eight)
   - 3.2 [Reading Student DQ](#32-reading-student-dq)
   - 3.3 [Education surfaces](#33-education-surfaces)
   - 3.4 [Staff surfaces](#34-staff-surfaces)
   - 3.5 [Risk surfaces](#35-risk-surfaces)
4. [Getting started (every user)](#4-getting-started-every-user)
5. [Common UI patterns](#5-common-ui-patterns)
6. [Role-by-role guide](#6-role-by-role-guide)
   - 6.1 [Viewer](#61-viewer)
   - 6.2 [Council member](#62-council-member)
   - 6.3 [Executive](#63-executive)
   - 6.4 [Dean (faculty head)](#64-dean-faculty-head)
   - 6.5 [Department head](#65-department-head)
   - 6.6 [Analyst (institutional researcher)](#66-analyst-institutional-researcher)
   - 6.7 [Administrator](#67-administrator)
7. [Admin — document & data processing](#7-admin--document--data-processing)
   - 7.1 [Upload & PDF intake](#71-upload--pdf-intake)
   - 7.2 [PDF review queue](#72-pdf-review-queue)
   - 7.3 [AI extraction review](#73-ai-extraction-review)
   - 7.4 [Data-source management](#74-data-source-management)
   - 7.5 [PDF generation (outgoing)](#75-pdf-generation-outgoing)
   - 7.6 [Provenance, audit & AI governance](#76-provenance-audit--ai-governance)
   - 7.7 [Submitting a new or revised curriculum](#77-submitting-a-new-or-revised-curriculum)
   - 7.8 [Curriculum revisions — staging, review, going live](#78-curriculum-revisions--staging-review-going-live)
8. [Requirements reference](#8-requirements-reference)
9. [Troubleshooting](#9-troubleshooting)
10. [Glossary](#10-glossary)

---

## 1. What this application is

Program Landscape is the program-portfolio module of the **KKU Curriculum Intelligence Platform**. It analyses all 297 academic programs of Khon Kaen University against eight strategic questions:

1. Which programs are **strategically critical** to KKU's mission and Thailand's future?
2. Which are **financially unsustainable** at current trajectory?
3. Which are **misaligned with future skill demand** (1 / 5 / 10 years out)?
4. Which **duplicate** each other across faculties and could be consolidated?
5. Where are the **white spaces** — programs we should launch but haven't?
6. Which are at **quality / relevance risk** (aging faculty, outdated curriculum)?
7. What is the **demographic ceiling** on each program given Thailand's shrinking youth cohort?
8. How does each program **compare to peer institutions** (Thai, ASEAN, global)?

The audience is the University Council, top management, deans, department heads, and analysts. Every number you see is auditable back to its source; every AI output is logged, confidence-scored, and reviewable.

---

## 2. Who uses it — roles at a glance

The system defines **seven roles**. Each role has a fixed set of permissions — you do not need to ask for access to individual screens, your role determines what you see.

| Role | Typical user | Primary job in the app |
|---|---|---|
| **Viewer** | Secretariat staff, read-only observers | Browse program directory, read public analytics |
| **Council** | University Council member | Review briefs, approve/reject decisions, export Council Packs |
| **Executive** | President, Vice-Presidents, senior officers | Everything Council does + author scenarios + edit decisions |
| **Dean** | Faculty dean | Full view of own faculty; read-only of others; upload faculty PDFs |
| **Department head** | Department chair | Full view of own department; read-only of siblings; upload PDFs |
| **Analyst** | Institutional research office | Runs the data pipeline, reviews AI extractions, maintains scenarios |
| **Admin** | System administrator | Everything above + user / SSO / data-source configuration |

**Scope awareness** — four levels: *University → Faculty → Department → Program*. Switch via the **scope pill** in the top bar (`?scope=faculty&scopeId=<id>` in the URL — shareable). Your role controls which scopes you can switch into.

**Confidentiality**
- Council members see **aggregated** financial + faculty-member numbers, not per-individual salary lines or names.
- Deans see their own faculty's detail; other faculties roll up to aggregates only.
- Department heads see their own department's detail only.

---

## 3. The eight modules

Each module has its own signature colour in the sidebar — learning the colours makes the app easier to navigate.

| # | Module | Colour | URL | What it answers |
|---|---|---|---|---|
| 01 | **Portfolio Cockpit** | Indigo | `/cockpit` | "Where is every program today?" Heatmap, BCG matrix, rollup tree. |
| 02 | **Program Deep-Dive** | Violet | `/programs/<id>` | Per-program scorecard — 10 sections including financials, skills, faculty, peers, trends. |
| 03 | **Trends Radar** | Amber | `/trends` | External signals (policy, research, market, tech) with impact on programs. |
| 04 | **Gap Analyzer** | Teal | `/gap-analysis` | Demand-first field map: one row per field of study employers ask for — private-sector JobThai adverts and, since `gap-map.v2`, public-sector job-108 government announcements, blended by default — KKU's share of graduates against the market's share of adverts, and a verdict per field (`gap-map.v2`). |
| 05 | **Scenario Planner** | Emerald | `/scenarios` | What-if simulation: close program X, merge Y with Z, launch new curriculum. |
| 06 | **Benchmarking** | Cyan | `/benchmarking` | Peer comparison (Thai / ASEAN / global) and white-space detection. |
| 07 | **AI Analyst** | Rose | `/analyst` | Conversational interface; asks questions in Thai or English. |
| 08 | **Decision Workspace** | Cardinal | `/decisions` | Captures Council decisions and tracks outcome reviews. |

Supporting surfaces: `/skills` (skill explorer), `/inbox` (notifications), `/styleguide` (component catalog), and the admin area under `/admin/*`.

### 3.1 Analytical surfaces added since the original eight

The eight modules above are the original architecture. The application has since grown several
surfaces that sit alongside them rather than inside them. These are the ones most likely to be new
to you:

| Surface | URL | What it answers |
|---|---|---|
| **Student DQ** | `/education/student-dq` | How KKU undergraduates actually score on the university's Digital Intelligence competency test, drillable from faculty down to a single programme, with a column per module. |
| **Digital Competency Attainment** | `/education/digital-competency` | What students *measurably score* on the digital competencies the labour market asks for — measured attainment, not taught coverage. |
| **Curriculum revision** | section on `/programs/<id>` | What a newly submitted มคอ.2 changes relative to the curriculum it replaces. Also appears in the programme's PDF report. |

Three whole families now sit alongside the eight modules — **Education** (§3.3), **Staff** (§3.4)
and **Risk** (§3.5). Section 3's first table should be read as the architectural spine rather than a
map of the sidebar.

### 3.2 Reading Student DQ

Student DQ is measured data from a real test, not a model output, and it has counting rules that
will mislead you if you do not know them.

**The framework.** KKU's Digital Intelligence competency framework (LTIC) defines **13 theory
modules** across four domains — Essential Computer (1–4), Essential Software (5–8), Technology at
Work (9–12), and Generative AI (13) — plus **4 workshop modules**, which exist only for the
Essential Software modules 5–8. The **pass mark is 70**.

**Four rules that change how a number reads:**

| Rule | Why it matters |
|---|---|
| **A score of 0 means the module was NOT TAKEN**, not "scored zero" | Zeros are excluded from every mean. A module average is over the students who actually sat it, so the sample behind two adjacent columns can differ. |
| **Cells with fewer than 6 scored students are withheld** | Small-cohort suppression. A blank cell means "too few students to report", never "scored badly". |
| **Undergraduate only** | Master's and doctoral programmes have no DQ row at all. Their absence is not a data gap. |
| **"Program not identified"** is a real bucket | Students who could not be resolved to a programme are shown under this label rather than dropped. Its size is cohort-shaped — recent intakes resolve well, older ones much less so, because the resolution table is a current enrolment snapshot while the test export is cumulative. Read faculty totals with that in mind. |

**Faculty and university figures are true weighted means**, computed from score sums and take
counts — not an average of programme averages. Module 13 (Generative AI) carries no Thai label
because the supplied revision of the framework document does not define one.

### 3.3 Education surfaces

**Hub** — `/education`. Everything about students: who they are, where they came from, what they
score, what they pay, and what they say about their courses.

| Surface | URL | What it answers |
|---|---|---|
| **Student info** | `/education/student-info` | Headcount across demographic and recruitment facets. Defaults to currently-enrolled; switch to incoming or former groups, or pick a specific status code. |
| **Active students by entry year** | `/education/active-pivot` | Currently-enrolled students by entry year (columns) against Faculty → Programme Level → Programme (rows). |
| **Student by location** | `/education/location` | Where current students went to school — by school name, province, and Thailand region. |
| **International students** | `/education/international` | Currently-enrolled non-Thai students by country of origin and programme. |
| **Student performance** | `/education/performance` | Undergraduate GPAs and entry test scores, with a Faculty → Programme drill-down, a deeper Region → Province → School view, and a per-subject score pivot. |
| **Student DQ** | `/education/student-dq` | Digital Intelligence competency results — **read §3.2 before interpreting this one.** |
| **Student evaluations** | `/education/satisfaction` | What students said about their **courses**. Drill from faculty down to a single course; hover a course name for its per-question scores. |
| **Subject offerings & fulfilment** | `/education/class-offerings` | One row per class section the registrar opened. |
| **Actual recruitment campaigns** | `/education/recruitment-campaigns` | One row per campaign track (competency / language / exam option / quota type / branch-campus intake) within a programme × round × year. |
| **Tuition fee incomes** | `/education/tuition` | Tuition revenue by year, faculty, and semester. |

**Two things that routinely confuse people here:**

- **Course evaluations and instructor evaluations are different screens.** `/education/satisfaction`
  is course-level and carries no instructor names. Per-instructor scores live on
  `/staff/teaching`. If you are looking for "how did this teacher rate", you are on the wrong page.
- **Recruitment campaigns: the current cycle stays informational.** Headline metrics use the latest
  *completed* cohort, so an in-flight admission round will not move them. That is deliberate — a
  half-finished round would otherwise read as a collapse in demand.

### 3.4 Staff surfaces

**Hub** — `/staff`. Who works here, what they are paid from, what they teach, and what they publish.

| Surface | URL | What it answers |
|---|---|---|
| **Who works here** | `/staff/workforce` | Headcount, age, tenure, retirement timeline, and the past year's hires and departures. |
| **Salaries and funding** | `/staff/compensation` | Where each person's salary comes from and the income mix per faculty. |
| **Programmes and their staff** | `/staff/faculty-by-program` | Drill from each faculty into its programmes to see who teaches there, with under-staffed programmes flagged. |
| **Teaching evaluations** | `/staff/teaching` | How students rate each **teacher**. Faculty → degree level → programme → teacher; hover a rating cell for the question-by-question breakdown. |
| **Teaching and learning talent** | `/staff/teaching-talent` | Instructors students rate highly *year after year*. |
| **Teaching workload** | `/staff/teaching-workload` | Contact hours per teacher per week. |
| **Research and publications** | `/staff/research` | All KKU staff publications from the internal `kku-publications` mirror — Scopus + PubMed authorships, drilled by faculty / author / year / type / venue. |

**Rules that change how these numbers read:**

| Rule | Where | Why it matters |
|---|---|---|
| **Individual salaries are never shown** — only buckets of **5 or more** people | Salaries and funding | A missing bucket means too few people to report, not zero spend. |
| Every programme needs at least **5 อาจารย์ผู้รับผิดชอบหลักสูตร**; shortfalls are flagged | Programmes and their staff | The flag is a regulatory staffing threshold, not a quality judgement. |
| A "talent" cleared the bar in **every one of the last three completed academic years** | Teaching and learning talent | Sustained quality, not one good semester. Curriculum mapping does not gate the list — an instructor qualifies on their evaluations alone. |
| Includes **retired and former staff** | Research and publications | This is historical-output measurement. Programme-scoring views (health score, lifecycle) count only *active* staff, which is why the two disagree. That is expected, not a bug. |

`/staff/publications` is a permanent redirect into `/staff/research`; old links keep working.

### 3.5 Risk surfaces

**Hub** — `/risks`. Likelihood × impact scoring of every undergraduate programme, driven by
recruitment data, AI-disruption exposure, and the demographic ceiling. Recommendations are
programme-specific rather than generic category advice.

| Surface | URL | What it answers |
|---|---|---|
| **Risk management** | `/risks` | The ranked programme list and its scoring. |
| **Risk profile** | `/risks/<id>` | One programme's full risk picture. |
| **Drivers** | `/risks/drivers` | The three external drivers feeding the engine — so Council can challenge the *inputs*, not only the outputs. |
| **Key risk indicators** | `/risks/indicators` | Each KRI evaluates one specific aspect of programme risk; the breach list drills into the affected programmes. |
| **Likelihood × impact matrix** | `/risks/matrix` | Two views of one dataset — a BCG-style bubble plot (X = composite likelihood, Y = log-impact, bubble size = THB at risk) and the institutional ERM 5×5 heatmap. |

**Undergraduate programmes only.** Postgraduate programmes are out of scope for this engine, so
their absence from the matrix is not a data gap.

**`/risks/drivers` is the page to open when someone disputes a score.** It exists specifically so a
challenge can be aimed at an input assumption rather than at the ranking, which is a much more
productive argument to have in a Council meeting.

---

## 4. Getting started (every user)

### 4.1 Signing in

1. Go to `https://program-landscape.kku.ac.th` (or `http://localhost:3000` in dev).
2. Choose one of:
   - **KKU SSO** (production): use your university email and SSO credentials.
   - **Developer Login** (dev environment only): fill in email + password. Default dev password is `kku-dev`.

If sign-in fails, the cause is almost always your account not yet having a role assigned — contact the administrator.

### 4.2 Your first minute

- The **sidebar** (left, dark) is home. Click a module tile to open it. Your current scope and module stay reflected in the URL so you can bookmark or share.
- The **top bar** (slim, light) carries: breadcrumb · scope pill · search · notifications · your user menu.
- Press **⌘K / Ctrl+K** to open the **command palette** — jump to any program, scenario, or decision by name.
- Press **?** to see the keyboard shortcut sheet.

### 4.3 Changing scope

Click the **scope pill** at the top. Pick *University / Faculty / Department / Program*. Every chart, every metric, every AI output on the page re-queries against the new scope. Some options are greyed out if your role doesn't cover that scope.

### 4.4 Language

- **Interface labels** (buttons, menus, headers) are English-only.
- **Analysis text** (AI narratives, briefs, summaries) is Thai by default with an English translation toggle where available.
- **Data labels** (program names, faculty names) are shown in both Thai and English.
- Exports (Council Pack PDFs, briefs) default to Thai with optional English appendix.

### 4.5 Theme

User menu → **Theme** → Light / Dark / System. Saves to your profile and persists across sessions. All charts, tables, and maps re-render cleanly when you switch.

---

## 5. Common UI patterns

These appear across every module — learning them once saves time everywhere.

| Pattern | Where it appears | What it does |
|---|---|---|
| **Provenance button** | Next to every chart + metric | Opens drawer with sources, freshness, methodology version, caveats. |
| **Confidence badge** | On every AI output | Percentage + green/amber/red tone; click "show reasoning" to see why. |
| **Freshness badge** | Next to every data point | "Updated Xh ago"; hover for the exact timestamp and data source. |
| **Disagree button** | On AI narratives | Opens a form — correct the AI's output; feeds the review loop. |
| **Right panel** | Drill-ins, approvals, briefs | Slides over content; press Esc to dismiss. |
| **Command palette** | ⌘K / Ctrl+K | Fuzzy search programs, scenarios, decisions, menu items. |
| **Density toggle** | User menu → Density | Compact / Comfortable / Spacious for dense-data screens. |
| **Export PDF** | Cockpit, Deep-Dive, Scenario, Decision | Council-grade PDF with Thai type, provenance appendix, audit-logged. |

---

## 6. Role-by-role guide

### 6.1 Viewer

**Audience** — staff who need read-only visibility.

**What you can do**
- Browse the program directory (`/programs`).
- Read Portfolio Cockpit heatmap and rollup tree at University level.
- Open any Program Deep-Dive (public sections only; no faculty-member detail, no per-program financial line items; you see *aggregated-only* financials).
- Read graduate outcome rollups.

**What you cannot do**
- See individual faculty-member data or per-line financials.
- Run scenarios, generate PDFs, upload documents, or approve extractions.

**Typical workflow**
1. Sign in → you land on Home with a link to `/cockpit`.
2. Browse to the module of interest.
3. Use Provenance and Freshness badges to understand a number before quoting it.

### 6.2 Council member

**Audience** — University Council members preparing for a Council meeting.

**What you get that Viewer doesn't**
- Full financial numbers (portfolio-level and per-program).
- Read access to all scenarios (including authored by Executive / Analyst).
- Read access to all decisions, plus your **approve / reject** workflow in the Decision Workspace.
- **PDF generation** — export Council Packs, per-program briefs, scenario packs.

**Typical Council-day workflow**
1. Sign in → `/inbox` shows new decisions awaiting your review.
2. Open a decision → read the snapshot, scenario link, milestones, approvers list.
3. Click **Approve** or **Reject** (with reason).
4. Export the Council Pack PDF if you want to print / mark up offline.
5. After the meeting, open **Decision Workspace → Outcomes** to see 6-month / 1-year / 3-year review due dates.

**Confidentiality boundary** — on faculty-composition sections, you see **aggregated** counts and rank distributions. Individual names, employee codes, and salary line items are hidden from your view by design.

### 6.3 Executive

**Audience** — President, Vice-Presidents, senior officers driving strategy.

**In addition to Council:**
- **Create + edit scenarios** at any scope (`scenarios:create:any`, `scenarios:edit:any`).
- **Edit decisions** (move a decision through its workflow: PROPOSED → COUNCIL_REVIEWED → APPROVED, etc.).
- Move a scenario to `COUNCIL_REVIEWED` to put it in front of Council.

**Typical workflow (authoring a scenario)**
1. Open `/scenarios` → **New scenario**.
2. Pick a template (e.g. *Demographic stress 2030*) or start blank.
3. Configure assumptions — enrollment trend, tuition, cost inflation, etc.
4. Add interventions — launch / sunset / merge / reshape / rebalance.
5. **Run** — deterministic engine + Monte Carlo (N=100 default).
6. Review sensitivity tornado, KPI deltas, risk callouts.
7. **Share** the scenario → status moves to `SHARED`.
8. When ready for Council, click **Mark Council-reviewed** → a snapshot is captured (immutable).
9. If Council approves, click **Decide** → creates a CouncilDecision row with the scenario attached.

### 6.4 Dean (faculty head)

**Audience** — faculty dean with responsibility for one faculty's programs.

**Scope-aware permissions**
- **Own faculty**: full program detail, full financials, faculty-member roster with names + ranks, own-faculty scenarios.
- **Other faculties**: aggregated numbers only (same level as Council).

**Additional capabilities**
- Upload PDFs (`pdf:upload`) — faculty policy documents, curriculum revisions (มคอ.2/3), committee minutes.
- Generate PDFs — per-program briefs and Council Packs scoped to your faculty.

**Typical workflow**
1. Open `/cockpit?scope=faculty&scopeId=<your faculty>` — the heatmap is filtered to your programs.
2. Drill into a program showing red → Program Deep-Dive → read the 10-section scorecard.
3. Use **Disagree** on any AI output that's off-base (e.g., AI said "curriculum is outdated" but you know the revision was just approved).
4. For a formal Council submission, export the Council Pack PDF at faculty scope.

### 6.5 Department head

**Audience** — department chair.

Same as Dean, but scope narrows to your **department** rather than the whole faculty. You can upload PDFs, read programs across your department, and see financials/outcomes at department level.

### 6.6 Analyst (institutional researcher)

**Audience** — institutional research office / data stewards.

**The Analyst is the human in the loop for the data pipeline.** You do most of the work that makes the system trustworthy.

**Additional permissions on top of Viewer**
- Full financial + faculty-member read at **all scopes**.
- Create + edit scenarios anywhere.
- **Upload PDFs** and — critically — **approve AI extractions** (`pdf:approve_extraction`).
- **Read data sources** and **trigger ingestion runs** (but not edit cadence).

**Typical daily workflow**
1. Check `/inbox` for PDF-intake queue entries that need review.
2. Go to `/admin/pdf-review` — queue of PDFs needing classification / extraction sanity-check.
3. Open each PDF → left pane shows the document, right pane shows AI extractions with confidence + reasoning → **Approve**, **Reject** (with reason), or **Re-extract**.
4. Go to `/admin/extraction-review` for non-PDF extractions (job postings, course descriptions, policy narrative tagging).
5. Move to `/admin/data-sources` → **Run now** for sources showing stale freshness.
6. Audit the AI inference log for any extraction below the 0.85 auto-approve threshold.

### 6.7 Administrator

**Audience** — system administrator (usually the KKU Digital Transformation Office).

**Everything every role can do, plus:**
- Manage users + KKU SSO mapping.
- **Configure** data-source cadence + enable/disable sources.
- **PDF generation admin** — template registry, recent generations log.
- Full access to every admin screen.

**See §7 for the admin-specific document and data workflow in detail.**

---

## 7. Admin — document & data processing

This is the operational workflow administrators and analysts follow to keep the data fresh and trustworthy.

### 7.1 Upload & PDF intake

**Where** — User menu → **Upload PDFs** → `/upload`

**Who can upload** — DEAN · DEPT_HEAD · ANALYST · ADMIN (permission `pdf:upload`).

**Purpose** — bring Council-relevant documents (policy, curriculum, peer program brochures, committee minutes, etc.) into the system so their content becomes searchable, linkable, and analysable.

**Upload form — fields**

| Field | Mandatory? | Value | Notes |
|---|---|---|---|
| **File(s)** | **Yes** | PDF only (`application/pdf` or `.pdf`) | Max **50 MB** per file, up to **20 files per batch** |
| **Category (hint)** | Optional | `POLICY`, `REPORT`, `CURRICULUM`, `PEER_PROGRAM`, `SURVEY`, `COMMITTEE_MINUTES`, `JOB_POSTINGS_BATCH`, `OTHER`, or *Auto-classify* | Leave blank and the LLM classifier decides; overrides if you know better |
| **Source organisation** | Optional | Free text — e.g., `MHESI`, `NESDC`, `NSO`, `KKU Engineering` | Feeds Provenance drawer; searchable later |
| **Language** | Optional | `TH`, `EN`, `MIXED`, or *Auto-detect* | Affects which extractors run; auto-detect is fine for most PDFs |

**Under the hood — what happens when you click Upload**

1. Browser → `/api/admin-pdfs/upload` (Next.js proxy) → `/api/v1/pdfs/upload` (NestJS).
2. Each file is SHA-256 hashed. **If the same bytes already exist**, the API returns `deduplicated: true` and reuses the existing row — no second MinIO copy, no re-processing.
3. Bytes are written to **MinIO bucket `pdf-raw`** under `<category>/<hash>.pdf`.
4. A `PdfDocument` row is inserted with `processingStatus = PENDING`.
5. A job is enqueued on the `pdf-intake` BullMQ queue.
6. The ingestion worker picks it up → extracts native text (pdfjs) → detects scanned pages → runs the LLM classifier (if `AI_PROVIDER` is configured) → for each detected content type, runs the matching extractor.
7. Each extractor output is written as a `PdfExtraction` row with `confidence` and `reviewStatus`:
   - `confidence ≥ 0.85` → `AUTO_APPROVED`
   - `confidence < 0.85` → `PENDING_REVIEW` (default gate — tuneable via `AI_AUTO_APPROVE_THRESHOLD`)

**Upload failure modes**

| Symptom | Cause | Fix |
|---|---|---|
| **"already in library" badge** | Same content-hash exists | Not a failure. The existing doc is reused. |
| **HTTP 500 on upload** | MinIO buckets missing | Run `pnpm minio:init`. `pnpm setup` does this automatically on fresh installs. |
| **HTTP 400 "Unexpected field"** | Wrong multipart field name | Field must be `files` (plural), not `file`. The UI does this correctly; only a concern for direct API callers. |
| **Processing stuck in PROCESSING, `awaiting OCR`** | PDF is scanned (image-only); OCR path not wired | Expected — OCR via Claude vision lands with prompt 04/14. The worker parks scanned PDFs cleanly rather than failing. |

**Tip — for large batches** upload in groups of ~10 PDFs sharing the same category/source/language. Per-file status shows which files succeeded; failed ones can be retried individually.

---

### 7.2 PDF review queue

**Where** — User menu → **PDF review queue** → `/admin/pdf-review`

**Who** — ANALYST · ADMIN.

**What it shows** — every PDF that's been uploaded or ingested, sortable by status.

**Status values**
- `PENDING` — just uploaded, not yet picked up by worker.
- `PROCESSING` — worker is running through it (or, for scanned PDFs, parked awaiting OCR).
- `COMPLETED` — text extracted, classifier + extractors ran, extractions written.
- `FAILED` — hard failure; see `processingError` field on the detail page.

**Clicking a row** opens `/admin/pdf-review/[id]` — a **two-pane review screen**:

- **Left** — full PDF viewer (react-pdf, page-by-page, with "Open raw" to download the original).
- **Right** — classification result + extractions list + selected extraction payload + approve/reject panel.

**What to check before approving**
1. Does the **classification** (right pane, top card) match the actual document type? The uploader's hint is shown for comparison.
2. Does each **extraction payload** reflect the PDF content accurately? The `reasoning` block explains how the LLM arrived at the output.
3. **Confidence** — anything under 70% deserves careful scrutiny; under 50% almost always means the extractor picked the wrong section.
4. For TH documents — verify names, numbers, dates against the PDF's text. Pdfjs has good Thai shaping but occasionally drops a tone mark.

**Actions**
- **Approve** (with optional notes) — flips `reviewStatus = APPROVED`.
- **Reject** (reason required) — flips to `REJECTED`; the extraction is not used downstream.
- **Re-extract** — re-runs the extractors on this PDF (useful after a methodology / prompt version bump).

**Keyboard** — ← / → for prev/next page inside the viewer.

---

### 7.3 AI extraction review

**Where** — User menu → **AI extraction review** → `/admin/extraction-review`

**Who** — ANALYST · ADMIN.

**What it is** — sibling queue to PDF review, but for **non-PDF-sourced** AI outputs: job postings parsed from scraped HTML, course descriptions typed into admin forms, policy narrative tagging that chains off a prior PdfExtraction, trend signal classification, etc.

**Same approve / reject / edit pattern as PDF review.** Each `AiExtraction` row carries:
- `methodVersion` — which prompt version produced it (e.g., `extract-course-skills.v2`).
- `confidence` (0.0–1.0).
- `payloadJson` — the structured output.
- `reasoning` — the LLM's chain-of-thought (short form).
- `sourceIngestionRunId` — traceable back to the ingestion run that produced the input.

**Bulk reprocess** (admin only) — when a prompt version ships, `POST /pdfs/bulk-reprocess` re-runs extractors against all PDFs matching a filter. Preserves the old extraction rows with their historical `methodVersion` so the audit trail stays intact.

---

### 7.4 Data-source management

**Where** — User menu → **Data sources** → `/admin/data-sources`

**Who** — ANALYST (read + Run-now) · ADMIN (read + Run-now + configure).

**What you see** — 23 registered data sources, each with:
- Slug (stable identifier).
- Input format (PDF, HTML, API, CSV, XLSX).
- Current schedule (cron expression).
- Last successful run + timestamp.
- Recent-run success / failure ratio.
- Freshness badge.
- `mocked: true` indicator — all 23 connectors are **MOCKED** today; flipping them to real is the responsibility of prompt 14 (`Real data integration`).

**Actions**
- **Run now** (ANALYST / ADMIN) — enqueues a manual run on the `ingestion` BullMQ queue. Useful after a source's upstream publishes new data.
- **Edit cadence** (ADMIN only) — update `cadenceCron` in the DB; the scheduler re-registers on next worker bounce. Hot reload is not supported (by design — cron changes are rare and worker restart is cheap).
- **Pause / Resume** (ADMIN only) — toggles `scheduleEnabled`. Paused sources do not auto-run but can still be triggered manually.
- **View recent runs** — opens a drawer with per-run logs: records fetched, records transformed, records loaded, errors.

**Non-retryable vs. retryable failures**
- Schema mismatch, bad auth → `NonRetryableError` → logged, run marked FAILED, no backoff retry.
- Network blip, 500 on upstream → BullMQ exponential backoff (3 attempts, 5s base).

---

### 7.5 PDF generation (outgoing)

**Where** — User menu → **PDF generation** → `/admin/pdf-generation`

**Who** — ADMIN only (read `pdf:admin`). Actual `pdf:generate` permission is held by Council / Executive / Dean / Dept-head / Analyst / Admin — so generation happens from the relevant module buttons, not this admin page.

**What this screen shows**
- **Templates list** — 12 templates currently: `council-pack`, `program-brief`, `scenario-pack`, `weekly-trend-digest`, `decision-record`, `data-quality-report`, `gap-report`, `quarterly-review`, `annual-strategic-review`, `faculty-level-review`, and two variants. Each shows its schema, version, and whether it's currently enabled.
- **Recent generations** — last 100 PDFs generated, who generated them, latency, success/failure, and a signed download URL (15-minute TTL).
- **Error patterns** — any `PDF_RENDER_TIMEOUT`, `PDF_TEMPLATE_DATA_INVALID`, or `PDF_UPSTREAM_UNAVAILABLE` events.

**How generation works (architecture, short form)**
1. Module (e.g. `/cockpit`) calls `POST /pdf/generate` with template name + data payload.
2. API validates data against the template's Zod schema.
3. React components render HTML → **Gotenberg** (Docker container) → Chromium → PDF.
4. Thai type uses **TH Sarabun New** (Cabinet-mandated font for official documents). This font **must be present in `infra/gotenberg/fonts/`** before `docker compose build gotenberg` — see `infra/gotenberg/README.md`.
5. PDF is written to **MinIO bucket `pdf-output`** + a `PdfGeneration` row is inserted (with signed URL, byte size, page count).
6. API returns the signed URL to the caller.

**Retry policy** — only `PDF_UPSTREAM_UNAVAILABLE` retries once (Gotenberg temporary unreachable). All other errors are deterministic and surface immediately.

**The programme report has grown.** The per-programme PDF (the **Export PDF** button on
`/programs/<id>`) now renders the same analyses the page shows, including three that were added
later than the rest: **digital competency**, **health benchmarks** (faculty and university
comparators), and **curriculum revision**. If a section is missing from a generated PDF, the usual
cause is that the underlying analysis has not been run for that programme, not a template fault —
check the programme's pipeline status before reporting a PDF bug.

Note that PDF generation was broken on the production server from first deploy until 2026-09-05 and
is now working. Any PDF you saved before that date was never successfully produced; regenerate
rather than relying on an old file.

---

### 7.6 Provenance, audit & AI governance

Three mandatory tables underpin everything in the app:

| Table | What it records | Populated by |
|---|---|---|
| `AuditLog` | Every mutation | `@AuditLog` decorator on controllers |
| `AiInference` | Every LLM call | `@AiCall` decorator on services |
| `PdfGeneration` | Every PDF produced | `PdfService.generateAndPersist` |

**As an Admin you should:**
- Periodically review `/admin/ai-logs/:id` (single-inference detail) — land in prompt 13 — to understand cost distribution.
- Check the `disagreement` annotation stream (`POST /programs/:id/disagreements`) — these are expert corrections of AI outputs; repeated disagreements on the same extraction type signal a prompt needing a version bump.
- Watch `AiInference.costEstimateUsd` rollup — the extraction-review stats strip shows 7-day cost per module. Flag anomalies to the AI-governance point of contact.

---

### 7.7 Submitting a new or revised curriculum

**Where** — `/admin/programs` → **Submit curriculum file** → `/admin/programs/from-pdf`

**Who** — admin-grade roles only.

This is the route for curriculum documents specifically. Use it instead of the general `/upload`
screen in §7.1 whenever the PDF is a มคอ.2 — it captures *what the document is for*, which the
generic uploader cannot, and that decision drives everything downstream.

**The wizard is three steps.**

**Step 1 — what are you submitting?** Two choices, and this is the consequential one:

| Choice | Use when | What happens |
|---|---|---|
| **A new programme** | The curriculum does not exist in the system yet | You will fill in identity fields in step 3 and a new programme is created |
| **A revised curriculum** | The programme exists and this document supersedes its current มคอ.2 | You search for the target programme by code or name (Thai or English) and the file is attached as a **revision** of it |

**Step 2 — upload the มคอ.2 PDF.** Extraction runs against the file and pre-fills what it can.

**Step 3 — depends on the choice in step 1.**

- *New programme:* review the extracted identity — code (e.g. `AG-AGR-BSC-2565`), names, degree,
  faculty, department, curriculum year BE. **The system checks for duplicates by code, name and
  degree before it commits.** Do not force past a duplicate warning; if the programme already
  exists, go back and submit as a revision instead. Creating a second row for the same curriculum
  splits its history in two and there is no clean merge.
- *Revised curriculum:* confirm the target and the curriculum year BE. There is no identity form —
  identity comes from the programme you are revising.

**Two things to get right.** The programme **code is the durable key** across every part of the
system, so a typo made here propagates into exports, PDFs and any downstream reconciliation.
And **the master sheet is detached** — programmes are maintained through this screen and
`/admin/programs`, never by re-running the original spreadsheet seed, which would discard admin
edits and audit fixes.

---

### 7.8 Curriculum revisions — staging, review, going live

Submitting a revision does **not** overwrite the live programme. The revision is staged, analysed,
reviewed, and only then promoted. This is what keeps a Council-facing number from changing under
someone's feet because a new PDF happened to arrive.

**The lifecycle**

| Status | Meaning |
|---|---|
| `DRAFT` | File attached; nothing analysed yet |
| `ANALYSING` | The programme pipeline is running against this revision |
| `IN_REVIEW` | Analysed, waiting on a human decision |
| `APPROVED` | Promoted — this revision is now the programme's live curriculum |
| `REJECTED` | A reviewer declined it; the previous revision stays live |
| `SUPERSEDED` | A later revision was approved over this one |

**What "live" means.** Each programme points at one active revision. Every analysis the pipeline
produces — strategic narrative, AI readiness, pedagogy, peer review, research expertise, skills,
courses, the curriculum-revision comparison itself — is stamped with the revision that produced it.
So the deep-dive page and the PDF always show one internally consistent curriculum, and an older
revision's outputs stay intact and attributable rather than being overwritten.

**Metadata is proposed, not applied silently.** Where a revision's digest disagrees with the
programme's current values, the proposed values *and the ones they would replace* are recorded for
review instead of being written straight through. A re-digest never blanks out a human-curated
field.

**Reading the curriculum-revision section.** On `/programs/<id>` (and in the PDF) this section
describes what the new curriculum changes. It is AI-generated from the two documents and passes
through an **anti-fabrication validator** that strips claims the source text does not support, so
the section is deliberately shorter and more cautious than a human summary would be. Each one
records the inputs it was computed from and how many claims the validator dropped, so a reviewer can
audit the basis. **Programmes with no revision history show nothing here** — that is the pre-feature
baseline, not a failure.

---

## 8. Requirements reference

### 8.1 Client / browser

| Requirement | Minimum | Recommended |
|---|---|---|
| Browser | Chrome/Edge 111+, Firefox 113+, Safari 16.4+ | Latest stable |
| Screen | 1280 × 800 | 1440 × 900 or larger (dense data views) |
| Connection | Any reliable internet connection on the KKU network | ≥ 5 Mbps for PDF previews |
| Cookies / JavaScript | Required | — |

### 8.2 Account / access

| Mandatory | Optional |
|---|---|
| KKU email address | Preferred theme (Light / Dark / System) |
| Role assignment by administrator | Preferred density (Compact / Comfortable / Spacious) |
| SSO-backed identity (prod) or dev-credentials (local) | Language preference for analysis text |

### 8.3 PDF upload — input requirements

| | Mandatory | Optional |
|---|---|---|
| **Upload permission** | `pdf:upload` (DEAN · DEPT_HEAD · ANALYST · ADMIN) | — |
| **File** | PDF (`application/pdf` or `.pdf` extension) | — |
| **File size** | ≤ 50 MB per file | — |
| **Batch size** | ≤ 20 files per request | — |
| **Category hint** | — | Drives extractor selection when classifier is uncertain |
| **Source organisation** | — | Populates Provenance drawer; improves searchability |
| **Language** | — | Guides language-specific extractors; auto-detect is safe for most cases |
| **PDF quality** | Native text preferred; scanned documents are parked until OCR lands (prompt 04/14) | For best extraction, avoid heavy watermarks over body text |

### 8.4 Scenario authoring — input requirements

| Mandatory | Optional |
|---|---|
| Title (Thai + English recommended) | Template to copy from |
| Scope (University / Faculty / Department) | Co-author list |
| At least one **assumption** block (enrollment, tuition, cost, demographic adjustment) | Narrative caveats in Thai |
| At least one **intervention** OR a baseline-only run | Sensitivity range for Monte Carlo (defaults to ±1σ per assumption) |

### 8.5 Decision workspace — input requirements

| Mandatory | Optional |
|---|---|
| Title | Linked scenario ID |
| Decision type (`CLOSE`, `MERGE`, `LAUNCH`, `RESTRUCTURE`, `KEEP_AS_IS`, `OTHER`) | Council session reference |
| Affected program IDs (at least one) | Resolution PDF |
| Effective date | Milestones + approvers (can be added later) |
| Proposed by (auto-captured from session) | — |

### 8.6 Server-side / infrastructure (for administrators deploying)

| Required | Purpose |
|---|---|
| PostgreSQL 16 with `postgis`, `pgvector`, `pg_trgm`, `btree_gin`, `uuid-ossp` | App data + vector similarity + geo |
| Redis | BullMQ queues (ingestion, pdf-intake, ai-jobs, trend-monitors) |
| MinIO (S3-compatible) | PDF storage — buckets `pdf-raw` + `pdf-output` (auto-created by `pnpm minio:init`) |
| Gotenberg (Docker) with TH Sarabun New fonts installed | PDF generation |
| Node ≥ 20, pnpm ≥ 9 | Build + runtime |
| `NEXTAUTH_SECRET` | Session cookie signing |
| `AI_PROVIDER` + matching API key | Real LLM calls (optional — `stub` falls back gracefully) |
| KKU SSO OIDC credentials (prod only) | SSO integration |

### 8.7 Optional but strongly recommended

- Enable SMTP for email digests (lands with prompt 13).
- Set `MINIO_PUBLIC_ENDPOINT` if the browser reaches MinIO via a different hostname than the API server.
- Back up the PostgreSQL volume and the MinIO `pdf-raw` bucket daily.

---

## 9. Troubleshooting

| Symptom | Most likely cause | Fix |
|---|---|---|
| **Sign-in page loops back** | `.env` not symlinked into `apps/web` (Edge middleware can't see `NEXTAUTH_SECRET`) | `pnpm link-env` |
| **PDF upload returns 500** | MinIO buckets missing | `pnpm minio:init` |
| **PDF preview shows "Failed to load PDF"** | pdf.worker version mismatch in `/public` | `pnpm --filter web exec node scripts/copy-pdf-worker.mjs` |
| **Council Pack PDF shows □□□ for Thai text** | TH Sarabun New not installed in Gotenberg image | Drop fonts into `infra/gotenberg/fonts/` + `docker compose build gotenberg` |
| **AI output shows "placeholder — no API key"** | `AI_PROVIDER` unset or missing key; using stub | Set `AI_PROVIDER=google` or `anthropic` and corresponding key |
| **Scope pill options greyed out** | Role doesn't cover that scope | Contact admin for role upgrade, or scope down to what you own |
| **Scenario run rejects "scenario is not editable"** | Scenario is DECIDED or ARCHIVED (immutable) | Duplicate it — edits to historical scenarios are by design not allowed |
| **"already in library"** on upload | Content hash already exists | Not an error — the existing doc was reused |

Detailed diagnostic logs live at:
- `pnpm dev` console (dev).
- `/opt/program-landscape/logs/` on the prod server.
- `/admin/ai-logs/:id` for AI-inference drill-in (prompt 13).
- `/admin/pdf-generation` → error table for PDF render failures.

---

## 10. Glossary

| Term | Meaning |
|---|---|
| **Scope** | One of *University / Faculty / Department / Program*. All analytics roll up cleanly between these levels. |
| **Methodology version** | Versioned identifier attached to every computed metric (e.g. `health-score.v1`). Pinning a calculation to a methodology lets us explain what changed when numbers move. |
| **Provenance** | Traceability chain from a displayed number back to its source ingestion run, source document, and methodology. Surfaced via the Provenance button. |
| **Freshness** | How recent the underlying data is. "Updated 4h ago" on a chart means the underlying `mv_*_metrics` materialised view ran 4 hours ago. |
| **Extraction** | A structured fact pulled out of an unstructured input (usually a PDF) by an LLM — e.g. "program codes found in this curriculum doc". |
| **Review queue** | Every extraction below the auto-approve confidence threshold lands here; an Analyst / Admin approves or rejects. |
| **Snapshot** | Immutable frozen state of the portfolio attached to a decision when it moves to COUNCIL_REVIEWED. Enables actual-vs-projected outcome reviews. |
| **Outcome review** | 6-month / 1-year / 3-year review of an approved decision — did the predicted outcome happen? |
| **Disagreement** | Formal annotation where an expert corrects an AI output. Feeds the AI-improvement loop. |
| **White space** | A skill or subject taught by ≥ 3 peer institutions but by no KKU program — a candidate for a new launch. |
| **Monte Carlo (scenario)** | Re-runs a scenario N times with perturbed assumptions to generate a confidence band around KPI outcomes. Default N=100, cap 2000. |
| **มคอ.2 / มคอ.3** | Thai Qualifications Framework curriculum-spec documents. Category `CURRICULUM` on upload. |
| **Council Pack** | The formal multi-section PDF submitted to the University Council for a decision, generated by the `council-pack` template. |

---

*For developer-level detail, see `docs/architecture.md`, `docs/ai-governance.md`, and the per-metric methodology files under `docs/methodologies/`. The eight module specifications live in `prompts/`.*
