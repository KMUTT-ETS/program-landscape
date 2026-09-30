# Staff Profile API — design

**Date:** 2026-09-30 · **Status:** approved in brainstorming, awaiting spec review
**Version string:** `staff-profile.v1`

## 1. Purpose

Let other KKU systems (HR portal, faculty websites, research office tools) read
the data shown on `/profile` for any staff member, keyed by **Thai citizen ID or
email**, as JSON. Admins manage the calling systems and their credentials in the
admin console.

The six sections, as requested:

1. Name and academic title
2. Affiliation
3. Education
4. Teaching profile — courses taught and students taught over five academic years
5. Research summary — papers, citations, h-index, years active, peak year, top venues
6. Publications, newest first

## 2. Decisions taken in brainstorming

| # | Question | Decision |
|---|----------|----------|
| 1 | Publication source | **Same list as `/profile`, source named per paper.** Scholar-primary when the person has a Scholar import (Scholar rows + library rows Scholar matched), library (Scopus/PubMed) otherwise. `research.basis` states which. Rationale: on dev exactly 1 of 3,852 staff has Scholar rows, so a Scholar-only list would be empty for nearly everyone. |
| 2 | Latency on a cold publications cache | **Build synchronously, like the page, sharing its cache.** A first call can take up to ~45 s; later calls are ms. |
| 3 | Credential model | **Per-client API keys.** Bearer header, shown once, stored hashed, revocable, rotatable with overlap, optional expiry, optional IP allowlist, per-client rate limit. |
| 4 | Data scope | **Per-client section grants.** Admin chooses which of the six sections each client receives and which lookup types (citizen ID / email) it may use. |
| — | Architecture | **Extract the profile builder into `packages/db`; a NestJS endpoint calls it.** The page and the API compute the same numbers by construction. |

## 3. Endpoint

`POST /api/v1/external/staff-profile`

```json
{ "citizenId": "1234567890123" }
```
or
```json
{ "email": "someone@kku.ac.th" }
```

- **POST, not GET.** A citizen ID in a query string lands in the nginx access
  log, pino request logs and the KKU proxy's logs. A body does not.
- Body validated with Zod: exactly one of `citizenId` / `email`.
  `citizenId` must be 13 digits after stripping spaces and dashes **and pass the
  Thai checksum** (mod-11 over the first 12 digits). `email` is trimmed and
  lowercased.
- nginx already routes `/api/v1/*` to the api container. Add a dedicated
  `limit_req` zone for `/api/v1/external/` so integration traffic cannot drain
  the shared `api_zone` that interactive users use.

### Resolution

| Input | Path |
|-------|------|
| `citizenId` | `hashCitizenId()` (`@kku/shared`) → `FacultyMember.citizenIdHash` (unique) |
| `email` | `FacultyMember.kkuEmail` (unique, lowercased). On miss: `User.email` → `User.employeeId` → `FacultyMember.employeeId` — the page's own bridge. |

Coverage on dev today: 2,325 of 3,852 staff records carry a citizen-ID hash and
2,425 carry a `kkuEmail`. A staff member with neither is unreachable through this
API; that is a data gap to report, not something the API papers over.

Inactive staff (`isActive = false`) return **404** unless the client has
`includeInactive = true`, in which case they are returned with
`person.isActive: false`.

### Status codes (standard `{ data, meta, error }` envelope)

`ApiError` codes are a closed union (`packages/shared/src/api/errors.ts`), so
no new codes are added; the specific reason travels in `error.details.reason`.

| HTTP | `error.code` | `details.reason` | When |
|------|--------------|------------------|------|
| 200 | — | — | Found |
| 400 | `VALIDATION_FAILED` | (Zod issues) | Not exactly one identifier; malformed or checksum-failing citizen ID; malformed email |
| 401 | `UNAUTHORIZED` | — | Missing, unknown, revoked or expired key, or disabled client. **Byte-identical body for all five.** |
| 403 | `FORBIDDEN` | `lookup_not_permitted` / `ip_not_allowed` | Client not granted this lookup type; caller IP outside allowlist |
| 404 | `NOT_FOUND` | — | No match (or inactive and not permitted). **Identical body whichever identifier was used.** |
| 429 | `RATE_LIMITED` | — | Per-client limit exceeded; `Retry-After` header set |
| 500 | `INTERNAL` | — | Unexpected; carries the request id, never the identifier |

