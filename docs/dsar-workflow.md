# Data Subject Access Request Workflow

PDPA §30 guarantees every data subject access to their personal data held by the controller. This is our playbook for responding to a DSAR on Program Landscape.

---

## Intake

1. Request arrives at `dpo@kku.ac.th` (Thai or English).
2. KKU DPO verifies the requester's identity via KKU SSO or national ID check.
3. DPO logs the ticket in the KKU DPO ticketing system — **not** in Program Landscape (audit separation).
4. DPO opens Program Landscape with their `ADMIN` role and begins the export.

## Export (admin flow)

Endpoint: `POST /api/v1/admin/dsar/export` (to be built as part of 13b — the request body carries the target user's id + a DSAR ticket reference; the response is a signed-URL JSON bundle + a CSV archive).

**Export bundle contents** (everything keyed by target user id):

| File | Content |
|---|---|
| `user.json` | The user row (`email`, `name`, `role`, `facultyId`, `departmentId`, `themePreference`, `createdAt`, `updatedAt`) |
| `audit-logs.json` | All `AuditLog` rows where `userId = target` |
| `ai-inferences.json` | All `AiInference` rows where `userId = target` (prompts + responses; if > 2 years old, only metadata) |
| `annotations.json` | All `Annotation` rows where `userId = target` (comments, disagreements, narrative edits) |
| `scenarios.json` | All `Scenario` rows where `createdBy = target` |
| `council-decisions.json` | All `CouncilDecision` rows where `createdBy = target` OR the user is listed as approver |
| `saved-cockpit-views.json` | User's saved views |
| `signal-subscriptions.json` | User's inbox subscriptions |
| `analyst-conversations.json` | All chats with the AI Analyst (conversation + messages + feedback) |
| `uploaded-pdfs.json` | All `PdfDocument` rows where `uploadedByUserId = target` (metadata only; content is in MinIO) |
| `attached-documents.json` | All `ProgramDocument` rows attached by the user |
| `staff-profile.json` | For the person's staff record(s): their `staff_publications_cache` row and every external staff-profile API call that looked them up (`api_request_logs`, with the calling client's name). Today `pnpm tsx scripts/pdpa/dsar.ts` (schema `dsar.v2`) exports these as `staffPublicationsCache` / `apiRequestLogs`, with `staffRecord.matchedBy` — check a `profile-resolver` (name) match before sending. |

**Manifest:** `_manifest.json` at the root of the bundle listing every file's row count + checksum.

---

## Verification

Before sending the bundle:

1. **Spot-check payload fields** — open `ai-inferences.json` and read 3 random rows. Any surprising PII that leaked into a model prompt? If yes, note in the response letter and plan a prompt-fix.
2. **Verify the bundle is complete** — run the admin sanity script:
   ```bash
   pnpm --filter api exec node scripts/dsar-verify.mjs <userId> <bundlePath>
   ```
   (Script lands in 13b.)
3. **Encrypt the bundle** at rest with a per-request AES-256 key. Key delivered to the requester via a separate channel (SMS or in-person).

SLA: **30 calendar days** from verified request to delivery.

---

## Rectification

For requests to correct personal data:

- **User identity fields** (email, name, employee_id, faculty_id, department_id) — corrections flow from **KKU SSO**, not us. Requester updates via KKU SSO self-service; our user row auto-syncs on next login.
- **Content the user wrote** (annotations, scenarios, chat messages) — the user edits them in-app via the normal workflow.
- **Faculty-member detail extracted from a PDF** — the requester submits the corrected info; analyst creates a new extraction row with `methodVersion='dsar-correction-<ticket-id>'`, approves it, and materialises onto the Program. Audit trail preserved.

---

## Erasure

For deletion requests (PDPA §33):

1. DPO confirms the requester's legal basis for erasure (e.g. consent withdrawn, data no longer necessary).
2. If accepted: admin runs `POST /api/v1/admin/dsar/anonymise` with the user id:
   - `user.email → null`
   - `user.ssoSubject → null`
   - `user.name → "[deleted user]"`
   - `user.themePreference → 'SYSTEM'`
   - `user.disabledAt → now`
   - Any `Annotation` / `Scenario` / `CouncilDecision` authored by the user keeps the `userId` foreign key but the user row carries the anonymisation flag — audit integrity is preserved.
3. `AiInference` rows keep the `userId` column (anonymised user) but the `prompt` + `response` fields are scrubbed.
4. `AuditLog` rows are retained (7 years) per Accounting Act; the `userId` references the anonymised user row.

Full hard-deletion of `AuditLog` rows only on a court order.

---

## Objection (automated decision-making)

If the requester is a **faculty member** and objects to an AI-derived recommendation affecting their program:

1. DPO routes to the ANALYST on duty + the faculty-member's dean.
2. The system's automated recommendations are **non-binding** — they surface options for human decision. Object-on-automated-decision requests are ALWAYS accepted.
3. The `Annotation(kind='disagreement')` log captures the objection with a link to the original AiInference.
4. The analyst may re-run the analysis with adjusted inputs (in Scenario Planner) and the faculty-member is invited to review.
5. If the Council decision is already approved, amendment path via `/decisions/[id]/amend` is used.

---

## Records

Every DSAR action writes an AuditLog row with `action='dsar.<verb>'`:

- `dsar.export`
- `dsar.rectify`
- `dsar.anonymise`
- `dsar.object`

KKU DPO retrieves these rows quarterly for internal audit. The Program Landscape IT ops team cannot action a DSAR unilaterally — DPO must be in the loop.
