# Plan — Prompt 02: Dependency & CVE audit

**Mode:** read-only audit. **NO** lockfile mods, **NO** upgrades.

## Inputs read first

- Root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` (head + tail).
- All workspace `package.json`s (10 files: root + 3 apps + 6 packages).
- Every Dockerfile (5: api/web/ingestion `.prod`, postgres, gotenberg).
- `docs/hardening/01-threat-surface.report.md` for cross-cutting context.

## Tools

- `pnpm audit --prod --json` — full registry CVE check.
- `pnpm audit --json` (incl. dev) — for cross-reference.
- `pnpm outdated -r --long` — recursive across all workspaces.
- `docker image inspect ...` for digests + ages where image is locally cached.
- `WebSearch` for spot-checking CVE feeds: Next.js 14.x, NestJS 10.x, Prisma 5.22, multer, undici, postgis 16-3.4, redis 7-alpine, minio current, gotenberg 8, nginx 1.27-alpine.

## Outputs

1. **Raw artefacts** committed under `docs/hardening/audit/`:
   - `02-pnpm-audit-prod.json` (verbatim)
   - `02-pnpm-audit-all.json`
   - `02-pnpm-outdated.txt`
2. **Report** `docs/hardening/02-deps.report.md` with:
   - Section 1 — Methodology + scope.
   - Section 2 — Image base inventory + digest + age.
   - Section 3 — **Must-fix-before-deploy** (CVSS ≥ 7 or active exploit).
   - Section 4 — **Should-fix-this-cycle**.
   - Section 5 — **Acknowledged & deferred** (each with named reason).
   - Section 6 — Upgrade plan per must-fix item: exact `pnpm` command + workspace + breaking-change risk.
   - Section 7 — Lockfile resolutions / overrides scan.
3. **No file** in `apps/`, `packages/`, or any lockfile is modified.

## Acceptance criteria

- Every CVSS ≥ 7 finding has a verified upgrade target version on the npm registry.
- Each must-fix carries a named breaking-change verdict.
- Every Dockerfile base image listed with the source-tag in use today.
- Cross-reference back to `security-review.md` snapshot from 2026-04-24 (delta vs today).

## Non-goals

- Running `pnpm update`, `pnpm dedupe`, or any registry write.
- Editing `package.json` or `pnpm-lock.yaml`.
- Building images.
- Running tests.
