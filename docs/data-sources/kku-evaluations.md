# KKU Student Evaluations (Teaching & Learning)

**Slug:** `kku-evaluations` · **Phase:** A · **Kind:** Oracle DB view (read-only) · **Cadence:** weekly Sunday 03:00 · **Status:** 🧭 spec / Phase 0 discovery complete (2026-05-19)

---

## What it is

`POWERBI.EVALUATE_INSTRUCTOR` — the registrar's student-evaluation dataset for teaching & learning. Students enrolled in a class answer the same canonical questionnaire each semester; the view pre-aggregates per `(class × question × instructor)` to one row carrying the rating average and respondent count. Questions evolve over time — new prompts get appended, some are retired — so the connector must capture a question catalog separately, not assume a fixed slate.

Feeds two new sub-dashboards:
- `/education/satisfaction` — **course-aggregated** view (course satisfaction over time, gap drill by question, scope-clamped to faculty/program)
- `/staff/teaching` — **instructor-individual** view (PROGRAM_USER own only · FACULTY_USER all faculty individuals in scope · UNIVERSITY_USER all individuals)

---

## Access

| | |
|---|---|
| Endpoint | Registrar Oracle warehouse — same host/service as `kku-registry`; values live in `KKU_REGISTRY_DB_*`, not in this repo |
| Driver | `oracledb` v6+ thin mode (no Instant Client) |
| Auth | Same read-only account as `kku-registry`. Username deliberately not published — see the note in `kku-registry.md`. |
| Credentials | reuses `KKU_REGISTRY_DB_*` env (same warehouse as registry + finance tuition) |
| Network | KKU on-prem only — confirmed reachable from dev WSL2 (probed 2026-05-19) |
| Query timeout | 60 s per query (the aggregation passes over 1.4 M rows) |
| Concurrency | 1 (single connection per run) |
| Data residency | never leaves the KKU network |

### View in scope

`POWERBI.EVALUATE_INSTRUCTOR` — single view, **1,429,565 rows** spanning BE 2564–2569 (CE 2021–2026), 5 academic years.

---

## Schema (verified 2026-05-19)

| # | Column | Type | Nullable | Notes |
|---|---|---|---|---|
| 1 | `CAMPUSID` | NUMBER | NOT NULL | KKU campus (1 = main Khon Kaen, 2 = Nong Khai, etc.) |
| 2 | `FACULTYID` | NUMBER | NOT NULL | Registrar's faculty id (27 distinct in scope) |
| 3 | `ACADYEAR` | NUMBER | NOT NULL | Buddhist Era — subtract 543 for CE |
| 4 | `SEMESTER` | NUMBER | NOT NULL | 1 / 2 / 3 (summer) / 4 (special) |
| 5 | `COURSECODE` | VARCHAR2(20) | NOT NULL | Subject code, joins to `Course.code` |
| 6 | `COURSEID` | NUMBER | NOT NULL | Registrar internal course id |
| 7 | `CLASSID` | NUMBER | NOT NULL | Internal class/section id — **more specific than (COURSECODE, SECTION)** |
| 8 | `COURSENAME` | VARCHAR2(255) | NOT NULL | Thai course name |
| 9 | `COURSENAMEENG` | VARCHAR2(255) | NULL | English course name (74% populated) |
| 10 | `SECTION` | NUMBER | NOT NULL | Section number (1, 2, …) |
| 11 | `QUESTIONID` | VARCHAR2(20) | NOT NULL | Canonical question id (01–31 today) |
| 12 | `QUESTION` | VARCHAR2(255) | NULL | Question text in Thai |
| 13 | `POINT` | VARCHAR2(20) | NULL | Numeric string — **unreliable** (matches AVG×N in only 46% of rows; use POINT_AVG) |
| 14 | `OFFICERID` | NUMBER | NOT NULL | Registrar's instructor id (2,456 distinct) |
| 15 | `KKUMAIL` | VARCHAR2(100) | NULL | Instructor email — primary join key to `FacultyMember.kkuMailFromHr` |
| 16 | `LAST_UPDATE` | DATE | NULL | Registrar refresh timestamp |
| 17 | `TOTAL_STUDENT` | NUMBER | NULL | Respondent count for this (class × question × instructor) cell |
| 18 | `POINT_AVG` | NUMBER | NULL | Mean rating on 1-5 likert (range [0.64, 5.0]) — **canonical score** |

