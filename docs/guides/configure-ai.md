# Configure the AI layer

> **ภาษาไทย:** [ฉบับภาษาไทย](../th/guides/configure-ai.md)

**Outcome.** You can choose an AI provider, run on OpenRouter, and change prompts the way the platform expects.

## Everything routes through `AiService`

`packages/shared/src/ai/` is the abstraction. Modules never import `@google/genai` or `@anthropic-ai/sdk` directly. Provider selection is `AI_PROVIDER`:

| Value | Status |
|---|---|
| `google` | Gemini — the default, and what the programme pipeline is tuned for |
| `anthropic` | Claude — **required for the AI Analyst module**, which uses native tool-use |
| `stub` | Deterministic placeholders; works with no API key. Useful for local development |
| `openrouter` | Any model through OpenRouter's OpenAI-compatible API. Embeddings and transient-error fallback go to Google when `GOOGLE_AI_API_KEY` is set; without a Google key, embeddings use `AI_OPENROUTER_EMBEDDING_MODEL` (a 1536-dimension model such as `openai/text-embedding-3-small`). See [Running on OpenRouter](#running-on-openrouter) before digesting long PDFs |
| `intelsphere` | Stub that throws at call time — deliberately loud, not silent fallback |

Gemini has embeddings and Claude does not, so when `AI_PROVIDER=anthropic` the factory transparently delegates `embed()` to Google. Set both keys if you use Claude. With `openrouter`, a Google key is optional: without one, `embed()` goes to the OpenRouter model named in `AI_OPENROUTER_EMBEDDING_MODEL`. Choose one embedding model per database and keep it; vectors from two models cannot be compared, so a switch means re-embedding everything.

## Running on OpenRouter

OpenRouter works, but a whole-curriculum digest of a long PDF hits four problems, which show up one after another. The full table, with settings, is in [AI governance](../ai-governance.md#running-on-openrouter). In short:

1. **The request times out after 2 minutes.** Set `AI_OPENROUTER_TIMEOUT_MS=600000`.
2. **The Google fallback then fails with 429 `RESOURCE_EXHAUSTED`.** A 300-page curriculum is about 360k input tokens, and a free-tier Google key allows 250k a minute. Fix the timeout rather than relying on the fallback.
3. **"no json found" with an empty answer.** A reasoning model spent the whole output budget thinking. Structured extraction now asks OpenRouter for minimal reasoning, which fixed it on `z-ai/glm-5.3` (73 s, USD 0.08 for the digest).
4. **HTTP 402 "You requested up to 50000 tokens, but can only afford …".** OpenRouter checks your balance against the *requested* output cap, not actual use. Top up; the digest and `skills:normalise` both request 50,000.

## Prompts are versioned code

`packages/shared/src/ai/prompts/` holds 30-odd prompt modules. Each exports a version constant, a Zod output schema, and a message builder. The rule is absolute: **behaviour change means a new version; never edit a published version in place.** `AiExtraction.methodVersion` records which version produced each row, so old outputs stay distinguishable and re-runs are auditable.

Every prompt must conform to `docs/prompt-standard.md`, adopted 2026-08-16 and **enforced by a ratchet test** at `packages/shared/test/prompt-standard-conformance.test.ts` (files not yet rewritten sit on an explicit allowlist, which only shrinks). The standard's key rules:

- **All free-text analysis output is English-only.** This reversed an earlier Thai-primary strategy. Thai survives only on a finalised exemption list — `recruitmentSummaryTh` in `program-digest` (it is marketing copy, not analysis), `nameTh`-class extraction fields, and the whole of `evaluation-question-translate`.
- **Grounding:** numbers in the output must be traceable to the input snapshot handed to the model in that call. Never a number the model "knows" about your university or Thai higher education generally.
- **Missing input is never guessed** — render "data not available" or an explicit `null`, never a plausible-sounding placeholder and never zero standing in for unknown.

## Governance

`@AiCall()` on every AI-invoking endpoint writes an `AiInference` row. `@AuditLog()` on every mutation writes an `AuditLog` row. Both decorators are in `apps/api/src/common/decorators.ts`. Cost is tracked per call (`AiInference.costEstimateUsd`) and there is a per-user daily USD quota guard (`AiQuotaGuard`), configurable via `AI_QUOTA_*_USD`, that fails *open* on database error — quotas are governance, not security.

There is a 25-question gold-set evaluation suite (`pnpm ai:eval`) and an accuracy harness (`pnpm ai:eval-accuracy`) with labels under `gold-labels/`. Read `docs/ai-governance.md` for the full policy, including the model-fallback rule (transient errors only — 429/5xx/timeout; deterministic failures re-throw) and the output scrubber that redacts Thai citizen IDs, phone numbers, and non-institutional emails from model responses.

## Next step

Continue with [Rebrand the platform](./rebrand.md).
