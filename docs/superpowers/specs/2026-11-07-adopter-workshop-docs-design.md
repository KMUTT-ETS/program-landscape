# Adopter workshop documentation: design

Date: 2026-11-07. Status: draft for owner review.

## Intent

A 1.5-day hands-on workshop teaches IT staff from an adopting university to set
up Program Landscape and work on its **Program Deep-Dive** module. The
documentation for it lives on the adopter doc site (`apps/docs-site`, rendered
from `docs/`). Participants use it in the room, step by step, and on their own
afterwards. A participant who missed the day, or wants to repeat it at home,
must be able to follow the same pages to the same result.

The agenda is fixed by the owner:

1. Check the local environment and AI tools.
2. Platform architecture and source code: system structure and preparing the
   starter project from the GitHub repository.
3. University data connection: connecting data through an API, data mapping,
   and using mock data.
4. Hands-on integration with AI: AI coding prompts, connecting to an API and the
   database, and basic error handling.
5. Vibe coding with AI for curriculum analytics: building an analysis function
   and a display (dashboard section or visualisation).
6. System testing, validation and security: checking formulas and results
   against a benchmark; data masking and access rights.

## Who reads it

University IT staff. They are comfortable with a terminal and code but have
never seen this codebase. **They arrive with a clean laptop**: no Docker, no
Node, no clone. Most will be on Windows. Facilitators read a separate page.

## What a participant leaves with

- **Everyone:** the Deep-Dive running on their own laptop, with a synthetic
  sample dataset.
- **Optional, for those who prepared files:** the same Deep-Dive with their own
  university's data loaded, replacing or alongside the sample.
- **From sessions 4 and 5:** a connector they wrote with AI help against a mock
  API server, and a new analysis shown on the Deep-Dive.

## Decisions made by the owner

- **Clean machine.** Installing the toolchain is part of the documentation, not
  a prerequisite.
- **Two data tracks.** A sample-data track everyone completes, and a real-data
  track for those who prepared their files. The sample track is the safety net.
- **A mock API server** stands in for a university system in sessions 4 and 5,
  so participants prepare nothing for the coding sessions.
- **AI tool: whatever each participant already has.** Anyone without one uses
  the free **opencode**. Prompts in the docs must therefore work in any
  assistant: plain-language prompts to paste, never tool-specific commands.
- **Everything is on `main`.** Participants clone `main` of this repository.
  The adopter work on `feat/generic-adoptor` must be merged before the
  workshop, along with everything this design adds.
- **Length: 1.5 days. Date: about two weeks from 2026-11-07** (around
  2026-11-21). See "Priority under the deadline".
- **The sample track uses a real AI key and the real pipeline.** The repository
  provides only mocked **institution-specific** data: the synthetic
  university's spreadsheets and curriculum PDF. It does **not** ship AI results
  or pre-computed pipeline output. Participants run the pipeline and the public
  connectors themselves, with their own key and over the network.
- **The room network is uncertain.** Heavy downloads move to pre-work done at
  home (dependencies, Docker images, a first `pnpm setup`). **No offline USB
  bundle.**
- **The storyline of sessions 4 and 5 is undecided.** This covers what the mock
  API serves, which table the connector writes, and what the new analysis
  shows. See "Open: the coding storyline" below. The design keeps a slot for it
  and must not hard-code a choice.

## Goals

1. One page per agenda session, in English and Thai, each with: goal, time,
   prerequisites, numbered steps, a "you are done when" check, prompts to copy
   (sessions 4 and 5), and a short table of failures and fixes.
2. A participant on a clean Windows laptop can reach a running app from the docs
   alone. That needs a WSL2 page, which the published site lacks today.
3. A synthetic sample dataset ships in the repository, so the sample track
   needs no file from any university.
4. A mock API server and a reference solution ship in the repository, so anyone
   who falls behind in session 4 or 5 can catch up and continue.
5. Session 6 has published expected values for the sample dataset to check
   against.
6. A facilitator page: schedule, what to send in advance, room setup, timing
   risks and recovery plans.

## Non-goals

- Slides, videos, or a printed handbook. The doc site is the handout.
  Facilitators may make slides from it.
- Production deployment. `DEPLOYMENT.md` remains the reference. The workshop
  runs on laptops.
- Modules other than the Deep-Dive, except where the Deep-Dive needs them
  (Setup checklist, data import, pipeline).
- SSO setup.

## Anti-goals (failure even if it "works")

- **Duplicating the existing tutorials.** Session pages link to
  `getting-started.md` and `program-deep-dive.md` for shared steps. Gaps are
  fixed in those tutorials, so there is one copy of each instruction.
- **Real or personal data in the repository.** The sample dataset is fully
  synthetic. Do not copy from `kmutt-data/`: it is gitignored, local, and may
  hold real records.
- **A workshop stalled by one participant's key.** A key that fails or runs out
  of credit in the room must not end someone's day. *Designer's call:* the
  facilitator holds a spare, budget-capped key to lend, and the docs say how to
  check a key works before the day. (`AI_PROVIDER=stub` keeps the app running
  but cannot run the pipeline, so it is not a recovery for session 3.)
