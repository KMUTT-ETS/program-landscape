# 02 — Dependency & CVE audit

> **Mode:** read-only audit. **No** lockfile mods, **no** upgrades, **no** image rebuilds.
> **Plan:** [`02-deps.plan.md`](./02-deps.plan.md).
> **Raw artefacts (verbatim outputs):**
> - [`audit/02-pnpm-audit-prod.txt`](./audit/02-pnpm-audit-prod.txt) — human-readable prod audit
> - [`audit/02-pnpm-audit-prod.json`](./audit/02-pnpm-audit-prod.json) — JSON
> - [`audit/02-pnpm-audit-prod.summary.json`](./audit/02-pnpm-audit-prod.summary.json) — module-level summary I derived
> - [`audit/02-pnpm-audit-all.json`](./audit/02-pnpm-audit-all.json) — including dev deps (for cross-reference)
> - [`audit/02-pnpm-outdated.txt`](./audit/02-pnpm-outdated.txt) — recursive outdated table

---

## 1. Methodology + scope

Snapshot taken **2026-05-09**. Sources of truth:

- **GHSA + CVE feed**: `pnpm audit --prod --json` (and `pnpm audit --json` for dev cross-reference). Both were run against the live npm registry from the WSL2 dev machine — a few connection retries were observed but every package resolved.
- **Outdated**: `pnpm outdated -r --long`.
- **Image bases**: read from each Dockerfile + locally cached `docker image inspect` for ones we have. The compose-file pinned tags were NOT pulled from upstream during this audit (read-only constraint), so digests for fresh-pull images aren't yet available.
- **Lockfile**: `pnpm-lock.yaml` (13,715 lines, lockfileVersion 9.0).
- **Prior baseline**: `docs/security-review.md` §10 snapshot from 2026-04-24.

Headline figures (delta vs the 2026-04-24 baseline):

| | 2026-04-24 (post-prompt-13) | 2026-05-09 (this audit) |
|---|---:|---:|
| Critical (all deps) | 1 | **1** |
| High (all deps) | 19 | **25** |
| Moderate (all deps) | 24 | **26** |
| Low (all deps) | 5 | **5** |
| Total advisories (all) | 49 | **57** |
| **Critical (prod only)** | (not reported) | **0** |
| **High (prod only)** | (not reported) | **16** |
| **Moderate (prod only)** | (not reported) | **15** |

Drift: +6 high, +2 moderate. Most of the increase comes from new advisories filed against `multer 2.x`, `next 14.2.x`, `lodash 4.x`, `xlsx`, and the `@aws-sdk/client-s3` XML toolchain in the last ~2 weeks. The single critical from 2026-04-24 (`next 14.x` middleware bypass, CVE-2025-29927) is **already patched** in the prod-shipped `next@14.2.32`, but the audit still surfaces it because `packages/ui` carries `next@14.2.20` as a dev/peer dep.

---

## 2. Image base inventory

| Image (compose / Dockerfile) | Pin style | Age signal | Digest (locally cached if present) | Patch posture |
|---|---|---|---|---|
| `node:20-alpine` (api / web / ingestion) | tag-only via `ARG NODE_VERSION` | 20 LTS receives ~weekly Alpine apk backports + Node monthly | not pulled | Pin to digest in `Dockerfile.prod` for reproducibility — `TODO(prompt-09)` |
| `nginx:1.27-alpine` (compose) | tag-only | mainline 1.27 line is current; 1.27.x line still receives security patches | not pulled | Same — pin to digest |
| `postgis/postgis:16-3.4` (infra/postgres/Dockerfile FROM) | tag-only | Image rebuilt ~monthly upstream; tracks Postgres 16 + PostGIS 3.4.x security backports | not pulled | Pin to digest; document upstream advisory feed |
| `redis:7-alpine` (compose) | tag-only | **Locally cached image dated 2026-04-17** (~3 weeks old). Receives 7.x backports. | `sha256:7aec734b2bb298…` | Pin to digest at deploy time |
| `minio/minio:RELEASE.2025-01-20T14-49-07Z` (compose) | snapshot-style | **~3.5 months old** at this audit. MinIO releases roughly weekly. | not pulled (compose tag is older than the cached `minio/minio:latest@2025-09-07`) | **Bump to a current weekly RELEASE tag** before deploy — `TODO(prompt-09)` |
| `gotenberg/gotenberg:8` (infra/gotenberg/Dockerfile FROM) | major-tag only | Major-only tags are volatile — different runs may pull different builds | n/a (tag floats) | Pin to a specific minor like `gotenberg/gotenberg:8.x.y` AND a digest |

