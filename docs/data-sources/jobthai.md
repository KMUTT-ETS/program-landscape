# JobThai

**Slug:** `jobthai` · **Phase:** B · **Kind:** CSV (XLSX files) · **Cadence:** manual upload · **Status:** ✅ real (since 2026-09-13)

> **Un-deprecated 2026-09-13.** This source was marked SUPERSEDED by
> [kmitl-skill-mapping](./kmitl-skill-mapping.md) on 2026-05-01 on the
> assumption that "JobThai" meant a paid API we never bought. It does not: KKU
> receives XLSX exports by hand. Those give us three things
> `kmitl-skill-mapping` structurally cannot — **province granularity, industry
> sector, and an explicit field-of-study requirement per posting**.

---

## What it is

Thai job postings exported from JobThai and delivered as XLSX files. Each
posting carries a title, a two-level job taxonomy, an industry sector, a
province, and two free-text blocks (duties and qualifications).

## Access

| | |
|---|---|
| Delivery | XLSX files, by hand from JobThai to KKU Data Office |
| Upload surface | `/admin/jobthai` (ANALYST + ADMIN) |
| Storage | MinIO, bucket `MINIO_BUCKET_CSV_UPLOADS` (default `csv-uploads`), key `jobthai/<sha256>.xlsx` |
| Auth / credentials | none — no network call is made |
| Mode flag | `CONNECTOR_JOBTHAI_MODE=real` (rollback: `mocked`) |
| Schedule | disabled; there is nothing to poll |

## Data shape

Seven columns, all present in every file of the 2026-09 drop, in this order:

`Job Title`, `Job Category (ประเภทงานหลัก)`,
`Job Subcategory (ประเภทงานย่อย)`, `Business (ประเภทธุรกิจ)`, `Province`,
`Job Description (Raw)`, `Qualification (Raw)`

An optional eighth column, `Posted Date`, is accepted the moment JobThai
supplies it. Until then every posting's `postedDate` falls back to its batch
receipt date with `postedDateEstimated = true`, so no migration is needed
later.

### Measured facts — 2026-09 drop

Five files, `Job_Data_01..05.xlsx`. **Do not re-derive these; they cost a full
parse of 45 MB of Thai text.**

| Fact | Value |
|---|---|
| Rows in source / after dedupe | 47,643 / **47,631** |
| Exact duplicates dropped | 12 within-file, 7 cross-file |
| Distinct job titles | 37,326 |
| Job categories / subcategories | 44 / 173 |
| **Distinct (category, subcategory) pairs** | **240** |
| Business (industry) types | 41 |
| Provinces | 79 |
| Raw text volume | 45,145,451 chars |

The occupation layer is keyed on the **pair**, not the subcategory, because a
subcategory recurs under more than one category — 240 pairs over 173
subcategories. The design document assumed 173; the pair is what the source
actually distinguishes.

### Extracted signal, after parsing

| Signal | Count | Share |
|---|---|---|
| Names a field of study | 19,365 | 40.7% |
| Says "any field" (ทุกสาขา) | 2,566 | 5.4% |
| `minEducationLevel = BACHELOR` | 20,482 | 43.0% |
| `= HIGHER_VOCATIONAL_CERT` | 7,212 | 15.1% |
| `= VOCATIONAL_CERT` | 5,613 | 11.8% |
| `= MASTER` | 39 | 0.1% |
| `= DOCTORATE` | 2 | 0.0% |
| `= UNSPECIFIED` | 14,283 | 30.0% |

`minEducationLevel` is the **lowest** level a posting states, because
"ปวช., ปวส.- ปริญญาตรี" means a ปวช holder is acceptable. That is why MASTER
reads 39 rather than the 364 postings that merely *mention* a master's degree —
41 postings state a postgraduate qualification as the floor. The smaller number
is the correct one for "what this employer will accept".

## CAVEATS — these travel with every figure derived from this source

| | |
|---|---|
| **Geography** | 37.0% Bangkok (17,633). **3.3% across the 20 Northeast provinces** (1,564). Khon Kaen alone **304**. This describes the national labour market, not KKU's region. |
| **Postgraduate** | 0.8% mention a postgraduate qualification; **41 state one as the minimum**. Near-blind to 179 of KKU's 297 programmes. |
| **Absent fields** | no salary, no employer name, no posting date. |
| **Time** | no trend or growth analysis is possible until real dates arrive. |

