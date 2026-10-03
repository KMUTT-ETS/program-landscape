# Programme overlap — `program-overlap.v1`

| Version | Date | Change |
|---|---|---|
| `program-overlap.v1` | 2026-10-03 | First version. Thresholds calibrated on dev the same day (§11). After the first real run the index was made **course-based** (D9): the PLO layer is supporting context only, and the interim limited-evidence and corroboration rules (D8) were withdrawn. AI wording by `program-overlap-recommendation.v1`. Feeds `risk-scoring.v1.14` (two KRIs) and `risk-measure-rules.v2`. |

**Authority.** The code is the authority for every formula and value on this
page: `packages/db/src/program-overlap/score.ts` (`OVERLAP_THRESHOLDS`,
`DEFAULT_COURSE_CREDITS`, `scorePair`, `shouldStorePair`),
`packages/db/src/program-overlap/risk.ts` and `merge.ts` (the KRI signal and
the reader contract), `packages/db/src/risk-scoring.ts` (KRI thresholds),
`apps/ingestion/src/program-overlap/prep.ts` and `run.ts` (data prep and the
runner), and `packages/shared/src/ai/prompts/program-overlap-recommendation.ts`
(the AI wording). Design record:
`docs/superpowers/specs/2026-10-03-program-overlap-design.md` (its sections on
D9 were being revised when this page was written; where the two differ, this
page and the code describe the final design).

**Versioning.** The thresholds in §11.4 are final for `program-overlap.v1`.
Changing any of them after release bumps `PROGRAM_OVERLAP_VERSION`; changing
the two market-confusion values also bumps `RISK_SCORING_VERSION`, because the
KRI reads them from the same constant.

---

## 1. Purpose — what it answers

Strategic question 4: *which programmes duplicate each other across faculties
and could be consolidated?*

KKU runs about 300 programmes and, before this methodology, nothing in Program
Landscape measured how far their curricula overlap. `program-overlap.v1`
compares every pair of programmes **at the same degree level**, across all
faculties. The **overlap index rests on courses only** (D9):

1. **Structure** — major courses literally shared (same course code);
2. **Content** — equivalent major courses with different codes.

A third layer, **outcome** (alignment of the programme learning outcomes,
PLOs), is computed and shown as **supporting context**. It never affects the
index, the band, the actions, containment, what is stored or the KRIs:
PLOs are written to a shared template, so on their own they made unrelated
programmes look alike (§11.3).

Beside the index the methodology reports shared active teaching staff, market
similarity and a language-variant flag. Rules turn the figures into graded
actions, all labelled **for review**: share courses, share staff and resources,
differentiate, and — only where the evidence is strong — consider a merge or a
track. A pair with neither course layer is **not scored — no course
comparison**.

Three surfaces read it:

- **Education → Program overlap** (`/education/program-overlap`): an overlap
  network (only programmes with a pair at or above the threshold, one line
  per pair), a ranked pair list underneath, a KPI strip and a pair side
  panel;
- **Risk Management**: two KRIs (`curriculum_overlap_max`,
  `market_confusion_max`) and a *Self-competition* panel on `/risks`;
- **Program Deep-Dive**: an *Overlap* section listing a programme's siblings,
  hidden when no sibling reaches index 30 or no run exists (D6).

It measures **curriculum** overlap. It does not measure market
cannibalisation (§12).

---

## 2. Decisions

