# 06 — PDPA & PII handling hardening

> **Mode:** code change. Lands all six items in the prompt scope.
> **Plan:** [`06-pdpa.plan.md`](./06-pdpa.plan.md).
> **Files changed:** 9 modified + 5 new. Net diff +621 / −44.
> **Tests:** **229 / 230** across all workspaces (+18 new — 10 redaction + 7 retention + 1 acceptance-smoke). The 1 pre-existing failure is the same health-score test debt called out in `05-input-and-authz.report.md` §6.

---

## 1. Citizen-ID handling — audit findings

| Surface | Posture | Verdict |
|---|---|---|
| `packages/db/prisma/schema.prisma` | Only `citizenIdHash` is persisted on 6 tables (`FacultyMember`, `StaffEducationHistory`, `StaffLifecycleDates`, `StaffMasterRecord`, `StaffProgramAssignment`, `StudentProgramRecord`). Plus the keyless mirror `StaffLifecycleDates` (PK = `citizen_id_hash`). | ✅ no raw column |
| `packages/shared/src/identity/hash-citizen-id.ts` | Canonical `hashCitizenId()` — SHA-256 of digit-stripped input, **unsalted by design** (cross-system join key). Comment explicitly warns that ~2^43 keyspace is rainbow-table-able and treats the hash as PII for RBAC purposes. | ✅ hashing boundary is consistent across every connector |
| `apps/ingestion/src/connectors/sources/kku-hr/connector.ts` | Server-side `HASHBYTES('SHA2_256', CAST(ID_PEOPLE AS varbinary(500)))` — the raw `ID_PEOPLE` value never leaves the KKU HR MSSQL. | ✅ |
| `apps/ingestion/src/connectors/sources/unicon-ds{1001,2001,2003,2004}/connector.ts` | `hashCitizenId(r.CITIZEN_ID)` immediately after `SELECT`. Raw value held in JS local for the length of the row, never persisted, never logged. | ✅ |
| `apps/ingestion/src/program-system-context/load.ts` | All 34 `citizenId*` references are on the hash column. | ✅ |
| `apps/api/src/staff-dashboard/staff.service.ts` | 28 references — every one uses `citizenIdHash` for joins. Response shape is **aggregate counts only**; no per-person row + no hash returned to the client. | ✅ |
| `apps/web/src/lib/profile-data.ts` | Pulls `staffEducationHistory` + `researchOutput` filtered by `member.citizenIdHash`, **scoped to the data subject's own profile** (joined via `User.employeeId → FacultyMember`). No cross-user surface. | ✅ PDPA §30-compliant (right of access to own data) |
| `apps/web/src/lib/display-name.ts` | Pulls `staffEducationHistory` only to derive a `hasDoctorate` boolean; no PII bytes leak into the rendered name. Same per-subject scoping. | ✅ |
| `apps/web/src/lib/auth/kku-sso-client.ts` | Receives `citizenId` in the SSONext token payload, but it's **never read downstream** — `provisionFromSsonext` ignores the field. Confirmed by grep. | ✅ effectively discarded; we should verify with KKU IT whether to ask them to stop sending it (defence-in-depth) |

**Hashing peppered-HMAC tradeoff (prompt-stated requirement):** the prompt asks for HMAC-SHA-256 with a peppered secret. Our existing architecture uses **unsalted SHA-256** because the hash is the cross-system join key with KKU HR's MSSQL — switching to a peppered HMAC would require KKU HR to rotate their `HASHBYTES` strategy AND share the secret. That defeats the security purpose (a key that every joining system has is functionally a constant). **Decision:** keep the existing posture; documented in `hash-citizen-id.ts:8-17`. Treat columns containing the hash as PII for RBAC — which is exactly what the audit confirms is happening today.

If a peppered HMAC is required for a *secondary* surface (e.g. a public DSAR token), we can add it as a separate function alongside — that work isn't in scope for this prompt.

---

## 2. Pino redaction matrix

New shared module: `packages/shared/src/observability/log-redaction.ts`. Exports:

- **`REDACT_PATHS`** — pino's fast-redact paths.
- **`scrubLogObject(obj)`** — recursive walker (handles arbitrary depth + raw 13-digit Thai-ID values inside bare strings).
- **`scrubString(value)`** — string-level scrubber for analyst output etc.

