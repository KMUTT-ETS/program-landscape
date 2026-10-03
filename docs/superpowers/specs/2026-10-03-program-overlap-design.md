# Program overlap: curriculum overlap between programmes of the same degree level

**Date:** 2026-10-03 · **Status:** approved in brainstorming, awaiting spec review
**New methodology:** `program-overlap.v1`. **Methodology changes:** `risk-scoring.v1.13 → v1.14`, plus a methodology bundle tag bump.
**Answers strategic question 4:** "Which programmes duplicate each other across faculties and could be consolidated?"

## 1. Purpose

KKU offers about 300 programmes, and nothing in the platform measures how far they overlap. This
feature measures curriculum overlap between programmes **of the same degree level**, across all
faculties, from three sources:

- the programme learning outcomes (PLOs);
- the programme structure, meaning the major courses and their credits;
- the course contents.

The measurement is used to suggest shared courses, shared teaching staff and resources,
differentiation and, where the evidence is strong, merging.

It feeds three surfaces:

1. an Education dashboard page with a clustered overlap heatmap;
2. Risk Management, through two indicators for self-competition and customer confusion;
3. a Program Deep-Dive section listing overlapping programmes with recommendations.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **Prepare the data first.** Re-run courses-extract v4 for course categories, load course descriptions and CLOs, create a PLO table, and embed all three. Overlap is not computed on the incomplete data held today. |
| D2 | **Graded actions with evidence, always labelled "for review".** Rules pick the actions; the AI only writes the reasoning and may record that it disagrees. "Consider merging" needs both high overlap and high containment. |
| D3 | **Self-competition enters Risk Management as two new KRIs.** Risk tiers do not change. |
| D4 | **A deterministic, three-layer index.** The layers are structure, content and outcome, weighted equally, with containment measured in both directions. The AI drafts wording only for flagged pairs. This was chosen over AI judging every pair (≈ $140 a run and not reproducible) and over keyword similarity (weak on Thai). |
| D5 | **Same degree level, all faculties.** Only canonical programmes (`IS_CANONICAL_PROGRAM`) are compared. Bachelor is never compared with master. |
| D6 | **The Deep-Dive Overlap section is hidden** when the programme has no sibling scoring 30 or more, or when no overlap run exists. |
| D7 | **The content layer is based on course names, with descriptions added where available** (decided 2026-10-03, after the prep dry run measured description coverage at about 21 %). Name-only matches need a stricter threshold. Extracting full descriptions from every PDF was rejected for cost and delay; it could be added later as v2. |

## 3. Practice this is modelled on

- **Course matching** follows programme review and credit transfer. Shared courses are counted by credit. A course with a different code counts as equivalent when its content matches, which stands in for the Thai credit-transfer rule that course content must match at least 75 %.
- **PLO alignment** follows the curriculum-mapping matrix used in AUN-QA and TQF reviews. Each PLO is matched to its closest counterpart in the other programme, in both directions.
- **Containment** (A largely inside B) is how a review identifies a programme that could become a track of another.

## 4. Data preparation

### 4.1 Course categories
- Re-run courses-extract (pipeline phase 2b, prompt `program-courses-extract.v4`) for every programme whose `ProgramCourse` rows have `methodVersion` older than v4.
- Dev has about 230 programmes; at about $0.02 each that is about $5.
- No new code: this is a bulk run of the existing phase.

### 4.2 Course descriptions and CLOs
- Add `descriptionTh String?` and `learningOutcomesTh String[]` to `ProgramCourse`. This is an additive migration.
- Fill them from the programme's latest `PROGRAM_DIGEST` payload with review status APPROVED or AUTO_APPROVED (`courses[]`), matching on the normalised course code (`packages/db/src/course-code-normalise.ts`).
- **Measured 2026-10-03:** the digests list far fewer courses than their 80-course cap, about 8 per programme. Only about 1,300 of 6,221 major courses (≈ 21 %) match a description. Descriptions are therefore a bonus, not the basis of the content layer (see §4.4 and §5.1, decision D7). Every pair reports how many of its matches rested on descriptions.

### 4.3 PLO table
- New model `ProgramLearningOutcome` with these fields:
  - `programId`;
  - `ordinal`;
  - `textTh`, verbatim;
  - `textNormalised`, with leading "PLO 1.1" / "PLO1" style labels stripped;
  - `programRevisionId`;
  - `sourceExtractionId`;
  - `embedding vector(1536)`.
