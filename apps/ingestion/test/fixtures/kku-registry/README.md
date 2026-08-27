# kku-registry fixtures

Captured from the KKU registrar's Oracle views by `pnpm registry:capture`
(`apps/ingestion/src/scripts/capture-registry-sample.ts`). Committed to git,
so treat everything here as world-readable.

## What is in each file

| File | Contents | Small-cell policy |
|---|---|---|
| `schema.json` | `ALL_TAB_COLUMNS` introspection for the 5 views in scope | n/a — column metadata only |
| `counts.json` | `COUNT(*)` per view | n/a — five university-wide totals |
| `statuses.json` | Distinct `STUDENTSTATUS` / `ENTRYTYPE` / `PROGRAMLEVEL` values | value kept, count withheld below N ≥ 5 |
| `aggregated.json` | `programTuples`, `statusVocabulary`, `statusCounts` | see below |

### `aggregated.json`

- **`programTuples`** — the distinct `(FACULTY_NAME, PROGRAM_NAME,
  PROGRAM_LEVEL, MAJOR)` vocabulary. Programme catalogue metadata: it says
  which programmes exist, not who is enrolled in them. No counts, so nothing
  to suppress. This is what the three mapping consumers read.
- **`statusVocabulary`** — the registrar's status code table, `(STATUS_CODE,
  STATUS)`. No counts. This is what `status-mapping.test.ts` asserts
  `STATUS_BUCKET_MAP` covers.
- **`statusCounts`** — `(programme × cohort year × status)` head counts,
  **suppressed at N ≥ 5**. A missing cell means "fewer than 5, value
  withheld", never "nobody".

## Why the file shrank from 79 MB to 6 MB

Until 2026-08-27 this fixture also carried a `demographics` series and an
unsuppressed `statusCounts`. Between them, **79,465 demographic rows and
12,888 status rows described exactly one student** — programme, cohort year,
gender, home province and nationality, at N=1. That is k-anonymity of 1 in a
tracked file, and it was published under a claim that the fixture was
"aggregate-only, no PII".

The demographics series was removed outright rather than suppressed: no code
in this repo ever read it, and even at N ≥ 5 the quasi-identifier combination
is the most disclosive thing the registrar exposes. If a module ever needs
demographic composition, read the `student_demographics` table the connector
loads — do not re-add a committed fixture of it.

## Rules for regenerating

1. The `HAVING COUNT(*) >= 5` in the capture SQL is the trust boundary. Small
   cells must never leave Oracle, rather than being filtered after the fact.
2. Do not record `sourceHost` / `sourceService`. The registrar's Oracle
   hostname, service name and account are infrastructure detail; the
   `powerbi` account in particular locks out under failed-logon storms
   (see `apps/ingestion/src/lib/oracle-client.ts`).
3. If you widen a `GROUP BY`, work out the smallest cell it can produce
   before you commit the output.
