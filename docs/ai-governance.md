# AI governance

Policy for how AI is used across KKU Curriculum Landscape. The app
makes consequential recommendations about academic programs — closure,
merger, new launch. AI helps analysts get there; it does not decide.

## Principles

1. **AI is a force multiplier for analysts, not a decision-maker.**
   Every module that exposes AI-derived content routes it through a
   human reviewer before it reaches a Council Pack.
2. **Every output carries confidence + sources + reasoning.** The
   `<ConfidenceBadge>`, `<ProvenanceButton>`, and "show reasoning"
   expandable are non-negotiable UI surfaces (see CLAUDE.md
   "Council-readiness rules").
3. **Every AI call is audit-logged.** `AiInference` captures prompt,
   response, model, tokens, latency, cost, confidence for every call.
   Providers write via `AiInferenceRecorder` at call time, not after
   the fact.
4. **Prompts are code.** Templates live in
   `packages/shared/src/ai/prompts/*`, versioned via a `METHOD_VERSION`
   constant exported from each file. `AiExtraction.methodVersion`
   captures the version that produced each row so we can bulk-reprocess
   after a prompt change.
5. **Human-in-the-loop for every consequential extraction.** LLM
   outputs below the auto-approve threshold land in
   `/admin/extraction-review`; approvals are the only path into domain
   tables.
6. **Provider choice is config, not code.** Modules inject `AiService`;
   the factory picks the provider from env. No module imports
   `@google/genai` or `@anthropic-ai/sdk` directly.

## Architecture

```
Modules (api + ingestion)
        │
        │  AiService interface (complete / extract / embed / translate / vision)
        ▼
    AiService
        │
   ┌────┴─────┬─────────────┬────────────────────────┐
   ▼          ▼             ▼                        ▼
 Google    Anthropic    OpenRouter                IntelSphere
(Gemini)   (Claude)     (stub, prompt XX)        (stub, KKU gateway)
   │          │
   │          └─ embed() falls back to Google
   │             (Claude has no embeddings API)
   ▼
  AiInference row (every call)
```

Config (env):

| Var | Default | Notes |
|---|---|---|
| `AI_PROVIDER` | `google` | `google` / `anthropic` / `openrouter` / `intelsphere` |
| `GOOGLE_AI_API_KEY` |  | Required for provider=google; also used for embeddings when provider=anthropic |
| `ANTHROPIC_API_KEY` |  | Required for provider=anthropic |
| `OPENROUTER_API_KEY` |  | Stubbed |
| `KKU_INTELSPHERE_URL` / `KKU_INTELSPHERE_API_KEY` |  | Stubbed |
| `AI_GOOGLE_COMPLETION_MODEL` | `gemini-2.0-flash-001` | Override per deployment |
| `AI_GOOGLE_EMBEDDING_MODEL` | `text-embedding-004` | 1536 dims — matches pgvector column |
| `AI_ANTHROPIC_COMPLETION_MODEL` | `claude-sonnet-4-6` | |
| `AI_AUTO_APPROVE_THRESHOLD` | `0.85` | AiExtraction below this → PENDING_REVIEW |

## Confidence thresholds

Two distinct thresholds with different meanings:

| Threshold | Scope | Default | Effect |
|---|---|---|---|
| `AI_AUTO_APPROVE_THRESHOLD` | extraction output | 0.85 | AiExtraction `confidence >=` this → AUTO_APPROVED, else PENDING_REVIEW |
| `PDF_INTAKE_CLASSIFIER_THRESHOLD` | PDF classification (prompt 03b) | 0.7 | PdfExtraction auto-approve requires classifier and extractor both cleared |
| `PDF_INTAKE_EXTRACTOR_THRESHOLD` | PDF extractor output | 0.8 | See prompt 03b |

The defaults are intentionally high. Council-affecting extractions
should sit in the review queue by default; tuning downward is a
positive decision that someone makes when accuracy has been measured.

## Prompt templates

Every template:
- Lives in `packages/shared/src/ai/prompts/<name>.ts`
- Exports a `<NAME>_VERSION` constant (e.g. `course-skills.v1`)
- Exports a builder `build<Name>Messages(input)` returning `AiMessage[]`
- Exports a Zod output schema

Update policy:
- **Trivial copy-edit** (typo fix, clarification that doesn't change
  behaviour): bump the patch part of the version or leave it.
- **Behaviour change** (examples rewritten, output shape altered,
  reasoning rules changed): bump the version constant.
- **Never** edit an existing version in place after it has produced
  AiExtraction rows in any environment beyond dev. The version → row
  link is what lets us rerun affected extractions deliberately.

Current templates:

| File | Version | Used by |
|---|---|---|
| `course-skill-extraction.ts` | `course-skills.v1` | ExtractCourseSkillsJob |
| `job-posting-skill-extraction.ts` | `job-posting-skills.v1` | ExtractJobPostingSkillsJob |
| `policy-doc-analysis.ts` | `policy-doc.v1` | AnalyzePolicyDocJob (chains off prompt-03b PDF extraction) |

