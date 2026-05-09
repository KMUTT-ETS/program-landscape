# Plan — Prompt 20: Pre-deploy gate + final readiness audit

**Mode:** code change + operator-doc + Council-grade exec summary. The gates that ship are
machine-checkable; the Council sign-off is a single one-page document.

## Recon

- 19 hardening reports under `docs/hardening/01-19/` (12 audit + 7 active hardening + ops). Each
  has a known structure: `## N. ...` sections + `## Acceptance criteria check` table at the end.
- `docs/readiness-checklist.md` (248 LOC) is the original 12-gate Council-readiness audit from
  prompt 14 scaffold (data-source maturity gates).
- `DEPLOYMENT.md` (386 LOC) is the operator runbook for the pack-and-ship deploy.
- `scripts/deploy.sh` is the prod-side deployer with 11 phases — phase 1 (`Preflight`) checks
  docker / compose / cert / secrets only. No release-readiness gating yet.

## What this prompt actually delivers from the dev machine

| Scope item | Action |
|---|---|
| 1. `scripts/preflight.sh` | NEW. Aggregates 8 objective gates: (a) all 19 hardening reports present, (b) dep audit fresh (`pnpm audit --prod` < 24 h since last passing run; the marker file is `.preflight/deps-audit-ok`), (c) no secrets in HEAD (`scripts/pdpa/scan-secrets.sh` per prompt 03), (d) tests pass (`pnpm test`), (e) no critical TODOs/FIXMEs in security paths, (f) backup verification verdict GREEN for last 7 nights (file timestamps under `/var/lib/program-landscape/`), (g) restore-drill index has an entry within last 30 days, (h) every prompt-NN report's "Acceptance criteria check" table has no row marked **DEFERRED** without an explicit owner + date. Each gate emits PASS/FAIL/WARN; non-zero exit on any FAIL. |
| 2. `deploy.sh` integration | Patch existing phase 1 — call `preflight.sh` first, refuse to proceed unless it passes. `--skip-preflight` env override that AUDITS to `/var/log/program-landscape/preflight-overrides.log` with timestamp + hostname + reason (must be supplied via `OVERRIDE_REASON=...`). |
| 3. `docs/hardening/20-readiness.md` | NEW. One-page exec summary suitable for a University Council IT-subcommittee briefing. Strict structure: TL;DR (3 lines) → Scope of audit → 5-row at-a-glance table (Phase A-F) → Cross-link table (every prompt) → Residual risks with named owner + date → No-go triggers → Council sign-off line. |
| 4. Tabletop exercises | NEW directory `docs/hardening/20-tabletop/` with 3 incident walkthroughs: `(a) ai-outage.md` (AI provider down during Council session), `(b) db-corruption.md` (post-deploy DB corruption discovered), `(c) leaked-cred.md` (admin credential leaked to GitHub). Each: (i) discovery, (ii) runbook step-by-step using existing tooling, (iii) gap analysis (what's missing), (iv) owner + ETA for any gap. |

## Out of scope

- Wiring `preflight.sh` to upload its summary to Slack / email. The exit code is the contract.
- Real Council briefing slide deck — the `20-readiness.md` is Council-readable on its own;
  conversion to a deck is the operator's call.
- Quarterly re-audit cadence automation. Documented as the operator's manual rotation.

## Acceptance criteria

| Criterion | How verified |
|---|---|
| `preflight.sh` runs green on the release candidate | Run on this dev box; expect WARNs (some gates need staging) but no FAILs in source-side checks. Capture output in `docs/hardening/20-readiness.bench/preflight-dev.log`. |
| Final readiness doc reviewed and accepted | Operator sign-off line in `20-readiness.md` with date + signature placeholder. |
| Tabletop reveals zero unmitigated gaps OR every gap has owner + date | Each tabletop file's Gap section pre-populated with at least one flagged gap so the structure is explicit. |
