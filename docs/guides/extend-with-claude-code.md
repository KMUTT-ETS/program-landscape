# Extend the platform with Claude Code

> **ภาษาไทย:** [ฉบับภาษาไทย](../th/guides/extend-with-claude-code.md)

**Outcome.** You can extend the platform with Claude Code while keeping its output consistent with the house rules.

This codebase was built with Claude Code, and that fact shapes how you should extend it. If you use an AI assistant here, the setup below is what makes its output consistent with the existing code rather than a plausible-looking mess.

## `CLAUDE.md` is the contract

`CLAUDE.md` at the repository root is read at the start of every Claude Code session. It is why the AI produces consistent code in this repository: it encodes the strategic questions, the module list, the language strategy, the coding conventions, the Council-readiness rules, the deployment model, and a long decision log explaining *why* things are the way they are.

**Fork it and rewrite the institution-specific parts before your first session.** Specifically:

| Section | Action |
|---|---|
| Project description, audience | Rewrite for your institution |
| The eight strategic questions | Rewrite — these are KKU Council's questions, and they are the framing that shapes every analytical decision downstream |
| The eight modules | Keep, unless you are dropping one |
| Language strategy | Review — English-only UI and English-only analysis output, with a narrow Thai exemption list |
| Faculty names, programme counts | Replace |
| Current status / decision log | **Truncate to a pointer at KKU's history, then start your own.** Do not carry 170 KB of KKU's session log; it will crowd out your own context |
| Coding conventions, What NOT to do | Keep verbatim — this is the part that makes AI output consistent |
| Run/test/lint, Platform | Update paths and hostnames |

`prompts/CLAUDE.md.template` is the original template the file was generated from and is a cleaner starting point than the current 170 KB file.

A word on the decision log: KKU's `CLAUDE.md` contains a self-flagged drift note admitting the log jumps from v1.1.3 to v1.6.1 and that the v1.2–v1.6 work was shipped but never logged. Treat it as best-effort, and treat `apps/web/app/changelog/page.tsx` as the authoritative release history.

## `prompts/` is the original build manual

The `prompts/` directory contains the sequenced prompts that built the platform — prompt 00 (bootstrap) through prompt 13b (deployment), plus the ongoing prompt 14 (real-data integration). You are unlikely to re-run them, but they are the best available explanation of *why* each subsystem is shaped as it is. Read the one matching whatever you are about to change.

`prompts/14-integration-session-template.md` is the live, per-connector session template and you should use it for every connector you write. `prompts/GLOBAL-UPDATES.md` carries cross-cutting requirements; `prompts/TROUBLESHOOTING.md` collects known failure modes.

## The house rules that keep AI output consistent

These are in `CLAUDE.md` and they are what an AI assistant will follow if you leave them in place, and quietly violate if you delete them:

- TypeScript strict; **no `any`**
- Zod validation at every I/O boundary — request, response, ingestion, AI extraction
- Design tokens only; never hardcoded colours, fonts, or spacing (ESLint enforces)
- `@AuditLog()` on every mutation; `@AiCall()` on every AI call
- Server components by default; client components only for interactivity
- Conventional commits (`feat:`, `fix:`, `refactor:`, `docs:`, `chore:`, `test:`)
- `pnpm check` before committing
- Methodology versioning on every metric
- No raw SQL except via Prisma's `$queryRaw` with Zod-validated results
- Cross-platform tooling only — no Makefile, no `rm -rf` (use `rimraf`), no string-concatenated paths (use `path.join()`)

## A starting set of prompts

These are written to be pasted and run, in this order, as separate sessions. Each states what "done" looks like. Replace `<YOUR UNIVERSITY>` and the bracketed specifics.

---

**Prompt 1 — Orient in the codebase**

