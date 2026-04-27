# KKU Registration Division

**Slug:** `kku-registry` · **Phase:** A · **Kind:** Oracle DB (read-only) · **Cadence:** daily 02:00 · **Status:** 🚧 wiring in progress (prompt 14, session opened 2026-04-27)

---

## What it is

KKU Registrar's Office data warehouse, surfaced as a `POWERBI` schema of read-only Oracle views. Used internally by KKU's PowerBI dashboards. We pull from a small subset to populate `EnrollmentMetric` (cohort flow) and `StudentDemographic` (program-level demographic histograms).

Highest-leverage internal source — every program-health calculation downstream of student counts depends on this.

## Access

| | |
|---|---|
| Endpoint | `regora19scan.kku.ac.th:1521`, service name `kku_svc` |
| Driver | Oracle thin client (no Instant Client native lib) — `oracledb` v6+ in thin mode |
| JDBC URL (reference only) | `jdbc:oracle:thin:@//regora19scan.kku.ac.th:1521/kku_svc` |
| Auth | User + password — read-only `powerbi` account |
| Credentials env vars | `KKU_REGISTRY_DB_HOST`, `KKU_REGISTRY_DB_PORT`, `KKU_REGISTRY_DB_SERVICE`, `KKU_REGISTRY_DB_USER`, `KKU_REGISTRY_DB_PASSWORD` |
| Network reachability | KKU internal — confirmed reachable from dev WSL2 host (2026-04-27); prod will use compose secret |
| Rate limits | None enforced upstream; we self-limit to 1 concurrent query, 30 s timeout |
| Concurrency we'll use | 1 (single connection pool slot, single in-flight query) |
| Request timeout | 30 s per query, 120 s total for the run |
| Data residency | KKU on-prem — never leaves the network |
| Schema visible | `POWERBI` (read-only views), 9 views total (we use 5) |

### Views in scope

| View | Purpose for us | PII level |
|---|---|---|
| `VIEW_STUDENT_DETAIL` | Demographic aggregates: home province, gender, nationality, parental income, entry GPA | **HIGH** — citizen ID, names, parents' income, contact, address |
| `VIEW_STUDENT_DETAIL_ALL` | Cohort tracking across all enrolled (active + alumni + withdrawn) | HIGH |
| `VIEW_STUDENT_DETAIL_ALUMNI` | Graduate cohort with completion flags (on-time / late) | HIGH |
| `VIEWSTUDENTINFO` | Lighter status snapshot | Medium — has citizen ID |
| `VIEWSTUDENTENROLLFEE` | Per-student-per-term tuition fee row | Low — IDs + amount only |

### Views NOT in scope (v1)

`VIEWENROLLLIST` (course-level granularity, not needed for program-level metrics), `VIEW_STUDENT_LAST_ACTIVE_CODE`, `VIEW_STUDENT_VACCINATED`, `VIEWRELIEFREQUESTSUMMARY` — none fit our existing tables.

## Data shape (real source)

Sample fixture lives at `apps/ingestion/test/fixtures/kku-registry/aggregated.json`. Contract test (`apps/ingestion/test/kku-registry.contract.test.ts`) loads the fixture and asserts schema match.

The connector never sees row-level PII — all aggregation is in the SELECT. Each query returns one row per `(faculty_name, program_name, level, major, academic_year)` tuple with pre-aggregated counts and JSON breakdowns.

### Aggregation contract

The connector issues two queries per run, both against `VIEW_STUDENT_DETAIL_ALL` (single view — has demographics + status + admit year + parents in one place; no JOIN needed):

**Q1 — Status counts per cohort** (feeds `EnrollmentMetric` after TS-side bucketing):

```sql
SELECT
  FACULTYNAME       AS FACULTY_NAME,
  PROGRAMNAME       AS PROGRAM_NAME,
  PROGRAMLEVEL      AS PROGRAM_LEVEL,
  MAJOR             AS MAJOR,
  ADMITACADYEAR     AS COHORT_YEAR_BE,   -- Buddhist Era — connector subtracts 543
  STUDENTSTATUS     AS STATUS,           -- raw Thai text
  STUDENTSTATUSCODE AS STATUS_CODE,      -- numeric code, more stable than text
  COUNT(*)          AS N
FROM POWERBI.VIEW_STUDENT_DETAIL_ALL
WHERE FACULTYNAME IS NOT NULL AND PROGRAMNAME IS NOT NULL
GROUP BY FACULTYNAME, PROGRAMNAME, PROGRAMLEVEL, MAJOR, ADMITACADYEAR,
         STUDENTSTATUS, STUDENTSTATUSCODE
```

