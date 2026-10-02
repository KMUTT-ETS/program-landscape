# Research & academic service grants — design (Spec 1 of 2)

**Date:** 2026-10-02 · **Status:** approved in brainstorming, awaiting spec review
**Spec 2 (later, separate):** a Program Health Score driver built on this data, with a
`HEALTH_SCORE_VERSION` bump. Not in scope here.

## 1. Purpose

KKU's Research and Academic Services system (MySQL, `10.101.106.65`) records every
externally-funded research and academic-service project, with its lead and co-investigators.
This spec brings it into Program Landscape with a daily sync and surfaces it in three places:

1. A Staff dashboard, **Research & Academic Service Grants** (`/staff/grants`).
2. The owner's own `/profile`.
3. A new opt-in section `grants` in the external Staff Profile API.

The Education hub gets nothing new (decided: one Staff view, no duplicate).

## 2. Source, as measured on 2026-10-02

MySQL **5.7.42**, two views, read-only login, env prefix `KKU_RESEARCH_SERVICES_DB`
(`_HOST/_PORT/_DATABASE/_USER/_PASSWORD/_SSL`, already in dev `.env`).

**`T_external_fund_View_landscape`**: 4,291 rows, one per project.

- `proposal_id` (int) and `proposal_id_md5` (32 hex) are both unique.
- `research_type` is always `ทุนภายนอก`, so the view holds external funding only. `proposal_status` is always `project`.
- `proposal_type`: บริการวิชาการ 3,092, งานวิจัย 1,193, จ้างที่ปรึกษา 4, two singletons.
- `budget_year` (BE, never null; 2558–2570, mostly 2564–2569). `pro_bud_year` is null on 263 rows.
- `proposal_budget_all` (THB int; 3 null). `proposal_budget_all_text`, `proposal_start_date`,
  `proposal_expire_date`, `rtype2`, `budget_type2` are always empty and are ignored.
- `pro_start_date` / `pro_expire_date` are null on 263 rows.
- `tax_name` is the funder (null on 455). Top funders: สวทช. ITAP 719, วช. 214.
- `proposal_dept` is the lead's unit (33 values, faculty level, no department).
- `proposal_status2` is a workflow state (8 values). `keywords` is free text.
- Lead identity: `head_citizen` is the **raw Thai citizen ID** (13 digits, one 9-char outlier); `proposal_email` is always `@kku.ac.th`.
- Also present: `head_title`, `head_position_academic`, `proposal_head` (display name).
- `acro` (Yes 300 / No 3,991) and `pmu_okr` (`ซ้ำPMU` 176) have unknown meaning. They are stored raw and not shown.
- `resource_type` (numeric code, 1,481 distinct), `resource_type_other`, `Van_id`,
  `insert_date`, `accept_date`.

**`coproject_landscape`**: 5,484 rows, one per co-investigator.

- `co_id` (unique).
- `proposal_id` holds `proposal_id_md5` (32 chars). **5,036 rows join to the projects view and 448 do not.** The 448 are presumably projects outside the external-fund view.
- `fullname`; `dept` (null on 3,272).
- `kku_id` is 6 digits on 4,642 rows (1,097 distinct). The other ~840 rows have 1–4 char junk such as single digits.

**Skew to state wherever counts appear:** วิทยาลัยการปกครองท้องถิ่น holds 1,438 of 4,291
projects (34 %), mostly small service projects. Medicine holds the most money (฿3.74 B over 671).

**Identity match rates against dev `faculty_members`:**

| People | Method | Matched |
|---|---|---|
| Leads | hashed `head_citizen` → `citizen_id_hash` | 490 / 555 (88 %) |
| Leads | email → `kku_email` | 491 / 556 (88 %) |
| Co-investigators | `kku_id` (6-digit) → `employee_id` | 754 / 1,093 (69 %) |

## 3. Decisions

| # | Decision |
|---|---|
| D1 | Two specs. This one covers the connector, tables, dashboard, profile and API. The health-score driver comes later, after the data has been checked in the UI. |
| D2 | Staff hub only. No Education tile. |
| D3 | **Daily snapshot replace** (approach A). Each run replaces both tables in one transaction. No history is kept. |
| D4 | **Attribution: "count both, no money split".** A faculty is credited with a project for every faculty that has a team member on it, so faculty counts add up to more than the KKU total. Money is shown per project, and as a KKU total where each project counts once. It is never split among people or faculties. A person's budget figure is always labelled "project total". |
| D5 | **Visibility follows user scope.** The dashboard (including person-level rows) uses the existing staff-dashboard scope clamp: university users see all, faculty users see their own faculty, programme users see their programme's staff rolled up to their faculty. `/profile` panel: owner only. The public `/p/[slug]` view never shows grants. API: a per-client opt-in section. |
| D6 | The raw citizen ID never leaves MySQL. Email is used for matching and is not stored. |