| # | Decision |
|---|---|
| D1 | Prepare the data first (course categories, descriptions and CLOs, a PLO table, embeddings); overlap is not computed on the incomplete data held before. |
| D2 | Graded actions with evidence, always labelled "for review". Rules pick the actions; the AI writes the reasoning only and may record that it disagrees. A merge needs both high overlap and high containment. |
| D3 | Self-competition enters Risk Management as two new KRIs; risk tiers and composites do not change. |
| D4 | ~~A deterministic three-layer index (structure, content, outcome; equal weights).~~ **Superseded by D9.** Still in force: the index is deterministic, containment is measured both ways, and the AI only drafts wording. Rejected: the AI judging every pair (≈ USD 140 a run, not reproducible) and keyword similarity (weak on Thai). |
| D5 | Same degree level, all faculties; canonical ACTIVE programmes only. Bachelor is never compared with master. |
| D6 | The Deep-Dive *Overlap* section is hidden when no sibling scores ≥ 30, or no run exists. |
| D7 | The content layer embeds every major course on its names, adding description and CLOs where available; a name-only match needs a stricter threshold. |
| D8 | ~~A limited-evidence pair needs corroboration (shared staff or market ≥ 30).~~ **Superseded by D9** — kept here as calibration history (§11.3). |
| D9 | **The index is course-based**: the mean of structure and content. The PLO layer is supporting context only and never affects the index, band, actions, containment, storage or KRIs; containment is course-side only. A pair with no course layer is not scored. The limited-evidence cap and the corroboration rule are removed. Courses coded GE, LI or 00 are always general education. |

---

## 3. The practice it is modelled on

- **Credit transfer and programme review.** Shared courses are counted by
  credit. A course with a different code counts as **equivalent** when its
  content matches closely; the embedding threshold stands in for the Thai
  credit-transfer rule that course content must match **at least 75 %**.
- **Curriculum mapping (AUN-QA, TQF).** Each PLO is matched to its closest
  counterpart in the other programme, in both directions — the matrix a
  programme review draws by hand. Here it is shown to the reviewer as context,
  not scored (D9).
- **Containment.** "A sits largely inside B" is how a review spots a
  programme that could become a track of another; it is measured separately
  in each direction, on credits.

---

## 4. Data preparation (`pnpm programs:overlap-prep`)

`apps/ingestion/src/program-overlap/prep.ts`. Dry run by default (counts only,
**no model call**); `--apply` writes. Idempotent: unchanged inputs write
nothing, and a vector is re-embedded only when the sha256 of its text changes.

| Step | Source → target |
|---|---|
| **Course categories** | Pipeline phase 2b, `program-courses-extract.v4`, re-run for programmes whose `ProgramCourse` rows predate v4. A separate backfill, not part of `overlap-prep` (§13). |
| **1. PLO table** | Latest `AiExtraction` of kind `PROGRAM_SKILLS_DETAILED`, `payloadJson.programLearningOutcomes` → `program_learning_outcomes` (`textTh` verbatim; `textNormalised` with "PLO 1.1" / "PLO1:" / "ELO 2" / "3." labels stripped; unique on programme, ordinal and revision). |
| **2. Course descriptions and CLOs** | The programme's latest `PROGRAM_DIGEST` with review status `APPROVED` or `AUTO_APPROVED`, `courses[]`, matched on the normalised course code → `ProgramCourse.descriptionTh` / `learningOutcomesTh`. |
| **3. Market profiles** | Programme names (TH / EN), degree names (TH / EN), the recruitment summary and the careers list → `program_market_profiles.text`. |
| **4. Embeddings** | `gemini-embedding-001` via `AiService.embed` at **1536 dimensions**, **L2-normalised** before storage, for each PLO (`textNormalised`), every embeddable major course, and each market profile. Written with `$executeRaw`, read with `$queryRaw` and Zod-validated. |

**Course text (D7).** A major course is embedded on `nameTh / nameEn`, plus
its description and `CLO: …` lines when it has them. A course with neither
name is skipped. Measured on 2026-10-03, the approved digests list about 8
courses per programme, so descriptions cover only part of the portfolio
(§11.1). Descriptions are therefore a bonus; the content layer rests mostly
on names. A course counts as **described** when it carries a description.

**Embedded categories.** Prep embeds courses in `CORE`, `MAJOR_REQUIRED`,
`MAJOR_ELECTIVE` and `UNKNOWN`, and courses with no category. The service-course
rule (§5) is applied at scoring time.

**Fixed in passing.** `apps/ingestion/src/program-peers/review.ts` used to
read PLOs from the `PROGRAM_DIGEST` payload, which carries none, so the
peer-review prompt always received an empty list. It now reads the PLO table.

---