The query returns RAW status counts. Categorisation into our buckets (`GRADUATED` / `ACTIVE` / `DROPOUT` / `NEVER_ENROLLED`) happens in TS via a `STATUS_BUCKET_MAP` lookup so the mapping is testable and updatable without re-running SQL. New status codes that don't appear in the map land in `IngestionRun.metadata.unknownStatuses[]` for analyst review — they default to bucket `UNCATEGORISED` rather than silently disappearing.

**Q2 — Demographic histograms** (feeds `StudentDemographic.breakdownJson`):

```sql
SELECT
  FACULTYNAME       AS FACULTY_NAME,
  PROGRAMNAME       AS PROGRAM_NAME,
  PROGRAMLEVEL      AS PROGRAM_LEVEL,
  MAJOR             AS MAJOR,
  ADMITACADYEAR     AS COHORT_YEAR_BE,
  STUDENTSEX        AS GENDER,
  HOMEPROVINCENAME  AS HOME_PROVINCE,
  NATIONNAME        AS NATION,
  COUNT(*)          AS N
FROM POWERBI.VIEW_STUDENT_DETAIL_ALL
WHERE FACULTYNAME IS NOT NULL AND PROGRAMNAME IS NOT NULL
GROUP BY FACULTYNAME, PROGRAMNAME, PROGRAMLEVEL, MAJOR, ADMITACADYEAR,
         STUDENTSEX, HOMEPROVINCENAME, NATIONNAME
```

Province sentinel `'-'` is normalised to `null` at the transform layer. Parental income / occupation are NOT pulled — they're PDPA-sensitive per-row signals that don't aggregate cleanly without a normalised income-bucket column upstream. Deferred to a follow-up session if needed.

The capture script `apps/ingestion/src/scripts/capture-registry-sample.ts` runs both queries against the live registrar with the env-supplied credentials and writes the result to `apps/ingestion/test/fixtures/kku-registry/aggregated.json`. The fixture is committed to git — it's already aggregated, so PDPA-clean.

### Quirks captured during 2026-04-27 discovery

- **Years are Buddhist Era (BE).** `ADMITACADYEAR = 2563` means CE 2020. Subtract 543 at transform time. Connector throws if a year is outside `[2540, 2700]` — both ends are sanity guards.
- **`PROGRAM_LEVEL` can be NULL** for some legacy programs (~handful). Treated as empty string in the mapping table.
- **`MAJOR` has trailing whitespace** in some rows (e.g. `"บริหารธุรกิจมหาบัณฑิต "`). `.trim()` at transform.
- **`HOME_PROVINCE = '-'`** is the unknown sentinel — coerced to `null` in the breakdown JSON.
- **Status values are all in Thai prose** — `STUDENTSTATUSCODE` (numeric) is the stable join key for the bucket map; `STUDENTSTATUS` text is captured for analyst readability.
- **VIEW_STUDENT_DETAIL_ALL has 349,968 rows** — 41,260 currently active + 307,834 alumni + ~700 various withdrawn/special. All demographic + status + admit-year fields are present on every row.
- **No graduation date column** in any view → `graduatedOnTime` vs `graduatedLate` split cannot be computed from this source. v1 fills `graduatedOnTime` with the total-graduates count and leaves `graduatedLate` at the existing seed value (partial upsert).

## Mapping to our schema

The registrar denormalises everything to text — there is no stable program code on the Oracle side that crosswalks to our `Program.code`. We bridge with an explicit allowlist table, `RegistryProgramMapping`:

| `RegistryProgramMapping` column | Source view column | Notes |
|---|---|---|
| `registryFacultyName` | `FACULTYNAME` | Thai text exactly as the view returns it |
| `registryProgramName` | `PROGRAMNAME` | Thai text |
| `registryLevel` | `PROGRAMLEVEL` | e.g. `ปริญญาตรี`, `ปริญญาโท` |
| `registryMajor` | `COALESCE(MAJOR, '')` | empty string when no major |
| `programId` | (our `Program.id`) | filled in manually by an admin |

A separate seed script (or a `/admin/registry-mappings` UI in a future session) populates this table. Until it has rows, every fetched record goes to `IngestionRun.metadata.unmappedSamples[]` for triage. **Connector behaviour:** runs are still considered successful even with 0 records loaded, but recordsRejected ≫ recordsLoaded triggers a data-quality flag.

### Field-level mapping

The kku-registry connector does a **partial upsert** of `EnrollmentMetric` — it touches only the columns the registrar can authoritatively fill. The other two are deferred.

