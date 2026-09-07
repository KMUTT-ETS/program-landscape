# AI model health — notifying SUPER_ADMIN when a pinned model breaks

**Date:** 2026-09-07
**Status:** approved for planning
**Surfaces:** `/admin/app/ai-settings` banner · `/admin/system-status` banner · in-app notification to every `SUPER_ADMIN`

## Why this exists

On 2026-08-03 an operator pinned 23 of 27 AI methods to `gemini-3.6-flash` through
`/admin/app/ai-settings`. That model id is **not in `AVAILABLE_AI_MODELS`, and appears nowhere in
the codebase** — the `AiModelOverride` schema deliberately allows off-catalog ids, "stored verbatim
here so even off-catalog models work in a pinch".

At some point Google began refusing those requests:

```
{"error":{"code":400,"message":"Request contains an invalid argument.","status":"INVALID_ARGUMENT"}}
```

Nothing reported it. The failure surfaced on 2026-09-07 as an unrelated-looking symptom: a
programme's **Curriculum revision** section reading "No course list has been extracted", because
phase2b's LLM call was being refused, its regex fallback found nothing, and phaseCR then skipped
with `no-courses`. Every step reported green. The pin had been broken for up to five weeks with no
signal anywhere.

Three separate gaps made that possible, and this project closes them:

1. **Validation exists, but against a different catalog than you would expect.** `setOverride`
   already calls `findCatalogModel(modelId)` and rejects unknown ids — the pin was *not*
   unvalidated. There are **two** catalogs and they answer different questions:

   | Source | What it is | Used for |
   |---|---|---|
   | `AVAILABLE_AI_MODELS` | static array in code, 8 ids, carries our cost/tier opinions | the admin picker's curated list |
   | `ai_model_catalog` table | **refreshed daily from OpenRouter** | `findCatalogModel()` — what actually gates a pin |

   OpenRouter lists models across many providers. **Presence there does not mean the id is usable
   on Google's direct Gemini API with our key**, which is the call this platform actually makes.
   `gemini-3.6-flash` was catalog-valid and provider-unusable simultaneously. No static check can
   catch that; only a real call can. That is why `failing` carries the weight in this design and
   `off-catalog` is the weaker, secondary signal.
2. **Nothing notices a model that stops working.** `ai_inferences` has no failure column, and a
   400 fails the HTTP call outright, so a refused request produces **no row at all** today.
3. **Nothing tells anyone.** There is no path from "the AI layer is broken" to a human.

## What this project does NOT do

- **No save-time blocking.** Off-catalog pins stay legal; the schema comment is deliberate and an
  operator pinning a brand-new model before the catalog catches up is a real use case. We warn, we
  do not refuse.
- **No email.** SMTP has never been wired in this project. Three in-app surfaces only.
- **No provider deprecation API.** None exists. Deprecation is a hand-maintained flag.
- **No fallback for transient errors.** `wrapWithTransientFallback` already owns 429/5xx/timeouts.
  Merging the two would hide capacity problems behind a model substitution.

## Architecture — one resolver, three readers

The requirement is three surfaces answering "is this model OK?". Computing that verdict three times
is how they drift, which is the failure shape this codebase keeps producing: `phaseCR` writing
revision-scoped and reading unscoped; the pipeline and the CLI disagreeing about which model to
use; `restore-drill.sh` and preflight gate 7 each broken in a way that concealed the other. The
verdict is therefore computed **once**.

### Pure core — `packages/shared/src/ai/model-health.ts`

```ts
export type ModelHealthStatus = 'ok' | 'off-catalog' | 'deprecated' | 'failing';

export interface MethodModelHealth {
  methodPrefix: string;
  effectiveModel: string;
  isPinned: boolean;            // false = using the catalog default
  status: ModelHealthStatus;
  detail: string;               // human sentence; names secondary problems too
}

export function assessModelHealth(input: {
  overrides: { methodPrefix: string; modelId: string }[];
  /** Ids from the ai_model_catalog TABLE — the same source findCatalogModel()
   *  gates pins against. Checking the static AVAILABLE_AI_MODELS array instead
   *  would mark every production pin off-catalog and drown the real signal. */
  knownModelIds: Set<string>;
  /** Deprecation is OUR opinion, hand-maintained on the static catalog: the DB
   *  catalog is OpenRouter's list and carries no view on what we should stop
   *  using. Two sources on purpose — they answer different questions. */
  deprecatedModels: Map<string, string | undefined>;   // id -> note
  methods: Array<{ methodPrefix: string; defaultModel: string }>;
  recentFailures: { methodPrefix: string; modelId: string; count: number; lastAt: Date }[];
}): MethodModelHealth[];
```

No prisma, no network. Testable the way `decideCourseMaterialisation` is.

**Failure window: 7 days. `failing` = at least one `ai_model_invalid` row for that
(methodPrefix, effectiveModel) inside the window.** One occurrence is enough because a
model-invalid error is deterministic — the id is wrong, not flaky — so waiting for a second is
waiting for a second broken pipeline run. This is exactly why it must not fire on 429/5xx, which
*are* flaky and belong to the transient path.

