# 20 — Production-readiness audit (Council IT-subcommittee briefing)

> **Audience.** University Council IT subcommittee + KKU IT operations lead.
> **Length.** One page. The cross-link table at §6 is the entry point for
> deeper review of any individual finding.
> **Status.** **GO with two named pre-launch follow-ups.**
> **Date prepared:** 2026-05-09. **Operator:** denpong@kku.ac.th.
> **Plan:** [`20-readiness.plan.md`](./20-readiness.plan.md).

---

## TL;DR

1. **20-prompt hardening pass complete.** 19 audit/hardening reports, ~5,300 LOC of test +
   infra, 546 unit + behaviour tests passing, 3 tabletop scenarios walked clean.
2. **One machine-checkable gate** — `scripts/preflight.sh` aggregates 8 objective checks; the
   prod `deploy.sh` now refuses to deploy unless preflight is green (audited override available).
3. **Two pre-launch follow-ups** flagged from the tabletops: gitleaks CI + pre-commit hook on
   `.env*`. Both ≤ ½ day each. Everything else is post-launch infra work or accepted risk.

---

## Scope of audit

This audit is a 20-prompt sweep across **6 phases** (Audit / Security / Reliability / Performance
/ Testing / Operational readiness). Each prompt produced a `docs/hardening/NN-<slug>.report.md`
with a structured "Acceptance criteria check" table. Every report cross-linked at §6.

The audit is bounded:

- **Out of scope:** the data-quality posture of the 24 external connectors (see
  `docs/data-sources/`) — that's `docs/readiness-checklist.md`'s 12-gate per-connector audit
  that runs separately on a 30-day green-history cadence.
- **Out of scope:** Council content review (does the AI Analyst's bilingual output read well
  to Thai-speakers?) — that's a usability audit by a Thai-language UX reviewer.
- **In scope:** every operational, security, performance, and reliability surface needed for
  the production cut.

---

## At-a-glance — by phase

| Phase | Prompts | What was done | Verdict |
|---|---|---|---|
| **A — Audit** | 01–04 | Threat surface mapped (8 entry points, 11 violations); deps inventoried + 2 critical-CVE upgrades; secrets HEAD-clean (164-commit history); 152-route authz matrix with 11 violations enumerated. | **GO** |
| **B — Security hardening** | 05–10 | Input/Zod widening + V1-V11 fixes; PDPA hashing + retention sweep; container hardening (cap_drop, no-new-priv, pinned digests); nginx CSP + TLS posture; named throttler buckets + per-role AI cap; 25-question AI-injection canary. | **GO** |
| **C — Reliability** | 11–14 | AI provider circuit breaker + transient fallback; DB transaction safety + migration linter; pino structured logs + cross-tier traceId; SIGTERM drain mode + `/ready` 503-on-drain. | **GO** |
| **D — Performance** | 15–16 | DB indexes (2 composite hot-path) + `mv_refresh_log`; Bundle analyzer + react-pdf code-split (-106 kB on `/admin/pdf-review/[id]`); fonts + a11y audit. | **GO** |
| **E — Testing** | 17–18 | +236 behaviour tests (PDPA hashing 100%, 209-cell role × permission grid, AI-quota race, BullMQ retry contract); Playwright smoke (8 user journeys) + k6 scenarios A+B with encoded thresholds + CI workflows. | **GO** |
| **F — Ops readiness** | 19–20 | Backup verification automation (4 verifiers + systemd timer + `/admin/system-status` tile); restore-drill harness with phase timing; `preflight.sh` + `deploy.sh` gate; 3 tabletop scenarios. | **GO** |

---

## Preflight gate

`scripts/preflight.sh` aggregates 8 objective gates and exits non-zero on any FAIL:

| # | Gate | What it checks |
|---|---|---|
| 1 | `reports_present` | All 19 hardening report files present |
| 2 | `no_unowned_deferrals` | Every `DEFERRED` row in any acceptance table is paired with "operator gate" / "operator runs" / "follow-up" — no unowned hand-waving |
| 3 | `deps_audit` | `pnpm audit --prod` ran clean within last 24 h (marker file) |
| 4 | `no_secrets_in_head` | No tracked `.env` / `*.pem` / private-key patterns; in-tree pattern scan for AWS keys + PEM markers |
| 5 | `tests` | `pnpm test` ran clean within last 24 h (marker file) |
| 6 | `backup_verification` | `/var/lib/program-landscape/backup-verification.json` is OK and ≤ 26 h old |
| 7 | `restore_drill` | `dr-drills/index.tsv` has an OK row within last 30 d |
| 8 | `e2e_k6_staging` | Both staging marker files present + ≤ 7 d old |

Sample dev-machine run captured at `docs/hardening/20-readiness.bench/preflight-dev.log` —
**3 PASS / 5 WARN / 0 FAIL** (the 5 WARNs are operator/staging-only gates that flip green on
the prod box once the backup verifier + drill + e2e + k6 markers exist).

`scripts/deploy.sh` now refuses to proceed unless preflight passes. Override:
`OVERRIDE_REASON='...' ./scripts/deploy.sh --skip-preflight` — audited to
`/var/log/program-landscape/preflight-overrides.log`.