| `EnrollmentMetric` column | This connector? | Source |
|---|---|---|
| `applications` | ❌ deferred | TCAS / admissions connector — separate session |
| `admitted` | ❌ deferred | TCAS / admissions connector — separate session |
| `enrolled` | ✅ | `COUNT(*)` per cohort `ADMITACADYEAR` |
| `retainedYear2` | ✅ | cohort-tracking via `STUDENTSTATUS` + admit year |
| `graduatedOnTime` | ✅ | `VIEW_STUDENT_DETAIL_ALUMNI` filtered by graduation year vs admit year + program duration |
| `graduatedLate` | ✅ | same predicate flipped |
| `dropouts` | ✅ | `STUDENTSTATUS ∈ {withdrawn, dismissed, expelled}` |

The two deferred columns retain whatever value they have in the row already (synthetic seed data today). The TCAS / admissions session will overwrite them. Until that session lands, methodology version of `EnrollmentMetric` rows touched by this connector stays at `v1` and the row's metadata flags `applicationsSource: 'seed'`, `admittedSource: 'seed'`.

`StudentDemographic.breakdownJson` is fully populated from `VIEW_STUDENT_DETAIL` aggregates — no partial-upsert handling needed.

## Backfill plan

- **Horizon:** academic years 2018–current (≈8 cohorts). The registrar holds further history but our analyses don't need pre-2018 data and the older cohorts have known data-quality issues per the registrar's office.
- **Chunking:** one query covers all cohorts in one run (registrar table is small at this aggregation level — ~100 KB result set per query).
- **Sanity check:** total `enrolled` per academic year matches MHESI's published headcount within 5%. Investigate if it doesn't — likely a status-code mismatch.

## Monitoring after go-live

- Source-specific failure modes:
  - Connection refused → KKU network unreachable; the analyst on duty escalates to Registrar's IT.
  - `ORA-01017 invalid username/password` → password rotation; rotate via Registrar's IT, update secret.
  - Result row count drops > 50% week-over-week → registrar's view definition changed; re-validate the aggregation SQL.
  - Unmapped-sample list grows → new programs launched at KKU; admin must add mapping rows.
- **Freshness alert:** > 48 h since last successful run.
- **Validation error rate:** > 10% of fetched rows fail Zod validation → fail the run.
- **Drift fingerprint:** total cohort size per academic year ± 2σ of the 30-day baseline.

## Contact

| Role | Person | Contact |
|---|---|---|
| Owning division | KKU Registrar's Office | _tbd — need named contact_ |
| Technical contact | KKU Registrar IT | _tbd — need named contact_ |
| Escalation | KKU CIO / data governance lead | _tbd_ |
| Internal owner (this project) | Denpong Soodphakdee | denpong@kku.ac.th |

## PDPA posture

**Personal data categories the upstream views carry:** Thai citizen ID (`CITIZENID`), full name (Thai + English), contact phone, KKU email, personal email, date of birth, home address, parents' occupation + income, vaccination ID, school of origin.

**Personal data this connector reads:** _none_. All aggregation is server-side via `GROUP BY`. The result set the connector receives contains **no PII columns** — only counts, sums, and tuple-keyed aggregates.

**Legal basis (PDPA §24):** §24(4) — necessary for performance of duty in the public interest (university governance + Council strategic decision-making). Internal KKU data flow under PDPA §27 (university-internal transfer).

**Retention:** Aggregates only; tied to academic-year cohorts. No deletion path for aggregates is required because no individual is identifiable.

**Cross-border transfer:** None. KKU on-prem.

**DPO sign-off:** _pending — owner to obtain before flipping `CONNECTOR_KKU_REGISTRY_MODE=real` in production_.

## Known issues

_(log dated entries as they come up)_

- **2026-04-27** — `applications` + `admitted` columns of `EnrollmentMetric` are deliberately not touched by this connector. Per the funnel data isn't surfaced by these views; that comes from TCAS / admissions. This connector flag is propagated to `IngestionRun.metadata.deferredFields` per run and to a project-level memory.
- **2026-04-27** — Oracle DB version not yet confirmed. The driver label "for 9.X, 10.X, 11.1" is JDBC-driver compatibility, not server version. If thin mode fails on connect we fall back to thick mode (Instant Client in the ingestion Dockerfile).
- **2026-04-27** — Program ID mapping table (`RegistryProgramMapping`) starts empty. Until populated, every fetched cohort row lands in `IngestionRun.metadata.unmappedSamples[]`. The first ~10 mappings should be added manually based on the first run's unmapped list.

## Session log

