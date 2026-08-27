# PDPA Compliance (Thailand Personal Data Protection Act B.E. 2562)

This doc captures the PDPA posture of Program Landscape: what personal data we collect, why, how long we keep it, and how a data subject exercises their rights. KKU's Data Protection Officer (DPO) signs off on this document before launch.

---

## Roles

- **Data Controller:** Khon Kaen University, acting through the Office of the President.
- **Data Processor:** the Program Landscape application and its hosting (on-prem Ubuntu server, `/opt/program-landscape/`).
- **Data Subjects:** KKU faculty members, KKU staff users (analysts, council members, executives), KKU students (demographic records only).

---

## Personal data inventory

| Category | Fields | Source | Purpose | Retention |
|---|---|---|---|---|
| **User identity** | email, name, employee_id, role, faculty_id, department_id | KKU SSO on first login | Auth + role-based access | Until account deactivation + 1 year |
| **Session** | JWT claims (user id, role, scope), IP address | next-auth at login | Session management + audit | Session lifetime (30 days rolling) |
| **Audit trail** | user_id, action, entity_id, IP, timestamp, payload hash | `AuditLog` table | Accountability for every mutation | **7 years** (aligns with Thai Accounting Act) |
| **AI inference log** | user_id, module, kind, prompt, response, tokens, model, cost | `AiInference` table | AI governance + cost tracking + audit | **2 years** (then payload fields redacted; ids + aggregates kept for 7 years) |
| **Faculty member detail** | name, position, degrees, majors, institutions, year, specialisation | Upload PDF / KKU-HR connector (prompt 14) | Program staffing analysis | While employed + 1 year |
| **Faculty citizen ID** | national ID partial (3-XXXX-XXXXX-XX-X masked from page 6 onwards) | Upload PDF parsing | Identify-verify the faculty member | Not stored — redacted from extraction via `sanitizeAiOutput` |
| **Student demographics** | aggregate counts by cohort × admission route × gender × income bracket | KKU-Registrar feed (prompt 14) | Cohort-level analysis ONLY — no individual records | Per KKU-Registrar retention policy |
| **Graduate outcomes** | aggregate employment rate, average salary, job relevance, sample size | Alumni survey (prompt 14) | Outcome tracking | Per alumni office retention |
| **Employer feedback** | aggregate satisfaction score, sector, skill ratings | Employer survey (prompt 14) | Graduate fitness-for-role analysis | Per survey's consent terms |

**Not collected:** individual student names, individual salaries, individual home addresses, bank accounts, biometric data, criminal records, health records.

---

## Legal basis

| Category | Basis (PDPA §24) |
|---|---|
| User identity, session, audit trail | Legitimate interest (§24(5)) — necessary for the controller's legal obligations and the operation of the decision-support service |
| AI inference log | Legitimate interest (§24(5)) — audit trail of automated decisions affecting faculty |
| Faculty member detail | Performance of a contract (§24(3)) — KKU's employment contract with faculty |
| Student demographics | Legitimate interest (§24(5)) — institutional quality assurance under the Higher Education Act |
| Graduate outcomes | Consent (§24(1)) — survey participation is opt-in |
| Employer feedback | Consent (§24(1)) — survey participation is opt-in |

---

## Data subject rights (§30–36) — how we serve them

| Right | Our workflow |
|---|---|
| **Right of access** (§30) | Email request to `dpo@kku.ac.th` → verified → we export the user's `AuditLog` + `AiInference` + `Annotation` rows as a JSON bundle via the admin-only DSAR endpoint (see `docs/dsar-workflow.md`) |
| **Right to rectification** (§32) | Same route. User-identity fields update via KKU SSO — we don't edit them directly. Faculty-member detail corrections go through the data-curation workflow in the analyst guide |
| **Right to erasure** (§33) | On account deactivation: identity fields anonymised (`email → null`, `name → "[deleted user]"`), audit rows retain the `user_id` (foreign key) but the user row carries an anonymisation flag + deletion timestamp. Full erasure only on legal request |
| **Right to restriction** (§34) | Supported via `User.disabledAt` (freezes write access; reads continue). 7-day review window before reactivation |
| **Right to data portability** (§35) | JSON + CSV export via the DSAR endpoint |
| **Right to object** (§36) | Routed to DPO — automated decisions affecting faculty are reviewed case-by-case; faculty-member can request their program's extraction be re-reviewed with their input |

Response SLA: **30 calendar days** from a verified request (PDPA compliant).

---

## Cross-border data transfer

All app data is stored on KKU-owned infrastructure within Thailand. **Two external flows exist:**

