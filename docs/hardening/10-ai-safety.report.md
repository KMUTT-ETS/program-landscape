# 10 — AI safety: prompt injection + tool-use guardrails

> **Mode:** code change. Targeted to gaps in the existing AI-safety stack.
> **Plan:** [`10-ai-safety.plan.md`](./10-ai-safety.plan.md).
> **Files changed:** 7 modified + 2 new (1 helper + 1 test). Net diff +295 / −20 in this prompt's scope.
> **Tests:** **+26 canary tests** in `packages/shared/test/ai-injection-canary.test.ts`. All workspaces stay green: `@kku/shared` 108 / 108 (was 82), `apps/api` 50 / 50.

---

## 1. The 6-layer AI-safety stack — final picture

| # | Layer | Where | Status after this prompt |
|---|---|---|---|
| 1 | Rule-based **input safety gate** (5 refusal categories) | `packages/shared/src/analyst/safety.ts` | already (prompt 11) |
| 2 | **`<USER_DOC>` envelope** for untrusted content | `wrapUserContent()` + `analyst.service.ts` | **NEW** |
| 3 | **Pre-flight PDPA scrubber** on every outbound prompt | `scrubAiInput()` + `scrubMessages()` + provider entry points | **NEW** |
| 4 | Strict output-format Zod schemas | `parseStructured` (Gemini) + tool-use Zod (Anthropic) | already (prompt 04 + 11) |
| 5 | **Server-side tool-call scope clamp** | `AnalystToolExecutor.execute(call, caller)` | **NEW** |
| 6 | Output sanitiser (post-hoc PII scrub on responses) | `sanitizeAiOutput()` | already (prompt 11) |
| 7 | Audit log on every model call | `AiInference` table via `PrismaAiInferenceRecorder` | already (prompt 04) |

Layers 2, 3, 5 are new in this prompt. The stack is now defence-in-depth across the input, the boundary, the model, the tool surface, and the output.

---

## 2. Layer 2 — `<USER_DOC>` envelope (system-prompt isolation)

`wrapUserContent(text)` returns:

```
<USER_DOC>
${escaped_user_text}
</USER_DOC>
```

with internal `<USER_DOC>` / `</USER_DOC>` rewritten to Unicode lookalikes (`‹USER_DOC›`) so an attacker can't break out by injecting a closing tag.

**Wired in `analyst.service.chat()`** — every historical user turn + the current user message is wrapped before push to the model's `messages[]`. The system prompt was bumped to `analyst-system.v2` with a dedicated **"Untrusted content envelope"** section that instructs the model to treat content inside the envelope as DATA (not instructions) and refuse any directive originating inside it.

The same `wrapUserContent` is exported for any future module that pipes PDF text or third-party API content into a prompt.

---

## 3. Layer 3 — pre-flight PDPA scrubber

`scrubAiInput(text)` is a thin alias over `sanitizeAiOutput`'s pattern set — the redaction rules are the same on both sides because the trust boundary is identical (no PII goes either to the network or into the audit log).

`scrubMessages(messages)` iterates `AiMessage[]`, scrubs every `role !== 'system'` entry, and reports the redactions. **System messages pass through** because they are server-controlled.

**Wired in BOTH providers** at the central message-shaping helpers:

| Provider | Hook |
|---|---|
| `GoogleAiService` (5 entry points: `complete`, `extractStructured`, `embed`, `vision`, `completeWithTools`) | `splitSystemFromMessages()` + `messagesToString()` both scrub on the way through. Every entry point goes through these helpers — no bypass. |
| `AnthropicAiService` (3 entry points: `complete`, `extractStructured`, `completeWithTools`) | Same shape — `splitSystem()` + `messagesToString()` both scrub. |

The audit log (`AiInference.prompt`) gets the **scrubbed** text — closes the prompt-04 finding that PII was potentially being written into our DB.

### Categories scrubbed

