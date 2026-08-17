# Prompt engineering standard

> Status: adopted 2026-08-16. Applies to every prompt file in
> `packages/shared/src/ai/prompts/*.ts`. Conformance is enforced (as a ratchet — files not
> yet rewritten sit on an explicit allowlist) by
> `packages/shared/test/prompt-standard-conformance.test.ts`.

This document is the source of truth for what a prompt in this codebase must do. It was written
during the 2026-08-16 prompt audit (`docs/superpowers/plans/2026-08-16-prompt-standard-audit.md`,
`docs/superpowers/specs/2026-08-16-prompt-standard-audit-design.md`) after discovering that many of
the 29 shipped prompts predate data channels the platform now holds, self-report uncalibrated
confidence, and were never checked against a shared bar for grounding or tone.

Every rule below applies to all 29 prompts (extraction, classification, verdict/assessment,
narrative). The **Per-category addenda** section adds rules specific to each of those four
categories on top of the universal rules.

## Language

All free-text analysis output is **English-only**. This covers narratives, briefs, insights,
verdicts, assessments, recommendations, reasoning, and any other prose field a prompt produces for
a human reader. This reverses CLAUDE.md's prior "Thai primary" analysis-content strategy, effective
2026-08-16; see `CLAUDE.md`'s `## Language strategy` section for the recorded reversal.

Thai output is permitted **only** for fields on this exemption list — membership in the list is the
only justification for Thai output, so no prompt author needs to make a judgement call:

- `recruitmentSummaryTh` in `program-digest` — marketing copy written for Thai prospective students;
  the field is itself the product, not analysis about the product.
- `nameTh`-class extraction fields (program names, course names, skill names, and similar identity
  fields extracted alongside their `nameEn` counterpart) — these are data labels, not analysis.
- The entire output of `evaluation-question-translate` — the prompt's job is Thai↔English
  translation, so Thai text is the expected output, not an exception to English analysis.

This list is **finalised during the audit** (`docs/superpowers/notes/2026-08-16-prompt-audit.md`).
The known candidate beyond the three above, pending the audit's decision: `expertise-narrative.v2`'s
Thai keyword array (feeds the profile UI's Thai keyword chips). Each candidate found during the
audit is either added here with its consuming surface named, or flipped to English — a prompt must
not ship with an unresolved Thai output that isn't on this list.

## Grounding

Four rules, applying to every prompt that reasons over structured input:

1. **Numbers only from the input snapshot.** A number that appears in the output must be traceable
   to the data handed to the model in that call — never computed-then-asserted from outside
   knowledge, and never a number the model "knows" about KKU or Thai higher education generally.
2. **Missing input is never guessed.** When a data channel is absent, the output renders it as
   "data not available" (in narrative prose) or an explicit `null` (in structured fields) — never a
   plausible-sounding guess, never a zero standing in for "unknown."
3. **Causal claims are hypotheses unless the input states the mechanism.** Use "consistent with,"
   "may reflect," or similar hedged language for inferred causation. Do not write "because X" when
   the input only shows X and Y are both true — that is correlation dressed as causation.
4. **World knowledge is permitted only where the prompt's job is external context**, and must be
   marked as context, not asserted as fact about the specific program. Trend analysis and peer
   review are examples of prompts whose job includes external context; most extraction,
   classification, and verdict prompts are not, and must stay inside the input snapshot entirely.

## Confidence rubric

Every prompt that asks the model to self-report a confidence score must ship this exact block
inside its system prompt, so the model grades against defined bands instead of defaulting to a
compliance number:

```
CONFIDENCE RUBRIC (report one number):
  0.90-1.00  every key input channel present and mutually consistent
  0.70-0.89  one material channel missing, or a noted inconsistency
  0.50-0.69  verdict rests on a single channel, or inputs conflict materially
  below 0.50 best effort over sparse input — flag for human review
Grade against the bands. Do not default to 0.95.
```

This replaces every prior bare "confidence: number between 0 and 1" field description. The rubric
existing verbatim in the shipped system prompt is what lets a reviewer audit a reported score
against the stated condition — see finding 2 in the audit's discovery notes (`program-digest`
returned a uniform 0.95 across 228 programs, which is compliance with a field, not measurement).

