# Workshop mock data generator — design

Date: 2026-11-07. Branch: `feat/generic-adoptor`. Status: draft for owner review.

## Why

Workshop attendees arrive with one or two curriculum PDFs and their programme
names. Most cannot get their registrar, HR and finance exports in time. Without
those files the Deep-Dive stays empty and the Setup checklist stays red, so the
workshop cannot show the product working on their own university.

A Python script gives each attendee a complete set of upload-ready
spreadsheets. The spreadsheets describe a small, believable slice of the
attendee's own university. Public data still comes from the real connectors
(`tcas`, `un-wpp`, `kmitl-skill-mapping`). So the mock files must agree with
that public data: the same names, the same calendar, numbers of the same size.
Otherwise the two halves of the Deep-Dive contradict each other, or the
connectors match nothing.

## Who runs it, and when

Each attendee runs it on their own laptop, before or during the workshop. The
facilitator does not pre-generate anything. Requirements: Python 3.10+ and
`pip install openpyxl` (plus one PDF text library, see below). The workshop's
"send in advance" list gains this step.

## Goals

1. **Input:** the university's Thai name exactly as TCAS writes it, plus the
   Thai name of each programme the attendee brought a PDF for. For a
   postgraduate programme (TCAS lists bachelor programmes only) the attendee
   also gives its faculty's Thai name and its level.
2. **Output:** one folder of numbered `.xlsx` files, one per import dataset, in
   upload order. Each file uses the app's own sheet name and column headers.
3. **A small, varied slice:** about 3–5 faculties, a few departments each, and
   about 8–15 programmes in total. It always includes the attendee's PDF
   programmes. Faculty and programme names come from the university's real
   TCAS rows, so they are realistic. A command-line option sets the size.
4. **The finish line is a green Setup checklist** for each PDF programme. That
   means the same result KMUTT reached: everything the attendee can fix is
   green, and items that are genuinely not applicable read "not applicable".
   The script produces every dataset the checklist reads, and no others.
5. **Made-up people.** Staff names are invented. Publications are invented and
   credited only to those invented staff. No real person appears with a mock
   rank, salary, retirement date or publication.
6. **Fits the public data** (see "Consistency rules").
7. **Repeatable:** a fixed seed (with a `--seed` option) gives the same files
   for the same inputs.
8. **A check that it still fits the app.** A repository check runs a
   generated set through the app's real import validators. It also runs the
   attendee programme names through the `tcas` connector's real matching
   function. When a dataset declaration changes, this check fails in CI,
   before a workshop does.

## Non-goals

- Not every import dataset. Left out: `ranked-universities` (the app
  pre-fills its template with real public rankings; the attendee downloads that
  template from the app), `faculty-compensation`, `staff-salary-by-funding`,
  `external-grants` and `external-grant-team`, unless the checklist turns out to
  read them. The builder confirms against
  `packages/db/src/program-setup-checklist.ts`; that file decides.
- Not a replacement for real exports. The docs say the mock set is for the
  workshop and is to be cleared (dataset start-over) before real data goes in.
- No mocking of public data that a connector already supplies to everyone:
  TCAS, UN population and the national series stay real.
- Not a general-purpose fake-data library. One script, one purpose.

## Anti-goals (what would make this a failure even if every upload succeeds)

- The `tcas` connector matches none of the mock programmes.
- Mock admission figures for a bachelor programme visibly contradict the real
  TCAS figures on the same Deep-Dive page.
- A real person's name ends up in the mock staff list.
- An attendee cannot tell mock data from real data afterwards.

## How the public data and the mock data fit together

These are the facts the design rests on. Each was read from the code on
2026-11-07.

### TCAS (`apps/ingestion/src/connectors/sources/tcas/connector.ts`)

- The connector downloads the round-3 files listed in `files.ts` (BE
  2562–2569, with 2568 split into rounds 3.1 and 3.2). It also discovers new
  files on the mytcas.com stat page.
- A row is the institution's own when `สถาบัน` equals the organisation profile's
  Thai name **exactly** (`isOwnInstitution`, `packages/shared/src/institution.ts`).
- An own row is matched to a programme by **faculty Thai name + programme Thai
  name** (`findOwnProgrammeMatch`). It tries an exact match first, then looser
  rules on the สาขาวิชา part, all within the same faculty name.
- Linked rows are round 3 only. 2568's 3.1 and 3.2 rows repeat the same
  figures: count each course code once per year.

### Health score (`packages/db/src/health-score.ts`, `health-score.v5.6`)

- The TCAS funnel drivers (`tcas_competition_ratio`, `tcas_fill_rate`,
  `tcas_registration_yield`, `tcas_competition_vs_peers`) read the
  **admission-campaigns** sheet first. Only when the sheet states no planned
  seats in any year do they fall back to the public round-3 figures.
  Registration yield has no public equivalent: it needs **Confirmed and
  Reported** in the campaign sheet.
