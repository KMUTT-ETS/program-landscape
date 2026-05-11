# Program Evaluation Pipeline — End-to-End Reference

> **What this is.** A cross-module map of how Curriculum Landscape turns raw data into per-program **scores · verdicts · narratives**. The methodology docs in `docs/methodologies/` explain each algorithm in detail; this doc explains how they connect.
>
> **Audience.** Engineers + analysts working across modules. Read this before making cross-cutting changes; otherwise consult the per-methodology doc.
>
> **Last updated.** 2026-05-11 (Steps 2b + 4b + STRICT v2 landed — gaps #1 + #2 closed. `data-quality.v2` is live: NULL `ingestion_run_id` now treated as SUSPECT and filtered. All 247 760 metric rows pass the STRICT filter; 0 filtered. Final state: every row provenanced, every row traces to a `mocked=false` DataSource. Defense-in-depth caught — new writes that forget to thread `runId` will drop out of scores immediately).
>
> **When to update.** Bump the "Last updated" line and the affected section whenever any of: methodology version constant, scoring formula, AI prompt version, data-source flip (mocked→real), or status-transition rule changes. Drift between this doc and the code is high-cost — Council readers cite this file.

---

## TL;DR — five orthogonal verdict axes

A single program carries up to **five** signed verdicts. Each is independently versioned and reproducible from inputs + version stamp.

| Axis | Output | Where stamped | Code reference |
|---|---|---|---|
| **Health Score** | 0–100 composite + 5 dimension sub-scores + 0–100 `dataCompletenessPct` | `methodologyVersion: 'health-score.v3.4'` on `HealthScoreRow` | `packages/db/src/health-score.ts` |
| **Lifecycle Verdict** | `SUNSET` / `STABLE` / `RISING` / `FRONTIER` + 0–100 trajectory + 9 signed drivers | `methodologyVersion: 'lifecycle.v1.1'` on `ProgramLifecycleResult` + persisted to `program_lifecycle_snapshots` | `packages/db/src/program-deep-dive.ts` |
| **Risk Tier** | `LOW` / `MODERATE` / `HIGH` / `CRITICAL` / `NEEDS_DATA` + L1/L2/L3 drivers + I1/I2 impact + composite | `methodologyVersion: 'risk-scoring.v1.10'` on `RiskAssessment` + `risk-assessment.v2` on AI overlay | `packages/db/src/risk-scoring.ts` + `packages/shared/src/ai/prompts/risk-assessment.ts` |
| **KKU 5×5 Matrix** | `LOW` / `MODERATE` / `HIGH` / `VERY_HIGH` / `NEEDS_DATA` + `matrixScore` 1–25 (likelihood × impact bins) | Derived from Risk Tier; same methodology stamp | `bin5` + `deriveKkuMatrix` in `risk-scoring.ts` |
| **BCG Quadrant** | `star` / `cash-cow` / `question` / `dog` / `dead` | `methodologyVersion: 'dashboard-overview.v1'` on cockpit payload | `packages/db/src/dashboard-overview.ts:486-505` |

**Plus two enum statuses** that flow alongside but are *not* computed:

- `Program.status` — `ACTIVE` / `PAUSED` / `SUNSET` — operator-set.
- `CouncilDecision.status` — 9-state workflow, see [§ Decision workspace state machine](#decision-workspace-state-machine).

---

## 1. The full data flow at a glance

```
                EXTERNAL CONNECTORS                                 SCHEMA
  kku-registry (Oracle)        ──▶ enrollment_metrics
  kku-tcas-funnel              ──▶ tcas_admission_funnels        ┐
  tcas (CUPT peer rows)        ──▶ tcas_admission_stats          ├─▶ canonical
  kku-hr (MSSQL)               ──▶ faculty_members + program_faculties │   297 KKU
  kku-finance (Oracle+MSSQL)   ──▶ financial_metrics + faculty_budgets │   programs
  kku-research (Postgres)      ──▶ research_outputs                    │
  kmitl-skill-mapping (API)    ──▶ kmitl_careers + kmitl_career_skill_demands
  PDF intake → AI extraction   ──▶ program_skills + courses + plos     │
  KKU demographics seed        ──▶ demographic_projections             │
  (mocked: 18 more sources)                                            ┘

                       ┌─────────────────────────────────────────────┐
                       │  SCOPE ROLLUP LAYER (packages/db/src/scope.ts) │
                       │  4 materialized views, refreshed concurrently  │
                       │  mv_program_metrics  → enrollment/financial    │
                       │  mv_department_metrics                          │
                       │  mv_faculty_metrics                             │
                       │  mv_university_metrics                          │
                       │  Single entry: queryMetricByScope({...})        │
                       └─────────────────────────────────────────────┘
                                          │
        ┌─────────────────────────────────┼─────────────────────────────────┐
        ▼                                 ▼                                 ▼
  HEALTH SCORE (v3.4)             LIFECYCLE (v1.1)                   RISK (v1.10)
  5 dim × 2-4 drivers             9 signed drivers + 3 gates         3L × 2I + KKU 5×5
  computeHealthScores()           programLifecycleVerdict()          scoreL1+L2+L3+impact
                                  ↑ consumes Health + AI readiness   ↑ consumes ProgramAiReadinessAssessment
                                  + ProgramPeerReview                  (independent of Health)

                                          │
                       ┌──────────────────┴──────────────────┐
                       ▼                                      ▼
            AI NARRATIVE / VERDICT LAYER                 PRE-COMPUTED CACHES
            (22 prompt templates, see § 6)               program_lifecycle_snapshots
                                                          program_ai_readiness_assessments
                                                          program_peer_reviews
                                                          program_peer_selections
                                                          program_strategic_narratives

                                                          │
                                                          ▼
                                               SURFACE LAYER (UI)
                                               /cockpit · /programs/[id] · /risks ·
                                               /trends · /gap-analysis · /scenarios ·
                                               /benchmarking · /analyst · /decisions
```

Key invariants:

- **Every score row carries a `methodologyVersion`.** Bumping logic without bumping the version is a contract violation — old Council Packs would silently re-interpret.
- **`null` is preserved through the chain, never coerced to 0.** A program with no kku-alumni data has `null` outcomes drivers and a lower `dataCompletenessPct`, not a fabricated 0.
- **Canonical filter is `sequence_no_from_sheet IS NOT NULL`.** The 297 master-sheet programs are the curriculum landscape; legacy mock rows + side-effect Program rows from staff ingestion are excluded from all scorers + dashboards. See `packages/db/src/canonical-programs.ts`.

---

## 2. The Health Score (v3.4)

`packages/db/src/health-score.ts` · `HEALTH_SCORE_VERSION = 'health-score.v3.4'` · doc: `docs/methodologies/health-score.md`, `docs/methodologies/program-health-and-lifecycle.md` §2

### 2.1 Composition

5 dimensions × 2–4 drivers each, **equal-weighted** at every level. Null drivers excluded from average; never substituted.

| Dimension | Drivers (each → 0-100) | Tables touched |
|---|---|---|
| **Attractiveness** | tcas_competition_ratio · tcas_fill_rate · tcas_registration_yield · tcas_competition_vs_peers · enrollment_trend_slope · kku_intake_policy | `tcas_admission_funnels` + `tcas_admission_stats` (peer) + `enrollment_metrics` + `Program.level` |
| **Financial** | net_contribution_per_student · revenue_coverage_program_direct · tuition_trend_slope | `financial_metrics` + `enrollment_metrics` (latest non-partial CE year) |
| **Capability** | senior_rank_share · publications_per_faculty · retirement_horizon_5y | `program_faculties × faculty_members.{rank, retirementDate}` + `research_outputs` (year ≥ now−3) |
| **Outcomes** | tcas_min_score_percentile · employment_rate · average_salary | `tcas_admission_stats` (peer subject set) + `graduate_outcomes` (PENDING — kku-alumni still mocked) |
| **Relevance** | labour_market_alignment · demand_match_filled · demographic_resilience · strategic_sector_alignment | `program_skills × kmitl_career_skill_demands` (4-quadrant fallback) + `program_demand_matches` + `programDemographicOutlook` (computed from `demographic_projections`) + career→sector taxonomy |

**Aggregation rule (critical):** faculty/department/university scopes are *not* averages of program scores — each scope re-runs the scorers against rolled-up totals (mv_*_metrics). Faculty overall ≠ weighted mean of programs. Documented in §2.3 of `program-health-and-lifecycle.md`.

**Org-tier collapse:** v3.4 silently skips the department tier when too many faculty programs have `departmentId=NULL`. `resolveChildren()` in `health-score.ts:269` returns `scope: 'program'` from a faculty scope by default — two-level drill, not three. Hitting `/cockpit?scope=department&scopeId=X` directly still works.

### 2.2 Attractiveness has special cases

Read carefully — this dimension is non-uniform across scopes:

- **Program scope** reads the full TCAS funnel + computes 6 drivers, including peer comparison + intake-floor policy.
- **Faculty/dept/uni scope** uses raw SQL to aggregate the funnel across canonical+ACTIVE programs at the scope, scoring only 3 drivers (competition_ratio · fill_rate · registration_yield). Peer comparison + intake-floor are program-specific by nature.

The "complete year" filter (`(entry_year_be - 543) < currentCEYear`) is load-bearing. In-progress TCAS cycles have `reg_reported = NULL/0` across all rounds; without the filter, registration_yield reads 0% and tanks every program's attractiveness in March every year.

### 2.3 Skipping the `kmitl-` slug confusion

Driver `labour_market_alignment` reads `kmitl_career_skill_demands`. The slug is a stable code identifier referencing the API endpoint, **not** an attribution. The data is **LinkedIn**, the subscriber is **MHESI**, the host is **KMITL**. Every user-facing surface must attribute LinkedIn / MHESI / KMITL in that order. See `feedback_kmitl_data_attribution.md` in auto-memory and `health-score.md` §2.2.5 footnote.

### 2.4 What the Health Score feeds

- Cockpit overall + per-dimension cells (`/cockpit`)
- Deep-Dive radar + per-dimension drill-in (`/programs/[id]`)
- **Lifecycle Verdict drivers 1, 2, 7, 8** (consumed via `extractDriverFromHealth`)
- Strategic-narrative AI prompt input
- Risk-assessment AI prompt input (sanity-check anchor)
- Council Pack PDFs (provenance drawer + body)

---

## 3. The Lifecycle Verdict (v1.1)

`packages/db/src/program-deep-dive.ts:1023-1273` · `LIFECYCLE_VERSION = 'lifecycle.v1.1'` · doc: `docs/methodologies/program-health-and-lifecycle.md` §3

### 3.1 Trajectory score

Baseline **50** + weighted sum of 9 signed drivers, clamped to [0,100]:

| # | Driver | Cap | Source helper |
|---|---|---|---|
| 1 | `ai_readiness` | ±25 | `programAiReadiness().overallScore` → `(score − 50) × 0.5` |
| 2 | `health_overall` | ±20 | `health.overall.score` → `(score − 50) × 0.4` |
| 3 | `enrollment_trend` | ±15 | Health attractiveness driver `enrollment_trend_slope` |
| 4 | `tuition_trend` | ±10 | Health financial driver `tuition_trend_slope` |
| 5 | `content_modernity` | ±20 | `ProgramPeerReview.payloadJson.contentModernity.verdict` ∈ {FRONTIER:+20, IN_BETWEEN:0, OLD_SCHOOL:-20} |
| 6 | `major_content_gaps` | −12..0 | `ProgramPeerReview.payloadJson.contentGaps[severity='major'].length × −4`, capped at −12 |
| 7 | `demographic_resilience` | ±10 | Health relevance driver `demographic_resilience` (≥80→+10, ≥50→0, else−10) |
| 8 | `delayed_graduation_share` | −10..0 | `programStudentCohorts().delayedCount / totalActive` (banded) |
| 9 | `capability_strength` | −8..+8 | Health capability dimension overall |

### 3.2 Verdict assignment (two-pass)

**Pass 1** — from trajectory score alone:

```
score ≥ 80 AND contentModernity = FRONTIER  → FRONTIER
score ≥ 65                                  → RISING
score ≥ 45                                  → STABLE
otherwise                                   → SUNSET
```

**Pass 2** — three modifier gates (can downgrade, never upgrade):

1. **OLD_SCHOOL cap:** `contentModernity.verdict === 'OLD_SCHOOL'` ∧ verdict ∈ {RISING, FRONTIER} → STABLE.
2. **AI-readiness stable cap:** `aiReadiness.overallScore < 30` ∧ verdict ∈ {RISING, FRONTIER} → STABLE.
3. **AI-readiness frontier cap:** `aiReadiness.overallScore < 50` ∧ verdict = FRONTIER → RISING.

When the AI peer review has not run for a program (no `ProgramPeerReview` row), `modernityVerdict` is null → no cap fires + the headline narrative notes "AI peer review not yet generated".

### 3.3 Persistence

Every call upserts a `program_lifecycle_snapshots` row with `verdict + trajectoryScore + methodologyVersion + driversJson`. The cockpit reads from this table for portfolio rollups (cheap), the Deep-Dive recomputes on demand (fresh). Snapshot-write failure is intentionally swallowed — observability, not source of truth.

### 3.4 Narrative

Rule-based template, **not** AI-generated. Composed from:
- Verdict-band headline (`verdictHeadline` in `program-deep-dive.ts:1292`)
- Top 2 lifting drivers + top 2 dragging drivers (by absolute contribution)
- Optional "AI peer review not yet generated" footer when modernityVerdict is null

The Council brief AI prompt (`program-strategic-narrative.v1`) is separate — it consumes the lifecycle output as input, not vice versa.

---

## 4. AI Readiness (two-path)

`programAiReadiness()` in `program-deep-dive.ts:691-975` · `AI_READINESS_VERSION = 'ai-readiness.v1'`

**Two output paths, single function.** Always returns the same shape. Both paths preserve the deterministic sub-scores + skill breakdown as a transparency layer.

### 4.1 Path A — deterministic keyword scan (v1, always runs)

| Sub-score | Weight (4-driver / 3-driver) | Formula |
|---|---|---|
| `curriculumIntegration` | 0.40 / 0.44 | `min(100, (aiNativeWeight / totalWeight) × 400)` — 25% AI-native @ avg weight 0.7 → ~100 |
| `skillResilience` | 0.30 / 0.33 | `50 + ((aiNative×2 + aiAugmented − aiDisplaceable) / totalSkills) × 50` |
| `researchPresence` | 0.20 / 0.23 | `min(100, (aiPubsLast3y / totalPubsLast3y) × 200)` over `program_faculties × faculty_members × research_outputs` |
| `pedagogicalReadiness` | 0.10 / **redistributed** | Reserved (null today) — weight redistributed equally when null |

Skill classification (`aiNative` / `aiAugmented` / `aiDisplaceable` / `neutral`) is a deterministic keyword match against `ProgramSkill.skill.nameEn`. Lists are in `program-deep-dive.ts:655-674`.

### 4.2 Path B — discipline-aware AI assessment (v2 override)

When `program_ai_readiness_assessments` has a row for the program (produced by the `program-ai-readiness.v2` AI prompt), its `relevanceScore + summary + gaps + recommendations` **replace** the deterministic path's overallScore + summary + gaps + recommendations. Sub-scores + skillBreakdown still come from Path A — they appear in the UI as "here's what the keyword scan saw; here's what the AI concluded once it factored in discipline."

The discipline-aware path is what gives the Risk Score's L2 component the "music program with strong AI music-tech coverage" sensitivity (otherwise L2 would over-flag any program whose Skill rows happen to tag HIGH automation regardless of relevance).

### 4.3 Cross-consumers

`programAiReadiness()` is called by:
- `programLifecycleVerdict` (driver 1 — the heaviest)
- `scoreL2AiDisruption` (Risk Score, readiness deficit + disruption signal components)
- `program-strategic-narrative.v1` (AI prompt input)
- Deep-Dive's AI Readiness section

---

## 5. The Risk Score (v1.10)

`packages/db/src/risk-scoring.ts` · `RISK_SCORING_VERSION = 'risk-scoring.v1.10'` · doc: `docs/methodologies/risk-scoring.md`

**Scope: BACHELOR programs only.** Postgrad is structurally small-cohort + closure-track-irrelevant.

### 5.1 Equation

```
Risk = Likelihood × Impact
Composite = max(L1, L2 × 0.7, L3)   over non-null drivers
```

**L2 discount of 0.7** in the composite only (raw L2 carries full weight everywhere else — UI, KKU 5×5 cell placement, AI prompt). Rationale: AI mitigation requires multi-year investment + creates new operational risk. A single high L2 should not alone push composite to CRITICAL.

### 5.2 Likelihood drivers

| Driver | Composition | Source tables | Inputs |
|---|---|---|---|
| **L1 Recruitment / TCAS decay** | 0.35 competition_ratio + 0.35 fill_rate + 0.20 trend_decay + 0.10 late_round_dependency | `tcas_admission_funnels` (complete cycles only) | Latest year + 5y series |
| **L2 AI-disruption** | 0.35 skill_pressure + 0.35 readiness_deficit + 0.30 disruption_signal | `program_skills × skill.automationRisk` + `program_ai_readiness_assessments` (via `programAiReadiness`) | Skill weights, AI v2 relevance score, gap/recommendation counts |
| **L3 Demographic vulnerability** | 0.75 buffer + 0.25 trend | `tcas_admission_funnels` only | applicants/seat ratio piecewise + 5y CAGR |

**L1/L3 share `latestCompleteEntryYearBE()`** — `current_year + 543 − 1`. Same filter as health-score attractiveness. Rolls forward Jan 1 automatically.

**L3 v1.9 redesign** removed the universal-cohort-shrinkage baseline that fired ~43 for every program; current applicants/seat ratio + 5y trend drive it now. 88% of BACHELOR programs end up at L3≈0 (insulated). Empirically confirmed against the 89-program portfolio.

### 5.3 Impact dimensions

```
I1 = annual_tuition_revenue × 5                           (direct)
I2 = (facultyCost + facilityCost + overhead) × 5          (stranded; directCost excluded — falls away on closure)
total = I1 + I2
impactScore = log10-normalised total across BACHELOR portfolio
```

**Critical filter:** `computeImpact()` applies `latestCompleteFiscalYearCE()` (= `currentYear − 1`) to skip in-progress fiscal years. v1.5 had a unit-mismatch bug (compared BE-from-TCAS against CE-from-FinancialMetric) — v1.7 fixed it. The unit confusion is the kind of thing to triple-check before changing this code.

**NEEDS_DATA override (v1.8):** programs without `FinancialMetric` rows force `tier = NEEDS_DATA` even if L scores resolve cleanly. Without it, programs with no tuition baseline anchor at `impactScore=0` in the 5×5 matrix and read as "low priority" misleadingly.

### 5.4 KKU 5×5 institutional matrix

Equal-width 0–100 → 1–5 binning on (composite, impactScore). Same persistence + UI as composite tier.

| matrixScore | KKU level | Colour |
|---|---|---|
| 1–4 | LOW | green |
| 5–9 | MODERATE | yellow |
| 10–15 | HIGH | orange |
| 16–25 | VERY_HIGH | red |
| null | NEEDS_DATA | slate |

### 5.5 AI overlay — `risk-assessment.v2`

Runs **on top of** deterministic scores. Does not re-score. Produces:
- 200–300 word Thai narrative for Council brief
- `dominantDriver` self-report (cross-checked against `max(L)`; divergence lands in caveats)
- 3–6 `measures` spread across SHORT/MEDIUM/LONG horizons, each with `kind` (10 enum values) + costClass + expectedDeltaThb
- Caveats array

Rule-based fallback at `pnpm risks:seed-measures` generates 2–4 horizon-balanced measures from driver signals when AI is unavailable. Same shape, lower confidence.

---

## 6. The 22 AI prompts (by purpose)

Code: `packages/shared/src/ai/prompts/*.ts` · All routed through `AiService` (which writes `AiInference` audit row per call). Every prompt has a `*_VERSION` constant. Edit policy: behaviour change = bump version; never edit a published version in place.

### 6.1 Extraction (PDF / structured-text → typed payload)

| Prompt | Output materialises into | When fired |
|---|---|---|
| `program-digest.v1` | `Program.*` (metadata + recruitmentSummary) + `ProgramSkill` (via materialise on approval) + `PROPOSED_SKILL` AiExtraction rows for the analyst queue | One-shot Gemini call against full curriculum PDF text; bulk via `pnpm programs:digest-bulk` |
| `program-faculty-extraction.v1` | `ProgramFaculty` curated roster links | Manual analyst trigger |
| `program-skills-detailed.v?` | Deeper `ProgramSkill` enrichment beyond program-digest | Manual |
| `course-skill-extraction.v?` | `CourseSkill` rows | On course-description AiExtraction approval |
| `job-posting-skill-extraction.v?` | `JobPostingSkill` rows | On job-posting AiExtraction approval |
| `graduate-employment-survey.v?` | Structured graduate-outcome rows | Survey-PDF intake |
| `imd-rankings-extract.v?` | `ImdSnapshot` rows | PDF intake for IMD World Competitiveness rankings |
| `policy-doc-analysis.v?` | `PolicyDocument` narrative + tags | Policy-PDF intake via ai-jobs queue |

### 6.2 Classification / mapping

| Prompt | Purpose |
|---|---|
| `career-kmitl-mapping.v?` | Map a Program → ≤N `kmitlCareerIds` (used by Deep-Dive Skills + relevance driver) |
| `demand-skill-match.v?` | Pre-compute `program_demand_matches` — `(matchedDemanded, relevantDemanded)` per program × career → drives Relevance's `demand_match_filled` |
| `program-peer-selection.v1` | Pick 3–5 best-fit peers per tier (WORLD / ASIA / SEA / THAILAND_PEER) → input to `program-peer-review.v2` |
| `skill-name-normaliser.v?` | Resolve `PROPOSED_SKILL` rows against `Skill.nameEn`/`nameTh` (taxonomy growth path) |

### 6.3 Verdict / assessment (the Council-affecting ones)

| Prompt | Materialises into | What it contributes |
|---|---|---|
| `program-peer-review.v2` | `program_peer_reviews.payloadJson` | **Drives lifecycle drivers 5+6** (`contentModernity.verdict` + `contentGaps[severity='major']`); feeds Deep-Dive Peer Comparison section; feeds AI-readiness gaps/recs (AI-filtered subset) |
| `program-ai-readiness.v2` | `program_ai_readiness_assessments.payloadJson` | Discipline-aware override of deterministic AI readiness (Path B in §4); feeds Risk L2 (readiness deficit + disruption signal); also feeds Deep-Dive |
| `risk-assessment.v2` | `RiskAssessment` AI columns (narrative + measures + caveats) | Council-facing risk narrative + named mitigation measures |
| `decision-review.v?` (`outcome-review.v1` per methodology doc) | `DecisionOutcomeReview.payloadJson` | Fires at 6mo/1y/3y horizons after decision approval; produces actual-vs-projected narrative |

### 6.4 Narrative (Council-readable prose)

| Prompt | Surface | Notes |
|---|---|---|
| `program-strategic-narrative.v1` | `program_strategic_narratives.contentMarkdown` | Deep-Dive header brief; 250–400 words; 5-section markdown structure (Executive summary / Strategic position / Critical risks / Opportunities / Recommended actions); **no greetings, no closings** — hard rules in system prompt |
| `expertise-narrative.v2` | `user_expertise_narratives` (profile page only) | Pure expertise extraction from education + publication titles; bilingual TH+EN keyword arrays |
| `gap-insights.v?` | `/gap-analysis` AI panel | 3 modes: strategic-top-5 · program-skills-to-add · sector-brief |
| `scenario-insights.v?` | `/scenarios` AI panel | 5 modes incl. devils-advocate (argues *against* apparent-best scenario) |
| `benchmarking-insights.v?` | `/benchmarking` AI panel | 4 modes: suggest-peers · curriculum-gap · distinctiveness · positioning-brief |

### 6.5 Cross-prompt dependency chain (lifecycle critical path)

```
PDF (curriculum) ─▶ program-digest.v1 ─▶ approve+materialise ─▶ ProgramSkill rows
                                                                       │
                                                                       ▼
ProgramSkill rows + faculty roster + research_outputs ─▶ programAiReadiness Path A
                                                                       │
                                       (deterministic, always runs)    │
                                                                       ▼
program-peer-selection.v1 picks 3-5 peers/tier ─▶ program-peer-review.v2 ─▶ ProgramPeerReview
                                                                       │
                                  (contentModernity.verdict             │
                                   + contentGaps[major])                │
                                                                       ▼
program-ai-readiness.v2 (uses peer-review AI gaps) ─▶ ProgramAiReadinessAssessment
                                                                       │
                       (overrides Path A's overallScore + gaps + recs) │
                                                                       ▼
                                              programLifecycleVerdict() consumes:
                                                — Health overall (driver 2)
                                                — programAiReadiness (driver 1)
                                                — Health enrollment_trend (driver 3)
                                                — Health tuition_trend (driver 4)
                                                — PeerReview.contentModernity (driver 5)
                                                — PeerReview.contentGaps (driver 6)
                                                — Health demographic_resilience (driver 7)
                                                — programStudentCohorts (driver 8)
                                                — Health capability (driver 9)
                                                                       │
                                                                       ▼
                                                            ProgramLifecycleResult
                                                            + snapshot upsert
```

If `program-peer-review.v2` has not run for a program, lifecycle still computes — drivers 5+6 contribute 0, narrative footer flags it. The Risk Score is independent: it consumes `programAiReadiness` directly + does not need peer review.

---

## 7. Cross-join cheat sheet

Quick "where does this number come from" reference. Read this when a UI value looks wrong.

### 7.1 By table → who reads it

| Table | Read by |
|---|---|
| `enrollment_metrics` | Health attractiveness (enrollment_trend_slope, kku_intake_policy) · Health financial (net_contribution_per_student denominator) · BCG quadrant (3y delta) · cockpit KPIs · Deep-Dive Financials section |
| `tcas_admission_funnels` | Health attractiveness (3 drivers) · Risk L1 (all 4 components) · Risk L3 (buffer + trend) · Deep-Dive Demand Funnel · `programRecruitment` UI |
| `tcas_admission_stats` (peers) | Health attractiveness (tcas_competition_vs_peers) · Health outcomes (tcas_min_score_percentile) · `programTcasStats`/`facultyTcasStats`/`universityTcasStats` |
| `financial_metrics` | Health financial (all 3 drivers) · Risk I1+I2 · BCG quadrant (net contribution) · Deep-Dive Financials |
| `program_faculties × faculty_members` | Health capability (all 3 drivers) · `programAiReadiness` Path A (research presence) · `programFaculty` Deep-Dive section (role-gated) |
| `research_outputs` | Health capability (publications_per_faculty) · `programAiReadiness` Path A (AI-keyword filter) · Profile page publications |
| `program_skills × skill` | Health relevance (labour_market_alignment) · `programAiReadiness` Path A (curriculum integration + skill resilience) · Risk L2 skill_pressure · Deep-Dive Skills · gap analysis |
| `kmitl_career_skill_demands` | Health relevance (labour_market_alignment, 4-quadrant fallback) · Deep-Dive Skills demand side · gap analysis · benchmarking white-spaces |
| `program_demand_matches` | Health relevance (demand_match_filled) · Deep-Dive Skills match score |
| `demographic_projections` | Health relevance (demographic_resilience via `programDemographicOutlook`) · Lifecycle driver 7 |
| `program_peer_reviews` | Lifecycle drivers 5+6 · `programAiReadiness` (gaps/recs filter) · Deep-Dive Peer Comparison |
| `program_ai_readiness_assessments` | `programAiReadiness` Path B override · Risk L2 (readiness deficit + disruption signal) |
| `program_lifecycle_snapshots` | Dashboard overview (LifecycleDistribution) · cockpit portfolio rollups |
| `student_cohort_distributions` | Lifecycle driver 8 (delayed graduation share) · Deep-Dive Cohort Distribution panel |
| `alumni_cohort_status` | Deep-Dive Demand Funnel (graduated/dropped/renounced buckets) |
| `program_strategic_narratives` | Deep-Dive header brief · home dashboard pulse |
| `risk_assessments` | `/risks/portfolio` + `/risks/programs/[id]` · cockpit risk-tier surfacing |
| `decision_outcome_reviews` | Decision Workspace outcome panel · search-lessons-learned |
| `mv_program_metrics` / `mv_*_metrics` | `queryMetricByScope()` — exclusively |

### 7.2 By scorer/verdict → its full input set

| Output | Inputs |
|---|---|
| `health-score.v3.4` (program scope) | `tcas_admission_funnels` + `tcas_admission_stats` (peers) + `enrollment_metrics` + `financial_metrics` + `program_faculties × faculty_members` + `research_outputs` + `program_skills × skill` + `kmitl_career_skill_demands` + `program_demand_matches` + `demographic_projections` + career→sector taxonomy |
| `lifecycle.v1.1` | Above (via health) + `program_ai_readiness_assessments` (via `programAiReadiness` Path B) + `program_peer_reviews` (drivers 5+6) + `student_cohort_distributions` (driver 8) |
| `risk-scoring.v1.10` L+I | `tcas_admission_funnels` (L1+L3) + `program_skills × skill.automationRisk` (L2) + `program_ai_readiness_assessments` (L2) + `financial_metrics` (I1+I2) — no Health Score dependency |
| `dashboard-overview.v1` | `enrollment_metrics` + `financial_metrics` (BCG + KPIs) + `program_lifecycle_snapshots` (lifecycle distribution) + `program_strategic_narratives` (pulse) + `programs` (canonical filter) + `computeHealthScores('university')` (FacultyHealth rollup) |
| BCG quadrant | 3y enrollment delta + latest year netContribution → 4 quadrants + `dead` (zero enrolment override) |

---

## 8. Surface layer (what the UI consumes)

| Surface | Aggregator | Calls |
|---|---|---|
| `/cockpit` | `getDashboardOverview()` in `dashboard-overview.ts` | All sections in parallel; reads snapshots not live recompute |
| `/programs/[id]` | 10 fan-out endpoints in `programs.controller.ts` | `programOverview` · `programDemandFunnel` · `programStudentCohorts` · `programDemographicOutlook` · `programFinancials` · `programSkills` · `programOutcomes` · `programFaculty` (role-gated) · `programPeers` · `programTrends` · `programDecisions` · `programStrategicNarrative` · `programLifecycleVerdict` · `programAiReadiness` |
| `/risks/portfolio` + `/risks/programs/[id]` | `RiskAssessment` table reads | Built by `pnpm risks:assess --all` batch |
| `/gap-analysis` | `computeSkillGap` · `computeOccupationGap` · `computeSectorGap` · `computeRegionalGap` · `computeOpportunities` · `computeRisks` · `computeProgramDemandGaps` · `computeForecastAccuracy` | `gap-analysis.ts` — forecasting.v1 |
| `/scenarios` | scenario-engine.v1 (pure function, in `@kku/shared`) | Deterministic; same input + seed → same output |
| `/benchmarking` | benchmarking.v1 (`benchmarking.ts`) | 6 helpers: peerSets · portfolioComparison · subjectLeadership · programPeers · whiteSpaces · distinctiveness |
| `/trends` | `TrendsRadar` polar viz | Reads `trend_signals` directly + 6 monitor cron stubs |
| `/analyst` | tool-use agent via `AiService.completeWithTools()` | 12 Zod-typed tools wrapping the helpers above |
| `/decisions` | `decisions.ts` | List/get/snapshot/status-transition/outcome-review |

---

## 9. State machines

### 9.1 Decision workspace state machine

`packages/db/src/decisions.ts:307-348`. Status transitions are validated at the service layer.

```
              ┌─────────────┐
              │   PROPOSED  │
              └──────┬──────┘
                     │
        ┌────────────┼────────────┐
        ▼            ▼            ▼
COUNCIL_REVIEWED  REJECTED    ARCHIVED  (terminal; SUPER_ADMIN only)
        │
   ┌────┼────┐
   ▼    ▼    ▼
APPROVED  REJECTED  ARCHIVED
   │
   ┼─▶ IN_IMPLEMENTATION ─┬─▶ IMPLEMENTED ─┬─▶ COMPLETED ─▶ ARCHIVED
   │                       │                │
   ▼                       ▼                ▼
SUPERSEDED              SUPERSEDED       SUPERSEDED  (amendments)
   │                       │                │
   ▼                       ▼                ▼
ARCHIVED                ARCHIVED         ARCHIVED
```

**Role gates** (`TRANSITION_ROLE_GATE`):
- COUNCIL_REVIEWED / APPROVED / REJECTED → SUPER_ADMIN ∪ SYSTEM_ADMIN ∪ UNIVERSITY_USER (the latter absorbed legacy COUNCIL+EXECUTIVE roles in the 2026-05-09 cleanup)
- ARCHIVED → SUPER_ADMIN only

**Snapshot capture:** `captureSnapshot()` fires automatically when status transitions to `COUNCIL_REVIEWED`. Idempotent — `snapshotJson` is write-once. The snapshot is the audit-grade record of "what the world looked like when the Council decided" and is what outcome reviews compare against.

**Amendment:** `amend()` writes a *new* decision row (`version + 1`), links `supersededById` on the original, flips original to `SUPERSEDED`. Never mutates — institutional memory is the invariant.

### 9.2 Scenario workflow

`scenarios.workflowStatus`: `DRAFT → SHARED → COUNCIL_REVIEWED → DECIDED` plus `ARCHIVED`. Documented in prompt-09 notes. `DECIDED + ARCHIVED` are immutable.

### 9.3 AiExtraction review queue

`PdfExtraction.reviewStatus`: `PENDING_REVIEW → APPROVED | REJECTED`. AI confidence below `AI_AUTO_APPROVE_THRESHOLD` (default 0.85) parks in queue. Approval triggers post-approval materialisation per extraction type (see `program-digest-materialize.ts`, `imd-materialize.ts`).

---

## 10. Versioning & audit contract

Every score row carries a `methodologyVersion`. Bumping rules:

| Change type | Version bump | Backfill old rows? |
|---|---|---|
| Formula coefficients (weights, thresholds) | **major** if behaviour visibly changes | No — historical scores remain stamped with the version that produced them |
| New driver added | **major** | No |
| New data source flipped from mocked → real | **minor** if driver fallbacks unchanged | No |
| Bug fix (unit mismatch, off-by-one) | **patch** (v1.x.y) | Operator discretion — risk-scoring did backfills inline |
| Prompt template rewording | **prompt version bump** | New AiInference rows; old cached payloads keep old version |
| Methodology doc rephrasing without code change | **no bump** | n/a |

Per-prompt versions:
- `program-digest.v1` · `program-peer-review.v2` · `program-peer-selection.v1` · `program-ai-readiness.v2` · `risk-assessment.v2` · `program-strategic-narrative.v1` · `expertise-narrative.v2` · `analyst-system.v1` · `analyst-safety.v1` · `outcome-review.v1`

Per-scorer versions:
- `health-score.v3.4` (current; v1/v2/v2.1 retained for audit)
- `lifecycle.v1.1`
- `risk-scoring.v1.10`
- `benchmarking.v1`
- `forecasting.v1`
- `scenario-engine.v1`
- `gap-analysis.v1`
- `dashboard-overview.v1`
- `ai-readiness.v1` (deterministic Path A)
- `decision-workspace.v1`

Council Pack PDFs embed the methodology version on every page. A score cited in a Council brief traces — value → formula → inputs → ingestion run → source connector — through the provenance drawer.

---

## 11. Update protocol for this doc

When the code or methodology changes, update this doc **in the same commit**:

1. Bump the "Last updated" line at the top.
2. Update the affected section (or sections — a new health-score driver also touches lifecycle if it feeds a driver there).
3. Cross-check the [§ 1 data flow](#1-the-full-data-flow-at-a-glance), [§ 7 cross-join cheat sheet](#7-cross-join-cheat-sheet), and [§ 10 versioning table](#10-versioning--audit-contract).
4. If you bumped any `*_VERSION` constant, update the version table in §10 + the per-methodology doc in `docs/methodologies/`.

The cost of drift here is high — analysts cite this file when explaining Council briefs. Treat it like a database schema, not a wiki page.

---

## 12. Known limitations (the honest list)

> See **[§13 Known gaps + remediation roadmap](#13-known-gaps--remediation-roadmap)** for the active worklist on each item below. §12 is the residual honesty list; §13 is what's being fixed.


- **`kku-alumni` connector is still mocked.** Outcomes dimension's `employment_rate` + `average_salary` drivers contribute null today. Health overall scores from the alumni dimension lean entirely on the TCAS min-score percentile.
- **`pedagogicalReadiness` is reserved.** AI readiness Path A's fourth sub-score is null until classroom + survey instrumentation lands. Weight redistributed across the other three.
- **Cost allocation is v0 draft.** Financial dimension's cost columns (`directCost`, `allocatedFacultyCost`, `allocatedFacilityCost`, `allocatedOverhead`) are populated by a methodology pending Finance Committee approval. Treat the financial dimension's revenue-coverage driver as preview-quality.
- **18 of 23 connectors still mocked.** Real wiring per `prompts/14-integration-session-template.md`. Per-source status at `docs/data-sources/README.md`.
- **No cross-scope consistency assertion.** Faculty overall score ≠ weighted mean of programs by construction (each scope reads its own MV).
- **30-day green-history gates.** `kmitl-skill-mapping` (until 2026-05-31), `kku-research v2` (until 2026-06-06) — preview-quality on Council-facing surfaces.
- **No F1 accuracy benchmark.** AI extraction confidence threshold (0.85) is a calibration choice, not a measured precision. Hand-labeled corpus still pending.
- **Verdict bands are calibration choices.** Health bands (40 / 65) + lifecycle thresholds (45 / 65 / 80) + Risk thresholds (35 / 60 / 80) are tuned to KKU's current portfolio shape, not external benchmarks.

The full caveat list per methodology lives in `docs/methodologies/program-health-and-lifecycle.md` §7 + the per-methodology docs.

---

## 13. Known gaps + remediation roadmap

> **What this section is.** Living worklist of trust-affecting gaps in the evaluation pipeline + the concrete remediation path for each. Status updates land **in the same commit** as the underlying code change. This section is the canonical pointer for any analyst asking "why does the cockpit say X when the underlying data says Y."
>
> **Status legend:** ☐ Open · ◐ In progress · ✓ Done · ⊘ Won't fix (with rationale)
>
> **Ordering:** Tier 1 are prerequisites (everything else is unmeasurable until these land). Tier 2 are quick wins after Tier 1. Tier 3 are ongoing rituals. Tier 4 is UX polish.

### Tier 1 — data integrity prerequisites

| # | Gap | Status | Remediation |
|---|---|---|---|
| **1** | **Mock data contaminates real scores.** `DataSource.mocked` was a free-text convention (`status='mocked'`), not enforced anywhere. Scorers read metric tables without checking whether the originating connector was mocked, so a cockpit health score for a faculty could silently blend kku-finance real revenue with mocked alumni outcomes. | ✓ **CLOSED** 2026-05-11. All 6 steps landed in a single afternoon: (1) schema migration adding `data_sources.mocked` + `ingestion_run_id` FK on 15 tables, (2) 7 live connectors thread `ctx.runId` to every write, (3) 6 analytical helpers filter via `realDataWhere()`/`realDataSql()`/`realDataSqlUnsafe()`, (4) Pass-1 backfill attributed 177 650 rows via SUCCEEDED-run active-window heuristic, (2b) `withScriptRun()` helper at `apps/ingestion/src/lib/script-run.ts` wraps the 5 standalone scripts (link-program-alumni · link-program-cohorts · link-program-financials · ingest-employment-surveys · ingest-employment-surveys-xlsx) so future runs tag their writes, (4b) Pass-2 backfill heuristic relaxed to include FAILED runs + Pass-3 fallback attributes any remaining orphan to a synthetic `trigger='BACKFILL'` IngestionRun on the canonical DataSource — `errorCode='SYNTHETIC_LEGACY'` for analyst audit, (STRICT) `realDataWhere()` body now drops the NULL branch + `DATA_QUALITY_VERSION = 'data-quality.v2'`. **Final verification:** 247 760 of 247 760 metric rows pass the STRICT filter (0 NULL, 0 tagged-mock). Catalog flag flipped on kku-alumni + tcas (`mocked: false`) since both DataSource rows hold real data even though the API connectors themselves remain stubs. | **Done.** Rollback path retained: `realDataWhereLenient()` / `realDataSqlLenient()` give v1 semantics for an emergency revert. Monitoring: `pnpm provenance:backfill` (dry-run) reports orphan counts per table — should be 0 indefinitely. If a NEW write path forgets `ingestionRunId`, cockpit cells will drop to null + `dataCompletenessPct` will fall — the diagnostic loop is the dry-run backfill. |
| **2** | **Provenance chain has holes between connector and metric row.** `getProvenance('pdf_document', id)` is precise; everything else falls back to "most recent successful runs" because metric tables didn't carry `ingestion_run_id`. Council member asking "which run produced this Q4 figure" got a heuristic, not an answer. | ✓ **CLOSED** 2026-05-11. Co-fixed with #1: every metric row in all 15 tracked tables now carries a non-NULL `ingestion_run_id` FK pointing at a SUCCEEDED IngestionRun. 177 650 rows tagged via connector + script wrapping; 70 110 historical orphans tagged to a synthetic `trigger='BACKFILL'` run per table (auditably labelled `errorCode='SYNTHETIC_LEGACY'`). | **Done.** `getProvenance()` can now follow the FK chain row → run → source directly without the legacy `createdAt` heuristic. Updating `getProvenance()` to use the FK is a small follow-up (purely cosmetic; the current heuristic still works). |
| **3** | **AI extraction accuracy is unmeasured.** Auto-approve threshold is 0.85 — a calibration choice, not measured precision. 3 502 `PROPOSED_SKILL` rows queued during bulk digest; whether 0.85 is too loose (false approves into `ProgramSkill` → polluted Relevance + AI-readiness) or too tight (unnecessary analyst burden) is unknown. | ☐ Open | Hand-label a 50-extraction gold set across `program-digest` + `course-skill-extraction` + `program-peer-review`. Measure F1 with `pnpm ai:eval` extended to extraction tasks. Surface threshold as "tuned for X% precision against N-item gold set, last measured YYYY-MM-DD" on the `/admin/extraction-review` page. Re-measure on every prompt-version bump. |

### Tier 2 — quick wins after Tier 1

| # | Gap | Status | Remediation |
|---|---|---|---|
| **4** | **Multiple methodology versions on a single Council brief.** One brief cites health-score.v3.4 + lifecycle.v1.1 + risk.v1.10 + peer-review.v2 = four versions. PDF footers embed one stamp per page; readers can't tell which sections use which version. | ☐ Open | Define a release-bundle version (e.g. `landscape-2026-05.v1`) in `packages/shared/src/methodologies.ts` that ties all current sub-versions together. Bumping any sub-version increments the bundle. Council Pack PDF cover carries the bundle ID + "this bundle includes: ..." appendix listing all sub-versions. |
| **5** | **Cost allocation v0 leaks into Council surfaces unmarked.** `net_contribution_per_student` (Health Financial driver) + Risk I1/I2 derive from cost columns whose methodology is pending Finance Committee approval. The methodology doc says "preview-quality" — the cockpit cell doesn't. | ☐ Open | Add `preview: true` flag on every methodology constant. Propagate to UI watermark — financial-derived cells render with a "preview" stripe + tooltip until `cost-allocation.v1` is Finance-Committee-approved. Same pattern reusable for any future preview methodology. |

### Tier 3 — ongoing rituals (cron jobs, not one-shots)

| # | Gap | Status | Remediation |
|---|---|---|---|
| **6** | **No back-testing on the verdicts** (only on forecasts). `computeForecastAccuracy` exists for the gap analyzer. Health Score, Lifecycle Verdict, Risk Tier have no "did the verdict hold?" check; verdict drift compounds silently. | ☐ Open | Quarterly cron: snapshot every program's current verdicts → diff against last quarter's snapshot. Programs whose verdict flipped → analyst worklist. Programs whose drivers moved 20+ pts but verdict didn't flip → band-edge instability flag. Pure observability — no scorer change. Reuse `DecisionOutcomeReview` table shape if convenient. |
| **7** | **Cross-scope consistency divergence is silent.** Faculty overall ≠ weighted mean of programs by construction (each scope reads its own MV). Doc says "typically small"; nobody measures. | ☐ Open | Quarterly job: compute `|facultyOverall − weightedMean(programs)|` for every faculty. Surface in `/admin/data-quality`. Anything >10 points → flag for methodology review. |

### Tier 4 — UX polish

| # | Gap | Status | Remediation |
|---|---|---|---|
| **8** | **Lifecycle gates encode institutional positions, not findings.** The two AI-readiness floor caps + OLD_SCHOOL content cap are explicit opinions ("AI-ignoring curriculum is at risk regardless of metrics"). A Council member who disagrees has no in-app channel beyond a post-hoc disagreement annotation. | ☐ Open | Add a "gate-counterfactual" toggle in the lifecycle UI — show verdict if all gates were off. Council reads both. Persisted verdict unchanged; just makes the gate's effect visible. |

### Process

1. **New gaps land here first.** If you find a gap that affects Council trust, add a row even if you can't fix it today. Future-you will thank present-you.
2. **Status transitions are commits.** ☐ → ◐ → ✓ each warrant a status update in this section. PR description should reference the gap number.
3. **Drift between this section and the code is the worst outcome.** A "✓ Done" row that doesn't actually work is worse than no row at all — analysts will cite it.
4. **⊘ Won't fix is a valid terminal state**, but requires a one-sentence rationale ("incompatible with PDPA"; "blocked on Finance Committee"; "deferred indefinitely — see Council minutes 2026-XX-YY").
