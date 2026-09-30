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
| **Page views** | user_id, effective role, impersonated flag, viewer faculty, route pattern, module, programme / faculty / department in view, timestamp | Browser beacon on each page, signed-in sessions only | Platform adoption + user support | **120 days** raw, then rolled into daily counts (`PageViewDaily`, no expiry) — see "Page-view recording" below |

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
| Page views | Legitimate interest (§24(5)) — understanding which parts of the service are used, and supporting the people who use them. Never individual performance appraisal |

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
- `AiInference` table: **2 years full retention**, then `prompt` + `response` text fields are **redacted in place**; id, module, model, tokens, cost, confidence, created_at retained for a further 5 years for audit aggregates.
- `ScholarFetchArchive` table: **90 days**, then hard-deleted.
- `ScholarBindAttempt` table: **90 days** on the free text (`url`, `profile_name`, `error_text`), then redacted in place; the row itself is kept indefinitely.
- `ScholarFetchRun` table: **no retention rule, deliberately.**
- `PageView` table: **120 days** of raw rows, then each whole Asia/Bangkok day
  is rolled into `PageViewDaily` (counts only — no timestamps, no IP, no
  department, impersonated views excluded) and the raw rows are hard-deleted.
  `PageViewDaily` itself has **no expiry**: it carries no personal timestamps,
  only per-(day, user, role, module, path) counts. The 120 days is
  `RAW_RETENTION_DAYS` in `packages/db/src/usage.ts` — the same constant the
  usage reader switches on, deliberately not a second copy.
- `ApiRequestLog` table: **365 days**, then hard-deleted. Never stores the citizen id, its hash or the email a caller sent — only the staff record matched.

Retention is enforced by `scripts/pdpa/retention-sweep.ts` (`--dry-run`
reports without writing); the windows live in `packages/db/src/retention.ts`
and are unit-tested there. In production the sweep runs **nightly at 04:00
Asia/Bangkok** via `program-landscape-retention.timer`, after the 02:00 backup
(the dump precedes the delete) and the 03:00 verify-backup drill; each run
tees its JSON report to
`/opt/program-landscape/logs/retention-sweep-YYYYMMDD.json`, which is the
evidence the control ran. A run that fails part-way still writes that report
and exits non-zero.

### Redaction writes a sentinel, not a null

`AiInference.prompt`, `AiInference.response` and `ScholarBindAttempt.url` are
all `NOT NULL`. Redaction therefore overwrites them with the literal
`[redacted]` (`REDACTED_TEXT` in `packages/db/src/retention.ts`) rather than
nulling them. This is also the better answer on its own terms: an operator
reading the row can tell "nobody typed anything" apart from "we no longer keep
what they typed".

> **Corrected 2026-09-08. No exposure occurred, and none was possible for
> another 20 months.**
>
> The AiInference rule previously wrote `null` into two `NOT NULL` columns.
> Prisma rejected it (`Argument \`prompt\` must not be null.`) and the dry-run
> report threw on the matching `{ not: null }` predicate, so **the payload
> redaction had never actually run**.
>
> It also had nothing to do. Measured against the live database on 2026-09-08:
> `ai_inferences` holds 11,841 rows, **0** of them past the 730-day payload
> window, oldest `2026-05-01` — so no row can breach the payload policy before
> **2028-05-01**. `audit_logs` holds 2,837 rows, **0** past the 2,555-day
> window, oldest `2026-04-30`. The dev database is a restore of production's
> `pre-deploy-1.9.1` dump, so that is production's profile too.
>
> The honest summary for an audit: a rule that could not execute was found
> roughly 20 months before the first row would have aged into it, and fixed.
> **There is no backlog and no remediation event to look for.** The first
> sweep after this fix will redact zero rows; the first that redacts anything
> falls after 2028-05-01.

### Google Scholar on-demand fetch

Three tables, three different answers, because they hold different things.

- **`ScholarFetchArchive`** stores a scraped Google Scholar profile page
  verbatim — a named person's full publication list as displayed. It exists so
  a parse found to be wrong months later can be reprocessed instead of
  re-scraped, and that value expires: past 90 days the profile has moved on and
  a re-fetch is both cheaper and more accurate. It is the largest personal-data
  payload this feature writes, so the rule is a **hard delete**.
- **`ScholarBindAttempt`** is a **cost ledger**: it records the ScrapingBee
  credits each verification page billed, on every outcome including refusals,
  which is the reason the table exists. Deleting the row would delete the spend
  record, so the rule redacts only the identifying free text — the URL as
  pasted, the profile name the page displayed, and the error text. Same
  aggregate-survives-the-payload shape as the AiInference rule.

  **What survives, stated in full:** `user_id`, `faculty_member_id`,
  `outcome`, `credits_used`, `created_at` — **and `scholar_profile_id`**. That
  last one matters and is easy to miss: the redacted URL is reconstructable
  verbatim from it, as
  `scholar.google.com/citations?user=<scholar_profile_id>`. So the redaction
  removes the free text a human typed, not the identifier it resolved to.
  That is the intended trade — the profile id is the join key the fetch runner
  and the quota ledger both need, it is already stored openly on
  `FacultyMember.scholar_profile_id` for every successful bind, and a Scholar
  profile id is public by construction. But the "kept" list has to say so
  rather than let a reader infer that the URL is gone. If a future review
  decides the id should not survive on a REFUSED attempt, redact it in
  `runRetentionSweep` alongside the other three and amend this list.