`jobThaiCoverage()` in `packages/db/src/jobthai.ts` computes these from the data
rather than restating them, so a provenance drawer cannot drift away from the
figures after a new drop lands.

## Deliberate exclusions

**Gender and age requirements are discarded at parse time**, never stored.
They appear in 47.5% and 55.3% of postings respectively. They are not skills,
and surfacing "employers want women under 30" on a Council surface would be the
worst possible outcome of this feature. A test asserts 0 surviving tokens across
all 47,631 rows.

Email addresses, phone numbers, LINE recruitment ids and TikTok handles are
redacted from stored text. All three exclusion checks read **0** over the
full corpus.

## Mapping to our schema

| Source field | Our target | Table |
|---|---|---|
| Job Title | `title` | `job_postings` |
| Job Category | `jobCategory` | `job_postings` |
| Job Subcategory | `jobSubcategory` | `job_postings` |
| Business | `businessType` | `job_postings` |
| Province | `province` | `job_postings` |
| Job Description (Raw) | `descriptionRaw` (scrubbed) | `job_postings` |
| Qualification (Raw) | `qualificationRaw` (scrubbed) | `job_postings` |
| — derived — | `requiredFieldsRaw`, `minEducationLevel` | `job_postings` |
| (category, subcategory) | one row each | `jobthai_occupations` |
| matched skills | per posting / per occupation | `job_posting_skills`, `jobthai_occupation_skills` |

`job_postings` gained an `ingestion_run_id` column on 2026-09-13. The table
predates the provenance convention, so **every row written before that could
never have passed `realDataWhere()`** — the same class of gap that left 6,224
`program_demand_matches` invisible to the relevance dimension.

## Skill matching

Deterministic, no LLM, no cost, fully re-runnable. Every `Skill.nameEn`,
`Skill.nameTh` and `RESOLVED` `SkillAlias` becomes a search term — 10,882 terms
over 4,407 skills.

**Latin-script terms require word boundaries. This is load-bearing.** Measured
over the real corpus, a plain substring match produced:

| Term | Matched inside | Rate |
|---|---|---|
| `micros` (MICROS POS software) | "**Micros**oft" | **26% of all postings** |
| `ran` (Radio Access Network) | "b**ran**d", "t**ran**sport" | 10% |
| `stem` (STEM education) | "sy**stem**" | 9% |
| `opera` (Opera Performance) | "**opera**tion" | 9% |
| `git` (Git) | "di**git**al" | 4% |

Thai cannot be word-bounded — it has no inter-word spaces and we have no
tokeniser — so Thai terms carry a higher length floor instead
(`MIN_TERM_LENGTH_THAI = 5`). At 3 characters, "สติ" (mindfulness) matched 6% of
postings from inside พลาสติก (plastic) and โลจิสติกส์ (logistics), and "กิต"
(Git) matched inside บัณฑิต (graduate). The cost of the floor is a few genuine
four-character Thai terms such as เคมี (chemistry), which their English names
still catch.

After the fix the 30 most-matched terms are all plausible: Communication,
Management, Coordination, Leadership, Marketing, Finance, Drawing,
Decision-making, Troubleshooting, Negotiation, Planning, Purchasing.

## Outcome of the first full run (2026-09-13)

| | |
|---|---|
| Postings loaded | 47,631 (5 batches, 0 failed) |
| Occupations derived | 240 |
| Posting-skill links | 186,994 |
| Occupation-skill rows | 28,159 |
| Distinct skills matched | 1,611 of 4,407 |
| Postings matching ≥1 skill | 37,262 (**78.2%**) |

Sample, and a useful sanity check on the whole pipeline — งานจัดซื้อ
(purchasing) resolves to Purchasing 58% and Negotiation 41%; งานช่างซ่อมบำรุง
(maintenance) to Preventive Maintenance 20%, Troubleshooting 8%, Occupational
Safety 6%; งานคลังสินค้า (warehousing) to Management 30% and Logistics
Management 7%.

### FINDING — the skill taxonomy contained duplicates (fixed 2026-09-13)

Matching at this volume surfaced a pre-existing data-quality problem in
`skills`, not in JobThai:

