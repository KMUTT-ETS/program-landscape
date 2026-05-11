# Verdict Stability Methodology — `verdict-stability.v1`

> **Owner:** KKU Data Office · **First shipped:** 2026-05-11
>
> Closes evaluation-pipeline.md §13 gap #6 — verdict back-test loop.

## Purpose

Detect when a program's verdict (Health Score band, Lifecycle Verdict, or Risk Tier) moves between two points in time. Surfaces "the formula didn't change but the program did" as an analyst worklist, distinct from "the formula changed" which is caught by the methodology-bundle fingerprint at the same time.

Three things this answers per program over a window:

1. **Did the lifecycle verdict or risk tier flip?** Strongest signal — Council should know.
2. **Did overall health cross a band boundary (40 / 65)?** Early warning even without a lifecycle flip.
3. **Did a driver move ≥20 pts (Health) / ≥10 pts (Lifecycle trajectory) / ≥15 pts (Risk composite) without flipping anything?** Band-edge instability — the program is about to flip.

Programs whose drivers are unchanged are reported as STABLE and (by default) hidden from the worklist.

## The loop

```
   ┌─ pnpm verdicts:snapshot ─┐         ┌─ pnpm verdicts:snapshot ─┐
   │  one row per canonical    │   …    │  one row per canonical    │
   │  program; bundle stamped  │ time   │  program; bundle stamped  │
   └──────────────┬────────────┘        └──────────────┬────────────┘
                  │                                    │
                  └─────────────┐    ┌─────────────────┘
                                ▼    ▼
                       ┌─ pnpm verdicts:diff ─┐
                       │  compare two snapshots │
                       │  per-program bucket:   │
                       │   - FLIPPED            │
                       │   - HEALTH_BAND        │
                       │   - BAND_EDGE          │
                       │   - STABLE             │
                       └────────────────────────┘
```

## Schema

```
VerdictSnapshot (verdict_snapshots)
  id, programId, snapshotAt
  bundleTag, bundleFingerprint     ← methodology stamp at snapshot time
  healthOverall, healthAttractiveness, healthFinancial,
    healthCapability, healthOutcomes, healthRelevance,
    healthCompletenessPct
  lifecycleVerdict, lifecycleTrajectory
  riskTier, riskComposite, riskL1, riskL2, riskL3
  payloadJson                       ← full per-axis structures, JSONB
```

Index on `(programId, snapshotAt DESC)` for fast "latest snapshot per program" queries; index on `snapshotAt DESC` for the diff's "two latest distinct timestamps" lookup; index on `bundleFingerprint` so methodology-drift queries are cheap.

Append-only — multiple rows per program over time. Different from `ProgramLifecycleSnapshot`, which is a write-through cache, one row per program, latest-state-only.

## Workflow

### Cadence

Quarterly. Run `pnpm verdicts:snapshot` at:

- The end of every quarter (a calendar event on the analyst's schedule).
- Right before a Council quarterly review (so the brief reflects current state).
- Whenever a major methodology bump lands (so the next diff has a clean "before" baseline at the new methodology).

A BullMQ cron registration is a small follow-up — see "Deferred" below.

### Per-snapshot script

```bash
pnpm verdicts:snapshot                # all canonical programs
pnpm verdicts:snapshot --limit 10     # smoke test
pnpm verdicts:snapshot --program <code-or-id>
```

For each program:
- Health Score is re-computed (cheap + deterministic).
- Lifecycle Verdict is re-computed.
- Risk Score is read from the latest `RiskAssessment` row (analyst-triggered cadence; no re-run here).
- Bundle stamp comes from `LANDSCAPE_METHODOLOGY_BUNDLE`.
- One `VerdictSnapshot` row is written.

A typical run on 297 canonical programs takes 1–2 minutes (most of it Health Score re-compute, which fans out to 297 individual computeHealthScores calls).

### Diff script

```bash
pnpm verdicts:diff                       # latest two distinct snapshot timestamps
pnpm verdicts:diff --from <iso> --to <iso>
pnpm verdicts:diff --since 90            # latest vs ~90 days ago
pnpm verdicts:diff --bucket FLIPPED      # only print one bucket
```

Reads two snapshot timestamps' worth of rows + classifies each program into one of four buckets. Prints the worklist to stdout, hiding STABLE by default.

Methodology drift banner: if the two snapshots have different `bundleFingerprint`, the diff prints a prominent warning that deltas may reflect the formula change rather than real movement. Analyst then judges per-program whether the change is structural or methodological.

## Classification rules

| Bucket | Trigger |
|---|---|
| `FLIPPED` | `lifecycleVerdict` changed (e.g., `RISING` → `STABLE`) OR `riskTier` changed (e.g., `MODERATE` → `HIGH`) |
| `HEALTH_BAND` | `healthOverall` crossed the 40 boundary (danger ↔ attention) or the 65 boundary (attention ↔ healthy) AND `FLIPPED` did not trigger |
| `BAND_EDGE` | Any single Health dimension delta ≥ 20 pts OR `lifecycleTrajectory` delta ≥ 10 pts OR `riskComposite` delta ≥ 15 pts AND neither `FLIPPED` nor `HEALTH_BAND` triggered |
| `STABLE` | None of the above |

Thresholds are calibration choices; revise as the snapshot history grows + actual movement distributions become observable.

## Limitations

- **No SLA on data freshness inside the snapshot.** A snapshot taken right after a long kku-finance run will reflect a different Financial dimension than one taken before. Operators should run snapshots at consistent moments (e.g., always after the weekly ingestion cron settles).
- **Programs without RiskAssessment rows show NULL risk fields.** Risk is BACHELOR-only by design; non-BACHELOR programs intentionally carry NULL in the risk columns.
- **The methodology-drift banner is a warning, not an automatic re-baseline.** When a bundle bump happens, the right move is usually to take a fresh snapshot at the new bundle and use it as the new "from" baseline for the next diff.
- **STABLE programs are hidden by default.** Use `--bucket STABLE` to include them when you specifically want a full audit.
- **No persistence of the diff itself.** Each `pnpm verdicts:diff` run is read-only stdout output. A future enhancement is a `VerdictDiff` table that captures the worklist for historical auditability.

## Deferred

- **BullMQ quarterly cron registration** — currently the script runs by analyst invocation. Add a 2-line scheduler entry once the cadence is comfortable.
- **`/admin/verdict-stability` UI** — table view of recent diffs, drill-down per program. CLI is sufficient for v0.
- **Risk re-compute at snapshot time** — current snapshot reads the latest persisted `RiskAssessment`. For audit consistency, the snapshot could re-compute risk too. Deferred because RiskAssessment is comparatively expensive and the analyst-driven cadence is already meaningful.
- **Persisted `VerdictDiff` table** so historical worklists are queryable without re-running the diff.

## Version history

| Version | Date | Change |
|---|---|---|
| `verdict-stability.v1` | 2026-05-11 | Initial release. Schema, snapshot writer, diff classifier (4 buckets), CLI worklist. Bundle stamping for methodology drift detection. |