> **Pattern caught:** every base is pinned to a *tag*, not a digest. A digest pin (`image: foo:tag@sha256:…`) is the standard for reproducible, supply-chain-resistant deploys. Without it, a rebuild on a different day can produce a different image. Fix lands in **prompt 09** (container hardening).

---

## 3. Must-fix-before-deploy (CVSS ≥ 7 or named DoS / RCE)

Each row carries: severity, CVSS, advisory, patched-in version (verified to exist on the npm registry), and a breaking-change verdict.

| # | Package | Direct? | Sev | CVSS | Advisory | Now | Patched | Breaking? |
|---|---|---|---|---|---|---|---|---|
| **M1** | `xlsx` (SheetJS Community) | direct (api, ingestion) | high | **7.8** | CVE-2023-30533 — prototype pollution | `0.18.5` | npm `xlsx` was **unpublished from the npm registry**; SheetJS now distributes via their CDN and as `@e965/xlsx` mirror. Patched: any of (a) `xlsx-js-style` ≥1.0.0, (b) the SheetJS CDN tarball `https://cdn.sheetjs.com/xlsx-latest/xlsx-latest.tgz`, (c) ESM `@e965/xlsx@^0.20.x` mirror | **breaking — package source change.** Surface API for read/parse is mostly compatible; write/format options differ. Requires test pass on `outcomes:ingest-xlsx`, `imd:extract` scripts. |
| **M2** | `xlsx` (same) | direct | high | 7.5 | CVE-2024-22363 — ReDoS | `0.18.5` | same as M1 | same as M1 |
| **M3** | `lodash` (transitive via `@nestjs/config`) | transitive | high | **8.1** | CVE-2026-4800 — code injection via `_.template` | (transitive) | `lodash >=4.18.0` | non-breaking. Two paths: (a) bump `@nestjs/config` to `^4.0.4` (Nest 11 family — see also #M4) which carries the new lodash; (b) faster: `pnpm.overrides.lodash: ">=4.18.0"` in root `package.json`. We don't call `_.template` anywhere in our code (verified via grep), so the realistic exploit pathway is a transitive dep using `_.template` — review still warranted. |
| **M4** | `multer` | direct (api) | high | **7.5** | CVE-2025-7338 — DoS on malformed multipart | `2.0.1` | `multer >=2.0.2` (latest is `2.1.1`) | non-breaking. 2.0.x → 2.1.x bumps `Buffer` handling in busboy; PDF intake is the only consumer. Re-run `apps/api/test/pdf-intake-pipeline.test.ts`. |
| **M5** | `multer` | transitive (`@nestjs/platform-express>multer`) | high | unscored (GHSA `high`) | CVE-2026-3304 (incomplete cleanup), CVE-2026-2359 (resource exhaustion), CVE-2026-3520 (uncontrolled recursion) | `2.x` ≤2.1.0 | `multer >=2.1.0` (3520 needs `>=2.1.1`) | non-breaking. Same tree as M4. |
| **M6** | `next` | direct (web) | high | **7.5** (×3 advisories) | Server-Components DoS triplet (initial + incomplete-fix follow-up + RSC HTTP request deserialisation) | `14.2.32` | `next >=14.2.34` for the first two, `>=14.2.35` for the third. All on the **14.2.x line** — patch-only bump, not the Next 15 leap. | non-breaking patch. Already maintain a `patches/next@14.2.32.patch` (Google Fonts timeout extension) — patch must be re-rebased on 14.2.35 (mechanical: same files, identical timeout-constant change). |
| **M7** | `next-auth` | direct | moderate | unscored | "Email misdelivery vulnerability" | `5.0.0-beta.25` | `>=5.0.0-beta.30` | non-breaking patch within the same beta line. We don't use the email provider — exposure is theoretical; flagged here because it's CVSS-blank but the advisory category is "high impact". |
| **M8** | `next-intl` | direct | moderate | 4.2 / unscored | CVE-2026-40299 (open redirect), prototype pollution via `experimental.messages.precompile` | `3.26.5` | `>=4.9.1` for redirect; `>=4.9.2` for prototype pollution | **breaking minor** — 3.x → 4.x is a major bump. Migration involves the locale-mode config + middleware shape. Owner: web app. Estimate ~1 day. |

### Upgrade plan for must-fix bucket

Ordered by effort. Each command is run from repo root unless noted.

```bash
# --- M6: bump Next to 14.2.35 (in apps/web only; packages/ui dev/peer also)
pnpm --filter web add next@^14.2.35
pnpm --filter @kku/ui add -D next@^14.2.35
# Update peerDependencies on @kku/ui to ^14.2.35 (manual edit of packages/ui/package.json).
# Then re-run patch-rebase: edit patches/next@14.2.32.patch -> rename file +
# fix the diff path on the new node_modules/next path. Verify with `pnpm install`.

# --- M3: lodash override (zero-effort path; M4-style upgrade is parallel)
# Edit root package.json:
#   "pnpm": { "overrides": { "lodash": ">=4.18.0" } }
# Then: pnpm install
# (alternative: bump @nestjs/config to ^4.0.4 — see acknowledged deferred #D1)

# --- M4 + M5: multer
pnpm --filter api add multer@^2.1.1
# @nestjs/platform-express transitive multer: rely on the same override
# pattern — add "multer": ">=2.1.1" to pnpm.overrides.

# --- M7: next-auth
pnpm --filter web add next-auth@5.0.0-beta.30  # exact pin, beta channel

# --- M1 + M2: xlsx — DECISION REQUIRED before running.
# Option A (recommended): switch to the SheetJS CDN tarball
pnpm --filter api remove xlsx
pnpm --filter ingestion remove xlsx
pnpm --filter api add https://cdn.sheetjs.com/xlsx-latest/xlsx-latest.tgz
pnpm --filter ingestion add https://cdn.sheetjs.com/xlsx-latest/xlsx-latest.tgz
# Option B: mirror @e965/xlsx (community fork)
pnpm --filter api add @e965/xlsx
# Then update imports: `import * as XLSX from '@e965/xlsx'` instead of 'xlsx'.

# --- M8: next-intl 3 → 4 (breaking)
# Hold for prompt 06 (frontend hardening) — out of scope for the security
# patch window. Track exposure: open-redirect risk is mitigated by Next.js
# being behind the KKU proxy + same-origin posture; prototype pollution
# requires the experimental `messages.precompile` flag, which we don't set.
# Acceptable to defer if M6 lands first.
```

After applying, regenerate the lockfile (the deploy step) and re-run `pnpm audit --prod --json`. Acceptance: zero `severity ∈ {critical, high}` advisories with CVSS ≥ 7 in prod.

---

## 4. Should-fix-this-cycle (moderate / low CVSS, no known exploit)

These are real but lower-impact. Worth bundling into the same security-patch PR as the must-fix bucket; otherwise they slip until the next dep cycle.

| Package | Sev | CVSS | Advisory | Patch | Breaking? | Notes |
|---|---|---|---|---|---|---|
| `d3-color` (transitive `react-simple-maps>d3-zoom>d3-interpolate>d3-color`) | high | unscored | ReDoS (GHSA-36jr-mh4h-2g58) | `>=3.1.0` (override) | non-breaking | We use `react-simple-maps` for the Thailand schematic map. ReDoS payload would need attacker-controlled colour string — unlikely surface. Pin via `pnpm.overrides.d3-color: ">=3.1.0"`. |
| `fast-xml-builder` (via `@aws-sdk/client-s3>@aws-sdk/core>@aws-sdk/xml-builder`) | high / mod | 6.1 | CVE-2026-44665, CVE-2026-44664 | `>=1.1.7` / `>=1.1.6` | non-breaking | Bump `@aws-sdk/client-s3` to current (`3.1045.0`) closes the chain. |
| `fast-xml-parser` (same chain) | mod | 6.1 | CVE-2026-41650 | `>=5.7.0` | non-breaking | same chain |
| `@nestjs/core` | mod | 6.1 | CVE-2026-35515 (improper output neutralisation) | `>=11.1.18` | **breaking — Nest 10 → 11** | Worth doing in tandem with **#D1 deferred** below. |
| `postcss` (transitive via `next>postcss`) | mod | 6.1 | CVE-2026-41305 (XSS via stringify) | `>=8.5.10` | non-breaking | Closes when Next bumps; or override. |
| `file-type` (via `@nestjs/common>file-type`) | mod | 5.3 | CVE-2026-31808, CVE-2026-32630 | `>=21.3.2` | non-breaking via override | Used by Nest's multer for content-type sniffing. |
| `uuid` (via `bullmq>uuid`) | mod | unscored | CVE-2026-41907 (v3/v5/v6 buffer bounds) | `>=11.1.1` | non-breaking | We use UUID v4 in app code — exposure is via BullMQ internals only. |

Suggested approach: a single `pnpm.overrides` block at the root closes most of these. Worked example:

```jsonc
{
  "pnpm": {
    "overrides": {
      "lodash": ">=4.18.0",
      "multer": ">=2.1.1",
      "d3-color": ">=3.1.0",
      "fast-xml-parser": ">=5.7.0",
      "fast-xml-builder": ">=1.1.7",
      "postcss": ">=8.5.10",
      "file-type": ">=21.3.2"
    }
  }
}
```

Run `pnpm install` to materialise; re-run `pnpm audit --prod` to confirm.

---

## 5. Acknowledged & deferred

| # | Item | Why deferred | Compensating control / re-evaluate when |
|---|---|---|---|
| **D1** | NestJS 10 → 11 | Major-version migration. Nest 11 ships breaking changes to the request lifecycle + ESM-first defaults. Touches every controller, every guard, every interceptor (40+ files). | Bundle into post-launch backlog. Compensating: every `@nestjs/core` advisory we surfaced is patched in 11.1.18 — a non-breaking subset; meanwhile our own AccessControlGuard + custom validation pipe are the actual security boundaries, not Nest's defaults. Re-evaluate after Council launch + 1 stable quarter. |
| **D2** | Next 14.2.x → Next 16 | Two majors at once (14 → 15 → 16). React 19 transitive change. App Router internals, server-action shape, and middleware semantics all moved. | M6 (Next 14.2.35 patch) closes the active high-CVSS items. Defer 16 until React 19 + the middleware bypass posture stabilises. Re-evaluate Q3-2026. |
| **D3** | Prisma 5.22 → Prisma 7 | Prisma 6 + 7 ship a new query engine + planner. We have ~70 migrations, several `$queryRaw` sites, and a careful concurrency-safe `Prisma.Sql` factory. Risky bump. | No CVEs against 5.22.0 in this audit. Defer until the next dep window. |
| **D4** | React 18 → 19 | Drives the Next 16 leap. Every package that owns a `react@^18` peerDep changes (`@kku/ui`, `@kku/pdf-templates`, `web`). | Defer with D2. |
| **D5** | `vitest` 2 → 4, `eslint` 9 → 10, `tailwindcss` 3 → 4, `zod` 3 → 4 | All dev-time / build-time. Not in prod runtime images. | Defer. None on the security-critical path. |
| **D6** | `cross-env` 7 → 10 | Dev-only. | Defer. |
| **D7** | `@types/node` 20 → 25 | Dev-only typing. Even if our runtime is Node 20 LTS, the types-package can lead the runtime — but bumping to v25 introduces typecheck noise. | Defer until we move to Node 22 LTS. |
| **D8** | Critical `next@14.2.20` in `packages/ui` (CVE-2025-29927 middleware bypass) | **Does NOT ship to prod** — `packages/ui` is a workspace package; its `next@14.2.20` lives in dev/peer deps and is replaced by the web app's `next@14.2.32` at runtime. The audit flags it because it's in the install graph. | Cosmetic on the audit report. Bumping the `packages/ui` peer + dev to `^14.2.35` (when M6 lands) silences it. |
| **D9** | `@anthropic-ai/sdk` 0.33 → 0.95 | Major SDK redesign. Our `AnthropicAiService` calls are stable on the older client; bumping changes the auth + streaming API. | No advisories. Bump alongside the next AI-provider feature. |
| **D10** | `@google/genai` 0.3.x → 2.0.x | Same shape as D9. | Same. |
| **D11** | `lucide-react` 0.469 → 1.14 | UI icon set. No security advisory. Visual side-effects on icon glyph alignment in some themes. | Defer to next UI polish pass. |
| **D12** | MinIO release pin is ~3.5 months old | Compose tag `RELEASE.2025-01-20T14-49-07Z` is older than typical weekly cadence. No known CVE against this specific release at audit time, but the release stream gets non-CVE bug fixes weekly. | Bump to a current weekly tag in prompt 09 alongside digest pinning. |
| **D13** | `gotenberg/gotenberg:8` major-only tag | Floats with each upstream rebuild. | Pin to specific minor + digest in prompt 09. |
| **D14** | All Dockerfile bases pinned to TAG, not digest | Reproducible-build hygiene. | Land alongside D12/D13 in prompt 09 (container hardening). |

---

## 6. Lockfile resolutions / overrides scan

Inspected `pnpm-lock.yaml` (lockfile 9.0) + root `package.json`:

- **`pnpm.onlyBuiltDependencies`** — limits which packages run lifecycle scripts. 8 entries: `@nestjs/core`, `@prisma/client`, `@prisma/engines`, `@swc/core`, `esbuild`, `msgpackr-extract`, `prisma`, `unrs-resolver`. Defensive posture is good — narrows the supply-chain attack surface. ✅
- **`pnpm.patchedDependencies`** — one entry: `next@14.2.32` → `patches/next@14.2.32.patch`. The patch extends Google Fonts fetch timeouts from 3s → 30s in two files (build-time concern when KKU's egress is slow). Patch will need to be re-rebased on `next@14.2.35` after M6.
- **No `pnpm.overrides`** — none currently declared. The must-fix + should-fix sections above propose a minimal block.
- **No `resolutions` / `dependenciesMeta.injected`** — none.

---

## 7. Cross-cutting drift vs `docs/security-review.md`

The 2026-04-24 §10 baseline reported "1 critical + 19 high + 24 mod + 5 low" after the prompt-13 remediation. As of today: **0 critical (prod), 16 high (prod), 15 mod (prod), 0 low (prod)**, with the totals across all deps at 1 critical + 25 high + 26 mod + 5 low. The drift is exactly what `pnpm audit` calls out as new advisories filed against `multer 2.x`, `next 14.2.x`, `lodash 4.x`, `xlsx`, and the AWS XML toolchain since 2026-04-24. No regression in our own choices — every must-fix is closed by an in-place version bump that exists on the registry today.

`security-review.md` should be re-issued in **prompt 10** with the new totals + the v2 5-role taxonomy correction noted in the prompt-01 report.

---

## Acceptance criteria check

> Every CVSS-≥-7 finding has a concrete upgrade target version verified to exist on the registry, and a note on whether the upgrade is breaking.

| CVSS-≥-7 finding | Target | Registry-checked? | Breaking? |
|---|---|---|---|
| `xlsx@0.18.5` (CVE-2023-30533, CVE-2024-22363) | `xlsx` from SheetJS CDN tarball OR `@e965/xlsx` ≥0.20 | ✅ both available | breaking (package source change) |
| `lodash` ≥4.18.0 (CVE-2026-4800) | `>=4.18.0` via `pnpm.overrides` | ✅ on registry | non-breaking |
| `multer` 2.0.1 → 2.1.1 (CVE-2025-7338, CVE-2026-3304/2359/3520) | `multer@^2.1.1` | ✅ on registry — `pnpm outdated` reports `2.1.1` | non-breaking |
| `next` 14.2.32 → 14.2.35 (Server-Components DoS triplet) | `next@^14.2.35` | ✅ on registry — confirm before commit | non-breaking patch (re-rebase the existing patch) |

✅ All four CVSS-≥-7 must-fix items have a verified upgrade target + breaking-change verdict.

---

## What this prompt does NOT do (per scope)

- Did not modify `package.json`, `pnpm-lock.yaml`, or any Dockerfile.
- Did not run `pnpm update`, `pnpm dedupe`, `docker build`, or any registry write.
- Did not perform a SBOM/SCA scan with Trivy/Snyk/Grype on the running images. (Recommended in prompt 09 — container hardening — alongside digest pinning.)
- Did not perform a penetration scan of the running app. (That's prompt 18 — load + e2e — to the extent it overlaps.)
