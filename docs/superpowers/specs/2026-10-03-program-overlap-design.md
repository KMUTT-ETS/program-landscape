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

1. an Education dashboard page with an overlap network and a ranked pair list (originally a clustered heatmap; see §10.1);
2. Risk Management, through two indicators for self-competition and customer confusion;
3. a Program Deep-Dive section listing overlapping programmes with recommendations.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **Prepare the data first.** Re-run courses-extract v4 for course categories, load course descriptions and CLOs, create a PLO table, and embed all three. Overlap is not computed on the incomplete data held today. |
| D2 | **Graded actions with evidence, always labelled "for review".** Rules pick the actions; the AI only writes the reasoning and may record that it disagrees. "Consider merging" needs both high overlap and high containment. |
| D3 | **Self-competition enters Risk Management as two new KRIs.** Risk tiers do not change. |
| D4 | *Superseded by D9 (equal weighting of three layers).* **A deterministic, three-layer index.** The layers are structure, content and outcome, weighted equally, with containment measured in both directions. The AI drafts wording only for flagged pairs. This was chosen over AI judging every pair (≈ $140 a run and not reproducible) and over keyword similarity (weak on Thai). |
| D5 | **Same degree level, all faculties.** Only canonical ACTIVE programmes (`IS_CANONICAL_PROGRAM` + `status = 'ACTIVE'`) are compared. Bachelor is never compared with master. |
| D6 | **The Deep-Dive Overlap section is hidden** when the programme has no sibling scoring 30 or more, or when no overlap run exists. |
| D7 | **The content layer is based on course names, with descriptions added where available** (decided 2026-10-03, after the prep dry run measured description coverage at about 21 %). Name-only matches need a stricter threshold. Extracting full descriptions from every PDF was rejected for cost and delay; it could be added later as v2. |
| D8 | *Superseded by D9.* **PLO-only overlap needs corroboration (shared staff or market similarity ≥ 30)** (decided 2026-10-03, after the first real run). A limited-evidence pair (§12.4) with no shared active staff member and market similarity below 30 gets no index, band or action; its layers stay visible as evidence. See §12.5. |
| D9 | **The overlap index is course-based (structure + content); PLO alignment is supporting context only.** PLOs are broad by design. Measured on the first real run: at master's level 27 of the 29 pairs ≥ 50 were PLO-only, and the AI disagreed with the rule-chosen action on 15 of 74 recommendations. Course codes starting GE, LI or 00 are always general education. User decision, 2026-10-03. Supersedes D4's equal three-layer weighting and D8. See §12.6–§12.7. |

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
- **General-education prefixes (D9):** a course whose normalised code starts with **GE**, **LI** or **00** is always excluded, whatever its category (`GENERAL_EDUCATION_CODE_PREFIXES`). See §12.7 for the evidence.
- **Service-course safety rule:** a course code used by more than **25 %** of the canonical programmes at the same level is treated as a service course and excluded, even when its category says otherwise or is missing. Examples are GE341511 (49 programmes) and LI101001.

## 5. Scoring (`program-overlap.v1`)

Every unordered pair (A, B) of canonical ACTIVE programmes **at the same level** is scored.

### 5.1 Layers (each 0–100, or null)
- **Structure: courses literally shared.**
  - Shared = major courses with the same normalised code in both programmes; the credits used are `min(credits_A, credits_B)` per course.
  - `S = 2 × sharedCredits / (majorCredits_A + majorCredits_B) × 100`
  - **Null** when either programme has no major course rows.
