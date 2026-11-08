# Adopter Plan 5 — Curriculum PDFs in other universities' formats

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The curriculum-PDF phases (courses, digest, skills/PLOs, pedagogy, faculty roster) work on a non-KKU Thai curriculum PDF — first proof: KMUTT B.Eng. Mechanical Engineering (`2514001`) — without per-university code, and say clearly why when they cannot.

**Architecture:** One shared course-code pattern accepts both KKU (`EN 241 100`) and 3-digit (`MEE 221`) shapes and is used everywhere a code is located. Prompts lose KKU-only wording and examples (version bumps). Roster matching strips academic titles on both sides. Unreadable (scanned) PDFs are reported as such.

**Tech Stack:** TypeScript strict, Vitest, pdfjs-dist (existing).

**Spec:** `docs/superpowers/specs/2026-11-03-adopter-ready-deep-dive-design.md` §7.3b. Plans 1–4 are done.

**Facts about the KMUTT PDF (structural scan only, no prose read):** 320 pages, ~500k characters of native text (not scanned). Course codes are 3-letter + 3-digit (`MEE 111`, `GEN 111`, `LNG 120`, `PHY …`, `MTH …`); zero KKU-style 6-digit codes. The course list sits under a numbered heading `3.1.3 รายวิชา` with `หมวดวิชา` sub-headings; the description heading is extracted as `ค าอธิบายรายวิชา` (broken sara-am — the slicer already tolerates it); PLOs are titled `ผลลัพธ์การเรียนรู้` with `PLO` labels; the roster heading is `อาจารย์ผู้รับผิดชอบหลักสูตร`; appendices are `ภาคผนวก`.

## Global Constraints

- No `any`; Zod at I/O; prompt changes follow `docs/prompt-standard.md` (bump the version constant, history comment, update method-catalog `currentVersion`, `docs/evaluation-pipeline.md` lists, topology/version tests, methodology-bundle bookkeeping). Never edit a published version in place.
- KKU unchanged: every existing KKU test (6-digit codes, `PH 111 101` fixtures, slicer refusals that were correct) stays green.
- Never read `kmutt-data/` content into tests, fixtures, logs, docs or chat. Fixtures are synthetic text in the same *shape* (fictional course names, no person names). The only allowed contact with the real PDF is Task 4's structural check, which prints counts and booleans only.
- No real AI calls in tests. The live AI run happens in plan 6.
- DB-touching tests only via the scratch wrapper and `describeScratchDb` helper (`packages/db/test/helpers/scratch-db.ts`, `apps/ingestion/test/helpers/scratch-db.ts`).

## Review Focus

1. **Page numbers, years and table cells looking like codes** (`PHY 2565`, `MEE 4000`, `ISO 9001`): the pattern must not take 4-digit tails as codes → Task 1 test.
2. **The TOC line `3.1.3 รายวิชา … 22`** is found before the real section: the trailing check (400 chars must contain `หมวดวิชา` and a code) must skip it → Task 1 test with a TOC-then-body fixture.
3. **A roster name that matches two staff after title stripping** stays unmatched → Task 3 test.
4. **Scanned or empty PDF**: phases report "no extractable text" instead of succeeding with nothing → Task 4 test.
5. **KKU regression**: the existing slicer/candidate/fallback tests on 6-digit codes pass unchanged → every task.

---

### Task 1: One course-code pattern for every locator

**Files:**
- Create: `packages/shared/src/curriculum/course-code-pattern.ts` — exports `COURSE_CODE_SOURCE: string` (regex source), `courseCodeRegex(flags?: string): RegExp`, `isCourseCode(s: string): boolean`
- Modify: `packages/shared/src/ai/prompts/program-courses-extract.ts` (`extractCourseListSection` ~187 `codeRe`, `extractCandidateCourseCodes` ~264, `extractFallbackCourseFromContext` ~311, `enNameRe` ~322) to use it; `packages/db/src/program-curriculum-revision.ts:~132` `PROSE_COURSE_CODE_RE` to use it
- Test: `packages/shared/test/course-code-pattern.test.ts`; extend `packages/shared/test/course-list-slicer.test.ts` with a synthetic KMUTT-shape document

