# Gap Analyzer rebuilt as a demand-first map — design

**Date:** 2026-09-15 · **Status:** approved in brainstorming, awaiting implementation plan
**Replaces:** the seven-lens Gap Analyzer (`gap-lenses.v1`, v1.6.0) and `computeSkillGap` (`gap-analysis.v1`, prompt 08)
**Owner:** Program Landscape — KKU Curriculum Intelligence Platform

## 1. Why

An audit on 2026-09-15 found that `/gap-analysis` only partly reflects the current data, and that the stale part is the demand side — the module's purpose:

- No Gap Analyzer surface reads JobThai on purpose. Its market signal is the LinkedIn-via-MHESI quadrant (301 rows, 69 distinct skills), while the Deep-Dive and `health-score.v5.2` were rewired to JobThai at 75:25 in v1.9.4.
- Two accidental JobThai leaks: the per-programme skill lens counts every `program_demand_matches` row with no `demand_sources` and no `realDataWhere()` filter; `computeSectorGap` walks `job_posting_skills` (160,834 JobThai rows at weight 1) with no source filter.
- A unit error: `gap = demand − supply` compares a sum of percentages (2,469 at university scope) with weighted graduates per year (157,356). Nearly everything reads "oversupply"; "estimated cohort size" is a percentage-sum ÷ 12.
- Placeholders shipping to Council: `regionalDemand = 100` on `/risks`; "prompt 10" in a table cell on `/opportunities`; `forecast_runs` and `occupation_demand` are empty; `skill_sectors` are 2026-04 regexes never refreshed.
- Newer rules ignored: `demand-match.v4` `fit`/`fit_reason`, the postgraduate honesty gate, the generic-skill exclusion, the 5-skill minimum, `graduate_outcomes`, `student_cohort_distributions`. The one source-aware helper (`computeProgramDemandGaps`) has no UI.
- Navigation: three sub-pages unreachable from the landing page; eight tabs in React state, so no view is shareable.

Six of the seven lenses re-project dimensions the health score already computes per programme; the module adds no new angle as built. The angle it was meant to own — start from **demand** and ask which parts of the labour market the whole portfolio fails to serve, over-serves, or serves with the wrong programmes (strategic questions 3 and 5) — is covered by nothing else and is now answerable because JobThai postings state fields of study and occupations with counts. Decision: **redefine, do not drop.**

## 2. Decisions taken (brainstorm, 2026-09-15)

| # | Decision | Choice |
|---|---|---|
| 1 | Row unit of the map | **Field of study** (what employers say a graduate should hold); occupations expand inside a row; skills only at programme level (Deep-Dive) |
| 2 | Supply measure | **Both**: graduates/yr drives the verdict; current enrolment is the pipeline arrow |
| 3 | Verdict rule | **Share vs share**: ratio = KKU supply share ÷ demand share; white space = no programme; < 0.5 under-served; 0.5–2 served; > 2 over-served; thresholds analyst-tunable via URL, echoed in provenance |
| 4 | LinkedIn (global) | **A "global signal" panel inside each field** via skill overlap with `kmitl_skill_growth`; no career→field mapping invented |
| 5 | Time dimension | **Today + "what's coming" from the Trends Radar**; forecasting deferred until JobThai batches form a time series |
| 6 | Page structure | **One page filtered by verdict** (URL chips + faculty strip); Opportunities → the white-space chip; Risks → retired (Risk register); Digital competency → Education |
| 7 | Field taxonomy | **AI-normalised canonical fields with admin review** (`/admin/job-fields`), the skill-taxonomy review pattern |
| 8 | AI narrative | **One "Council brief" button** over the rows on screen, Council-readiness rules applied; the three old insight modes removed |

## 3. The field taxonomy

### 3.1 Data (two additive migrations)

`job_field_taxonomy` — one row per canonical field:
`id`, `slug` (kebab, unique), `nameTh`, `nameEn`, `synonyms String[]` (raw JobThai strings absorbed; unique across rows, enforced in code), `mentionCount Int` (denormalised, refreshed by the build step), `reviewStatus` (`PROPOSED | APPROVED | REJECTED`), `methodVersion`, `ingestionRunId`, `createdAt`, `updatedAt`. Index on `reviewStatus`; GIN index on `synonyms`.