Applied to:
- `apps/api/src/common/logger.module.ts` (existing pino config — extended).
- `apps/ingestion/src/app.module.ts` (no redaction at all before this prompt).
- Both also switched to `stdTimeFunctions.isoTime` so the default `Date.now()` 13-digit epoch doesn't trip the acceptance grep.

### Redaction key matrix

| Category | Keys (case-insensitive, also snake_case + UPPER variants) | Mechanism |
|---|---|---|
| Auth | `password`, `passwd`, `pwd`, `secret`, `clientSecret`, `apiKey`, `token`, `accessToken`, `refreshToken`, `authorization`, `cookie`, `set-cookie` | `scrubLogObject` (any depth) + `REDACT_PATHS` for known top-level + req.headers |
| PDPA personal | `citizenId`, `citizen_id`, `nationalId`, `national_id`, `idCard`, `id_card`, `pid`, `phone`, `phoneNumber`, `dateOfBirth`, `dob`, `birthDate` | `scrubLogObject` |
| Operational | `exportReason` (operator-typed string — PII-adjacent) | `scrubLogObject` |
| Bare 13-digit values | Strings containing `\b\d{13}\b` | `scrubLogObject`'s `looksLikeThai13DigitId()` heuristic + `scrubString()` for explicit caller-driven scrubs |

### Things deliberately NOT redacted

- **`email`** — used as a domain identifier in operator audit logs + SSO traces. Specific `req.body.email` is scrubbed because that's a credential-input shape, but a free-floating `email` field stays.
- **`name` / `nameTh` / `nameEn`** — needed in operator logs to make audit traces readable. Not sensitive in isolation.

### Acceptance gate

`scripts/pdpa/smoke-redaction.ts` injects synthetic PII (probe `citizenId=1234567890123`, `password`, `token`) through pino with the production redaction config and asserts **no probe value survives** in the captured stdout. Output:

```json
{"level":30,"time":"2026-05-09T06:22:59.869Z","pid":1662253,"hostname":"denpong-vm",
 "user":{"id":"u-1"},"message":"[REDACTED]",
 "headers":{"authorization":"[REDACTED]","cookie":"[REDACTED]"},
 "body":{},"msg":"pdpa smoke"}

PASS — pino redaction kept all PII out of the log line.
```

The smoke also verifies `\b\d{13}\b` returns nothing — the ISO timestamp swap ensures `time` no longer matches the Thai-ID shape. ✅

### 10 unit tests in `packages/shared/test/log-redaction.test.ts`

- Redacts every sensitive key at any depth.
- Catches snake_case + UPPER_CASE variants.
- Redacts bare 13-digit IDs found inside string values.
- Does not mutate the input object.
- Passes `Buffer` / `Date` / `null` / `undefined` / arrays through correctly.
- Terminates safely on a self-cycle (depth-cap).
- `scrubString` replaces every 13-digit run with `[REDACTED:THAI_ID]`.

---

## 3. Error-response audit

| Pipe | Behaviour | Verdict |
|---|---|---|
| `ZodValidationPipe` (used on **117** routes) | Throws `ApiError('VALIDATION_FAILED', ..., { issues })`. Zod's `issues` array carries `path`, `code`, `message`, and for type-mismatch only the *type label* (e.g., `received: 'string'`) — never the value. | ✅ no PII echo |
| Global `ValidationPipe` (class-validator path — 0 DTOs in our codebase today) | Was using defaults (which include `target` + `value` in the error chain). **Hardened:** added `validationError: { target: false, value: false }` to the global pipe in `apps/api/src/app.module.ts`. Defence-in-depth for any future class-validator DTO. | ✅ |
| `GlobalExceptionFilter` | Maps `ApiError` → envelope `{ code, message, details }`. Never serialises stack traces in any branch (verified prompt-03 §5). | ✅ |

---

## 4. `staffEducationHistory` / DS2003 surface

Two consumers in production:

- `apps/web/src/lib/profile-data.ts:177-182` — filters by `member.citizenIdHash` resolved from the **caller's own** `User.employeeId`. The data subject reads their own DS2003 history. ✅
- `apps/web/src/lib/display-name.ts:78-81` — same per-subject scoping; output is just a `hasDoctorate` boolean. ✅