**Status precedence: `failing` > `deprecated` > `off-catalog` > `ok`.** A method can be several at
once — the August incident was off-catalog *and* failing — so the verdict reports the most severe
and names the rest in `detail`.

### DB adapter — `packages/db/src/ai-model-health.ts`

Gathers the four inputs, calls the pure core, returns the verdicts. **This is the only function the
three surfaces call.**

### Catalog change — `AiModelEntry`

Add `deprecated?: boolean` and `deprecatedNote?: string`, beside the existing `legacy?`.
Hand-maintained. There is no provider API for model lifecycle, and building machinery around data
nobody updates would be worse than an honest flag.

### Failure recording — no migration

`ai_inferences.kind` is free-text and **indexed**. On a model-invalid error the provider writes a
row with `kind: 'ai_model_invalid'`, the attempted model, and the error text. That is what makes
`recentFailures` real; without it the resolver has no failure input at all.

### Fallback — `wrapWithModelInvalidFallback`

A sibling to the existing transient wrapper, firing **only** on model-invalid errors
(`400 INVALID_ARGUMENT`, `404 model not found`). Retries once on the method's catalog default. The
retry's own `AiInference` records the substitute model, so the audit trail shows what actually ran.

An off-catalog model that *works* is left alone: off-catalog is a notification trigger, never a
substitution trigger.

### Notifier — daily job on the existing `ai-jobs` queue

Runs at **04:00 Asia/Bangkok**, after the 02:00 backup and 03:00 backup-verification timers, so the
three operational jobs do not overlap. Reads the adapter, raises one `Notification` per non-`ok` method to every `SUPER_ADMIN`:

| Field | Value |
|---|---|
| `kind` | `ai_model_health` |
| `severity` | `high` for `failing`, `medium` for `deprecated` / `off-catalog` |
| `entityType` | `ai_model_override` |
| `entityId` | `<methodPrefix>:<modelId>` |

**Hygiene.** Keying `entityId` on the model as well as the method means re-running the job while a
pin is still broken suppresses a duplicate against the unread row, while *changing* the pin to a
different bad model raises a fresh alert. When a method returns to `ok`, the job marks its
outstanding notifications read — otherwise the inbox fills with alarms for things already fixed and
people learn to ignore the bell.

## Prerequisite — the resolver divergence

**20 of 35 `createAiService` callers do not pass `modelOverrideResolver`** — 18 ingestion scripts,
plus a test fixture and one web-side caller, so they silently use the
catalog default while `/admin/app/ai-settings` claims something else is in effect. This is not a
side issue: a feature reporting the "effective model" would be **wrong for half the system**.

It is also how the August incident stayed hidden. The pipeline honours overrides and was failing;
`pnpm programs:extract-courses` ignores them and succeeded — and the empty-state text on
`/programs/[id]` tells the operator to run exactly that command. The documented recovery path
exercised a different model from the one that was broken.

Fix: a single `createIngestionAiService()` in the ingestion app that always wires
`getAiModelOverrideStore()`, with the 18 ingestion scripts switched to it. Mechanical; lands as its own commit
ahead of the feature. Making the omission impossible beats documenting that it is discouraged.

Callers currently ignoring overrides: `ingestion.service.ts`, `bulk-digest-programs`,
`digest-program`, `extract-imd-pdf`, `extract-program-courses`, `extract-program-faculty`,
`extract-program-skills-detailed`, `generate-curriculum-revision`, `generate-program-ai-readiness`,
`generate-program-pedagogy`, `ingest-employment-surveys`, `map-admission-stat-programs`,
`map-program-careers`, `match-program-demand`, `normalise-skill-names`, `risks-assess`,
`select-program-peers`, `translate-evaluation-questions`. (`apps/web/src/lib/profile-narrative.ts`
is a web-side caller — decide separately whether the web app should honour overrides at all.)

## Error handling

Fail-open throughout. A monitoring feature must never be why a page is down.

- Failure-stats query fails → adapter still returns catalog-derived statuses.
- Adapter throws → banners render nothing rather than erroring the page.
- Notifier throws → logged; the next day's run retries. No retry storm.

## Testing

| What | Why it matters |
|---|---|
| Pure core, table-driven: each status, precedence when several apply, pinned vs default | The verdict is the product |
| Classifier: the real `400 INVALID_ARGUMENT` payload classifies as model-invalid; **429 and 500 do not** | Stops the two fallback paths merging and swallowing capacity problems |
| Fallback: a model-invalid error retries on the default and records both rows | The substitution must be auditable, not silent |
| Dedup: raise twice → one notification; different bad model → a second; return to `ok` → marked read | An alert system people mute is worse than none |

## Open question, deliberately deferred

Whether `deprecated` should ever auto-substitute the way `failing` does. Today it only notifies. A
deprecated-but-working model is still working, and substituting it without being asked would change
results under a Council-facing number with no human in the loop.