- Unique on (`programId`, `ordinal`, `programRevisionId`).
- **Source:** the latest `AiExtraction` with `extractionKind='PROGRAM_SKILLS_DETAILED'`, read from `payloadJson.programLearningOutcomes`. That covers 285 programmes on dev.
- **Bug fixed in passing:** `apps/ingestion/src/program-peers/review.ts` reads PLOs from the `PROGRAM_DIGEST` payload, which has no such field. The peer-review prompt therefore always received an empty list. It will read the new table instead.

### 4.4 Embeddings
- **Model:** `gemini-embedding-001` through `AiService.embed`, with `dimensions: 1536`. Vectors are L2-normalised before storage.
- **Method:** batched and rate-limited, reusing the batching pattern in `apps/ingestion/src/jobthai/embed.ts`.
- **Three kinds of text are embedded:**
  1. each PLO, from `textNormalised`;
  2. **every** major course: its names (TH and EN), plus its description and CLOs where they exist. A course with neither name is skipped. This adds a new column, `ProgramCourse.embedding vector(1536)`.
  3. each programme's **market profile**: degree name (TH and EN), recruitment summary and careers. It is stored on a new `ProgramMarketProfile` row (`programId`, `text`, `embedding`, `textHash`).
- A text is re-embedded only when its hash changes.
- Writes go through `$executeRaw`. Reads go through `$queryRaw` with Zod-validated results, which is the repo convention for vectors.
- No vector index is needed: about 14k same-level pairs are computed in memory.

### 4.5 Which courses count as "major"
- **Included:** `CORE`, `MAJOR_REQUIRED`, `MAJOR_ELECTIVE`, `UNKNOWN`, and courses with no category.
- **Excluded:** `GENERAL_EDUCATION`, `FREE_ELECTIVE`, `THESIS_PROJECT`.
- **Service-course safety rule:** a course code used by more than **25 %** of the canonical programmes at the same level is treated as a service course and excluded, even when its category says otherwise or is missing. Examples are GE341511 (49 programmes) and LI101001.

## 5. Scoring (`program-overlap.v1`)

Every unordered pair (A, B) of canonical programmes **at the same level** is scored.

### 5.1 Layers (each 0–100, or null)
- **Structure: courses literally shared.**
  - Shared = major courses with the same normalised code in both programmes; the credits used are `min(credits_A, credits_B)` per course.
  - `S = 2 × sharedCredits / (majorCredits_A + majorCredits_B) × 100`
  - **Null** when either programme has no major course rows.
- **Content: equivalent courses with different codes.**
  - The courses compared are the **embedded** major courses (§4.4) that were *not already matched by code*. Most are embedded on names alone (D7).
  - Pairs are formed by **one-to-one greedy matching** over cosine similarity, most similar first, so each course is used at most once.
  - A pair is equivalent when its cosine reaches the threshold for its basis. This stands in for the 75 % content rule.
    - **Both courses described:** `COURSE_EQUIV_THRESHOLD`, provisionally 0.85.
    - **Either course name-only:** `COURSE_EQUIV_NAME_THRESHOLD`, provisionally 0.90. Titles carry less information, so they must agree more closely.
    - Both thresholds are fixed at calibration (§9). Each match records its basis (`description` or `name`).
  - `C = 2 × (sharedEmbeddedCredits + equivCredits) / (embeddedMajorCredits_A + embeddedMajorCredits_B) × 100`, where `sharedEmbeddedCredits` covers embedded courses both programmes share by code. They are trivially equivalent; leaving them out would score two identical programmes 0 on content. `equivCredits` alone (different codes only) drives the "consolidate equivalent courses" action.
  - **Null** when either programme has fewer than 3 embedded major courses.
- **Outcome: PLO alignment.**
  - A PLO is **covered** when its best cosine against the other programme's PLOs is ≥ `PLO_MATCH_THRESHOLD` (provisionally 0.80; fixed at calibration).
  - `O = (covered_A + covered_B) / (n_A + n_B) × 100`
  - **Null** when either programme has no PLOs.

### 5.2 Index and containment
- **Overlap index** = the mean of the non-null layers, equal-weighted. If every layer is null, the pair has no index and is not stored.
- **Containment, A in B** = the mean of A's non-null one-directional figures:
  - `(sharedCredits + equivCredits) / majorCredits_A`, where `equivCredits` counts only when the content layer is non-null;
  - `covered_A / n_A`.