- **Content: equivalent courses with different codes.**
  - The courses compared are the **embedded** major courses (§4.4) that were *not already matched by code*. Most are embedded on names alone (D7).
  - Pairs are formed by **one-to-one greedy matching** over cosine similarity, most similar first, so each course is used at most once.
  - A pair is equivalent when its cosine reaches the threshold for its basis. This stands in for the 75 % content rule.
    - **Both courses described:** `COURSE_EQUIV_THRESHOLD` = 0.85 (calibrated, §12).
    - **Either course name-only:** `COURSE_EQUIV_NAME_THRESHOLD` = 0.90 (calibrated, §12). Titles carry less information, so they must agree more closely.
    - Both thresholds were confirmed at calibration (§12). Each match records its basis (`description` or `name`).
  - `C = 2 × (sharedEmbeddedCredits + equivCredits) / (embeddedMajorCredits_A + embeddedMajorCredits_B) × 100`, where `sharedEmbeddedCredits` covers embedded courses both programmes share by code. They are trivially equivalent; leaving them out would score two identical programmes 0 on content. `equivCredits` alone (different codes only) drives the "consolidate equivalent courses" action.
  - **Null** when either programme has fewer than 3 embedded major courses.
- **Outcome: PLO alignment — supporting context only (D9).** Computed, stored and shown with its matched and unmatched PLOs, but it never enters the index, band, actions, containment, storage or the KRIs.
  - A PLO is **covered** when its best cosine against the other programme's PLOs is ≥ `PLO_MATCH_THRESHOLD` = 0.85 (calibrated, §12; raised from the provisional 0.80).
  - `O = (covered_A + covered_B) / (n_A + n_B) × 100`
  - **Null** when either programme has no PLOs.

### 5.2 Index and containment
- **Overlap index (D9)** = the mean of the non-null **course** layers (structure, content), equal-weighted. The outcome layer is not part of it. A pair with no course layer has no index, band none and no actions ("not scored — no course comparison"); it is stored only through the market rule below. `evidence.coverage.courseLayers` (0–2) records how many course layers were measured.
- **Containment, A in B** (course side only, D9) = `(sharedCredits + equivCredits) / majorCredits_A`, where `equivCredits` counts only when the content layer is non-null. Null when the structure layer is null or A has 0 major credits.
- **Containment, B in A** is computed the same way the other way round. Both are 0–100.
- *Superseded:* the limited-evidence cap (§12.4) and the corroboration rule (D8, §12.5) were removed by D9 — once PLOs no longer enter the index, a PLO-only pair simply has no index.

### 5.3 Signals reported beside the index (not part of it)
- **Shared active staff:** distinct `FacultyMember`s with `isActive` who are linked through `ProgramFaculty` to both programmes.
- **Market similarity:** cosine of the two market-profile embeddings, rescaled to 0–100 against the calibrated floor 0.80 and ceiling 0.95 (§12): a cosine of 0.80 or less reads 0, 0.95 or more reads 100.
- **Language variant:** set when the two programmes have the same normalised `nameTh` once "หลักสูตรนานาชาติ" / "(นานาชาติ)" / "International Program(me)" is stripped, **and** either their recorded `language` differs (both known) **or** exactly one of the two carries one of those international markers in its Thai or English name (case-insensitive). The marker arm exists because dev records both halves of some pairs as `MIXED` (for example the Thai and international MSc Pharmacology); two identical unmarked names in the same language are a true duplicate, not a variant. The degree name alone is *not* enough: generic degree names such as "วิศวกรรมศาสตรบัณฑิต" span unrelated programmes taught in both languages (checked on dev, 2026-10-03). These pairs overlap by design; they are labelled, are never recommended for merging, and are left out of both KRIs.

### 5.4 Bands and storage
- **Bands:** high ≥ 70, moderate 50–69, low 30–49 (confirmed at calibration, §12), on the course-based index (D9).
- **What is stored:** a pair whose index is ≥ 30, **or** that shares at least one major course or one active staff member, **or** whose market similarity is at or above the market-confusion warn value (60) — so a confusable pair is stored even with low curriculum overlap.

## 6. Actions and AI recommendations

### 6.1 Actions
Actions are chosen by rules. A pair may receive several; the strongest becomes `primaryAction`. All are labelled "for review".