### Natural row key

`(ACADYEAR, SEMESTER, CLASSID, QUESTIONID, OFFICERID)` — **verified UNIQUE** (1,429,565 rows = 1,429,565 distinct keys). Use this as the upsert key in our connector.

### Team teaching denormalization

The registrar **replicates each (CLASSID × QUESTIONID) score once per instructor** who taught the class. The score itself is **class-level** (students rated the *class experience*), not per-instructor — every co-teacher gets credited (or blamed) with the same rating.

| Team size | Groups | % of groups |
|---|---|---|
| 1 instructor | 427,695 | 62.8% |
| 2 instructors | 132,006 | 19.4% |
| 3-5 instructors | 84,345 | 12.4% |
| 6-10 instructors | 19,228 | 2.8% |
| 11-51 instructors | 18,018 | 2.6% |

**Implication for design**: when rolling up to a per-instructor view, the same score appears in multiple teachers' rows. This means a teacher's "average rating" is fairly an average of the **classes they were attached to**, but it's NOT a direct signal of their individual teaching quality — students didn't isolate per-instructor when evaluating. The dashboard must surface this caveat clearly to avoid misuse for tenure / promotion decisions.

### Score scale

**1-5 Thai likert** — POINT_AVG range observed [0.64, 5.0]. Distribution is heavily ceiling-biased:

| Bucket | Rows | % |
|---|---|---|
| 5.0 (perfect) | 304,138 | 21.3% |
| [4.8, 5.0) | 146,964 | 10.3% |
| [4.5, 4.8) | 440,514 | 30.8% |
| [4.0, 4.5) | 424,541 | 29.7% |
| [3.5, 4.0) | 75,531 | 5.3% |
| [3.0, 3.5) | 26,809 | 1.9% |
| [2.0, 3.0) | 5,965 | 0.4% |
| [0.6, 2.0) | 5,015 | 0.4% |

**87% of cells score ≥ 4.0.** The Council's signal isn't "course X scored 4.4 ≈ good"; it's relative — "course X scored 4.4 but the faculty median is 4.6 ⇒ bottom-quartile." All UI surfaces must default to **relative ranking** (z-score / percentile within faculty), not absolute thresholds, or every course will look fine.

### Question catalog

**40 distinct `QUESTIONID` values** seen. Four stability tiers:

| Tier | QIDs | (year,sem) presence | Interpretation |
|---|---|---|---|
| **Core** (stable, 10 questions) | 01–10 | 21 of 21 buckets | Original questionnaire; in every semester |
| **Extended** (15 questions) | 11–25 | 20 of 21 buckets | Added later, mostly stable |
| **Recent** (4 questions) | 26–29 | 5–11 buckets | Rolled out in last 2-3 semesters |
| **Specialized** (11 questions) | 30–40 | 5 buckets | Course-specific (rubric items + English-skills evaluation for ENG courses) |

Sample of core questions (translations are paraphrases):

| QID | Thai prompt | Theme |
|---|---|---|
| 01 | นักศึกษาได้รับรู้และเข้าใจผลลัพธ์การเรียนรู้/เป้าหมายของรายวิชา | Learning outcomes communicated |
| 02 | นักศึกษาได้รับการชี้แจ้งหรือมีส่วนร่วมในการกำหนดรูปแบบการจัดการเรียนการสอนและเกณฑ์การประเมินผล | Assessment criteria clarity |
| 03 | ผู้สอนมีกิจกรรมการเรียนการสอนที่เน้นให้ผู้เรียนมีส่วนร่วม | Active learning activities |
| 04 | ผู้สอนมีการสอดแทรกคุณธรรม จริยธรรม จรรยาบรรณวิชาชีพ | Ethics integration |
| 05 | ผู้สอนมีการจัดการเรียนการสอนที่ส่งเสริมให้นักศึกษาได้ค้นคว้าหาความรู้ด้วยตนเอง | Self-directed learning |
| 06 | ผู้สอนมีการวัดและประเมินผลด้วยวิธีการที่หลากหลาย | Diverse assessment methods |
| 07 | นักศึกษาได้รับการเรียนรู้จากสื่อของผู้สอนที่เข้าใจได้ง่าย | Teaching materials clarity |
| 08 | ผู้สอนมีการใช้เทคโนโลยีการเรียนรู้ | Technology use |
| 09 | นักศึกษามีโอกาสได้ซักถามและได้รับคำแนะนำจากอาจารย์ผู้สอน | Q&A / mentorship |
| 10 | ผู้สอนมีการส่งเสริมคุณธรรม จริยธรรม | Role-modeling of ethics |

