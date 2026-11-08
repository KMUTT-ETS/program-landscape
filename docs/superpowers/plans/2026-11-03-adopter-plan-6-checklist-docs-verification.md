# Adopter Plan 6 — Setup checklist, bilingual workshop docs, KMUTT verification

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A workshop attendee follows one bilingual tutorial from a fresh clone to a programme whose setup checklist is all green (or N/A), and that path is proven end to end on KMUTT Mechanical Engineering (`2514001`) in a browser.

**Architecture:** A read-only checklist service in `@kku/db` composes the readers the deep-dive already uses into one per-programme list of sections and score drivers, each with status, what it waits on and where to fix it; an admin API route serves it and a programme-admin tab renders it. Docs pages get Thai twins (`<page>.th.md`) linked from the English page, with a docs-site check that twins stay structurally in sync. The tutorial is then executed literally against an isolated local stack with Playwright.

**Tech Stack:** TypeScript strict, NestJS, Next.js App Router, VitePress, Playwright, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-03-adopter-ready-deep-dive-design.md` §7.4, §7.5, §7.6, O4–O6, O12, D7, D8. Plans 1–5 are done.

## Global Constraints

- No `any`; Zod at I/O; English UI labels; design tokens only; `@Authorized('programs:manage:all')` on the admin route; read-only (no `@AuditLog` needed for GET).
- "Green" means real data the readers would show (`realDataWhere()` where the reader uses it); mock rows never make an item green (anti-goal).
- Not-applicable is not red: postgraduate programmes for TCAS / digital competency; overlap with no same-level sibling that has a course list (D7).
- Degraded AI output counts as green with a "degraded — reason" note (D8).
- Thai docs safe without human review (O12): plain short sentences; terms from `docs/glossary-th-en.md`; UI labels, commands, file names, column headers, env keys verbatim in English; section-by-section mirror of the English page; no Thai-only content.
- No PII from `kmutt-data/` in code, tests, fixtures, docs, screenshots or commits. Screenshots used only for verification stay in the scratchpad, never committed.
- DB-touching tests use `describeScratchDb` and run only through the scratch wrapper. The owner's dev DB and dev stack (ports 3000/4000, its Redis and buckets) must never be touched.
- `pnpm docs:build` passes after every docs change.

## Review Focus

1. **A programme with no data at all** (fresh after import of org chart only): the checklist renders every row as empty with a fix link, never crashes → Task 1 test.
2. **Postgraduate programme**: TCAS and digital competency are N/A, not red → Task 1 test.
3. **Twin drift**: an English page gains a section and its Thai twin doesn't → docs check fails → Task 3 test.
4. **Fresh-install path in the docs**: every command in the getting-started and tutorial pages exists in `package.json` scripts → Task 4 test (script-name check).
5. **The live run hits a step the docs don't mention** → recorded and fixed in the docs (Task 6).

---

### Task 1: Checklist service and admin API

**Files:**
- Create: `packages/db/src/program-setup-checklist.ts` — `programSetupChecklist(programId: string): Promise<SetupChecklist>`
- Modify: `packages/db/src/index.ts` (export), `apps/api/src/programs/programs-admin.controller.ts` (route `GET /admin/programs/:id/setup-checklist`, `@Authorized('programs:manage:all')`, `@Provenance`)
- Test: `packages/db/test/program-setup-checklist.test.ts` (scratch DB), `apps/api/test/programs-setup-checklist.test.ts` (route wiring, mocked)

**Interfaces:**
- `SetupChecklist = { programId: string; programCode: string; level: ProgramLevel; generatedAt: string; summary: { ok: number; empty: number; notApplicable: number; degraded: number }; items: ChecklistItem[] }`
- `ChecklistItem = { key: string; group: 'Programme' | 'Students' | 'Outcomes' | 'Finance' | 'Staff & research' | 'Curriculum' | 'Market & benchmarking' | 'Health score'; title: string; status: 'ok' | 'empty' | 'not-applicable' | 'degraded'; note: string | null; waitingOn: Array<{ kind: 'dataset' | 'connector' | 'pipeline' | 'setting' | 'sibling'; slug: string; label: string; href: string }> }`
- Section items (one per deep-dive section, using the same "has data" signal the page uses): curriculum PDF linked (CURRENT_CURRICULUM document); strategic narrative; AI readiness; recruitment funnel (admission campaigns); TCAS (bachelor only); cohorts; demand funnel; demographic outlook; financials; skills (taught skills); graduate outcomes; employer feedback; digital competency (bachelor only); faculty roster; research expertise; curriculum revision; course list; peer benchmarking (AI peers + rankings rows exist); overlap (D7).
- Driver items: every driver in `DIMENSION_DRIVERS` (`packages/db/src/health-score.ts:~324`) read from the programme's computed score (`getProgramScoreIndex` / the overview), status `ok` when value non-null, otherwise `empty` with `note` = the driver's `raw.reason` when present; `not-applicable` for drivers the scorer omits for this level.
- `waitingOn` mapping is one exported constant `CHECKLIST_SOURCES` keyed by item key: dataset slugs link to `/admin/data-setup` (template + upload), connectors to `/admin/data-sources/<slug>`, pipeline phases to `/admin/programs/<id>?tab=pipeline`, settings to `/admin/organization`, sibling to `/admin/data-setup` (programme course lists).
- Degraded: pipeline phase results recorded as degraded for this programme (last run), shown with the reason.

- [ ] **Step 1: Failing tests** — `empty programme → every item empty or not-applicable, none ok, all have waitingOn`; `postgraduate → TCAS and digital competency not-applicable`; `imported enrolment row → cohorts/financial items reflect data` (fixture rows stamped by an `xlsx-*` run); `a mock-run-stamped row does not turn an item ok`; route returns the envelope and is permission-gated.
- [ ] **Step 2–4:** run → FAIL (wrapper), implement, run → PASS; typecheck db/api.
- [ ] **Step 5: Commit** `feat(admin): per-programme setup checklist service and API`.

### Task 2: Checklist tab and deep-dive link

**Files:**
- Modify: `apps/web/app/admin/programs/[id]/client.tsx` (new tab `checklist`, label "Setup checklist", whitelisted in the `?tab=` list), page fetches `/admin/programs/:id/setup-checklist`
- Create: `apps/web/app/admin/programs/[id]/setup-checklist.tsx` (renders groups, status chips — ok / missing / N/A / degraded — with design tokens, each "waiting on" as a link; summary line "N of M ready")
- Modify: `apps/web/app/programs/[id]/page.tsx` + client header: admins see a "Setup checklist" link to `/admin/programs/<id>?tab=checklist`
- Modify (parked from plan 3): `apps/web/src/components/data-source-mark.tsx` — the grant-award driver chip credits the source that actually holds the rows (use the grants source credits the API already returns, or a neutral "External grants" mark when imported)
- Test: `apps/web/test/setup-checklist.test.tsx` (render with a fixture checklist), the no-KKU guard list gains the new file

- [ ] **Step 1–4:** failing render tests (groups, chips, links, summary), implement, pass; `pnpm --filter web exec vitest run <files>`; typecheck web.
- [ ] **Step 5: Commit** `feat(web): setup checklist tab on the programme admin page`.

### Task 3: Thai twins on the docs site

**Files:**
- Modify: `apps/docs-site/src/manifest.ts` (stop excluding `adopters/README.th.md`; export `BILINGUAL_PAGES: readonly string[]` — the English pages that must have a `.th.md` twin: `tutorials/README.md`, `tutorials/getting-started.md`, `tutorials/program-deep-dive.md`, `tutorials/workshop.md`, `data-import.md`, `adopters/README.md`), `apps/docs-site/.vitepress/sidebar.ts` (a "ภาษาไทย (Thai)" group listing every twin), `apps/docs-site/src/check-site.ts` (new check `bilingual-twin`: twin exists; same count of `##`/`###` headings; identical fenced code blocks in order; each page links to its twin at the top)
- Modify: `docs/adopters/README.th.md` — add the two sections the English guide has and the Thai one lacks ("Building your skill taxonomy", "Running on OpenRouter") and any other drift the new check finds
- Test: `apps/docs-site/test/check-site.test.ts` (twin check: missing twin, heading drift, code drift, missing link)