`program_job_fields` — programme ↔ field assignments:
`id`, `programId` (FK cascade), `fieldId` (FK cascade), `source` (`ai | rule | manual`), `confidence Float?`, `reviewStatus` (as above), `methodVersion`, `ingestionRunId`; unique `(programId, fieldId)`; index on `fieldId`.

Both writers set `ingestionRunId` so the rows pass `realDataWhere()`; a `data_sources` row is not needed — the taxonomy derives from the existing `jobthai` source and stamps its runs.

### 3.2 Build step

Bundled ingestion script `apps/ingestion/src/scripts/jobthai-fields.ts` (`pnpm jobthai:fields`; esbuild TARGET; dry-run by default, `--apply` writes; unknown flags rejected), also enqueued at the end of a JobThai batch refresh after derive/link, the way those run today.

1. Collect raw strings from `job_postings.required_fields_raw` (`source = 'jobthai'`, sentinel `*ANY*` excluded) with **≥ 5 mentions** (~500 of 3,854 on 2026-09-15). Strings below the floor form the **"other"** bucket: counted in denominators, never assigned.
2. Strings not yet in any synonym list go to Gemini in one call, prompt `job-field-taxonomy.v1` (Zod-validated): cluster into canonical fields with TH/EN names and return synonym lists; existing `APPROVED` fields are passed as anchors so new strings attach to them rather than duplicating.
3. Programme assignment: for each programme without an `APPROVED` assignment, a second call (`program-job-field.v1`) sees name TH/EN, degree, level and the programme's skill list and returns ≤ 3 fields with confidence; the name-match rule from `jobthai-bridge` (`matchFieldToProgramme`) is run first and its hits recorded as `source = 'rule'` so the AI only decides the rest.
4. Idempotent: a second run proposes nothing new when nothing changed; `APPROVED`/`REJECTED` rows are never downgraded or renamed; `PROPOSED` rows may be re-proposed.
5. Every AI call: `@AiCall`-equivalent recorder (`AiInference` row), cost logged; expected cost ≈ two calls per run.

### 3.3 Review page `/admin/job-fields` (admin-grade)

Left: fields with synonym chips, mention counts, review status; actions approve / reject / rename / merge (merging moves synonyms and assignments). Right: programme assignments with confidence; actions approve / reassign / add. Every mutation `@AuditLog`'d (`job_field.*`, `program_job_field.*`, both classified `other` in the usage action families). Approving invalidates the map cache.

`PROPOSED` rows are shown on the map immediately, marked "unreviewed" in provenance with counts (n approved / n proposed).

### 3.4 Rules carried over unchanged

`*ANY*` postings count in the denominator, are assigned to no field, and are reported as their own line. The postgraduate honesty gate (`eligiblePostingLevels`) applies: a programme is scored only against postings whose minimum education level admits its graduates; doctoral/master's programmes therefore show numbers but no verdict unless postgraduate postings exist (41 of 47,631 today).

## 4. The map — `computeGapMap` (`gap-map.v1`)

One function in `packages/db/src/gap-map.ts`; everything on the page derives from its result. Inputs: scope (`university | faculty | department`), thresholds `{ under, over }` (defaults 0.5 / 2), `now`. Programme scope redirects to the Deep-Dive.

Per canonical field (`APPROVED` and `PROPOSED`):

