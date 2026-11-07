# AIUI Plan 1 — Early notice and pre-work Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everything participants need between team confirmation (≈ 11 Nov) and the readiness deadline (19 Nov): an early-notice page, a reworked pre-work page with a sample rehearsal and the A/B/C data states, a corrected schedule, and an updated pre-workshop deck.

**Architecture:** Docs-only. Bilingual workshop pages under `docs/workshop/` rendered by the VitePress docs site; `check-site.ts` enforces Thai twins, mirrored structure, live links and no retired names. The deck in `workshop/` is edited with the `pptx` skill.

**Tech Stack:** Markdown, VitePress docs site (`apps/docs-site`), pptx skill.

**Spec:** `docs/superpowers/specs/2026-11-07-aiui-it-track-outline-design.md` (§5.0, §9 delivery order). Plans 2 (mock API, connector skeleton, Sessions 4–5) and 3 (templates, facilitator, dry run) follow separately.

## Global Constraints

- Deadlines: early notice sendable by **11 Nov**; all of this plan done by **15 Nov**. Pre-workshop online **16 Nov**; readiness form deadline **19 Nov, 18:00**; workshop **23–24 Nov 2569**.
- Every new/changed English page under `docs/workshop/` has a Thai twin `<name>.th.md` with the same heading structure, linked both ways; new pages are listed in `BILINGUAL_PAGES` (`apps/docs-site/src/manifest.ts`).
- Product name only "Program Landscape"; never the retired names (check-site fails on them).
- No PII in any page or deck: no names, phone numbers or e-mails of coordinators or participants. Where contact details are needed write the placeholder `[instructor contact]`.
- Data rules copied from the spec: no national ID numbers, birth dates, addresses or phone numbers in exported files; names + student IDs never together.
- Plain, step-by-step English at the level of the existing workshop pages; Thai twin in the same register as `00-before-the-day.th.md`.
- Commits: conventional (`docs(workshop): …`), via `git commit -F <file>`, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. A team with **no data access at all** reading the early notice — it must say plainly that state C (full mock) is a full success path, so nobody drops out. → Task 1 content check.
2. A participant who **already claimed the administrator during the rehearsal** — Day 1 must not tell them to claim it again; the page says they will sign in with the same account. → Task 2 content check.
3. A participant whose rehearsal pipeline **fails or runs out of key credit** — the page says to report it on the readiness form, not to keep retrying with spend. → Task 2 content check.
4. A participant who mixes **sample (WDU) and own data** in one database — the page says they live side by side and the sample stays until Day 1. → Task 2 content check.
5. Thai twin **drifting in structure** from the English page → `pnpm docs:build` (check-site) in every task.

---

### Task 1: Early-notice page

**Files:**
- Create: `docs/workshop/early-notice.md`, `docs/workshop/early-notice.th.md`
- Modify: `apps/docs-site/src/manifest.ts` (add `'workshop/early-notice.md'` to `BILINGUAL_PAGES`, before `'workshop/00-before-the-day.md'`)
- Modify: `docs/workshop/README.md` + `README.th.md` "Pages" table — new first row: `[Early notice](./early-notice.md)` · "As soon as your team is confirmed".

**Interfaces:**
- Produces: page `workshop/early-notice.md` with anchors `#this-week`, `#pick-your-data-path` that Task 2 and the deck link to.

- [ ] **Step 1: Write the page.** Sections, in order:
  - `# Early notice: start this week` — one paragraph: workshop dates, the pre-workshop online on 16 Nov, the readiness form due 19 Nov 18:00, the demo goal (Deep-Dive of one of your programmes with data; extra analysis if time).
  - `## This week` — three numbered actions: (1) pick one programme; (2) ask the data owners (registrar, HR, finance, graduate-outcome unit) now for its exports and the current curriculum PDF, linking `../data-import.md` for the dataset list; (3) check the laptop can run WSL2 + Docker (link `../guides/windows-wsl2.md`), else arrange a personal laptop. Then: "You can start installing now with [Before the day](./00-before-the-day.md)."
  - `## Pick your data path` — table of states A (real), B (mixed: real + `pnpm workshop:mock` fills gaps), C (all mock for your own university). Sentence: "All three paths reach the same demo. Choose C if you cannot get data in time." Link the generator section `./03-university-data.md#no-exports-generate-a-mock-set-for-your-university`.
  - `## Personal data` — the data rules from Global Constraints; files with national IDs or birth dates are refused in the room.
  - `## Questions` — "Contact `[instructor contact]`."