> Read `CLAUDE.md`, `docs/architecture.md`, and `docs/evaluation-pipeline.md`. Then produce a written orientation for a new developer at `<YOUR UNIVERSITY>` covering: (a) the data flow from an ingestion connector through to a number rendered on the Portfolio Overview Cockpit, naming the specific files at each hop; (b) which of the eight modules can render anything useful with zero institutional data wired, and which are completely empty until a specific connector runs — name the connector for each; (c) the five files a developer will touch most often, with one sentence each on what lives there.
>
> Do not change any code. Write the orientation to `docs/adopters/orientation-<ouruni>.md`.
>
> **Done when:** the document exists, every file path in it resolves, and I can trace one number end-to-end from SQL through to a React component by following it.

---

**Prompt 2 — Fork `CLAUDE.md` for our institution**

> Rewrite `CLAUDE.md` for `<YOUR UNIVERSITY>`. Keep verbatim: the coding conventions, the "What NOT to do" list, the Council-readiness rules, the multi-level analytical scope rules, the folder conventions, and the run/test/lint commands. Rewrite: the project description and audience, the eight strategic questions (I will give you ours below), the faculty names, and the platform/deployment section (our production host is `<HOST>`, install path `<PATH>`). Replace the entire "Current status" decision log with a single paragraph pointing at KKU's upstream history plus an empty section for ours to accumulate in.
>
> Our strategic questions are: [list yours, or say "keep KKU's eight for now and flag that we must revisit them with our Council"].
>
> **Done when:** `CLAUDE.md` contains no reference to Khon Kaen University except the explicit attribution paragraph, is under 20 KB, and a fresh session reading only that file would follow our conventions rather than KKU's.

---

**Prompt 3 — Rebrand**

> Rebrand the application from KKU to `<YOUR UNIVERSITY>`. Work in this order and stop for my review between each step:
>
> 1. Inventory every reference. Grep `apps/web` for "KKU" and "Khon Kaen" (case-insensitive) across `.ts`/`.tsx`, plus `packages/pdf-templates` and `packages/shared/src/ai/prompts`. Give me a categorised list: user-facing copy, PDF template text, AI prompt text, comments, identifiers. Roughly 101 files in `apps/web` alone — do not try to fix them in one pass.
> 2. Rename the brand colour token from `brand-cardinal` to `brand-primary` across `packages/design`, `packages/ui`, and `apps/web`. Keep the OKLCH values unchanged for now so the diff is purely a rename.
> 3. Change the `brand-primary` token values in `packages/design/src/tokens/color.ts` to `<YOUR COLOURS>` for both light and dark mode, and verify both modes still pass WCAG AA for text on surface.
> 4. Replace the logo files at `apps/web/public/brand/` and rebuild the favicon with `pnpm tsx scripts/build-favicon.ts`.
> 5. Fix user-facing copy, PDF templates, and AI prompt text — in that order, one commit each.
>
> Constraints: never hardcode a colour; use tokens only. Do not add tokens to the spacing scale — read `packages/design/src/tokens/spacing.ts` before touching anything spacing-related. Restart the dev server and clear `.next/cache/webpack` after any token change, because the preset does not hot-reload.
>
> **Done when:** `pnpm check` passes, no user-facing surface says "KKU", and both light and dark mode render correctly with our colours.

---

**Prompt 4 — Load our faculties, departments, and programmes**

You may not need Claude Code for this. The three backbone datasets are spreadsheet uploads at `/admin/data-setup`: download each template, fill it in, upload it. Use the prompt below when your source is a messy export that needs reshaping into the templates first.

> Turn our organisation data into the Program Landscape import templates. Do not edit any code or seed file.
>
> Read `docs/data-import.md` and the declarations in `packages/db/src/import/datasets/faculties.ts`, `departments.ts` and `programmes.ts` — those declare the exact columns, required fields and validation rules. Our faculties, departments and programmes are in [file], with columns [list them].
>
> Produce three workbooks matching the downloaded templates. Carry the MHESI curriculum code into the programmes sheet's *Official Code* column: `Program.mhesiCode` is how the UniCon DS1001 and DS2004 connectors resolve `CURR_ID` to a programme. Thai faculty names must be spelled the way TCAS writes them. List any row you could not map rather than guessing.
>
> **Done when:** all three workbooks upload at `/admin/data-setup` without a validation error, and `/admin/programs` lists our programmes with correct faculty and department attribution.

---

**Prompt 5 — Wire our first UniCon connector (DS2001, staff master)**