- **`ScholarFetchRun`** is the **quota ledger**: the rolling-30-day allowance
  is computed by querying it. Deleting old rows would hand people a fresh
  allowance, and it carries no free text beyond an error string and a search
  query already implied by the staff record. It is deliberately not swept.

Legal basis for holding any of it: §24(4), legitimate interests of KKU
governance, on data the subject made public by publishing. The archive's
90-day window is the data-minimisation counterweight.

### Page-view recording (from v1.9.6)

The retention rule is in the list at the top of this section. This is what the
rows hold, and who can read them.

**What a page view records.** One row per page a **signed-in** user opens: the
normalised route pattern (`/programs/[id]`), the module that route belongs to,
the programme / faculty / department in view, the user's id, their effective
role and their faculty at that moment, and the timestamp. Normalisation
(`normalisePath()` in `@kku/shared/usage`) keeps a path segment only when it
reads like a kebab-case route word and collapses everything else — a cuid, a
`KKU-SEQ-` code, a UUID, a numeric id, percent-encoding, a whole URL — to
`[id]`, and bounds the result to 200 characters. It is a deny-by-default shape
rule, not a list of known routes, so a dynamic route added tomorrow is bounded
the day it ships.

**What it never records.** IP address, user agent, the raw URL, the query
string or fragment (normalisation cuts at the first `?` or `#`), and anything
at all before sign-in. `/p/<slug>` public-profile share tokens are collapsed to
`[id]` unconditionally — that slug is the only access control on an
unauthenticated page, so it must not be reconstructable from `page_views` even
in the rare case it happens to read like a route word.

**Impersonated views are never counted.** A view taken while an admin is
impersonating another user is stored with `impersonated = true` (and the
impersonated role), and is excluded by every reader and by the nightly
roll-up. It never appears as that person's activity, and `PageViewDaily`
therefore has no impersonation column to filter on.

**Who can see what.** Aggregates — counts by module, programme, faculty and
role, with no individual named — require `usage:read:aggregate`, held by
SUPER_ADMIN, SYSTEM_ADMIN and UNIVERSITY_USER. The per-person access log and
session timelines require `usage:read:detail`, held by the two admin grades
only. Admin accounts are themselves excluded from the figures by default
(`excludeAdmins` defaults to `true` on every endpoint). The detail window is
capped at `RAW_RETENTION_DAYS`, because past that horizon only counts survive.

**Purpose, and the limit on it.** Understanding which parts of the platform are
used, by which roles and faculties, and reconciling a reported problem with
what the platform actually saw. Legal basis: legitimate interest in operating
the service (§24(5)). These rows are product telemetry and carry no
`ingestion_run_id` by design, so `realDataWhere()` does not and must not admit
them to any Council metric; they must not be used for individual performance
appraisal.

**On erasure.** `user_id` is `ON DELETE SET NULL` on both `page_views` and
`page_view_daily`, so deleting a user drops the attribution and keeps the
counts — the same posture as the audit log.

### External staff-profile API (from v1.9.9)

`POST /api/v1/external/staff-profile` lets another KKU system read the data
behind a staff member's `/profile` page. Consumer guide:
`docs/integrations/staff-profile-api.md`.

**What it discloses, per section.** `person` is always returned: staff record
id, academic title, Thai and English name, ORCID / Scopus / OpenAlex / Scholar
identifiers, and the KKU email only for a client allowed to look up by email.
The rest is granted per client by an admin: `affiliation` (faculty, department,
programmes and the person's role in them), `education` (degrees, institute,
year), `teaching` (courses and enrolled-seat totals over five academic years),
`research` (paper, citation and h-index summary) and `publications` (the full
list). A client receives only the sections it was granted; the response names
the ones withheld. Excluded from v1: photograph, AI expertise narrative and
the Teaching Talent verdict.

**How a person is found.** By Thai citizen id or by email, in the body of a
POST, never in a URL, so the identifier does not reach proxy or access logs.
The request logger also redacts `req.body.citizenId` and `req.body.email`.
A miss returns the same 404 for either identifier, so the API cannot be used
to test which identifiers exist. Inactive staff are hidden unless the client
was granted them.

**What is logged, and what is deliberately not.** Each call writes an
`ApiRequestLog` row: client, key, lookup type, the resolved staff record (null
on a miss), status, sections returned, latency, IP, request id. It never
stores the citizen id **or its hash**. `hashCitizenId()` is unsalted over a
keyspace of roughly 2^43 values, so a stored hash is recoverable in hours on a
GPU; storing it would be storing the id. The resolved staff record id tells an
auditor who was looked up without that risk. Rejected 429 and 403 calls are
logged at most once per client per minute. Retention: 365 days (see the list
above). Every client and key change is written to the audit log with the key
prefix only, never the key.

**Who can call.** Per-client API keys, stored as SHA-256 hashes and shown once,
managed at `/admin/external/api-clients` under the `api_clients:admin`
permission (SUPER_ADMIN and SYSTEM_ADMIN). Per-client IP allowlists exist but
are off until the KKU proxy address is pinned in nginx; preflight refuses a
deploy that enables them earlier.

**Basis for sharing.** The legal basis for a calling system to receive this
data is that system's own. It must be recorded per calling system, with the
sections and lookup types justified, **before its key is issued**. A key is
not issued on the promise of a basis to follow.

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
