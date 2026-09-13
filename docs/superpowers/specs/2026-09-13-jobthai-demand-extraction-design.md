# JobThai demand extraction and programme skill mapping — design

**Date:** 2026-09-13
**Status:** approved, not implemented
**Slug:** `jobthai` (rebuild from deprecated stub)
**Methodology impact:** `health-score.v5.0` → `health-score.v5.1`

---

## Why this exists

KKU's relevance dimension currently rests on one external demand source,
`kmitl-skill-mapping`, which is LinkedIn data subscribed by MHESI and
served through a KMITL-hosted API. It returns **percentages at career
level with no province granularity, no sector breakdown, and no
per-posting rows**, and its Thailand x job-postings quadrant rests on 161
postings.

JobThai gives us 47,643 real Thai job postings with province, industry
sector, and — uniquely — **explicit degree and field-of-study
requirements**. Those are precisely the dimensions KMITL lacks, which
makes the two sources complementary rather than redundant.

## Measured facts about the source data

Measured 2026-09-13 across all five files in `/home/denpong/JobThaiData`
(`Job_Data_01..05.xlsx`). **Do not re-derive these; they cost a full
parse of 45 MB of Thai text.**

| Fact | Value |
|---|---|
| Rows | 47,643 (10,000 x 4 + 7,643) |
| Exact duplicate rows | 19 |
| Distinct job titles | 37,326 |
| Job categories / subcategories | 44 / 173 |
| Business (industry) types | 41 |
| Provinces | 79 |
| Raw text volume (description + qualification) | 45,145,451 chars |

Columns, all present in every file, in this order:

`Job Title`, `Job Category (ประเภทงานหลัก)`,
`Job Subcategory (ประเภทงานย่อย)`, `Business (ประเภทธุรกิจ)`,
`Province`, `Job Description (Raw)`, `Qualification (Raw)`

Fill rates: the five structured columns are **100%** populated;
`Job Description (Raw)` is 98.8%, `Qualification (Raw)` is 100%.

Signal presence (description or qualification):

| Signal | Count | Share |
|---|---|---|
| Mentions a degree or vocational qualification | 36,467 | 76.5% |
| **Names a field of study (สาขา)** | **27,527** | **57.8%** |
| Bachelor's explicit | 24,465 | 51.4% |
| **Master's or doctorate** | **364** | **0.8%** |
| Vocational certificate (ปวช/ปวส) | 12,831 | 26.9% |
| Years of experience | 34,549 | 72.5% |
| English-language requirement | 7,499 | 15.7% |
| **Gender requirement** | **22,643** | **47.5%** |
| **Age requirement** | **26,332** | **55.3%** |
| Contains an email address | 280 | 0.6% |
| Contains phone-like digits | 230 | 0.5% |

Geography — the load-bearing caveat:

| Region | Count | Share |
|---|---|---|
| Bangkok | 17,633 | 37.0% |
| Northeast (Isan, 20 provinces) | 1,564 | 3.3% |
| Khon Kaen alone | 304 | 0.6% |

**Absent from the source entirely:** posting date, employer name, salary.

## Current state of the code and database

- `job_postings` and `job_posting_skills` are **empty (0 rows)**. This is
  greenfield; the tables exist from prompt 01 and have never been used.
- `JobPosting.embedding` and `Skill.embedding` are `vector(1536)` columns
  with **0 populated rows** in both. pgvector is installed and unused.
- `JobThaiConnector` (`apps/ingestion/src/connectors/sources/kku-connectors.ts:227`)
  is a **one-record stub extending `ApiConnector`** whose `load()` writes
  nothing and returns counts. The catalog entry is `deprecated: true`,
  `mocked: true`, superseded by `kmitl-skill-mapping` on 2026-05-01.
- `CsvFileConnector`
  (`apps/ingestion/src/connectors/base/csv-file-connector.ts`) already
  documents the intended architecture for this exact case: manual
  CSV/XLSX uploads, files in a MinIO `csv-uploads` bucket, `fetch()`
  enumerates unprocessed files. It is not yet wired to a real bucket.
  **We are completing an intended design, not inventing one.**
- `DataSourceInputFormat.XLSX` already exists. `DataSourceKind` has `CSV`
  but no `FILE`, so `kind: CSV` + `inputFormat: XLSX` is the correct
  existing-convention pairing.