> Follow `prompts/14-integration-session-template.md` for the slug `unicon-ds2001`. One connector only.
>
> Read `apps/ingestion/src/connectors/sources/unicon-ds2001/connector.ts` in full before changing anything — particularly the PII projection in `fetch()`, the `EMPTY_DATA` guard, and the snapshot-replace semantics in `load()`.
>
> Our DS2001 lives at [host/port/database]. Credentials are in `.env` under `UNICON_DS2001_DB_*` — note that key is documented in `.env.prod.example` but missing from `.env.example`; add it to both.
>
> Steps:
> 1. Write a read-only discovery script following the pattern of the existing `probe-*` scripts in `apps/ingestion/src/scripts/`. Report row count, distinct values per reference column, and which columns are NULL-heavy. Refuse to sample any column matching the PII guard pattern. Commit the aggregate output as a fixture under `apps/ingestion/test/fixtures/unicon-ds2001/`.
> 2. Diff our schema against the projection in the existing connector. Report every difference before changing code — I want to see it, not have it fixed silently.
> 3. Adapt the connector minimally. Preserve the column projection, the citizen-ID hashing, the birth-year downcast, the `EMPTY_DATA` guard, and the `ingestionRunId: ctx.runId` stamp on every inserted row.
> 4. Adapt `buildDeptCodeToFacultyMap()` to our organisational codes.
> 5. Add a transform unit test asserting every reference code in the fixture has a mapping.
>
> Then run `pnpm connector:run unicon-ds2001` until we have three consecutive successful runs with identical record counts. Update `data_sources` so `status` and `mocked` are set atomically, and run `pnpm data-sources:audit` to confirm no drift.
>
> **Done when:** three green runs are visible at `/admin/data-sources/unicon-ds2001`, `staff_master_record` rows all carry a non-null `ingestion_run_id`, the faculty-resolution rate is reported, and `pnpm check` passes. Do not touch any other connector or any UI file.

---

**Prompt 6 — Write the second UniCon connector by analogy (DS2004)**

> Now do `unicon-ds2004` — academic staff per programme. Same template, same one-connector discipline.
>
> This one is different from DS2001 in three ways I want you to handle explicitly: (a) the source table name encodes academic year and semester (`ds2004_<YYSEM>`, BE last-two-digits plus semester) and the connector resolves `MAX(suffix)` at runtime — check whether our registrar uses the same convention and adapt if not; (b) it reads all three `TEACH_TYPE_ID` values (1 regular faculty, 2 curriculum lecturer, 3 responsible lecturer), not just type 3, so do not copy the documented view that filters to type 3 only; (c) `CURR_ID` resolves to `Program.mhesiCode` with a `ProgramMhesiAlias` fallback, and unmatched rows must persist with `programId = NULL` and the raw `mhesiCurrId` for analyst follow-up — never dropped.
>
> Before writing code, tell me what you expect to differ between our DS2004 and KKU's, based on our discovery output.
>
> **Done when:** three green runs, the programme-resolution rate is reported in `LoadResult.metadata`, unmatched rows are visible and countable rather than silently discarded, and the DS2001 faculty-resolution rate has improved now that the bridge table is populated.

---

**Prompt 7 — Adapt the health-score methodology to our weights**

> Read `docs/methodologies/health-score.md` and `packages/db/src/health-score/` (start with its `README.md`; currently `health-score.v5.6`), and `docs/evaluation-pipeline.md` for how the score feeds lifecycle, risk, and BCG classification.
>
> Produce a written analysis first — no code — covering: every dimension and driver, where each driver's data comes from, which drivers return null for us today given which connectors we have wired, and which weights encode a KKU Council judgement rather than a general principle. Flag anything you are unsure about rather than guessing.
>
> Then, and only after I have approved the analysis, implement our variant: a new version constant, our weights, our methodology document at `docs/methodologies/health-score.md` updated in the same commit, and tests covering the null-handling rule (a missing metric is excluded from the average, never substituted with 0 or 50) and our specific weight changes.
>
> **Done when:** the analysis document exists and I have approved it; the version constant is bumped; the doc and code agree; `dataCompletenessPct` is still computed and surfaced; and existing scored rows carrying the old version still render with their original version stamp.