**Question text drift** — same QID can carry slightly different prompts across versions. E.g., QID 21 / 22 / 25 currently share the same wording (registrar data-quality issue), QID 26 / 29 share wording with QID 25. We will **anchor on (QUESTIONID, version-hash-of-text)** to preserve audit history; the dashboard groups by QID for the user-visible label and tags drift in the provenance drawer.

### English translations

The registrar does not ship English questionnaire text. **Phase 1 will translate the 31 questions into English using AI** (`evaluation-question-translate.v1`), stored in `EvaluationQuestion.questionTextEn`, with the AI translation flagged as such in the audit row. Reviewers (DEAN / ADMIN) can override via `EvaluationQuestion.questionTextEnOverride`.

---

## PDPA posture

**Source-side data**:
- No per-student rows exist in this view — the registrar pre-aggregates each `(class × question × instructor)` cell with `TOTAL_STUDENT` as the response count.
- `KKUMAIL` is the instructor's work email (low PDPA sensitivity — already public via KKU directory). `OFFICERID` is an internal registrar id, not a citizen ID.
- No `STUDENT_ID`, no `CITIZEN_ID`, no open-text comment fields. **PII audit passed** (probe section [10]).

**Connector-side suppression** (anonymity threshold for instructors):
- Cells with `TOTAL_STUDENT < 5` are **NOT** loaded into our DB — server-side `HAVING TOTAL_STUDENT >= 5` clause in the SELECT.
- Cost at threshold 5: 69% of rows kept (986 K of 1.43 M). The 31% suppressed are mostly:
  - n=1: 190 K rows (independent studies, thesis advising)
  - n=2: 108 K rows
  - n=3: 79 K rows
  - n=4: 66 K rows
- This protects instructors of small classes (graduate seminars, project supervision) from de-anonymization. At n=5, even if a student's answer is identifiable, it's diluted enough that the aggregate doesn't pin them.

**Legal basis**: PDPA §24(1) legitimate interest — institutional governance / quality assurance. The data subject (student) consented via the registrar's evaluation T&C. Instructor names are public via the university directory.

**Dashboard-side visibility tiering** (NEW rule for this dataset — different from class-GPA):

| Surface | PROGRAM_USER | FACULTY_USER | UNIVERSITY_USER / EXEC / COUNCIL / ADMIN |
|---|---|---|---|
| `/education/satisfaction` (course view) | scope-clamped to their programs' courses | scope-clamped to their faculty's courses | all faculties |
| `/staff/teaching` (instructor view) | **own row only** | all individuals in their faculty | all individuals across all faculties |
| `/profile` → "My evaluations" | own only (regardless of role) | own only (regardless of role) | own only (regardless of role) |

Course-aggregated cells in `/education/satisfaction` do NOT carry per-instructor names — even an ADMIN sees course-level numbers there. Per-instructor names appear only on `/staff/teaching` with the tiering above.

---

## Connector design (Phase 1 plan)

**Single Oracle query**, server-side aggregation:

```sql
SELECT
  ACADYEAR,
  SEMESTER,
  FACULTYID,
  COURSECODE,
  COURSENAME,
  COURSENAMEENG,
  CLASSID,
  SECTION,
  QUESTIONID,
  -- POINT discarded as unreliable
  OFFICERID,
  KKUMAIL,
  TOTAL_STUDENT     AS RESPONDENT_COUNT,
  POINT_AVG         AS RATING_AVG,
  LAST_UPDATE
FROM POWERBI.EVALUATE_INSTRUCTOR
WHERE ACADYEAR >= :year_from
  AND TOTAL_STUDENT >= 5            -- anonymity gate
```