- [ ] **Step 2: Write the Thai twin** with the same headings in Thai, the same links (to `.th.md` twins where they exist), and the language note line both pages use (`> **ภาษาไทย:** …` / `> **English:** …`, copy the pattern from `00-before-the-day*.md`).
- [ ] **Step 3: Add to manifest and README tables** as listed under Files.
- [ ] **Step 4: Verify.** Run `pnpm docs:build`. Expected: exits 0, no dead-link, twin or retired-name errors.
- [ ] **Step 5: Paste-ready e-mail.** Append to the facilitator guide (`facilitator.md` + `.th.md`) a section `## Early notice e-mail` with a ≤ 120-word Thai e-mail body that links the early-notice page and states the three actions and the 16 Nov / 19 Nov dates. Re-run `pnpm docs:build`; expect exit 0.
- [ ] **Step 6: Commit** `docs(workshop): early notice page and e-mail` (files above).

### Task 2: Rework "Before the day" for the 16 Nov pre-workshop

**Files:**
- Modify: `docs/workshop/00-before-the-day.md`, `docs/workshop/00-before-the-day.th.md`

**Interfaces:**
- Consumes: Task 1 anchors `early-notice.md#pick-your-data-path`.
- Produces: anchors `#rehearse-once-with-the-sample-university`, `#prepare-your-programmes-data`, `#send-the-readiness-form` (used by the deck, Task 4).

