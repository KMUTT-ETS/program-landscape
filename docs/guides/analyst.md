# Analyst Guide

For the people who keep Program Landscape running: curate data, review AI extractions, tune methodologies, brief executives. Role: `ANALYST` (full write access to program metadata + AI governance).

---

## Daily cadence

**Morning (first 30 min):**
1. `/admin/system-status` — green across the board? Check ingestion failures, data freshness flags.
2. `/admin/pdf-review` — PDFs awaiting classification/extraction review. Clear the queue.
3. `/admin/extraction-review` — AI-extracted rows below the auto-approve threshold. Approve or reject with reason.
4. Check `/inbox` for any signal subscriptions that fired overnight.

**Midday:**
- Respond to executive questions — they're probably asking AI Analyst directly but sometimes they route to you first.
- Run any ad-hoc analysis requested by the Council secretariat.

**End of day:**
- If you created new scenarios or decisions, move them to SHARED so the reviewer has it for morning.
- If you rejected extractions, add notes to the rejection — that text feeds the next prompt-tuning round.

---

## The 8 modules — what to watch

### Cockpit
- **Health score** is a 5-dimension equal-weighted composite with explicit null handling. Documented in `docs/methodologies/health-score.md`. Bump `HEALTH_SCORE_VERSION` when the formula changes — never edit an existing version in place.
- **Data completeness** badge on each program tells you how much of the score is based on real data vs nulls.

### Deep-Dive
- Section 6 "Faculty" is role-gated. Verify on a COUNCIL test user that no individual names/emails/salary leak — the Prisma `select` layer enforces this.
- The "Disagreement" log captures every reviewer who flagged an AI output as wrong. Pull this table monthly to inform prompt tuning.

### Trends Radar
- 23 connectors, all **mocked** until prompt 14. If someone asks "where did this signal come from?" the honest answer today is "seeded sample". Don't pretend otherwise.
- The "dangerZoneCount" metric returns 0 today — cross-join with Gap Analyzer lands in prompt 08 + prompt 14 wiring.

### Gap Analyzer
- Forecasting uses Holt's linear trend (demand) + linear + demographic multiplier (supply). Confidence bands are visual indicators, not coverage guarantees. Don't over-claim.
- Back-testing is manual today — when a `ForecastRun.targetYear` elapses, fill the `actualValue` + `errorPct` field. Prompt 13's nightly cron will automate this.

### Scenario Planner
- Engine is deterministic — same inputs + same seed → bitwise-identical outputs. Reproducibility is the point. Don't add non-deterministic behaviour (Date.now, Math.random, DB calls) into `@kku/shared/scenarios/engine.ts`.
- Monte Carlo N defaults to 100. If a scenario needs 2000+ iterations, run it off-queue and cache the result; don't push the UI through a 20s round-trip.

### Benchmarking
- Peer skill weights aren't exposed on the peer-list API yet (coverage-matrix cells show 0 weight). Flagged in the methodology doc; unblock by enriching `ProgramPeersResponse` when you have the cycles.
- Peer suggestion uses a 3-tier scorer (Jaccard skill-overlap → subject heuristic → embedding cosine once backfilled). Current behaviour is tier 1 or 2; tier 3 waits on prompt 14's peer-program scraper.

### AI Analyst
- 12 tools wrap the `@kku/db` helpers. When you add a new tool, bump `analyst-system.v1` → `v2` in `@kku/shared/analyst/tools.ts` and update the analyst-safety test fixtures.
- Safety gate patterns live in `@kku/shared/analyst/safety.ts` + `@kku/shared/analyst/safety.test.ts`. Any new refusal category needs both a regex pattern and at least 2 test cases (EN + TH).

### Decision Workspace
- When a decision moves to `COUNCIL_REVIEWED`, the system auto-captures a snapshot. That snapshot is **immutable once stored** — this is the record reviewers check against later. If the snapshot needs correction, amend the decision (new version); never edit the snapshot JSON directly.
- Outcome reviews fire at 6mo / 1yr / 3yr. Run `pnpm ai:eval` against the `decision-outcome-*` test cases after any prompt-version bump.

