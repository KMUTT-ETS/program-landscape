# KKU Human Resources

**Slug:** `kku-hr` · **Phase:** A · **Kind:** Microsoft SQL Server (read-only) · **Cadence:** weekly · **Status:** 🚧 wiring in progress (prompt 14, session opened 2026-04-27)

---

## What it is

KKU's HCM (Human Capital Management) system, surfaced as one denormalised mega-table. Used for:
- **`FacultyMember` rows** — per-person staff roster (rank, department, hire/retirement, qualification). Role-gated reads — COUNCIL sees aggregates only.
- **`FacultyCompensation` aggregates** — salary roll-ups per (department × rank × year), no per-person salary anywhere in our system.

PDPA-sensitive — much heavier than the registrar. Citizen ID, passport, salary, parental info, contact details all per row in the source. Aggregate-at-source for salary; PII columns omitted from the SELECT for `FacultyMember`.

## Access

| | |
|---|---|
| Engine | **Microsoft SQL Server 2019 (15.0.2130)** — distinct from the registrar's Oracle |
| Host | `10.101.104.192` |
| Port | `1433` (default; not specified in screenshot) |
| Database | `HCMEmployee` |
| Driver | `mssql` v11+ via `tedious` — pure JS, no native libs, no Dockerfile changes |
| JDBC URL (reference only) | `jdbc:sqlserver://10.101.104.192` |
| Auth | User + password — **read-only account** (NOT `sa`). DBA-superuser access was offered initially and declined — too privileged for an ingestion connector. |
| Credentials env vars | `KKU_HR_DB_HOST`, `KKU_HR_DB_PORT`, `KKU_HR_DB_DATABASE`, `KKU_HR_DB_USER`, `KKU_HR_DB_PASSWORD`, `KKU_HR_DB_ENCRYPT`, `KKU_HR_DB_TRUST_SERVER_CERT` |
| Encryption | **`encrypt=false`** — the SQL Server at this host is not configured for TLS on the connection. Internal KKU network only. |
| Network reachability | KKU internal — confirmed reachable from dev WSL2 host on the registrar session (same network) |
| Rate limits | None enforced; we self-limit to 1 concurrent connection, 30s request timeout |
| Concurrency we'll use | 1 |
| Request timeout | 30s per query, 120s total for the run |
| Data residency | KKU on-prem |

### Tables in scope

The HCM database has only one table relevant to us:

| Table | Purpose for us | PII level |
|---|---|---|
| `dbo.EmployeeDetail` | Single denormalised mega-table — 18,292 rows × ~70 columns. Source for both `FacultyMember` per-person rows and `FacultyCompensation` aggregates. | **HIGH** — citizen ID, passport, tax ID, social security ID, full name, full birthdate, salary fields, contact phone, email |

Other databases visible to the connection (`epm_report`, `ERPDATA`, `ERPPowerBI`, `INTEGRATION`, `report-web`, `SSISDB`, `StudentData`, `Sup_Reg`) are out of scope for this session.

## Data shape (real source)

`dbo.EmployeeDetail` is exported from KKU's HCM with **all columns as `nvarchar(500)`** — even dates and salary are stored as strings. Type coercion happens in the connector's transform layer. Sample columns observed (full schema captured in the discovery fixture):