| | |
|---|---|
| Case-insensitive duplicate name groups | **386** |
| Redundant rows | **456** of 4,407 (10.3%) |
| Occupation-skill rows pointing at a duplicated name | **9,992** of 28,159 (35.5%) |

"Data Science" exists as five separate `Skill` rows; "Scientific Writing" five;
"Biostatistics", "Biotechnology", "Digital Literacy" four each.

**Why this blocks Plan B rather than merely looking untidy.** The proposed
`jobthai_demand_alignment` driver measures the share of a programme's taught
skills that appear in its occupations' demand set. If a programme's
`ProgramSkill` points at one "Data Science" row and the demand set at another,
the match silently fails — a false negative that makes a well-aligned programme
look misaligned. The same split also under-counts each duplicate in any
share-weighted aggregate and makes a "top skills" list show one skill twice.

**RESOLVED 2026-09-13.** 386 groups merged, 456 rows removed (4,407 → 3,951)
via `pnpm skills:dedupe`. Coverage after recomputing the derived tables is
**78.2%, identical to before** — the merge removed redundant representations
without losing any matching capability. Posting-skill links fell 186,994 →
160,834 and distinct matched skills 1,611 → 1,326, which is the double-counting
going away. The 65 discarded Thai spellings were preserved as `SkillAlias`
rows rather than dropped, so the matcher still resolves them. Root cause fixed
in `normalise-skill-names.ts` and `promoteNewProposedToSkill`; see
`packages/db/src/skill-dedupe.ts`.

## Embeddings and the cosine floor

`Skill.embedding` (4,407 rows) and `JobThaiOccupation.embedding` (240) are
populated as of 2026-09-13 — the first vectors this project has ever written
into columns that existed from prompt 01. Cost: effectively zero.

**The vector columns are `vector(1536)` but the current Gemini embedding model
returns 3072 dimensions**, which Postgres rejects outright. The request pins
`dimensions: 1536`; Gemini's embedding models are Matryoshka-trained, so this is
a valid truncation rather than a damaged vector.

**The guessed 0.80 cosine floor was measurably wrong, and wrong in the
dangerous direction.** Across the five largest occupations all 40 nearest
skills were genuinely relevant, with cosines of 0.712–0.808 — so 0.80 would
have rejected 39 of 40 correct matches and made the semantic pass quietly
useless rather than noisy. The constant is now 0.72.

That is still not a labelled precision study. 40 observations over 5
occupations is a sanity check; the ~100-sample hand-labelled set the design
asked for has not been done, so **the semantic match pass stays disabled** and
no `EMBEDDING_MATCHED` row has been written. Inspect with
`pnpm jobthai:embed --inspect`.

## Runbook

```bash
# 1. Upload through the UI, or seed a batch directly, then:
CONNECTOR_JOBTHAI_MODE=real pnpm connector:run jobthai   # parse PENDING batches
pnpm jobthai:derive                                      # dry run
pnpm jobthai:derive --apply                              # occupations + skills
```

Both phases are idempotent. Occupations upsert on (category, subcategory);
skill links are replaced for this source on each run, so re-running after the
taxonomy grows picks up new skills without duplicating old ones.

## Readiness

Per gate 11 of `docs/readiness-checklist.md`, JobThai outputs are
**preview-quality until 30 days of green history accrue from 2026-09-13**.
The source does not yet feed the health score; that is Plan B
(`docs/superpowers/plans/`), which adds a `jobthai_demand_alignment` relevance
driver and bumps `health-score.v5.1`.

## PDPA posture

Job postings are published advertisements, not personal data. Residual risks
are handled at parse time (contact details and handles redacted;
protected-attribute requirements discarded). No employer names exist in the
source. The uploaded files themselves live in MinIO and are deletable from
`/admin/jobthai`.

## Session log

| Date | Change |
|---|---|
| 2026-04-24 | Catalog stub created, mocked (prompt 14 scaffold). |
| 2026-05-01 | Marked SUPERSEDED by `kmitl-skill-mapping` — on the incorrect assumption that JobThai required a paid API. |
| 2026-09-13 | Un-deprecated and flipped real as a CSV/XLSX file source. 47,631 postings, 240 occupations loaded. Parser, connector, admin UI and deterministic skill matching shipped. |