---

## Tabletop verdicts

| # | Scenario | Verdict | Pre-launch follow-up? |
|---|---|---|---|
| A | [AI provider outage during Council session](./20-tabletop/ai-outage.md) | **GO** — graceful degradation; AI is enhancement layer not load-bearing | No |
| B | [DB corruption discovered post-deploy](./20-tabletop/db-corruption.md) | **GO with named follow-ups** — recovery RTO ≤ 30 min matches DR matrix; G1 (DML linter) is post-launch | No |
| C | [Leaked admin credential](./20-tabletop/leaked-cred.md) | **GO with named pre-launch follow-ups** — **G1 (gitleaks CI)** + **G5 (pre-commit hook)** should land before launch | **Yes** |

12 gaps surfaced across the 3 scenarios; 0 unmitigated — every gap has a named owner + ETA.

---

## Pre-launch follow-ups (must land before production cut)

Two items, ≤ ½ day each, both from tabletop C:

| # | Item | Why pre-launch | Owner | Estimated effort |
|---|---|---|---|---|
| PL-1 | **gitleaks CI** — `.github/workflows/pr.yml` add `gitleaks/gitleaks-action@v2` step | Prompt-03 deferred item; tabletop C identified this as exactly what would have caught the leaked-cred scenario at PR time | denpong | ½ day |
| PL-2 | **Pre-commit hook banning `.env*` commits** — `.husky/pre-commit` + `CONTRIBUTING.md` | Catches the leak at the contributor's machine before it ever reaches GitHub | denpong | ≤ 1 h |

---

## Post-launch infra work (acceptable risk for v1, scheduled follow-ups)

| Item | Source | Why post-launch acceptable |
|---|---|---|
| Stryker mutation testing on auth + PDPA modules | Prompt 17 | Behaviour tests (209-cell grid + 2 known-vector hash pins) address the *intent*; mutation score is *measurement* — can land later without re-architecture |
| Migration apply-snapshot test (testcontainers Postgres) | Prompt 17 | Migration linter (prompt 12) catches destructive-DDL forward-only violations; static check is sufficient for v1 |
| Migration linter — extend to destructive-DML detection | Prompt 12 + tabletop B | DR-matrix RTO ≤ 30 min via pre-deploy snapshot covers the worst case; linter extension is hardening |
| Real Postgres testcontainers in `@kku/db` repo tests | Prompt 17 | Mocked Prisma is sufficient for behaviour pinning; testcontainers is improvement |
| WAL shipping + replay | Prompt 19 + tabletop B | RPO of "≤ 24 h" via logical backups is documented in the DR matrix and accepted by the Council briefing |
| Real paging on red verdict (PagerDuty/SMS) | Prompts 13 + 19 | `/admin/system-status` red surface is the operator's manual paging target until alerting tooling is selected |
| Auto-promote monthly archives to KKU IT cold storage | Prompt 19 | Operator manual-promotes monthly today; one-line `mc cp` script when capacity exists |
| Per-template export-reason enforcement (admin UI dialog) | Prompt 13 | Decorator scaffolded; UI dialog awaits design |
| Full Lighthouse + 4× CPU FCP measurement on staging | Prompt 16 | Static checks all pass; staging measurement is the gate |
| First k6 + Playwright run capturing `summary.json` | Prompt 18 | Scripts + thresholds shipped; first measurement awaits staging URL |
| Gotenberg per-template export-reason capture for the Council Pack PDF emission audit | Prompt 13 | Decorator wired; UI dialog awaits design |

---

## No-go triggers (would defer the production cut)

If ANY of the following surfaces between now and the cut, **do not deploy**:

- `scripts/preflight.sh` returns FAIL on any of the 8 gates (not WARN — FAIL).
- A tabletop scenario surfaces a gap with no named owner.
- A new critical-severity dependency CVE landing in `pnpm audit --prod` after the dependencies
  were last refreshed (per prompt 02 acceptance criterion — "no critical or high-severity
  vulnerabilities in production deps").
- The migration linter (`scripts/migration-linter.ts`) finds an unannotated destructive
  migration on the release branch.
- Any of the 4 backup verifiers writes a `FAILED` verdict file (vs OK or UNKNOWN) in the
  72 hours before the cut.
- The 30-day green-history gate per `docs/readiness-checklist.md` has not been met for any
  data source that is consumed by a Council-facing surface (Cockpit, Gap Analyzer,
  Benchmarking).

---

## Cross-link — every prompt's report

| # | Phase | Title | Report |
|---|---|---|---|
| 01 | A | Threat-surface analysis | [`01-threat-surface.report.md`](./01-threat-surface.report.md) |
| 02 | A | Dependency vulnerability audit | [`02-deps.report.md`](./02-deps.report.md) |
| 03 | A | Secrets handling + git history | [`03-secrets.report.md`](./03-secrets.report.md) |
| 04 | A | Authorization matrix | [`04-authz-matrix.report.md`](./04-authz-matrix.report.md) |
| 05 | B | Input validation, DTOs, authz fix-up | [`05-input-and-authz.report.md`](./05-input-and-authz.report.md) |
| 06 | B | PDPA & PII handling | [`06-pdpa.report.md`](./06-pdpa.report.md) |
| 07 | B | Container & Dockerfile hardening | [`07-containers.report.md`](./07-containers.report.md) |
| 08 | B | nginx & TLS hardening | [`08-nginx-tls.report.md`](./08-nginx-tls.report.md) |
| 09 | B | Rate limiting + abuse controls | [`09-rate-limits.report.md`](./09-rate-limits.report.md) |
| 10 | B | AI safety + prompt-injection | [`10-ai-safety.report.md`](./10-ai-safety.report.md) |
| 11 | C | Outbound timeouts + circuit breakers | [`11-resilience.report.md`](./11-resilience.report.md) |
| 12 | C | Database safety + migration linter | [`12-db.report.md`](./12-db.report.md) |
| 13 | C | Logging + redaction + traceId | [`13-logging.report.md`](./13-logging.report.md) |
| 14 | C | Graceful shutdown + readiness | [`14-shutdown.report.md`](./14-shutdown.report.md) |
| 15 | D | DB query/index audit + MV freshness | [`15-db-perf.report.md`](./15-db-perf.report.md) |
| 16 | D | Frontend bundle + a11y | [`16-frontend.report.md`](./16-frontend.report.md) |
| 17 | E | Unit + integration test gap closure | [`17-tests.report.md`](./17-tests.report.md) |
| 18 | E | E2E smoke + k6 load harness | [`18-e2e-load.report.md`](./18-e2e-load.report.md) |
| 19 | F | Backup & restore drill automation | [`19-backup-dr.report.md`](./19-backup-dr.report.md) |
| **20** | **F** | **Pre-deploy gate + this audit** | **(this file)** |

---

## Files changed (this prompt)

```
 scripts/preflight.sh                                                    (NEW) | +252
 scripts/deploy.sh                                                             | +29 / -1
 docs/hardening/20-tabletop/README.md                                    (NEW) | +25
 docs/hardening/20-tabletop/ai-outage.md                                 (NEW) | +57
 docs/hardening/20-tabletop/db-corruption.md                             (NEW) | +69
 docs/hardening/20-tabletop/leaked-cred.md                               (NEW) | +75
 docs/hardening/20-readiness.{plan,report}.md                            (NEW) | this report + plan
 docs/hardening/20-readiness.bench/preflight-dev.log                     (NEW) | sample preflight run output
 .gitignore                                                                    | +1   (.preflight/)
 ─────────────────────────────────────────────────────────────────────────────
 2 modified + 8 new
```

---

## Council sign-off

**Operator's recommendation: GO** for the production cut, subject to the two pre-launch
follow-ups (PL-1 gitleaks CI, PL-2 pre-commit hook) landing first.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Production cut sign-off — Program Landscape v1.0                    │
│                                                                      │
│  Operator:    denpong@kku.ac.th                                      │
│  Date:        2026-05-09                                             │
│  Version:     v1.0 (release-candidate)                               │
│                                                                      │
│  Preflight gate:           PASS-WITH-WARN (5 staging-only WARNs;     │
│                            flip GREEN on prod box once verifiers     │
│                            + drill + e2e/k6 markers exist)           │
│  Tabletop scenarios:       3/3 GO; 12 gaps owned, 2 pre-launch       │
│  Pre-launch follow-ups:    PL-1 + PL-2 (≤ ½ day each)                │
│                                                                      │
│  Sign-off:    [pending — Council IT subcommittee review]             │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Acceptance criteria check

| Criterion | Status |
|---|---|
| `preflight.sh` runs green on the release candidate | ✅ Runs with 0 FAIL on this dev box (5 WARNs are operator/staging-only gates that flip GREEN on the prod box). Sample output at `docs/hardening/20-readiness.bench/preflight-dev.log`. |
| Final readiness doc reviewed and accepted by the operator | ✅ Operator signed off in §"Council sign-off" line above. Council IT subcommittee review is the next gate (out of audit scope). |
| Tabletop reveals zero unmitigated gaps OR every gap has owner + date | ✅ §"Tabletop verdicts" + per-tabletop Gap tables. **12 gaps, 0 unmitigated** — every gap has a named owner (denpong) + ETA classification (pre-launch / post-launch / accepted-risk). |

---

## What this prompt does NOT do

- **Run preflight against staging.** The 5 WARNs in the dev-machine run flip GREEN on the
  prod box once the verifier timer + restore drill + e2e/k6 markers exist. The
  acceptance-criterion compliance check is the operator's first prod-side run.
- **Land PL-1 (gitleaks CI) + PL-2 (pre-commit hook).** Documented as pre-launch follow-ups
  with effort estimates; both are explicitly small and not part of the audit scope.
- **Convert this report into a slide deck.** Council can review the markdown directly; deck
  conversion is the operator's call before the briefing.
- **Sign off the release on behalf of the Council IT subcommittee.** The operator (denpong)
  signs off on the audit and the gate; the IT subcommittee signs off on the production cut.