---

**Prompt 8 — Run the programme document pipeline**

> Set up and run the curriculum-PDF ingestion pipeline for our programmes.
>
> 1. Read `docs/pdf-ingestion.md` and the header of `apps/ingestion/src/scripts/programs-pipeline.ts`.
> 2. Build a JSONL manifest for `pnpm pdf:bulk-load` from our PDFs at [path], keyed on programme code. Dry-run first and show me the match rate and the unmatched list before committing anything. Do not build a fuzzy filename matcher — KKU retired theirs after it mislinked about 30 programmes; unmatched PDFs get attached by hand through `/admin/programs/[id]?tab=files`.
> 3. Run `pnpm programs:digest` on three programmes of different levels. Show me the extracted digest for each, and specifically: does `program-digest.v1` handle our curriculum document format, or does it assume KKU's layout? Report any prompt changes you would need — but do not edit a published prompt version in place; a behaviour change means a new version constant.
> 4. Once I approve the sample, run `pnpm programs:digest-bulk` and report cost, failure count, and per-failure reason.
> 5. Build the skill taxonomy as `docs/guides/curriculum-pdfs-and-ai-digest.md` § *Building your skill taxonomy* describes. Run `pnpm skills:normalise --source=program_digest --auto-promote`, re-apply the sampled digests with `pnpm programs:digest <code> --force`, and report how many skills each programme now matches versus how many proposals stayed `NEW_PROPOSED` below the 0.9 auto-promote threshold. (`pnpm programs:approve-pending` will usually find nothing: digests are auto-approved by default, and on an empty taxonomy every skill is unmatched.)
>
> Then run `pnpm programs:pipeline <code> --skip=phase4` on one programme end-to-end (skipping phase 4 because our registrar connectors are not wired yet) and show me the resulting Deep-Dive page.
>
> **Done when:** every programme with an available PDF has an approved digest; the `PROPOSED_SKILL` queue count is reported as an analyst worklist; and one programme's Deep-Dive renders with real extracted content rather than empty states.

---

## Where AI assistance goes wrong here — be specific about this

An AI assistant is genuinely good at the mechanical work in this codebase: writing a connector by analogy to an existing one, sweeping a rename across a hundred files, writing transform tests from a fixture, drafting documentation. Use it for those.

It is **unreliable, confidently, on exactly the things the [traps page](../adopters/traps.md) flags**:

- **The spacing scale.** An AI trained on Tailwind will write `h-4 w-4` on an icon and `pl-9` for padding without hesitation. Both are wrong here in ways that produce no error — just wrong-sized output. Two separate defects in this repository came from precisely this. Instruct it to read `packages/design/src/tokens/spacing.ts` and `icon.ts` before touching any spacing or sizing utility.
- **Provenance stamping.** `ingestionRunId: ctx.runId` on every inserted row is easy to omit and produces a silently empty UI rather than an error. Make it an explicit acceptance criterion on every connector prompt.
- **Schema decisions.** Whether a new field is a column, a JSONB blob, or a new table; whether a migration is additive or destructive; how a unique constraint interacts with Postgres's NULL semantics — these need a human. The codebase already has hard-won answers here (manual `findFirst → update | create` upserts where a compound unique key carries NULL, for instance) that an AI will not reinvent.
- **Methodology weights.** These encode institutional value judgements about which programmes matter and why. An AI will produce plausible weights instantly. Plausible is exactly wrong for a number that closes a programme.
- **PDPA posture.** An AI will happily write `SELECT *`. Every projection is a trust boundary and needs human sign-off, and your DPO's, not the model's.
- **"Fixing" deliberate omissions.** The absent `3.5` spacing step, the null-not-zero rule, the deprecated-but-retained catalog entries — all look like bugs and are not. The code comments explain why; make sure the AI reads them.

A practical rule: let the AI write, and read what it wrote in the six categories above yourself, every time.

## Next step

Continue with [Fork and take upstream fixes](./upstream-fixes.md).
