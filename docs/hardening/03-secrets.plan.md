# Plan — Prompt 03: Secret & credential exposure audit

**Mode:** read-only audit + scan. **No** rotation, **no** history rewrite.

## Inputs

- Full repo at HEAD + `git log --all`.
- `.env.prod.example`, `.env.example`, all `.env*` candidates.
- `scripts/` (deploy, build-release, link-env, etc.).
- `apps/web/.next/` if present (for client-bundle leak scan).
- `apps/api/src/common/exception.filter.ts` + `response.interceptor.ts` (error-response shape).
- `docs/production-infrastructure.md` § Required `.env.prod` keys (cross-reference).

## Tools (in priority order)

1. **`gitleaks detect`** — if installed in PATH.
2. **Regex pass** — fallback. Patterns:
   - Anthropic: `sk-ant-api[0-9]{2}-[A-Za-z0-9_\-]{95,}`
   - Google AI: `AIza[0-9A-Za-z_\-]{35}`
   - OpenAI / generic `sk-...`: `sk-[A-Za-z0-9]{32,}`
   - Elsevier (Scopus): API-key headers + `:apikey:`
   - AWS access key: `AKIA[0-9A-Z]{16}` + secret-key `[A-Za-z0-9/+=]{40}`
   - Postgres URL: `postgres(?:ql)?://[^/\s]+:[^@\s]+@[^/\s]+`
   - MSSQL/MySQL/Oracle conn strings: `Server=...Password=...`
   - JWT: `eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+`
   - JWT-ish 64-hex (`NEXTAUTH_SECRET`-shape): `[a-f0-9]{64,}`
   - KKU internal IP + credential: `(?:10\.(?:101|130)\.[0-9.]+|10\.130\.2\.151).*?(?:password|passwd|pwd)\s*=`
   - `BEGIN.*PRIVATE KEY`
3. **`git rev-list --all --objects` + `git grep` on every commit** — to catch historical leaks not in HEAD.
4. **Build inspection** — if `apps/web/.next/static` exists, grep static JS for secret-shaped strings AND env-var patterns. If not present, recommend a build step but don't run it (read-only constraint).
5. **`git ls-files`** to confirm `.env.prod` and `.env*` (non-`.example`) aren't tracked.

## Sections in the report

1. Methodology + scope.
2. **HEAD findings** — per-finding table (path, line, class, severity, rotation? remediation).
3. **History findings** — separate table; even if removed from HEAD, rotation is mandatory.
4. **Client-bundle leak check** — `.next/static` scan results.
5. **Error-response leakage** — code review of exception filter.
6. **`.env.prod` hygiene** — gitignore + deploy.sh chmod + symlink posture.
7. **Rotation checklist** — operator-actionable.
8. Acceptance criteria.

## Acceptance criteria

- Every finding category in scope addressed (HEAD, history, build, errors, hygiene).
- Tool output reproduced (or sample lines if too large).
- Zero high-severity HEAD findings, OR each remaining one has a remediation step ready to apply.
- Rotation list names every secret class that ever lived in git.

## Out of scope

- Auto-rotating any secret.
- Rewriting git history.
- Modifying `package.json`, lockfile, scripts.
- Performing the actual `chmod 600` or env-file moves on the prod server.
