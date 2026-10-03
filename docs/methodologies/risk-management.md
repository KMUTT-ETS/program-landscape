# Risk Management Methodology — `risk-management.v2`

> Current version: `risk-management.v2` · First shipped: 2026-05-19
> (v2 same-day patch — adds the rule engine that closes v1's biggest gap).
> Maintainer: VP Education + Digital
> Companion doc: [risk-scoring.md](./risk-scoring.md) (the *formula*; this
> doc is the *workflow* that consumes it).
> Locked references:
> - `packages/db/src/risk-scoring.ts` — `RISK_INDICATOR_CATALOG`, scoring helpers
> - `packages/db/src/risk-measure-rules.ts` — **NEW in v2** — rule engine catalog + `deriveRuleMeasures()`
> - `apps/ingestion/src/scripts/risks-assess.ts` — assessment pipeline (Phase 8 of programs-pipeline)
> - `apps/api/src/risks/risks.service.ts` — read + measure-status transitions
> - `apps/web/app/risks/` — operator-facing UI

## Purpose

Risk Scoring (`risk-scoring.v1.9` and forward) turns program data into a
**number** (composite 0–100) and a **tier** (LOW / MODERATE / HIGH /
CRITICAL / NEEDS_DATA). Risk *Management* is the operational layer that
**turns those numbers into action**. It covers:

1. **KRI alarms** — pre-defined, deterministic indicator breaches that
   fire continuously, ahead of any AI run. The KRI catalog is the
   ground-truth signal feed.
2. **Periodic AI risk assessment** — analyst-triggered Gemini call that
   produces a full RiskAssessment row + 2–4 concrete RiskMeasure
   proposals per program.
3. **Measure lifecycle** — proposed mitigations move through
   PROPOSED → ACCEPTED / REJECTED → IN_PROGRESS → COMPLETED, with the
   option of binding a measure to a Decision Workspace decision.
4. **Council 5×5 matrix integration** — composite + impact map onto the
   KKU institutional ERM 5×5 grid so the same program appears in both
   the analytics view and the legal/audit ERM register.

Audience: Risk Office, Department Heads, Deans, Council members,
program owners. **Scope: undergraduate (BACHELOR) programs only** —
mirrors the scoring methodology's deliberate scope. Postgraduate and
higher-grad-diploma risk is not part of v1.

## The four layers

### Layer 1 — Risk Indicators (KRIs)

`RiskIndicator` rows (7 in the catalog since `risk-scoring.v1.14`, seeded from
`RISK_INDICATOR_CATALOG`) are the always-on alarm system. Each
indicator has:

- A **slug** (stable identifier — used by the breach upsert key)
- A **formula** description (Thai + English) — what the value means
- A **value** computed nightly per program from the same data the
  scoring formula reads (recruitment funnel, intake floor, skill
  automation tags)
- A **threshold pair** — `warn` and `critical`, with an `alarm_direction`
  (`low` = alarm when value ≤ threshold; `high` = alarm when value ≥
  threshold)

When a value crosses a threshold, a `RiskIndicatorBreach` row is
written carrying:
- `value` (the actual number, nullable for data gaps)
- `severity` (`OK` / `WARN` / `CRITICAL`)
- `observed_at` (when the pipeline ran)
- `freshness_date` (which fiscal/cohort year was being evaluated —
  may lag `observed_at` by a year or two)
- `methodology_version` (locks the breach to a specific threshold set)

Breach history is the time-series that drives the KRI dashboards in
`/risks/indicators/` and the per-program risk pane in `/programs/[id]`.

**v1 indicator catalog** (full definitions in `RISK_INDICATOR_CATALOG`):

| Slug | Formula | Warn | Critical | Direction |
|---|---|---|---|---|
| `application_seat_ratio` | `Σ applicants / max(plan_per_year)` (latest year) | ≤ 1.5 | ≤ 1.0 | low |
| `enrollment_fill_rate` | `Σ reg_reported / max(plan_per_year)` (latest year) | ≤ 0.7 | ≤ 0.5 | low |
| `late_round_dependency` | `late-round reg_reported ÷ total reg_reported` | ≥ 0.5 | ≥ 0.7 | high |
| `skill_automation_index` | `COUNT(skills where automationRisk=HIGH) / COUNT(skills)` | ≥ 0.3 | ≥ 0.6 | high |
| `bachelor_intake_floor` | `Σ reg_reported` (latest year) — KKU Council policy ≥ 30/year | < 36 | < 30 | low |
| `curriculum_overlap_max` | highest `program-overlap.v1` course-based overlap index against a same-level sibling, language variants excluded | ≥ 50 | ≥ 70 | high |
| `market_confusion_max` | highest `program-overlap.v1` market similarity against a same-level sibling, language variants excluded | ≥ 60 | ≥ 75 | high |

The two overlap KRIs (added 2026-10-03, `risk-scoring.v1.14`) emit no row
until an overlap run covers the programme; see
`docs/methodologies/program-overlap.md` §9.

The catalog is analyst-tunable via `/admin/risks/indicators/` in v2;
v1 thresholds match the Council ERM templates 2026-Q1.

### Layer 2 — Rule engine (deterministic candidate measures, **v2**)

Before the AI runs, a deterministic rule engine
(`risk-measure-rules.v1`) reads the breach list and emits one **candidate
RiskMeasure** per matched rule. The candidates serve two purposes:

1. **Council guarantee** — every fired KRI is guaranteed to produce at
   least one corresponding measure proposal, even when the AI is
   unavailable (`--no-ai` flag) or refuses. The previous "no automated
   breach→measure link" gap in v1 is closed.
2. **Baseline for the AI** — when the AI does run, it receives the
   candidates as a starting point in the prompt. It is instructed to
   keep every candidate (refining title/rationale to be more
   program-specific is encouraged; outright dropping is not allowed),
   and to **add 1–3 of its own measures** beyond the candidates to
   cover dimensions the rule engine doesn't capture (peer white-spaces,
   sector outlook, qualitative caveats).