- [ ] **Step 1–4:** failing tests, implement, pass; `pnpm docs:build` (will fail until Task 4/5 add the missing twins — so in this task register only pages whose twin exists after this task: `adopters/README.md`; Tasks 4–5 add the rest to `BILINGUAL_PAGES`).
- [ ] **Step 5: Commit** `feat(docs): Thai twins with a structural sync check`.

### Task 4: English workshop docs, in the order that works

**Files:**
- Create: `docs/tutorials/getting-started.md` — fresh clone → running app → `/setup` (merges and supersedes `docs/guides/fresh-checkout-setup.md`, which becomes a short pointer page): prerequisites (Docker, Node 20, pnpm 10, a Google Gemini or OpenRouter key), `cp .env.example .env` and the keys to set, `pnpm setup`, `pnpm dev`, health URLs, `/setup` claim (warning: claim it immediately), sign in.
- Rewrite: `docs/tutorials/program-deep-dive.md` — the verified order: organisation profile (names must match TCAS spelling; region one of Northeast/Central/North/South; OpenAlex id) → faculties (Teaching Mode) → departments → programmes → staff → programme teaching staff → enrolment / finance / graduate outcomes / cohorts / alumni / admission campaigns → course lists → evaluations, digital competency, grants, employer feedback, salary by funding (when you have them) → population projections / rankings / career skill demand → connectors: TCAS, UN WPP, KMITL (or the spreadsheet), OpenAlex, job-108 (switch on in /admin/data-sources) → attach the curriculum PDF (+ `pnpm curriculum:check`) → run the pipeline → open the Setup checklist and get it green → open the deep-dive. Cost note per programme. Each step names the exact page, file and button.
- Create: `docs/tutorials/workshop.md` — facilitator page: agenda (half day), what attendees bring (laptop with Docker, AI key, exports), pre-flight checklist to send in advance, common failures and fixes (filled in from Task 6).
- Modify: `docs/tutorials/README.md` (order: getting started → deep-dive → workshop; registrar-connector tutorial marked "advanced / optional, KKU example"), `docs/data-import.md` (any drift), sidebar entries, `BILINGUAL_PAGES` not yet (twins come in Task 5)
- Test: `apps/docs-site/test/tutorial-commands.test.ts` — every `pnpm <script>` in the three tutorial pages exists in the root or a workspace `package.json`; every `/admin/...` route mentioned exists under `apps/web/app`.