- **Demand share** = eligible postings naming any synonym ÷ all eligible postings naming any canonical field. Province breakdown kept for the drawer ("61 % Bangkok, 4 % Isan").
- **Supply share** = graduates/yr of the field's programmes ÷ graduates/yr of all programmes assigned to any field. Graduates/yr = last five registrar cohorts ÷ 5 (`alumni_cohort_statuses` GRADUATED; `enrollment_metrics.graduated_on_time` fallback), both `realDataWhere()`-gated — the supply rule `computeSkillGap` already used. A programme assigned to two fields contributes to both (documented in the drawer); shares are reported per field, so the supply denominator counts each programme once.
- **Pipeline** = current enrolment from `student_cohort_distributions` (`realDataWhere()`); arrow ↑ when pipeline ÷ 4 > 1.25 × graduates/yr, ↓ when < 0.75 ×, → otherwise; "—" when either side is missing.
- **Ratio** and **verdict** per decision 3; **no verdict** below `JOBTHAI_MIN_POSTINGS_FOR_SIGNAL` (20) postings ("too few postings").
- **Occupations inside a row**: JobThai occupations whose eligible postings name a synonym, with counts, and the programmes linked to each via `program_jobthai_links` (v2 bridge).
- **Programmes inside a row**: the assigned programmes with graduates/yr, pipeline, latest health score, Deep-Dive link.
- **Scope narrowing**: faculty/department scope restricts supply to that unit's programmes and adds a "KKU total" column so a false white space cannot appear.
- **Faculty strip**: per faculty, count of fields by verdict (a field counts for a faculty when at least one of its programmes belongs to it).
- **Reconciliation line**: **demand** shares over canonical fields sum to 100 % of field-naming postings, with "any field" and "other" mention counts shown beside them. **Supply** shares may sum above 100 % because a programme assigned to two fields is counted in each field's numerator while the denominator counts every programme once; the line states the total and the number of multi-field programmes so the reader knows why.
- Output stamped `methodologyVersion: 'gap-map.v1'`, `computedAt`, taxonomy review counts; cached 5 min via `CacheService` keyed by scope + thresholds; invalidated on taxonomy approve.

## 5. The page `/gap-analysis`

One route; every control in the URL: `?scope&scopeId&verdict=all|white-space|under-served|served|over-served&faculty=<id>&under=0.5&over=2&field=<slug>` (the last opens a row).

Layout (wireframe approved): header with the JobThai mark and provenance/freshness; **Council brief** and **Thresholds** buttons; verdict chips with counts; faculty strip; the field table (Field TH · EN, Demand share, KKU share, Ratio, Grads/yr · pipeline arrow, Programmes, Signals, Verdict); one expandable row at a time showing three panels — occupations (with linked programmes and provinces), programmes (with Deep-Dive links), "what's coming" (global signal + trend signals); below the table the reconciliation line and the provenance drawer.

Council-readiness: `ProvenanceButton` + `FreshnessBadge` on the table and on each expanded panel; the drawer states what JobThai is and is not (national, 37 % Bangkok, 3.3 % Isan, no salary, no dates, postgraduate fields unscored), the taxonomy's review state, thresholds in force, the supply rule, the two-field programme rule, cache TTL. Evidence-page language: table quiet, verdicts loud, absent data grey.

Server-rendered from `computeGapMap` via `apiFetchEnvelope` (`GET /gap/map`); the only client leaves are the chips/strip/thresholds controls (router.replace), the row expander, and the brief panel. No `/api/v1` calls from the browser.

Navigation: nav entry unchanged. Redirects: `/gap-analysis/opportunities` → `/gap-analysis?verdict=white-space`; `/gap-analysis/risks` → `/risks`; `/gap-analysis/digital-competency` → `/education/digital-competency` (page moved intact, its lens computation untouched).

## 6. "What's coming" and the Council brief

- **Global signal** per field: field occupations → `job_thai_occupation_skills` above the 5 % posting-share floor, generic skills excluded (`jobThaiGenericSkills`) → intersect `kmitl_skill_growth` (THAILAND, GLOBAL fallback) → top three rising skills with growth %. Labelled "LinkedIn data via MHESI"; empty state stated, never hidden.
- **Trend signals** per field: signals whose `affectedPrograms` include an assigned programme, or whose `newInitiatives` name a role among the field's occupations (this is how a white space gets signals). Count in the column; titles, impact and links in the row.
- **Council brief**: `POST /gap/brief` with the current view (verdict, faculty, thresholds); prompt `gap-brief.v1`: ≤ 5 findings citing the rows' numbers (white spaces with the strongest demand and signals; under-served with a growing pipeline; over-served with a shrinking one) plus "what this data cannot tell"; response in a `RightPanel` with `ConfidenceBadge`, sources, reasoning, disagree (→ `Annotation`, kind `disagreement`, `sectionKey 'gap-brief'`); one `AiInference` per call (`@AiCall({ module: 'gap-analysis' })`); banned-tell lint + one retry kept; throttled on `ai_short` (note: that bucket is currently inert — open item; the `default` bucket still applies).

