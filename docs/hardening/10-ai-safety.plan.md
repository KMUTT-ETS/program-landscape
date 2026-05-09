# Plan — Prompt 10: AI safety + prompt injection guardrails

**Mode:** code change. Targeted to gaps in the existing AI-safety stack.

## What's already in place (from prompt 11 + prompt 06)

- **Rule-based safety gate** at `packages/shared/src/analyst/safety.ts` — 19 unit tests, refuses 5 categories: personal info, salary/performance, prompt injection, external-content, decision commitment.
- **`sanitizeAiOutput()`** in the same file — scrubs Thai citizen IDs, phones, non-KKU emails from model RESPONSES.
- **`AiInference` table** logs every model call with caller userId, module, kind, prompt, response, tokens, model, cost, latency, confidence. `@AiCall()` decorator + `PrismaAiInferenceRecorder`.
- **Tool-use** (Anthropic-only, prompt 11) via `AiService.completeWithTools()`. 12 Zod-typed tools wrapping prompt 05–10 helpers.
- **System prompt** at `packages/shared/src/analyst/tools.ts` — versioned `analyst-system.v1`, encodes role + safety + language-mirror.
- **Output schema validation** — `parseStructured()` on Gemini, tool-use Zod schemas on Anthropic.
- **Pino redaction** (prompt 06) keeps PII out of operational logs.

## What this prompt adds

| Scope item | Status | Action |
|---|---|---|
| 1. System-prompt isolation w/ `<USER_DOC>` delimiter | partially in place (system prompt is clear, but user content isn't delimited) | Add `wrapUserContent()` helper; apply on Analyst chat (untrusted user input) + AI summarisers that read PDF text. |
| 2. Output-format constraints (strict JSON schema) | already done | Verify; document; no code change. |
| 3. Tool-use scope authz | **missing** | Pass `caller: SessionUser` into tool executor; each tool clamps `scope` / `scopeId` to caller's actual scope **server-side**, ignoring whatever the model passed. |
| 4. No raw-PII in prompts | **missing the input side** | Build `scrubAiInput()` mirror of `sanitizeAiOutput`. Wire as the first call inside `AiService.complete*()` providers. |
| 5. Prompt-injection canary tests | **missing** | Vitest suite with mocked provider; feeds malicious doc; asserts safety gate fires + no tool calls happen. |
| 6. Audit log → `ai_audit` table | already in place via `AiInference` (prompt 04) | Verify columns match the prompt's required set. Document. |

## Approach

1. Build `scrubAiInput()` in `@kku/shared/analyst/safety.ts`. Same regex set as the output scrubber but applied to the OUTBOUND prompt body. Returns `{ scrubbed, didScrub, categories[] }` so the audit log can record what was redacted.
2. Wire `scrubAiInput` into the two real providers (`GoogleAiService`, `AnthropicAiService`) at the entry of every `complete*()` method. Cheap; runs before the network call; never modifies the system prompt (which is server-controlled).
3. Add `wrapUserContent(text)` helper that returns `<USER_DOC>\n${text}\n</USER_DOC>` (with internal occurrences escaped). Apply on Analyst chat where the user's text is interpolated into a prompt.
4. Update the Analyst tool executor to take `caller: SessionUser` and clamp the scope arguments inside each tool — refuse cross-scope queries server-side.
5. Add canary tests under `packages/shared/test/ai-injection-canary.test.ts` — pre-call interceptor verifies no PII leaks; post-call asserts blocked outputs.
6. Audit `AiInference` columns — confirm they cover {userId, role, provider, model, prompt-hash, tool calls, latency, USD}.

## Out of scope

- Replacing the rule-based safety gate with an ML classifier (deferred per security-review.md §13).
- Multi-stage moderation (vendor moderation API → our gate → user reply). Single-stage is what we have.
- Redacting raw text inside system prompts (system prompts are server-controlled — no PII enters them).
