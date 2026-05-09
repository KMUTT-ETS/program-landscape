# 03 — Secret & credential exposure audit

> **Mode:** read-only audit. **No** rotation, **no** history rewrite. The web app was built once (`pnpm --filter web build`) so the client-bundle scan had real artefacts to inspect.
> **Plan:** [`03-secrets.plan.md`](./03-secrets.plan.md).
> **Raw artefacts:** [`audit/03-secrets/head-scan.txt`](./audit/03-secrets/head-scan.txt), [`audit/03-secrets/client-bundle.txt`](./audit/03-secrets/client-bundle.txt).

---

## 1. Methodology + scope

`gitleaks` and `trufflehog` are not installed on the dev machine. Fell back to a **regex pass via `git grep`** plus **commit pickaxe via `git log -G`** across the full history (164 commits on `main`). Pattern set:

| Class | Regex |
|---|---|
| Anthropic | `sk-ant-api[0-9]{2}-[A-Za-z0-9_\-]{40,}` |
| Google AI | `AIza[0-9A-Za-z_\-]{35}` |
| OpenAI / generic | `sk-[A-Za-z0-9]{32,}` |
| AWS access key | `AKIA[0-9A-Z]{16}` |
| Postgres URL | `postgres(?:ql)?://[^/\s]+:[^@\s]+@` |
| MySQL / MSSQL conn | `(mysql|mariadb|mssql|sqlserver)://…:…@` |
| JWT | `eyJ[A-Za-z0-9_\-]+\.eyJ…\.…` |
| 64-hex (NEXTAUTH-shape) | `\b[a-f0-9]{64,}\b` |
| Inline `password=` | `(password|passwd|pwd|secret)\s*[:=]\s*\S{8,}` |
| KKU IP + cred coupling | `10\.(101|130)\.[0-9.]+ … password` |
| Slack / GitHub token | `xox[abprs]-…`, `ghp_…`, `ghs_…`, `github_pat_…` |
| Elsevier / Scopus apikey | `(x-elsapi…|elsevier-api|scopus-api).*[a-z0-9]{20,}` |
| Specific env names | `KKU_SCOPUS_API_KEY=`, `KKU_SSO_CLIENT_SECRET=`, `KMITL_SECRET_KEY=` etc. |
| PEM key | `BEGIN .*PRIVATE KEY` |

