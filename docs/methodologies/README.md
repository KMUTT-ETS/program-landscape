# Methodology Compendium

Every metric in the system carries a `methodologyVersion` field. When the
formula or data source changes, the version is bumped, the old doc is kept
in git history, and charts display the version on the provenance drawer.

**Naming:** `<metric-slug>.md` · version history table at the top · machine
lookup map in `@kku/shared/methodologies.ts`.

---

## Implemented

| Slug | Module(s) | Current version | Doc |
|---|---|---|---|
| `health-score` | Cockpit, Deep-Dive | `health-score.v5.3` | [health-score.md](./health-score.md) |
| `forecasting` | (deferred — no consumer since v1.9.7) | `forecasting.v1` | [forecasting.md](./forecasting.md) |
| `gap-map` | Gap Analyzer | `gap-map.v2` | [gap-map.md](./gap-map.md) |
| `gap-brief` | Gap Analyzer (Council brief) | `gap-brief.v1` | `packages/shared/src/ai/prompts/gap-brief.ts` |
| `job-field-taxonomy` | Gap Analyzer (the rows) | `job-field-taxonomy.v1` | [gap-map.md](./gap-map.md) §7 |
| `program-job-field` | Gap Analyzer (programme assignments) | `program-job-field.v1` | [gap-map.md](./gap-map.md) §7 |
| `scenario-engine` | Scenario Planner | `scenario-engine.v1` | [scenario-engine.md](./scenario-engine.md) |
| `benchmarking` | Benchmarking | `benchmarking.v1` | See [benchmarking.md](./benchmarking.md) (placeholder — extend from service comments) |
| `curriculum-heuristic` | PDF intake / curriculum extraction | `heuristic-v1` | In-code docstring: `apps/ingestion/src/pdf-intake/extractors/curriculum-extractor.ts` |
| `curriculum-gemini` | PDF intake / curriculum extraction | `gemini-v1` | In-code docstring: `apps/ingestion/src/pdf-intake/extractors/curriculum-ai-extractor.ts` |
| `outcome-review` | Decision Workspace | `outcome-review.v1` | See `apps/api/src/decisions/decision-review.service.ts` |
| `analyst-safety` | AI Analyst | `analyst-safety.v3` | `packages/shared/src/analyst/safety.ts` |
| `analyst-system` | AI Analyst | `analyst-system.v2` | `packages/shared/src/analyst/tools.ts` |
| `ai-extraction-accuracy` | AI extraction governance | `ai-extraction-accuracy.v1` | [ai-extraction-accuracy.md](./ai-extraction-accuracy.md) |
| `methodology-bundle` | Cross-cutting (release stamp) | `landscape-2026-05.v1` (tag) + 8-char fingerprint | `packages/db/src/methodology-bundle.ts` |
| `verdict-stability` | Verdict back-test loop | `verdict-stability.v1` | [verdict-stability.md](./verdict-stability.md) |
| `cross-scope-consistency` | Top-down vs bottom-up divergence | `cross-scope-consistency.v1` | [cross-scope-consistency.md](./cross-scope-consistency.md) |
| `risk-scoring` | Risk Management (formula) | `risk-scoring.v1.13` | [risk-scoring.md](./risk-scoring.md) |
| `risk-management` | Risk Management (workflow) | `risk-management.v2` | [risk-management.md](./risk-management.md) |
| `risk-measure-rules` | Risk Management (rule engine) | `risk-measure-rules.v1` | `packages/db/src/risk-measure-rules.ts` |
| `risk-assessment` | Risk Management (AI prompt) | `risk-assessment.v4` | `packages/shared/src/ai/prompts/risk-assessment.ts` |
| `class-gpa` | `/education/performance` — class-GPA section | `class-gpa.v1` | [class-gpa.md](./class-gpa.md) |

### Light derived metrics (no separate doc)

A handful of single-formula metrics surface on dashboards without
needing a full methodology doc. They're stamped with the bundle version
of the page that renders them.

| Metric | Surface | Formula | Notes |
|---|---|---|---|
| Papers per active faculty | `/staff/research` (v1.2.7+) | `totalPapers / activeStaff` | `activeStaff` = `FacultyMember.isActive=true` filtered by the same `facultyName` set — same denominator `/staff/workforce` reports. Returns `—` when `activeStaff = 0` (never substitute 1). |
| TCAS funnel (yield / fill / competition) | `/education/recruitment`, `/programs/[id]` | KKU TCAS Admission Funnel (`POWERBI.ADMISSION_STAT_CURRID`) — `admitted/applicants`, `enrolled/quota`, `applicants/quota` | All three guard against zero denominators with `—`. Source connector slug: `kku-tcas-funnel`. |

## Council-readiness contract

Every methodology doc must capture:

1. **Summary** — one paragraph describing what the metric measures and who consumes it.
2. **Formula** — the math, with variable definitions.
3. **Data sources** — which tables / external feeds contribute, which are mocked.
4. **Null handling** — what happens when a required input is missing (never substitute 0 / default).
5. **Confidence semantics** — what the accompanying ConfidenceBadge means (data-completeness? model confidence? back-test accuracy?).
6. **Known limitations** — honest list of what the v1 doesn't do.
7. **Version history** — each version's date, author, change summary, and migration notes.

A methodology version bump is a **behaviour change** and triggers:

- A new `docs/methodologies/<slug>-v<N>.md` (or new section in the existing doc).
- Rerun of any stored metric rows that can be recomputed (audit-logged).
- Annotation in the next Council Pack's provenance appendix.
- Eval-suite rerun (`pnpm ai:eval`) for AI-backed methodologies.

## Deferred (need prompt 14 + real data)

| Slug | Blocker |
|---|---|
| `cost-allocation` | Real faculty-cost feed (KKU-HR connector) |
| `bcg-position` | Market-share heuristic needs real peer enrolment data |
| `demographic-ceiling` | Province-level admissions projections from NESDC |
| `employer-feedback-synthesis` | Live survey ingestion pipeline |