## 5. Which courses count as major

`majorCourses()` in `score.ts`:

- **General-education codes:** a course whose code starts **GE**, **LI** or
  **00** is always general education and never counts as major, whatever its
  category says or when it has none (D9).
- **Excluded categories:** `GENERAL_EDUCATION`, `FREE_ELECTIVE`, `THESIS_PROJECT`.
  Everything else counts — `CORE`, `MAJOR_REQUIRED`, `MAJOR_ELECTIVE`,
  `UNKNOWN` and courses with no category.
- **Service-course rule:** a code used by **more than 25 %** of the canonical
  programmes at the same level (`serviceCourseShare` 0.25) is a service course
  and is excluded, whatever its category says. Examples on dev: GE341511
  (49 programmes), LI101001.
- **De-duplication:** the filter runs first, then courses are de-duplicated by
  code, keeping the first occurrence with the largest recorded credits. A code
  also listed under an excluded category still counts as major.
- **Missing credits:** a course with no recorded credits is weighted as
  `DEFAULT_COURSE_CREDITS = 3`. How many were defaulted is reported per pair
  (`evidence.coverage.defaultedCredits`).

---

## 6. Scoring

Every unordered pair (A, B) of canonical ACTIVE programmes at the same level is
scored. `credits(c)` is the recorded credits or 3. `pct(x, d)` is
`clamp(x / d × 100)` to 0–100, or **null** when `d = 0`. Course and PLO
matching use the dot product, which equals the cosine because every stored
vector is L2-normalised.

### 6.1 Structure — courses literally shared

```
shared        = major courses of A whose normalised code is also a major course of B
sharedCredits = Σ over shared of min(credits_A, credits_B)
S             = pct(2 × sharedCredits, majorCredits_A + majorCredits_B)
```

**Null** when either programme has no major course rows.

### 6.2 Content — equivalent courses with different codes

Only **embedded** major courses enter. Requires at least `minEmbeddedCourses`
= **3** on each side; otherwise **null**.

1. Candidates are the embedded courses *not* shared by code.
2. **One-to-one greedy matching**: every candidate pair at or above its
   threshold, most similar first, each course used at most once (ties broken by
   input order, so the result is deterministic).
3. Threshold by basis:
   - both courses **described** → `courseEquiv` **0.85**, basis `description`;
   - either course **name-only** → `courseEquivName` **0.90**, basis `name`
     (titles carry less information, so they must agree more closely).
4. `equivCredits = Σ min(credits_A, credits_B)` over the matched pairs.

```
sharedEmbeddedCredits = Σ min(credits) over embedded courses both share by code
C = pct(2 × (sharedEmbeddedCredits + equivCredits),
        embeddedMajorCredits_A + embeddedMajorCredits_B)
```

`sharedEmbeddedCredits` is included because a course both programmes share is
trivially equivalent; without it two identical programmes would score 0 on
content. `equivCredits` alone (different codes only) drives the
*consolidate equivalent courses* action. Each pair reports how many of its
matches rested on descriptions (`coverage.descriptionMatches`).

### 6.3 Outcome — PLO alignment (supporting context, not scored)

A PLO is **covered** when its best similarity against the other programme's
PLOs is ≥ `ploMatch` **0.85**.

```
O = (covered_A + covered_B) / (n_A + n_B) × 100
```

**Null** when either programme has no PLOs. O, the matched PLO pairs (each
covered PLO with its best counterpart) and each side's unmatched PLOs are
stored and shown — on the pair panel, the Deep-Dive row and to the AI — so a
reviewer can see whether two programmes promise similar graduates. **O never
enters the index, the band, the actions, containment, the storage rule or the
KRIs (D9).**

### 6.4 Overlap index and band

```
overlapIndex = mean of the non-null of {S, C}     (equal weights)
             = null  when S and C are both null   → "not scored — no course comparison"
```

| Band | Index |
|---|---|
| `HIGH` | ≥ 70 |
| `MODERATE` | 50 – < 70 |
| `LOW` | 30 – < 50 |
| `NONE` | < 30, or null |