- **Containment, B in A** is computed the same way the other way round. Both are 0–100.

### 5.3 Signals reported beside the index (not part of it)
- **Shared active staff:** distinct `FacultyMember`s with `isActive` who are linked through `ProgramFaculty` to both programmes.
- **Market similarity:** cosine of the two market-profile embeddings, rescaled to 0–100 against the calibrated floor and ceiling (§9).
- **Language variant:** set when the two programmes have the same `degreeNameTh` (or the same normalised `nameTh` once "หลักสูตรนานาชาติ" / "(นานาชาติ)" is stripped) and differ in `language`. These pairs overlap by design; they are labelled, are never recommended for merging, and are left out of both KRIs.

### 5.4 Bands and storage
- **Bands:** high ≥ 70, moderate 50–69, low 30–49. Bands are provisional until calibration.
- **What is stored:** a pair whose index is ≥ 30, **or** that shares at least one major course or one active staff member.

## 6. Actions and AI recommendations

### 6.1 Actions
Actions are chosen by rules. A pair may receive several; the strongest becomes `primaryAction`. All are labelled "for review".

| Action (enum `OverlapAction`) | Rule (provisional; thresholds fixed at calibration) |
|---|---|
| `CONSOLIDATE_EQUIVALENT_COURSES` | `equivCredits ≥ 6` |
| `COORDINATE_SHARED_COURSES` | `sharedCredits ≥ 6` |
| `SHARE_STAFF_RESOURCES` | index ≥ 50 |
| `DIFFERENTIATE` | index ≥ 50 **and** market similarity ≥ `MARKET_CONFUSION_THRESHOLD` |
| `CONSIDER_MERGE_OR_TRACK` | index ≥ 70 **and** max containment ≥ 80 **and** not a language variant |

Strength order, weakest to strongest: coordinate shared courses < consolidate equivalent courses < share staff and resources < differentiate < consider merge or track.

### 6.2 AI recommendation: prompt `program-overlap-recommendation.v1`
- **When it runs:** only for pairs that have at least one action and an index ≥ 50. The call goes through `AiService`, recorded in `AiInference` via the `@AiCall` pattern. About $0.02 per pair.
- **Input:**
  - both programmes' names (TH and EN), faculty, level and latest intake;
  - the layer scores and both containment figures;
  - the shared courses, the equivalent course pairs (with similarity), the matched PLO pairs, **each side's unmatched PLOs**, the shared staff count and both market texts;
  - the rule-chosen actions.
- **Output (Zod):**
  - `rationale`: English, citing the evidence;
  - `distinctiveA` and `distinctiveB`;
  - `nextSteps`: 2–4 items;
  - `confidence`: 0–1;
  - `disagreesWithAction` (boolean) and `disagreementReason?`.
  - The output is English-only, per `docs/prompt-standard.md`. Thai course and programme names are quoted as data.
- **The AI never changes the action.** A disagreement is shown next to the action for a human to judge.
- **When it is re-run:** only if the pair's evidence hash changed or the prompt version changed.
- **Rendering:** `<ConfidenceBadge>`, clickable sources, "show reasoning" and the "disagree" button.

## 7. Risk Management (D3)

- **Two entries are added to `RISK_INDICATOR_CATALOG`** (`packages/db/src/risk-scoring.ts`). Both use `alarmDirection: high`.
  - **`curriculum_overlap_max`:** the programme's highest overlap index against any same-level sibling, excluding language variants. Warning at 50, breach at 70.
  - **`market_confusion_max`:** the programme's highest market similarity against any same-level sibling, excluding language variants. Warning and breach thresholds are set at calibration.
- **Evaluation:** both are evaluated in phase 8 from the latest SUCCEEDED `ProgramOverlapRun`. Without one, they are null ("no overlap analysis yet"), never 0.
- **Measures** (in `packages/db/src/risk-measure-rules.ts`):
  - a `curriculum_overlap_max` breach adds `CURRICULUM_DIFFERENTIATE`, and adds `PROGRAM_MERGE` too when the breaching pair's actions include `CONSIDER_MERGE_OR_TRACK`;
  - a `market_confusion_max` breach adds `CURRICULUM_DIFFERENTIATE` with marketing wording;
  - `evidenceJson` names the sibling programme and the pair id.