**D5 refinement (2026-10-02, during implementation).** A project is visible on the dashboard when any team member is in the user's scope, and its detail view then shows the whole team by name, including members outside the scope, so a project is never shown with a truncated team.

**Per-person match rates, measured on dev after the first three runs.** Leads: 491 of 555 distinct people matched (88.5 %). Co-investigators: 737 of 1,053 distinct 6-digit ids matched (70.0 %), with 700 rows carrying a non-6-digit id. These supersede the sampling figures in section 2.

## 4. Data model

The migration is additive and hand-written per the repo workflow. It adds two tables and two enums.

```prisma
enum ResearchServiceProjectType { RESEARCH ACADEMIC_SERVICE CONSULTING OTHER }
enum ResearchServiceMemberRole  { LEAD CO_INVESTIGATOR }

model ResearchServiceProject {            // research_service_projects
  id                 String   @id @default(cuid())
  sourceProposalId   Int      @unique      // proposal_id
  sourceProposalKey  String   @unique      // proposal_id_md5
  titleTh            String
  titleEn            String?                // null when the source value is blank or 1 char
  type               ResearchServiceProjectType
  typeRaw            String                 // proposal_type verbatim
  fiscalYearBe       Int                    // budget_year
  projectBudgetYearBe Int?                  // pro_bud_year
  startDate          DateTime?              // pro_start_date
  endDate            DateTime?              // pro_expire_date
  budgetThb          BigInt?                // proposal_budget_all
  funderName         String?                // tax_name, trimmed
  keywords           String?
  workflowStatus     String                 // proposal_status2, trimmed
  leadUnitName       String                 // proposal_dept
  facultyId          String?                // resolved from leadUnitName
  acroRaw            String?
  pmuOkrRaw          String?
  submittedAt        DateTime?              // insert_date
  acceptedAt         DateTime?              // accept_date
  ingestionRunId     String
  members            ResearchServiceProjectMember[]
  @@index([fiscalYearBe]) @@index([facultyId]) @@index([type])
}

model ResearchServiceProjectMember {      // research_service_project_members
  id               String   @id @default(cuid())
  projectId        String   // FK cascade
  role             ResearchServiceMemberRole
  facultyMemberId  String?  // matched staff
  displayName      String?  // proposal_head (lead) / fullname (co)
  sourcePersonKey  String?  // co: kku_id verbatim; lead: null
  citizenIdHash    String?  // lead only, SHA-256 hex, PII-class
  unitName         String?  // lead: proposal_dept; co: dept
  facultyId        String?  // matched member's faculty, else resolved from unitName
  ingestionRunId   String
  @@index([facultyMemberId]) @@index([projectId]) @@index([facultyId])
}
```

`type` mapping: งานวิจัย → RESEARCH, บริการวิชาการ → ACADEMIC_SERVICE, and จ้างที่ปรึกษา →
CONSULTING. Anything else, including the MOU and ศูนย์รวมผู้เชี่ยวชาญ singletons, maps to OTHER. `typeRaw` keeps the source text.
`citizenIdHash` columns are PII-class per `hash-citizen-id.ts`: they are never sent to the client and never returned by the API.

## 5. Connector `kku-research-services`

- **Catalog entry** (`packages/shared/src/ingestion/catalog.ts`): `kind` internal, `inputFormat` DB,
  `cadenceCron '0 4 * * *'` (after the UNICON syncs at 02:00/03:00), `mocked: false`, owner
  KKU Research Administration. The deploy-time `sync-data-sources.js --apply` creates the
  `data_sources` row, with no manual step.
- **Folder** `apps/ingestion/src/connectors/sources/kku-research-services/`
  (`connector.ts`, `transforms.ts`, `index.ts`), class `KkuResearchServicesRealConnector extends
  ApiConnector`, registered in `registry.ts`. A mock entry is required by the registry shape and
  returns **no rows**, per the no-mock-data policy.