A pair with no course layer has no index and no band, and receives no action;
it is still stored when it shares an active staff member or its market
similarity reaches 60 (§6.7), so the market-confusion KRI sees it.

### 6.5 Containment (course-side only)

```
matchedCredits  = sharedCredits + (C is null ? 0 : equivCredits)
containmentAInB = pct(matchedCredits, majorCredits_A)   (when both have major courses, else null)
containmentBInA = pct(matchedCredits, majorCredits_B)
```

Both 0–100. PLO coverage does not enter containment (D9).

### 6.6 Signals beside the index (not part of it)

- **Shared active staff:** distinct `FacultyMember`s with `isActive` linked
  through `ProgramFaculty` to both programmes.
- **Market similarity:** cosine of the two market-profile embeddings, rescaled:
  `clamp((cosine − 0.80) / (0.95 − 0.80) × 100)`. A cosine of 0.80 or less reads
  0; 0.95 or more reads 100. Null when either profile is missing.
- **Language variant:** the two programmes have the same Thai name once
  "หลักสูตรนานาชาติ", "(นานาชาติ)" and "International Program(me)" are stripped,
  **and** either their recorded `language` differs (both known) **or** exactly
  one of the two carries an international marker in its Thai or English name.
  The marker arm exists because dev records both halves of some pairs as
  `MIXED` (e.g. the Thai and international MSc Pharmacology). A shared degree
  name alone is deliberately **not** enough: generic degree names such as
  "วิศวกรรมศาสตรบัณฑิต" span unrelated programmes in both languages. Two
  identical unmarked names in the same language are a true duplicate, not a
  variant. Language variants overlap by design: they are labelled, never
  recommended for merging, and left out of both KRIs.

### 6.7 What is stored (`shouldStorePair`)

A pair is stored when **any** of:

- `overlapIndex ≥ 30` (`storeIndex`);
- it shares at least one major course;
- it shares at least one active staff member;
- `marketSimilarity ≥ 60` (`marketConfusionWarn`) — so a confusable pair is
  stored even when its curriculum overlap is low or unmeasured.

Every same-level pair is scored; only stored pairs are written.

---

## 7. Actions

Chosen by rules (`scorePair`). A pair may receive several; the **strongest**
becomes `primaryAction`. Every action is labelled **for review**.

| Action (`OverlapAction`) | Rule |
|---|---|
| `COORDINATE_SHARED_COURSES` | `sharedCredits ≥ 6` |
| `CONSOLIDATE_EQUIVALENT_COURSES` | `equivCredits ≥ 6` |
| `SHARE_STAFF_RESOURCES` | `overlapIndex ≥ 50` |
| `DIFFERENTIATE` | `overlapIndex ≥ 50` **and** `marketSimilarity ≥ 75` |
| `CONSIDER_MERGE_OR_TRACK` | `overlapIndex ≥ 70` **and** max(containment) ≥ 80 **and** not a language variant |

**Strength order**, weakest to strongest: coordinate shared courses <
consolidate equivalent courses < share staff and resources < differentiate <
consider merge or track.

Because the index and containment rest on courses, every action now rests on
course evidence; that is what the withdrawn limited-evidence and corroboration
rules (§11.3) were approximating.

---

## 8. The AI recommendation (`program-overlap-recommendation.v1`)

- **When:** only for stored pairs with at least one action **and**
  `overlapIndex ≥ 50`. Through `AiService` (`extractStructured`), every call
  recorded in `AiInference`.
- **Input:** both programmes (code, names TH / EN, faculty, latest enrolled
  headcount), the level, the rounded layer scores, both containment figures,
  market similarity, shared and equivalent credits, shared staff count, the
  shared courses, the equivalent pairs with similarity and basis, the matched
  PLO pairs and each side's unmatched PLOs as context (each list capped at 25 items with
  an "omitted" count), both market texts, and the rule-chosen actions,
  strongest first.