1. **AI provider calls (Google / Anthropic):**
   - **Prompts contain:** structured data (program identifiers, aggregated metrics, extracted PDF text).
   - **Prompts do NOT contain:** KKU SSO tokens, passwords, citizen IDs (scrubbed by `sanitizeAiOutput` output gate + filtered by prompt design).
   - **Data residency:** Google and Anthropic may process prompts in their regional infrastructure. KKU's legal basis for this transfer is "necessary for the controller's legitimate interest" (§28) with appropriate contractual safeguards (BAA / DPA signed by KKU legal).
   - **Retention at provider:** per provider's Enterprise agreement — Google's standard retention is 55 days (no training); Anthropic's is 30 days. Confirmed in `AI_PROVIDER` onboarding by KKU IT.
   - **Override:** `AI_PROVIDER=intelsphere` swaps to KKU's own gateway when it's online (prompt 14).
2. **Peer institution scrape (prompt 14):**
   - No personal data collected — only program-level curriculum summaries.

---

## Audit log retention

- `AuditLog` table: **7 years** (aligned with Thai Accounting Act).
- `AiInference` table: **2 years full retention**, then `prompt` + `response` text fields are nulled; id, module, model, tokens, cost, confidence, created_at retained for a further 5 years for audit aggregates.

Retention is enforced by a nightly cron (prompt 13b) that zeroes payload fields on `AiInference` rows older than `AI_INFERENCE_PAYLOAD_RETENTION_DAYS` (default 730).

---

## Data minimisation checkpoints

- Faculty-member detail is role-gated at the Prisma `select` layer for COUNCIL — they see aggregate positions only, never individual names/IDs.
- Salary ranges surface only as bucketed aggregates.
- Student PII never reaches the UI — only counts.
- AI output sanitisation (`sanitizeAiOutput` in `@kku/shared/analyst/safety.ts`) scrubs Thai citizen IDs, phone numbers, and non-KKU emails from model responses.

---

## Committed fixtures

Discovery fixtures under `apps/ingestion/test/fixtures/` are **committed to git
and readable by anyone with repo access**, including the external universities
being granted read access. Treat them as published, not as test data.

Two rules, both learned the hard way in the 2026-08-27 credential audit:

1. **Aggregated is not anonymous. Cell size is what matters.** A `GROUP BY`
   that returns a count of 1 has returned an individual — the tuple key
   describes exactly one person, and quasi-identifiers such as programme ×
   cohort year × gender × home province × nationality name them. Every
   committed count series carries an `N >= 5` floor, applied server-side in
   the capture SQL so small cells never leave the source system. A withheld
   cell is `null`, never `0`.
2. **Masking an email is not masking a person.** An internal identifier —
   staff number, employee code, citizen-ID hash — re-identifies just as well
   to anyone with access to the system it came from, and rather better,
   because it is an exact key rather than a guess. Person-identifying columns
   are hashed (truncated SHA-256), which keeps a fixture able to demonstrate a
   join without carrying the value that resolves it.

| Source | Posture | Verified |
|---|---|---|
| `kku-registry` | `N >= 5` on counts; demographic series removed; count-free vocabularies only | 2026-08-27 |
| `kku-evaluations` | aggregate, except `sample-rows.json` — 5 rows, email masked, `OFFICERID` SHA-256'd | 2026-08-27 |
| `kku-hr` | aggregate-at-source, `HAVING COUNT(*) >= 5`, IDs SHA-256'd server-side | 2026-08-27 |
| `kku-finance` | aggregate-at-source, `HAVING COUNT(DISTINCT STUDENTCODE) >= 5`; budget data is non-personal | 2026-08-27 |
| `kku-publications` | public publication metadata; `people.pid` never read | 2026-08-27 |
| `kmitl-skill-mapping` | percentages only; API contract carries no per-person field | 2026-08-27 |

Test fixtures that describe **named** people — `apps/api/test/teaching-talent-export.test.ts`
and `packages/db/test/teaching-talent.test.ts`, which pair a person with a rank,
a faculty and evaluation scores — are synthetic and must stay synthetic. Both
carry a comment saying so. Do not paste real rows in to reproduce a bug.

Before committing a new fixture: run `pnpm secrets:scan`, and ask what the
smallest group in it describes.

---

## Incident response

If a personal-data breach occurs:

1. **72-hour clock starts** at detection (PDPA §37 parallels Art 33 GDPR).
2. Isolate affected system, capture forensic snapshot of MinIO + Postgres.
3. KKU DPO notifies the PDPA Office within 72 hours.
4. Affected data subjects receive notification if the risk is "high".
5. Post-incident doc lives at `docs/incidents/YYYYMMDD-<name>.md` including root cause, affected data, remediation steps, and whether notification was required.

---

## Annual review

KKU DPO reviews this document annually and signs off in `docs/pdpa-signoffs/YYYY.md`. Changes that trigger an off-cycle review:

- New personal-data category ingested.
- New cross-border transfer (new AI provider, new external connector).
- Change to retention period.
- Regulatory guidance update from the PDPA Office.