- **2026-04-27 (Phase 1 — Denpong)** — spec drafted. Prisma model `RegistryProgramMapping` added. Migration `20260427120000_registry_program_mapping`. `.env.example` extended with `KKU_REGISTRY_DB_*`. `oracledb@^6.5.1` added to `apps/ingestion/package.json`. No connector code yet — Phase 2 starts after install + migrate.
- **2026-04-27 (Phase 2 step 1+2 — Claude)** — `apps/ingestion/src/lib/oracle-client.ts` (thin-mode wrapper) + `capture-registry-sample.ts` (4 subcommands). Initial capture run revealed: years in Buddhist Era; `STUDENTSTATUS` is Thai text only; `PROGRAM_LEVEL` nullable; `HOME_PROVINCE` uses `'-'` sentinel; `VIEW_STUDENT_DETAIL_ALL` is the single best view (no joins needed). SQL revised to return raw status counts; bucketing moved to TS. Re-capture pending.
- **2026-04-27 (Phase 2 re-capture — Denpong)** — re-ran `aggregate` against revised SQL. Q1: 35,784 (program × cohort × status) rows. Q2: 136,289 (program × cohort × demo) rows. Total enrolled across all cohorts = 349,966 (matches view count within rounding). 51 distinct STUDENTSTATUSCODE values catalogued.
- **2026-04-27 (Phase 3 — Claude)** — `KkuRegistryRealConnector` shipped at `apps/ingestion/src/connectors/sources/kku-registry/`. Components: `connector.ts` (fetch → transform → load with batch-loaded mapping lookup), `transforms.ts` (Zod schemas, BE→CE, funnel rollup, demographic histogram aggregation), `status-mapping.ts` (51 codes → 5 buckets). 15 unit tests pass; the fixture-coverage test asserts every captured STATUS_CODE has an explicit map entry. Registry's `real?` factory wired. Manual-trigger script added: `pnpm connector:run kku-registry`. Awaiting first live run + mapping-table seeding.
- **2026-04-27 (Phase 4 first live run — Denpong + Claude)** — connector flipped real. First run with empty mapping table: SUCCEEDED, fetched=13577, loaded=0, duration=53s. Mapping seed helper added at `apps/ingestion/src/scripts/seed-registry-mappings.ts` + `pnpm registry:seed-mappings`. Auto-matched 9 of our 30 seed programs against registry tuples by exact (faculty.nameTh + program.nameTh + level) — 9 mappings created. Hit one bug on the second real run: BE-year sanity guard at 2540 was too aggressive (registrar has legacy alumni cohorts back to BE 2488 = 1945 CE); lowered the bound to 2400 and added a regression test. Three subsequent runs: SUCCEEDED, fetched=13577, loaded=560 each, duration 22-42s, idempotent. Bucket totals across the 9 mapped programs: 13437 graduated + 3650 active + 3346 dropouts + 1343 never-enrolled = 21776 students. EnrollmentMetric rows tagged `methodologyVersion: 'kku-registry.v1'`: 280. StudentDemographic rows: 280. Run history visible at `/admin/data-sources/kku-registry`.

## Gate-completion status (prompt-14 template)

- ✅ Real connector class + Zod schema + bucket map shipped.
- ✅ Registry `real?` factory wired (kku-registry: real=1 mock=23).
- ✅ Spec filled in beyond stub (this file).
- ✅ ≥3 green real-mode runs visible in IngestionRun history (4 total green + 1 fixed bug from before the BE bound fix).
- ✅ Drift fingerprint scaffolded: bucket totals + mappingTableRowCount + unmappedTuplesCount captured per run; `/admin/data-quality` covers the row-count drift check.
- ⏳ 30-day green-history countdown (gate 11 of `docs/readiness-checklist.md`) — starts 2026-04-27, eligible to drive a Council-facing number on or after 2026-05-27.
- ⏳ Full mapping-table coverage — 9 of ~2,232 distinct registry tuples mapped (~0.4%). The remaining 2,223 land in `IngestionRun.metadata.unmappedSamples[]` for triage. Mapping coverage grows as more programs get added to our seed.

## Next-session backlog for this connector

- Auto-mapper improvement: handle "(มหาบัณฑิต)" / "(ดุษฎีบัณฑิต)" suffix on our `Program.nameTh` so the seed script matches more programs.
- Optional `Q3` query against `VIEWSTUDENTENROLLFEE` to populate `FinancialMetric.tuitionRevenue` (or a new `ProgramTuition` table) — separate session, blocked on a fee-model decision.
- Backfill rollup recomputation: writing `EnrollmentMetric` should trigger `mv_*_metrics` refresh. Currently materialised views are refreshed on a separate schedule.
