# KKU Finance

**Slug:** `kku-finance` · **Phase:** A · **Kind:** Two-source: Oracle (KKU Registry POWERBI) + Microsoft SQL Server (KKU HR server, ERPPowerBI DB) · **Cadence:** monthly · **Status:** 🚧 wiring in progress (prompt 14, session opened 2026-04-28)

---

## What it is

Two halves of KKU's program-economics picture:

1. **Tuition revenue** (the income side, partial) — pulled from the **Oracle Registry** at the same endpoint as `kku-registry`. View `POWERBI.VIEWSTUDENTENROLLFEE` carries `(STUDENTID, STUDENTCODE, ACADYEAR, SEMESTER, AMOUNT)` per fee row; we JOIN to `POWERBI.VIEW_STUDENT_DETAIL_ALL` on `STUDENTCODE` to attribute each ฿ to (faculty × program × level × major × year). 100% join coverage observed.
2. **Budget allocation** (the expense side) — pulled from the **MSSQL HR server** at `10.101.104.192`, database `ERPPowerBI`, table `dbo.BudgetData`. Each row is a (division × cost-center × account × fund × project) line item with `TOTAL_BUDGET` (allocation), `TOTAL_COMMITMENT`, `TOTAL_OBLIGATION`, `TOTAL_EXPENDITURE`, `FUNDS_AVAILABLE`. Current fiscal year only (no historical years in this table).

KKU revenue mix observed in FY 2569 (CE 2026): ฿16.7B from `งบประมาณเงินรายได้` (university-generated, ~75%) + ฿5.6B from `งบประมาณเงินอุดหนุนจากรัฐ` (government subsidy, ~25%) + ~฿0.8B other = ฿23.1B total.

PII gate: tuition queries `GROUP BY` server-side and `HAVING COUNT(DISTINCT STUDENTCODE) >= 5` — the connector never sees per-student fee rows. Budget data has no per-person info.

This connector populates **raw inputs only**:
- `FinancialMetric.tuitionRevenue` per (program × year)
- A new `FacultyBudget` table per (division × fund × year)

Cost allocation to programs (the methodology that fills `directCost`, `allocatedFacultyCost`, etc.) is the **next-stage methodology layer** — out of scope for this connector. See `docs/methodologies/cost-allocation.md`.

## Access

| | |
|---|---|
| Oracle (registrar) | reuses `KKU_REGISTRY_DB_*` (powerbi read-only) — same as `kku-registry` |
| MSSQL (HR server) | reuses `KKU_HR_DB_*` (read-only) — same as `kku-hr`. ERPPowerBI is one of 7 DBs visible to this account. |
| Drivers | `oracledb` thin (Oracle); `mssql` v11 (MSSQL) — already installed for prior connectors |
| Network | KKU internal only |
| Concurrency | 1 per side |
| Request timeout | 60s |

### Tables in scope

**Oracle (`POWERBI` schema):**
| View | Purpose | PII level |
|---|---|---|
| `VIEWSTUDENTENROLLFEE` | per-fee row: STUDENTID, STUDENTCODE, ACADYEAR, SEMESTER, AMOUNT — **388,487 rows** spanning BE 2564–2569 (CE 2021–2026) | LOW (per-student fee history; we never `SELECT` it raw) |
| `VIEW_STUDENT_DETAIL_ALL` | reused from `kku-registry`. Provides FACULTYNAME, PROGRAMNAME, PROGRAMLEVEL, MAJOR per STUDENTCODE | LOW after JOIN |

**MSSQL (`ERPPowerBI.dbo`):**
| Table | Purpose | PII level |
|---|---|---|
| `BudgetData` | 12,375 rows × 32 cols. Per (DIVISION × COSTCENTER × ACCOUNT × FUND × PROJECT) line item. Current fiscal year only (BE 2569 = CE 2026). | NONE — no person-level info |

### Discovery findings (live, 2026-04-28)