Coverage:
- **HEAD** — every tracked file, with the `docs/hardening/` directory deliberately excluded so this report's own examples don't false-positive.
- **History** — `git log --all --source -p -G '<pattern>'` for each high-impact pattern, plus a blob-body sweep on every version of `.env*example`.
- **Client bundle** — built once via `pnpm --filter web build` (the build's typecheck stage failed unrelated to secrets, but webpack emitted 146 chunks before the failure — sufficient for the static-asset scan). Grepped `apps/web/.next/static/**` for every pattern above.
- **Error responses** — code-read of `apps/api/src/common/exception.filter.ts` + `response.interceptor.ts`.
- **Hygiene** — `.gitignore`, `scripts/deploy.sh`, `scripts/build-release.ts`, the systemd backup unit.

---

## 2. HEAD findings

| # | Finding | Path:line | Class | Severity | Rotation? | Remediation |
|---|---|---|---|---|---|---|
| H1 | KKU-internal database IP `10.130.2.151` rendered into the **client bundle** as visible UI copy | `apps/web/app/staff/research/client.tsx:435` | KKU internal infra disclosure | **Low** | No (IP is internal to KKU LAN; not exploitable on its own) | Replace the literal `10.130.2.151` in the visible UI string with a non-IP description (e.g. "the internal kku-publications mirror"). The IP can stay in server-side `lib/` files (`apps/web/src/lib/{kku-publications,profile-data,scopus-publications}.ts`) since those are not shipped to the client. |
| — | Postgres URL with placeholder credentials (`kku:kku_dev_password`, `kku_prod:REPLACE_ME_in_secrets_file`, `kku:kku@localhost`) | `.env.example:21`, `.env.prod.example:60`, `.github/workflows/pr.yml:72,77,83`, `DEPLOYMENT.md:239`, `docs/migration-policy.md:60`, `docs/production-infrastructure.md:243` | placeholder | Not a finding | No | None — every value is either `REPLACE_ME`, the `kku_dev_password` local-dev default, the CI-only ephemeral `kku:kku@localhost`, or a documentation placeholder. |
| — | Long 64-hex string in `docs/security-review-audit-2026-04-24.json` | line 329 | not-a-secret | Not a finding | No | The match is the literal `csrfToken=90f5e6f48a…` inside a quoted GHSA-advisory PoC body that was captured by `pnpm audit` output. Not our secret. |
| — | "PASSWORD" / "password" / "secret" tokens in `apps/web/src/lib/auth.ts`, `apps/api/src/common/jwt-auth.guard.ts`, `apps/web/src/lib/kku/employee-api.ts`, `docker-compose.yml`, `.github/workflows/*.yml` | various | placeholder / type identifier / CI placeholder | Not a finding | No | Type-system identifier (`private readonly secret: Uint8Array`), function parameter name (`password = credentials?.password`), env-var lookup (`envOrThrow('KKU_API_CLIENT_SECRET')`), CI placeholders (`test-secret-please-override-for-anything-real`, `ci-placeholder-secret-do-not-use`), and dev-default `${POSTGRES_PASSWORD:-kku_dev_password}` on the dev compose file. |

**Zero high-severity HEAD findings.** Only the H1 informational disclosure stands.

---

## 3. History findings

Full pickaxe across all 164 commits with patterns for Anthropic / AIza / AWS / JWT / PEM / Postgres-with-cred / KMITL / KKU-SSO / Scopus / Anthropic / OpenAlex env-var sets. Plus a blob-body sweep on every version of `.env*example` files.

| # | Finding | Class | Severity | Rotation? | Notes |
|---|---|---|---|---|---|
| — | No commit ever introduced a non-`*.example` `.env` file | hygiene | OK | No | `git log --all --diff-filter=A --name-only` filtered for `^.env.*` returns only `.env.example` and `.env.prod.example`. |
| — | Every `KKU_SSO_CLIENT_SECRET=`, `GOOGLE_AI_API_KEY=`, `ANTHROPIC_API_KEY=`, `KKU_SCOPUS_API_KEY=`, `KMITL_SECRET_KEY=` line ever committed has a placeholder value | placeholder | OK | No | `REPLACE_ME`, `REPLACE_ME_PROD_CLIENT_SECRET`, empty (`KEY=`), or the dev-default sentinel `change-me-to-a-long-random-string` for `NEXTAUTH_SECRET`. |
| — | The KMITL "Skill Mapping" PDF (`/home/denpong/skillmapping.pdf`) is **not in git**, deliberately | hygiene | OK | No | Confirmed via `git ls-files`. CLAUDE.md notes it carries a "CONFIDENTIAL — do not distribute" header and is kept out of the repo by convention. |
| — | `OPENALEX_MAILTO=denpong@kku.ac.th` appears in committed `.env.prod.example` and historical blobs | not-a-secret | OK | No | OpenAlex's documented `mailto=` polite-pool contact — they explicitly request it as plain text. Not a credential. |
| — | No JWT (`eyJ.eyJ.`), Anthropic, AIza, AWS access key, or PEM private-key marker has ever appeared on `main` | clean | OK | No | All five pickaxes returned zero matches. |

**Zero historical secret leaks.** No rotation required from history.

---

## 4. Client-bundle leak check

Built `apps/web` via `pnpm --filter web build`. Webpack emitted 146 chunks (4.4 MB) under `apps/web/.next/static/` before a TS strict-undefined error in an unrelated component (`hero-quadrant.tsx:209`) failed the typecheck stage. The chunks were complete enough to scan.

| Probe | Result |
|---|---|
| Anthropic key shape `sk-ant-api…` in any chunk | **none** |
| Google AI key shape `AIza…` | **none** |
| Postgres URL | **none** |
| JWT shape `eyJ.eyJ.` | **none** |
| Env var **names** (`NEXTAUTH_SECRET`, `KKU_SSO_CLIENT_SECRET`, `GOOGLE_AI_API_KEY`, `ANTHROPIC_API_KEY`, `KKU_SCOPUS_API_KEY`) | **none** — none of the server-only env-var names is referenced from any client chunk. ✅ |
| KKU internal IPs | **1 hit** — `10.130.2.151` in `apps/web/.next/static/chunks/app/staff/research/page-5067bd412c015117.js`. Source: H1 above. |
| `kkuscholar` token in client chunks | **same single hit** as the IP (same line). |
| High-entropy strings ≥40 chars | All matches were either embedded font-glyph metadata (TrueType/WOFF data: `gDIQAA…`, `hgAzAAAD…` etc.) or library-internal identifiers (`convertOffsetParentRelativeRectToViewportRelativeRect`, the nanoid alphabet `ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789`). Not secrets. |

**Net result:** the client bundle contains zero secret material. Only finding is the **H1 IP-disclosure** through visible UI copy on `/staff/research`. Same-class disclosure ("internal kku-publications mirror") is already in the public-ish docs (CLAUDE.md, production-infrastructure.md, data-sources.md) so the marginal information leak is small — but the in-app UI is reachable by every authenticated `UNIVERSITY_USER` and above, and Council-member view should not display it.

---

## 5. Error-response leakage

`apps/api/src/common/exception.filter.ts` is the global exception filter. Three branches:

1. **`ApiError` (caller-controlled).** Returns `{ data: null, meta: null, error: { code, message, details } }`. No stack trace. The `details` field is caller-supplied — risk only if a service hands a Prisma error object directly into `details`. **Grepped every `new ApiError(...)` site** (~25 hits, all in `apps/api/`). Every `details:` argument is a hand-built object — no raw Prisma errors observed.
2. **`HttpException` (Nest built-in).** Returns the Nest-derived message + a code mapped from HTTP status. Doesn't expose stack. Does expose the `message` string on the exception, which is risky **only if** a controller does `throw new BadRequestException(prismaErr.message)`. **Grepped `(err as Error).message` chained into a thrown exception**: two sites in `apps/api/src/admin/queues.service.ts:177` and `:205`. Both are ADMIN-grade routes (BullMQ control-plane ops); the wrapped messages are BullMQ control-flow strings, not Prisma errors. **Acceptable but fragile** — if the surface ever expands to a non-admin route, this pattern needs a sanitiser.
3. **Anything else.** Logs the stack server-side via the Nest `Logger`, returns `{ error: { code: 'INTERNAL', message: 'Internal server error' } }`. **No stack, no DB name, no internal hostname leaks.** ✅

`response.interceptor.ts` wraps successful responses in the `{ data, meta, error: null }` envelope; no error-handling concerns.

`NODE_ENV=production` posture: the filter doesn't branch on `NODE_ENV` — it's already production-safe by default in every branch. The Nest `Logger` writes the stack to pino server-side (which respects log level + the prompt-13 redaction list).

| Class | Status |
|---|---|
| Stack trace in response body | ❌ never |
| DB name / connection string | ❌ never |
| Internal hostname | ❌ never |
| Prisma error message | ❌ filtered through ApiError unless a future caller misuses `(err as Error).message` |
| BullMQ admin op error | ✅ surfaced verbatim via ApiError VALIDATION_FAILED — admin-only |

**No leaks identified in the error path.** One `TODO(prompt-12)` recommendation: add a tiny sanitiser helper that strips `connect to ...`, `at ...:`, and `\n at ...` patterns from any `(err as Error).message` before it reaches `new ApiError`.

---

## 6. `.env.prod` hygiene

| Check | Result |
|---|---|
| `.env.prod` is in `.gitignore` | ✅ line 15 (`.env.prod`). `.env`, `.env.local`, `.env.*.local`, `.env.staging` also blocked. |
| `.env.prod` is **not** tracked at HEAD | ✅ `git ls-files \| grep .env` returns only `.env.example` and `.env.prod.example`. |
| `.env.prod` was **never** tracked in history | ✅ `git log --all --diff-filter=A --name-only \| grep .env` returns the same two files only. |
| `build-release.ts` never bundles `.env.prod` | ✅ only copies `.env.prod.example` into the release bundle. |
| `deploy.sh` requires `.env.prod` to exist on the prod host | ✅ `scripts/deploy.sh:56` fails preflight if `$DEPLOY_ROOT/.env.prod` is missing. |
| `deploy.sh` symlinks the prod `.env.prod` into the release dir (does not copy) | ✅ `scripts/deploy.sh:80`. Mode of the underlying file is preserved through the symlink. |
| `deploy.sh` enforces `chmod 600` on `.env.prod` | ❌ **partial gap** — the failure message tells the operator to chmod, but the script does not verify the actual mode. An operator who forgets the chmod silently deploys with a permissive `.env.prod`. |

### Recommended one-line fix (drop into prompt 09 — container hardening)

In `scripts/deploy.sh`, immediately after the existing `[ -f "$ENV_FILE" ] || fail …` line, add:

```bash
ENV_MODE="$(stat -c %a "$ENV_FILE")"
[ "$ENV_MODE" = "600" ] || fail "$ENV_FILE has mode $ENV_MODE — must be 600 (run: sudo chmod 600 $ENV_FILE)"
```

Same posture for the secret files in `$SECRETS_DIR`:

```bash
for name in postgres_user postgres_password minio_user minio_password; do
  m="$(stat -c %a "$SECRETS_DIR/$name")"
  [ "$m" = "600" ] || fail "$SECRETS_DIR/$name has mode $m — must be 600"
done
```

---

## 7. Rotation checklist (operator-actionable)

> Even though no live secret has ever been committed to git, the items below should be **rotated as part of the prompt-09 hardening pass anyway** — for routine cycle hygiene before a Council-facing launch, not because they leaked. Mark `[ ]` and tick as you complete each one on the prod host.

| Secret | Reason to rotate now | Action |
|---|---|---|
| `NEXTAUTH_SECRET` | First-ever generation for prod (UAT/dev secret should not be reused) | `openssl rand -hex 64 > /opt/program-landscape/.env.prod`-line update; bounce `web` + `api`. |
| `POSTGRES_PASSWORD` (in `/opt/program-landscape/secrets/postgres_password`) | First-ever generation for prod | `openssl rand -base64 32 > /opt/program-landscape/secrets/postgres_password`; bounce postgres + apps. |
| `MINIO_ROOT_PASSWORD` (`/opt/program-landscape/secrets/minio_password`) | First-ever generation | Same shape. |
| `KKU_SSO_CLIENT_SECRET` | KKU IT issues a separate prod secret per environment | Receive from KKU IT; populate `.env.prod`. |
| `GOOGLE_AI_API_KEY` | Per-operator secret should be rotated when this app is the new caller | Generate fresh in Google Cloud console; populate `.env.prod`. |
| `ANTHROPIC_API_KEY` | Same | Generate fresh in Anthropic console. |
| `KKU_SCOPUS_API_KEY` | Elsevier institutional key — KKU Library issues a per-app key | Request new key from KKU Library; populate `.env.prod`. |
| `KMITL_SECRET_KEY` (+ `KMITL_CLIENT_ID`) | KMITL flags secret-key rotation as urgent on compromise | Confirm with KMITL operator before populating; document rotation cadence. |
| `KKU_HR_DB_PASSWORD`, `KKU_REGISTRY_DB_PASSWORD`, `KKU_PUBLICATIONS_DB_PASSWORD`, `UNICON_DS200{1,3,4}_DB_PASSWORD` | Each is a read-only login KKU IT manages | Confirm credentials with each upstream system owner; populate `.env.prod`. |
| Self-signed cert (`/opt/program-landscape/certs/{fullchain,privkey}.pem`) | First-ever generation | Run `scripts/generate-self-signed-cert.sh`; share SHA-256 fingerprint with KKU network team for pinning (or accept `proxy_ssl_verify off`). |

**Items NOT requiring rotation** (because no real value ever existed in git):

- `OPENALEX_MAILTO` — not a secret; documented contact.
- All `.env.example` / `.env.prod.example` placeholder values.
- `kku_dev_password` / `kku@localhost` dev defaults — only used against ephemeral dev / CI Postgres.
- The 64-hex string in `docs/security-review-audit-2026-04-24.json` — that is a quoted GHSA advisory PoC, not our secret.

---

## 8. Recommended follow-up actions (none is a code-rotation today)

1. **Apply the H1 fix** — single-line edit in `apps/web/app/staff/research/client.tsx:435`. Lands in **prompt 06** (frontend hardening) or sooner if a separate one-liner.
2. **Add the chmod-verification block to `scripts/deploy.sh`** — lands in **prompt 09**.
3. **Add a Prisma-error sanitiser helper** before the two `(err as Error).message` sites in `apps/api/src/admin/queues.service.ts` rethrow as `ApiError` — lands in **prompt 12**.
4. **Re-issue `docs/security-review.md`** with this prompt's results referenced in §10 — already on the prompt-10 TODO list.
5. **Add `gitleaks detect --source . --log-opts="--all"` to the CI pipeline** so future regressions are caught at PR time, not at audit time — lands in **prompt 17/18**.

---

## Acceptance criteria check

| Criterion | Status |
|---|---|
| Tool output reproduced inline | ✅ `audit/03-secrets/head-scan.txt` + `client-bundle.txt`, plus inline excerpts above |
| Zero high-severity findings remain in HEAD after recommended edits | ✅ Only H1 (low-severity informational disclosure) remains; recommended edit is one line. |
| Rotation list is operator-actionable | ✅ Section 7 — every item has a concrete shell command or a named owner. |

**No high-severity findings in HEAD or in history.** No commit-history rewrite required.
