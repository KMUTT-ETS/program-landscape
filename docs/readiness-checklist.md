# Council-Readiness Checklist

Before any output of this system is presented to the University Council —
any chart, any recommendation, any PDF brief — these 12 gates must be
satisfied. Failing a gate is not a warning; it is a block.

The checklist is audited quarterly by the Landscape team lead + the
Office of the President's strategy officer. Gate failures are tracked in
`docs/readiness-checklist-audits/` and reported to the Council chair as
part of the quarterly operations update.

---

## Gate 1 — Provenance on every chart

**Rule.** Every chart, table, and metric surface renders a
`<ProvenanceButton>` that opens a drawer disclosing: data source(s),
freshness timestamp, calculation method + methodology version, known
caveats.

**Audit.** Grep `apps/web/` for chart components without the provenance
wrapper. Target: zero instances.

**Exception policy.** None. Every chart, every time.

---

## Gate 2 — AI outputs carry confidence + sources + disagree

**Rule.** `<ConfidenceBadge>` + clickable source list + "show reasoning"
expander + "disagree" feedback button on every AI-generated narrative,
recommendation, or insight.

**Audit.** Visit each module's AI surface (Cockpit brief, Deep-Dive
narrative, Gap Analyzer strategic-top-5, Scenario Planner devils-advocate,
Benchmarking positioning-brief, Analyst chat). Every one renders the
trio.

**Exception policy.** AI outputs with `confidence = 0` (no-key fallback)
still render the trio; the badge says "insufficient data" and the
reasoning expander explains why.

---

## Gate 3 — Freshness timestamp on every data point

**Rule.** `<FreshnessBadge>` renders next to every metric, showing
"Updated Xh ago" with the exact timestamp on hover. Data older than the
module's tolerance (Cockpit: 24h, Trends: 1h, Deep-Dive: 24h, Gap: 7d,
Benchmarking: 30d) is styled with a warning tint.

**Audit.** Every mocked metric currently renders a freshness that says
"seed data". Real-data flip (prompt 14) replaces seed timestamps with
connector `lastSuccessfulRunAt`.

**Exception policy.** Methodology-computed derived values inherit the
freshness of their oldest input.

---

## Gate 4 — Every mutation is audit-logged

**Rule.** Any HTTP endpoint that writes to the database is annotated
with `@AuditLog()`. The decorator writes `userId`, `action`, `entityType`,
`entityId`, `beforeJson`, `afterJson`, `ipAddress`, `userAgent` to
`AuditLog`.

**Audit.** Grep `apps/api/src/**/*.controller.ts` for
`@Post|@Patch|@Put|@Delete` without `@AuditLog()`. Run quarterly.

**Exception policy.** Idempotent "touch" operations (e.g. `lastUsedAt`
bumping) are exempt by explicit decorator argument.

---

## Gate 5 — Every AI inference is logged

**Rule.** Every LLM call routes through `AiService` and is decorated
with `@AiCall({ module })`. The decorator writes
`AiInference(userId, module, prompt, completion, sourcesJson,
methodVersion, costEstimateUsd, durationMs)`.

**Audit.** Grep for direct `@google/genai` / `@anthropic-ai/sdk`
imports outside `packages/shared/src/ai/providers/`. Target: zero.

**Exception policy.** None. Tool-use iterations each write their own
inference row.

---

## Gate 6 — Every metric carries a methodology version

**Rule.** Every computed metric surface (scores, forecasts, scenario
outputs, benchmarking comparisons) exposes the methodology slug and
version in the provenance drawer.

**Audit.** Every implemented methodology is listed in
`docs/methodologies/README.md`. The `methodologyVersion` field is
populated on every row in every result shape.

**Exception policy.** Raw data displays (enrolment counts, faculty
lists) don't compute anything, so they report the source connector
version instead of a methodology version.

---

## Gate 7 — PDPA compliance on every data surface

**Rule.** Faculty personal identifiers (name, national ID, salary,
performance data) are never exposed outside roles with explicit
permission. Role gating enforced at Prisma `select` layer, not
post-fetch.

**Audit.** `apps/api/test/deep-dive-faculty-visibility.test.ts` covers
COUNCIL-role aggregate-only view. Quarterly: replay test against live
DB with a real COUNCIL user.

**Exception policy.** None. Doc: [`docs/pdpa.md`](./pdpa.md).

---

## Gate 8 — Data export requires reason-string

**Rule.** Every bulk-data-export endpoint is gated by
`@RequireExportReason()`. Exports write to `AuditLog` with the stated
reason. Reasons are quarterly reviewed.

**Audit.** Count of rows in `AuditLog` with `action='DATA_EXPORT'`
per month. Spike → investigation.

**Exception policy.** A signed Council approval in the reason field
is required for any export > 500 rows; the approver reference is
recorded.