- **Output (Zod):** `rationale`, `distinctiveA`, `distinctiveB`, `nextSteps`
  (2–4), `confidence` (0–1), `disagreesWithAction` and `disagreementReason`
  (required, ≥ 20 characters, when it disagrees). **English only**, per
  `docs/prompt-standard.md`; Thai course and programme names are quoted as data.
- **Limits.** The AI **never changes the action**. A disagreement is shown next
  to the action for a human to judge. Every surface renders the recommendation
  with `<ConfidenceBadge>`, sources, "show reasoning" and the disagree button.
- **Reuse.** Every run writes new pair rows. A recommendation with the same
  prompt version for the same (level, programme A, programme B, evidence hash)
  is copied onto the new pair with no model call. The **evidence hash** is a
  sha256 over everything the AI reads (evidence, layers, containment, shared
  staff, market similarity, actions, language variant), numbers rounded to
  4 dp so float noise never moves it. A recommendation is therefore re-run
  only when the evidence or the prompt version changes.

---

## 9. Risk Management — two KRIs (`risk-scoring.v1.14`)

Both evaluated in pipeline phase 8 from the current overlap pairs of the
programme's level (§10), excluding language variants. `alarmDirection: high`.

| KRI | Value | WARN | CRITICAL |
|---|---|---|---|
| `curriculum_overlap_max` | highest course-based `overlapIndex` against a same-level sibling | ≥ 50 | ≥ 70 |
| `market_confusion_max` | highest `marketSimilarity` against a same-level sibling | ≥ 60 (≈ cosine 0.89) | ≥ 75 (≈ cosine 0.91) |

- The curriculum thresholds are the overlap bands (`bandModerate`,
  `bandHigh`); the market thresholds are `OVERLAP_THRESHOLDS.marketConfusionWarn`
  and `marketConfusion`, the same values that drive storage and `DIFFERENTIATE`.
- **No run covering the programme → no row** ("no overlap analysis yet"),
  never 0.
- **Covered but nothing stored → OK row with a null value.** Once a run covers
  the programme, each KRI always emits a row, so an earlier breach is
  superseded. Values are maxima over **stored** pairs; both storage floors
  (index 30, market 60) sit at or below WARN, so the severity is never wrong —
  only the exact value of an OK reading can be unknown.
- The curriculum value comes from the **max-overlap pair**, and so do the
  merge-candidate flag, containment and actions handed to the AI. A pair with
  no course comparison has no index, so it never reaches the curriculum KRI.
- **Measures** (`risk-measure-rules.v2`): a CRITICAL `curriculum_overlap_max`
  fires `CURRICULUM_DIFFERENTIATE`, plus `PROGRAM_MERGE` when the max pair's
  actions include `CONSIDER_MERGE_OR_TRACK`; a
  CRITICAL `market_confusion_max` fires `CURRICULUM_DIFFERENTIATE` with
  recruitment wording. The measure's evidence names the sibling, the run and
  the pair. The AI prompt (`risk-assessment.v4`) receives the named siblings
  and is told every overlap measure is for review and never to propose closure.
- Risk tiers, composites and the 5 × 5 matrix are unchanged. Risk Management
  is scoped to bachelor programmes, so the KRIs surface there for bachelor
  programmes; overlap itself is computed at all four levels.

---

## 10. Runs and the reader contract

**Commands.**

- `pnpm programs:overlap [--level=X] [--apply] [--no-ai] [--calibrate]` — scores
  every level (or one). A dry run computes everything and prints the
  distributions, writing nothing. `--apply` writes one `ProgramOverlapRun` per
  level (pairs and the SUCCEEDED flip in one transaction), then the AI wording
  unless `--no-ai`. `--calibrate` is a read-only calibration report.
- **Pipeline phase `phaseOV`** ("Programme overlap", after phase 7, before
  phase 8): recomputes every same-level pair touching the selected
  programme(s) and writes a **scoped** run (`scopeProgramIds` non-empty). With
  more than one programme selected in one CLI invocation it writes one run
  over the selection.

**Reader contract** (`merge.ts`, `selectOverlapRuns` / `mergeOverlapRuns`):