## 4. Response

Keys are English. Names are bilingual. A section appears only if the client is
granted it; `person` is always present so a caller can confirm who came back.

```json
{
  "data": {
    "person": {
      "facultyMemberId": "cm…",
      "isActive": true,
      "title": { "th": "รองศาสตราจารย์", "en": "Associate Professor",
                 "abbrevTh": "รศ.", "abbrevEn": "Assoc. Prof." },
      "name": { "th": "…", "en": "…" },
      "email": "someone@kku.ac.th",
      "identifiers": { "orcid": null, "scopusAuthorId": "…",
                       "openalexAuthorId": null, "scholarProfileId": null }
    },
    "affiliation": {
      "faculty":    { "th": "…", "en": "…" },
      "department": { "th": "…", "en": "…" },
      "programmes": [ { "code": "KKU-SEQ-0057", "nameTh": "…", "nameEn": "…",
                        "level": "BACHELOR", "role": "COORDINATOR" } ]
    },
    "education": [ { "qualification": "…", "level": "…", "major": "…",
                     "institute": "…", "countryCode": "US", "yearBE": 2548,
                     "source": "unicon-ds2003" } ],
    "teaching": {
      "available": true,
      "windowYearsBE": { "from": 2565, "to": 2569 },
      "totals": { "studentsTaught": 1840, "sections": 42, "distinctCourses": 9,
                  "activeSemesters": 10, "avgContactHrsPerWeek": 11.5 },
      "byYear":  [ { "yearBE": 2569, "sections": 8, "studentsTaught": 360,
                     "contactHrsPerWeek": 22 } ],
      "courses": [ { "code": "…", "nameTh": "…", "nameEn": "…", "sections": 10,
                     "studentsTaught": 420, "firstYearBE": 2565, "lastYearBE": 2569 } ]
    },
    "research": {
      "basis": "google-scholar",
      "totalPapers": 28, "totalCitations": 412, "hIndex": 11,
      "earliestYear": 1998, "latestYear": 2026, "yearsActive": 29,
      "peakYear": 2021, "peakYearCount": 5,
      "topVenues": [ { "venue": "…", "count": 4 } ]
    },
    "publications": [
      { "year": 2026, "title": "…", "venue": "…", "type": "article",
        "citations": 3, "source": "google-scholar",
        "doi": null, "scopusId": null, "pmid": null, "scholarPaperId": "…",
        "authors": [ { "family": "…", "given": "…", "initials": null } ],
        "authorsComplete": false, "apa": "…" }
    ]
  },
  "meta": {
    "freshnessDate": "2026-09-29T02:10:00Z",
    "sources": [ … ],
    "methodologyVersion": "staff-profile.v1",
    "caveats": [ "studentsTaught is a sum of enrolled seats …", "hIndex is computed from …" ],
    "integration": {
      "apiVersion": "staff-profile.v1",
      "generatedAt": "2026-09-30T07:50:00Z",
      "publicationsCache": "hit",
      "sectionsIncluded": ["person", "affiliation", "education", "teaching", "research", "publications"],
      "sectionsWithheld": []
    }
  },
  "error": null
}
```

Field rules:

- **Section 1 → `person`, section 2 → `affiliation`.** `person.email` is included
  only when the client holds `allowEmailLookup`; otherwise it is `null`.
- **`research.basis`** is `"google-scholar"` or `"library"`, decided by the
  existing `hasScholarImport()` rule in `@kku/db` — the same rule the page uses.
  Each publication also carries its own `source` (`google-scholar`,
  `kku-publications:scopus`, `kku-publications:pubmed`, `openalex`, …, as stored
  on `ResearchOutput.source`). **`PublicationEntry` does not carry `source` or
  `scholarPaperId` today** — both are added to the shared type (additive; the
  page ignores them). A paper surfaced only by the live Scopus read, with no
  local row, reports `source: "live:<scopus|pubmed|isi|tci>"`.