- **Fetch:** one `withConnection(configFromEnv('KKU_RESEARCH_SERVICES_DB'))`, two queries, and an
  explicit column list (no `SELECT *`).
  - The lead's citizen ID is hashed **in SQL**: `SHA2(REPLACE(REPLACE(TRIM(head_citizen),'-',''),' ',''), 256)`. MySQL 5.7 has no `REGEXP_REPLACE`.
  - For digit-only input this equals `hashCitizenId()`, which a fixture test asserts. Only the hash crosses the wire.
  - `proposal_email` is fetched for matching only and is never written.
  - Both queries run before any write, so a fetch failure leaves the database untouched.
- **Transform** (pure, Zod-validated): trim strings; blank or 1-char `titleEn` → null; map the type; BE years
  as ints; parse dates; drop co-investigator rows whose project key is not in the fetched project set
  and count them.
- **Match** (load phase, batch lookups, no per-row queries):
  - Leads: `citizen_id_hash`, falling back to lowercased `kku_email`.
  - Co-investigators: a 6-digit `kku_id` → `faculty_members.employee_id`. Anything else stays unmatched, with the source text kept in `sourcePersonKey`.
  - Faculty: the matched member's `facultyId`, otherwise exact `Faculty.nameTh` = unit name. There is no fuzzy matching.
- **Load:** one transaction. `deleteMany` both tables, then `createMany` in chunks with
  `ingestionRunId: ctx.runId`, so `realDataWhere()` passes.
- **Near-empty guard:** if the fetched project count is under 50 % of the last SUCCEEDED run's,
  throw `NonRetryableError` before the transaction. The previous snapshot stays.
- **Run metadata:**
  - rows fetched for each view;
  - lead and co-investigator match counts and rates;
  - the count of co-investigators whose project is missing;
  - the count of unmatched unit names, with up to 20 sample **unit names**. People never appear here.
- **Errors:** connection or auth failures are retryable (BullMQ: 3 attempts, exponential). Zod or schema drift raises a
  `NonRetryableError`.

## 6. Query layer

`packages/db/src/research-services.ts`, explicit return types, all reads through `realDataWhere()`:

- `getGrantsDashboard(filters, scope)` returns:
  - KPIs: project count, total budget with each project counted once, distinct matched staff, and match coverage;
  - a fiscal-year trend split by type;
  - a by-faculty table with `led` / `coOnly` / `total` and a `sumExceedsTotal: true` flag;
  - top funders;
  - one page of projects.
- `getGrantProjectDetail(projectId, scope)` returns the project and its full team.
  - A project is visible when any team member, lead or co-investigator, falls in the caller's scope. A visible project shows its whole team by name.
  - An out-of-scope id returns 404.
- `getStaffGrants(facultyMemberId)` is the person loader for `/profile` and the API, re-exported from `staff-profile/`.
- Filters: `facultyName[]`, `yearFrom`, `yearTo`, `type[]`, `funder[]`, `page`, and `sort`.
- Scope for programme users goes through `ProgramFaculty`, rolled up exactly as the existing `clampFacultyNameFilter` already does.
- **No nested `Prisma.sql` fragments.** `/profile` calls the person loader inside Next.js, so use plain NULL-guarded parameters (trap recorded 2026-10-01).

## 7. Staff dashboard `/staff/grants`

- **Wiring:** web page `apps/web/app/staff/grants/{page,client}.tsx` → `GET /staff-dashboard/grants` and
  `GET /staff-dashboard/grants/:id` in `staff.controller.ts`.
  - Both use `@Authorized('institution:read:dashboard')`, `assertCanSeeFacultyDashboards` and `clampFacultyNameFilter`, then `StaffService` → the query layer.
  - The Redis cache key includes the latest run id, so a new sync invalidates it.
- **Hub tile:** "Research & academic service grants" in `apps/web/app/staff/page.tsx` `TILES`, with a new
  `GrantsThumb` in `thumbnails.tsx`.
- **Layout**, following the approved evidence-page design language:
  1. KPI strip: projects · total budget · staff involved · match coverage.
  2. Fiscal-year trend: project count and budget, research vs academic service.
  3. By faculty: led vs co-investigator-only. A permanent line says faculty counts include every faculty with a team member, so they sum to more than the KKU total.
  4. Top funders.
  5. Project table: title, type, year, lead, funder, budget, team size, status. A row opens a Linear-style side panel with the full team.