- `tcas_min_score_percentile` reads the public TCAS rows only.
- `student_satisfaction` joins course evaluations to `program_courses` **by
  course code**. An evaluation whose code is not in the programme's course list
  counts for nothing.
- The demographic driver uses **population-projections** rows whose Region text
  equals the organisation profile's English region exactly (for example
  `Northeast`). The national figure is never substituted for it.

### Import declarations (`packages/db/src/import/datasets/`)

- Templates ask for **Common Era** years. Three datasets store Buddhist Era
  internally and convert in the loader. TCAS files are BE. The script works in
  CE and converts TCAS years by subtracting 543.
- Rates are fractions (0.87), never percentages.
- Headcount columns with `groupSizeFor` refuse values below 5 (graduate-outcome
  sample size, employer-feedback respondents, digital-competency counts,
  course-evaluation respondents).
- Unknown columns are refused, and so is anything that looks like a Thai
  national ID (mod-11 13-digit). No generated value may be a 13-digit number
  that passes mod-11. Official codes and class ids must avoid this.
- `programme-courses` makes a programme "import-owned". The pipeline then does
  not extract that programme's course list from the PDF. This is how the KMUTT
  install reached 47 of 48 green, so it is the proven path.

## Consistency rules

1. **Names.** Every bachelor programme in the slice takes its Thai name and its
   faculty's Thai name **letter for letter** from one TCAS row. Exact equality
   means the connector's first strategy matches. The attendee's typed PDF name
   is used only to find that TCAS row: the closest programme name within the
   university's own rows. The script prints which TCAS row it chose and why, and
   offers an override flag (`--tcas-code`) when the guess is wrong or
   ambiguous. English names are generated (degree + field), since TCAS has none.
2. **Postgraduate PDF programmes** take the faculty Thai name the attendee
   gives. If that name exists in TCAS, the TCAS spelling is used. The programme
   name is the attendee's own.
3. **Departments** are derived from the สาขาวิชา part of the programme names,
   so they read naturally.
4. **Years.** The mock covers about five academic years ending at the latest
   year present in the TCAS files. Every sheet uses the same years. Campaign
   and enrolment years line up with the TCAS entry years (BE − 543).
5. **Admission campaigns** for a bachelor programme have one round-3 row per
   year whose planned seats, applicants and passed counts **equal** the
   programme's real TCAS round-3 figures (course codes counted once per year).
   Other rounds (portfolio, quota, direct admission) are invented and sized in
   proportion. Every row states Confirmed and Reported, so registration yield
   can be computed.
6. **Enrolment** totals agree with the campaign sheet: admitted is close to the
   sum of passed counts, and enrolled is close to the sum of Reported counts.
   Cohort, alumni and graduation numbers follow from enrolment with believable
   retention and graduation rates, and they never exceed the cohort that fed
   them.
7. **Courses.** For each PDF programme the script reads course codes and names
   from the PDF text. That list becomes the programme's `programme-courses`
   rows, with a category guessed from the code or section. Course evaluations
   and class offerings for that programme use exactly those codes. If the PDF
   yields no codes, the script says so and generates a clearly invented list
   instead. Other programmes in the slice get invented course lists.
8. **Staff and publications.** Staff are numbered tokens, never names
   (`MOCK-E0001`, `Lecturer 001` / `อาจารย์ 001`), unique within the file. Rank mix, hire and retirement dates are believable.
   Each programme has a coordinator and core staff linked in `program-faculty`.
   Publications are credited to those staff, with invented titles in the
   programme's field and no DOI.
9. **Region.** The attendee gives the university's region in English. The
   script writes population-projection rows with exactly that Region text and
   reminds the attendee to type the same text on the organisation profile.
10. **Labelling.** Everything a person reads says "mock": population-projection
    Source Name, budget Division Name suffix, employer names, and a
    `README.txt` in the output folder. Programme codes carry a recognisable
    prefix (for example `MOCK-`).

## Shape of the solution

- **Location:** `scripts/workshop-mock/`. Files: `generate.py`, a short
  `README.md`, and a `requirements.txt` (`openpyxl`, plus `pypdf` for the PDF
  text).
- **Command:**
  `python scripts/workshop-mock/generate.py --university "มหาวิทยาลัย…" --region Northeast --programme "<Thai name>" --pdf <file.pdf> [--programme … --pdf …] [--postgrad-faculty …] [--size small|medium] [--seed N] [--out DIR]`.
  A programme without a PDF is allowed: it still anchors the slice, with
  invented courses.
- **TCAS download:** same URLs and the same discovery as `files.ts`, the same
  honest user-agent, cached in the output folder's `.cache/`. A second run
  works offline. The attendee's own rows are kept in memory only.
- **Output:** `01-faculties.xlsx`, `02-departments.xlsx`, … in the upload order
  the tutorial uses, then `README.txt`. That file lists upload order, the
  organisation-profile values to type (Thai name, region), which TCAS rows
  anchor which programmes, and how to remove the mock data later.