- **Publications sort:** year desc, then citations desc, then title asc — a
  total order, so two calls return the same sequence.
- **Teaching returns every course in the window**, not the page's top 10. The
  limit becomes a parameter (`courseLimit`): the page passes 10, the API passes
  none.
- **`teaching.totals.studentsTaught` is Σ enrolled seats**, not distinct
  students: a student in two of the person's courses counts twice, exactly as on
  the page. A note in `meta.caveats` says so.
- **`meta` follows the shared `ApiMetaSchema`**, whose keys are fixed. It gains
  one optional block, `integration` (`apiVersion`, `generatedAt`,
  `publicationsCache`, `sectionsIncluded`, `sectionsWithheld`). Methodology notes
  ride in the existing `caveats`; `freshnessDate` is the publications cache's
  `fetchedAt`.
- **`meta.integration.publicationsCache`** ∈ `hit` | `stale` | `miss`. (A
  `degraded` state was considered and dropped: the enrichment pipeline swallows
  live-source failures internally and would need plumbing to report them. A
  live-source failure still yields a response from local rows.)
- **Deliberately excluded from v1:** the avatar (its URL needs a signed-in
  viewer), the AI expertise narrative (an AI output leaving the platform needs
  its own confidence and review story), the Teaching Talent stamp (a verdict,
  not one of the six sections). Each is additive later.
- **Versioning.** Adding a field keeps `staff-profile.v1`. Renaming or removing
  one moves to `v2`, served alongside `v1` until clients migrate.

## 5. Credentials, logging, admin console

### 5.1 Data model (one additive migration)

Creator columns are plain ids, not foreign keys: `@AuditLog()` already records
who made each change, and a relation would add back-relations on `User` for no
reader.

**`ApiClient`**

| Column | Notes |
|--------|-------|
| `id`, `name` (unique), `description`, `ownerContact` | |
| `status` | `ACTIVE` \| `DISABLED` |
| `allowedSections` | `text[]` ⊆ {`affiliation`,`education`,`teaching`,`research`,`publications`}; `person` is implicit |
| `allowCitizenIdLookup`, `allowEmailLookup` | booleans, default false |
| `includeInactive` | boolean, default false |
| `ipAllowlist` | `text[]` of CIDRs; empty = any |
| `rateLimitPerMinute` | int, default 60, 1–600 |
| `createdById`, `createdAt`, `updatedAt`, `lastUsedAt` | |

**`ApiClientKey`**

| Column | Notes |
|--------|-------|
| `id`, `clientId` (FK, cascade) | |
| `prefix` | first 16 chars of the key (`kpl_live_` + 7 random chars, 42 bits), unique — shown in UI, used for lookup; regenerate on the vanishingly rare collision |
| `keyHash` | SHA-256 hex of the full key. The key is 32 random bytes, so an unsalted hash is sound (unlike a citizen ID) |
| `expiresAt`, `revokedAt`, `revokedReason`, `lastUsedAt`, `createdById`, `createdAt` | |

Key format: `kpl_live_` + 43 chars base64url (32 bytes from `crypto.randomBytes`).
The plaintext exists only in the create response. Multiple unrevoked keys per
client are allowed — that is how rotation overlaps.

**`ApiRequestLog`**

| Column | Notes |
|--------|-------|
| `id`, `clientId`, `keyId`, `createdAt` | |
| `lookupType` | `CITIZEN_ID` \| `EMAIL` |
| `facultyMemberId` | nullable — the resolved record, null on miss |
| `status` | HTTP status returned |
| `sectionsReturned` | `text[]` |
| `latencyMs`, `ip`, `requestId` | |

**The log never stores the citizen ID, its hash, or the email.**
`hashCitizenId()` is unsalted over a ~2^43 keyspace (its own header says a
rainbow table is hours of GPU work), so storing the hash is storing the ID. The
resolved `facultyMemberId` tells an auditor who was looked up; a miss records
only that it missed. Retention: **365 days**, swept by the existing retention
job (`packages/db/src/retention.ts`); `docs/pdpa.md` gains the entry.