---

## Gate 9 — Council-facing numbers have pilot sign-off

**Rule.** Any metric that drives a Council recommendation must have been
piloted on ≥ 5 programs, reconciled with the data owner, and signed off
in the `docs/methodologies/<slug>.md` version history.

**Audit.** Current state: `health-score.v1`, `forecasting.v1`,
`scenario-engine.v1`, `benchmarking.v1` signed off on seed data (pilot
runs pending real connectors). `cost-allocation` is v0 draft — not
yet presentable to Council.

**Exception policy.** A methodology can ship as "indicative only" with
a prominent banner in the UI. Indicative-only numbers are excluded from
the Council Pack PDF.

---

## Gate 10 — Disagreement capture is active

**Rule.** Every AI-generated narrative offers a "disagree" button that
writes an `Annotation` with `kind='disagreement'` + the specific
`aiInferenceId`. Disagreements are reviewed weekly by the analyst on
duty.

**Audit.** Count disagreement annotations per week. Zero is suspicious
(means the UI isn't surfacing the button); > 20 is worth investigating
(something is consistently wrong).

**Exception policy.** None. The feedback loop is the accuracy lever.

---

## Gate 11 — Real-data connectors have a rollback story

**Rule.** Every connector flipped to `real` in `CONNECTOR_<SLUG>_MODE=real`
has:

- a documented per-source spec in `docs/data-sources/<slug>.md`
- an `IngestionRun` history with ≥ 30 days of green runs on staging
- a one-line rollback: flipping the env var back to `mocked` reverts to
  seed data with no data loss
- a monitoring entry in `/admin/data-sources/<slug>/stats` that the
  analyst-on-duty reviews weekly

**Owner-approved exception — `kku-research-services` (2026-10-03).** The
source is the Research Office's own system of record and keeps a cumulative
history, so the length of our sync history says nothing about its reliability.
From `health-score.v5.4` the external-grant award on Financial needs only one
successful sync on the server; there is no 30-day green-history condition.

**Audit.** `docs/data-sources/README.md` lists every connector's mode
and last successful run.

**Exception policy.** None. A real connector with no rollback plan is
a production outage waiting.

---

## Gate 12 — Council Pack PDF is the authoritative output

**Rule.** Every Council-facing claim exists simultaneously in-app (with
interactive provenance) AND as a Council Pack PDF (frozen at export
time). Council members review and vote on the PDF; the in-app view is
the living version for analysts.

**Audit.** Every Council meeting has a corresponding Council Pack PDF
stored in MinIO under `council-packs/YYYY-MM-DD/`. PDF generation goes
through `PdfService` (never in-process puppeteer/react-pdf).

**Exception policy.** None. If a number can't render in the Council Pack
PDF, it can't be a Council input.

---

## Summary matrix

| Gate | Implemented | Tested | Audited |
|---|---|---|---|
| 1. Provenance | ✅ | Manual | Quarterly |
| 2. AI confidence trio | ✅ | Manual | Quarterly |
| 3. Freshness | ✅ (seed) | Manual | Quarterly |
| 4. Audit log | ✅ | Unit | Quarterly grep |
| 5. AI inference log | ✅ | Unit | Quarterly grep |
| 6. Methodology version | ✅ | Unit | Per release |
| 7. PDPA | ✅ | Unit | Quarterly replay |
| 8. Export reason | ✅ | Integration | Monthly |
| 9. Pilot sign-off | Partial — needs real data | Manual | Per methodology bump |
| 10. Disagreement capture | ✅ | Manual | Weekly |
| 11. Connector rollback | Doc-only (real data pending) | N/A | Per flip |
| 12. Council Pack PDF | ✅ | Manual | Per Council meeting |

## What a gate failure triggers

1. **In-app banner** on the affected module: "methodology / connector
   not Council-ready".
2. **Council Pack exclusion** — the affected section renders as "data
   pending review" in the PDF.
3. **Escalation** to the Landscape team lead and, if unresolved within
   2 weeks, to the Office of the President's strategy officer.

## Quarterly audit procedure

1. Run `pnpm check` to confirm tests pass.
2. Run the PDPA visibility test against a real COUNCIL user.
3. Grep `apps/api/src/**/*.controller.ts` for unaudited mutations.
4. Grep `apps/web/` for charts without provenance.
5. Review disagreement annotations since last audit.
6. Review data-export audit-log entries since last audit.
7. Confirm every real-mode connector has a green ingestion history.
8. Write findings to `docs/readiness-checklist-audits/YYYY-QN.md`.
9. Present to Landscape team lead + strategy officer.

This checklist is versioned. Revisions require review by both the
Landscape team lead and the Office of the President's strategy officer.

---

**Version:** v1 · 2026-04-24 · Landscape team
