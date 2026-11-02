# Programme course lists from a spreadsheet — design

Date: 2026-11-02. Branch `feat/institute-xlsx-import`. Approved in chat by the owner.
Extends the institute import (`docs/superpowers/specs/2026-10-17-institute-xlsx-import-design.md`).

## 1. Why

Phase 2b of the programme pipeline (`apps/ingestion/src/program-courses-extract/run.ts`)
builds `program_courses` from the curriculum PDF. Its section finder and code regexes
hard-code KKU's code shape (letters + 6 digits, `EN 241 100`). On a KMUTT PDF
(programme 2514001, codes like `MEE 221`) it refuses with "Could not locate the
รายวิชา section…", and every surface that reads `program_courses` — programme overlap,
curriculum revision, the Deep-Dive course sections — stays empty. Some adopters' PDFs
will never parse (scans, odd layouts). They need to upload the course list instead.

## 2. Goals, non-goals, anti-goals

**Goals**
- A 16th import dataset, `programme-courses`, built like the other fifteen.
- A programme whose course list was uploaded is owned by the import: no pipeline step
  overwrites it.
- Starting the dataset over hands every such programme back to phase 2b.

**Non-goals (owner decision)**
- Configurable course-code formats; any change to `extractCourseListSection`, the regexes
  in `packages/shared/src/ai/prompts/program-courses-extract.ts`, or the version
  `program-courses-extract.v4`.
- A description / CLO column (see §7).
- Fixing the KKU-specific GE prefix rule or `PROSE_COURSE_CODE_RE` (noted in docs only).

**Anti-goals** — failure even if it "works":
- The next pipeline run silently wiping an uploaded list.
- An upload of one programme touching any other programme's rows.
- Two rows that normalise to the same code reaching the database and failing on the
  unique index instead of being named in validation.
- A shrink-guard refusal on every ordinary one-programme upload.

## 3. The sheet

Sheet name `Programme Courses`. One row per (programme, course). Headers-only template,
no prefill.

| Header | Key | Type | Req. | Notes |
|---|---|---|---|---|
| Programme Code | programmeCode | text | yes | references `programmes.code` |
| Course Code | courseCode | text | yes | identity = `normaliseCourseCode` |
| Course Name (Thai) | courseNameTh | text | no | |
| Course Name (English) | courseNameEn | text | no | |
| Credits | credits | integer | no | check 0–60 |
| Category | category | text | no | label → `CourseCategory`; blank → `UNKNOWN` |

Category labels accepted (case-insensitive, surrounding whitespace ignored; the enum
token itself is also accepted):

| Stored | English | Thai |
|---|---|---|
| GENERAL_EDUCATION | General education | หมวดวิชาศึกษาทั่วไป |
| CORE | Core | วิชาแกน |
| MAJOR_REQUIRED | Major required | วิชาเฉพาะบังคับ |
| MAJOR_ELECTIVE | Major elective | วิชาเฉพาะเลือก |
| FREE_ELECTIVE | Free elective | หมวดวิชาเลือกเสรี |
| THESIS_PROJECT | Thesis / project | วิทยานิพนธ์/โครงงาน |
| UNKNOWN | Unknown | ไม่ระบุ |

An unrecognised value fails the cell; the message lists the English labels. Blank is
never guessed — it stores `UNKNOWN`. The guide sheet must say: *mark general-education
courses as General education — otherwise programme overlap counts them as major courses*
(the code-prefix fallback only knows GE / LI / 00).

The guide (dataset description) states this dataset is the fallback when PDF extraction
cannot read a programme's course list, and that uploading a programme replaces its whole
course list.

## 4. Framework additions

1. **`ImportColumn.identity?: (value: ImportCellValue) => string`.** The duplicate-key
   check in `validate.ts` uses `identity(value)` instead of `String(value)` when present.
   Course Code uses `normaliseCourseCode`. Duplicate message names both rows (existing
   behaviour).
2. **Strategy variant `{ kind: 'programme-scoped'; scopeColumns: readonly string[]; match }`.**
   Semantics: every distinct scope value in the file is replaced wholesale; scope values
   absent from the file are untouched. Unlike `term-scoped`, rows need not agree.
   - `ImportDataset.countForScope?(prisma, scopes: readonly Record<string, ImportCellValue>[])`
     — rows held for exactly those scopes. Required of a programme-scoped dataset.
   - `ValidationContext.heldRowCountForScope?` — the shrink-guard baseline for this kind
     (mirrors `heldRowCountForTerm`). The api service computes it from the scope values
     read out of the parsed sheet before validation (advisory, like `readDeclaredTerm`).
   - Scope columns count as identity columns (same as term columns) for the
     valueless-row logic.
   - `ImportLoadContext` needs nothing new: the loader derives scopes from its rows.
   - **Builder's call (recorded):** for `programme-courses`, `countForScope` counts only
     rows the import itself wrote for those programmes (joined through
     `ingestionRun.dataSource.slug = 'xlsx-programme-courses'`). The guard protects an
     adopter's own list from a partial re-upload; it must not refuse the first upload over
     an extractor list that over-collected appendix codes.