- **Pages the participant cannot finish in the time given.** Long-running steps
  (pipeline about 20 min per programme, `skills:normalise` about 1 h, embedding
  quotas on free Google keys) are scheduled so they run while something else is
  taught, or moved to pre-work. They are not replaced with prepared output.
- **Teaching patterns that break the project's rules.** Exercises must respect
  CLAUDE.md: provenance, freshness and confidence badges on charts,
  `@AuditLog` on mutations, `@AiCall` on AI calls, design tokens only, no
  `any`, Zod at I/O boundaries, `realDataWhere()` provenance on loaded rows.
- **Retired product names** anywhere. The `check-site` build step enforces this.

## Constraints

- **Doc site rules** (`apps/docs-site`):
  - New pages must appear in `.vitepress/sidebar.ts`, or the build fails.
  - Bilingual pages go in `BILINGUAL_PAGES` in `src/manifest.ts`. The Thai twin
    must have the same `##`/`###` heading count and **byte-identical code
    blocks**, with a cross-link near the top of each page.
  - Dead links fail the build.
  - Run `pnpm docs:build` after changes.
- **Language.** Under the docs' bilingual rule, the English page carries the
  structure and the Thai twin is complete. Code, commands and prompts in code
  blocks are identical in both, so prompts inside code blocks are in English.
- **PII policy** (organisation policy and PDPA). Sample data and fixtures carry
  no personal data. Any example with a person uses tokens such as
  `[STAFF_001]`. Session 6 teaches this rule explicitly.
- **Cross-platform.** Commands work in WSL2 and macOS/Linux shells. No
  Makefile and no `rm -rf` in scripts, per CLAUDE.md.

## Existing material to build on

| Page | Use |
|---|---|
| `docs/tutorials/getting-started.md` (+ `.th`) | Session 1–2 setup steps. Extend it with tool installation and a link to the new WSL2 page; do not copy it. |
| `docs/tutorials/program-deep-dive.md` (+ `.th`) | Session 3 sample/real data steps 1–8. |
| `docs/tutorials/workshop.md` (+ `.th`) | Today's half-day, bring-your-own-files facilitator guide. Replace it with the new facilitator page, and keep its failure table, which is good. |
| `docs/data-import.md` (+ `.th`) | Templates and column reference for the real-data track. |
| `docs/tutorials/adapt-the-registrar-connector.md` | Background for session 4 (KKU-specific, advanced). |
| `docs/adopters/README.md` | Architecture and codebase layout for session 2. |
| `docs/auth/rbac.md`, `docs/pdpa.md`, `docs/security-review.md` | Session 6. |
| `prompts/WINDOWS-DEV.md` | Not published today. Source for the new WSL2 page. |

## Proposed structure

### Doc pages

A new sidebar group **Workshop**, placed after Tutorials, with pages under
`docs/workshop/`. Every page has an English page and a Thai twin, and is listed
in `BILINGUAL_PAGES`.

| Page | Content |
|---|---|
| `README.md` | What the workshop is, the two tracks, the schedule, and what to do before the day. |
| `00-before-the-day.md` | Pre-work checklist, done at home because the room network may be weak. Install the tools (WSL2, Docker, Node 20, pnpm 10, Git), clone `main`, run `pnpm setup` once (installs dependencies and pulls every Docker image), get an AI key **and confirm it works** (including a Google key for embeddings), install an AI coding assistant (or opencode with a free model), and for the real-data track, prepare files with personal data removed. Ends with one command that proves the laptop is ready. |
| `01-environment-and-ai-tools.md` | Session 1. Check each tool, run `pnpm adopter:fresh-check`, and confirm the AI assistant works (a "hello repo" prompt). |
| `02-architecture-and-source.md` | Session 2. Monorepo tour (web, api, ingestion, packages), request path of one Deep-Dive section, Council-readiness rules, start the app, claim the admin. |
| `03-university-data.md` | Session 3. Sample track: load the sample dataset, run the public connectors, attach the sample PDF, run the pipeline with the participant's own key, work the Setup checklist, open the Deep-Dive. Real-data track: the same with own files. Introduce the mock API server: what it is and how to start it. |
| `04-integration-with-ai.md` | Session 4. Write the connector with AI help: prompts, data mapping, error handling (`NonRetryableError`, retries), provenance, tests. Content waits on the storyline. |
| `05-curriculum-analytics.md` | Session 5. Build the analysis function and the Deep-Dive section with a chart and its badges. Content waits on the storyline. |
| `06-testing-and-security.md` | Session 6. Run tests, compare against expected values, access control (roles, aggregates-only staff view), data masking (national-ID scan on import, group-size floor, AI output scrubber, log redaction). |
| `troubleshooting.md` | One place for failures, merged from the three tables in existing pages. |
| `facilitator.md` | Schedule with times, room and network needs, pre-flight tasks, recovery plans, and what to run before the day. |

Plus `docs/guides/windows-wsl2.md` (+ `.th`), published from
`prompts/WINDOWS-DEV.md`, and linked from getting-started and session 1.

`docs/tutorials/workshop.md` is replaced: it redirects to the Workshop group,
or is removed with its links fixed.