1. Only `SUCCEEDED` runs count. RUNNING and FAILED runs carry no pairs but stay
   as provenance; `ProgramOverlapRun` is this derived data's provenance, the
   equivalent of `ingestion_run_id`.
2. The base is the latest SUCCEEDED **full** run of the level
   (`scopeProgramIds = []`).
3. SUCCEEDED scoped runs completed at or after the base are applied oldest
   first. A scoped run covers **every** pair touching its programmes: rows held
   so far for those pairs are dropped — even when the scoped run has no row for
   the pair, which means it no longer meets the storage rule — and the scoped
   run's rows are added.
4. Ties: a scoped run completed at the same instant as the base **is** applied;
   equal-time full runs resolve to the larger id; equal-time scoped runs apply
   in id order.

Every pair row carries `methodologyVersion`, the run's `thresholdsJson` and
`coverageJson` (with the distributions) are kept on the run.

---

## 11. Calibration evidence (dev, 2026-10-03)

### 11.1 Data coverage

- **PLOs:** 1,834 for 285 programmes.
- **Major courses:** 8,846, all embedded. **25.3 %** of major credits are
  described, across 216 programmes; the rest are embedded on names alone.
- **Market profiles:** 301.
- **Courses-extract v4 backfill:** USD 4.83; of 217 programmes, 160 OK and 57
  degraded or skipped.

### 11.2 Distributions

Market-profile cosine, same-level pairs:

| Level | p50 | p90 | p99 |
|---|---|---|---|
| Bachelor | 0.759 | 0.808 | 0.872 |
| Master | 0.771 | — | 0.879 |
| Doctoral | 0.807 | — | 0.895 |

Market profiles at one university share much wording, so cosines sit high and
close together. Under the provisional 0.60 floor the median bachelor pair read
≈ 45 and the median doctoral pair ≈ 59, just under WARN. With the floor at 0.80
the bachelor and master medians read 0, and WARN 60 (cosine ≈ 0.89) sits at
about the p99 of every level.

Course best-match cosine: described courses p90 0.719, max 0.884 (200-pair
sample); name basis p90 0.732. Both equivalence thresholds sit above the p90
and are kept.

### 11.3 The PLO template finding, and why the index became course-based

PLOs are written to a shared template, so at 0.80 unrelated programmes covered
each other's PLOs — finance vs marketing **0.837**, physics vs materials
science **0.836**. Pairs with outcome ≥ 50:

| Level | 0.80 | 0.85 | 0.90 |
|---|---|---|---|
| Bachelor | 86 | 74 | 62 |
| Master | 81 | 48 | 20 |
| Doctoral | 37 | 21 | 14 |

0.85 removes those template matches, and no PLO matches more than 25 % of the
programmes at its level.

Raising the threshold was not enough. Two interim rules were tried and are
**withdrawn** — recorded here as history, not live rules:

- **Limited evidence** (fewer than 2 layers, or no course layer → band capped
  at moderate, no strong actions). A PLO-only pair could otherwise reach index
  100: Agriculture vs Animal Science read outcome 100 with no course layer and
  drew `CONSIDER_MERGE_OR_TRACK`.
- **Corroboration (D8)** — a limited-evidence pair also needed a shared staff
  member or market similarity ≥ 30. The first real run showed why: at master's
  level **27 of the 29** pairs with index ≥ 50 were limited evidence, and
  **22** of those had no shared staff and market similarity below 20 —
  unrelated programmes matching on generic graduate PLOs, e.g. *Dentistry vs
  Architecture* and *Geo-Informatics vs Applied Mathematics*. Bachelor had 5
  such pairs, doctoral 1. The AI recommendations flagged **15 of 74** as
  disagreeing with the rule-chosen action, mostly these pairs.

Both rules were patching the same fault: outcome text was allowed to stand in
for curriculum. **D9** removes the fault instead — the index, containment and
actions use courses only, and PLO alignment is shown as context.

### 11.4 Chosen values (`OVERLAP_THRESHOLDS`)