## 5. Loading (`programme-courses.load`)

In the caller's transaction:
1. Resolve programme codes → ids (error if missing; validation already checks).
2. `deleteMany({ programId: { in: ids } })` — **all** rows of those programmes, including
   PDF-extracted ones (owner-approved). Rationale: mixing two sources in one list is
   meaningless, and extracted rows are recoverable from the PDF after start-over.
3. `createMany` with: `courseCode = normaliseCourseCode(raw)`, `courseCodeRaw` = trimmed
   cell text, names, credits, category, `methodVersion = 'xlsx-import.v1'` (exported
   constant `PROGRAMME_COURSES_IMPORT_VERSION`), `ingestionRunId = ctx.ingestionRunId`,
   `programRevisionId = Program.activeRevisionId` (same rule as both existing writers; no
   sheet column).
4. Return `{ inserted, updated: 0, deleted }`.

Descriptions, CLOs and embeddings are dropped by step 2, as every phase 2b run already
does; overlap prep refills descriptions from an approved digest on matching code and
re-embeds.

`count` = whole table. `clear(tx, runIds)` = `deleteMany({ ingestionRunId: { in: runIds } })`.
No `dependents` / `cascadeBlockers` (nothing hangs off `program_courses`).
`programmes`' existing `cascadeBlockers` already lists `ProgramCourse`, so clearing
programmes refuses while course rows exist — verify with a test, no code change.

## 6. Precedence over the PDF extractor

**Ownership rule.** A programme is import-owned iff it has ≥ 1 `program_courses` row whose
`ingestionRun.dataSource.slug = 'xlsx-programme-courses'`. Not `methodVersion`: start-over
deletes by run id, so ownership and hand-back use the same link.

Shared helper in `@kku/db` (e.g. `packages/db/src/program-course-ownership.ts`):
`importOwnedProgramIds(prisma, programIds): Promise<Set<string>>` plus the reason string
`'course list supplied by spreadsheet import — not re-extracting'`.

- **Phase 2b (`run.ts`)**: right after the programme lookup, before the PDF fetch and the
  AI call → `{ status: 'SKIPPED', reason }`. The pipeline must log it as a skip, not fail.
- **`materialise-program-courses.ts`**: skip import-owned programmes; `--force` does NOT
  override (it exists to overwrite extractor rows). Counted and logged separately.

**Builder's call (recorded) — the race.** Phase 2b checks ownership up front, then spends
minutes on the model; an upload can commit in between. So `run.ts` re-checks inside its
write transaction (interactive `$transaction`), and the materialise script does the same.
If the programme became import-owned meanwhile, nothing is written and the existing
`materialisationRefusedReason` field carries the reason — no new result shape.

Hand-back: start-over removes the import's rows → the helper returns false → phase 2b
extracts again on the next run.

**Owner decision — no per-programme release.** Whole-dataset start-over is the only way
back to the extractor. The adopter guide says so, and says the two workarounds: to refresh
one programme's list (e.g. after a new curriculum revision, since imported rows keep the
revision they were loaded under), re-upload that programme; to hand ONE programme back to
the PDF, download the stored files, start over, and re-upload the rest.

## 7. Downstream readers (findings, no code change)

- `realDataWhere()` is not applied to `program_courses` anywhere; no reader filters on
  `methodVersion`, `programRevisionId` or `ingestionRunId`. Imported rows are visible
  without the catalogue entry; it exists for start-over and provenance.
- Overlap prep/scoring: `UNKNOWN`/null categories count as major; canonical programmes
  only (imported programmes are canonical — the programmes loader assigns
  `sequenceNoFromSheet`). GE prefix rule GE/LI/00 is KKU-specific — documented.
- Curriculum revision: `PROSE_COURSE_CODE_RE` (`\d{5,6}`) misses 3-digit codes — affects
  only the `proseCourseCodesUnverified` diagnostic; reads descriptions from the digest, not
  the table; `UNKNOWN` rows can never be promotion candidates.
- Deep-Dive course card lists only courses with graded `class_offerings` on the same
  code; it shows `methodVersion` of the first row (`xlsx-import.v1`, accurate).
- Description column: not added. Curriculum revision would ignore it, and overlap prep
  would overwrite it whenever an approved digest lists the code — a second precedence
  rule to design. Follow-up if wanted.

## 8. Docs

`docs/data-import.md`; `docs/adopters/README.md` pipeline section (add CR and OV, show 2b
runs in parallel with 1, note the import precedence); `docs/tutorials/program-deep-dive.md`
step 5; CLAUDE.md decisions entry; `pnpm docs:build`. Catalogue entry
`xlsx-programme-courses` in `packages/shared/src/ingestion/catalog.ts`.

## 9. Verification

Unit + registry tests (TDD). Dev end to end on programme `cmvhxzs99008wpq2spzjf2lfk`
(code 2514001): upload → `pnpm programs:pipeline 2514001 --only=phase2b` skips and keeps
rows → phase OV uses them → start over → phase 2b owns it again. `pnpm check`.

## 10. Left to the builder

Helper/file names, test layout, exact guide prose, how the api service peeks the scope
values (mirror `readDeclaredTerm`).