- **Compatibility check:** a TypeScript check, for example
  `pnpm workshop:check-mock <dir>`. It parses each file with the api's real
  parser, runs `validateSheet` against the registry declarations, and runs
  `findOwnProgrammeMatch` (exported for this purpose) against the cached TCAS
  rows. A Vitest test runs the generator on a committed small TCAS fixture and
  then this check. It skips with a clear message when `python3` is absent,
  rather than passing silently.
- **Docs:** a short section in `docs/tutorials/workshop.md` and its Thai twin
  (send in advance, plus "no exports? use the mock set"), and a pointer in
  step 2 of the Deep-Dive tutorial.

## Acceptance

1. The compatibility check passes on a generated set.
2. A clean install (the KMUTT procedure: fresh clone, claim admin, set the
   organisation profile) uploads every generated file without a refusal. After
   `tcas` and the pipeline run on one PDF programme, that programme's Setup
   checklist is green except for items that are not applicable. The run is
   recorded in a short note under `docs/superpowers/notes/`.
3. On that install the TCAS connector reports every bachelor programme in the
   slice as matched (`ownUnmatched` covers none of them).
4. No generated value passes the national-ID check, and every name in the
   staff file is invented.

## Calls made while reviewing this design (author's calls, not the owner's)

A builder read this document cold and raised the questions below. Each was
settled here as the author's call; the owner may overturn any of them.

1. **"Green" includes the pipeline-driven items.** The mock data must give
   those items what they need to reach green once the pipeline runs:
   - Research expertise and curriculum revision need at least 10 distinct
     papers within the last 10 years by the programme's roster
     (`THIN_PAPER_THRESHOLD`, `packages/db/src/program-research-expertise.ts`).
     Each PDF programme's roster therefore gets at least 15 such papers.
   - Overlap needs a same-level sibling with a course list. So the slice
     includes at least one same-level sibling for each PDF programme, ideally
     in the same faculty, and some of the sibling's course codes are shared
     with the PDF programme. Overlap then has something to find.
   - Peers needs `ranked-universities` plus phase 5. The script does not
     generate rankings. The output `README.txt` tells the attendee to download
     the app's pre-filled rankings template and upload it unchanged. The
     acceptance run includes that step.
2. **No TCAS match stops the script.**
   - If the university name has no own rows, the script exits. It lists the
     closest institution names in the TCAS files, so the attendee can copy the
     right spelling.
   - If a bachelor PDF programme has no confident match, the script also
     exits. It lists the top candidates with their TCAS course codes, and the
     attendee re-runs with `--tcas-code`. Invented names would silently break
     the anti-goal.
   - Other programmes in the slice are always TCAS-anchored, never invented.
3. **Per-programme input goes in a small input file.** One entry per PDF
   programme gives the Thai name, the PDF path, the level (default BACHELOR),
   the faculty's Thai name (required unless BACHELOR) and an optional
   `tcas_code`. A JSON or TOML file in the README's example form works; this
   avoids the positional-pairing problem of repeated flags.
   - `--university`, `--region`, `--size`, `--seed` and `--out` stay as flags.
4. **Postgraduate programmes get invented campaign rows** (one direct-admission
   round a year, with seats and Reported), so the campaign-only items have data.
   The TCAS-only items read "not applicable", as they already do for a
   postgraduate programme.
5. **Ambiguous matches stop, too.**
   - If two TCAS rows score within a small margin of each other, the script
     stops and lists them.
   - Rows with the same faculty and programme name but different course codes
     (tracks) are one programme. Their figures are summed per year, the same
     way `publicTcasTotals` counts each course code once.
6. **CI fixture:** a few hundred rows trimmed from one real round-3 file and
   committed under `scripts/workshop-mock/fixtures/`. The rows are public TCAS
   statistics, and trimming keeps the fixture small. CI never uses the
   network.
7. **Upload order comes from the registry's `references`**, sorted so that
   each dataset follows the datasets it references. A test asserts the
   generated numbering respects that order. The tutorial's order is checked
   against it, and where they differ, the tutorial is corrected.
8. **Removal is documented and tried once.** The README gives the start-over
   order (the reverse of the upload order). The acceptance run tries it once on
   the test install and records what happened.
9. **PDF text:** use `pypdf` for course codes only; codes are ASCII and survive
   extraction. Thai course names from the PDF are kept only when they pass a
   sanity check (no stray combining marks at word starts, a plausible length).
   Otherwise the name cell is left blank, which the dataset allows. An optional
   `courses` CSV per programme in the input file overrides PDF reading
   entirely.

## Left to the builder

- Name lists, the exact retention, graduation and salary distributions, the
  credit ranges, and the publication title templates.
- How to guess a course's category from a PDF, and the code regex. Start from
  what `pnpm curriculum:check` accepts.
- Exact slice size per `--size` value.
- How "closest TCAS row" is scored (normalised edit distance over the สาขาวิชา
  part is a reasonable start).