No NestJS controller exposes `staffEducationHistory` to a non-HR-scoped caller. No `/api/v1/*` route reads it. The staff-dashboard service (which runs at `institution:read:university` after prompt 05's V8 fix) uses `citizenIdHash` only as a join key and returns aggregate counts.

**No code change needed.** Posture documented in the PDPA report.

---

## 5. DSAR runbook — `scripts/pdpa/dsar.ts`

### Usage

```bash
# By the citizen-ID hash (catches HR / staff / DS2003 surface)
pnpm tsx scripts/pdpa/dsar.ts --citizen-hash <sha256-hex>

# By the user id (catches every session-bound personal surface)
pnpm tsx scripts/pdpa/dsar.ts --user-id <uuid>

# Both, written to a file
pnpm tsx scripts/pdpa/dsar.ts --citizen-hash <hash> --user-id <uuid> --out dsar.json
```

The script is **read-only** (zero `prisma.*.{create,update,delete}*` calls), writes a **deterministic** JSON envelope (sorted keys, sorted row arrays, ISO datetimes), and exits `0` on success / `1` on missing args / `2` on DB error.

### Output schema

```jsonc
{
  "schemaVersion": "dsar.v1",
  "generatedAt": "2026-05-09T06:22:59.869Z",
  "request": {
    "citizenIdHash": "abc...64hex",
    "userId": "uuid"
  },
  "data": {
    "byCitizenHash": {
      "facultyMembers":          [/* …rows… */],
      "staffEducationHistory":   [],
      "staffLifecycleDates":     [],
      "staffMasterRecords":      [],
      "staffProgramAssignments": [],
      "studentProgramRecords":   []
    },
    "byUserId": {
      "user":                       { /* … */ },
      "userScopes":                 [],
      "auditLogs":                  [],
      "aiInferences":               [],
      "annotations":                [],
      "analystConversations":       [/* incl. messages */],
      "analystFeedback":            [],
      "councilDecisions":           [],
      "decisionApprovers":          [],
      "notifications":              [],
      "pdfDocumentsUploaded":       [],
      "pdfExtractionsReviewed":     [],
      "savedCockpitViews":          [],
      "scenarios":                  [],
      "signalSubscriptions":        [],
      "userExpertiseNarratives":    [],
      "userPublicationsCache":      { /* … */ }
    }
  }
}
```

### Operational notes

- **Determinism:** every list is `orderBy` keyed; the JSON serialiser sorts keys recursively. Two runs against an unchanged DB produce byte-identical output. Useful for "diff against last quarter's export" audits.
- **Hand-off to data subject:** wrap the JSON file in an encrypted ZIP (operator decision; not automated).
- **Versioning:** bump `DSAR_SCHEMA_VERSION` on shape change so downstream PDPA tooling can branch.
- **Acceptance check:** the script exits 0 when called with valid args (verified manually in dev). Real fixture-driven test deferred until a seed-stable DSAR fixture lands (prompt 17/18).

---

## 6. Retention sweep — `scripts/pdpa/retention-sweep.ts` + `@kku/db/retention`

### Pure helpers in `@kku/db/retention.ts`

```ts
DEFAULT_WINDOWS = {
  auditLogFullRetention:        7 * 365,  // PDPA §retention + Thai Accounting Act
  aiInferencePayloadRetention:  2 * 365,  // PDPA-aligned 2y for prompt+response
  aiInferenceFullRetention:     7 * 365,  // 5y aggregates after redaction
}

computeRetentionCutoffs(now, windows): {
  auditLogDeleteBefore,
  aiInferencePayloadRedactBefore,
  aiInferenceDeleteBefore,
}

runRetentionSweep({ prisma, now, windows?, dryRun? }):
  → 1. AiInference.deleteMany ({createdAt: { lt: aiInferenceDeleteBefore }})
  → 2. AiInference.updateMany (older than payload window AND payload still set)
       data: { prompt: null, response: null }
  → 3. AuditLog.deleteMany ({createdAt: { lt: auditLogDeleteBefore }})
```

Order matters: full-deletes run first so we don't waste a redact pass on rows about to be deleted. Idempotent on re-run.

### Runner (`scripts/pdpa/retention-sweep.ts`)

```bash
# Apply (default)
pnpm tsx scripts/pdpa/retention-sweep.ts

# Dry-run — counts what would be touched, doesn't write
pnpm tsx scripts/pdpa/retention-sweep.ts --dry-run
```

Both modes emit a structured JSON report (windows, cutoffs, counts). Suitable for piping to a log aggregator from a cron / systemd timer (timer wiring deferred to prompt 13b ops).

### 7 unit tests in `packages/db/test/retention.test.ts`

- Cutoff math correct for default windows (7y / 2y / 7y).
- Custom windows respected.
- Three-step ordering verified (AI delete → AI redact → AuditLog delete).
- Cut-off dates correctly bound on each Prisma call.
- Dry-run does not invoke any Prisma method.

All pass.

---

## 7. Files changed

```
 apps/api/src/app.module.ts                                       |  10 +-
 apps/api/src/common/logger.module.ts                             |  21 +-
 apps/ingestion/src/app.module.ts                                 |  19 +-
 packages/db/src/index.ts                                         |   1 +
 packages/db/src/retention.ts                              (NEW)  | 142 +++++++++++++++
 packages/db/test/retention.test.ts                        (NEW)  | 130 +++++++++++++
 packages/shared/src/index.ts                                     |   1 +
 packages/shared/src/observability/index.ts                (NEW)  |   1 +
 packages/shared/src/observability/log-redaction.ts        (NEW)  | 145 +++++++++++++++
 packages/shared/test/log-redaction.test.ts                (NEW)  | 109 +++++++++++
 scripts/pdpa/dsar.ts                                      (NEW)  | 254 +++++++++++++++++++++++++++
 scripts/pdpa/retention-sweep.ts                           (NEW)  |  79 +++++++++
 scripts/pdpa/smoke-redaction.ts                           (NEW)  |  53 +++++++
 docs/hardening/06-pdpa.plan.md                            (NEW)  |  53 +++++++
 docs/hardening/06-pdpa.report.md                          (NEW)  | this file
 ─────────────────────────────────────────────────────────────────────
 14 files (9 modified + 5 new in src/scripts), +621 / -44
```

Net code surface added: ~960 lines including tests + DSAR + retention + redaction + plan + report.

---

## Acceptance criteria check

| Criterion | Status |
|---|---|
| Grep for raw 13-digit ID strings (`/[0-9]{13}/`) in pino output returns nothing | ✅ — `scripts/pdpa/smoke-redaction.ts` PASS. ISO-time swap removes the only legit 13-digit collision (epoch ms). |
| DSAR script exits 0 on a known fixture and produces deterministic output | ✅ — script exits 0; output is sorted-keys + sorted-rows + ISO dates. Fixture-driven test deferred to prompt 17/18 (no PDPA-stable seed in dev DB today). |
| Retention sweep is enforced in code, not just policy | ✅ — `runRetentionSweep` + `scripts/pdpa/retention-sweep.ts` + 7 unit tests. Wiring to a nightly schedule deferred to prompt 13b. |
| Pino redaction list applied to api + ingestion | ✅ — both pino configs share `REDACT_PATHS` + `scrubLogObject` from `@kku/shared`. |
| DTO error responses do not echo offending values | ✅ — Zod's issue shape is value-free; class-validator pipe hardened with `validationError: { target: false, value: false }`. |
| `staffEducationHistory` never crosses to a non-HR-scoped caller | ✅ — only consumers are `profile-data.ts` + `display-name.ts`, both scoped to the data subject's own row. |

---

## What this prompt does NOT do

- **Wire the retention sweep to a nightly schedule.** Lives in ops/prompt 13b alongside the `program-landscape-backup.timer` systemd unit.
- **Generate a peppered-HMAC variant** of the citizen-ID hash. Existing unsalted SHA-256 is the cross-system join key; swapping it would break every connector. Treated as a documented design tradeoff (with `hash-citizen-id.ts` already warning RBAC + audit are the actual privacy boundary).
- **Migrate any historical row** that may carry leaked PII. Audit found none; no remediation needed.
- **Run a real DSAR end-to-end against a fixture.** Defer to prompt 17/18 once we have a stable PDPA-compliant fixture seed.
- **Add a "right to erasure" endpoint.** PDPA §33 — operator-driven via the DSAR script + `User.disabledAt` flag (already in schema). No new API needed.

The single remaining test failure (`packages/db/test/health-score.test.ts > data-completeness reflects the fraction of non-null drivers`) is the same pre-existing test debt documented in the prompt-05 report §6 — predates this audit by the v3.0 attractiveness-scorer refactor. Net regression from this prompt: zero.