### Proposed schedule

| Block | Sessions |
|---|---|
| Day 1 morning | 1 and 2. Exit check: app running, admin claimed. |
| Day 1 afternoon | 3. Exit check: Setup checklist ready and the Deep-Dive showing the sample programme. Real-data track continues with own files. Mock API started. |
| Day 2 morning | 4 and 5. |
| Day 2 midday | 6, then wrap-up. |

### Supporting code (in the repository, on `main`)

| Item | Purpose |
|---|---|
| Synthetic sample dataset (XLSX per import dataset, plus a curriculum PDF) | Sample track for session 3. A neutral, invented university (*designer's call*: not shaped on KMUTT or any real institution), a few programmes, one of them the "workshop programme" taken through the pipeline. Institution-specific data only: no AI output, no public-connector data. Committed, so no personal data. |
| Mock API server | Sessions 3–5. Starts with one `pnpm` command and no install beyond the repo. Its data and endpoints wait on the storyline. |
| Reference solution | Sessions 4–5, so anyone behind can catch up. Its form is the builder's call: a branch, a folder, or a patch. |
| Expected-values table | Session 6 benchmark: the correct figures for the sample dataset, with how each was computed. |
| Facilitator pre-flight script (optional) | Checks a laptop in one command: versions, ports, disk, Docker, AI key reachable. Could extend `adopter:fresh-check`. |

## Open: the coding storyline (sessions 4 and 5)

The owner has left this undecided. Once chosen, it fixes:

- what the mock API serves (which university system it pretends to be), its
  data shape, and the deliberate messiness (field names, Buddhist-era years,
  code mapping, pagination, auth, bad rows, intermittent errors);
- which table the connector writes, preferably an existing one so participants
  avoid migrations;
- what the new analysis computes, and the Deep-Dive section that shows it;
- the expected values for session 6;
- how the API data and the session-3 sample data avoid writing the same rows.

The proposal discussed (not chosen): a student information system API feeding
enrolment figures, and a "Retention and completion" section.

Until this is decided, session 4 and 5 pages, the mock server data and the
reference solution cannot be written. Everything else can.

## Priority under the deadline

About two weeks. *Designer's calls* on sequencing:

- **Build now, on `feat/generic-adoptor`**, so it merges to `main` with the
  adopter work: everything not blocked by the storyline. That is pages 00–03,
  the security half of 06, troubleshooting, facilitator, the WSL2 page, the
  sample dataset and the tutorial gap fixes.
- **Blocked until the owner picks the storyline:** pages 04–05, the benchmark
  half of 06, the mock server's data, the reference solution and the expected
  values. The storyline needs deciding within the first few days, or these
  will not be ready and tested.
- **Expected values are computed after the merge to `main`**, from the formula
  versions then in force (e.g. health score), not before.
- **If time runs short, cut in this order:** the merged troubleshooting page
  (link the existing tables instead); then the optional pre-flight script; then
  Thai twins of pages 04–06 (ship them English-only, outside
  `BILINGUAL_PAGES`, and add the twins after the workshop). Pages 00–03 keep
  their Thai twins.

## Long-running steps (session 3)

The sample track runs the real pipeline, so time is the main risk. The builder
schedules around these measured costs (KMUTT verification, 2026-11-03):

- Pipeline: about 20–25 min and USD 0.40–0.80 per programme. Start it at the
  start of a teaching block, not the end.
- `pnpm skills:normalise --source=linkedin --auto-promote`: about 1 h, about
  USD 1.50, and only after the `kmitl-skill-mapping` connector has run.
- Free-tier Google keys embed about 1,000 course texts a day; the sample
  programme must stay well under that.
- `kmitl-skill-mapping` needs KMITL credentials, which participants may not
  have.

*Designer's call:* the "done when" check for session 3 is defined as what the
sample programme reaches **without** KMITL credentials, and the page names the
checklist items that stay not-ready for that reason. If the facilitator can
supply KMITL access, the page says how to go the extra step.

## Room and machines

- *Designer's call:* Docker Engine inside WSL2 is the main instruction, with
  Docker Desktop as an alternative. Desktop's licence terms are unclear for
  university staff.
- Pre-work states minimum laptop specs (RAM, free disk) and the download size.
- The room still needs internet for AI providers and the public connectors.
  The facilitator page says so and lists the hosts to allow through a firewall.

## Left to the builder

- Wording, and how Thai terms are chosen (`docs/glossary-th-en.md`).
- The form of the reference solution.
- Which free model opencode uses. Verify it shortly before the workshop.
- *Designer's call:* `docs/tutorials/workshop.md` becomes a short redirect to
  the Workshop group, so existing links keep working.
- How the synthetic dataset is generated (a script that can regenerate it is
  preferred over hand-made files).
- Screenshots: whether to use them, and if so, from the sample dataset only.

## Done when

- Every page builds under `pnpm docs:build` with twins passing `check-site`.
- Someone not involved in writing follows the pages on a clean Windows laptop
  and reaches each session's "done when" check on the sample track, using their
  own AI key.
- The sample dataset, mock server and reference solution are on `main`, with
  tests where they contain logic.