---

## Data curation

### When a PDF arrives
1. Upload via `/upload` with the right source category hint.
2. The intake pipeline classifies + extracts. If the classifier confidence is < 0.7, it lands in PDF review.
3. You approve or correct the classification, then approve or correct the extractions.
4. Approved extractions materialize onto domain tables (Program, CourseSkill, PolicyDocument, etc.) — depending on the extraction type.

### When you need to add a Program
- Use `/admin/programs/from-pdf` — the wizard reads the มคอ.2 PDF, extracts the header via Gemini, pre-fills the form.
- The collision check will flag hard conflicts (duplicate code) and soft conflicts (same name/faculty/level). You can override soft conflicts with reason.

### When you need to correct historical data
- **Never** edit a row that's already on a published Council Pack. Instead:
  1. Create a new row with the corrected value + new methodology version.
  2. Add a `docs/methodologies/<methodology>-v<N>.md` with the diff.
  3. Flag the prior row as `status=SUPERSEDED` (most tables support this).
  4. Note the correction in the next Council Pack's provenance appendix.

---

## AI governance touchpoints

- Model fallback: configured via `AI_PROVIDER=google` + `ANTHROPIC_API_KEY` (or vice versa). On transient errors the service swaps; you see it via `model` column on `AiInference`.
- Output guardrails: every analyst response runs through `@kku/shared/analyst/sanitizeAiOutput()`. Redactions are visible (`[REDACTED: PERSONAL_INFO]`). Audit for overreach quarterly.
- Cost tracking: `/admin/ai-cost` (ADMIN only) or `/admin/extraction-review` (per-module strip).
- Eval suite: `pnpm ai:eval` runs the JSONL gold-standard set. Run after any prompt-version bump. Nightly cron lands in 13b.
- Incident response: see `docs/ai-governance.md` → "Incident response". Tl;dr: flag → freeze module's AI path → root-cause → remediate → disclose.

---

## Maintenance runbook

| Cadence | Task | Tool |
|---|---|---|
| Daily | Clear PDF + extraction review queues | `/admin/pdf-review`, `/admin/extraction-review` |
| Daily | Monitor ingestion failures | `/admin/system-status` ingestion strip |
| Weekly | Review data completeness + freshness | `/admin/data-quality` |
| Weekly | Acknowledge signal subscriptions | `/inbox` |
| Monthly | Audit AI cost per module | `/admin/ai-cost` |
| Monthly | Audit disagreement log per module | `Annotation.kind='disagreement'` query |
| Quarterly | Restore drill (see `docs/backup-dr.md`) | SSH to staging |
| Quarterly | Refresh peer sets in benchmarking | `/benchmarking/peer-sets` |
| Per release | Run AI eval suite | `pnpm ai:eval --fail-if-regressed` |
| Per release | Bump affected methodology versions + doc | `docs/methodologies/` |

---

## FAQ

**Q: The AI gave a recommendation the reviewer disagrees with. What do I do?**
Hit "Disagree" — that writes an Annotation with the inference id. Monthly, pull all disagreements per module. If a pattern emerges, bump the prompt version + rerun the eval suite.

**Q: How do I know the system is fair across faculties?**
Quarterly outcome-disparity audit: pull all CouncilDecision rows by affected faculty, looking for systematic bias in SUNSET / MERGE decisions. Flagged threshold is documented in `docs/ai-governance.md` → "Bias monitoring".

**Q: An extraction ran on a stale model version — do I need to re-run?**
Yes, via bulk-reprocess: `POST /api/v1/pdfs/bulk-reprocess` with the source category. The pipeline skips rows whose latest extraction is on the current method version; only stale rows get re-extracted.

**Q: The Analyst tool returned a 429 — what now?**
You've hit the per-user daily quota (default $10 for analysts). Wait 24h or ask ADMIN to raise via `AI_QUOTA_ANALYST_USD` env. The rate-limit is intentional; AI spend is real money.
