# LLM prompt estate — standard, audit, and targeted rewrite

> Date: 2026-08-16 · Status: draft for review
> Requested by the user: revisit all LLM instruction prompts; minimize hallucination; humanize;
> wire in the data channels the app has grown since each prompt was written; all analysis output in
> English; surface reliability findings for decision-makers.

## Context

The application has 29 prompt files in `packages/shared/src/ai/prompts/` (the pipeline doc still
says 22 — it has drifted). Many were written before the data estate matured: the platform now holds
graduate outcomes, KMITL/LinkedIn demand matches, trend signals, risk assessments, cohort
distributions, teaching evaluations and a full publications mirror that the older prompts never see.

`docs/evaluation-pipeline.md` §6 groups the prompts into four purposes, which this work keeps as its
unit of analysis:

| category | ~count | exemplars | enhancement axis |
|---|---|---|---|
| Extraction | 9 | `program-digest`, `imd-rankings-extract`, `graduate-employment-survey` | never invent; verbatim evidence; null over guess |
| Classification | 5 | `career-kmitl-mapping`, `skill-name-normaliser`, `program-peer-selection` | closed-world; abstain rather than invent a label |
| Verdict / assessment | 5 | `program-peer-review.v4`, `risk-assessment.v3`, `program-ai-readiness.v4`, `decision-review` | traceable claims; uncertainty; drives lifecycle drivers 5+6 |
| Narrative | 8+ | `program-strategic-narrative.v1`, `gap/scenario/benchmarking-insights`, `expertise-narrative` | grounding + de-robotification; Council-readable |

## Decisions (settled with the user — do not relitigate)

1. **Language.** Analysis output (narratives, briefs, insights, verdicts, assessments) is
   **English-only**. Thai survives **only in enumerated data fields** that are themselves the
   product — `recruitmentSummaryTh` (marketing copy for Thai prospective students), `nameTh`-class
   fields, and `evaluation-question-translate`'s output (whose entire job is Thai↔English).
   This reverses CLAUDE.md's "Thai primary" analysis-content strategy; CLAUDE.md is updated as part
   of this work so the reversal is recorded, not implicit.
   The exemption list is **finalised during the audit** — known candidates beyond the three named:
   `expertise-narrative.v2`'s Thai keyword array (feeds the profile UI's Thai keyword chips). Each
   candidate is either added to the list with its consuming surface named, or flipped to English.
2. **Humanize = remove AI tells only.** The existing terse, no-filler, every-sentence-carries-
   information register is deliberate and stays. No softening, no advisory warmth.
3. **Scope.** Audit all 29 against a written standard; rewrite only where the audit finds material
   gaps; per-prompt regeneration is costed and gated on the user's go/no-go, because bumping a
   verdict prompt regenerates ~300 programs and can move lifecycle verdicts.

## Findings already established during discovery

These motivated the design and belong in the audit's opening summary:

1. **`program-strategic-narrative.v1` has never seen an employment rate.** Its input snapshot
   carries lifecycle/health/AI-readiness/TCAS/financial/demand-funnel/demographic/peer-review — but
   no graduate outcomes, no KMITL demand match, no trend signals, no risk assessment, no cohort
   distribution, no teaching evaluations. A Council brief recommending program actions without
   employment data is the largest single gap found.
2. **Confidence is self-reported, not calibrated.** Schemas ask the model to rate itself;
   `program-digest` returned a uniform 0.95 across 228 programs — compliance with a field, not
   measurement. These numbers surface in `<ConfidenceBadge>` to decision-makers.
3. **Doc drift:** pipeline doc says 22 prompts; there are 29.
4. **Version-convention drift:** `program-courses-extract.v2.3` (patch-style) vs `v4` (major-only);
   `decision-review.ts` exports `outcome-review.v1` (file/constant mismatch).
5. **Zero eval coverage** for pipeline prompts — `pnpm ai:eval`'s 25 gold questions cover the
   analyst chat only. Prompt-quality changes are currently unfalsifiable.

## § 1 — The standard (`docs/prompt-standard.md`)

A short, enforceable document; referenced from `docs/ai-governance.md`. Contents:

### Universal rules (all 29 prompts)

- **English output.** All free-text analysis fields in English. A named exemption list of Thai data
  fields (above) — membership in the list is the only justification for Thai output, so no prompt
  needs a judgement call.
- **Grounding.**
  - Numbers only from the input snapshot; never computed-then-asserted from outside knowledge.
  - Missing input renders as "data not available" (or field-level `null`), never a guess, never a
    zero.
  - Causal claims are hypotheses unless the input states the mechanism: "consistent with", "may
    reflect" — never "because" on inferred causation.
  - World knowledge (sector trends, technology shifts) is permitted only in prompts whose *job* is
    external context (trend analysis, peer review), and must be marked as context, not as fact about
    the program.
- **Confidence rubric** (replaces the bare 0–1 field description everywhere):
  - 0.9+ — all key input channels present and mutually consistent
  - 0.7–0.89 — one material channel missing or an inconsistency noted in the output
  - 0.5–0.69 — verdict rests on a single channel, or inputs conflict materially
  - <0.5 — output is a best effort over sparse input; flagged for human review
  The rubric text ships inside every system prompt so the model grades against defined bands, and
  reviewers can audit the grade against the stated conditions.