- [ ] **Step 1–4:** failing command/route test, write pages, pass; `pnpm docs:build`.
- [ ] **Step 5: Commit** `docs(tutorials): getting started, deep-dive and workshop pages for adopters`.

### Task 5: Thai twins of the tutorial pages

**Files:**
- Create: `docs/tutorials/README.th.md`, `getting-started.th.md`, `program-deep-dive.th.md`, `workshop.th.md`, `docs/data-import.th.md`; add them to `BILINGUAL_PAGES`; English pages link to the twin at the top ("ภาษาไทย") and twins link back ("English")
- Test: the Task 3 check passes for all six pages.

- [ ] **Step 1–4:** add pages to `BILINGUAL_PAGES` (check fails), write twins, `pnpm docs:build` passes.
- [ ] **Step 5: Commit** `docs(tutorials): Thai twins of the adopter tutorials`.

### Task 6: End-to-end verification on KMUTT Mechanical Engineering (controller-run)

Run by the controller (not a subagent), because it needs judgement and live services. Isolation, exact:
- Fresh database `program_landscape_e2e_test` on the existing Postgres container (created new; never reset).
- A separate Redis container `pl-e2e-redis` on port 6380 (BullMQ ignores the URL DB index and the scheduler rewrites repeatables, so sharing the owner's Redis is not safe).
- Bucket names suffixed `-e2e` for every `MINIO_BUCKET_*`; `CACHE_KEY_PREFIX=pl-e2e:cache:`; api `PORT=4100`, `ALLOWED_ORIGINS=http://127.0.0.1:3100`; web on 3100 with `API_URL=http://127.0.0.1:4100`; browser uses `http://127.0.0.1:3100` (cookies are host-scoped; the owner uses `localhost`).
- `ALLOW_MOCK_CONNECTOR_RUNS` unset; AI provider from the existing `.env`.

Steps (follow the new docs literally; every deviation is a docs fix):
- [ ] Migrate, sync data sources, reference seed (`pnpm setup` equivalents against the e2e env), `pnpm adopter:fresh-check` → pass.
- [ ] Start api, ingestion worker and web with the e2e env.
- [ ] Playwright (browser): `/signin` → `/setup` → create admin → `/admin/organization` (KMUTT names, region Central, OpenAlex id `I60837268`).
- [ ] Upload `/kmutt-data` workbooks through `/admin/data-setup` in the documented order (the files exist for faculties, departments, programmes, staff, programme staff, enrolment, finance, graduate outcomes, cohorts, alumni, admission campaigns, publications, course lists). For datasets KMUTT has no file for (evaluations, digital competency, grants, employer feedback, salary by funding, population projections, career skill demand), upload synthetic workbooks generated into the scratchpad with obviously fictional values for `2514001` only; rankings via the pre-filled template.
- [ ] Run connectors from `/admin/data-sources`: TCAS, UN WPP, OpenAlex (if `OPENALEX_API_KEY` is set; otherwise record "skipped — key not set"), KMITL skill mapping (key present), job-108 optional.
- [ ] Attach the `2514001` curriculum PDF on the programme's Files tab; `pnpm curriculum:check` first.
- [ ] Run the pipeline for `2514001` from the Pipeline tab; wait for completion.
- [ ] Open the Setup checklist tab: every item ok / N/A / degraded-with-reason. For each red item, find the cause, fix code or docs (via a subagent fix task with review), re-run.
- [ ] Open `/programs/<id>`: every section renders data; health radar shows all five dimensions.
- [ ] Record results (counts, statuses, no names) in `docs/superpowers/notes/2026-11-03-kmutt-e2e-verification.md` (excluded from the site) and the workshop page's "common failures" section; screenshots stay in the scratchpad.
- [ ] Stop the e2e services and the e2e Redis container; leave the e2e database for the owner to inspect.
- [ ] Update CLAUDE.md "Current status" with one entry for this branch's adopter work.