| Column | Likely meaning | Type | Notes |
|---|---|---|---|
| `PERSON_NUMBER`, `EMPLOYEEID` | Internal employee key | text | We hash before storing — `SHA256(EMPLOYEEID)` becomes our `FacultyMember.employeeCode`. |
| `ID_PEOPLE` | Thai citizen ID (13 digits) | text | **NEVER pulled.** |
| `PASSPORT_NO`, `IDTAX`, `IDSOC` | Passport / Tax ID / Social Security ID | text | **NEVER pulled.** |
| `EMP_PREFIX`, `FNAME`, `LNAME` | Thai prefix + name | text | Pulled — landed in `nameTh` (concat). Role-gate at read time. |
| `EFNAME`, `ELNAME` | English name | text | Pulled — landed in `nameEn`. Role-gate at read time. |
| `STATUS` | Employment status code | text | Used to derive `isActive`. Distinct values catalogued via `pnpm hr:capture counts`. |
| `JOB`, `TDESC`, `PL`, `SUBGRADE`, `EMP_POSITION`, `EMP_LEVEL`, `EMP_GROUP` | Position / rank / grade fields | text | **One of these is canonical for `rank`** — discovery pass identifies which. |
| `BU1`–`BU7` | 7-level Business Unit hierarchy | text | One level = Faculty, another = Department. **Discovery identifies which is which.** |
| `BRANCH`, `COSTCENTER`, `WORKAREA` | Other org dimensions | text | Likely supplementary. |
| `EMP_TYPE`, `Assignment_Category`, `Budget_Type` | Distinguishes academic vs support vs hospital vs contract | text | **Critical for the academic-staff filter.** |
| `FIRSTHIREDATE`, `STARTDATE`, `APPROVE_DATE`, `PRODATE` | Hire timeline (`'YYYY-MM-DD'` text) | text | One is canonical for `hireDate` — discovery confirms which. Note: dates are CE format already (NOT BE like the registrar). |
| `BIRTHDAY` | Date of birth | text | Pulled only as YEAR (we don't need full DOB). |
| `ENDWORKDATE`, `RESIGNDATE`, `RESIGNREASONID` | Departure | text | Used for `isActive` + `retirementDate`. |
| `SEX`, `STATMARRY`, `EMP_NATIONAL`, `ALIEN` | Demographics | text | Aggregable; not required for v1. |
| `EMAIL`, `CONTACTPHONENO` | Contact info | text | **NEVER pulled.** |
| `SALARY`, `RECEIVE`, `OLDSALARY`, `OLDEVERY`, `LSTCHGINC`, `OLDCURRENCY`, `CURRENCY`, `CURCHGINC` | Salary fields | text | **AGGREGATE-AT-SOURCE ONLY.** Used in Q2 with `GROUP BY` — never pulled per-row. |
| `BOSS_ID`, `CONTRACTNO`, `DOC_NO`, `IDEXPDATE` | Misc admin fields | text | Out of scope. |

### Discovery findings (live, 2026-04-28)

`HCMEmployee.dbo.EmployeeDetail` is opaque on its own — every dimension is a 5-digit numeric code with no embedded label. **The decoder lives in the sibling database `epm_report`** on the same SQL Server, accessible via cross-database queries.

| Question | Answer | Source |
|---|---|---|
| Total employees | 18,296 | HCMEmployee |
| Active filter | `STATUS = 'A'` (11,389 active) | HCMEmployee |
| Faculty/department code → name | 100% coverage on BU1 (30 of 30 KKU faculties + offices); deeper BU2/BU3 also covered | `epm_report.dbo.Faculty` (2,787 rows) — `Alias_Default = "code - ชื่อ"` |
| Position/rank code → name | 99.75% coverage (11,362 / 11,390 active) — direct JOIN | `epm_report.dbo.workforce_hcm_actual` (18,176 rows) — per-employee snapshot |
| Academic-staff filter | `w.All_Position_Types IN (N'วิชาการ', N'วิจัย', N'บริหาร')` — 2,606 active | `workforce_hcm_actual.All_Position_Types` |
| Rank parsing | Split `POSITION_LEVEL` on `-` → take first segment | `workforce_hcm_actual.POSITION_LEVEL` (e.g., `อาจารย์-พนักงานมหาวิทยาลัย`) |
| Dates | CE format already (no BE conversion) | `BIRTHDAY` 1932-2006, `STARTDATE` 1966-2026 |
| Canonical hire date | `STARTDATE` — not `FIRSTHIREDATE` (latter has a 2025 bulk-stamp anomaly suggesting system migration) | HCMEmployee |
| Person hash for cross-system join | `SHA256(ID_PEOPLE)` — Thai citizen ID, hashed server-side via `HASHBYTES` so raw never crosses the wire | per user confirmation 2026-04-28 |
| Useless columns (per discovery) | `Assignment_Category`, `Budget_Type`, `STATMARRY` — all 100% NULL/blank | counts.json |
| `PRODATE` is unusable | values `0`, `31`, `61`, `92`, `181`, `334` — not dates | date-ranges.json |

The active rank breakdown (academic + research + executive) from `POSITION_LEVEL`:

| Rank | Personnel-type suffix | Count |
|---|---|---|
| อาจารย์ (Lecturer) | พนักงานมหาวิทยาลัย | 810 |
| ผู้ช่วยศาสตราจารย์ (Asst Prof) | พนักงานมหาวิทยาลัย | 691 |
| รองศาสตราจารย์ (Assoc Prof) | พนักงานมหาวิทยาลัย | 538 |
| ศาสตราจารย์ (Prof) | พนักงานมหาวิทยาลัย | 75 |
| ผู้ช่วยศาสตราจารย์ | ข้าราชการ | 62 |
| รองศาสตราจารย์ | ข้าราชการ | 55 |
| (other academic ranks) | mixed | ~370 |

### Aggregation contract

Two queries per run, **different PDPA posture each**. Both JOIN to `epm_report.dbo.workforce_hcm_actual` to resolve position. Cross-database COLLATE clause required (HCMEmployee uses `Thai_CS_AI`, epm_report uses `Thai_CI_AS`).

**Q1 — Per-person `FacultyMember` rows** (PII columns deliberately absent from projection):

```sql
SELECT
  -- Identity hashes (no raw PII crosses the wire)
  CONVERT(varchar(64), HASHBYTES('SHA2_256', CAST(e.EMPLOYEEID AS varbinary(500))), 2) AS EMPLOYEE_HASH,
  CONVERT(varchar(64), HASHBYTES('SHA2_256', CAST(e.ID_PEOPLE  AS varbinary(500))), 2) AS PERSON_HASH,

  -- Names — role-gated downstream (COUNCIL gets aggregates only)
  e.EMP_PREFIX, e.FNAME, e.LNAME, e.EFNAME, e.ELNAME,
  -- citizen ID, passport, tax/social IDs, email, phone DELIBERATELY ABSENT

  -- Status + dates (CE format)
  e.STATUS,
  LEFT(e.BIRTHDAY, 4)          AS BIRTH_YEAR,            -- year only, not full DOB
  e.STARTDATE,                                            -- canonical hire date
  e.RESIGNDATE,                                           -- null for active
  e.ENDWORKDATE,

  -- Org keys (resolved via Faculty lookup downstream)
  e.BU1, e.BU2, e.BU3, e.BU4,

  -- Position info from workforce_hcm_actual bridge (99.75% coverage)
  w.POSITION                   AS POSITION_TH,
  w.POSITION_LEVEL             AS POSITION_LEVEL_RAW,    -- "<rank>-<personnel_type>"
  w.JOB_CODE                   AS JOB_CODE,
  w.All_Position_Types         AS POSITION_TYPE,         -- วิชาการ / วิจัย / บริหาร / สนับสนุน
  w.JOB_FAMILY                 AS JOB_FAMILY
FROM dbo.EmployeeDetail e
INNER JOIN [epm_report].[dbo].[workforce_hcm_actual] w
  ON e.EMP_POSITION COLLATE Thai_CI_AS = w.POSITION_NUMBER COLLATE Thai_CI_AS
WHERE e.STATUS = 'A'
  AND w.All_Position_Types IN (N'วิชาการ', N'วิจัย', N'บริหาร')
```

**Q2 — Salary aggregates per (faculty × department × rank × year)** (no PII at all):

```sql
SELECT
  e.BU1                                            AS FACULTY_KEY,
  CASE WHEN e.BU2 IS NULL OR e.BU2 = ''
       THEN NULL ELSE e.BU2 END                    AS DEPARTMENT_KEY,
  w.POSITION_LEVEL                                 AS POSITION_LEVEL_RAW,
  LEFT(e.STARTDATE, 4)                             AS START_YEAR,
  COUNT(*)                                         AS HEADCOUNT,
  SUM(TRY_CAST(e.SALARY AS decimal(18,2)))         AS SUM_SALARY,
  AVG(TRY_CAST(e.SALARY AS decimal(18,2)))         AS MEAN_SALARY,
  MIN(TRY_CAST(e.SALARY AS decimal(18,2)))         AS MIN_SALARY,
  MAX(TRY_CAST(e.SALARY AS decimal(18,2)))         AS MAX_SALARY
FROM dbo.EmployeeDetail e
INNER JOIN [epm_report].[dbo].[workforce_hcm_actual] w
  ON e.EMP_POSITION COLLATE Thai_CI_AS = w.POSITION_NUMBER COLLATE Thai_CI_AS
WHERE e.STATUS = 'A'
  AND w.All_Position_Types IN (N'วิชาการ', N'วิจัย')
GROUP BY e.BU1, e.BU2, w.POSITION_LEVEL, LEFT(e.STARTDATE, 4)
HAVING COUNT(*) >= 5                              -- suppress single-individual cells
```

**Q3 (auxiliary) — Faculty lookup** loaded once per run:

```sql
SELECT DISTINCT Faculty AS BU_CODE, Alias_Default AS LABEL_TH, Parent
FROM [epm_report].[dbo].[Faculty]
ORDER BY Faculty
```

`Alias_Default` is the canonical `code - ชื่อ` form. Parent encodes hierarchy: `Parent = 'Faculty-NN'` rolls a sub-unit up to faculty NN; `Parent = 'BU_NN'` is the immediate org-tree parent. We use the `Faculty-NN` rollup for our `Faculty` resolution.

## Mapping to our schema

### `FacultyMember` (existing model)

Per-person; role-gated at read time (existing pattern from prompt 06 — COUNCIL sees aggregates only).

| Our `FacultyMember` column | HCM source | Notes |
|---|---|---|
| `employeeCode` | `SHA256(EMPLOYEEID)` truncated to 32 hex chars | Hash; never stores raw HCM employee ID |
| `nameTh` | `EMP_PREFIX + ' ' + FNAME + ' ' + LNAME` | Stored; visibility-gated |
| `nameEn` | `EFNAME + ' ' + ELNAME` | Stored; visibility-gated |
| `rank` | `<canonical>` (decided after discovery) → mapped via `RANK_MAP` to existing `FacultyRank` enum | Discovery-driven; map updates via PR |
| `facultyId` | `<faculty BU>` resolved via bridge table (similar to `RegistryProgramMapping`) | Need a `HrOrgMapping { hrFacultyKey, hrDepartmentKey → facultyId, departmentId? }` |
| `departmentId` | `<department BU>` resolved via same bridge | Optional; depends on data |
| `dateOfBirth` | derived from `LEFT(BIRTHDAY, 4)` only (year, then 1st of year) | Year-precision; we don't store full DOB |
| `hireDate` | `<canonical hire>` parsed (YYYY-MM-DD) | Likely `FIRSTHIREDATE` |
| `retirementDate` | If `RESIGNDATE` populated → that; else null | Active employees: null |
| `isActive` | derived from `STATUS` + presence of `ENDWORKDATE`/`RESIGNDATE` | Boolean |
| `academicQualification` | TBD — may need separate query if HCM has degree info | Scope decision pending |

**Deferred** (not in scope for v1):
- `specialization` — needs a separate qualification/expertise field; HCM mega-table doesn't expose research areas.
- Per-person salary on `FacultyMember` — never. Salary lives only in aggregate form on `FacultyCompensation`.

### `FacultyCompensation` (NEW model, to be added in Phase 1)

Aggregate per (faculty × department × rank × year). One row per cell with `HEADCOUNT >= 5` (smaller cells suppressed at the source). Used by the cost-allocation methodology — see `docs/methodologies/cost-allocation.md`.

Schema (proposed; finalised in Phase 1 after discovery):

```prisma
model FacultyCompensation {
  id            String   @id @default(cuid())
  facultyId     String   @map("faculty_id")
  departmentId  String?  @map("department_id")
  rank          FacultyRank
  fiscalYear    Int      @map("fiscal_year")
  headcount     Int
  sumSalary     Decimal  @map("sum_salary") @db.Decimal(14, 2)
  meanSalary    Decimal  @map("mean_salary") @db.Decimal(14, 2)
  minSalary     Decimal  @map("min_salary") @db.Decimal(14, 2)
  maxSalary     Decimal  @map("max_salary") @db.Decimal(14, 2)
  freshnessDate DateTime @map("freshness_date") @db.Date
  methodologyVersion String @default("kku-hr.v1") @map("methodology_version")
  createdAt     DateTime @default(now()) @map("created_at")
  updatedAt     DateTime @updatedAt @map("updated_at")

  faculty    Faculty     @relation(fields: [facultyId], references: [id], onDelete: Cascade)
  department Department? @relation(fields: [departmentId], references: [id], onDelete: SetNull)

  @@unique([facultyId, departmentId, rank, fiscalYear])
  @@index([facultyId])
  @@index([fiscalYear])
  @@map("faculty_compensation")
}
```

## Backfill plan

- **Horizon:** all rows with `STARTDATE` ≥ 2000-01-01 (one full institutional cycle of pre-retirement-age employees plus full alumni-faculty history). Older rows are kept in HCM for record-keeping; we don't need them for analysis.
- **Chunking:** one query per Q1 + one per Q2 — table is 18k rows, queries return <100k rows even after grouping. No chunking needed.
- **Sanity check:** Q1 academic-only count matches KKU's published academic-staff headcount (~3,700–4,000) within 5%. Q2 sum salary matches KKU Finance Office's annual academic-payroll figure (loose alignment; numbers will not match exactly because Finance includes allowances + bonuses outside the SALARY field).

## Monitoring after go-live

- Source-specific failure modes:
  - Connection refused → KKU network unreachable; analyst escalates to HR-IT.
  - SQL Server auth error → password rotation; rotate via HR-IT, update env / docker secret.
  - Column missing → HCM schema changed; re-run `pnpm hr:capture schema` and adjust the SELECT projection. **Connector throws `NonRetryableError` rather than silently dropping the column.**
  - Salary cell with `HEADCOUNT < 5` slipping through → suppression rule failed; flag in metadata + alert.
- **Freshness alert:** > 14 days since last successful run.
- **Validation error rate:** > 10% of fetched rows fail Zod validation → fail the run.
- **Drift fingerprint:** total `FacultyMember` count per fiscal year ± 2σ of 30-day baseline; mean-salary per (faculty, rank) ± 2σ.

## Contact

| Role | Person | Contact |
|---|---|---|
| Owning division | KKU HR Office | _tbd — need named contact_ |
| Technical contact | KKU HR-IT | _tbd_ |
| Escalation | KKU CIO / HRIS lead | _tbd_ |
| Internal owner (this project) | Denpong Soodphakdee | denpong@kku.ac.th |

## PDPA posture

**Personal data categories carried by `dbo.EmployeeDetail`:** Thai citizen ID (`ID_PEOPLE`), passport (`PASSPORT_NO`), tax ID (`IDTAX`), social security (`IDSOC`), full names (Thai + English), full date of birth, contact phone, personal email, full salary history, marital status, parental info, current employment status, full employment timeline.

**Personal data this connector reads:** for `FacultyMember`: hashed employee key + name (Thai + English) + employment dates (year-precision for birth, full-precision for hire/retirement) + status + rank + department key + employment type. For `FacultyCompensation`: aggregates only — no row-level data crosses the SQL boundary.

**Personal data this connector NEVER reads:** citizen ID, passport, tax ID, social security ID, contact phone, personal email, parental info, marital status, full date of birth (year-only), per-person salary.

**Legal basis (PDPA §24):** §24(4) — necessary for the legitimate interests of the controller (university governance and Council-level strategic decision-making). Internal KKU data flow under PDPA §27 (university-internal transfer between Registrar / HR Office / Council).

**Retention:** `FacultyMember` rows kept while the employee is active or has departed within the last 5 years. After 5 years post-departure, name fields are nulled and the row marked `isActive: false` permanently. `FacultyCompensation` aggregates are retained indefinitely (no individual is identifiable in them due to the `HEADCOUNT >= 5` suppression rule).

**Cross-border transfer:** None. KKU on-prem.

**DPO sign-off:** _required before flipping `CONNECTOR_KKU_HR_MODE=real` in production._ The DPO review needs to confirm: (a) the SQL projection list is exhaustive — i.e., no PII column accidentally pulled; (b) the suppression rule (`HEADCOUNT >= 5`) is acceptable; (c) role-gating on `FacultyMember` reads is enforced at the API layer.

## Known issues

_(log dated entries as they come up)_

- **2026-04-27** — Engine is Microsoft SQL Server 2019 (15.0.2130), not Oracle. Different driver (`mssql` vs `oracledb`), different SQL dialect, different connection string. `apps/ingestion/src/lib/mssql-client.ts` is the helper.
- **2026-04-27** — Initial credential offered was `sa` (DBA superuser). Declined; awaiting a dedicated read-only account (`db_datareader` role on `HCMEmployee` only).
- **2026-04-27** — All HCM columns are `nvarchar(500)` including dates and salary. `TRY_CAST` is needed for numeric coercion in SQL; `parseFloat` + null-guard in TS.
- **2026-04-27** — No graduation date / faculty research output / publication info in this table — out of scope; will be filled by `kku-research` and a future qualifications-source session.

## Session log

- **2026-04-27 (Phase 1 prep — Claude)** — spec stub filled with everything we know from the connection screenshot + column dump. `mssql@^11.0.1` added to `apps/ingestion/package.json`. `KKU_HR_DB_*` block added to `.env.example` with `encrypt=false` per the on-network non-TLS posture. `apps/ingestion/src/lib/mssql-client.ts` written (parallel to oracle-client.ts). `apps/ingestion/src/scripts/capture-hr-sample.ts` written with 5 discovery subcommands (`schema/counts/org-tree/positions/date-ranges`). `pnpm hr:capture` script entry added. **Awaiting read-only credential before Phase 2.** Phase 2 = run discovery; Phase 3 = design the actual Q1/Q2 SQL based on what discovery reveals; Phase 4 = connector + 3 green runs + DPO sign-off.

- **2026-04-28 (Phase 2 discovery — Claude)** — Endpoint changed to `10.101.104.192`. Read-only credential delivered, ran `pnpm hr:capture all` clean (5 fixtures: schema/counts/org-tree/positions/date-ranges). Discovered `Assignment_Category` and `Budget_Type` are 100% NULL in this DB — the spec's proposed academic-staff filter doesn't work here. Added 4 more discovery subcommands: `sibling-dbs` (metadata scan across 7 visible DBs — `epm_report` revealed as a goldmine of 122 lookup tables), `lookups` (pulled `Personnel_Type` 10 rows / `all_position_type` 6 rows / `job_families` 19 rows / `positions` 512 rows / `Faculty` 2,787 rows / distinct workforce.FACULTY 397 / Recruiting_Position.BU_NAME 130 — all reference data, no PII). User confirmed `BU_CODE` related to `epm_report.dbo.Faculty` table. Verified 100% BU1 coverage in Faculty table (30 of 30 KKU faculties). Added `bridge-probe` subcommand — first attempt JOINed to `workforce_current_position_request_Final` and only matched 23% (it's a budget-planning table, not full HR snapshot). Added `job-lookup` subcommand listing all 128 epm_report tables with row counts + JOB/POSITION column hits — found `workforce_hcm_actual` (18,176 rows ≈ HCMEmployee's 18,296). Added `hcm-actual` subcommand which confirmed: **99.75% JOIN coverage** (11,362 / 11,390 active employees match on raw `EMP_POSITION = POSITION_NUMBER`, no prefix needed); `All_Position_Types` filter gives 2,535 วิชาการ + 34 วิจัย + 37 บริหาร = 2,606 active academics; `POSITION_LEVEL` parses cleanly as `<rank>-<personnel_type>`; comprehensive 807 (JOB_CODE, POSITION) pairs covering all 548 distinct JOB codes. **Q1/Q2 SQL design locked.** All 9 fixtures committed to `apps/ingestion/test/fixtures/kku-hr/` (aggregate-only, suppression applied, safe in git). Cross-database queries require `COLLATE Thai_CI_AS` clause (HCMEmployee=Thai_CS_AI, epm_report=Thai_CI_AS — different collations). User confirmed `ID_PEOPLE` is the Thai citizen ID, the canonical cross-system join key — connector hashes server-side via `HASHBYTES('SHA2_256', CAST(ID_PEOPLE AS varbinary(500)))` so raw value never leaves the wire. **Phase 3 = Prisma migration (FacultyCompensation + HrFacultyMapping bridge) + connector + 3 green runs + DPO sign-off.**