- **Risk tiers and composites are unchanged.** `RISK_SCORING_VERSION` moves to `risk-scoring.v1.14`.

## 8. Storage and runs

- **`ProgramOverlapRun`:** `id`, `methodologyVersion`, `level?` (null means all levels), `scopeProgramIds String[]` (empty means the whole portfolio), `status` (RUNNING / SUCCEEDED / FAILED), `startedAt`, `completedAt`, `pairsScored`, `pairsStored`, `thresholdsJson`, `coverageJson`. Readers take the latest SUCCEEDED full-portfolio run per level. This table is the run's provenance; it is the equivalent of `ingestion_run_id` for this derived data.
- **`ProgramOverlapPair`:**
  - identity: `runId`, `level`, `programAId`, `programBId` (with A < B by id);
  - scores: `structure`, `content`, `outcome`, `overlapIndex`, `containmentAInB`, `containmentBInA`, `band`;
  - figures: `sharedCredits`, `equivCredits`, `sharedStaff`, `marketSimilarity`;
  - flags and actions: `languageVariant`, `actions OverlapAction[]`, `primaryAction`;
  - `evidenceJson`: the shared courses, the equivalent pairs, the matched PLO pairs, the unmatched PLOs and the coverage counts;
  - `evidenceHash` and `methodologyVersion`.
  - Unique on (`runId`, `programAId`, `programBId`).
- **`ProgramOverlapRecommendation`:** `pairId`, the output fields from §6.2, `promptVersion`, `aiInferenceId` and `evidenceHash`.
- **Commands:**
  - `pnpm programs:overlap [--level X] [--apply] [--no-ai]` computes the portfolio. It is a dry run by default, which still computes everything and prints the distributions and calibration statistics.
  - **Pipeline phase `phaseOV`** ("Overlap"):
    - it recomputes the pairs involving the selected programmes and writes a scoped run;
    - readers merge a scoped run over the latest full run for the pairs it covers;
    - it is wired into `PROGRAM_PIPELINE_PHASES`, `PROGRAM_PHASE_META`, `programs-pipeline.ts` (after phase 7, before phase 8) and the esbuild bundle list if it is a new script.
  - The data-prep steps of §4.2–4.4 get their own command, `pnpm programs:overlap-prep [--apply]`. It is idempotent and documented for prod.

## 9. Calibration (before thresholds are frozen)

1. Run `programs:overlap` on dev as a dry run. It reports the distribution of:
   - each layer;
   - the index;
   - containment;
   - market similarity;
   - the best-match cosines for courses and PLOs.
2. Hand-check about 20 pairs:
   - known siblings;
   - Thai and international language variants;
   - same-faculty neighbours;
   - clearly unrelated programmes.
3. Set `COURSE_EQUIV_THRESHOLD`, `COURSE_EQUIV_NAME_THRESHOLD` (checking name-only matches separately on the hand-check pairs), `PLO_MATCH_THRESHOLD`, the market floor, ceiling and confusion threshold, and the bands. Record the evidence in this spec (§12, filled in at that point) and in `docs/methodologies/program-overlap.md`.
4. After release, any change to a threshold bumps `program-overlap.vN`.

## 10. UIs

### 10.1 Education dashboard: `/education/program-overlap`
- **A new hub tile, "Program overlap".**
- **Controls:** level (default Bachelor), layer (index / structure / content / outcome / market), faculty filter, minimum threshold. All are kept in the URL. The page is scope-aware: faculty scope shows that faculty's programmes plus their outside siblings.
- **`OverlapMatrix`:** a new inline-SVG viz primitive in `@kku/ui/viz` (pattern: `CoverageMatrix`).
  - It is a programme-by-programme matrix.
  - Rows and columns are ordered by hierarchical clustering (average linkage on 1 − value), so overlapping groups appear as dark blocks on the diagonal.
  - Cells use the sequential chart tokens, in both light and dark mode, with a faculty colour strip on both axes.
  - Groups (connected components at index ≥ 50) are outlined.
  - Hover shows the names, the three layers and the actions.
  - A click opens a side panel with the evidence, the AI recommendation and links to both Deep-Dives. Zoom to a group is supported.
  - No new charting library.