- Skill normalisation infrastructure is in place and healthy: 4,407
  skills (4,049 KKU-taxonomy), 5,313 `skill_aliases`, and
  `packages/db/src/skill-normaliser.ts` exposing `lookupAlias`,
  `lookupAliasesBulk`, `recordAliasDecision`, `promoteNewProposedToSkill`,
  `relinkUsingAliases`.
- `program_skills`: 2,410 rows covering 842 distinct skills.
- Demand today is resolved **only** from `KmitlCareerSkillDemand`
  (36,299 rows), filtered by `Program.kmitlCareerIds`, capped at the top
  30 skills, through a four-tier fallback chain
  (THAILAND/JOB_POSTINGS → GLOBAL/JOB_POSTINGS → THAILAND/PROFILES →
  GLOBAL/PROFILES) in `apps/ingestion/src/program-demand-match/run.ts`.

### Prerequisite defect — relevance is already suppressed

**All 6,224 `program_demand_matches` rows have `ingestion_run_id = NULL`,
so zero pass `realDataWhere()`.** The `demand_match_filled` driver is
therefore null on all 301 programmes and at every scope, despite 285
programmes having real AI match analysis behind them (4,900 rows with
`relevant = true`, 3,114 with `matched = true`, method versions
`demand-match.v2` and `.v3`).

This is the same class of accident as the Google Scholar rows described
in CLAUDE.md, and the same class as the `tcas` / NULL-provenance issue
from v1.1.3.

**It must be fixed first.** Until it is, no change to relevance will be
visible, because one of the dimension's five drivers is discarded before
it is read.

The fix needs care, because these rows are **AI-derived, not
connector-derived** — there is no connector run that produced them, so
"anchor to the source family's latest run" is not immediately meaningful.
What *is* meaningful: every `ProgramDemandMatch` row exists because a
demanded skill was resolved from a demand source. That source is the row's
real provenance.

- **Going forward:** the demand-match runner stamps the `ingestionRunId`
  of the `IngestionRun` that supplied the demanded-skill set for that row
  — `kmitl-skill-mapping` today, `jobthai` once phase 6 lands. One FK
  cannot express a blend, so where a row's skill came from both, stamp the
  source that resolved it first in the fallback chain and record the other
  in `methodVersion`.
- **Backfill for the existing 6,224:** all are `demand-match.v2`/`.v3`,
  which predate JobThai, so every one of them came from
  `kmitl-skill-mapping`. Anchor them to that connector's most recent
  SUCCEEDED run, using the documented one-shot pattern (note the column is
  `completed_at`, not `finished_at`). The anchor is approximate — the rows
  did not literally come from that run — but the source family is correct,
  which is the same compromise accepted for the v1.1.3 backfill.
- **Regression guard:** a test asserting the runner writes a non-null
  `ingestionRunId`, so this cannot silently recur. It has now happened
  three times in this codebase (`tcas`, Google Scholar, and here).

## Decisions taken

| Decision | Choice | Rationale |
|---|---|---|
| Authority of the signal | **Feed relevance immediately, nationally weighted** | Operator's decision 2026-09-12 after being shown the 37% Bangkok / 3.3% Isan and 0.8% postgraduate skew. The alternatives offered were an analyst-only lens, Isan-scoped only, and an Isan-weighted blend. |
| Refresh cadence | **Recurring drops; posting dates obtainable** | Operator can request a date column from JobThai. Parser accepts it when present and falls back to batch receipt date, flagged. |
| Extraction strategy | **Hybrid: deterministic core, bounded LLM, embeddings** | Full per-posting LLM extraction costs ~$153 on the current default `gemini-3.5-flash` ($1.5/$9 per Mtok) and would trip the $10/day `AiQuotaGuard` mid-run. The hybrid is ~$2-5 and every phase is individually re-runnable. |
| Profession layer | **JobThai-native, not mapped onto `KmitlCareer`** | The 173 subcategories are source-authoritative and 100% populated. A crosswalk onto KMITL's 473 careers would invent precision we cannot defend. |
| Programme bridge | **Dual path** — field-of-study AND skill-overlap | The field-of-study requirement (57.8% of postings) is a far more direct programme signal than skill overlap, and is something KMITL cannot provide. Keeping both independent lets them corroborate or disagree; disagreement is shown to analysts rather than averaged away. |
| Postgraduate programmes | **Driver returns null, never 0** | At 0.8% coverage the data cannot speak to 179 of KKU's 297 programmes. Confirmed by operator 2026-09-13. Follows the project's standing null-handling rule: a data gap is not bad performance. |
| Gender and age requirements | **Dropped entirely at parse time** | Present in 47.5% and 55.3% of postings. They are not skills, and surfacing "employers want women under 30" on a Council surface would be the worst possible outcome of this feature. Confirmed by operator 2026-09-13. |
| Per-posting embeddings | **Not built** | Occupation-level vectors are sufficient for semantic matching. 47,643 posting vectors would be storage and cost for no decided use. |