Plus a separate question-catalog query to populate `EvaluationQuestion`:

```sql
SELECT
  QUESTIONID,
  MAX(QUESTION)              AS QUESTION_TEXT_TH,
  MAX(ACADYEAR)              AS LAST_SEEN_YEAR_BE,
  MAX(LAST_UPDATE)           AS LAST_UPDATED_AT,
  COUNT(DISTINCT ACADYEAR || '-' || SEMESTER) AS SEMESTERS_USED
FROM POWERBI.EVALUATE_INSTRUCTOR
GROUP BY QUESTIONID
```

### Target Prisma models (proposed for Phase 1)

```prisma
// Question catalog — one row per distinct QUESTIONID, with version-hash for drift
model EvaluationQuestion {
  id                    String   @id @default(cuid())
  questionIdRegistrar   String   // "01", "02", … (= POWERBI QUESTIONID)
  questionTextTh        String   @db.Text
  questionTextEn        String?  @db.Text          // AI-translated, flagged
  questionTextHash      String                     // sha256 of TH text — drift detection
  themeTag              String?                    // analyst-curated: "active-learning" | "ethics" | "assessment"
  firstSeenYearBE       Int
  lastSeenYearBE        Int
  semestersUsed         Int
  methodologyVersion    String   @default("kku-evaluations.v1")
  ingestionRunId        String?
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  @@unique([questionIdRegistrar, questionTextHash])
  @@index([questionIdRegistrar])
}

// Aggregate per (class × question × instructor) — natural key matches registrar
model EvaluationResponseSummary {
  id                    String   @id @default(cuid())
  acadYearBE            Int
  semester              Int
  facultyRegistryId     Int?                       // POWERBI FACULTYID
  facultyId             String?                    // resolved to our Faculty
  courseCode            String
  courseId              String?                    // resolved to Course.id
  classOfferingId       String?                    // resolved to ClassOffering.id
  classIdRegistrar      Int                        // POWERBI CLASSID
  section               Int
  questionIdRegistrar   String                     // joins to EvaluationQuestion
  questionId            String?                    // resolved FK
  officerIdRegistrar    Int                        // POWERBI OFFICERID
  facultyMemberId       String?                    // resolved to FacultyMember.id
  kkumail               String?                    // raw fallback when fmId can't resolve
  ratingAvg             Decimal  @db.Decimal(4, 3) // 1.000–5.000
  respondentCount       Int                        // ≥ 5 by construction
  lastUpdateAt          DateTime?
  methodologyVersion    String   @default("kku-evaluations.v1")
  ingestionRunId        String
  createdAt             DateTime @default(now())
  updatedAt             DateTime @updatedAt
  @@unique([acadYearBE, semester, classIdRegistrar, questionIdRegistrar, officerIdRegistrar])
  @@index([facultyId, acadYearBE, semester])
  @@index([facultyMemberId, acadYearBE, semester])
  @@index([courseId, acadYearBE, semester])
}
```

**Idempotent upsert** keyed on the registrar's natural key. Re-runs overwrite the rating + respondent count for refreshed cells.

### Resolution pipeline (best-effort, never-block)

For each fetched row, the connector resolves three FKs in order:

1. **FacultyMember**: `KKUMAIL` → `FacultyMember.kkuMailFromHr` (lowercased exact); fallback to `kkumail` raw retained for traceability when unresolved
2. **Course**: `COURSECODE` → `Course.code` (exact)
3. **ClassOffering**: `(COURSECODE, SECTION, ACADYEAR, SEMESTER)` → `ClassOffering`
4. **Faculty**: `FACULTYID` → existing `Faculty.kkuRegistryFacultyId` mapping (per registry-program-mapping precedent)

Unresolved rows still land — `facultyMemberId`/`courseId`/`facultyId` are nullable. Counts surface in `IngestionRun.metadata.unresolved{}` for analyst worklist. Same posture as kku-research's unmatched-author rows.

### Cadence

Weekly Sunday 03:00 — student evaluations are entered through the semester; weekly refresh captures rolling progress without overloading the source. Manual trigger via `/admin/data-sources/kku-evaluations` for emergencies.