**Tuition (Oracle):**
- 388,487 fee rows total, 6+ years of history (BE 2564 → BE 2569)
- 100% `STUDENTCODE` join coverage between fee view and student-detail view
- BE 2568 (CE 2025) full year: ~฿1.66B across 439 (program × year) cells, 36,944 distinct students
- Multiple `SEMESTER` values (1, 2, 3, 4) — semester 3/4 are summer / extra terms with much smaller volumes; sum across all semesters for annual revenue

**Budget (MSSQL ERPPowerBI.BudgetData):**
- 12,375 rows × 32 columns
- Snapshot of **current fiscal year only**: `BUDGET_PERIOD = "2569"` (BE) for all rows; `BUDGET_PERIOD_NAME = "Jan"` is the sync month, NOT a year
- 51 distinct DIVISION_NAME values; many are sub-units of a faculty (e.g., `คณะแพทยศาสตร์`, `คณะแพทยศาสตร์ - โรงพยาบาลศรีนครินทร์`, `คณะแพทยศาสตร์ - ศูนย์หัวใจสิริกิติ์`)
- Funds (`FUND_NAME`) — KKU's revenue-source split for the current year:
  - `งบประมาณเงินรายได้` (university revenue): ฿16.7B (11,830 rows) — 75%
  - `งบประมาณเงินอุดหนุนจากรัฐ` (government subsidy): ฿5.6B (422 rows) — 25%
  - `เงินนอกงบประมาณ` (off-budget funds): ฿531M (3 rows)
  - `เงินรับฝาก` (deposited funds): ฿185M (93 rows)
  - `งบกลาง Benefit` / `เงินเบิกแทน` / `งบกลาง Project`: <฿100M combined
- Top spending divisions (FY 2569):
  - `สำนักงานอธิการบดี` (Office of the President): ฿7.6B allocation
  - `คณะแพทยศาสตร์ - โรงพยาบาลศรีนครินทร์`: ฿7.6B (Srinagarind Hospital)
  - `คณะแพทยศาสตร์`: ฿2.6B (Faculty proper)
  - `คณะแพทยศาสตร์ - ศูนย์หัวใจสิริกิติ์`: ฿1.3B (Heart Center)
- Top spending categories: salaries ฿4.5B, drugs ฿2.9B, operational subsidy ฿2.6B, operating expenses ฿2.1B, allowances ฿1.9B
- Utilisation (actual vs budget) FY 2569 partial: 15-38% across faculties (early-year snapshot — Jan)

## Aggregation contract

### Q1 — Tuition per (program × ACADYEAR) (Oracle)

```sql
SELECT
  s.FACULTYNAME    AS FACULTY_NAME,
  s.PROGRAMNAME    AS PROGRAM_NAME,
  s.PROGRAMLEVEL   AS PROGRAM_LEVEL,
  s.MAJOR          AS MAJOR,
  f.ACADYEAR       AS COHORT_YEAR_BE,
  COUNT(DISTINCT f.STUDENTCODE) AS STUDENT_COUNT,
  SUM(f.AMOUNT)    AS TUITION_SUM
FROM POWERBI.VIEWSTUDENTENROLLFEE f
INNER JOIN (
  SELECT DISTINCT STUDENTCODE, FACULTYNAME, PROGRAMNAME, PROGRAMLEVEL, MAJOR
  FROM POWERBI.VIEW_STUDENT_DETAIL_ALL
) s ON s.STUDENTCODE = f.STUDENTCODE
WHERE s.FACULTYNAME IS NOT NULL AND s.PROGRAMNAME IS NOT NULL
GROUP BY s.FACULTYNAME, s.PROGRAMNAME, s.PROGRAMLEVEL, s.MAJOR, f.ACADYEAR
HAVING COUNT(DISTINCT f.STUDENTCODE) >= 5
```

Returns ~430 rows per fully-loaded year (e.g., 439 cells for BE 2568). Resolves to `programId` via the existing `RegistryProgramMapping` bridge (already populated by `kku-registry`). Rows that don't map are reported in `IngestionRun.metadata.unmappedSamples`.

### Q2 — Budget per (division × fund × fiscal year) (MSSQL)

