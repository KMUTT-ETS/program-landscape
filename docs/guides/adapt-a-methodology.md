# Adapt a methodology to your institution

> **ภาษาไทย:** [ฉบับภาษาไทย](../th/guides/adapt-a-methodology.md)

**Outcome.** You can change a scoring methodology for your institution without breaking the audit trail behind its numbers.

Every score the platform produces is computed by an explicitly-versioned function in `packages/db/src/` with a matching document under `docs/methodologies/`.

| Methodology | Doc | Implementation |
|---|---|---|
| Health score (`health-score.v5.6`) | `docs/methodologies/health-score.md` | `packages/db/src/health-score/` (numbers in `tuning.ts`) |
| Programme health + lifecycle | In-app paper `/docs/methodology` — `apps/web/app/docs/methodology/content-{en,th}.tsx` (the old markdown copy is retired) | `packages/db/src/health-score/`, `packages/db/src/program-deep-dive.ts` |
| Risk scoring | `risk-scoring.md`, `risk-management.md` | `packages/db/src/risk-scoring.ts` |
| Forecasting (`forecasting.v1`) | `forecasting.md` | `packages/shared/src/forecasting/` |
| Scenario engine | `scenario-engine.md` | `packages/shared/src/scenarios/` |
| Cost allocation | `cost-allocation.md` | **v0 draft — explicitly not Council-ready** |
| Cross-scope consistency | `cross-scope-consistency.md` | `packages/db/src/scope.ts` |
| Data quality (`data-quality.v2`) | — | `packages/db/src/data-quality.ts` |
| Evaluations, class GPA, verdict stability, AI extraction accuracy | see `docs/methodologies/` | various |

## Three rules for changing a methodology

1. **Change the version, always.** The methodology version (for the health score, `health-score.v5.6`) is stamped onto every score row. For the health score you change it through your own institution revision; see [Stamp your own version](#stamp-your-own-version). Changing a formula without bumping it makes historical comparisons silently wrong and breaks the audit trail that lets a Council member ask "why did this programme's score change?"
2. **Update the doc in the same commit.** The doc under `docs/methodologies/` is the version of record for what the number means. A drifted doc is worse than no doc.
3. **Null is not zero.** The health score's foundational rule: a missing metric is **excluded from the average**, never substituted with 0 or 50. Every score carries a `dataCompletenessPct` and the UI renders missing values as `—`. Do not "fix" this — substituting zero punishes programmes for your data gaps, which is precisely the failure mode that destroys Council trust.

## Where your weights differ

KKU's health score is composed of five dimensions (attractiveness, financial, capability, outcomes, relevance) with drivers inside each. Some drivers are explicitly weighted by KKU's strategic judgement — for example, a demand driver weighted for "the non-degree HRD shift squeezing post-graduate programmes". These are **KKU Council positions, not universal truths**, and you should expect to change them.

The safe adaptation pattern: keep your changes to the health score's *parameters* in one file, `packages/db/src/health-score/tuning.ts`, and stamp them with your own version. You keep merging upstream changes to the formula's *structure* cleanly, because upstream rarely touches the lines you changed.

**Before changing anything cross-module, read `docs/evaluation-pipeline.md`.** It maps how health, lifecycle, risk, the KKU matrix, and BCG scoring interact with 22 AI prompts and a set of cross-joins. Changing a weight in isolation can move a programme across a BCG quadrant boundary in a way you did not intend.

## Where to change what

| You want to change | Where | Version change? |
|---|---|---|
| Intake floors per programme level | Organisation profile (admin UI) | No: policy, not formula |
| The institution's region (demographic resilience) | Organisation profile (admin UI) | No |
| A faculty's teaching-mode band for the student–staff ratio | Faculty settings (admin UI) | No |
| A threshold, curve point, target or weight (e.g. the student–staff band limits, revenue targets per level, strategic career groups, the domestic 75 : global 25 split) | `packages/db/src/health-score/tuning.ts` | Yes |
| How a driver is computed | The dimension's file in `packages/db/src/health-score/` (`attractiveness.ts`, `financial.ts`, `capability.ts`, `outcomes.ts`, `relevance.ts`); change the programme scorer **and** the scope scorer | Yes |
| Add or drop a driver | The dimension's file **and** `DIMENSION_DRIVERS` in `drivers.ts` | Yes |

`packages/db/src/health-score/README.md` lists which file computes each driver. Every value in `tuning.ts` is named after the driver label shown in the app's score tooltip, so searching for that label finds both the value and the code.

## Stamp your own version

Upstream (KKU) owns `health-score.vX.Y`. Your institution does not bump that number. You set a revision of your own in `tuning.ts`:

```ts
export const INSTITUTION_REVISION: string | null = 'kmutt.1';
```

Every score is then stamped `health-score.v5.6+kmutt.1`, so a figure computed with your values can never be mistaken for a KKU figure, and a later upstream bump shows up as `health-score.v5.7+kmutt.1`. Bump your revision (`kmutt.2`, `kmutt.3` …) on every change to a value or to the logic.

The test `packages/db/test/health-score-tuning-pin.test.ts` holds you to this. It fails when `tuning.ts` changes but the version did not, and it prints the fingerprint to pin for the new version:

```bash
pnpm --filter @kku/db test health-score-tuning-pin
```

Add the printed line to `PINNED` in that file, and keep the old lines: they record which values each published version used. The test only sees numbers. A change to a scorer's logic needs a new revision too, and only review will catch it if you forget.

## Cost allocation is unfinished — at KKU too

`docs/methodologies/cost-allocation.md` is a **v0 draft** pending Finance Committee approval. It lays out five cost pools and an activity-based formula, and the connectors populate its raw inputs, but no per-programme cost figure is Council-facing. If financial sustainability analysis is a priority for you, this is genuine unfinished work you inherit, not a configuration step.

## Next step

Continue with [Fork and take upstream fixes](./upstream-fixes.md).