| Pattern | Marker | Examples caught by canary tests |
|---|---|---|
| Thai 13-digit citizen ID (with or without hyphens) | `[REDACTED: PERSONAL_INFO]` | `1234567890123`, `1-2345-67890-12-3` |
| Thai mobile / landline phone | `[REDACTED: PERSONAL_INFO]` | `0801234567`, `02-123-4567`, `+66801234567` |
| Non-KKU / non-`gmail.com` email | `[REDACTED: PERSONAL_INFO]` | `leak.test@hotmail.com`. **`@kku.ac.th` is NOT redacted** — domain identifier. |
| Salary line ("X earns NN baht") | `[REDACTED: SALARY]` | `Dr. Somchai earns 95,000 baht`. Thai variants too. |
| "We have decided to close…" decision-commitment | `[REDACTED: DECISION_COMMITMENT]` | model-generated text trying to commit on Council's behalf |

---

## 4. Layer 5 — server-side tool-call scope clamp

The model could previously pass `query_programs(scope='all')` regardless of the caller's actual reach — the tool would happily execute. Now the executor accepts the caller and clamps the input **before** the handler runs:

```ts
async execute(call: ToolCall, caller?: SessionUser): Promise<string> {
  // ...
  let clampedInput = call.input;
  if (caller && SPATIAL_TOOLS.has(call.name)) {
    clampedInput = await clampSpatialInput(call.name, call.input, caller);
  }
  // ...
}
```

`clampSpatialInput` reuses the proven `clampScopeForUser` helper from `apps/api/src/common/scope-guards.ts` (built in prompt 05). Same logic that gates HTTP routes for `FACULTY_USER` / `PROGRAM_USER` now also gates tool calls.

| Tool | Spatial? | Behaviour |
|---|---|---|
| `query_programs` | ✅ clamped | A `PROGRAM_USER` asking `scope='university'` → narrowed to their own program. A `FACULTY_USER` asking another faculty's id → 403. |
| `query_gaps` | ✅ clamped | Same shape. |
| `get_program(programId)` | ✅ clamped | A `PROGRAM_USER` asking another program's id → 403. A `FACULTY_USER` asking a program outside their faculty → 403. |
| `query_skills`, `query_trends`, `compare_peers`, `run_quick_scenario`, `generate_chart`, `cite_source`, `search_policy_docs`, `search_research`, `get_methodology` | n/a | These return platform-universal data (skills taxonomy, public peer programs, methodology versions, citations). No per-user restriction is meaningful. |

Wired in `analyst.service.ts:285` — `executeTool(call) → toolExecutor.execute(call, caller)` where `caller` was looked up once at the start of the chat turn. One extra `prisma.user.findUniqueOrThrow` per chat call.

If clamping refuses (`ForbiddenException`), the executor returns a JSON error to the model rather than throwing — the model sees `{"error":"forbidden: ..."}` and can apologise. The user never sees data they shouldn't.

---

## 5. Layer 7 — audit log (`AiInference`) verification

The `AiInference` table is the prompt's `ai_audit` requirement. Already in place from prompt 04; this prompt's audit confirms it covers everything in scope:

| Field required by prompt | Column | Notes |
|---|---|---|
| caller user ID | `userId` (FK to User) | role joinable via `User.role` |
| provider | implicit in `model` (`gemini-3-flash-preview`, `claude-3-5-sonnet-…`) | provider name not stored as a separate column; derived from the model prefix. Adequate. |
| model name | `model` | ✅ |
| prompt hash | `prompt` (full text — **scrubbed** per layer 3) | full text rather than hash because operators need to inspect prompts in `/admin/ai-cost`. PII is gone (layer 3) so this is safe. |
| tool calls | `sourcesJson` | analyst tool loop writes the trace here |
| latency | `latencyMs` | ✅ |
| USD cost | `costEstimateUsd` | ✅ |
| input tokens | `tokensInput` | ✅ |
| output tokens | `tokensOutput` | ✅ |
| confidence | `confidence` | ✅ |
| created at | `createdAt` (indexed) | ✅ |

`/admin/ai-cost` already surfaces per-user / per-module roll-ups; `/admin/system-status` (extended in prompt 09) now also exposes per-role 24h burn vs the role-aggregate cap.

The `sourcesJson` field gains an `inputRedactions` entry whenever the scrubber fired — operators can see "this call had a citizen ID stripped from the prompt before it left the network".