**Registrar refresh rhythm**: `LAST_UPDATE` is a single timestamp shared across all rows — confirms the registrar refreshes the entire view as one batch (not row-by-row). Probed value 2026-05-19 15:56 ICT = same-day refresh, suggesting daily upstream cadence. Our weekly cadence is intentionally less frequent than upstream; evaluation distributions shift slowly within a semester so weekly catches all meaningful change.

### Expected row counts

- Cells kept (n≥5): ~986 K total, 21 (year, sem) buckets — **~47 K cells per semester**
- 1.4 M rows scanned → ~986 K loaded
- Question catalog: 31 rows today, growing slowly

Sub-10 minute end-to-end load expected.

---

## Open questions for review (resolve before Phase 1)

1. **Score scale rendering** — do you want raw 1-5 numbers + a heat colour, OR z-score relative to faculty median, OR both side-by-side? Recommendation: **both** — show raw score in the cell text but colour by within-faculty percentile so the Council reads relative ranking even though the data is ceiling-biased.

2. **English question text** — translate via AI (`evaluation-question-translate.v1`) and flag, OR ship Thai-only until DEAN provides curated translations? Recommendation: **AI translate** with `(EN — AI translation, pending review)` watermark in the UI; DEAN can override per row.

3. **Question drift** — when the same QID has multiple texts across years, do we treat them as **the same question** (current plan, anchor on QID for rollups) or **separate versions** (would make trend lines break at version boundaries)? Recommendation: **same question** for rollups, **drift watermark** in the provenance drawer.

4. **"Find gaps" definition** — a gap is a (course | instructor) where score on at least one question is in the bottom decile within its peer set. Peer set = faculty × question × semester. Acceptable?

5. **Suppression threshold** — confirmed 5? Cost: 31% of cells suppressed (mostly graduate seminars, thesis classes).

6. **Year window** — start from BE 2564 (5 years, all available data) or BE 2566 (3 years, current curriculum)? Recommendation: **all** (BE 2564+) — historical context helps the trend line.

---

## Phase 0 artefacts

- Discovery probes: `apps/ingestion/src/scripts/probe-kku-evaluations.ts` + `probe-kku-evaluations-joins.ts`
- Fixtures: `apps/ingestion/test/fixtures/kku-evaluations/` — aggregate, except
  `sample-rows.json`, which is five real rows with the person-identifying
  columns masked. **Corrected 2026-08-27:** this list used to say
  "aggregate-only, no PII" of the whole directory. It was not true of
  `sample-rows.json`, which shipped raw `OFFICERID` values next to course,
  section, semester and evaluation score for three months. The emails were
  masked; the staff ID that joins straight to an HR record was not, and
  `pii-audit.json` reported `suspects: []` because the detector matched
  column names against citizen-ID and phone patterns only.
  - `schema.json` — column list with PII flags (`OFFICERID` and `KKUMAIL` now flagged)
  - `row-count.json`
  - `sample-rows.json` — 5 rows; `KKUMAIL` masked to `xx***@kku.ac.th`,
    `OFFICERID` replaced by a truncated SHA-256 so the join is still
    demonstrable without the value that resolves against HR
  - `pii-audit.json` — now lists `OFFICERID` (person-identifier) and
    `KKUMAIL` (pii-by-name)
  - `coverage.json` — year × semester buckets
  - `cardinalities.json` — distinct counts
  - `question-stability.json` — QID drift analysis
  - `score-scale.json` — POINT_AVG distribution
  - `response-unit.json` — natural-key analysis
  - `pii-audit.json` — PII column scan (passed)
  - `joins-summary.json` — comprehensive Phase 0 findings

## Session log

- **2026-05-19** — Phase 0 discovery complete. 1.4 M rows; 21 (year,sem) buckets BE 2564–2569; 40 questions (10 core + 15 extended + 4 recent + 11 specialized including ENG-skills set); 2,456 instructors; 2,298 distinct emails; 27 faculties; 1-5 likert (skewed 87% ≥ 4.0); team-teaching denormalized (62.8% single-teacher, max team 51); natural key `(Y, S, CLASSID, QID, OFFICERID)` unique; PII audit clean; suppression at n≥5 keeps 69%; KKUMAIL null in 5% of rows; LAST_UPDATE single-batch timestamp. Spec doc written; awaiting user review before Phase 1.