| Action (enum `OverlapAction`) | Rule (calibrated 2026-10-03, §12) |
|---|---|
| `CONSOLIDATE_EQUIVALENT_COURSES` | `equivCredits ≥ 6` |
| `COORDINATE_SHARED_COURSES` | `sharedCredits ≥ 6` |
| `SHARE_STAFF_RESOURCES` | index ≥ 50 |
| `DIFFERENTIATE` | index ≥ 50 **and** market similarity ≥ the market-confusion critical value (75) **and** not a language variant |
| `CONSIDER_MERGE_OR_TRACK` | index ≥ 70 **and** max containment ≥ 80 **and** not a language variant |

**Language variants** overlap by design (§5.3): they never receive `DIFFERENTIATE` or `CONSIDER_MERGE_OR_TRACK` (the D9 re-run had given `DIFFERENTIATE` to the Thai / international Pharmacology MSc, DrPH and PharmD).

**Course-based (D9):** the index and containment are course-only, so every action rests on course evidence. A pair with no course comparison gets no action. The limited-evidence cap and the corroboration rule (D8) are gone.

Market confusion: warn 60 / critical 75 (≈ cosine 0.89 / 0.91 under the 0.80 floor), confirmed at calibration; `DIFFERENTIATE` uses the critical value; pairs at or above warn are stored even with low curriculum overlap. Both live in `OVERLAP_THRESHOLDS` (`marketConfusionWarn`, `marketConfusion`).

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
  - **`curriculum_overlap_max`:** the programme's highest overlap index (course-based, D9) against any same-level sibling, excluding language variants. Warning at 50, breach at 70. A pair with no course comparison has no index and never reaches it; there is no evidence cap.
  - **`market_confusion_max`:** the programme's highest market similarity against any same-level sibling, excluding language variants. Market confusion: warn 60 / critical 75, calibrated 2026-10-03 (`OVERLAP_THRESHOLDS.marketConfusionWarn` / `marketConfusion`); `DIFFERENTIATE` uses the critical value; pairs at or above warn are stored even with low curriculum overlap.
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
- **Controls:** level (default Bachelor), measure (overlap index — the default — / structure / content), faculty filter, minimum threshold (30 / 50 / 70, default 30). Level, faculty, measure, threshold, the selected programme (`node`) and the open pair (`pair`) are all kept in the URL. The page is scope-aware: faculty scope shows that faculty's programmes plus their outside siblings. PLO alignment and market similarity are not overlap measures under D9, so they are no longer offered as a measure; they stay in the pair side panel as context.
- **Change of visual (user decision, 2026-10-03).** The first build drew a clustered programme × programme heatmap (`OverlapMatrix`). On dev it was about 99 % empty — about 100 bachelor programmes, only about 40 pairs at index ≥ 30 and about 9 at ≥ 50 — so the user chose an overlap network on top and a ranked pair list underneath. `OverlapMatrix` was removed.
- **`OverlapNetwork`:** an inline-SVG viz primitive in `@kku/ui/viz`, with a pure, deterministic layout module (`overlap-network-layout.ts`). No new charting library.
  - Nodes are only the programmes with at least one scored pair at or above the threshold; edges are those pairs. Not-scored pairs (no course comparison, D9) are never drawn.
  - Layout: seeded Fruchterman–Reingold per connected component (fixed iterations, heavier pairs pull closer), each node's label box pushed clear of the others so labels never collide, and components packed into rows, strongest peak first. The same data always yields the same picture.
  - Edges use one sequential hue (chart series 1); stroke width and opacity step together by band (30–49 / 50–69 / ≥ 70). Thai / international versions of one programme are dashed, with a legend entry.
  - Nodes are neutral, labelled with the short Thai programme name and the faculty code underneath ("· Intl" for an international programme). They are not coloured by faculty: there are about 20 faculties and categorical colour stops being readable past about 8.
  - Hover or keyboard focus shows a tooltip — for an edge both names, the measure, structure and content, same or across faculties, and the suggested action ("for review"); for a node its names and number of overlaps. Every node and edge is focusable and activates with Enter; hit targets are wider than the marks.
  - Clicking a node filters the pair list to that programme (a "Filtered to … · clear" chip shows it) and emphasises its edges, dimming the rest. Clicking an edge opens the pair side panel.
  - Light and dark mode through the chart tokens; an explicit empty state when no pair reaches the threshold.
