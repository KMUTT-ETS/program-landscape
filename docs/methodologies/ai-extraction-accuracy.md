# AI Extraction Accuracy — `ai-extraction-accuracy.v1`

> **Owner:** KKU Data Office · **Methodology version:** `ai-extraction-accuracy.v1` · **First shipped:** 2026-05-11
>
> Closes evaluation-pipeline.md §13 gap #3 — "AI extraction accuracy is unmeasured."

## What this methodology produces

For every AI extraction prompt template (`program-digest.v1`, `program-peer-review.v2`, `risk-assessment.v2`, etc.) and every method version of that prompt, this methodology produces:

- **Precision** — of the fields the AI emitted, how many match the human-curated ground truth?
- **Recall** — of the fields in the ground truth, how many did the AI emit correctly?
- **F1** — harmonic mean of precision + recall.
- **Threshold curve** — for each confidence cutoff `T ∈ {0.50, 0.60, 0.70, 0.80, 0.85, 0.90, 0.95}`, the mean per-row F1 of rows with `confidence ≥ T`. Used to justify (or reset) `AI_AUTO_APPROVE_THRESHOLD`.

These numbers are not interpretive — they're computed deterministically from `(AiExtraction.payloadJson, AiExtraction.goldLabel)` pairs. The methodology version stamps whatever the formula was on the day the measurement ran.

## Why this exists

Until 2026-05-11 the auto-approve threshold was set to `0.85` by `AI_AUTO_APPROVE_THRESHOLD`. That number was a calibration choice — picked at design time, never measured. With 3 502 `PROPOSED_SKILL` rows queued during the program-digest bulk run, the cost of a mis-calibrated threshold compounds:

- **Too loose** (e.g., 0.7) — false approvals land bad extractions in `ProgramSkill` → drive the Relevance dimension + AI readiness sub-scores → contaminate Council briefs.
- **Too tight** (e.g., 0.95) — analyst review queue overflows; correct extractions sit pending; backfill workstreams stall.

Council-facing analytics carry numerical claims that derive from these extractions; the threshold needs to be a measured number, not a gut feel.

## The measurement loop

The loop has four phases. The first three are tool-supported; the fourth is the analyst's hand-labelling work.

### Phase 1 — Nominate candidates

`pnpm ai:gold-pick [--total N] [--kind X] [--apply]`

Walks the `AiExtraction` table, picks `N` rows (default 50) stratified across `extraction_kind` proportional to volume, with a floor of 5 per kind. Within each kind, samples across the confidence spectrum (low-end, middle, high-end) so the threshold curve has resolution at both extremes. Idempotent — re-running adds new candidates without disturbing already-labelled rows.

Output: flips `is_gold_sample = true` on the selected rows.

### Phase 2 — Hand-label

For each row with `is_gold_sample=true AND gold_label IS NULL`, an analyst:

1. Reads the source artefact (the PDF / course description / job posting / etc. referenced by `source_entity_type` + `source_entity_id`).
2. Writes the *correct* payload shape into `gold_label` — same structure as `payload_json`, but the right values.
3. Sets `gold_labelled_by_user_id` (their own user id) + `gold_labelled_at` (now).

Today this is a SQL operation; a `/admin/ai-accuracy` UI is deferred (the loop is functional via CLI for v0).

Discovery query for the worklist:

```sql
SELECT id, extraction_kind, method_version, source_entity_type, source_entity_id,
       confidence, payload_json
FROM ai_extractions
WHERE is_gold_sample = true AND gold_label IS NULL
ORDER BY extraction_kind, confidence;
```

**Labelling discipline:**

- The label is what a *competent reviewer* would write — not what the AI would. If the AI dropped a field that should have been there, the gold label includes it; the eval treats that as a recall miss.
- For free-text fields (narratives, summaries), strict deep-equal is harsh. Either (a) accept that narratives won't be F1-counted (omit them from the gold-label `keys()`), or (b) write a per-kind comparator in `COMPARATORS` of `ai-eval-accuracy.ts` that uses a softer match (BLEU / cosine / per-keyword).
- Re-labelling a row replaces the previous label. Each row carries one gold label at a time.

**Sample-size guidance:** §13's recommendation is a minimum of 50 across the three most consequential prompts (`PROGRAM_DIGEST`, `COURSE_SKILLS`, `PROGRAM_PEER_REVIEW`). Below 50, the F1 numbers are directional, not statistically firm; the eval runner prints a banner reminding you of this.

### Phase 3 — Measure

`pnpm ai:eval-accuracy [--kind X] [--method Y]`

Reads every `(payloadJson, goldLabel)` pair from rows where `is_gold_sample=true AND gold_label IS NOT NULL`. For each pair:

1. Pick a comparator (per-kind override in `COMPARATORS`, else the generic field-match).
2. Compute `(correct, totalAi, totalGold)` for that row.
3. Roll up to per-`(kind, methodVersion)` micro-averaged precision/recall/F1.
4. For each row, also classify into the threshold buckets (`confidence ≥ T` for T in the threshold list) — gives the threshold curve.

Output: tabular report to stdout. Persistence into a `MeasurementSnapshot` table is a deferred extension; for now, the analyst pastes the report into the methodology doc's "Version history" section at the bottom.

### Phase 4 — Update the threshold

If the threshold curve shows the current `0.85` cutoff isn't doing what the design assumed, change `AI_AUTO_APPROVE_THRESHOLD` in `.env` / `.env.prod`. Best-practice: tune for a precision target (e.g., "auto-approve only if precision ≥ 0.90"), then read the threshold that delivers that precision off the curve.

Then:
- Bump `ai-extraction-accuracy` version in `docs/methodologies/README.md`.
- Add an entry to the version history at the bottom of this doc.
- Re-run `pnpm ai:eval-accuracy` after the next prompt-version bump to confirm the threshold still holds.

## Default comparator — generic field-match

When no per-kind comparator is registered in `COMPARATORS`, the default treats the gold label as a flat record of expected fields. For each top-level key in `goldLabel`:

- **Correct** if `payloadJson[key]` is present AND deeply equal to `goldLabel[key]` (set-equal for arrays of primitives, recursive for objects).
- **Missing** if `payloadJson[key]` is absent → counted as wrong against recall.
- **Spurious** if `payloadJson` has keys not in `goldLabel` → counted as wrong against precision.

```
precision = correct / payloadJson_keys
recall    = correct / goldLabel_keys
F1        = 2 × P × R / (P + R)
```

This is harsh on narrative fields (a single comma difference fails the deep-equal). For prompts where narrative output is the deliverable, either omit narrative keys from the gold label or write a per-kind comparator. See `apps/ingestion/src/scripts/ai-eval-accuracy.ts:COMPARATORS`.

## Confidence-source semantics

`AiExtraction.confidence` is whatever the model self-reported in its structured output, clamped to `[0, 1]`. This methodology measures **how well that self-report correlates with truth**:

- If `mean F1 at threshold ≥ 0.90` is also `0.90+`, the model's confidence is well-calibrated → 0.85 is probably the right cutoff.
- If `mean F1 at threshold ≥ 0.90` is `0.65`, the confidence is over-confident → raise the threshold (e.g., to 0.95) OR retrain the prompt for better calibration.
- If `mean F1 at threshold ≥ 0.50` is already `0.90+`, the model is well-aligned and the threshold could be relaxed (faster throughput, less analyst burden).

The threshold curve is the answer to "what number do we put in `AI_AUTO_APPROVE_THRESHOLD`."

## Schema

`AiExtraction` carries four gold-set fields added by migration `20260511180000_ai_extraction_gold_label`:

```
is_gold_sample           BOOLEAN  DEFAULT false
gold_label               JSONB    NULL
gold_labelled_at         TIMESTAMP NULL
gold_labelled_by_user_id TEXT     NULL  → users(id) ON DELETE SET NULL
```

Plus a partial index on `is_gold_sample = true` to keep gold-set queries fast as the table scales.

## Limitations

- **Generic field-match is strict.** A capitalisation difference in a string field counts as a miss. Per-kind comparators are the remedy; for free-text fields, omit them from the gold label.
- **Self-reported confidence may correlate poorly with truth.** That's the *thing* this methodology measures — if it does, raise the threshold or replace the prompt.
- **No persistence of historical measurements.** Each `pnpm ai:eval-accuracy` run reports current state; the version-history table at the bottom of this doc is the historical record.
- **No per-prompt-version diff view.** When `program-peer-review.v2` becomes `v3`, the eval runner needs both versions' gold labels — but rows are tagged with one `method_version` only. Workaround: hand-label fresh samples after every bump.
- **`/admin/ai-accuracy` UI deferred.** The labelling + eval loop runs via CLI. A first-class admin surface (table view + edit-in-place) lands in a follow-up.
- **No threshold provenance UI.** The displayed threshold (in admin pages that show "auto-approve ≥ 0.85") should cite the measurement that justifies it. Today it cites nothing. Deferred to the same follow-up.

## Version history

| Date | Methodology version | Gold set size | Notes |
|---|---|---|---|
| 2026-05-11 | `ai-extraction-accuracy.v1` | 0 | Loop scaffolded; labelling not yet started. |

Append rows above as the gold set grows + measurements are taken. Format each entry: `YYYY-MM-DD · version · N samples · mean F1 across all kinds + per-kind highlights · what changed in the threshold or prompt as a result`.