### 5.2 `ApiKeyGuard`

The codebase applies no guard with `@UseGuards`: every guard is a global
`APP_GUARD` that no-ops unless its route metadata is present. `ApiKeyGuard`
follows that pattern — registered in `AppModule` directly after `JwtAuthGuard`,
active only on routes carrying `@ApiKeyAuth()`. The route is also `@Public()`,
because `JwtAuthGuard` would otherwise try to verify the API key as a JWT (it
reads any `Authorization: Bearer`). Order of checks:

1. Parse `Authorization: Bearer kpl_live_…`; look up by `prefix`; compare
   SHA-256 with `crypto.timingSafeEqual`.
2. Key not revoked, not expired; client `ACTIVE`. Any failure → the single
   identical 401.
3. Caller IP (from `req.ip`, which honours `trust proxy`) inside `ipAllowlist`
   when non-empty → else 403 `ip_not_allowed`. **Allowlists are switched off
   by default** (decided 2026-09-30). nginx's `set_real_ip_from` still trusts
   RFC-1918 placeholder ranges, so any KKU-LAN host can name its own address
   in `X-Forwarded-For`; an allowlist checked against that would be
   decoration. The admin API refuses a non-empty allowlist unless
   `API_CLIENT_IP_ALLOWLIST=enabled`, and `scripts/preflight.sh` FAILS a
   deploy that enables it while the placeholders remain. The external nginx
   location also takes exactly one forwarded address (`real_ip_recursive off`,
   `X-Forwarded-For` overwritten).
4. Per-client fixed-window counter in Redis
   (`api-rl:<clientId>:<epochMinute>`, TTL 120 s) against
   `rateLimitPerMinute` → else 429. **Redis unavailable → count in process
   memory instead** (decided 2026-09-30, replacing fail-open: a leaked key
   during a Redis outage must not be able to walk the staff list by citizen
   ID). With one api container this is effectively exact. Only the first
   rejection in a window is written to the call log, so a client hammering
   past its limit cannot turn each call into a database write.
5. Lookup type permitted by the client → else 403 `FORBIDDEN` with `details.reason: lookup_not_permitted`
   (evaluated after body validation).

`lastUsedAt` on key and client is updated at most once a minute per key, so a
busy client does not write a row per request.

Pino redaction gains `req.body.citizenId` and `req.body.email`.

### 5.3 Admin console — `/admin/external/api-clients`

Gated by a new permission **`api_clients:admin`**, appended to `PERMISSIONS` in
`@kku/shared/auth/permissions.ts`. There is no `ADMIN` role: appending grants it
automatically to `SUPER_ADMIN` and `SYSTEM_ADMIN`, and to no other role.

- **List:** name, status, granted sections, lookup types, last used, requests
  (24 h / 30 d), 404 rate over 30 d.
- **Create client:** name, contact, description, section checkboxes, lookup
  types, include-inactive, IP ranges, rate limit. On save, a panel shows the
  first key **once**, with a copy button and a "this will not be shown again"
  warning.
- **Client detail (side panel):**
  - edit every setting;
  - **Keys:** issue a new key (optional expiry), revoke with a reason; during
    rotation both show as active;
  - **Usage:** 30-day requests by status, plus the last 100 calls (time, lookup
    type, resolved staff name, status, latency). A high 404 rate is the signal
    of a client guessing citizen IDs;
  - **Disable client** — blocks all its keys at once.
  - **How to call:** a `curl` example.
- Every mutation — create, edit, issue key, revoke, disable — goes through
  `@AuditLog()`. Audit payloads carry the key **prefix** only, never the key.

Integration guide for consumers: `docs/integrations/staff-profile-api.md`.

## 6. The refactor

Each step leaves `/profile` rendering identically.