## Non-goals

- No web scraping. Files arrive by hand from JobThai.
- No salary or employer modelling — absent from the source.
- No ISCO-08 crosswalk (`KmitlCareer.iscoCode` hand-mapping stays deferred).
- No trend or growth-rate analysis in this iteration. The schema admits
  it once real dates arrive; nothing computes it yet.
- `jobsdb` stays deprecated and is not revived.

## Data model

Four new tables, one new enum, one enum extension, and additive columns
on the existing empty `JobPosting`.

### `JobThaiBatch`

One row per uploaded file — the unit the admin UI manages.

| Field | Notes |
|---|---|
| `id` | cuid |
| `filename` | as uploaded |
| `contentHash` | **unique**, SHA-256 of bytes — re-uploading the same file is a no-op, matching the `PdfDocument` dedupe pattern |
| `storageKey` | MinIO, `csv-uploads` bucket |
| `rowCount` | rows parsed |
| `receivedDate` | upload date; the `postedDate` fallback |
| `status` | `PENDING` / `PARSING` / `PARSED` / `FAILED` |
| `parseError` | text, null on success |
| `uploadedByUserId` | FK `User` |
| `ingestionRunId` | FK `IngestionRun`, nullable |

### `JobThaiOccupation` — the profession layer

Unique on `(category, subcategory)`; 173 rows from the current drop.

Carries `nameTh`, `postingCount`, LLM-written `profileTh` and
`typicalTasksTh`, `embedding vector(1536)`, and `methodVersion`.

### `JobThaiOccupationSkill`

`(jobThaiOccupationId, skillId)` unique, with `postingCount`, `share`
(0..1), and `extractedBy: SkillSource`.

### `ProgramJobThaiLink`

`(programId, jobThaiOccupationId)` unique.

| Field | Notes |
|---|---|
| `linkSource` | `field-of-study` \| `skill-overlap` \| `both` |
| `score` | 0..1 strength |
| `evidenceTh` | verbatim requirement text or matched skill list |
| `methodVersion` | |
| `ingestionRunId` | **stamped on write** — the mistake the prerequisite fix exists to correct must not be repeated here |

### `JobPosting` — additive columns

Reuses the existing empty table. New: `jobThaiBatchId`, `jobCategory`,
`jobSubcategory`, `businessType`, `qualificationRaw`,
`requiredFieldsRaw String[]`, `requiredDegreeLevel`,
`postedDateEstimated Boolean`.

`externalId` = `<batchContentHash first 8>:<rowIndex>`, keeping the
existing `@@unique([source, externalId])` meaningful and idempotent
per batch.

`postedDate` stays **non-null**: filled from the real column when JobThai
supplies it, otherwise from `JobThaiBatch.receivedDate` with
`postedDateEstimated = true`. No migration is needed later when real
dates arrive.

### `JobRequiredEducationLevel` enum (new)

`VOCATIONAL_CERT` (ปวช) / `HIGHER_VOCATIONAL_CERT` (ปวส) / `BACHELOR` /
`MASTER` / `DOCTORATE` / `UNSPECIFIED`.

A new enum rather than reusing `ProgramLevel`, because **26.9% of postings
ask for ปวช/ปวส**, which `ProgramLevel` cannot express — it describes KKU
degree programmes, not the Thai vocational tiers below them. Overloading
it would force those 12,831 postings into a wrong value or a null.

### `SkillSource` enum extension

Add `ALIAS_MATCHED` and `EMBEDDING_MATCHED` via
`ALTER TYPE ... ADD VALUE IF NOT EXISTS` (the `DecisionStatus` precedent
from prompt 12). A deterministic alias hit is neither `MANUAL` nor
`LLM_EXTRACTED`, and a provenance drawer must not claim otherwise.

### Tables deliberately NOT created

- **A field-requirement table.** The extracted fields live on the posting
  (`requiredFieldsRaw`) and aggregate into `ProgramJobThaiLink.evidenceTh`.
- **A bespoke skill-demand aggregate.** `JobThaiOccupationSkill` joined
  to `ProgramJobThaiLink` is roughly 8,650 x 301 and cheap. Add one only
  if a measurement shows it is needed.
