# Workshop Mock Data Generator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Python script that a workshop attendee runs on their laptop. It writes upload-ready mock spreadsheets for a small, varied slice of the attendee's real university, anchored on that university's public TCAS rows. A TypeScript check proves the files pass the app's real importer and match the `tcas` connector.

**Architecture:** A small Python package at `scripts/workshop-mock/` that reads mytcas.com round-3 files (cached locally), picks a slice, builds rows per import dataset and writes one xlsx per dataset. Its correctness against the app is proven from the TypeScript side: `apps/api/scripts/workshop/check-mock.ts` parses the output with the api's parser, runs `validateSheet` and runs the connector's own TCAS matcher (moved to `@kku/shared` for this). It follows the existing pattern of `apps/api/test/workshop-sample-data.test.ts`.

**Tech Stack:** Python 3.11+ (stdlib `tomllib`, `unittest`, `urllib`), `openpyxl`, `pypdf`; TypeScript, Vitest, `@kku/db` import declarations, `@kku/shared`.

**Spec:** `docs/superpowers/specs/2026-11-07-workshop-mock-data-design.md` (read it first, including "Calls made while reviewing this design").

## Global Constraints

- Python 3.11+; third-party packages limited to `openpyxl` and `pypdf` (`scripts/workshop-mock/requirements.txt`). Python tests use stdlib `unittest` (no pytest): `python3 -m unittest discover -s scripts/workshop-mock/tests`.
- Cross-platform: `pathlib` only, no shell calls (primary dev machine is Windows). No `rm -rf`.
- **Staff are tokens, not names** (author's call, made at plan time to match the existing workshop sample in `apps/api/scripts/workshop/sample-data.ts`): Name (Thai) `อาจารย์ NNN`, Name (English) `Lecturer NNN`. A token can never coincide with a real staff member's name. This replaces the spec's "invented Thai/English name pairs"; update the spec's consistency rule 8 in Task 6's commit.
- Every code the script invents starts with `MOCK-` (faculty, department, programme, employee, grant/project codes). `Source Name`, `Employer`, budget `Division Name` and similar free text include the word `mock`.
- No generated cell may be a 13-digit number that passes the Thai national-ID mod-11 check. Official Code is left blank.
- Years in every sheet are Common Era. TCAS years are BE; convert with `- 543`.
- Rates are fractions 0–1. Every `groupSizeFor` column (sample size, respondents, students tested, students taking, headcount) is ≥ 5; generate ≥ 8 for margin.
- TCAS: own rows are rows whose `สถาบัน` equals the input university **exactly**. Round-3 figures: count each `รหัสหลักสูตร` once per entry year (2568 has rounds 3.1 and 3.2 carrying the same figures; use one of them), then sum the codes of one programme.
- Bachelor programme and faculty Thai names are copied **letter for letter** from the TCAS row (`หลักสูตร`, `คณะ`). English names are generated.
- The datasets written, in this upload order (references always before users): `faculties`, `departments`, `programmes`, `faculty-members`, `program-faculty`, `programme-courses`, `research-outputs`, `admission-campaigns`, `enrollment-metrics`, `student-cohorts`, `alumni-cohorts`, `financial-metrics`, `faculty-budgets`, `graduate-outcomes`, `employer-feedback`, `digital-competency-cohorts`, `digital-competency-modules`, `course-evaluations`, `population-projections`, `career-skill-demand`. File names are `NN-<slug>.xlsx`, sheet name and headers exactly as the dataset declaration (`packages/db/src/import/datasets/*.ts`) says.
- A concurrent session edits `docs/workshop/`, `docs/adopters/` and `CLAUDE.md` in this same worktree. Before editing any of those, run `git status --short <path>`; if the file has uncommitted changes you did not make, stop and tell the controller. Never `git add -A`; add named paths only. Never stash.

## Review Focus

1. **A TCAS programme name containing characters that Excel or openpyxl normalises** (trailing spaces, non-breaking space, zero-width characters): the name must round-trip byte-identical so the connector's exact match still fires. Test in Task 9: the check compares written names to the fixture's raw strings.
2. **Programme tracks:** two TCAS rows with the same faculty + programme name and different course codes must yield ONE programme whose round-3 figures are the sum. Test in Task 4.
3. **A TCAS year with no admitted figure** (blank `ผ่าน` columns): the campaign row states seats and applicants and leaves Total Passed blank; nothing crashes and no 0 is invented. Test in Task 7.
4. **A PDF with no extractable text or no course codes:** the generator says so on stdout and falls back to an invented course list; it never exits. Test in Task 5.
5. **Re-running into an existing output folder:** files are overwritten, the cache is reused, and running offline with a warm cache works. Test in Task 8.

---

### Task 1: Share the connector's TCAS matcher

**Files:**
- Create: `packages/shared/src/ingestion/tcas-match.ts`
- Modify: `packages/shared/src/index.ts` (export it), `apps/ingestion/src/connectors/sources/tcas/connector.ts` (delete the local `findOwnProgrammeMatch`, `extractSpecialization`, `KEY_SEP` and the two index-building loops in `load`; import from `@kku/shared`)
- Test: `packages/shared/test/tcas-match.test.ts`

**Interfaces:**
- Produces:
  - `interface TcasMatchProgramme { id: string; nameTh: string; majors: string[]; facultyNameTh: string }`
  - `interface TcasMatchIndex` (opaque: the two maps the connector builds today)
  - `buildTcasMatchIndex(programmes: readonly TcasMatchProgramme[]): TcasMatchIndex`
  - `findOwnProgrammeMatch(index: TcasMatchIndex, facultyNameTh: string, programmeName: string, majorName: string): { id: string } | null`
  - `extractSpecialization(name: string): string`

- [ ] **Step 1: Write failing tests** covering: exact faculty+programme match; the สาขาวิชา bridge (`"วศ.บ.สาขาวิศวกรรมเครื่องกล-วศ.บ.4ปี"` matches DB `"หลักสูตรวิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมเครื่องกล"`); a faculty name that is a prefix of another (`คณะวิทยาศาสตร์` vs `คณะวิทยาศาสตร์การกีฬา`) does not cross-match; no match returns `null`.
- [ ] **Step 2:** `pnpm --filter @kku/shared exec vitest run test/tcas-match.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Move the code verbatim (behaviour unchanged) into `tcas-match.ts`; the connector's `load` builds the index from its `prisma.program.findMany` result mapped to `TcasMatchProgramme`.
- [ ] **Step 4:** Run the new test and `pnpm --filter ingestion exec vitest run` → PASS (existing tcas tests unchanged).
- [ ] **Step 5:** `pnpm typecheck`, then commit `refactor(tcas): share the own-programme matcher via @kku/shared` with "docs: no impact".

---

### Task 2: Python package skeleton and TCAS reader

**Files:**
- Create: `scripts/workshop-mock/requirements.txt` (`openpyxl>=3.1`, `pypdf>=4`), `scripts/workshop-mock/wsmock/__init__.py`, `scripts/workshop-mock/wsmock/tcas.py`, `scripts/workshop-mock/fixtures/tcas-sample.xlsx`, `scripts/workshop-mock/fixtures/README.md`, `scripts/workshop-mock/tests/test_tcas.py`
- Modify: root `.gitignore` (ignore `scripts/workshop-mock/**/.cache/` and `workshop-mock-out/`)

**Interfaces:**
- Produces (`wsmock/tcas.py`):
  - `@dataclass(frozen=True) class TcasRow: course_code: str; institution: str; faculty: str; programme: str; major: str | None; entry_year_be: int; round: str; quota: int | None; applicants: int | None; admitted: int | None; min_score: float | None; max_score: float | None` (admitted = pass1 + pass2 when either is stated, else None)
  - `TCAS_FILES: list[tuple[str, int, str]]` — copy of `BUILT_IN_TCAS_FILES` (url, entry_year_be, round) from `apps/ingestion/src/connectors/sources/tcas/files.ts`
  - `load_rows(cache_dir: Path, *, offline: bool, files: list[Path] | None = None) -> list[TcasRow]` — downloads each URL once into `cache_dir` (user-agent `ProgramLandscape-WorkshopMock/1.0`, referer `https://www.mytcas.com/stat/`, 60 s timeout), skips a file that fails with a printed warning; `files` bypasses download (tests)
  - `own_rows(rows, university: str) -> list[TcasRow]`
  - `closest_institutions(rows, university: str, n: int = 5) -> list[str]`
  - `round3_totals(rows: list[TcasRow]) -> dict[int, TcasTotals]` keyed by entry_year_be; `TcasTotals(quota: int, applicants: int, admitted: int | None)`; one row per (course code, year), sum across codes.

- [ ] **Step 1: Build the fixture.** Download one real round-3 file (e.g. TCAS67), keep the header row plus all rows of `มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี` and about 40 rows of three other institutions, save as `fixtures/tcas-sample.xlsx` with the original Thai headers. Add one synthetic duplicate-name track row (same faculty + programme, new course code) and one row with blank `ผ่าน` columns; document both edits in `fixtures/README.md`.
- [ ] **Step 2: Failing tests:** `load_rows(files=[fixture])` returns > 0 rows with `entry_year_be == 2567`; `own_rows(rows, KMUTT)` returns only KMUTT rows; `own_rows(rows, KMUTT + " ")` returns `[]` (exact match); `closest_institutions(rows, "มหาวิทยาลัยเทคโนโลยีพระจอมเกล้า")` lists KMUTT first; `round3_totals` counts a course code once when given the same code twice in one year (3.1 + 3.2), and yields `admitted is None` for the blank-pass row.
- [ ] **Step 3:** `cd scripts/workshop-mock && python3 -m unittest tests.test_tcas -v` → FAIL.
- [ ] **Step 4:** Implement `tcas.py` (openpyxl `read_only=True`, header lookup by Thai text as in the connector's `COL` map).
- [ ] **Step 5:** Tests PASS. Commit `feat(workshop-mock): TCAS round-3 reader with local cache`.

---

### Task 3: Input file and programme resolution

**Files:**
- Create: `scripts/workshop-mock/wsmock/inputs.py`, `scripts/workshop-mock/example-input.toml`, `scripts/workshop-mock/tests/test_inputs.py`

**Interfaces:**
- Consumes: `TcasRow`, `own_rows`, `closest_institutions` (Task 2).
- Produces:
  - `@dataclass class ProgrammeInput: name: str; pdf: Path | None; level: str = "BACHELOR"; faculty: str | None = None; tcas_code: str | None = None; courses: Path | None = None`
  - `@dataclass class Inputs: university: str; region: str; programmes: list[ProgrammeInput]`
  - `load_inputs(path: Path) -> Inputs` — TOML keys `university`, `region`, `[[programme]]` with `name`, `pdf`, `level`, `faculty`, `tcas_code`, `courses`; relative paths resolve against the TOML file's folder
  - `class InputError(Exception)` — message is the text printed to the attendee
  - `@dataclass class Anchor: input: ProgrammeInput; faculty_th: str; programme_th: str; course_codes: list[str]; rows: list[TcasRow]` (rows empty for postgraduate)
  - `resolve_anchors(inputs: Inputs, own: list[TcasRow]) -> list[Anchor]`

Resolution rules (spec "Calls" 2 and 5):
- Level must be one of `BACHELOR`, `MASTER`, `DOCTORAL`, `HIGHER_GRAD_DIPLOMA`; non-bachelor requires `faculty`.
- Bachelor with `tcas_code`: anchor on the rows of that code; unknown code → `InputError`.
- Bachelor without: score each distinct (faculty, programme) pair with `difflib.SequenceMatcher` ratio between the typed name and the TCAS `หลักสูตร`, both normalised (strip whitespace, strip a leading `หลักสูตร`, compare the part after `สาขาวิชา`/`สาขา` when both have it). Best < 0.6, or best − second < 0.05 → `InputError` listing the top 5 as `<course code>  <faculty> | <programme>  (score)`.
- An anchor's `rows` are all own rows sharing its (faculty, programme) pair — tracks included.
- Postgraduate: `faculty_th` is the TCAS spelling when a TCAS faculty name equals the typed one after whitespace normalisation, otherwise the typed text; `programme_th` is the typed name.

- [ ] **Step 1: Failing tests** against the fixture: a typed KMUTT programme name with a small spelling difference resolves to the right pair; a nonsense name raises `InputError` whose message contains five candidate lines; an explicit `tcas_code` wins; the synthetic track pair yields one anchor with two course codes; `level="MASTER"` without `faculty` raises; `load_inputs(example-input.toml)` round-trips.
- [ ] **Step 2:** Run `python3 -m unittest tests.test_inputs -v` → FAIL.
- [ ] **Step 3:** Implement `inputs.py`; write `example-input.toml` with comments in English explaining each key.
- [ ] **Step 4:** PASS. Commit `feat(workshop-mock): input file and TCAS anchor resolution`.

---

### Task 4: Choose the slice

**Files:**
- Create: `scripts/workshop-mock/wsmock/slice.py`, `scripts/workshop-mock/tests/test_slice.py`

**Interfaces:**
- Consumes: `Anchor`, `TcasRow`, `round3_totals`.
- Produces:
  - `@dataclass class Faculty: code: str; name_th: str; name_en: str`
  - `@dataclass class Department: code: str; name_th: str; name_en: str; faculty_code: str`
  - `@dataclass class Programme: code: str; name_th: str; name_en: str; faculty_code: str; department_code: str; level: str; duration: int; credits: int; year_established: int; tcas: dict[int, TcasTotals]  # keyed by CE year (BE − 543); is_anchor: bool; pdf: Path | None; courses_csv: Path | None; sibling_of: str | None`
  - `@dataclass class Slice: faculties: list[Faculty]; departments: list[Department]; programmes: list[Programme]; latest_year_ce: int; years_ce: list[int]`
  - `SIZES = {"small": (3, 8), "medium": (5, 15)}` (faculties, programmes)
  - `choose_slice(anchors: list[Anchor], own: list[TcasRow], size: str, rng: random.Random) -> Slice`

Rules:
- Every anchor is a programme. Each anchor's faculty is in the slice.
- Each anchor gets one sibling of the same level with `sibling_of = anchor.code`: for a bachelor anchor a different bachelor TCAS programme, same faculty if one exists, else any; for a postgraduate anchor an invented programme of the same level in the same faculty (`name_th` = `<anchor name> (แผน ข)`).
- Fill up to the size's faculty and programme counts with other own TCAS programmes, choosing faculties with ≥ 2 programmes first. Rows sharing a (faculty, programme) pair are one programme (Review Focus 2).
- Departments: the สาขาวิชา part (`extractSpecialization` logic ported to Python) of each programme name, prefixed `สาขาวิชา`; English name derived from a small Thai→English field table with a fallback `Department of <Thai text>`.
- Codes: faculty `MOCK-F01`…, department `MOCK-F01-D01`…, programme `MOCK-P001`…, in that sort order.
- `years_ce`: five years ending at `latest_year_ce` = (max TCAS `entry_year_be` in own rows) − 543.

- [ ] **Step 1: Failing tests:** with the fixture and `size="small"`, the slice has ≤ 3 faculties and ≤ 8 programmes, contains the anchor, contains its sibling at the same level, every programme's faculty and department exist, the track pair is one programme with summed quota, `years_ce` has 5 consecutive years ending at 2567 − 543, and two runs with `Random(7)` are equal.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(workshop-mock): choose a varied slice around the attendee's programmes`.

---

### Task 5: Course lists

**Files:**
- Create: `scripts/workshop-mock/wsmock/courses.py`, `scripts/workshop-mock/tests/test_courses.py`, `scripts/workshop-mock/fixtures/curriculum-sample.pdf` (copy `workshop/sample-data/curriculum/workshop-demo-curriculum.pdf` if present on the branch; otherwise generate a two-page PDF with known codes using any local tool and commit it)

**Interfaces:**
- Produces:
  - `COURSE_CODE_RE` — Python port of `COURSE_CODE_SOURCE` (`packages/shared/src/curriculum/course-code-pattern.ts`), with a comment naming that file as the source of truth
  - `@dataclass class Course: code: str; name_th: str | None; name_en: str | None; credits: int; category: str` (category is one of the dataset's English labels: `General education`, `Core`, `Major required`, `Major elective`, `Free elective`, `Thesis / project`)
  - `courses_from_pdf(pdf: Path) -> tuple[list[Course], str]` — the str is a one-line note for stdout (e.g. `"42 course codes read from <file>"` or `"no course codes found in <file>; using an invented list"`); never raises on a bad PDF
  - `courses_from_csv(path: Path) -> list[Course]` — headers `code,name_th,name_en,credits,category`
  - `invented_courses(programme: Programme, rng) -> list[Course]` — prefix = 3 letters from the department's English name, codes `XXX 1NN`…`XXX 4NN`, about 40 courses, credit total near `programme.credits`, 4 general-education courses with prefix `GEN`
  - `share_with_sibling(anchor_courses: list[Course], sibling_courses: list[Course], rng) -> list[Course]` — returns the sibling's list with 6–10 of the anchor's major courses (same code and name) substituted in

Rules for PDF reading: text via `pypdf`; category by the most recent heading seen before the code (`หมวดวิชาศึกษาทั่วไป` → General education, `วิชาแกน` → Core, `วิชาเฉพาะเลือก`/`วิชาเลือก` → Major elective, `เลือกเสรี` → Free elective, `วิทยานิพนธ์|โครงงาน|สหกิจ` → Thesis / project, else Major required); credits from a `\d\(\d-\d-\d\)` pattern on the same line, default 3; a Thai name is kept only if it is 3–80 characters and does not start with a Thai combining mark (U+0E31, U+0E34–U+0E3A, U+0E47–U+0E4E); first occurrence of a code wins.

- [ ] **Step 1: Failing tests:** the regex accepts `MEE 221`, `EN241100`, `EN 241 100` and rejects `PHY 2565`, `mee 221`, `ISO 9001`; `courses_from_pdf(fixture)` finds the known codes; `courses_from_pdf(<a text file renamed .pdf>)` returns `([], <note containing "no course codes">)` without raising (Review Focus 4); a name starting with `ั` is dropped to `None`; `share_with_sibling` shares 6–10 codes.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(workshop-mock): course lists from the PDF, a CSV, or invented`.

---

### Task 6: People, rosters and publications

**Files:**
- Create: `scripts/workshop-mock/wsmock/people.py`, `scripts/workshop-mock/tests/test_people.py`
- Modify: spec consistency rule 8 (tokens, see Global Constraints)

**Interfaces:**
- Consumes: `Slice`, `Programme`.
- Produces:
  - `@dataclass class Staff: code: str; name_th: str; name_en: str; faculty_code: str; department_code: str; rank: str; qualification: str; specialization: str; hire_date: date; retirement_date: date; active: bool`
  - `@dataclass class RosterLink: programme_code: str; employee_code: str; role: str` (`COORDINATOR`/`CORE`/`SUPPORT`)
  - `@dataclass class Publication: employee_code: str; year: int; type: str; title: str; venue: str; citations: int`
  - `make_staff(slice: Slice, rng) -> tuple[list[Staff], list[RosterLink]]` — per programme 1 coordinator + 4 core + 2 support; staff numbered `MOCK-E0001`… with names `อาจารย์ 001` / `Lecturer 001`; ranks roughly 40 % LECTURER, 35 % ASST_PROF, 20 % ASSOC_PROF, 5 % PROF; every retirement date after 2027-12-31; all active
  - `make_publications(slice: Slice, staff: list[Staff], links: list[RosterLink], rng) -> list[Publication]` — anchor programmes' rosters get ≥ 15 distinct titles dated within the last 10 years from `slice.latest_year_ce`; other programmes 3–8; titles from per-field templates; no DOI

- [ ] **Step 1: Failing tests:** names match `^(Lecturer|อาจารย์) \d{3}$`; every code starts `MOCK-`; each anchor roster's publications have ≥ 15 distinct titles with `year > latest_year_ce - 10`; no retirement date ≤ 2027-12-31; exactly one COORDINATOR per programme.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit (code + spec edit) `feat(workshop-mock): token staff, rosters and publications`.

---

### Task 7: Dataset rows

**Files:**
- Create: `scripts/workshop-mock/wsmock/datasets.py`, `scripts/workshop-mock/tests/test_datasets.py`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `UPLOAD_ORDER: list[str]` (Global Constraints order)
  - `SHEETS: dict[str, tuple[str, list[str]]]` — slug → (sheet name, headers in declaration order), copied from the declarations; the Task 9 check is what proves them right
  - `@dataclass class World: slice; staff; links; publications; courses: dict[str, list[Course]]; region: str`
  - `build_rows(slug: str, world: World, rng) -> list[dict[str, object]]` — keyed by header text; `None` for a blank cell

Value rules (each one a spec consistency rule):
- **admission-campaigns**, per programme per year: bachelor with TCAS figures for that year → a `Round 3 — Admission` row whose Planned Seats, Total Applicants, Total Passed **equal** `tcas[year]` (Total Passed blank when `admitted is None`, Review Focus 3), plus `Round 1 — Portfolio`, `Round 2 — Quota`, `Round 4 — Direct Admission` rows sized so round 3 is 30–45 % of total seats. Postgraduate → one `Direct Admission` row. Every row states Confirmed and Reported (Reported ≤ Confirmed ≤ Total Passed). Campaign Name `<English programme name>, mock`.
- **enrollment-metrics:** Admitted ≈ Σ Total Passed of that year's campaigns, Enrolled = Σ Reported; Retained to Year 2, Graduated on Time/Late and Dropouts only for years old enough, never exceeding the feeding cohort.
- **student-cohorts / alumni-cohorts:** derived from enrolment; alumni counts per status sum to that cohort's enrolment.
- **financial-metrics:** tuition = enrolled × a per-level fee (bachelor 40,000–60,000 THB/yr × duration-weighted students).
- **faculty-budgets:** one row per faculty per year, Division Name `<English faculty name> (mock)`, two fund categories.
- **graduate-outcomes:** graduation years from the slice's years minus the last; Survey Year = graduation year + 1; rates 0–1; Sample Size 8–60.
- **employer-feedback:** 2 survey years, Employer `Mock employer N`, Respondents ≥ 8.
- **digital-competency-cohorts / -modules:** bachelor programmes only; counts obey the declaration's row rules (read `packages/db/src/import/datasets/digital-competency.ts`).
- **course-evaluations:** for each anchor programme, every major course × 2 years × semesters 1 and 2 where offered, codes exactly from `world.courses`, Respondents ≥ 8, Average Rating 3.2–4.7.
- **population-projections:** Region = `world.region`, years `latest_year_ce`…`latest_year_ce + 15`, all three age groups, Source Name `Workshop mock data — not an official projection`; plus `TH` rows.
- **career-skill-demand:** 3 career groups related to the anchors' fields, each with 8 skills drawn from a fixed list of common English skill names (`Python`, `Data analysis`, `Project management`, `Communication`, …), Scope `Thailand`, Data Source `Job postings`.

- [ ] **Step 1: Failing tests** with a World built from the fixture: for every slug, every row's keys equal the headers in `SHEETS[slug]`; the anchor's Round 3 campaign figures equal `round3_totals` for each year; the blank-pass year leaves Total Passed `None`; every `groupSizeFor` header value is ≥ 5; every course-evaluation code is in the anchor's course list; no integer cell is a 13-digit value passing mod-11.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat(workshop-mock): dataset rows consistent with TCAS`.

---

### Task 8: CLI, writer and the output README

**Files:**
- Create: `scripts/workshop-mock/generate.py`, `scripts/workshop-mock/wsmock/write.py`, `scripts/workshop-mock/README.md`, `scripts/workshop-mock/tests/test_generate.py`, `scripts/workshop-mock/tests/fixture-input.toml` (KMUTT, region `Bangkok`, one bachelor programme from the fixture, `pdf` = `../fixtures/curriculum-sample.pdf`)
- Modify: root `package.json` (`"workshop:mock": "python3 scripts/workshop-mock/generate.py"`)

**Interfaces:**
- Produces:
  - `write_dataset(out: Path, index: int, slug: str, rows) -> Path` — `NN-<slug>.xlsx`, one sheet, headers row 1, strings written as strings (no number coercion of codes), cells `None` left empty
  - `write_readme(out: Path, world: World, anchors, notes: list[str]) -> Path` — `README.txt`: organisation-profile values to type (Thai name exactly, English region exactly), the upload table, "University Rankings: download the app's pre-filled template and upload it unchanged", which TCAS rows anchor which programme, connectors to run (`tcas`, `un-wpp`; do NOT expect `openalex-works` to match — staff are tokens), the start-over order (reverse), and the PDF/course notes
  - `main(argv: list[str] | None = None) -> int` — `generate.py <input.toml> [--size small|medium] [--seed N] [--out DIR] [--cache DIR] [--offline] [--tcas-file PATH ...]`; defaults `--size small --seed 2026 --out ./workshop-mock-out --cache <out>/.cache`; prints `InputError` text and returns 2; prints each file written with its row count

- [ ] **Step 1: Failing tests:** `main([tests/fixture-input.toml, "--tcas-file", fixture, "--out", tmp])` returns 0 and writes 20 xlsx files plus `README.txt`; a second run into the same folder returns 0 and the files are identical (Review Focus 5); `--offline` with an empty cache and no `--tcas-file` returns 2 with a message naming `--offline`; a written programme Thai name read back with openpyxl equals the fixture's raw string byte for byte.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. `README.md` covers install (`pip install -r scripts/workshop-mock/requirements.txt`), the input file, the flags and what to do on each error.
- [ ] **Step 4:** PASS, and run all Python tests: `cd scripts/workshop-mock && python3 -m unittest discover -s tests -v`.
- [ ] **Step 5:** Commit `feat(workshop-mock): command-line generator and next-steps README`.

---

### Task 9: Compatibility check against the app

**Files:**
- Create: `apps/api/scripts/workshop/check-mock.ts`, `apps/api/test/workshop-mock.test.ts`
- Modify: root `package.json` (`"workshop:check-mock": "pnpm --filter api exec tsx scripts/workshop/check-mock.ts"`), `.github/workflows/pr.yml` (in the job that runs `pnpm test`, before it: `actions/setup-python` with `python-version: '3.12'` and `pip install -r scripts/workshop-mock/requirements.txt`)

**Interfaces:**
- Consumes: `parseImportWorkbook` (`apps/api/src/import/parse.ts`), `getImportDataset`, `validateSheet` (`@kku/db`), `buildTcasMatchIndex`, `findOwnProgrammeMatch` (Task 1).
- Produces:
  - `checkMockDir(dir: string, tcasRows: readonly { institution: string; faculty: string; programme: string; major: string | null }[], university: string): { errors: string[]; matched: string[]; unmatched: string[] }` — for each `NN-<slug>.xlsx`: the dataset exists, `parseImportWorkbook` succeeds, `validateSheet` passes with `references` built from the earlier files (same approach as `referencedValues()` in `workshop-sample-data.test.ts`) and `heldRowCount: 0, allowShrink: false, maxRows: 5000`; numbering respects every `references`; then every BACHELOR row of `03-programmes.xlsx` is matched by `findOwnProgrammeMatch` against the university's TCAS rows
  - CLI: `check-mock.ts <dir> <input.toml>` reads TCAS rows from `<dir>/.cache/*.xlsx`, prints the result, exits 1 on any error or unmatched bachelor programme

- [ ] **Step 1: Failing test** `apps/api/test/workshop-mock.test.ts`: if `python3 -c "import openpyxl, pypdf"` fails, `it.skip` with the reason in the title (never a silent pass); otherwise run `generate.py` on the fixture into a temp folder and assert `checkMockDir(...)` gives `errors: []`, `unmatched: []`, and `matched` contains the anchor; and assert every `03-programmes.xlsx` Thai name is byte-identical to a fixture `หลักสูตร` value (Review Focus 1).
- [ ] **Step 2:** `pnpm --filter api exec vitest run test/workshop-mock.test.ts` → FAIL.
- [ ] **Step 3:** Implement `check-mock.ts`. Fix any header or rule mismatch it reports in the **Python** side (`SHEETS`, `datasets.py`), never in the declarations.
- [ ] **Step 4:** PASS. Also run `pnpm --filter api exec vitest run test/workshop-sample-data.test.ts` → still PASS.
- [ ] **Step 5:** `pnpm check`, then commit `test(workshop-mock): prove generated files pass the importer and the TCAS matcher`.

---

### Task 10: Docs

**Files** (check `git status --short` on each first, see Global Constraints):
- Modify: `docs/workshop/00-before-the-day.md` + `.th.md` (install Python 3.11+ and the requirements; prepare the input file), `docs/workshop/03-university-data.md` + `.th.md` (a "No exports? Generate a mock set for your university" subsection under the real-data track: run `pnpm workshop:mock <input.toml>`, then `pnpm workshop:check-mock <out> <input.toml>`, then upload in file order; what stays empty and why; remove it with start-over in reverse order), `docs/data-import.md` (one paragraph pointing to it)

- [ ] **Step 1:** Write the English text; keep the house style (short sentences, numbered steps, "You should see…").
- [ ] **Step 2:** Write the Thai twins with the same headings and steps.
- [ ] **Step 3:** `pnpm docs:build` → passes (dead links, bilingual twin check, retired names).
- [ ] **Step 4:** Commit `docs(workshop): generate a mock set for your own university`.

---

### Task 11: Clean-install acceptance run

**Files:**
- Create: `docs/superpowers/notes/2026-11-07-workshop-mock-verification.md`
- Modify: `docs/superpowers/notes/decisions-log.md` (entry, newest first), `CLAUDE.md` "In progress" adopter-workshop line (one line; check `git status` first)

Follow the KMUTT procedure in `docs/superpowers/notes/2026-11-03-kmutt-e2e-verification.md` on a separate clone. **Never run `pnpm setup` / `db:up` with overridden ports** (CLAUDE.md trap).

- [ ] **Step 1:** Generate for KMUTT with one real KMUTT curriculum PDF (the one used in the KMUTT run) as the anchor; run `workshop:check-mock` → 0 errors.
- [ ] **Step 2:** Fresh install, claim admin, set the organisation profile to the README's values, upload the 20 files in order plus the pre-filled rankings template. Expected: no refusal.
- [ ] **Step 3:** Run `tcas` and `un-wpp`. Expected: the run's `ownUnmatched` sample lists none of the slice's bachelor programmes.
- [ ] **Step 4:** Attach the PDF, run the pipeline, open the Setup checklist. Expected: green except not-applicable items (JobThai). Record each non-green item with its reason.
- [ ] **Step 5:** Try start-over in reverse order on two datasets; record what happened.
- [ ] **Step 6:** Write the note, the log entry and the status line; commit `docs: workshop mock-data clean-install verification`.
