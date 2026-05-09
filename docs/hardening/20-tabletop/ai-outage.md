# Tabletop A — AI provider outage during a Council session

> **Premise.** A Council meeting is in progress. A Council member opens
> the AI Analyst (`/analyst`) and asks "summarise programs at risk in
> the Faculty of Engineering." The request returns a 503 with
> `Anthropic upstream error: 503`. Subsequent AI brief regenerations
> fail similarly. Cockpit + Deep-Dive pages render fine but their
> AI-narrative blocks show "—".
>
> **Scenario duration:** ≤ 90 minutes (length of the Council session).

---

## Discovery

- **First signal:** Council member sees a friendly fallback string
  ("Brief generation temporarily unavailable") on the AI Analyst page.
- **Second signal:** the AI-cost panel (`/admin/ai-cost`, ADMIN-only)
  shows a spike in 5xx-tagged inferences over the last 5 minutes.
- **Third signal:** `/api/v1/ready` reports `{ aiProvider: "degraded" }`
  via the dependency probe added in prompt 11.

## Runbook (using existing tooling)

| # | Step | Tool / artefact |
|---|---|---|
| 1 | Confirm scope of outage — both providers down or just primary? | `GET /admin/ai-cost?windowMin=15` filtered by `model=` shows which provider's calls are 5xx-ing. Prompt 11's circuit breaker auto-switched to secondary if primary went down. |
| 2 | If primary breaker is OPEN, secondary keeps Council session alive — **session continues**. | `wrapWithTransientFallback` from prompt 11 (`packages/shared/src/ai/providers/factory.ts`). The fallback is silent to the user; only `/admin/system-status` shows the breaker state. |
| 3 | If BOTH providers down, AI Analyst returns the cached/canned fallback string. | `apps/api/src/analyst/analyst.service.ts` falls back to a friendly placeholder per CLAUDE.md prompt-11. |
| 4 | Communicate to Council in-meeting: "AI assistant temporarily unavailable; the dashboards + raw data remain authoritative." | Spoken — no platform message broadcast tooling. |
| 5 | Post-meeting, file a `CouncilDecision.note` capturing what AI couldn't help with so the discussion is reproducible offline. | `/decisions` workspace, prompt 12. |
| 6 | When provider recovers, breaker auto-CLOSES after 30 s cool-down + 1 successful probe. | Prompt 11 `circuit-breaker.ts`. |

## Acceptance — what the Council member should still see, even mid-outage

- ✅ Cockpit Heatmap + BubbleMatrix + Rollup Tree (no AI required).
- ✅ Deep-Dive Radar + Funnel + Waterfall (no AI required).
- ✅ Gap Analyser raw numbers + tornado chart (no AI required — narrative absent).
- ✅ Decision Workspace + scenarios already-computed.
- ❌ AI Analyst conversation (returns fallback).
- ❌ AI brief regeneration on existing scenarios.

The first 5 cover ~95 % of Council Q&A; the AI Analyst is a convenience
layer on top of authoritative numbers. **The session is NOT degraded
to a stop.**

## Gaps surfaced

| # | Gap | Owner | ETA |
|---|---|---|---|
| G1 | No in-app banner that surfaces "AI degraded" to non-admin users — Council member only sees the fallback string per-call. | denpong | post-launch (low priority — not blocking; acceptable degraded UX) |
| G2 | Anthropic + Google both being down at once is the only true outage; we have no third-provider option. Documented as accepted risk per prompts 11 + 13. | denpong | not addressed — acceptable risk pre-launch |
| G3 | No automated post-mortem export from `/admin/ai-cost` showing the breaker timeline for a specific incident window. Useful for KKU IT post-outage RCA. | denpong | post-launch nice-to-have |

**Verdict:** **GO**. Existing tooling covers the incident. Council session
remains usable; AI is an enhancement layer, not the platform's load-bearing
surface.