- **Ranked pair list** (`apps/web/src/components/overlap/pair-list.tsx`) — the chart's table view. One row per scored pair at or above the threshold, sorted by the chosen measure, strongest first. Each row shows both programmes (Thai name, then English name and faculty code), the measure as an integer, two labelled thin bars for structure and content, the larger containment direction ("A ⊂ B · 84 %", or "—"), a Thai / international badge and the primary action badge ending "— for review". A row opens the same pair side panel.
- **Pair side panel:** the evidence, the AI recommendation and links to both Deep-Dives (unchanged from the first build).
- **KPI strip:** high-overlap pairs, programmes in a group, merge candidates, and equivalent credits that could be consolidated.
- **Groups list:** dropped with the matrix — the network's connected components show the same groups, and the KPI strip still counts programmes in groups at index ≥ 50.
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
  - canonical ACTIVE programmes only;
  - the storage filter;
  - a scoped run merging over the full run;
  - the KRIs being null without a run and breaching at threshold;
  - measures being derived correctly.
- **UI tests:**
  - the Deep-Dive section is hidden below 30 and when no run exists;
  - a recommendation never renders without confidence and sources;
  - the overlap network renders with tokens only; its layout is deterministic, places every qualifying node, keeps components and labels apart.
- **Live on dev:** the calibration in §9, then one dashboard and one Deep-Dive checked in a browser.

## 12. Calibration results

Calibrated **2026-10-03 on dev**. These values are final for `program-overlap.v1`; any later change bumps the version.

### 12.1 Data coverage
- **PLOs:** 1,834 PLOs for 285 programmes.
- **Major courses:** 8,846, all embedded. 25.3 % of major credits are described (description and/or CLOs), across 216 programmes; the rest are embedded on names alone (D7).
- **Market profiles:** 301.
- **Courses extract (v4) backfill:** USD 4.83; 160 programmes OK, 57 degraded or skipped, of 217.

### 12.2 Observed distributions
- **Market-profile cosine** (same-level pairs):

  | Level | p50 | p90 | p99 |
  |---|---|---|---|
  | Bachelor | 0.759 | 0.808 | 0.872 |
  | Master | 0.771 | — | 0.879 |
  | Doctoral | 0.807 | — | 0.895 |

  Market profiles of programmes at one university share a great deal of wording, so the cosines sit high and close together. Under the provisional 0.60 floor the median bachelor pair already read ≈ 45 and the median doctoral pair ≈ 59, just under the warn value. With the floor at 0.80 the bachelor and master medians read 0, and warn 60 (cosine ≈ 0.89) sits at about the p99 of every level.
- **Course best-match cosine:** described courses p90 0.719, max 0.884 (200-pair sample); name basis p90 0.732. Both equivalence thresholds (0.85 described, 0.90 name-only) sit above the p90 and are kept.

### 12.3 PLO template finding
PLOs are written to a shared template, so at 0.80 unrelated programmes covered each other's PLOs. Two examples that match at 0.80 and not at 0.85:
- finance vs marketing (การเงิน vs การตลาด): **0.837**;
- physics against materials science: **0.836**.

Pairs with outcome ≥ 50 by PLO threshold:

| Level | 0.80 | 0.85 | 0.90 |
|---|---|---|---|
| Bachelor | 86 | 74 | 62 |
| Master | 81 | 48 | 20 |
| Doctoral | 37 | 21 | 14 |

0.85 is chosen: it removes the template matches above. A generic-PLO filter is **unnecessary at 0.85**: no PLO matches more than 25 % of programmes at its level.