| Threshold | Value | Change from provisional |
|---|---|---|
| `courseEquiv` (both described) | 0.85 | unchanged |
| `courseEquivName` (name-only) | 0.90 | unchanged |
| `ploMatch` (context layer) | **0.85** | 0.80 → 0.85 |
| `marketFloor` / `marketCeiling` | **0.80** / 0.95 | floor 0.60 → 0.80 |
| `marketConfusionWarn` / `marketConfusion` | 60 / 75 (≈ cosine 0.89 / 0.91) | unchanged |
| `bandLow` / `bandModerate` / `bandHigh` | 30 / 50 / 70 | unchanged |
| `serviceCourseShare` | 0.25 | — |
| General-education code prefixes | GE, LI, 00 | **new** (D9) |
| `minEmbeddedCourses` | 3 | — |
| `courseActionCredits` | 6 | — |
| `actionIndex` | 50 | — |
| `mergeIndex` / `mergeContainment` | 70 / 80 | unchanged |
| `storeIndex` | 30 | — |
| Index layers | structure + content, equal weights | **changed** (D9): outcome removed from the index |
| `DEFAULT_COURSE_CREDITS` | 3 | — |

### 11.5 First dev run

All four levels, on the three-layer index before D8 and D9: pairs stored —
bachelor **608**, master **237**, doctoral **147**, higher graduate diploma
**18**. The first AI pass wrote **74** recommendations for **USD 0.85**. Those
figures predate the course-based index; a re-run under D9 will move them, and
the PLO-only pairs that dominated the master's list no longer score.

---

## 12. Caveats

1. **Curriculum overlap is not market cannibalisation.** Two programmes can
   share courses and still recruit different students. Applicant overlap is
   not measurable here: TCAS data is aggregate only. Market similarity
   compares what the programmes *say* about themselves, not who applies.
2. **Most of the content layer rests on names.** About 25 % of major credits
   are described; the rest are matched on course titles, which carry less
   information (hence the 0.90 threshold). A name-only match is weaker
   evidence than a described one, and each pair reports how many matches
   rested on descriptions.
3. **Missing credits are defaulted to 3**, and the count is reported per pair.
4. **Master's and doctoral PLOs are generic.** Graduate PLOs follow a shared
   template, which is why the outcome layer is context only (§6.3, §11.3). A
   graduate programme whose curriculum has few extracted major courses may
   therefore read "not scored".
5. **Course categories are missing where extraction degraded.** Of 217
   programmes in the v4 backfill, 57 were degraded or skipped — no รายวิชา
   section in the PDF for at least 15, PDFs missing on dev, and a
   courses-extract schema defect that rejects a course with a null English
   name. Uncategorised courses count as major unless the GE / LI / 00 prefix rule or
   the service-course rule removes them, so general-education courses with
   other codes can still leak into the course layers for those programmes.
6. **Admin multi-select writes one scoped run per programme.** The pipeline
   queue runs each selected programme as its own job, so a multi-select from
   the admin page writes a scoped run per programme rather than one run over
   the selection. The merge rule makes the result correct, but the run table
   grows faster than it needs to.
7. **Language variants are detected by name**, not by a registrar flag; a
   variant with a differently worded Thai name is not caught.
8. **Not a lower bound.** Unlike the grant-engagement driver, there is no
   unmatched-identifier undercount here: shared staff and shared courses are
   exact joins.

---

## 13. Production run order

On prod after deploy, from prod's own data — nothing is copied from dev:

1. **Courses-extract v4 backfill** — pipeline phase 2b for programmes whose
   `ProgramCourse` rows predate `program-courses-extract.v4`
   (`programs-pipeline … --only=phase2b`; ≈ USD 0.02 a programme).
2. **`programs:overlap-prep`** — dry run first, then `--apply` (PLOs,
   descriptions, market profiles, embeddings).
3. **`programs:overlap`** — dry run first, then `--apply` (one full run per
   level plus the AI wording).
4. **Phase 8** (risk assessment) so the two KRIs and their measures are written.

Inside the ingestion container the two overlap scripts are bundled as
`dist/scripts/programs-overlap-prep.js` and `dist/scripts/programs-overlap.js`.
