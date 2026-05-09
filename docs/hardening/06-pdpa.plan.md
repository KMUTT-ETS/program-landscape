# Plan — Prompt 06: PDPA & PII handling hardening

**Mode:** code change. Targeted to PII surface + DSAR + retention.

## Reads

- `docs/pdpa.md` (categories, retention windows).
- `docs/hardening/01-threat-surface.report.md` (asset table — Citizen-ID line).
- Every reference to `citizenId` / `nationalId` / `ID_PEOPLE`.
- `apps/api/src/common/logger.module.ts` (pino config) + ingestion equivalent.
- `apps/api/src/common/exception.filter.ts` + `zod-validation.pipe.ts` (error-shape).
- `apps/web/app/api/proxy/*` paths that touch staff data.
- `staffEducationHistory` table model + every consumer.

## Order of work

1. **Audit grep** — `git grep -nE 'citizenId|nationalId|ID_PEOPLE|id_card|พงศ์|13-digit'` etc. Map every hit to one of: hashing-boundary (OK), hashed-only-storage (OK), raw-leak (FIX).
2. **Pino redaction** — extend `buildLoggerModule` (and ingestion's mirror) with the redaction key set. Also the request-log redacts.
3. **Error response audit** — confirm Zod errors don't echo raw values; if they do, add a value-redacting middleware.
4. **DS2003 / staffEducationHistory surface** — grep every `staffEducationHistory` reference; confirm controllers wrap with role guard or a redaction.
5. **DSAR script** — `scripts/pdpa/dsar.ts <citizenIdHash> [--out <file>]`. Outputs a versioned JSON envelope listing every row keyed by the hash. Deterministic ordering. Read-only.
6. **Retention sweep** — `scripts/pdpa/retention-sweep.ts` + extracted pure helpers in `@kku/db` for testability. Implements:
   - AuditLog: hard-delete > 7 years.
   - AiInference: null payload + response > 2 years; hard-delete > 7 years (per pdpa.md).
   - PdfDocument intake: per-source category retention not yet defined → just compute "would-delete" counts; no destructive sweep until each category gets a policy. Documented.
7. **Tests:**
   - Unit test for the retention pure function (fake clock + Prisma mock).
   - Pino smoke test that a logged 13-digit string is redacted.
8. **Acceptance grep:** run a small smoke that logs a synthetic 13-digit input through pino, capture stdout, grep `/[0-9]{13}/` returns nothing.
9. **Report:** `docs/hardening/06-pdpa.report.md` — redaction matrix + DSAR runbook + retention SLA + tests added.

## Non-goals

- Adding a new HMAC pepper at the hashing boundary (the existing `HASHBYTES('SHA2_256', …)` server-side hash on KKU HR's MSSQL is deliberately keyless because both sides need to join; documented in CLAUDE.md). I'll verify the posture but not introduce a peppered HMAC if that breaks the cross-system join.
- Writing the cron scheduler that calls the retention sweep nightly (deferred to ops/prompt 13b).
- Migrating any existing rows that may contain a leaked PII value (audit-first; act later).
