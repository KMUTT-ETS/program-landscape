# Adapt a methodology to your institution

> **ภาษาไทย:** [ฉบับภาษาไทย](../th/guides/adapt-a-methodology.md)

**Outcome.** You can change a scoring methodology for your institution without breaking the audit trail behind its numbers.

Every score the platform produces is computed by an explicitly-versioned function in `packages/db/src/` with a matching document under `docs/methodologies/`.

| Methodology | Doc | Implementation |
|---|---|---|
| Health score (`health-score.v4.0`) | `docs/methodologies/health-score.md` | `packages/db/src/health-score.ts` |
| Programme health + lifecycle | In-app paper `/docs/methodology` — `apps/web/app/docs/methodology/content-{en,th}.tsx` (the old markdown copy is retired) | `packages/db/src/health-score.ts` |
| Risk scoring | `risk-scoring.md`, `risk-management.md` | `packages/db/src/risk-scoring.ts` |
| Forecasting (`forecasting.v1`) | `forecasting.md` | `packages/shared/src/forecasting/` |
| Scenario engine | `scenario-engine.md` | `packages/shared/src/scenarios/` |
| Cost allocation | `cost-allocation.md` | **v0 draft — explicitly not Council-ready** |
| Cross-scope consistency | `cross-scope-consistency.md` | `packages/db/src/scope.ts` |
| Data quality (`data-quality.v2`) | — | `packages/db/src/data-quality.ts` |
| Evaluations, class GPA, verdict stability, AI extraction accuracy | see `docs/methodologies/` | various |

## Three rules for changing a methodology

1. **Bump the version constant, always.** `HEALTH_SCORE_VERSION = 'health-score.v4.0'` in `packages/db/src/health-score.ts` is stamped onto every score row. Changing a formula without bumping it makes historical comparisons silently wrong and breaks the audit trail that lets a Council member ask "why did this programme's score change?"
2. **Update the doc in the same commit.** The doc under `docs/methodologies/` is the version of record for what the number means. A drifted doc is worse than no doc.
3. **Null is not zero.** The health score's foundational rule: a missing metric is **excluded from the average**, never substituted with 0 or 50. Every score carries a `dataCompletenessPct` and the UI renders missing values as `—`. Do not "fix" this — substituting zero punishes programmes for your data gaps, which is precisely the failure mode that destroys Council trust.

## Where your weights differ

KKU's health score is composed of dimensions (demand, financial, quality, relevance, capability) with drivers inside each. Some drivers are explicitly weighted by KKU's strategic judgement — for example, a demand driver weighted for "the non-degree HRD shift squeezing post-graduate programmes". These are **KKU Council positions, not universal truths**, and you should expect to change them.

The safe adaptation pattern: add your weights as a new version alongside KKU's rather than editing theirs in place. You keep the ability to merge upstream changes to the formula's *structure* while owning its *parameters*.

**Before changing anything cross-module, read `docs/evaluation-pipeline.md`.** It maps how health, lifecycle, risk, the KKU matrix, and BCG scoring interact with 22 AI prompts and a set of cross-joins. Changing a weight in isolation can move a programme across a BCG quadrant boundary in a way you did not intend.

## Cost allocation is unfinished — at KKU too

`docs/methodologies/cost-allocation.md` is a **v0 draft** pending Finance Committee approval. It lays out five cost pools and an activity-based formula, and the connectors populate its raw inputs, but no per-programme cost figure is Council-facing. If financial sustainability analysis is a priority for you, this is genuine unfinished work you inherit, not a configuration step.

## Next step

Continue with [Fork and take upstream fixes](./upstream-fixes.md).