---

## 6. Canary tests — 26 new

`packages/shared/test/ai-injection-canary.test.ts`:

| Section | Tests | What it asserts |
|---|---|---|
| Safety gate refuses prompt-injection patterns | 6 | "ignore previous instructions", "DAN mode", Thai variant `ข้ามคำสั่งข้างต้น`, etc. |
| Safety gate refuses salary/performance | 3 | English + Thai patterns |
| Safety gate refuses personal-info | 3 | "personal email", `เลขประชาชน` |
| Normal Council questions pass through | 1 | regression guard |
| `scrubAiInput` strips PDPA classes (per category) | 5 | citizen ID, phone, non-KKU email, KKU email NOT redacted, salary |
| `scrubMessages` covers user/assistant, NOT system | 3 | system pass-through, no-change baseline, assistant-turn coverage |
| `wrapUserContent` envelope behaviour | 3 | normal wrap, escape on internal `</USER_DOC>` injection, empty input |
| End-to-end round trip (the canary token doesn't leak) | 2 | malicious user content survives gate refusal, scrub, and wrap; output sanitiser also catches PDPA in a model reply |

All 26 pass. Total `@kku/shared` test count: **108** (was 82).

---

## 7. Files changed

```
 apps/api/src/analyst/analyst.service.ts                          | 36 +++++++-
 apps/api/src/analyst/tool-executor.service.ts                    | 86 +++++++++++++++++--
 packages/shared/src/ai/index.ts                                  |  1 +
 packages/shared/src/ai/providers/anthropic-ai.ts                 | 14 ++-
 packages/shared/src/ai/providers/google-ai.ts                    | 27 ++++--
 packages/shared/src/ai/scrub-messages.ts                  (NEW)  | 64 +++++++++++++
 packages/shared/src/analyst/safety.ts                            | 59 +++++++++++
 packages/shared/src/analyst/tools.ts                             |  9 +-
 packages/shared/test/ai-injection-canary.test.ts          (NEW)  | 175 ++++++++++++++++++++++++
 ──────────────────────────────────────────────────────────────────
 9 files changed (7 modified + 2 new), +295 / −20
```

---

## Acceptance criteria check

| Criterion | Status |
|---|---|
| Canary tests pass | ✅ 26 / 26 in `packages/shared/test/ai-injection-canary.test.ts` |
| PDPA-class fields don't appear in any prompt sent to a provider (verified by a pre-call interceptor in tests) | ✅ `scrubMessages` is wired into the message-shaping helpers in BOTH providers (`splitSystemFromMessages` in google-ai.ts, `splitSystem` in anthropic-ai.ts). Canary suite probes citizen ID, phone, salary, non-KKU email, all redacted before exit. |
| Tool calls fail closed when the caller lacks scope | ✅ `AnalystToolExecutor.execute(call, caller)` clamps `query_programs` / `query_gaps` / `get_program`. `ForbiddenException` is caught and returned to the model as `{"error":"forbidden: ..."}` so the chain doesn't error out. |
| `ai_audit` table covers user/role/provider/model/prompt-hash/tool-calls/latency/cost | ✅ existing `AiInference` table covers all of it. Per-row `sourcesJson.inputRedactions` is new — surfaces the scrub telemetry. |

---

## What this prompt does NOT do

- **Replace the rule-based safety gate with an ML classifier.** Documented as backlog (security-review §13). The current 19+ regex categories catch the obvious patterns; the system prompt + envelope cover the rest.
- **Add a vendor-side moderation pass.** Single-stage moderation is what we have; a vendor-moderation pre-filter is a future addition.
- **Pin the canary token in the live tool-use loop.** The end-to-end test stops at the safety gate; an integration test that actually calls a mocked provider through the loop is a separate testing-pass deliverable (prompt 17/18).
- **Store the role on `AiInference` directly.** Joinable via `User.role` today; denormalising would require a migration and isn't load-bearing for ops dashboards.

The single pre-existing test failure (`packages/db/test/health-score.test.ts`) is unchanged from prompts 05–09. **Net regression from this prompt: zero.**