```sql
SELECT
  DIVISION_NAME,
  FUND_NAME,
  CAST(BUDGET_PERIOD AS int)              AS FISCAL_YEAR_BE,
  BUDGET_PERIOD_NAME                       AS SNAPSHOT_NAME,
  SUM(TRY_CAST(TOTAL_BUDGET      AS decimal(18,2))) AS TOTAL_BUDGET,
  SUM(TRY_CAST(TOTAL_COMMITMENT  AS decimal(18,2))) AS TOTAL_COMMITMENT,
  SUM(TRY_CAST(TOTAL_OBLIGATION  AS decimal(18,2))) AS TOTAL_OBLIGATION,
  SUM(TRY_CAST(TOTAL_EXPENDITURE AS decimal(18,2))) AS TOTAL_EXPENDITURE,
  SUM(TRY_CAST(FUNDS_AVAILABLE   AS decimal(18,2))) AS FUNDS_AVAILABLE
FROM [ERPPowerBI].[dbo].[BudgetData]
WHERE DIVISION_NAME IS NOT NULL AND DIVISION_NAME != ''
GROUP BY DIVISION_NAME, FUND_NAME, BUDGET_PERIOD, BUDGET_PERIOD_NAME
```

Returns ~50 (DIVISION × FUND × YEAR) cells per current fiscal year. DIVISION_NAME → KKU `Faculty.id` resolved by **stripping ` - <suffix>` from the division name** then exact-matching against `Faculty.nameTh`. Divisions that don't match a faculty (central admin, etc.) get `facultyId = null` — the row still lands so we have the total spend record for transparency, but it doesn't roll up into faculty-level aggregates.

## Mapping to our schema

### `FinancialMetric` (existing model — partial upsert)

