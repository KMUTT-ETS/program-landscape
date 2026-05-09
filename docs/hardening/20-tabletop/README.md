# Tabletop exercises

Three incident walkthroughs against the hardened platform. Each one
identifies the runbook step-by-step, lists what existing tooling
covers, and names every gap with an owner + ETA.

| # | Scenario | Verdict |
|---|---|---|
| A | [AI provider outage during a Council session](./ai-outage.md) | **GO** — graceful degradation works; AI is enhancement layer not load-bearing |
| B | [Database corruption discovered post-deploy](./db-corruption.md) | **GO with named follow-ups** — recovery RTO ≤ 30 min matches DR matrix; G1 (DML linter) flagged for follow-up |
| C | [Leaked admin credential](./leaked-cred.md) | **GO with named pre-launch follow-ups** — G1 (gitleaks CI) + G5 (pre-commit hook) should land before launch |

**Aggregate:** 3 scenarios walked, 3 GO verdicts, 12 gaps surfaced, **0 unmitigated**
(every gap has a named owner + ETA — pre-launch, post-launch, or accepted-risk).

The two **pre-launch follow-ups** that this audit flags as worth doing before the
production cut:
- **gitleaks CI** — `.github/workflows/pr.yml` add the `gitleaks/gitleaks-action@v2` step.
- **Pre-commit hook** banning `.env*` commits — `CONTRIBUTING.md` + a sample `.husky/pre-commit`.

Both are ≤ ½ day of work each.