**Interfaces:**
- Pattern, exact semantics: 2–4 upper-case Latin letters, optional single space, then either 3 digits + optional space + 3 digits (KKU) or exactly 3 digits (KMUTT-style), not followed by another digit; word-bounded. Accepts `EN 241 100`, `EN241100`, `MEE 221`, `MEE221`, `GEN 111`; rejects `PHY 2565`, `ISO 9001`, `MEE 4000`, `MEE 22`, `mee 221`.
- `extractCandidateCourseCodes` returns normalised codes for both shapes; fallback parser accepts both shapes.
- The slicer's trailing check stays (400 chars after the anchor must contain `หมวดวิชา` and a code match).

- [ ] **Step 1: Failing tests** — pattern accept/reject list above; slicer: synthetic doc with a TOC line `3.1.3 รายวิชา 22` followed later by `3.1.3 รายวิชา` + `หมวดวิชาศึกษาทั่วไป` + `GEN 111 …` rows → slice starts at the body, not the TOC; candidate scan returns `MEE221`, `GEN111`; fallback extracts a 3-digit row; all existing KKU slicer/candidate tests unchanged.
- [ ] **Step 2: Run** `pnpm --filter @kku/shared exec vitest run test/course-code-pattern.test.ts test/course-list-slicer.test.ts test/program-courses-extract.test.ts` → FAIL.
- [ ] **Step 3: Implement.** **Step 4: Run** the same → PASS; typecheck shared + db.
- [ ] **Step 5: Commit** `feat(curriculum): one course-code pattern for KKU and 3-digit codes`.

### Task 2: Prompts without KKU-only wording (version bumps)

**Files:**
- Modify: `packages/shared/src/ai/prompts/program-courses-extract.ts` (line ~391 "ของ ม.ขก." → `getInstitution().shortNameTh`; "3 หมวด" described as typical, not required; row-format line lists both code shapes with a 3-digit example; bump `PROGRAM_COURSES_EXTRACT_VERSION` v4 → v5)
- Modify: `packages/shared/src/ai/prompts/program-digest.ts` (line ~254 stray "สจล." → `inst.shortNameTh`; example code "EN013 201" → a neutral pair "ABC 101 / ABC 101 201"; section hint "ข้อ 3.1.3" phrased as "e.g."; raise `maxCourses` default 80 → 250 so descriptions/CLOs can cover a full course list; bump v3 → v4)
- Modify: `packages/shared/src/ai/prompts/program-skills-detailed.ts` (PLO heading hints add `ผลลัพธ์การเรียนรู้ระดับหลักสูตร`, `ผลลัพธ์การเรียนรู้ที่คาดหวังของหลักสูตร`, `Programme Learning Outcomes (PLOs)`; neutral example code; bump v3 → v4)
- Modify: `packages/shared/src/ai/prompts/program-faculty-extraction.ts` (title list adds `ศ.ดร.`, `ศ.`, `รศ.`, `ผศ.`, `Prof.`, `Assoc. Prof.`, `Asst. Prof.`, `Dr.`; ask for English names when printed; replace the KKU-named example with a fictional one; bump v2 → v3)
- Bookkeeping for all four versions (method-catalog, evaluation-pipeline doc, topology data/test, methodology-bundle tests, any test asserting the version string)
- Test: the existing prompt tests for each file, extended: rendered prompt contains no `ม.ขก.`, `สจล.`, `ขอนแก่น`, `KKU`, `EN013`; contains the organisation short name from `setOrganizationForTest`.

- [ ] **Step 1: Failing tests** (per prompt: no KKU/KMITL literals; version string v5/v4/v4/v3; digest default `maxCourses` 250).
- [ ] **Step 2: Run** the four prompt test files → FAIL. **Step 3: Implement + bookkeeping.** **Step 4: Run** them + methodology-bundle and topology version tests → PASS; typecheck shared/db/web/ingestion.
- [ ] **Step 5: Commit** `feat(prompts): curriculum prompts drop KKU-only wording`.

### Task 3: Roster matching that survives titles and English names

