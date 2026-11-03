# Tutorial: adapt the registrar connector to your institution

**Outcome.** The registrar connector reads your student-records system, maps what
it finds to your programmes, and loads enrolment and demographic figures per
programme and entry year. `/admin/data-sources/kku-registry` shows a real run that
loaded rows, and the figures that depend on enrolment start to fill in: the
Demographic outlook, the per-student financial figures, and the attractiveness and
financial drivers of the health score.

**Starting point.** You have worked through
[Get Program Deep-Dive working](./program-deep-dive.md) up to
[Step 4](./program-deep-dive.md#step-4--configure-the-data-sources), your programmes exist,
and you have read access to your registrar's data. This is the worked example of
the five steps in
[Institution-specific sources](./program-deep-dive.md#institution-specific-sources-adapt-the-connector-first);
the other three sources (staff roster, research, finance) follow the same pattern.

**Time.** A day or two of work once access is granted. Getting a read-only account
and a network route to the database is usually the long part — start that first.

## What you are adapting

The repository's registrar connector is the reference deployment's. It reads one
Oracle view of student records, aggregates it on the database server, and writes
two tables:

| Table | One row per | Holds |
|---|---|---|
| `enrollment_metrics` | programme × entry year | `enrolled`, `graduatedOnTime`, `dropouts` |
| `student_demographics` | programme × entry year | gender, home-province and nationality counts |

It touches only those three enrolment columns. `applications`, `admitted`,
`retainedYear2` and `graduatedLate` are left alone on update and default to zero
on create — admissions figures come from the [TCAS feed](./program-deep-dive.md#tcas-admissions).

Four things in it are specific to that institution and are what you change:

| What | Where | Why it is institution-specific |
|---|---|---|
| The SQL and view names | `apps/ingestion/src/connectors/sources/kku-registry/connector.ts` | Your schema differs |
| The status codes and their buckets | `.../kku-registry/status-mapping.ts` | Status codes are your registrar's own |
| The bridge from registrar names to programmes | `RegistryProgramMapping` table | Registrar text has no stable programme code |
| The year convention | `buddhistToCommonEra` in `.../kku-registry/transforms.ts` | The reference registrar stores Buddhist Era years |

Keep the slug `kku-registry`. It is the key the catalogue, the registry table, the
`data_sources` row and every run record share, and renaming it needs a database
migration. The name is cosmetic; you are editing your fork in place.

## Step 1 — Check what your registrar can provide

Before touching code, find the view or table that holds one row per student (or
per student per term) and confirm it has these, whatever it calls them:

| Needed | Used for |
|---|---|
| Faculty name | programme matching |
| Programme name | programme matching |
| Programme level (bachelor, master, …) | programme matching |
| Major, if you have majors | programme matching |
| Entry (cohort) year | which `enrollment_metrics` row |
| A student status code, with its text | enrolled, graduated, dropped out |
| Gender, home province, nationality | demographics — optional |

The demographic columns are optional. Without them the connector still loads
enrolment; it simply writes no `student_demographics` rows. Think about whether
you need them: gender × province × nationality × programme × cohort is a
combination that can single a student out, so it is the most sensitive thing the
connector reads.

Also settle the safeguards before you write SQL:

- The account must be **read-only**.
- Your data-protection officer must approve the projection. Approval for another
  institution does not transfer — see [PDPA and governance](../pdpa.md).
- The connector must receive **counts only**. The reference queries use
  `GROUP BY` on the database server so per-student rows never reach the
  connector. Keep that.

## Step 2 — Read the reference connector

Read these four files before changing anything. They are short:

1. `apps/ingestion/src/connectors/sources/kku-registry/connector.ts` — the two
   SQL queries (`Q1_STATUS_COUNTS`, `Q2_DEMOGRAPHIC_BUCKETS`), then `fetch`,
   `transform` and `load`.
2. `.../kku-registry/transforms.ts` — the row schemas, mapping-key
   normalisation, and the funnel rollup.
3. `.../kku-registry/status-mapping.ts` — the code-to-bucket table.
4. [The registrar source spec](../data-sources/kku-registry.md) — what was learned
   when the connector was first wired, including quirks of that registrar.

The shape to keep: `fetch` runs both queries in one connection and validates every
row; `transform` turns one (programme, cohort) group into records; `load` upserts
and reports what it could not map. The contract behind this is in
[the connector contract](../adopters/README.md#9-the-connector-contract-and-how-to-write-one).

## Step 3 — Set the connection

The connector reads its settings from environment keys with the prefix
`KKU_REGISTRY_DB`:

| Key | Meaning |
|---|---|
| `KKU_REGISTRY_DB_HOST` | database host |
| `KKU_REGISTRY_DB_PORT` | port |
| `KKU_REGISTRY_DB_SERVICE` | Oracle service name |
| `KKU_REGISTRY_DB_USER` | read-only account |
| `KKU_REGISTRY_DB_PASSWORD` | its password |

Put them in the root environment file. If a value contains `#`, wrap it in single
quotes: an unquoted `#` silently truncates the value.

**If your registrar is not Oracle**, swap the client. `apps/ingestion/src/lib/`
has `oracle-client.ts`, `mysql-client.ts`, `mssql-client.ts` and
`postgres-client.ts`, each exporting `withConnection`, `query` and
`configFromEnv(prefix)`. Change the import at the top of `connector.ts` and the
`configFromEnv` call in the constructor, and give the keys your database needs
(for Oracle that includes a service name; the others have their own names — read
the `configFromEnv` of the client you pick). The UniCon connectors are working
examples of the MySQL client.

## Step 4 — Capture your schema and a fixture

The reference deployment learned its schema with a discovery script before
writing any SQL. Do the same, because the quirks you will hit (a column that is
always empty, trailing spaces, a different join key) only show up against real
data.

`pnpm registry:capture` (`apps/ingestion/src/scripts/capture-registry-sample.ts`)
does this, but it is hard-coded to the reference deployment's view names. Edit the
`VIEWS` list and the queries in it for yours, then run, in this order:

```bash
pnpm registry:capture schema      # column names and types — run first
pnpm registry:capture counts      # row count per view
pnpm registry:capture statuses    # the distinct status codes and texts
pnpm registry:capture aggregate   # programme names, status vocabulary, counts
```

Outputs land in `apps/ingestion/test/fixtures/kku-registry/`. **The files already
there are the reference deployment's.** Replace them with yours, and delete the
old ones, because three things read `aggregated.json` and would otherwise match
the wrong institution's programmes: the mapping seed (Step 7), the mapping triage
page, and the status-mapping test.

Those fixtures are committed to git, so they must be aggregated and suppressed:
the capture script withholds any group smaller than 5, and its header explains
why that rule exists — an earlier version wrote groups of exactly one student.
If you widen a `GROUP BY`, re-check the smallest cell it can produce before you
commit. `apps/ingestion/test/fixtures/kku-registry/README.md` describes each file and
the small-cell policy.

## Step 5 — Adapt the SQL and the row schemas

In `connector.ts`, edit the two queries for your view and columns.

**Keep the column aliases.** The rest of the connector expects these names:

| Query | Aliases it must return |
|---|---|
| `Q1_STATUS_COUNTS` | `FACULTY_NAME`, `PROGRAM_NAME`, `PROGRAM_LEVEL`, `MAJOR`, `COHORT_YEAR_BE`, `STATUS`, `STATUS_CODE`, `N` |
| `Q2_DEMOGRAPHIC_BUCKETS` | `FACULTY_NAME`, `PROGRAM_NAME`, `PROGRAM_LEVEL`, `MAJOR`, `COHORT_YEAR_BE`, `GENDER`, `HOME_PROVINCE`, `NATION`, `N` |

If you would rather rename them, change `Q1RowSchema` and `Q2RowSchema` in
`transforms.ts` to match; every row is validated against those schemas and a
mismatch aborts the run with `Q1_VALIDATION` or `Q2_VALIDATION`.

If you have no demographic columns, remove `Q2_DEMOGRAPHIC_BUCKETS` and its
schema. `transform` already writes `student_demographics` only when there are Q2
rows.

**The year convention.** The reference registrar stores entry years in the
Buddhist Era, and `buddhistToCommonEra` subtracts 543 and rejects anything
outside 2400–2700 — a guard against forgetting to convert. If your system stores
Common Era years, either add 543 in the SQL or replace that function; if you do
neither, the first row throws and the run fails. That failure is the guard
working, not a bug.

Keep the `GROUP BY`. If the connector ever receives one row per student, you have
changed the privacy posture of the whole feature.

## Step 6 — Map your status codes to funnel buckets

This step decides what `enrolled`, `graduatedOnTime` and `dropouts` mean, so give
it care. `status-mapping.ts` collapses your registrar's status codes into five
buckets:

| Bucket | Meaning | Becomes |
|---|---|---|
| `GRADUATED` | completed the programme | `graduatedOnTime` (see note) |
| `ACTIVE` | currently enrolled, including on leave | part of `enrolled` |
| `DROPOUT` | left after starting classes — resigned, dismissed, transferred out | `dropouts` |
| `NEVER_ENROLLED` | admitted but never started | excluded from `enrolled` |
| `UNCATEGORISED` | code not in the map yet | counted and reported, not placed |

`enrolled` is the cohort minus `NEVER_ENROLLED`. `graduatedOnTime` currently holds
**all** graduates of the cohort, not only those who finished on schedule, because
the registrar views do not carry graduation dates; the run metadata says so.

The codes in the file are the reference registrar's — 51 of them, with their Thai
labels. **Replace them all.** Take your codes and texts from the `statuses`
capture, put each in a bucket, and keep the label beside it so the next person can
see why. Where a case is judgement — a student "pending graduation approval", one
who transferred to another programme of the same university — decide it
deliberately and write the reason in a comment.

Then update the test that guards this:

```bash
pnpm --filter ingestion test
```

`apps/ingestion/test/kku-registry/status-mapping.test.ts` asserts that every code
in your captured fixture maps to a bucket, so adding a code to the registrar
later without updating the map fails the build rather than silently dropping
students. The test also contains examples written with the reference
registrar's Thai names; replace those examples if they fail against your data.

## Step 7 — Bridge registrar names to your programmes

A registrar rarely carries your programme code. The connector therefore matches
on four text fields — faculty name, programme name, level and major — through an
explicit table, `RegistryProgramMapping`. There is no fuzzy matching and no
`LIKE`: a row exists or the data is not loaded.

First, seed what can be matched exactly, then check it:

```bash
pnpm registry:seed-mappings --dry-run
pnpm registry:seed-mappings
```

The script reads your fixture from Step 4 and pairs a registrar tuple with a
programme when the faculty name, programme name and level all match exactly. Its
level labels are Thai (`ปริญญาตรี`, `ปริญญาโท`, `ปริญญาเอก`,
`ประกาศนียบัตรบัณฑิตชั้นสูง`) and are hard-coded; if your registrar spells a level
differently, edit the table at the top of
`apps/ingestion/src/scripts/seed-registry-mappings.ts` first, or nothing will
match.

Then pair the remainder by hand at `/admin/registry-mapping`. It lists the
programmes the auto-seed could not pair, suggests candidate registrar tuples with
a score, and creating a pairing writes one mapping row. A programme can have
several rows — one per major.

Work this list down now. Every tuple without a row is skipped on every run, and
its students are counted as unmapped.

## Step 8 — Switch it on and run it

In the root environment file:

```bash
CONNECTOR_KKU_REGISTRY_MODE=real
```

Restart the ingestion worker if it is running, then run the connector once
directly. This is the same code path as the worker, without the queue:

```bash
pnpm connector:run kku-registry
```

Watch the log. You should see the two queries report their row counts, then a
line saying how many program mappings were loaded. If the mapping table is empty
the connector warns, says the run will load zero rows, and still finishes as
successful — read that warning.

A credentials or network failure shows up as a failed health check or a
connection error. A schema mismatch shows up as `Q1_VALIDATION` or
`Q2_VALIDATION`. A year outside the expected range throws from
`buddhistToCommonEra`.

## Step 9 — Check the run

Open `/admin/data-sources/kku-registry` and read the latest run's metadata. A
run that really read your registrar says `connectorMode: real`. A mocked run says
`mocked — no DB writes` and loaded nothing, even though it shows as succeeded.

Then check each field against what you expect:

| Field | Healthy |
|---|---|
| `mappingTableRowCount` | roughly the number of programme × major rows you mapped |
| `unmappedTuplesCount`, `unmappedStudentCount` | small, and every entry in `unmappedSamples` is understood — historical programmes you do not track are fine, a current programme is not |
| `unknownStatusCodes` | empty. Any entry is a code missing from Step 6 |
| `statusBucketTotals` | `UNCATEGORISED` near zero; the other four plausible for your size |
| `recordsFailed` | zero |

Cross-check one number against an independent source. The reference deployment's
sanity check was total `enrolled` per academic year against the ministry's
published headcount, within 5%. If you are further off, the likely cause is a
status code in the wrong bucket.

Last, look at a programme: open its Deep-Dive. The Demographic outlook uses the
latest full-year intake from `enrollment_metrics`, so it should now render for any
programme with a mapped intake. Rows written by this
connector carry `methodology_version = 'kku-registry.v1'` and the run's id, and
the run id is what lets them pass the provenance filter — see
[the `realDataWhere` trap](../adopters/README.md#trap-2-realdatawhere--empty-sections-with-rows-in-the-database).

## Step 10 — Prove it and record it

The per-connector playbook's exit criterion is **three successful runs** with
zero failures. Run it three times (each run is an idempotent upsert, so repeats
are safe) and confirm the row counts do not drift between them. Record the
fingerprint — row counts and the bucket totals — in the source spec, and add a
dated line to its session log.

Then check the catalogue flags. The `data_sources` row has independent `status`
and `mocked` columns, and `prisma/seed.ts` rewrites both from the catalogue
(`packages/shared/src/ingestion/catalog.ts`) on every seed, so the catalogue entry
must say `mocked: false` or the next `pnpm data-sources:sync --apply` quietly re-mocks the
connector. In this repository the `kku-registry` entry already does. Confirm with:

```bash
pnpm data-sources:audit
```

which reports drift between the database and the catalogue in both directions.

Finally, update the source spec at `docs/data-sources/kku-registry.md` with your
system's access details, data shape and known issues, in the same commit as the
code, and obtain your data-protection officer's written sign-off before running
against production.

## What this does not cover

- **The Students section's cohort and alumni charts.** They are filled by two
  pipeline scripts, `programs:link-cohorts` and `programs:link-alumni`, not by
  this connector. They query the reference registrar's views with their own SQL
  and their own status sets, and `link-cohorts` derives the entry year from the
  first two digits of the student code — a convention of that registrar. Adapt
  them the same way, or run the pipeline with `--skip=phase4` until you have.
  Both are described under
  [Registrar](./program-deep-dive.md#registrar-enrolment-cohorts-alumni-status).
- **Admissions figures** (`applications`, `admitted`) — see the
  [TCAS feed](./program-deep-dive.md#tcas-admissions).
- **Finance.** `programs:link-financials` and the finance connector read tuition
  from the same registrar views; adapt them after this one works.

## If something goes wrong

| Symptom | Likely cause |
|---|---|
| Run succeeds, `loaded` is zero | Empty mapping table (Step 7), or the run was mocked (Step 9) |
| Run succeeds with a record count but nothing appears | The mode is still `mocked`; the mock loads nothing |
| `Q1_VALIDATION` / `Q2_VALIDATION` | A column alias or type differs from the row schema (Step 5) |
| "Year out of expected Buddhist-Era range" | Your years are Common Era (Step 5) |
| `unknownStatusCodes` not empty | A code is missing from the map (Step 6) |
| Programmes you track appear in `unmappedSamples` | Missing mapping row (Step 7) |
| Connection error | Credentials, network route, or the wrong client for your database (Step 3) |
| Rows exist but a section is empty | The provenance filter — check the run id and the `data_sources` flags (Step 10) |