- **AI-tell ban**, enforceable by grep: delve, leverage, robust, landscape (metaphorical), tapestry,
  furthermore, moreover, "it is important to note", "in today's rapidly evolving", identical
  sentence openers across bullets, forced three-item symmetry where the data has two or four items.
- **Versioning:** major-only (`v5`), bumped on any behaviour change; the standard documents this and
  the audit regularises stragglers at their next bump (no bump merely to rename).
- **Data-channel manifest:** each prompt's input-builder carries a comment block listing consumed
  channels AND deliberately-omitted ones with reasons. New-channel wiring becomes a checklist scan
  of these blocks rather than archaeology.

### Per-category addenda

- **Extraction:** verbatim evidence quotes for any non-obvious extraction; `null` over inference;
  units preserved as printed (conversion happens in code, not in the model); page/section anchors
  where the source has them.
- **Classification:** closed-world — output only IDs/labels offered in the input; an explicit
  abstain option (`"unmatched"` + reason) which is always preferable to a forced match.
- **Verdict/assessment:** every claim names the input field(s) it rests on; mandatory "data gaps"
  note when data completeness is **below 70%** (the audit may record a different threshold per
  prompt where 70% is wrong for its input shape); one "what would change this verdict" line so
  Council sees the sensitivity; recommendations must be actionable by a university (no "monitor the
  situation").
- **Narrative:** existing hard rules (no greetings/closings/filler, structure, length caps) kept
  verbatim; the tell-ban and grounding rules added; numbers cited with their source channel name
  when ambiguity is possible.

## § 2 — The audit (`docs/superpowers/notes/2026-08-16-prompt-audit.md`)

One reading pass over all 29 files plus their call sites. Per prompt:

| column | content |
|---|---|
| category / version | from the file |
| language posture | Thai-emitting? which fields? exempt or must flip? |
| grounding gaps | vs the universal rules |
| **missing data channels** | cross-checked against what the DB *now* holds and what the callers could cheaply fetch — the deep-dive helpers already assemble most of it |
| AI-tell exposure | narrative-class prompts checked against the ban list |
| verdict | **rewrite / touch / leave** with one-line justification |
| regeneration blast radius | rows affected, downstream consumers (lifecycle drivers, risk, UI), rough API cost |

The audit also: fixes the pipeline doc's 22→29 drift; renames nothing; changes no behaviour. It is
pure reading and costs no API spend.

## § 3 — Rewrite workflow (per prompt, worklist order)

Order: `program-strategic-narrative` (named by the user; worst channel gap) → `program-peer-review`
→ `risk-assessment` → `program-ai-readiness` → insights panels (`gap`/`scenario`/`benchmarking`) →
remaining touches per audit verdicts.

Per prompt:

1. Bump version (major).
2. Rewrite system prompt + builder to the standard; add the channel-manifest block.
3. **Wire missing channels through the caller** — the substantive engineering. For
   strategic-narrative this means its pipeline caller starts fetching graduate outcomes, demand
   match, trend signals, risk summary, cohort distribution; each addition is justified in the
   manifest, not just dumped in (more context ≠ better — irrelevant channels dilute).
4. Builder unit tests (none exist today): assert English instruction present, exempt-Thai fields
   intact, tell-ban present, rubric present, manifest present, snapshot of a built prompt against a
   fixture input.
5. **User go/no-go per regeneration**, with cost estimate. For the big three: before/after outputs
   on 3 real programs (data-rich / middling / sparse) reviewed by the user BEFORE bulk regeneration
   — the same human gate the PDF rebuild used.
6. Regenerate in bulk; downstream verdict drift (lifecycle) is measured and reported, not silently
   absorbed.

## § 4 — Guardrails against re-rot

- Prompt-builder tests as above, in `packages/shared/test/`.
- A tiny standard-conformance test that greps every prompt file for the tell-ban/rubric/manifest
  markers — so a future prompt added without them fails CI, the same pattern as the data-sources
  audit.
- CLAUDE.md language-strategy section updated to record the English reversal.
- `docs/evaluation-pipeline.md` §6 updated to the real 29 with the four-way taxonomy.
- Old `AiInference` rows keep their version stamps; nothing historical is reinterpreted.

## Risks

- **Verdict drift on regeneration.** Peer-review v4→v5 moves lifecycle drivers 5+6; some programs'
  verdicts will change. Mitigation: the before/after 3-program gate, plus a drift report
  (counts by verdict transition) after each bulk run, presented rather than buried.
- **Regeneration cost.** ~300 programs × the rewritten verdict/narrative prompts. Each gated run
  carries an estimate first; nothing bulk-fires without explicit approval.
- **Channel dilution.** Adding every available channel to every prompt would bloat context and
  worsen outputs. The manifest's "omitted because" discipline is the control.
- **English reversal touches product surfaces.** The deep-dive renders `contentMarkdown` directly;
  existing Thai narratives in the DB stay Thai until regenerated — the UI will show mixed languages
  during rollout. Acceptable for dev; the rollout order should regenerate narratives early.

## Deferred (recorded, not in scope)

- True confidence calibration (against a hand-graded gold set) — the rubric is the v1 step.
- Eval suites per pipeline prompt (the slice-of-C beyond the big-three before/after gate).
- The analyst chat system prompt (`analyst-system.v1`) — a separate surface with its own safety
  regime; audit it later with its 19 refusal tests in hand.
- Prompt-output caching/dedup economics.
