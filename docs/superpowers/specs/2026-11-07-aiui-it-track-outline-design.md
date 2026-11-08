# AIUI workshop — IT track activity outline (design)

Status: draft for instructor approval · 2026-11-07
Source: ทปอ. AIUI project proposal and agenda (`workshop-agenda.pdf`, letter ทปอ.๖๙/ว๐๗๖๐),
existing `docs/workshop/` pages, `workshop/pre-workshop-preparation.pdf`.

## 1. Intent

ทปอ.'s *AI for University Intelligence* (AIUI) programme brings ~50 university teams
(1 executive + 2 IT staff each) to a 2-day onsite workshop, 23–24 Nov 2569, Mercure
Rajthevi. The IT staff build a **Working Prototype** that processes their own
university's programme data. **Program Landscape is the starter project every team
sets up and builds on.** The instructor runs the IT room; this document is the
activity outline for that room, from the pre-workshop to the hand-off into the
90-day plan.

The why: ทปอ. promises each university a prototype that works on its own data, a
Test Record, and a plan to try it for real. A team that leaves with a polished
extension but no working Deep-Dive has failed. A team that leaves with a working
Deep-Dive on honestly labelled data has succeeded.

## 2. Goals, non-goals, anti-goals

**Goals (per team, at the Day 2 demo):**
1. **Must:** the Program Deep-Dive page runs on their laptop for at least one of
   their own programmes, with content computed by the real pipeline.
2. **Stretch:** an additional analysis built on data the team added themselves,
   shown in the Deep-Dive or as a dashboard.
3. A Test Record (validation + security checks) and a 90-day plan agreed with
   their executive.

**Non-goals:** deploying to the university's server during the workshop (that is
the 90-day plan); more than one programme per team; touring the other seven
modules; teaching TypeScript/NestJS from scratch.

**Anti-goals (failure even if everything "works"):**
- Mock figures shown or read as the university's real results.
- Personal data (national ID, names + student IDs, birth dates, contacts) on a
  laptop or in an AI prompt.
- Teams spending Day 1 afternoon on the stretch goal while their Deep-Dive is
  still empty.
- The instructor becoming the single point of help for 100 people.

## 3. Constraints

- **Agenda is fixed by ทปอ.** (see §5 for blocks and their official deliverables).
  IT staff have ~5¾ h hands-on on Day 1, but on Day 2 they are in joint lectures
  09:00–12:00 and only have 13:00–16:00 in their own room.
- **Scale:** ~100 IT participants, ~50 teams. **Staff:** 1 instructor + at least 3
  helpers.
- **Data states.** Teams arrive in one of three states, decided at the pre-workshop:
  - **A — real:** own de-identified exports for one programme + its curriculum PDF.
  - **B — mixed:** some real files; gaps filled by `pnpm workshop:mock`.
  - **C — mock:** a full mock set for their own university from `pnpm workshop:mock`
    (TCAS names/figures are real; everything else invented and labelled mock).
- **AI tools unconfirmed.** ทปอ. promised an AI coding tool + sandbox; not confirmed.
- **Pipeline:** ~20–25 min and ~USD 0.40–0.80 per programme; `un-wpp` downloads ~68 MB.
- **Laptops, not cloud.** The agenda's registration block checks the "Local
  Environment"; the pre-workshop deck installs locally (16 GB RAM, 25 GB disk,
  WSL2/Docker).
- **Not yet built** (CLAUDE.md "PENDING"): Session 4–5 pages, the mock API server,
  a reference solution, a clean-laptop dry run.

## 4. Decisions

Decided by the instructor:
- Program Landscape is the common starter project.
- Demo success = Deep-Dive with data (must) + extra analysis/dashboard (stretch).
- Pre-workshop online on **16 Nov** (one week before) asks teams to prepare their own data; the
  mock generator is handed out there; partial mock is acceptable.
