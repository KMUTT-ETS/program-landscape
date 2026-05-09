# Tabletop C — Leaked admin credential

> **Premise.** A KKU IT contractor accidentally committed
> `apps/web/.env` (containing the dev `NEXTAUTH_SECRET` plus
> `KKU_REGISTRY_DB_PASSWORD`) to a public GitHub fork while
> trying to repro a local issue. The leak window is unknown
> but possibly hours. They notify the operator immediately.
>
> **Threat model:** an attacker who got the secret could
> forge JWTs (NEXTAUTH_SECRET) and read the KKU registrar
> database (KKU_REGISTRY_DB_PASSWORD).

---

## Discovery

- **First signal:** contractor self-reports — a friendly path. The hostile path would be
  a GitHub secret-scan webhook OR a third-party security researcher's responsible disclosure.
- **Confirm leak:** check the offending GitHub fork; capture the commit SHA + file diff;
  confirm both secrets were in the leaked file.

## Runbook

| # | Step | Tool / artefact |
|---|---|---|
| 1 | **Treat both secrets as compromised, immediately.** No analysis-paralysis. | — |
| 2 | **Rotate `NEXTAUTH_SECRET` first** (highest-impact: forge any session). | Generate new secret: `openssl rand -base64 32`. Update `/opt/program-landscape/.env.prod` (mode 0600). Restart api + web: `sudo docker compose restart api web`. **Side-effect:** every existing session is invalidated → all users re-sign-in. |
| 3 | **Rotate `KKU_REGISTRY_DB_PASSWORD`.** Coordinate with KKU registrar's DBA (the password is on THEIR Oracle warehouse, not ours). | Email/call KKU registrar's DBA; new password lands in `/opt/program-landscape/.env.prod`. Restart ingestion: `sudo docker compose restart ingestion`. |
| 4 | **Audit-trail review for the leak window.** Did anyone use the old NEXTAUTH_SECRET to forge a session? | `psql … "SELECT * FROM audit_logs WHERE created_at >= '<leak start>' ORDER BY created_at"` filtered by `actor_user_id` for known-internal vs unknown-source IPs. The X-Forwarded-For + IP fields are captured per prompt 13's structured logging. |
| 5 | **DB-side audit:** did the registrar Oracle warehouse log unusual reads during the leak window? Out of scope for our app — KKU registrar's DBA owns this. | DBA-driven query against Oracle's internal audit. |
| 6 | **Rotate any sibling secret in the same `.env`** (defence-in-depth — assume the contractor's machine is also compromised). | Walk `.env.prod.example` row by row; rotate every key that's in the prod `.env.prod`. Document each rotation in a short change record. |
| 7 | **Force-purge the offending git history on the public fork.** | The contractor does this — they own the fork. Recommend `git filter-repo --invert-paths --path apps/web/.env`. Open a GitHub support request to invalidate cached views. (Note: GitHub's secret-scan partner program can't redact arbitrary content — only known partner-secret formats.) |
| 8 | **Update `docs/runbook-secret-rotation.md`** with this incident's timeline + lessons. | Manual edit. |
| 9 | **Post-mortem.** Filed as a `CouncilDecision` note (not a Council decision per se — but the workspace is the long-term audit trail). | `/decisions` workspace, prompt 12. |

## Acceptance — does the existing tooling cover this?

- ✅ Secrets are in `.env.prod` outside the git repo (per prompt 03 audit). The contractor would
  have had to `cp` the prod env onto their dev machine, which is prevented by access controls
  (prod-server SSH ≠ dev-machine login).
- ✅ Audit log captures every mutation including session creation (prompt 13 structured logging
  + audit-log decorator from prompt 02).
- ✅ Restart of api+web invalidates every session (next-auth JWT signed by NEXTAUTH_SECRET — change
  the secret and every existing token fails verification).
- ✅ `docs/runbook-secret-rotation.md` exists (per CLAUDE.md prompt 13).
- ⚠ Prompt 03 documented gitleaks-in-CI as a deferred item — would have caught the contractor's
  PR locally during their own commit/push if they had it set up. Documented but not enforced.

## Gaps surfaced

| # | Gap | Owner | ETA |
|---|---|---|---|
| G1 | gitleaks CI integration (deferred from prompt 03) — this incident is exactly what gitleaks would catch automatically. **HIGH-PRIORITY pre-launch.** | denpong | pre-launch (estimated ½ day to wire `gitleaks/gitleaks-action` into `.github/workflows/pr.yml`). |
| G2 | No automated revocation of all existing sessions (we rely on restarting the api/web containers to invalidate JWTs). Acceptable but slow for a high-pressure rotation. | denpong | post-launch — alternative is a session-invalidation list in Redis. |
| G3 | No central secret-management vault (HashiCorp Vault, etc.) — secrets live in `.env.prod` files on the prod host. A vault would let the rotation be a one-line `vault kv put` instead of editing files + restarting. Documented as an architecture follow-up. | denpong | post-launch infra work. |
| G4 | The leak-window audit (step 4) requires writing the SQL query by hand. A pre-built `/admin/security-audit` page that surfaces "sessions created in the last X hours from non-KKU IP ranges" would speed the triage. | denpong | post-launch security tooling. |
| G5 | Pre-commit hook to refuse `.env*` commits would have caught this on the contractor's machine. Trivial to add. | denpong | pre-launch (5 min) — add to `.husky/` or document in `CONTRIBUTING.md`. |

**Verdict:** **GO with named pre-launch follow-ups.** G1 (gitleaks CI) and G5 (pre-commit hook)
are <1 day combined and address exactly this incident class — both should land before the
production cut. G2-G4 are post-launch infra work.
