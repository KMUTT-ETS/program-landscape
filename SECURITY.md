# Security Policy

Program Landscape is a Council-facing strategic decision-support system for Khon Kaen University. Security issues that could leak personal data (faculty / student / financial) or subvert Council decisions are treated as **P0** incidents.

## Supported versions

Program Landscape follows semantic versioning once it reaches `v1.0.0`. Until then (all `v0.x`), only the **latest release** receives security fixes — we don't backport to older prereleases.

| Version | Supported |
|---|---|
| `v0.13.x` (latest prerelease) | ✅ |
| Older `v0.x` | ❌ |

## Reporting a vulnerability

**Do not open a public GitHub issue for security reports.**

Send the report by email to **security@kku.ac.th** and CC the project lead (see `CODEOWNERS`). Include:

- A short description of the vulnerability.
- The affected version (`git rev-parse HEAD` on the running deploy, or the release tag).
- Step-by-step reproduction.
- Impact assessment: what data can be accessed / what actions can be taken?
- If possible, a suggested remediation.

You'll get an acknowledgement within **2 business days** and a first-pass triage outcome within **5 business days**. Critical / high-severity issues are patched within **14 days**; medium within 30 days; low within 90 days or in the next scheduled release — whichever is sooner.

## Coordinated disclosure

We follow a **90-day disclosure window**. The clock starts the day we acknowledge the report. We ask that reporters:

- Do not publicly disclose the vulnerability, or share it outside your direct security team, before the coordinated date.
- Do not test for vulnerabilities on the **live Council-facing deployment** — we can provision a staging environment against which you can test freely. Ask in your report email.
- Do not access personal data beyond what's necessary to demonstrate impact.

Once patched, we'll publish the fix in the next release notes and credit the reporter (with permission). A CVE is requested when the severity warrants.

## Scope

In scope:
- `apps/web` (Next.js frontend)
- `apps/api` (NestJS HTTP API)
- `apps/ingestion` (BullMQ worker, trend monitors)
- `packages/*`
- `infra/gotenberg`, `infra/postgres`, `infra/nginx`
- Deployment scripts (`scripts/*.sh`, `scripts/*.ts`, `scripts/*.mjs`)

Out of scope:
- Third-party services we depend on (KKU SSO, Google Gemini, Anthropic Claude, KKU reverse proxy) — report those upstream.
- Social-engineering attacks against KKU staff.
- Physical access to the prod server.
- DoS attacks that rely on flooding (the app is protected by rate-limit middleware; volumetric DoS is a network-layer issue handled at KKU's edge).

## Known limitations

Documented in [`docs/security-review.md`](./docs/security-review.md). Current accepted-risk items:

1. Remaining `v0.x` Next.js line CVEs — full remediation requires a Next.js 15 major-version upgrade, planned for a future release.
2. Self-signed cert between KKU proxy and our server — by design; KKU proxy either pins the fingerprint or sets `proxy_ssl_verify off`.
3. Per-template export-reason enforcement on PDF routes — the decorator exists but isn't wired into the UI yet; tracking as a follow-up.

## Security-relevant design documents

- [`docs/ai-governance.md`](./docs/ai-governance.md) — model policy, output safety gate, prompt-injection posture
- [`docs/pdpa.md`](./docs/pdpa.md) — personal-data inventory, legal basis
- [`docs/dsar-workflow.md`](./docs/dsar-workflow.md) — how to serve data-subject requests
- [`docs/backup-dr.md`](./docs/backup-dr.md) — backup integrity + disaster recovery
- [`docs/migration-policy.md`](./docs/migration-policy.md) — forward-only schema evolution