- AI tools: plan for both (ทปอ. tools or teams' own).
- At least 3 helpers.

My calls (the instructor may override):
- **AI-tool baseline.** Each team brings a capped Gemini key (pipeline + embeddings)
  and opencode with a free model, as the current pages teach; Claude Code / Copilot /
  Cursor are fine if a team already has them. If ทปอ. confirms its tools **before
  the pre-workshop on 16 Nov**, they replace opencode in Sessions 4–5 and
  team keys; otherwise everyone runs the baseline. Instructor holds a few capped
  spare keys.
- **No sample-track in the room.** The Workshop Demo University sample run moves to
  the pre-work as the readiness proof (it proves the key, Docker and the pipeline
  in one go). Day 1 loads the team's own A/B/C data only.
- **Pipeline starts before lunch on Day 1**, so lunch absorbs the long step.
- **The extra data comes through a connector.** The mock API server plays one
  university system serving **aggregate student-progression data** (cohort
  retention, drop-out by year, on-time graduation — the agenda's "Academic
  Progression File"; no row-level students). Teams with a real API may point the
  connector at it instead. This makes the Day 1 afternoon blocks one continuous
  build: connector (Session 4) → analysis + display (Session 5).
- **Demo in pods**, not plenary (§6).
- **Each team works on one "build laptop"** that hosts the demo; the second member
  drives the AI assistant and docs on their own laptop, and has a second working
  install as a backup.

## 5. Outline

### 5.0 Early notice (≈ 11 Nov), pre-workshop (online, 16 Nov) and homework

The pre-workshop leaves only a week, too short for data requests to a registrar or HR
unit. So as soon as ทปอ. confirms the team list (registration closes 10 Nov), the
instructor sends a **short early notice** asking teams to: pick one programme; request
its exports and the curriculum PDF from the data owners now; and make sure a laptop can
run WSL2/Docker (or that a personal one is available). Installation can start from the
pre-workshop deck the same day.

| Item | What happens | Team leaves with |
|---|---|---|
| Orientation (≈ 90 min, online) | The goal and demo criteria; the 3 data states; the PII rules; walk through the pre-workshop deck; live demo of `pnpm workshop:mock` + `workshop:check-mock`. | Their state (A/B/C) and the one programme they will use. |
| Homework 1 — install | Deck sections 1–3: tools, `pnpm setup`, `adopter:fresh-check`, AI key test, AI assistant reads the repo. | A working install. |
| Homework 2 — rehearsal | Sample track of Session 3 once (Workshop Demo University → `WDU-CPE-BE` Deep-Dive). | Proof that key + pipeline work; ~USD 0.5 spent. |
| Homework 3 — data | A: export + de-identify per deck §4 checklist. B/C: write `my-university.json`, run the generator, pass `workshop:check-mock`. All: curriculum PDF passes `pnpm curriculum:check`. Run `un-wpp` and `tcas` at home (cached in the local DB). | Upload-ready files for one programme. |
| Readiness form (deadline **19 Nov**, 18:00) | Deck §5 evidence + state A/B/C + which files are real vs mock + blockers. | — |
| Instructor triage (19–21 Nov) | Chase non-responders; sort teams into **green / amber / red**; pick 8–10 **table captains** from the strongest green teams; seat red teams near the infrastructure helper. | Seating plan, captain list. |

### 5.1 Day 1 — Mon 23 Nov (IT only)

| Time | Agenda block | Activity (doc page) | Exit check (team self-checks) | Agenda deliverable |
|---|---|---|---|---|
| 08:30–09:00 | Registration & readiness | Run the deck's ready check on the build laptop; `docker compose ps` healthy; AI key answers. Red teams go straight to the infrastructure helper. | All checks green, or ticket raised. | Participants and equipment ready |
| 09:00–10:30 | Platform Architecture & Source Code | 09:00 instructor demo: the Deep-Dive in 2 min, the 3 data states, demo criteria, how to ask for help. 09:15 **Session 2** (Session 1 condensed to its exit check): the parts, trace one Deep-Dive section end-to-end with the AI assistant, the rules every change follows (provenance, scope, audit, methodology version). 10:15 start the app, **claim the administrator**. | App runs at localhost; team is SUPER_ADMIN. | System structure + starter code |
| 10:45–12:00 | University Data Connection | **Session 3, own-data path**: organisation profile (Thai name exact to TCAS); upload files in order; fix refusals from the error messages; run `tcas`; attach PDF as `CURRENT_CURRICULUM`; **start the pipeline by 11:45**. Short live walkthrough of how the importer maps columns (the "data mapping" the agenda names). | All uploads in history; pipeline **running** before lunch. | API / mock data connected |
| 12:00–13:00 | Lunch | Pipelines run. Helpers watch the ticket queue for failed runs. | — | — |
| 13:00–14:30 | Hands-on Integration with AI | 13:00 **checkpoint**: pipeline done, Setup checklist green, Deep-Dive renders → the must-have is met (post ✅ to the status sheet). 13:15 **Session 4 (new)**: start the mock API; with the AI assistant, write a connector that reads it — API call, Zod validation, error handling (timeouts, bad rows), data-source catalogue entry, ingestion run. Live coding by the instructor for the first 15 min, then teams. | Connector run lands rows visible in the app (not filtered as mock-hidden); bad input produces a clear error. | Prototype that fetches and reads real data |
| 14:45–16:00 | Vibe Coding for Curriculum Analytics | **Session 5 (new)**: with the AI assistant, add one analysis on the progression data (e.g. retention trend vs. a threshold the executive will set) and display it — a Deep-Dive panel or a dashboard page — with provenance, freshness and a methodology version. Teams still red on the must-have spend this block finishing the Deep-Dive with a helper instead. | New panel shows for their programme with a provenance drawer. | Curriculum analysis function + screen |
| 16:00 | Close | Each team posts status: Deep-Dive ✅/❌, connector ✅/❌, analysis ✅/❌. | — | — |

### 5.2 Day 2 — Tue 24 Nov (joint with executives)

| Time | Agenda block | IT activity | Exit check | Agenda deliverable |
|---|---|---|---|---|
| 08:30–09:00 | Registration | **Rescue window**: helpers go to teams that were ❌ at 16:00 Day 1. | — | — |
| 09:00–12:00 | Joint lectures | IT attend with their executive. Pipelines/reruns may run in the background. Teams note which Deep-Dive sections answer the questions the executive raises — input for the afternoon sync. | — | — |
| 13:00–14:30 | System Testing, Validation & Security | **Session 6, extended** into a **Test Record** (template to write): (1) run the relevant tests; (2) **validate** 3–5 Deep-Dive figures against a known benchmark — the registrar's official numbers for state A, the generator's input/README for B/C; (3) access rules — a faculty-scoped user cannot see another faculty; (4) **data masking** — show no PII in uploads, AI inputs or logs; (5) for the connector: a bad response is rejected, not stored. | Test Record filled and saved in the repo. | Test Record + data review |
| 14:45–15:30 | Prototype Demonstration | **4 pods** (instructor + 3 helpers), ~12–13 teams each, **3 min per team**: open the Deep-Dive → open one provenance drawer and say which data is real and which is mock → show the extra analysis if built. Pod leader scores on the 5 ทปอ. criteria (meets the question, accuracy, works, security, ready to extend) and gives one improvement. | Pod score sheet per team. | Working Prototype demonstrated (≥ 1 programme) |
| 15:30–16:00 | Team Alignment + Next Steps | IT shows the executive the prototype; together they map the Decision Brief's strategic questions to Deep-Dive sections / the new analysis, and set the thresholds. Instructor closes with the 90-day plan template: swap mock → real data, deploy (`DEPLOYMENT.md`), 4 online clinics, Online Showcase. | Decision Brief cross-checked; 90-day plan drafted. | Agreed Decision Brief + 90-day plan |

### 5.3 After the workshop (90-day cadence, summary only)

Four online clinics, roughly every 2–3 weeks: (1) real data swap and the importer,
(2) deploying to the university's server, (3) extending the analysis to what the
Decision Brief asks, (4) Test Record update before the Online Showcase. Outstanding
participants become network mentors (Train-the-Trainer).

## 6. Running the room

- **Self-serve first.** Every block has an exit check on its page; help is for a
  failed check, not for reading the page aloud.
- **Help queue.** One shared sheet/channel: `table · team · session · exit check
  failed · what you tried`. Helpers take tickets in order; anything not fixed in
  5 minutes goes to the instructor.
- **Roles.** Instructor: front of room, live demos, escalations. Helper 1:
  infrastructure only (network, Docker/WSL, laptops) on Day 1 morning, then
  floor. Helpers 2–3: floor, by table group. Table captains: first-line help at
  their table.
- **Status sheet** (one row per team, ✅/❌ per milestone) visible on a second
  screen, so the instructor can see who is stuck without walking the room.
- **Hard checkpoints:** pipeline running before 12:00 Day 1; Deep-Dive ✅ by 13:15
  Day 1; ❌ teams handled first on Day 2 at 08:30.

## 7. Risks

| Risk | Mitigation |
|---|---|
| Room network with 100 laptops | Give the host list (`facilitator.md`) to the venue ahead of time; heavy downloads (`pnpm setup`, images, `un-wpp`, TCAS cache) done at home; generator `--offline`; ask ทปอ. for a wired/dedicated SSID. |
| University-managed laptops block WSL2/Docker | Found at the readiness deadline; team uses the second member's or a personal laptop. |
| Pipeline concurrency / key quotas | One key per team; staggered start by table if the provider throttles; spare capped keys. |
| ทปอ. tools arrive late or differ | Baseline is independent of them; switch only if confirmed by the pre-workshop on 16 Nov. |
| Session 4–5 pages, mock API and reference solution not built yet | Build first, before anything else (see §8); the dry run must include them. |
| Mock data from the API hidden in the UI (`realDataWhere()` hides sources with `mocked = true`) | Decide how the mock API's data source is flagged so its rows **show** but are visibly labelled as mock (provenance/caveat), and test it in the dry run. |
| Real data with PII | Deck §4 checklist + Session 6 masking check; helpers refuse files with national IDs or birth dates. |
| Teams in state A hit many import refusals | Seat state-A teams near a helper during 10:45–12:00; refusals name row/column. |

## 8. Work this implies (for the plan)

1. Update `docs/workshop/facilitator.md` (+ `.th.md`) schedule to §5 and the room
   plan in §6; README schedule table to match the 2-day agenda.
2. Update `00-before-the-day` to include the sample-track rehearsal and the
   readiness form fields (state A/B/C).
3. Update `03-university-data` so the own-data path is primary and the pipeline
   starts before lunch.
4. Build the mock API server (progression aggregates) + write **Session 4** and
   **Session 5** pages (bilingual) + a reference solution branch.
5. Extend `06-testing-and-security` with the validation step and a **Test Record
   template**; add a **demo script + pod score sheet** and a **90-day plan
   template**.
6. Clean-laptop dry run of the whole Day 1 under time, ideally with 2–3 volunteers.

## 9. Settled after builder review (my calls unless noted)

- **What the extra data is and where it lands.** `EnrollmentMetric` already holds
  retained-year-2, dropouts and on-time/late graduation per year and is filled by the
  `enrollment` XLSX import, so the connector must **not** write there (same unique
  key; it would fight the import). The mock API instead serves what the app does not
  have yet: **per entry cohort × year level — GPAX mean/distribution buckets and
  drop-outs by year level** (aggregates, no row-level students). It lands in **one
  new minimal Prisma model + migration that ships pre-built on the workshop branch**,
  together with its `DataSource` catalogue entry. Teams do not write migrations.
- **How much teams write in Session 4.** A **connector skeleton** ships on the
  workshop branch (class registered, bundle target added, catalogue entry,
  `ingestionRunId` wiring). Teams fill in, with the AI assistant: the HTTP call, the
  Zod schema, mapping to the model, error handling. That is what fits 75 minutes for
  ~100 people. The reference solution is the filled-in skeleton.
- **Keying onto each team's programme.** The mock API answers for **any programme
  code** it is asked about, generating deterministic figures seeded by the code, and
  it labels every payload `"mock": true`. A team with its own real API documents an
  adapter to the **same JSON shape**. That shape is the contract.
- **Visibility and labelling.** No change to `realDataWhere()` or other core code. The
  workshop data source is registered `mocked = false` (so rows show, the same
  convention the `workshop:mock` XLSX files follow), and its provenance caveat and
  source name say "workshop mock API". Test Record step 2 for the analysis compares
  against the mock API's own response for that code.
- **Delivery order.** (1) The early-notice text by **≈ 11 Nov**. (2) Pre-work
  changes (`00-before-the-day`, readiness form fields, the sample rehearsal, a
  working `workshop:mock`) by **15 Nov**, the day before the pre-workshop. (3) The
  mock API, skeleton, Sessions 4–5 and the reference solution by **≈ 19 Nov**.
  (4) Templates (Test Record, demo script + pod score sheet, 90-day plan) and the
  facilitator update by **≈ 20 Nov**. (5) Dry run **≈ 20–21 Nov**, with the opencode
  free model at full Session 4–5 size. If the free model can't do it, the fallback
  is opencode using the team's Gemini key, and that goes into the pages. The dry
  run leaves only 1–2 days for fixes before 23 Nov.
- **Artefact formats.** Templates (Test Record, demo script, pod score sheet,
  90-day plan) are repo markdown under `docs/workshop/`, bilingual. The readiness
  form, status sheet and help queue are a Google Form/Sheet the instructor creates;
  the pages list their fields. The pod score uses ทปอ.'s 5 criteria from the
  proposal (§3.5.2) on a 1–3 scale each.
- **Decision Brief.** It is the executive track's deliverable (Track B, Day 2
  13:00–15:30, owned by ทปอ.'s programme). The IT track does not write or template
  it. IT only brings the prototype to the 15:30 sync.

## 10. Left to the builder

Exact wording of pages; the mock API's endpoints and payload shape (within
"aggregate progression data, no row-level students"); the analysis the reference
solution implements; the format of the status sheet and help queue; minute-level
timing inside each block.