**Rule catalog** (`risk-measure-rules.v2`: nine rules covering all seven KRIs;
the intake-floor indicator has two rules — different mitigations for WARN vs
CRITICAL — and a CRITICAL curriculum overlap fires a differentiation rule plus,
for a merge candidate only, a merge-review rule):

| Indicator | Severity | Measure kind | Horizon | Cost | Priority |
|---|---|---|---|---|---|
| `application_seat_ratio` | WARN | `RECRUITMENT_CHANNEL` | SHORT_TERM | LOW | 3 |
| `enrollment_fill_rate` | WARN | `RECRUITMENT_TARGETING` | SHORT_TERM | LOW | 3 |
| `late_round_dependency` | WARN | `RECRUITMENT_TARGETING` | SHORT_TERM | LOW | 4 |
| `skill_automation_index` | WARN | `CURRICULUM_MODERNIZE` | SHORT_TERM | LOW | 2 |
| `bachelor_intake_floor` | WARN | `RECRUITMENT_CHANNEL` | SHORT_TERM | LOW | 3 |
| `bachelor_intake_floor` | CRITICAL | `COHORT_REDUCTION` | MEDIUM_TERM | MEDIUM | 1 |
| `curriculum_overlap_max` | CRITICAL | `CURRICULUM_DIFFERENTIATE` | MEDIUM_TERM | MEDIUM | 2 |
| `curriculum_overlap_max` (flag `merge-candidate`) | CRITICAL | `PROGRAM_MERGE` | LONG_TERM | HIGH | 1 |
| `market_confusion_max` | CRITICAL | `CURRICULUM_DIFFERENTIATE` | SHORT_TERM | LOW | 3 |

Matching is **exact-severity** — a rule with `triggerSeverity = WARN`
only fires on WARN breaches, not on CRITICAL. This is deliberate: a
program 30% below the intake floor needs outreach (WARN); a program
50% below needs cohort restructuring (CRITICAL). If you want a rule to
fire on both severities, add two entries to the catalog.