Callers of narrative/verdict prompts SHOULD enforce the bands with a deterministic ceiling computed
from the input — the self-report is a floor-signal, never trusted upward. See
`narrativeConfidenceCeiling()` / `countMissingNarrativeChannels()` in `program-strategic-narrative.ts`
for the reference implementation, wired into `packages/db/src/program-strategic-narrative-run.ts`.

## Banned AI tells

Humanizing a prompt means removing AI writing tells — it does **not** mean softening the terse,
every-sentence-carries-information register this project deliberately uses; that register stays.

Ban list (greppable, lowercase; check narrative-class output against this list):

- `delve`
- `leverage` (as a verb)
- `robust`
- `landscape` (in its metaphorical sense — "the competitive landscape," not literal geography)
- `tapestry`
- `furthermore`
- `moreover`
- "it is important to note"
- "in today's rapidly evolving"

Plus two structural rules:

- No identical sentence openers across bullets (e.g. every bullet starting "This program...").
- No forced three-item symmetry when the underlying data has two or four items — list exactly what
  the data supports, not a rhetorically round number.

Narrative-class prompts embed this list in their system prompt under a `BANNED PHRASES` header (the
conformance test greps for that header, or the literal phrase "banned AI tells", case-insensitively)
so the model is told directly, not just documented here.

## Versioning

- Version bumps are **major-only** (`v4` → `v5`), bumped on any behaviour change — examples
  rewritten, output shape altered, reasoning rules changed. There is no minor/patch tier.
- Prompts that currently use a different scheme (patch-style versions, or a file/constant name
  mismatch) are **regularised at their next bump** — the standard does not require an immediate
  rename-only commit; audit findings record which prompts are affected.
- **Never** edit an existing published version in place once it has produced `AiInference` or
  `AiExtraction` rows outside dev. The version → row link is what lets the team rerun affected
  extractions deliberately (see `docs/ai-governance.md`).

## Data-channel manifest

Every prompt's input-builder function carries a comment block headed `// CHANNEL MANIFEST` that
lists:

- Every data channel the builder consumes (what it is, and roughly where it comes from).
- Every channel that was deliberately **not** wired in, with the reason (e.g. "courses list — too
  long for this prompt's context budget, digested elsewhere"; "faculty roster — PII posture,
  aggregates already reach this prompt via the capability score").

The manifest exists so that wiring in a newly-available data channel becomes a checklist scan across
these blocks rather than archaeology through call sites. More context is not automatically better —
irrelevant channels dilute a prompt's output — so the "omitted, with reason" half of the manifest is
as load-bearing as the "consumed" half.

## Per-category addenda

These rules sit on top of the universal rules above and apply per prompt category, per
`docs/evaluation-pipeline.md` §6's four-way taxonomy.

### Extraction

- Verbatim evidence quotes are required for any non-obvious extraction (a claim a reader couldn't
  immediately verify by skimming the source).
- `null` over inference — an extractor that isn't sure a field is present must emit `null`, not its
  best guess.
- Units are preserved as printed in the source; unit conversion happens in code, never inside the
  model's output.
- Page/section anchors are included where the source document has them.

### Classification

- Closed-world output only — the model may only emit IDs/labels that were offered in the input, never
  a label it invents.
- An explicit abstain option (`"unmatched"` + a reason) must exist and is always preferable to a
  forced match. A wrong match is worse than an honest "unmatched."

### Verdict / assessment

- Every claim names the input field(s) it rests on.
- A mandatory "data gaps" note is required when data completeness is **below 70%** — the audit may
  record a different threshold for a specific prompt where 70% doesn't fit that prompt's input
  shape, but the default is 70%.
- A "what would change this verdict" line is required, so the reader sees the verdict's sensitivity
  rather than treating it as unconditional.
- Recommendations must be actionable by a university — "monitor the situation" and equivalent
  non-actions are not acceptable recommendations.

### Narrative

- The existing hard rules (no greetings/closings/filler, required structure, length caps) are kept
  verbatim from whatever prior version had them — this standard adds grounding and the tell-ban on
  top, it does not relax structure.
- Numbers are cited with their source channel name whenever the same number could plausibly come
  from more than one channel (e.g. distinguishing a headcount from the cohort table vs. the
  enrollment metric).