- **Province/time aggregates.** These populate the **existing, empty
  `OccupationDemand`** table (`occupationCode` = `jobthai:<subcategory
  slug>`, namespaced so JobThai rows never collide with a future ISCO-08
  or NSO code in the same column,
  plus `province`, `year`, `month`, `postingsCount`), which finally gives
  the Gap Analyzer's regional lens data it has never had.

## Admin UI — `/admin/jobthai`

Follows `/admin/trend-documents` (`apps/api/src/trend-documents/`) as the
precedent, including `FileInterceptor`. Size limit **25 MB** — the
current files are 4.2-5.4 MB, so this leaves headroom without inviting a
whole-year dump through a synchronous request.

| Endpoint | Behaviour |
|---|---|
| `POST /jobthai/batches` | multipart upload; validates the 7 expected headers **before** storing and rejects with the missing column named, rather than failing mid-parse; content-hash dedupe; enqueues parse |
| `GET /jobthai/batches` | list with filename, rows, received date, status, skills-extracted count |
| `DELETE /jobthai/batches/:id` | removes the batch and cascades its postings; leaves `JobThaiOccupation` intact and recomputes aggregates |

RBAC: ANALYST and ADMIN. Every mutation `@AuditLog()`.

UI is a table plus a drop zone, reusing `DataTable`, `FreshnessBadge` and
`RightPanel`. Labels English per the language policy.

## Extraction pipeline

Five ordered phases on the existing `ai-jobs` BullMQ queue. Each is
individually re-runnable and idempotent.

1. **Parse.** Stream rows; skip the 19 exact duplicates; write
   `JobPosting`. Scrub emails and phone-like digits from raw text on the
   way in using the existing `sanitizeAiOutput` scrubber (0.6% / 0.5% of
   rows). **Discard gender and age requirements** — never stored, never
   extracted, never surfaced.
2. **Occupations.** Derive the 173 `JobThaiOccupation` rows from the
   taxonomy columns. No LLM.
3. **Deterministic skills.** `lookupAliasesBulk` over qualification and
   description text against the 4,407 skills / 5,313 aliases →
   `JobPostingSkill` with `extractedBy = ALIAS_MATCHED`, rolled up into
   `JobThaiOccupationSkill`. Cost: zero.
4. **Embeddings and semantic pass.** Embed the 4,407 skills and the 173
   occupation profiles. pgvector-match qualification phrases phase 3
   missed, above a cosine floor of **0.80** (`JOBTHAI_EMBED_MATCH_FLOOR`),
   writing `EMBEDDING_MATCHED`. **0.80 is a starting value, not a
   measured one** — it must be validated against a hand-checked sample of
   100 matches before any figure derived from it reaches a Council
   surface, and the spec is wrong if that validation is skipped. This is the
   first thing in the project to populate `Skill.embedding`.
5. **Bounded LLM.** 173 occupation-profile calls; field-of-study
   normalisation over the distinct `สาขา` phrasings rather than per
   posting; novel-skill discovery on a stratified sample of **2 postings
   per subcategory (346 calls, capped at 400)** feeding the
   existing `PROPOSED_SKILL` review queue, which is how the taxonomy has
   always grown. Budget ~$2-5, inside the $10/day `AiQuotaGuard`.

## Programme bridge and the relevance dimension

`ProgramJobThaiLink` is populated by both paths independently:

- **Field-of-study path.** Normalised `requiredFieldsRaw` matched against
  programme name and discipline. Direct and defensible: the posting
  literally states which graduates it wants.
- **Skill-overlap path.** `JobThaiOccupationSkill` intersected with
  `ProgramSkill`, analogous to the existing KMITL alignment.

Relevance gains **one** new driver:

**`jobthai_demand_alignment`** — the share of a programme's taught skills
that appear in the demand set of its linked occupations. The direct
analogue of the existing `labour_market_alignment`, so the two are
comparable and can visibly disagree.

It returns **null, never 0** when:

- the programme is postgraduate (0.8% source coverage), or
- its linked occupations carry fewer than **30 postings** in total
  (`JOBTHAI_MIN_POSTINGS_FOR_SIGNAL`). 30 is chosen as a starting value
  because the source has only 304 Khon Kaen postings in total and a
  programme resolving to a handful of them would produce a number that
  looks precise and is not. Review it against the observed per-programme
  distribution once phase 6 has run.

`demand_match_filled` additionally gains JobThai as a **second demand
source** in `apps/ingestion/src/program-demand-match/run.ts`, so the AI
match pass considers JobThai-demanded skills alongside KMITL's.