## 7. Retirement and migration of the old surfaces

Removed: `packages/db/src/gap-lenses.ts`; in `gap-analysis.ts` — `computeSkillGap`, `resolveDemandSource`, `computeSectorGap`, `computeOccupationGap`, `computeRegionalGap`, `computeOpportunities`, `computeRisks`, `computeForecastAccuracy`, `programIdsForScope` (replaced by a scope helper in `gap-map.ts`); endpoints `/gap/analysis`, `/gap/skills`, `/gap/occupations`, `/gap/sectors`, `/gap/regional/:province`, `/gap/program-demand-gaps`, `/gap/forecast-accuracy`, `/gap/opportunities`, `/gap/risks`, `/gap/insights/generate`; `gap-insights.service.ts` and prompt `gap-insights.v2`; the web pages `opportunities/`, `risks/` (redirects remain); the client tabs.

Kept and re-pointed: `computeDqSkillLens` stays in `packages/db`; the endpoint keeps its path `GET /gap/digital-competency` (internal, called server-side only) and the page moves to `/education/digital-competency`; the AI Analyst `query_gaps` tool → `computeGapMap` with `dimension` mapped to verdict filters; decision snapshots (`packages/db/src/decisions.ts`, `decision-review.service.ts`) → the map's verdict counts and top white spaces.

Tables `sectors`, `skill_sectors`, `occupation_demand`, `forecast_runs` stay in place, unread; a later cleanup migration may drop them (not this change, per the migration policy).

## 8. Methodology, docs, provenance

- `docs/methodologies/gap-map.md` v1: the share-ratio rule and why shares (the unit error and the Bangkok skew), thresholds and their tunability, supply rule and the two-field rule, minimum evidence, the taxonomy method (AI clustering + review, floor of 5 mentions), postgraduate gate, what changed from `gap-analysis.v1`/`gap-lenses.v1` and why.
- In-app methodology paper: new short section, revision bump; `docs/data-sources/jobthai.md`: the field-taxonomy step; `docs/evaluation-pipeline.md`: cross-module map updated; `/changelog` entry; `/admin/application-topology`: taxonomy script, two tables, review page, the map.
- `gap-map` added to the methodology manifest next to `jobthai-bridge` (the manifest that feeds `BUNDLE_CALENDAR_TAG`), so the bundle calendar records the map version alongside the health score's.

## 9. Testing

- Pure: share/ratio/verdict rule incl. boundaries and threshold parsing; pipeline arrow; reconciliation (shares sum to 100 %, "any field"/"other" reported); postgraduate gate; scope narrowing never yields a false white space; the taxonomy planner's idempotence given anchors.
- DB-backed (skip-guarded, rolled-back transactions where writing): `computeGapMap` at university scope reconciles; faculty strip sums equal verdict chip counts; the build step's second run proposes nothing new; `realDataWhere()` respected (an untagged row is invisible).
- API: scope clamping, threshold validation (`0 < under < over`), map cache key includes thresholds, brief input is the current view only.
- Web render: chips/strip counts, expanded-row panels, "too few postings", empty panels grey and stated, provenance on every card, redirects.
- Manual: authenticated dev render; the review page approve → map cache invalidated; the brief renders with confidence and sources.

## 10. Rollout

- Two additive migrations; the taxonomy script in esbuild TARGETS and verified in-image; no new env keys or buckets.
- Prod: after deploy, operator runs `jobthai-fields` dry-run, reviews, `--apply`; analyst reviews at `/admin/job-fields`; the map is useful immediately with PROPOSED rows marked unreviewed. The pending full AI-match re-run affects only the Deep-Dive links inside rows, not verdicts.
- Release notes must say the Gap Analyzer's numbers are new and not comparable to the old composite index.

## 11. Out of scope / follow-ups

Forecasting on JobThai batch history; a career→field mapping for LinkedIn; dropping the dead tables; the inert opt-in throttler buckets (separate open item); the CSP-blocked theme script (separate open item).