- [ ] **Step 1: Intro.** Replace "the week before the workshop" with: start after the early notice, finish by the **readiness form deadline, 19 Nov 18:00**; the pre-workshop online on 16 Nov walks through this page. Keep the 1–2 hours estimate and add "plus about 30 minutes for the rehearsal".
- [ ] **Step 2: "Get the code and run setup once".** Delete "You do not need to go further. Claiming the administrator happens in the room." (the rehearsal now claims it).
- [ ] **Step 3: New section `## Rehearse once with the sample university`** after "Install an AI coding assistant". Content: run the **Sample track** of [Session 3](./03-university-data.md#sample-track) end to end (start the app, claim the administrator, upload the 13 sample files, run `un-wpp`, attach the PDF, run the pipeline for `WDU-CPE-BE`); it takes about 30 minutes, mostly the pipeline, and costs about USD 0.40–0.80; done when `/programs/<id>` for `WDU-CPE-BE` shows content in its Executive snapshot. Three notes (Review Focus 2–4): keep this database — on Day 1 you **sign in** with the administrator you created here, and the sample stays alongside your own data; if the pipeline fails twice or the key runs out of credit, stop and report it on the readiness form; `un-wpp` is now in your database, so you will not download it again in the room.
- [ ] **Step 4: Replace `## Real-data track: prepare your files` with `## Prepare your programme's data`.** First line links `early-notice.md#pick-your-data-path` for A/B/C. Keep the existing numbered steps 1–5 for state A/B real files. Add: "For datasets you could not get (state B) or for all of them (state C), generate them with `pnpm workshop:mock` as described in [Session 3](./03-university-data.md#no-exports-generate-a-mock-set-for-your-university), then run `pnpm workshop:check-mock` until it reports no errors." Add: check the curriculum PDF with `pnpm curriculum:check "<file.pdf>"`. Do **not** upload your own data yet; that is Day 1.
- [ ] **Step 5: Replace `## Check you are ready` with `## Send the readiness form`.** Keep the two commands and their expected output, then the list of what the form asks (the instructor shares the form link at the pre-workshop): operating system; `fresh-check` passed yes/no; sample Deep-Dive shows content yes/no; AI provider (Gemini/OpenRouter) and coding assistant; data state A/B/C; for each dataset, real or mock; the programme chosen and whether its PDF passed `curriculum:check`; anything still blocking. Close: deadline 19 Nov 18:00; do not paste keys, `.env` or personal data into the form.
- [ ] **Step 6: Thai twin** — mirror every heading change and content in `00-before-the-day.th.md`.
- [ ] **Step 7: Verify.** `pnpm docs:build` exits 0. Then `grep -n "Claiming the administrator happens in the room" docs/workshop/00-before-the-day*.md` returns nothing.
- [ ] **Step 8: Commit** `docs(workshop): pre-work rehearsal, data paths and readiness form`.

### Task 3: Correct the participant schedule in the workshop README

**Files:**
- Modify: `docs/workshop/README.md`, `docs/workshop/README.th.md` (intro sentence and `## Schedule` table)

- [ ] **Step 1: Intro.** "A 1.5-day hands-on workshop" → "a two-day workshop (23–24 Nov), with a pre-workshop online on 16 Nov".
- [ ] **Step 2: Replace the Schedule table** with these rows (Block | Session | Exit check):
  - Before (by 19 Nov) | Before the day: install, rehearsal, your data | Readiness form sent
  - Day 1 09:00–10:30 | 1–2. Environment, architecture and source | App running, signed in as administrator
  - Day 1 10:45–12:00 | 3. University data (your own A/B/C data) | Pipeline running before lunch
  - Day 1 13:00–14:30 | 4. Hands-on integration with AI | Deep-Dive shows your programme; connector run lands rows (page coming soon)
  - Day 1 14:45–16:00 | 5. AI-assisted curriculum analytics | Your new analysis shows with provenance (page coming soon)
  - Day 2 09:00–12:00 | Joint lectures with your executive | —
  - Day 2 13:00–14:30 | 6. Testing, validation and security | Test Record filled
  - Day 2 14:45–15:30 | Prototype demonstration | Demo given in your pod
  - Day 2 15:30–16:00 | Team sync and 90-day plan | Plan drafted with your executive
- [ ] **Step 3: "What you will have at the end"** — replace the sample-track bullet ("The Deep-Dive of a sample programme…") with "The Deep-Dive of one of your own programmes, from real, mixed or mock data", and keep the connector/analysis bullet.
- [ ] **Step 4: Thai twin** mirrored.
- [ ] **Step 5: Verify** `pnpm docs:build` exits 0.
- [ ] **Step 6: Commit** `docs(workshop): two-day schedule matching the AIUI agenda`.

### Task 4: Update the pre-workshop deck

**Files:**
- Modify: `workshop/pre-workshop-preparation.pptx`; regenerate `workshop/pre-workshop-preparation.pdf` from it.

Invoke the `pptx` skill first. Both files are untracked: show the user `git status` for them and ask whether to add them to git in the commit (default: yes).

- [ ] **Step 1: Slide 1 [VERIFY] box** → pre-workshop online 16 Nov; readiness form 19 Nov 18:00; contact `[instructor contact]`.
- [ ] **Step 2: Slides 15–17** ("script under development" / [VERIFY]) → the generator is ready: `pnpm workshop:mock my-university.json`, then `pnpm workshop:check-mock workshop-mock-out my-university.json`; output folder `workshop-mock-out/` with `README.txt`; point to the Session 3 page section. Remove every "[VERIFY]" and "ยังไม่ต้องรัน".
- [ ] **Step 3: Insert one slide after slide 17**: "ซ้อมครั้งเดียวด้วยมหาวิทยาลัยตัวอย่าง" summarising Task 2 Step 3 (≈ 30 min, ≈ USD 0.40–0.80, done when `WDU-CPE-BE` Deep-Dive shows content, keep the database).
- [ ] **Step 4: Insert one slide in section 4** on data states A/B/C (Task 1 table, Thai).
- [ ] **Step 5: Slide 29** ("ส่งหลักฐาน…") → the readiness-form fields from Task 2 Step 5 and the 19 Nov 18:00 deadline. **Slide 30**: replace "[VERIFY] ขอความช่วยเหลือ…" with `[instructor contact]`.
- [ ] **Step 6: Verify.** Render slides to images (pptx skill) and inspect each changed slide: no overflow, no "[VERIFY]" left. `python3 -c` text extraction (or the skill's tool) shows no phone numbers or e-mail addresses.
- [ ] **Step 7: Export PDF** and commit `docs(workshop): pre-workshop deck for 16 Nov` (with the user's answer on tracking the files).
