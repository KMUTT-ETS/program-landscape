# KKU Research & Academic Services (external grants)

**Slug:** `kku-research-services` · **Phase:** A · **Kind:** MySQL views (read-only) · **Cadence:** daily 04:00 · **Status:** real on dev (2026-10-02), not deployed

---

## What it is

Two views from the KKU Research Administration system: externally funded research and academic-service projects, and their co-investigators. The connector replaces two Postgres tables (`research_service_projects`, `research_service_project_members`) from them every day. They feed the Staff dashboard `/staff/grants`, the owner-only "Grants & academic service" panel on `/profile`, and the opt-in `grants` section of the external Staff Profile API. The health score does not read them yet.

Design: `docs/superpowers/specs/2026-10-02-research-service-grants-design.md`.

---

## Access

| | |
|---|---|
| Server | MySQL 5.7.42, KKU on-prem only. Host, database and login live in `KKU_RESEARCH_SERVICES_DB_*`, not in this repo |
| Driver | `mysql2` via the shared MySQL client, one connection per run |
| Auth | Read-only login |
| Env keys | `KKU_RESEARCH_SERVICES_DB_HOST`, `_PORT`, `_DATABASE`, `_USER`, `_PASSWORD`, `_SSL` (listed in `.env.prod.example`) |
| Session | `SET time_zone = '+07:00'` first, because `insert_date` is a TIMESTAMP |

### Operational gotcha: quote the password

`KKU_RESEARCH_SERVICES_DB_PASSWORD` contains `#`. Unquoted, Prisma's dotenv loader treats `#` as the start of a comment and truncates the value (19 characters became 5), and the login fails with "Access denied". **Always single-quote the value** in the dev and production env files, for example `KKU_RESEARCH_SERVICES_DB_PASSWORD='...'`. Do this before the first deploy.

---

## Views in scope

- `T_external_fund_View_landscape` is one row per project (4,291 when first sampled, 4,292 on the later runs). The funding type is always external (`ทุนภายนอก`), so the view holds external funding only. `proposal_type` is mostly บริการวิชาการ (academic service), then งานวิจัย (research), and a few consulting.
- `coproject_landscape` is one row per co-investigator (about 5,485 rows).

## Columns read

Explicit column lists, never `SELECT *`. Per project: `proposal_id`, `proposal_id_md5`, titles, type, budget year (BE) and project years, `proposal_budget_all` (THB), funder (`tax_name`), lead unit (`proposal_dept`), workflow state (`proposal_status2`), dates, lead display name. `acro` and `pmu_okr` are stored raw and not shown. Per co-investigator: `co_id`, the project key, `fullname`, `dept`, `kku_id`.

PDPA notes:

- The lead's Thai citizen id (`head_citizen`) is **hashed inside the SQL**: `SHA2` of the id with `-` and spaces stripped (MySQL 5.7 has no `REGEXP_REPLACE`). For digit ids this equals `hashCitizenId()`, which a fixture test asserts. Only the hash crosses the wire.
- The lead's email (`proposal_email`) is read for matching only and is never stored.
- Hash columns are PII-class and never leave the server. See `docs/pdpa.md`.

---

## Cadence and load

Daily at 04:00, after the UNICON syncs. The run fetches both views first, then replaces both tables in **one transaction** (`deleteMany` then `createMany` in chunks), so a fetch failure leaves the database untouched. No history is kept.

- **Row validation:** a bad row is skipped and counted. If more than 1 % of either view is invalid the run fails as `SCHEMA_DRIFT`.
- **Shrink guard:** if the fetched project count is under 50 % of the number of projects currently held in `research_service_projects`, the run throws `NonRetryableError` (`SNAPSHOT_SHRANK`) and the previous snapshot stays.
- **Duplicate people:** if a person appears twice on one project (lead and co-investigator), dashboard member counts and `teamSize` count them twice; the `/profile` summary dedupes per project.
- Connection and auth failures are retryable (3 attempts, exponential backoff).

## Matching to staff records

No fuzzy matching anywhere.

- **Leads:** by citizen-id hash against `faculty_members.citizen_id_hash`, falling back to lowercased KKU email. Measured on dev: **491 of 555 distinct people matched (88.5 %)**. 3,999 of 4,292 projects have a matched lead.
- **Co-investigators:** a 6-digit `kku_id` against the HR `employee_id`. Measured: **737 of 1,053 distinct 6-digit ids matched (70.0 %)**. 700 rows carry an id that is not 6 digits; they are kept unmatched with the source text in `sourcePersonKey`.
- **Faculty:** the matched member's faculty, otherwise exact `Faculty.nameTh` equal to the lead unit name. 50 projects have a lead unit that resolves to no faculty row. They are institutes and centres (อุทยานวิทยาศาสตร์, กองพัฒนาคุณภาพการศึกษา, สถาบันวิจัยเพื่อพัฒนาสังคม, and part of วิทยาลัยการปกครองท้องถิ่น) and keep the unit name.

## Measured on dev, 2026-10-02

3 SUCCEEDED runs, 6 to 8 s each, identical counts: 4,292 projects; 5,485 co-investigator rows fetched; 9,329 member rows loaded (7,620 matched to staff records); 0 invalid rows. Dashboard totals: 4,292 projects, THB 7.12 B total budget (each project counted once), 857 distinct matched staff.

---

## Visibility

- The dashboard follows the Staff dashboard faculty scope: university users see all, faculty users their own faculty, programme users are rolled up to their faculty. A project is visible when **any** team member is in scope, and its detail shows the whole team by name.
- `/profile` panel: owner only. Never on the public `/p/[slug]` page.
- API section `grants`: opt-in per client, never granted by default. It carries no co-investigator names, ids or hashes (only `teamSize`), and the budget is the whole-project budget.
- DSAR: both dump paths include `research_service_project_members` (found by lead hash or matched staff record).

## Caveats

- **Skew.** วิทยาลัยการปกครองท้องถิ่น (College of Local Government) holds about a third of all projects, mostly small service projects. Medicine holds the most money. State the skew wherever counts appear.
- **448 co-investigator rows reference a project that is not in the external-fund view.** They are dropped and counted as `coOrphansNotInView`.
- **`acro` and `pmu_okr` have unknown meaning.** `pmu_okr = 'ซ้ำPMU'` appears on 176 projects. If it marks duplicates, totals must exclude them before any health-score driver uses this data.
- **External funding only.** Internal grants are not in the views.
- **Faculty counts sum to more than the KKU total.** A faculty is credited with a project for every faculty that has a team member on it.
- **Budget is never split** among people or faculties. A person's figure is always labelled project total.
- **Unmatched people.** About 12 % of leads and 30 % of co-investigators do not link to a staff record, so per-person figures under-count.

## Open questions for KKU Research Administration

1. What do `acro` and `pmu_okr = 'ซ้ำPMU'` mean? If `ซ้ำPMU` marks a duplicate record, totals must exclude those projects before the health-score driver (Spec 2).
2. Do the 448 co-investigator rows outside the external-fund view belong to internal grants?

## Session log

- **2026-10-02** — flipped real on dev; 3 SUCCEEDED runs. The password needed single quotes (it contains `#`). Not deployed.