### Methodology version

Bumps to **`health-score.v5.1`**, with `BUNDLE_CALENDAR_TAG` bumped
alongside it. Adding the driver to `DIMENSION_DRIVERS.relevance` means
the v5.0 parity guard
(`packages/db/test/health-score-driver-parity.test.ts`) will **fail until
the driver exists at both programme and scope level** — the exact drift
that caused the v5.0 defect cannot recur silently here.

## Connector flip

`JobThaiConnector` is rewritten as a `CsvFileConnector` subclass:
`kind: CSV`, `inputFormat: XLSX`, `deprecated` removed from the catalog,
and — per the `data_sources` drift audit memory — **`status` and `mocked`
flipped atomically**, because `prisma/seed.ts` writes both from the
catalog on every seed and a stale `mocked: true` would make
`realDataWhere()` silently discard every row loaded.

`fetch()` enumerates `PENDING` batches; `transform()` parses rows;
`load()` writes. Rollback remains `CONNECTOR_JOBTHAI_MODE=mocked`.

Per gate 11 of `docs/readiness-checklist.md`, JobThai outputs are
preview-quality until 30 days of green history accrue from the flip date.

## Provenance and caveats

Every JobThai-derived figure carries, in its provenance drawer:

- 37% Bangkok, 3.3% Northeast, Khon Kaen 304 — **with the counts**, not
  an adjective
- 0.8% postgraduate coverage, and that the driver is null rather than
  zero for those programmes
- no salary or employer data in the source
- whether posting dates are real or estimated from batch receipt
- a sample-size flag when a programme's linked occupations fall below the
  floor

## PDPA posture

Job postings are published advertisements, not personal data. The
residual risks are handled at parse time: emails (0.6%) and phone-like
digits (0.5%) are scrubbed from stored raw text, and gender/age
requirements are discarded rather than stored. No employer names exist in
the source to begin with. The uploaded XLSX files themselves are stored
in MinIO and deletable through the admin UI.

## Testing

**Unit:** header validation with a named missing column; duplicate-row
rejection; gender and age exclusion; Buddhist-era date handling if a date
column arrives; alias-before-embedding precedence; `share` arithmetic;
null-not-zero for postgraduate programmes and for below-floor occupations.

**Integration:** a 50-row fixture drawn from the real files, run through
parse → occupations → deterministic skills → programme link, asserting
row counts and idempotency on a second run.

**Guard:** `jobthai_demand_alignment` present at both programme and
faculty scope, enforced by the existing parity test.

**Fixtures carry no PII** and are safe in git, consistent with the
`kku-registry` fixture correction of 2026-08-27.

## Plan decomposition

This spec is deliberately larger than one implementation plan. Split it in
two at the sequencing boundary below, because step 6 is the first point
where a number changes on a Council-facing surface:

- **Plan A — ingestion and extraction (steps 0-5).** Ends with 47,643
  postings, 173 occupations and their skills in the database, visible in
  the admin UI, and `demand_match_filled` no longer dark. Changes no
  Council figure and needs no methodology bump, so it can land and be
  reviewed on its own.
- **Plan B — programme bridge and relevance (steps 6-8).** The
  programme link, the new driver, `health-score.v5.1`, docs, and the
  connector flip. Deliberately gated behind Plan A having run against the
  real files, because the driver's floor and the cosine threshold should
  be set from observed distributions rather than guessed.

## Sequencing

0. **Prerequisite:** provenance backfill on the 6,224 orphaned
   `program_demand_matches`, plus stamping on write. Lights up
   `demand_match_filled` before anything else changes.
1. Schema migration (four tables, enum extension, `JobPosting` columns).
2. Admin UI and API with parse phase — end-to-end upload to
   `JobPosting` rows.
3. Occupations and deterministic skills.
4. Embeddings and semantic pass.
5. Bounded LLM phases.
6. Programme bridge.
7. Relevance driver, `health-score.v5.1`, docs and changelog.
8. Connector flip and catalog update.

## Deferred

- Growth and trend analysis once real posting dates arrive.
- ISCO-08 crosswalk between `JobThaiOccupation` and `KmitlCareer`.
- Per-posting embeddings, if a use is ever decided.
- Reconciliation between the JobThai and KMITL demand signals where they
  disagree — visible to analysts in this iteration, not automatically
  resolved.
- Revisiting the national-weighting decision if Northeast coverage
  improves in later drops.
