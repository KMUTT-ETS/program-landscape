# Cross-Scope Consistency Methodology — `cross-scope-consistency.v1`

> **Owner:** KKU Data Office · **First shipped:** 2026-05-12
>
> Closes evaluation-pipeline.md §13 gap #7 — cross-scope consistency divergence is silent.

## Purpose

Health scores are computed independently at each scope level (university → faculty → department → program) from each scope's own materialised view. The methodology doc at `docs/methodologies/health-score.md` §2.3 calls this out:

> A faculty's overall health score is **not** mathematically guaranteed to equal the weighted average of its programs' overall scores. The two are computed independently from the same underlying metrics.

This methodology measures **how much** the two diverge in practice, per faculty, over time. Significant divergence (>10 pts by default) flags the faculty for methodology review — Council readers shouldn't see one number on the cockpit ("Faculty: 72") that contradicts what they'd get if they mentally summed the programs.

## What's measured

For each academic faculty with ≥1 canonical-and-active program:

```
facultyOverall   = computeHealthScores('university')[faculty].overall.score
                   (faculty-scope computation reading the faculty MV)

bottomUpWeighted = Σ(programOverall × programEnrolled)
                   ─────────────────────────────────────
                   Σ(programEnrolled)
                   across canonical+active programs in this faculty
                   whose overall score is non-null.

divergence       = | facultyOverall − bottomUpWeighted |
```

Bottom-up uses **enrolment as the weight** to match the existing rollup rule in `packages/db/src/scope.ts` (outcome-family rollups weight by `enrolled` so a 500-student program moves the rollup more than a 12-student program).

## First measurement (2026-05-12)

The inaugural snapshot run revealed real signal:

```
7 of 24 faculties exceed the 10pt threshold.
Worst: คณะสถาปัตยกรรมศาสตร์ (Architecture) at 17.3 pts.
Bottom-up consistently higher than faculty-scope (every case).
```

This contradicts the prior methodology-doc assertion that "divergence is typically small." The systematic direction (bottom-up > faculty-scope) deserves methodology-team attention — it suggests faculty-scope MV aggregation produces lower scores than program-scope average, which could mean:

1. **Faculty-scope MV smooths out the program-level signal** in a way the bottom-up doesn't capture. The MV reads totals; the bottom-up weights program-level overalls.
2. **Null-dimension handling differs across scopes.** A program with null Outcomes contributes nothing to its bottom-up; a faculty's null Outcomes computation may behave differently.
3. **Thin-data faculties skew more.** Faculties with fewer programs (e.g., Economics with 3) show larger divergence because each program carries more weight.

Investigation is the analyst's call. This methodology just makes the question answerable.

## Schema

```
CrossScopeDivergenceSnapshot (cross_scope_divergence_snapshots)
  facultyId, computedAt
  bundleTag, bundleFingerprint     ← methodology stamp at snapshot time
  facultyOverall                   ← top-down (faculty MV)
  bottomUpWeighted                 ← bottom-up weighted mean of programs
  programCount, programsWithScore, totalEnrolled
  divergence                       ← absolute difference
  exceedsThreshold                 ← divergence > 10 (default)
  payloadJson                      ← per-program contributions for drill-in
```

Append-only history. Indexed on `(facultyId, computedAt DESC)`, `computedAt DESC`, and a partial index on `exceedsThreshold = true` for the worklist query.

## Workflow

### Cadence

Quarterly, alongside `pnpm verdicts:snapshot` (gap #6). The two snapshots together give Council a quarterly "what moved" + "do the numbers cohere" pair of read-outs.

### Script

```bash
pnpm consistency:check                # write snapshot + print report
pnpm consistency:check --no-write     # dry-run, print only
pnpm consistency:check --threshold 15 # custom threshold (default 10)
```

Output: one stdout table row per faculty + a summary. When `--no-write` is omitted, one `CrossScopeDivergenceSnapshot` row per faculty is written at the same `computedAt` timestamp (so a snapshot is comparable across faculties).

### Worklist query

```sql
SELECT faculty_id, faculty_overall, bottom_up_weighted, divergence
FROM cross_scope_divergence_snapshots
WHERE exceeds_threshold = true
  AND computed_at = (SELECT MAX(computed_at) FROM cross_scope_divergence_snapshots)
ORDER BY divergence DESC;
```

Surfaces in `/admin/data-quality` once that page lands (deferred — see below).

## Threshold

Default: **divergence > 10 pts**. A 10pt difference on a 0–100 health score is large enough that a reasonable Council reader would notice the inconsistency if they happened to compare top-down vs bottom-up mentally. Adjust via `--threshold` per-run or by editing the default; threshold changes don't invalidate old snapshots (the `exceedsThreshold` boolean is computed at write time, so historical rows preserve the threshold-of-the-day, while the threshold itself is also stored inside `payloadJson` so analysts can re-bucket later).

## Methodology drift

Each snapshot carries the methodology bundle stamp (`bundleTag` + `bundleFingerprint`). When the bundle fingerprint changes between two snapshots, divergence numbers between the two are not directly comparable — the underlying formula moved. The analyst worklist should compare same-fingerprint runs unless they're specifically asking "did the methodology change shift divergence."

## Limitations

- **The threshold is a calibration choice**, not derived from a statistical model. As more snapshot history accrues, the right threshold may turn out to be higher or lower than 10.
- **Snapshots are point-in-time.** A faculty above-threshold on snapshot day might dip below by the next quarter; the analyst sees the trend by querying snapshot history.
- **Per-program enrolment is the weight.** Other weighting schemes (e.g., FTE, headcount inclusive of older cohorts) would yield different bottom-up numbers. The choice matches `scope.ts`'s existing outcome-family rollups, so this measurement is consistent with the system's own internal aggregation rule.
- **No automatic remediation.** If a faculty flags, the analyst investigates manually. The methodology team decides whether to (a) move to bottom-up by construction, (b) accept divergence and add a Council-surface caveat, or (c) investigate a specific dimension's MV computation.

## Deferred

- **`/admin/data-quality` page** rendering the worklist + per-faculty trend chart. CLI is sufficient for v0.
- **BullMQ quarterly cron registration** — currently the script runs by analyst invocation.
- **Per-dimension divergence** — only overall is measured today. A future v2 could measure each of the 5 dimensions independently so the analyst can see WHICH dimension drives the divergence.

## Version history

| Version | Date | Change |
|---|---|---|
| `cross-scope-consistency.v1` | 2026-05-12 | Initial release. Snapshot schema, CLI report, 10pt default threshold. First measurement revealed 7 of 24 faculties exceed the threshold under `landscape-2026-05.v1+6367046c`. |
