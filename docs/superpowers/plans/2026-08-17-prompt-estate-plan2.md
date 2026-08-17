# Prompt Estate Plan 2 — the remaining 27 prompts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the remaining 27 prompts (14 REWRITE + 13 TOUCH; strategic-narrative already done) to `docs/prompt-standard.md`, phased by regeneration cost so zero-cost work lands immediately and verdict-moving regenerations stay individually gated.

**Architecture:** Every rewrite follows the pattern proven by `strategic-narrative.v2` and `research-expertise`: conformance markers embedded, `extractStructuredWithParseRetry` + `lintBannedTells` + a deterministic confidence ceiling in the runner where one exists, version bump per the policy, ratchet allowlist entry removed. Worklist source of truth: `docs/superpowers/notes/2026-08-16-prompt-audit.md`.

**Tech Stack:** existing plumbing only — no new dependencies.

---

## Phasing by regeneration cost — the organising principle

| phase | prompts | stored corpus? | regeneration cost | when |
|---|---|---|---|---|
| **A** | gap-insights · scenario-insights · benchmarking-insights · expertise-narrative | none / lazy | **zero** — on-demand panels; expertise-narrative shadows lazily by methodVersion | pre-build |
| **B** | the 13 TOUCH prompts | extraction outputs (future runs only) | **zero** — new extractions use the new version; history untouched | pre-build |
| **C** | trend-signal-analysis · trend-document-ingest · external-feed-summary · policy-doc-analysis | stored signals | zero for future signals; optional backfill via `pnpm trends:analyze --all` (gated) | pre-build (code); backfill gated |
| **D** | peer-selection (full) → peer-review → ai-readiness | ~300 rows each, **cascades into lifecycle drivers** | ~$10–20 + verdict drift report | gated, user go/no-go per prompt |
| **E** | risk-assessment · program-pedagogy · decision-review | ~300 / ~300 / few rows | ~$5–10 total | gated |

Phases A–C are safe pre-release. D and E change Council-facing verdicts and MUST each pass a
3-program before/after gate and an explicit user go before bulk regeneration — the same discipline
that caught the narrative's silent-drop bug and research-expertise's count inflation.

---

## Task A1: The three insights panels (audit #7, #8, #9)

**Files:** `packages/shared/src/ai/prompts/{gap,scenario,benchmarking}-insights.ts`, their runners'
call sites (find via `grep -rn "buildGapInsights\|buildScenarioInsights\|buildBenchmarkingInsights"`),
tests per prompt in `packages/shared/test/`, allowlist entries removed.

Per prompt, in this order (one commit each):

- [ ] Rewrite to the standard: English output (all modes), rubric verbatim, tell-ban, channel
  manifest, grounding rules per the narrative category addendum. Bump version (v1 → v2).
- [ ] Audit-noted channel gaps to close while in there: `scenario-insights`' `identify-risks` mode
  must reference existing `RiskAssessment` rows for affected programs; `benchmarking-insights` must
  see graduate outcomes + KMITL demand when arguing curriculum gaps. Wire through the callers the
  same way strategic-narrative did (read the helper shapes first, never guess).
- [ ] These are ON-DEMAND — output goes straight to the UI panel, no stored rows. Wire
  `lintBannedTells` + `extractStructuredWithParseRetry` at the call sites (check whether responses
  are structured or free text per prompt; lint free text, parse-retry structured).
- [ ] Builder tests: markers, English, mode coverage, null-channel labelling.
- [ ] Commit: `feat(ai): <name>-insights v2 — English, grounded, conformant`

## Task A2: expertise-narrative (audit #10)

- [ ] `narrativeTh` paragraph flips to English (`narrative`), keyword array `expertiseKeywordsTh`
  STAYS (exempt — profile chip surface). Bump v2 → v3. Regeneration is lazy by design
  (`user_expertise_narratives` keyed on methodVersion) — confirm that claim against
  `profile-narrative.ts` before relying on it; if it is wrong, STOP and report.
- [ ] Commit: `feat(ai): expertise-narrative v3 — English narrative, exempt Thai keywords`

## Task B: the 13 TOUCH prompts (audit #16–#28)

Mechanical, no input changes: add rubric + `CHANNEL MANIFEST` + tell-ban + explicit English-output
line (Thai data fields per the exemption list stay); flip the Thai-in-practice `reasoning`/`caveats`
fields the audit names (#16, #17, #18, #19, #24); regularise `program-courses-extract`'s `v2.3` to
`v3` at this bump. **No behaviour change beyond language of meta-fields** — if a TOUCH turns out to
need input changes, STOP and reclassify it as a rewrite rather than scope-creeping.

- [ ] Batch in 3–4 commits by category (extraction / classification / translation-utility).
- [ ] Remove each from the ratchet allowlist as it lands. After Task B the allowlist should hold
  ONLY the phase C/D/E prompts (~8 files).
- [ ] Commit prefix: `feat(ai): conform <category> prompts to the standard`

## Task C: trend + policy prompts (audit #11–#14)

- [ ] Same standard treatment; bilingual fields not on the exemption list flip to English;
  `trend-signal-analysis` must ground role-fit claims in the program's own `programSkills` (wire the
  channel; the audit flagged it as relying on model world-knowledge ungrounded).
- [ ] Future signals use the new versions immediately. **Backfill of existing signals**
  (`pnpm trends:analyze --all`) is a separate, gated step — cost it, ask the user.
- [ ] Commit per prompt.

## Task D: the verdict cascade — peer-selection → peer-review → ai-readiness

Order matters: selection feeds review; review feeds readiness gaps; both feed lifecycle drivers.

Per prompt:
- [ ] Full standard rewrite (peer-selection already had the fabrication hotfix — now the markers +
  grounded-vs-recalled distinction the audit demands: **peer-institution claims from training
  knowledge must be marked as context, never presented as measured fact** — this is audit finding
  6's fix and the core of both rewrites).
- [ ] 3-program before/after gate (rich/median/sparse), self-checks scripted, STOP for user review.
- [ ] On explicit go: bulk regeneration + a **lifecycle-drift report** (verdict transition counts
  before/after) presented, not buried.

## Task E: risk-assessment, pedagogy, decision-review

- [ ] `risk-assessment` v3 → v4: fully English (Council risk narrative), add graduate-outcomes +
  trend-signal channels, markers. Gate + regenerate (~300 rows).
- [ ] `program-pedagogy` v1.1 → v2: `narrativeTh` flip (narrativeEn already exists — cheapest
  language fix), markers, cross-reference teaching evaluations channel. Gate + regenerate.
- [ ] `decision-review` v1 → v2: English default, "what would change this verdict" line, markers.
  Few rows; regenerate all on go.

## Done criteria

- [ ] Ratchet allowlist empty — all 28 prompts conformant.
- [ ] No Thai output outside the exemption list anywhere in the estate.
- [ ] Every stored-corpus regeneration was individually gated and reported.
- [ ] Lifecycle-drift report delivered for phase D.
- [ ] `docs/evaluation-pipeline.md` §6 versions updated to match reality after each phase.