### 12.4 Limited-evidence rule (superseded by D9)
A PLO-only pair could reach index 100 and be recommended for a merge on outcome text alone. Agriculture vs Animal Science did exactly that: outcome 100, no course layer, `CONSIDER_MERGE_OR_TRACK`. Strong conclusions now need course evidence (§6.1): a pair with fewer than 2 non-null layers, or no course layer, is **limited evidence** — band capped at moderate, no `DIFFERENTIATE`, no `CONSIDER_MERGE_OR_TRACK`. It is still stored and still gets the weaker actions.

### 12.5 Corroboration rule (D8, superseded by D9)
The first real run showed the limited-evidence cap was not enough:
- **Master's:** 27 of the 29 pairs with index ≥ 50 were limited evidence; 22 of those had no shared staff and market similarity below 20. They were unrelated programmes matching on generic graduate PLOs, e.g. **Dentistry vs Architecture** and **Geo-Informatics vs Applied Mathematics**.
- **Bachelor:** 5 such pairs; **doctoral:** 1.
- The AI recommendations flagged 15 of 74 as disagreeing with the rule-chosen action, mostly these pairs.

A limited-evidence pair now needs corroboration: a shared active staff member, or market similarity ≥ 30 (≈ raw cosine 0.845, about the top 10 % of same-level pairs). Without it the pair has no index, band or action (§5.2).

### 12.6 Course-based index (D9)
The cap (§12.4) and corroboration (§12.5) were patches on a measure that let broad PLO wording drive the index. The evidence in §12.5 (master's 27 of 29 pairs ≥ 50 PLO-only; AI disagreement on 15 of 74) shows PLO alignment is not discriminating enough to drive the index: PLOs are broad by design. D9 therefore makes the index course-based (structure + content) and keeps PLO alignment as supporting context, shown beside the index with its matched and unmatched PLOs. Containment is course-side only. The limited-evidence cap and corroboration rule are removed.

### 12.7 General-education code prefixes (D9)
Measured on dev, 2026-10-03, by course-code prefix:

| Prefix | Categorised general education | Categorised major |
|---|---|---|
| GE | 195 | 0 |
| LI | 166 | 1 |
| 00 | 15 | 0 |

158 courses with these prefixes had a null or `UNKNOWN` category and were leaking into the major set, where shared general-education courses inflated the structure layer. A code starting GE, LI or 00 is now always general education (§4.5), whatever its category.

### 12.8 Chosen values

| Threshold | Value | Change from provisional |
|---|---|---|
| `courseEquiv` (both described) | 0.85 | unchanged |
| `courseEquivName` (name-only) | 0.90 | unchanged |
| `ploMatch` | **0.85** | 0.80 → 0.85 |
| `marketFloor` / `marketCeiling` | **0.80** / 0.95 | floor 0.60 → 0.80 |
| `marketConfusionWarn` / `marketConfusion` | 60 / 75 (≈ cosine 0.89 / 0.91) | unchanged on the 0–100 scale |
| Bands low / moderate / high | 30 / 50 / 70 | unchanged |
| Overlap index | mean of the course layers (structure, content) | **D9**: was the mean of all three layers; outcome is context only |
| Containment | course side only | **D9**: PLO share removed |
| Merge rule | index ≥ 70, containment ≥ 80, not a language variant | unchanged (course-based index) |
| General-education prefixes | GE, LI, 00 | **new (D9)** |
| Limited evidence cap; `corroborationMarket` (D8) | — | added during calibration, **removed by D9** |

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
5. **UIs:** dashboard overlap network and pair list, Risk panel, Deep-Dive section.
6. **Docs.**

On prod after deploy: `programs:overlap-prep --apply` (including the v4 backfill), then `programs:overlap --apply`, then phase 8. Prod recomputes from its own data; nothing is copied from dev.

## 14. Out of scope

- Comparing programmes across levels.
- Comparing against outside institutions (that is Benchmarking).
- Market cannibalisation measured from applicant overlap. TCAS data is aggregate only.
- Overlap in the Deep-Dive print and the Program Detail PDF.
- Changing risk tiers. A possible L4 driver comes later, after one review cycle.