This connector populates **only** `tuitionRevenue` (and on first-create defaults the cost columns to 0 — they're filled by the cost-allocation methodology downstream).

| Our column | Source | Notes |
|---|---|---|
| `programId` | derived from `s.FACULTY_NAME + s.PROGRAM_NAME + s.PROGRAM_LEVEL + s.MAJOR` via `RegistryProgramMapping` | reused from kku-registry |
| `fiscalYear` | `f.ACADYEAR - 543` (BE → CE) | year-precision |
| `tuitionRevenue` | `SUM(f.AMOUNT)` | THB |
| `otherRevenue`, `directCost`, `allocatedFacultyCost`, `allocatedFacilityCost`, `allocatedOverhead`, `netContribution`, `costPerStudent` | sentinel zero on create; **omitted on update** so existing values from the cost-allocation methodology survive | partial upsert pattern; same as kku-registry |
| `methodologyVersion` | `kku-finance.v1` | |
| `freshnessDate` | run timestamp | |

### `FacultyBudget` (NEW model, added by this session)

Per (division × fund × fiscal year). Stores raw budget data at the division level — does NOT cascade to programs (that's the methodology layer).

```prisma
model FacultyBudget {
  id                 String      @id @default(cuid())
  facultyId          String?     @map("faculty_id")            // null when division isn't a faculty (central admin, hospitals)
  divisionName       String      @map("division_name") @db.Text
  fundCategory       String      @map("fund_category")          // "งบประมาณเงินรายได้" / "งบประมาณเงินอุดหนุนจากรัฐ" / etc.
  fiscalYear         Int         @map("fiscal_year")            // CE
  snapshotName       String?     @map("snapshot_name")          // BUDGET_PERIOD_NAME (e.g., "Jan")
  totalBudget        Decimal     @map("total_budget") @db.Decimal(16, 2)
  totalCommitment    Decimal     @default(0) @map("total_commitment") @db.Decimal(16, 2)
  totalObligation    Decimal     @default(0) @map("total_obligation") @db.Decimal(16, 2)
  totalExpenditure   Decimal     @default(0) @map("total_expenditure") @db.Decimal(16, 2)
  fundsAvailable     Decimal     @default(0) @map("funds_available") @db.Decimal(16, 2)
  freshnessDate      DateTime    @map("freshness_date") @db.Date
  methodologyVersion String      @default("kku-finance.v1") @map("methodology_version")

  faculty Faculty? @relation(fields: [facultyId], references: [id], onDelete: SetNull)

  @@unique([divisionName, fundCategory, fiscalYear])
  @@index([facultyId])
  @@index([fiscalYear])
  @@map("faculty_budgets")
}
```

## Backfill plan

- **Tuition (Oracle):** all available years (BE 2564–2569 = 6 years, ~430 cells/year × 6 = ~2,500 cells total).
- **Budget (MSSQL):** current fiscal year only (this is what BudgetData carries — historical snapshots are not retained in this view).
- **Sanity check:** annual tuition for BE 2568 should be in the ~฿1.6B range; budget allocation total should be in the ฿20-25B range; ~75/25 split between university-generated revenue and government subsidy.

## Monitoring after go-live

- Source-specific failure modes:
  - Oracle connection refused → KKU registry network unreachable
  - MSSQL connection refused → KKU HR server unreachable
  - Either auth error → password rotation
  - `VIEWSTUDENTENROLLFEE` schema change → connector throws `NonRetryableError`
  - `BudgetData` schema change → same
  - Tuition cell with `STUDENT_COUNT < 5` slipping through → suppression rule failed
- **Freshness alert:** > 35 days (cadence is monthly; allow one missed period before alerting)
- **Cross-source drift:** if total tuition for current year doesn't appear in BudgetData FUND_NAME breakdown within ฿100M tolerance → flag for review

## PDPA posture

**Tuition (Oracle):**
- Personal data the source carries: STUDENTID + STUDENTCODE per fee row (not citizen ID, not names — that's in VIEW_STUDENT_DETAIL_ALL but we don't pull it directly)
- Personal data this connector reads: **NONE** at row level — server-side `GROUP BY` produces aggregate (faculty × program × year × sum) only
- Suppression: `HAVING COUNT(DISTINCT STUDENTCODE) >= 5` so cells with <5 students never leave SQL Server

**Budget (MSSQL):**
- Personal data: **NONE** — purely org-level + line-item financial figures
- No suppression needed; data is non-personal

**Legal basis:** §24(4) — necessary for legitimate interests of KKU governance.

**DPO sign-off:** required before flipping `CONNECTOR_KKU_FINANCE_MODE=real` in production. Dev/staging unblocked.

## Known issues

- **2026-04-28** — `BudgetData` snapshots only the **current** fiscal year. Historical years are not in this table. Multi-year budget trend analysis requires either a separate historical table (TBD with KKU Finance) or stitching together monthly snapshots taken across the year.
- **2026-04-28** — `BUDGET_PERIOD_NAME` is the snapshot month label (e.g., "Jan"), NOT a year. Naming is misleading; treat as metadata only.
- **2026-04-28** — `DIVISION_NAME` has 51 distinct values, many of which are hospital / sub-unit splits of a parent faculty (`คณะแพทยศาสตร์` vs `คณะแพทยศาสตร์ - โรงพยาบาลศรีนครินทร์`). The connector strips ` - <suffix>` for the faculty name match; the original full division name is preserved in `FacultyBudget.divisionName`. Sub-unit aggregation (rolling hospital + faculty into one row) is **not** done — preserves transparency on the largest spending centres.
- **2026-04-28** — `STUDENTID` exists on `VIEWSTUDENTENROLLFEE` but NOT on `VIEW_STUDENT_DETAIL_ALL`. The cross-table join key is `STUDENTCODE`. Documented in connector SQL comments to prevent re-discovery.

## Session log

- **2026-04-28 (Phase 2+3 — Claude)** — endpoint clarified by user: tuition from Oracle (registry POWERBI), expenses from MSSQL ERPPowerBI.BudgetData on the HR server. Wrote `apps/ingestion/src/scripts/capture-finance-sample.ts` with 4 subcommands (`tuition-discover`, `tuition-sample`, `budget-discover`, `budget-sample`) reusing both Oracle + MSSQL clients. Discovery captured: 388,487 tuition rows + 12,375 budget rows; 100% STUDENTCODE join coverage; revenue split 75% university / 25% government for FY 2569 (CE 2026). Full Q1/Q2 SQL design locked. **(continuing — connector + schema + run not yet committed)**