## Human-in-the-loop checkpoints

Every module that surfaces AI output must:

1. **Show confidence** next to the output (`<ConfidenceBadge>`).
2. **Link to the source** (`<ProvenanceButton>` → drawer with
   AiInference id + prompt + raw response).
3. **Allow override** — analyst edits the structured payload and
   approves; the approved version is what downstream analytics use.
4. **Capture rejection reason** when an analyst rejects. Rejections
   feed the prompt-tuning dataset for the next `VERSION` bump.

Consequential recommendations (program closure, merger, launch)
require **two-reviewer approval** at the Decision Workspace layer
(prompt 12) regardless of the AI's confidence.

## Bias & fairness

Apply the same principles from the team's high-school AI tutoring
chatbot policy work:

- **Transparency:** AI outputs are never surfaced without a
  "generated by model X on YYYY-MM-DD" attribution.
- **Explainability:** every recommendation has a reasoning trail a
  non-technical Council member can follow.
- **Scrutiny on demographic-adjacent recommendations:** when an AI
  extraction or recommendation affects program viability in
  faculties/departments with distinct demographic composition (e.g.
  Faculty of Education), the review queue MUST be routed to at least
  one reviewer from that faculty before approval.
- **Periodic accuracy audit:** every methodology version is re-scored
  against a hand-labeled sample (to be built — see below) before wider
  rollout.

## Translation handling

Thai ↔ English translations go through `AiService.translate()`:

- Thai-primary for analytical content (narratives, summaries,
  recommendations).
- English on demand for UI / international reviewers.
- Translations are cached (deferred: Redis cache, keyed by
  `(sourceLang, targetLang, hash(text))`). For now every call hits the
  LLM.

## Cost tracking

Per-call cost lives on `AiInference.costEstimateUsd`. Estimates come
from the provider's public per-1k-token rates (see
`packages/shared/src/ai/providers/<provider>.ts` PRICING tables —
update when the provider bumps pricing).

The admin dashboard at `/admin/extraction-review` (stats strip +
per-module table) rolls up costs over a 7-day window. Per-month rollups
+ budget alerts land in prompt 13.

## Model versioning

When a model version changes (e.g. `gemini-2.0-flash-001` →
`gemini-2.1-pro-001`):

1. Update the factory's PRICING table in the provider file.
2. Add the new model to the model-override config (`AI_*_MODEL` env
   vars) + document.
3. A/B test on a representative PENDING_REVIEW sample before flipping
   the default — the review UI's confidence distribution is the metric.
4. Old `AiInference` rows keep their original model name forever.

## Accuracy measurement

Deferred until real extraction data exists:

- Hand-label a sample of 30-50 course descriptions across Thai + English
- Run each version of the course-skill extractor against the sample
- Report F1 + per-skill precision / recall in
  `docs/methodologies/ai-extraction-accuracy.md`
- Require F1 ≥ 0.7 before promoting a version to the default

The review queue's approved / rejected / edited split is a live
approximation — when rejection rate on a methodVersion crosses 10%,
that's the signal to invest in the hand-labeled audit.

## What's wired today vs. stubbed

| Capability | Status | Notes |
|---|---|---|
| `AiService` interface | **Real** | In `@kku/shared/ai` |
| Google / Gemini provider | **Real** | Requires `GOOGLE_AI_API_KEY` |
| Anthropic / Claude provider | **Real** | Requires `ANTHROPIC_API_KEY`; embedding falls back to Google |
| OpenRouter provider | **Stubbed** | Factory returns the class; methods throw |
| IntelSphere (KKU gateway) | **Stubbed** | Needs gateway API contract |
| Prompt templates | **Real** | 3 templates versioned as code |
| Skill taxonomy seed | **Real-ish** | ~60 skills; full ESCO / TPQI bootstrap deferred to a data-load chore |
| `/skills` explorer | **Real** | Tree, search, scope-aware coverage |
| `/admin/extraction-review` | **Real** | Queue, stats strip, approve / reject / edit |
| `AiExtraction` table | **Real** | Mirror of `PdfExtraction` for non-PDF AI outputs |
| BullMQ `ai-jobs` queue | **Real** | Four handlers wired; runs when `AI_PROVIDER` + key set |
| Embedding backfill | **Real job** | `EMBED_SKILL` handler; call it per-skill after seed |
| Vector-similarity skill candidate selection | **Stubbed** | Currently picks newest skills; flip to similarity when embeddings are populated |
| Post-approval materialisation (CourseSkill, JobPostingSkill etc.) | **Deferred** | Scaffold in ai-admin.service; real wiring lands once approved shapes stabilise |
| Accuracy measurement | **Deferred** | Hand-labeled corpus needed |
| Translation cache | **Deferred** | Each call hits LLM |