The engine is a **pure function** in `packages/db/src/risk-measure-rules.ts`
— no I/O, deterministic given (catalog, breaches, thresholds). Unit-
testable without a DB. Templates use `{value}` and `{threshold}`
placeholders that are substituted at evaluation time so the rendered
rationale carries the actual breach value.

**Persistence: `RiskMeasure.triggerIndicatorSlug` + `triggerSeverity`**
(new columns in v2, both nullable). The AI is instructed to echo back
these fields on every measure that responds to a fired KRI — either a
candidate it kept, or a brand-new measure it generated addressing the
same indicator. The UI uses these to render a "triggered by indicator
X" provenance badge on the measure card.

When the rule engine fires but the AI is skipped (`--no-ai`), the
candidates are persisted directly as `RiskMeasure` rows with their
template title + rationale and the trigger fields populated. The
`evidence.notes` field carries the literal string
`rule-engine baseline (no AI) · <rule-key>` so a reviewer can
distinguish rule-only measures from AI-refined ones.

### Layer 3 — Risk Assessment (AI-driven)

Triggered via `pnpm risks:assess`. For each in-scope program:

1. **Load deterministic inputs** — `loadProgramRiskInputs(programId)`
   pulls the three Likelihood drivers (L1 recruitment, L2 AI-disruption,
   L3 demographic), the two Impact dimensions (direct revenue at risk,
   stranded cost), and the latest indicator breaches.
2. **Compute the composite** — `risk-scoring.v1` (see `risk-scoring.md`),
   producing `tier`, `composite_score`, `kkuMatrixScore`, `kkuRiskLevel`.