- **On every chart:** `<ProvenanceButton>` with the source, last sync, match coverage, "budget is the project total, not split", and the Local Government College skew note. Also `<FreshnessBadge>` and `<DataSourceMark source="kku-research-services">`.
  - Add the slug to `DATA_SOURCE_MARKS`, plus an acknowledgements registry entry; a test enforces the acknowledgements entry.
- Design tokens only. Verify classes against the compiled stylesheet (`border-border-*` and bare `rounded` emit nothing).

## 8. `/profile` panel

- `apps/web/app/profile/grants-panel.tsx` is rendered by `profile-view.tsx` when `!publicMode`, after Teaching and
  before Publications. Loaded in `page.tsx` alongside the evaluation via a new
  `getMyGrants(userId)` in `apps/web/src/lib/profile-data.ts`, with `.catch → 'unavailable'`.
- **Content:**
  - KPIs: led · co-investigator · active, where today falls in [start, end].
  - A list, newest fiscal year first: role chip, type chip, title (Thai, English underneath), funder, fiscal year, dates, status, and budget labelled "project total".
- **States:**
  - an unmatched person gets "We couldn't link you to the grants system";
  - no projects gets "No external grants on record";
  - a load error gets "Unavailable".
- The summary logic (counts, active) lives in browser-safe `packages/shared/src/staff-profile/grants.ts` (deep import path, not the barrel). The API uses the same code.

## 9. External API section `grants`

- Add `grants` to `STAFF_PROFILE_SECTIONS` with a label, and a Zod schema in `api-schema.ts`:
  - summary `{ led, coInvestigator, active, byType }`;
  - `projects[]` with `{ sourceProposalId, titleTh, titleEn, type, role, fiscalYearBe, startDate, endDate, funderName, budgetThb, workflowStatus, teamSize }`.
  - It includes **no co-investigator names and no hashes**.
- Service and mapper follow the `teachingEvaluation` pattern: loaded only when granted, `withheld` otherwise, and a granted load failure returns 500.
- Admin `/admin/external/api-clients` gets a separate opt-in checkbox, unchecked by default.
- Docs: `docs/integrations/staff-profile-api.md` (section reference) and `docs/pdpa.md` (record the legal basis before granting).

## 10. Documentation

- `docs/data-sources/kku-research-services.md`: views, columns used, matching, measured rates, and caveats (skew, the 448 co-investigator rows outside the view, unknown `acro`/`pmu_okr`).
- `docs/pdpa.md`: SQL-side citizen hashing, email read but not stored, hash columns PII-class, and the API section.
- Acknowledgements entry; changelog at release.

## 11. Testing

Test-first for each task.

- **Transforms:**
  - type mapping and BE years;
  - null budget and dates;
  - `titleEn` blanking;
  - co-investigator id rules;
  - dropping co-investigators whose project is missing;
  - the SQL hash expression equal to `hashCitizenId` on fixture ids.
- **Load:**
  - replacement in a single transaction;
  - the 50 % guard (the previous snapshot is kept);
  - `ingestionRunId` on every row;
  - match precedence;
  - unit-name faculty resolution.
- **Query:**
  - faculty participation counts sum to more than the total;
  - the KKU budget counts each project once;
  - the scope clamp for faculty and programme users;
  - filters and pagination;
  - unmatched people never leak hashes.
- **Profile and API:**
  - summary maths;
  - mapper and service tests with the section granted and withheld;
  - admin checkbox;
  - schema test;
  - the panel's three states.
- **Live check on dev:**
  - 3 SUCCEEDED `pnpm connector:run kku-research-services` runs, with identical counts;
  - `/staff/grants` as admin and as a faculty user;
  - `/profile` for denpong;
  - an API call on `:4000` with `grants` granted and with it withheld.

## 12. Out of scope

- Health-score driver (Spec 2).
- Per-programme grants view.
- Budget splitting.
- Project history.
- Showing `acro`/`pmu_okr`.
- Internal (non-external) grants. They are not in the view.
- Letting faculty users open other staff members' profiles.

## 13. Open questions for KKU Research Administration

- What do `acro` and `pmu_okr = 'ซ้ำPMU'` mean? If `ซ้ำPMU` marks a duplicate of another record, totals should exclude those projects. This needs an answer before Spec 2.
- Do the 448 co-investigator rows outside the view belong to internal grants?