- **KPI strip:** high-overlap pairs, programmes in a group, merge candidates, and equivalent credits that could be consolidated.
- **Groups list:** members, peak index, headline actions.
- **Standard elements:** `<ProvenanceButton>`, `<FreshnessBadge>` and the methodology version.
- **Wiring:** follow the existing education-tile wiring (thumbnail, nav, permissions, scope guards, analyst dashboard tools, data-fetch admin, topology).

### 10.2 Risk Management
- The two KRIs appear on `/risks/indicators` and on each programme's risk page through the existing machinery.
- **A new "Self-competition" panel on `/risks`** lists the breaching pairs. Each row shows the pair, the index, the market similarity, the latest intake on both sides, the triggered measure and links.

### 10.3 Program Deep-Dive: "Overlap" section
- **Placement:** after Curriculum.
- **When it is hidden (D6):** when the programme has no sibling with an index ≥ 30, or when no run exists. In that case the section and its rail entry are both omitted.
- **Sibling table:** sorted by index. Each row shows:
  - three layer bars;
  - containment arrows;
  - shared staff;
  - the action badge with "for review";
  - a link to the sibling's Deep-Dive.
- **An expanded row** shows the AI recommendation (with the Council-readiness elements), the shared course table, the equivalent course pairs and the PLO match table, including each side's distinctive PLOs.
- **Rail headline:** e.g. "2 high-overlap siblings".
- **API:** `GET /programs/:id/overlap` in `deep-dive.controller.ts`.
- Print and the Program Detail PDF are out of scope for v1.

## 11. Versioning, documentation, testing

- **Versions:** `program-overlap.v1` (registered in `methodology-bundle.ts`); `program-overlap-recommendation.v1`; `risk-scoring.v1.14`; `BUNDLE_CALENDAR_TAG` bump.
- **Docs:**
  - new `docs/methodologies/program-overlap.md`, covering:
    - the formulas, null rules and thresholds;
    - the calibration evidence;
    - the 75 % rationale;
    - the language-variant rule;
    - caveats: the 80-course description cap, category gaps, and that this measures curriculum overlap, not market cannibalisation;
  - a new section in the in-app methodology paper (EN and TH);
  - `docs/evaluation-pipeline.md`;
  - the risk methodology docs;
  - topology;
  - CLAUDE.md;
  - the changelog at release.
- **Pure tests:**
  - the structure formula;
  - greedy one-to-one matching, so no course is matched twice;
  - PLO coverage;
  - containment in both directions;
  - null exclusion (never 0);
  - the composite;
  - the major-course filter, including the 25 % service rule;
  - the language-variant flag;
  - each action rule at its threshold edges;
  - the band edges;
  - clustering order and group building;
  - the evidence hash.
- **Loader and runner tests (mocked Prisma):**
  - same level only;
  - canonical programmes only;
  - the storage filter;
  - a scoped run merging over the full run;
  - the KRIs being null without a run and breaching at threshold;
  - measures being derived correctly.
- **UI tests:**
  - the Deep-Dive section is hidden below 30 and when no run exists;
  - a recommendation never renders without confidence and sources;
  - the matrix renders with tokens only.
- **Live on dev:** the calibration in §9, then one dashboard and one Deep-Dive checked in a browser.

## 12. Calibration results

*To be completed during implementation (§9). Until then every threshold above is provisional.*

## 13. Rollout order

1. **Data prep:**
   - the courses-extract v4 backfill (≈ $5);
   - descriptions and CLOs;
   - the PLO table;
   - embeddings;
   - the peer-review PLO fix.
2. **Engine and runner:** `programs:overlap`, `phaseOV`, the run tables. Then **calibrate**.
3. **AI recommendations.**
4. **KRIs and measures.**
5. **UIs:** dashboard heatmap, Risk panel, Deep-Dive section.
6. **Docs.**

On prod after deploy: `programs:overlap-prep --apply` (including the v4 backfill), then `programs:overlap --apply`, then phase 8. Prod recomputes from its own data; nothing is copied from dev.

## 14. Out of scope

- Comparing programmes across levels.
- Comparing against outside institutions (that is Benchmarking).
- Market cannibalisation measured from applicant overlap. TCAS data is aggregate only.
- Overlap in the Deep-Dive print and the Program Detail PDF.
- Changing risk tiers. A possible L4 driver comes later, after one review cycle.