**Files:**
- Create: `apps/ingestion/src/program-faculty/name-match.ts` — `stripAcademicTitles(name: string): string`, `buildRosterLookup(members: { id: string; nameTh: string | null; nameEn: string | null }[]): RosterLookup`, `matchRosterName(lookup: RosterLookup, entry: { nameTh?: string | null; nameEn?: string | null }): string | null`
- Modify: `apps/ingestion/src/program-faculty/run.ts` (~255-330) to use it; outcome notes `matched 0 of N — load the Staff spreadsheet (or check names) to link teaching staff` when no name matched and N > 0 (status stays SUCCEEDED but `degraded: true` in the phase result so the pipeline summary shows it)
- Test: `apps/ingestion/test/program-faculty-name-match.test.ts`

**Interfaces:**
- `stripAcademicTitles`: removes, repeatedly from the start, Thai `ศ.ดร.`, `รศ.ดร.`, `ผศ.ดร.`, `ศ.`, `รศ.`, `ผศ.`, `ดร.`, `อ.`, `อาจารย์`, `ศาสตราจารย์`, `รองศาสตราจารย์`, `ผู้ช่วยศาสตราจารย์`, `นาย`, `นาง`, `นางสาว`, and English `Prof.`, `Professor`, `Assoc. Prof.`, `Asst. Prof.`, `Assistant Professor`, `Associate Professor`, `Dr.`, `Mr.`, `Mrs.`, `Ms.` (case-insensitive, with or without the dot/space); collapses whitespace; lower-cases Latin.
- Lookup keys: stripped Thai name; stripped English name; English name with first/last swapped. A key shared by two members is ambiguous and never matches.
- Match order: Thai, then English, then swapped English.

- [ ] **Step 1: Failing tests** — `ผศ.ดร. สมมติ ทดสอบ` matches member `สมมติ ทดสอบ`; `Asst. Prof. Dr. Somsak Testing` matches member nameEn `Somsak Testing` and `Testing Somsak`; ambiguous key → null; KKU-style bare names still match.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement + wire.** **Step 4: Run** + existing program-faculty tests (mocked) → PASS; typecheck ingestion.
- [ ] **Step 5: Commit** `feat(roster): match curriculum staff names through titles and English names`.

### Task 4: Unreadable PDFs say so; structural check on the KMUTT PDF

**Files:**
- Modify: `apps/ingestion/src/program-pdf-prep/load.ts` — after `extractNativeText`, if `isLikelyScanned` or `fullText.trim().length < 2000`, return a typed `{ status: 'NO_TEXT', reason: 'The curriculum PDF has no extractable text (scanned or image-only). OCR is not supported; upload a text PDF or load the course list spreadsheet.' }` that phase1/phase2b runners surface as SKIPPED with that reason (find the runners' existing SKIPPED path and reuse it).
- Create: `apps/ingestion/src/scripts/curriculum-pdf-check.ts` (`pnpm curriculum:check <pdf-path>`) — prints ONLY: page count, character count, likely-scanned flag, number of course codes by shape, whether `extractCourseListSection` finds a slice and its length, candidate code count, and offsets/pages of the PLO and roster headings. Never prints prose, names or code lists.
- Docs: `docs/pdf-ingestion.md` (supported PDF shapes, the NO_TEXT case, the check command, fallback = course list spreadsheet).
- Test: `apps/ingestion/test/program-pdf-prep-no-text.test.ts` (mocked extractor).

- [ ] **Step 1: Failing test** — scanned flag → NO_TEXT with the reason; short text → NO_TEXT; normal text → ok.
- [ ] **Step 2–3:** run → FAIL, implement.
- [ ] **Step 4: Run the check on the real KMUTT PDF** — `pnpm curriculum:check "kmutt-data/2514001 หลักสูตรวิศวกรรมศาสตรบัณฑิต สาขาวิชาวิศวกรรมเครื่องกล 2565.pdf"` → expect: not scanned, slice found, candidate codes ≥ 100. Record the printed counts in the report (counts only). If the slice is not found, extend the slicer anchors in `extractCourseListSection` (e.g. accept `3.1.3 รายวิชา` variants and `ค าอธิบายรายวิชา` end marker) with a synthetic-fixture test, then re-run.
- [ ] **Step 5: Commit** `feat(curriculum): report unreadable PDFs; structural PDF check command`.