1. **Types and APA helpers to `@kku/shared`.** `profile-types.ts` holds pure
   types and three pure functions that both the client component and the API
   need. They move to `packages/shared/src/staff-profile/types.ts`. The client
   imports that file by its **deep path**, never the `@kku/shared` barrel (which
   pulls `node:crypto`). `ProfileData` — which references `TeachingTalentStamp`
   from `@kku/db` — stays in `apps/web/src/lib/profile-types.ts`.
2. **Move the builder to `packages/db/src/staff-profile/`.** `teaching-profile.ts`,
   `scopus-publications.ts`, `external-publications.ts`, `kku-publications.ts`
   and the core of `profile-data.ts` move. `packages/db` gains `pg` and
   `@types/pg` (only `kku-publications.ts` needs them). The core becomes
   `buildStaffProfile(facultyMemberId, { courseLimit })`; the user→staff-record
   bridge becomes `resolveFacultyMemberForUser`. `getProfileData(userId)` and
   `getHomePublicationsSnapshot(userId)` stay in `apps/web` as thin wrappers.
3. **Publications cache keyed by staff record — a NEW table.**
   `user_publications_cache.user_id` is `NOT NULL` with a foreign key, so it is
   not altered. A new `staff_publications_cache` (unique `faculty_member_id`,
   cascade on staff-record delete) replaces it; the old table has no reader
   and is dropped in a later release. The Scholar runner's epoch-backdate
   invalidation moves to the new table, keyed by the staff record it already
   holds. **No backfill** — it is a cache. Side benefit: staff who never
   signed in become cacheable.
   **Guard for steps 1–3:** a dev-only snapshot script captures
   `getProfileData` output for a handful of real dev users with the cache
   forced cold, before and after; the outputs must match.
4. **API:** `ApiKeyGuard`, controller, Zod request/response schemas, section
   filter, request log.
5. **Admin console** and its NestJS controller.

### Operational consequences

- **The api container now makes the live Scopus / kkuscholar / OpenAlex calls**
  that only the web container made. It already loads `.env.prod`, which carries
  `KKU_SCOPUS_API_KEY`, `KKU_PUBLICATIONS_DB_*` and `OPENALEX_MAILTO`.
  **Confirm before deploy** that the api container can reach
  `10.130.2.151:5432` (ingestion already does, for `kku-research`).
- **Scopus institutional limit (20,000 requests/week).** Scopus-direct was kept
  profile-only on purpose. The API only adds load on cache misses, but one client
  walking every uncached staff member at the default 60/min could spend a few
  thousand calls. The integration guide says so, and the default limit stays
  conservative.

## 7. Error handling

- Live enrichment keeps its existing 8 s per-call timeouts and fallbacks. A
  failed live source yields a response built from local rows, not a 5xx.
- Unexpected errors → 500 envelope with the request id. No raw identifier
  appears in any log line or error message.

## 8. Testing

- **Guard:** valid key; wrong key; revoked; expired; disabled client; IP outside
  allowlist; lookup type not granted; rate limit. Wrong / revoked / expired /
  disabled produce **byte-identical** 401 bodies.
- **Input:** checksum pass/fail, dashes and spaces stripped, email case-folded,
  both identifiers, neither.
- **Section filter:** withheld sections absent from `data` and listed in
  `meta.sectionsWithheld`; `person.email` null without email permission.
- **404 parity:** identical body for a missed citizen ID and a missed email.
- **Request log:** the serialised row contains neither the raw citizen ID nor
  `hashCitizenId(raw)` — asserted by string search over the whole row.
- **Page ↔ API parity:** for one fixture member, the page's `research` and
  `publications` equal the API's.
- **Admin controller:** every mutation writes an audit row; no key plaintext in
  any audit payload; key plaintext returned only by create/issue.
- Key tests verified **by mutation** — break the code and watch the test fail.

## 9. Out of scope for v1

Bulk lookup, webhooks, AI narrative, avatar, Teaching Talent stamp, per-faculty
restriction of a client, OAuth2, mTLS.

## 10. Rollout

Verify on dev with `curl` against a real key issued from the admin console. No
release build unless explicitly requested.