3. **Run the AI prompt** (`risk-assessment.v1` via Gemini, `--no-ai`
   skips this step) which receives the deterministic inputs + breaches
   and emits:
   - Thai + English narratives (one paragraph each, no superlatives)
   - 2–4 specific `RiskMeasure` proposals with concrete content
     (e.g. "Add CS-301 Applied Generative AI; drop CS-220 SOAP Web
     Services" — not "modernize curriculum")
   - Confidence (0–1) and `dataGapsJson` (a list of `{field, reason}`)
4. **Persist** — single `RiskAssessment` row + 0–4 `RiskMeasure`
   children, all stamped with `methodology_version`, `ai_inference_id`,
   and `payload_json` (full AI response for audit).

Subsequent runs append new RiskAssessment rows; previous ones are
retained. The latest row (by `assessed_at`) is the one the UI shows;
older rows surface in the assessment history drawer.

**AI provenance**: every assessment writes one `AiInference` row (via
`@AiCall({ module: 'risks' })`). The composite + tier are
deterministic; the narratives and measures are AI-derived. A reviewer
can disagree with either via the standard Annotation flow on
`/programs/[id]`.

### Layer 4 — Risk Measures

`RiskMeasure` is a structured mitigation proposal. Fields:

| Field | Semantics |
|---|---|
| `kind` | One of 10 kinds (curriculum modernize/differentiate, recruitment channel/targeting, cohort reduction, program merge/phase-out, partnership industry, faculty hire, tuition adjust) — coarse bucket for filtering |
| `titleTh` / `titleEn` | Short label rendered in tables |
| `rationaleTh` / `rationaleEn` | Analyst-facing "why" (200–400 chars) |
| `costClass` | `LOW` / `MEDIUM` / `HIGH` — coarse cost category |
| `horizon` | `SHORT_TERM` (0–12 mo), `MEDIUM_TERM` (1–3 y), `LONG_TERM` (3–5 y) — Council strategic-plan cadence |
| `expectedDeltaThb` | 5-year revenue delta (saved/added if positive, cost if negative) — nullable for low-confidence measures |
| `priority` | 1 = highest within the assessment (the AI ranks its own proposals) |
| `status` | `PROPOSED` → `ACCEPTED` / `REJECTED` → `IN_PROGRESS` → `COMPLETED` |
| `decisionId` | Optional FK to `CouncilDecision` when the measure has been escalated |
| `evidenceJson` | Cited peers, demand signals, skill tags — free-shape JSON |

#### Measure lifecycle

```
                ┌──────────► REJECTED
PROPOSED ───────┤
                └──► ACCEPTED ───► IN_PROGRESS ───► COMPLETED
                       │
                       └─► (optional bind to CouncilDecision)
```

Transitions are role-gated at `RisksService.updateMeasureStatus()`:
- `PROPOSED → ACCEPTED / REJECTED`: Department Head + Dean + above
- `ACCEPTED → IN_PROGRESS`: Department Head + above
- `IN_PROGRESS → COMPLETED`: Department Head + above (the unit
  responsible for execution)

All transitions are audit-logged (`@AuditLog()`). A measure bound to a
CouncilDecision (`decisionId` set) cannot be silently REJECTED — the
service requires the decision to be SUPERSEDED first.

## KKU 5×5 matrix mapping

Alongside the LOW/MODERATE/HIGH/CRITICAL tier, every assessment carries
KKU institutional matrix coordinates:

- `likelihoodBin` (1–5) — `composite_score` mapped through equal-width
  0–100 → 1–5 bins
- `impactBin` (1–5) — `impact_score` (0–100, normalised against the
  portfolio-level distribution per pipeline run) mapped to 1–5
- `kkuMatrixScore` = `likelihoodBin × impactBin` (1–25)
- `kkuRiskLevel` — `LOW` / `MODERATE` / `HIGH` / `VERY_HIGH` per the
  university's official ERM colour bands

Why two views: the composite tier is the analytics-driven action signal
(what the system thinks); the 5×5 matrix is the legal/audit ERM view
(what KKU's Council and Risk Office formally track). Both come from the
same RiskAssessment row, so the analytics and the ERM register can never
disagree.

When `composite_score IS NULL` (insufficient data on every driver), the
assessment rolls to `tier = NEEDS_DATA` and `kkuRiskLevel = NEEDS_DATA`.
Matrix bins are also null — the program is excluded from the 5×5 grid
rather than placed in cell (1,1) which would imply "low risk."

## Data sources

| Layer | Source |
|---|---|
| Indicator values | `tcas_admission_funnel` (kku-tcas-funnel connector — POWERBI.ADMISSION_STAT_CURRID), `program_skills` + `skills.automation_risk` tagged via `program-pedagogy.v1` extractor |
| Assessment inputs | Same as scoring (see `risk-scoring.md` § Data sources) |
| AI prompt | Gemini, model overridable via `ai_model_overrides` (prefix `risk-assessment`) |
| Decision linkage | `CouncilDecision` (Decision Workspace, prompt 12) |

The indicators read **only real-data rows** (`realDataSql` /
`realDataWhere` filter applied) so mocked connector outputs cannot
trigger false breaches.

## Null handling

| Field | Null behaviour |
|---|---|
| Indicator `value` | Breach written with `value = null`, `severity = OK`. The UI distinguishes "no data" from "data says fine." |
| L1/L2/L3 likelihood drivers | Composite is `max()` over non-null drivers; if ALL three are null, `composite_score = NULL` and `tier = NEEDS_DATA`. |
| `expectedDeltaThb` on a measure | Render as `—`. Don't substitute 0 — Council needs to see that the financial impact wasn't quantified. |
| `decisionId` | NULL until the measure is escalated to a CouncilDecision. |

## Confidence semantics

- **Indicator breach** — deterministic, no confidence number. Severity
  comes straight from the threshold comparison.
- **Assessment confidence** (`RiskAssessment.confidence`, 0–1) — model's
  self-reported certainty about the narrative + measures.
  Components: data-completeness (how many of the L drivers had real
  data), peer/sector-context availability, and the model's own
  hesitation signal. NOT the same as the L1/L2/L3 individual
  `_confidence` fields, which are data-completeness ratios for each
  driver.
- **Measure** — no explicit confidence; the `priority` ranking is the
  model's relative-strength signal.

## Known limitations

- **Bachelor only**. Postgraduate risk uses different demand signals
  (employer hiring channels, research-funded vs taught-only routes) that
  the v1 indicator catalog doesn't model. Master's and doctoral
  programs in `/risks/` are tagged "out of scope" rather than scored.
- **Indicator catalog is fixed in v1**. Analyst-tunable thresholds are
  v2 work. Until then, threshold changes require a schema seed
  re-run (`pnpm db:seed-risk-indicators`) — visible in audit because
  every breach row carries the methodology_version that was active when
  it was written.
- **Measure cost classes are coarse**. `LOW` / `MEDIUM` / `HIGH` is a
  3-bin classifier without an attached THB range — sized to fit
  Council-table layout, not to drive precise budget planning. A real
  cost-estimation methodology depends on Finance Committee sign-off on
  the cost-allocation rollup (see [cost-allocation.md](./cost-allocation.md)).
- ~~**No automated breach → measure link**~~ — **closed in v2**
  (2026-05-19). The rule engine in `risk-measure-rules.v1` deterministically
  generates one candidate measure per fired KRI before the AI runs.
  Trigger fields persisted on the RiskMeasure row for provenance.
- **Mitigation tracking is status-only**. Once a measure is
  `IN_PROGRESS`, the system doesn't track milestones or % complete on
  the measure itself — those live on the linked CouncilDecision via
  `DecisionMilestone` (Decision Workspace). For standalone measures
  with no decision binding, the IN_PROGRESS state is opaque to the
  outside world. Acceptable in v1; revisit if Risk Office requests
  tighter follow-through.

## Cross-module wiring

- **`packages/db/src/risk-scoring.ts`** — `RISK_INDICATOR_CATALOG`,
  scoring helpers (`scoreL2AiDisruption`, `loadProgramRiskInputs`),
  `RISK_SCORING_VERSION` constant.
- **`apps/ingestion/src/scripts/risks-assess.ts`** — orchestration
  (deterministic compute → AI call → persist). Runs single program
  (`pnpm risks:assess <code|seq|id>`) or the full portfolio
  (`pnpm risks:assess --all`, with `--no-ai` for fast deterministic-only
  runs).
- **`apps/api/src/risks/risks.service.ts`** — read endpoints (portfolio
  matrix, single-program view, indicator breach history) + measure
  status transitions.
- **`apps/web/app/risks/`** — operator UI (portfolio matrix, 5×5
  matrix, indicator pages, per-program drill).
- **AI prompt: `risk-assessment.v1`** in
  `packages/shared/src/ai/prompts/risk-assessment.ts`. Bumped together
  with the scoring formula whenever the contract between scorer and
  prompt changes.

## Provenance + audit

Every RiskAssessment row carries:
- `methodologyVersion` (the scoring formula version active at
  assessment time — `risk-scoring.v1.9` as of this doc)
- `aiInferenceId` → joins to `AiInference` (prompt, response, cost,
  model id)
- `payloadJson` (full AI response, immutable audit)
- `assessedAt` (run timestamp)

When a Council Pack PDF includes risk numbers, the Provenance
appendix lists the assessment row's `assessed_at` + `methodologyVersion`
+ the indicator catalog version. A reviewer can reproduce any number on
the page by re-running `pnpm risks:assess <code> --no-ai` against the
same data snapshot.

## Version history

| Version | Date | Author | Change |
|---|---|---|---|
| `risk-management.v1` | 2026-05-19 | Methodology bundle | Initial documentation of the workflow layer. Companion to `risk-scoring.v1.9`. Three operational layers (KRI alarms / AI assessment / measure lifecycle). |
| `risk-management.v2` | 2026-05-19 | Methodology bundle | **Closes the "no automated breach→measure link" gap.** New Layer 2 — deterministic rule engine (`risk-measure-rules.v1`) fires one candidate measure per matched (KRI × severity) pair before the AI runs. Six rules covering all five v1 KRIs. New `RiskMeasure.triggerIndicatorSlug` + `triggerSeverity` columns (additive migration `20260519120000_risk_measure_trigger`) for provenance. AI prompt bumped to `risk-assessment.v3` to accept candidates as input and echo back trigger fields. `--no-ai` path now also persists rule-derived candidates so Council never sees an empty mitigation list for a program with fired KRIs. |
