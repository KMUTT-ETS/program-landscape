# Tutorial: load data from an API (practice run)

> **ภาษาไทย:** มีฉบับภาษาไทยของหน้านี้ที่ [ฉบับภาษาไทย](../th/tutorials/load-data-from-an-api.md)

**Outcome.** A connector you wrote fills the Enrolment dataset from an HTTP
API. Its rows show on `/admin/data-setup/raw/enrollment-metrics` with Source
"API: Practice Intake API", next to the spreadsheet you uploaded, and you know
how to do the same for your own system.

**Starting point.** A running app on your laptop with the first administrator
signed in, and a mock university loaded (Step 1 shows how). Every command
below runs from the repository root.

**Time.** About an hour. No AI spend.

This is a practice run against a mock API that plays the part of a registrar
system. The reference for every rule is
[Load an import dataset from an HTTP API](../guides/write-a-connector.md#load-an-import-dataset-from-an-http-api).

## Before you start

Do this on a practice installation that holds mock data only. An API load
replaces data the same way an upload does, and the mock API serves invented
figures. On an installation with your university's real data, those invented
figures would overwrite real ones.

## Step 1: Generate and load a mock university

1. Write an input file and generate the mock spreadsheets, as described in
   [No exports? Generate a mock set for your university](../workshop/03-university-data.md#no-exports-generate-a-mock-set-for-your-university):

   ```bash
   pnpm workshop:mock my-university.json --out workshop-mock-out
   ```

2. Upload the files in their numbered order on `/admin/data-setup`, at least
   up to `04-enrollment-metrics.xlsx`. The programmes must exist before the
   connector can load figures for them.

You should see the Enrolment dataset on `/admin/data-setup/raw/enrollment-metrics`
with one row per programme per year and one upload in its Uploads history.

## Step 2: Start the mock API

In a second terminal:

```bash
pnpm workshop:mock-api workshop-mock-out --token practice-token
```

It prints the base URL, `http://127.0.0.1:4010/api/v1`, and listens on your
laptop only. Without `--token` it makes up a new token at every start; a fixed
one saves editing `.env` each time. Leave it running.

## Step 3: Look at what the API returns

Pick a programme code from your `03-programmes.xlsx` and ask for its intake:

```bash
MOCK_TOKEN=practice-token
curl -H "Authorization: Bearer $MOCK_TOKEN" \
  http://127.0.0.1:4010/api/v1/programmes/<programme code>/intake
```

You get one object per year:

```json
{ "data": [ { "year_be": 2568, "applied": 412, "admitted": 180, "enrolled": 151,
              "retained_year2": 0, "graduated_on_time": 0, "graduated_late": 0, "dropouts": 0 } ] }
```

Compare it with the Enrolment template (download it from the dataset's page):

| API field | Template header |
|---|---|
| the code in the URL | `Programme Code` |
| `year_be` minus 543 | `Academic Year` |
| `applied` | `Applications` |
| `admitted` | `Admitted` |
| `enrolled` | `Enrolled` |
| `retained_year2` | `Retained to Year 2` |
| `graduated_on_time` | `Graduated on Time` |
| `graduated_late` | `Graduated Late` |
| `dropouts` | `Dropouts` |

Three things to notice: the year is Buddhist Era, the field names differ from
the headers, and there is no route that lists programmes, so the connector has
to know which codes to ask for. An unknown code answers 404.

## Step 4: Scaffold the connector

```bash
pnpm connector:new --name practice-intake --dataset enrollment-metrics
```

It creates three files and registers the connector:

- `apps/ingestion/src/connectors/sources/institution/practice-intake/connector.ts`,
  the class you fill in, with an `EnrollmentMetricsRow` type that lists every
  header
- `apps/ingestion/test/institution/practice-intake.test.ts`, a test that starts
  out skipped
- `apps/ingestion/test/institution/practice-intake.fixture.json`, its sample
  records, empty for now

## Step 5: Write fetchAll and toRows

Replace the contents of `connector.ts` with:

```ts
import { z } from 'zod';

import { prisma } from '@kku/db';
import type { ConnectorContext } from '@kku/shared';

import type { ApiClient } from '../../../base/api-client';
import { NonRetryableError } from '../../../base/base-connector';
import { DatasetApiConnector, type DatasetRows } from '../../../base/dataset-api-connector';

/** One year of intake for one programme, as the mock API returns it. */
const IntakeYear = z.object({
  year_be: z.number().int(),
  applied: z.number().int(),
  admitted: z.number().int(),
  enrolled: z.number().int(),
  retained_year2: z.number().int(),
  graduated_on_time: z.number().int(),
  graduated_late: z.number().int(),
  dropouts: z.number().int(),
});
const IntakeResponse = z.object({ data: z.array(IntakeYear) });

/** What fetchAll hands to toRows: the programme code plus one year of intake. */
type IntakeRecord = z.infer<typeof IntakeYear> & { programmeCode: string };

const BE_OFFSET = 543;

export class PracticeIntakeConnector extends DatasetApiConnector {
  readonly slug = 'api-practice-intake';
  readonly displayName = 'Practice Intake API';
  readonly datasets = ['enrollment-metrics'] as const;

  /** The programmes to ask the API about: every programme the app already holds. */
  protected async programmeCodes(): Promise<string[]> {
    const rows = await prisma.program.findMany({ select: { code: true }, orderBy: { code: 'asc' } });
    return rows.map((r) => r.code);
  }

  protected async fetchAll(_ctx: ConnectorContext, api: ApiClient): Promise<readonly unknown[]> {
    const records: IntakeRecord[] = [];
    for (const code of await this.programmeCodes()) {
      try {
        const res = await api.getJson(`/programmes/${encodeURIComponent(code)}/intake`, IntakeResponse);
        for (const year of res.data) records.push({ programmeCode: code, ...year });
      } catch (err) {
        // A programme the API has no intake for answers 404: skip it, keep the rest.
        if (err instanceof NonRetryableError && err.code === 'HTTP_404') continue;
        throw err;
      }
    }
    return records;
  }

  protected toRows(records: readonly unknown[]): DatasetRows {
    const rows = (records as readonly IntakeRecord[]).map((r) => ({
      'Programme Code': r.programmeCode,
      'Academic Year': r.year_be - BE_OFFSET, // the API speaks Buddhist Era; the dataset wants Common Era
      Applications: r.applied,
      Admitted: r.admitted,
      Enrolled: r.enrolled,
      'Retained to Year 2': r.retained_year2,
      'Graduated on Time': r.graduated_on_time,
      'Graduated Late': r.graduated_late,
      Dropouts: r.dropouts,
    }));
    return { 'enrollment-metrics': rows };
  }
}
```

What each part does:

- **`IntakeResponse`** describes the response with Zod. `api.getJson` checks
  every response against it, so a changed API fails loudly instead of loading
  wrong figures. That check is also why `toRows` may treat its records as
  `IntakeRecord`: nothing reaches it that `fetchAll` did not validate.
- **`programmeCodes`** answers "which codes do I ask for?" from the programmes
  already in the app. It is a method of its own so a test can replace it.
- **The 404 branch** skips programmes the API does not know. Every other error
  stops the run: a wrong token (401) or a wrong base URL fails at once and is
  not retried.
- **`toRows`** builds one object per row, keyed by the template's header text,
  and converts the year. It does no checking of its own: the run validates the
  rows exactly like an uploaded sheet.

Then check that it compiles:

```bash
pnpm --filter ingestion typecheck
```

## Step 6: Test the mapping

1. Put one invented record in `practice-intake.fixture.json`:

   ```json
   [
     { "programmeCode": "PRACTICE-01", "year_be": 2567, "applied": 120, "admitted": 80,
       "enrolled": 60, "retained_year2": 55, "graduated_on_time": 0, "graduated_late": 0, "dropouts": 2 }
   ]
   ```

2. In `practice-intake.test.ts`, change `describe.skip(` to `describe(` and add
   one line after the existing `expect`:

   ```ts
   expect(firstEnrollmentMetrics?.['Academic Year']).toBe(2024);
   ```

3. Run it:

   ```bash
   pnpm --filter ingestion exec vitest run test/institution/practice-intake.test.ts
   ```

You should see `1 passed`. Fixtures are always invented or anonymised, never
copied from a live system.

## Step 7: Configure and run

1. Add to `.env` (the token is the one you passed to the mock API):

   ```bash
   CONNECTOR_API_PRACTICE_INTAKE_BASE_URL=http://127.0.0.1:4010/api/v1
   CONNECTOR_API_PRACTICE_INTAKE_TOKEN=practice-token
   ```

2. Create the connector's data source:

   ```bash
   pnpm data-sources:sync --apply
   ```

3. Run it:

   ```bash
   pnpm connector:run api-practice-intake
   ```

You should see `outcome=SUCCEEDED` and `recordsLoaded` equal to the number of
programme-years. To use the "Run now" button on `/admin/data-sources` instead,
restart `pnpm dev` first so the ingestion worker picks up the new connector.

If it fails, open `/admin/data-sources`, choose `api-practice-intake`, and
press "Log" on the failed run in "Recent runs". The last line gives the error
code and the message, which names the dataset, record and column without the
value. The common ones:

| Code or message | Cause |
|---|---|
| `HTTP_401` | The token in `.env` does not match the mock API's |
| `CONFIG … No base URL` | `CONNECTOR_API_PRACTICE_INTAKE_BASE_URL` is missing |
| `NOT_IMPLEMENTED` | `connector.ts` still holds the scaffolded stubs |
| `Academic Year … in the future` | The year was not converted from Buddhist Era |
| `This code does not exist in Programmes` | The programme was not uploaded in Step 1 |

## Step 8: Check the result

1. Run the connector's checks:

   ```bash
   pnpm connector:verify api-practice-intake
   ```

   Every line should read PASS (or SKIP with a reason), ending with a summary
   such as `7 passed, 0 failed, 0 warnings, 0 skipped`. A FAIL line says what
   to do next on the line below it.
2. Open `/admin/data-setup/raw/enrollment-metrics`.
   - The Uploads table has a new row with Source "API: Practice Intake API"
     next to your spreadsheet upload.
   - A banner says "Two sources feed this dataset": uploads and the API now
     both load Enrolment.
3. Open `/admin/data-sources` and the `api-practice-intake` source. "Recent
   runs" shows the run as SUCCEEDED with the number of rows loaded, and "Log"
   shows its steps. The per-dataset report (which import run loaded Enrolment,
   the warnings) is stored with the run, but this page does not display it yet:
   the banner in step 2 is where the two-source warning shows.
4. Open `/programs/<id>` for one of the programmes. The Students section reads
   the same rows: the API supplied the figures the spreadsheet did.

Because Enrolment is matched row by row, a row the API loaded and a row you
uploaded for the same programme and year are the same row: whichever loaded
last holds its values. For datasets that cover a whole term, such as Class
Offerings, the last load replaces the whole term. See
[Two sources for one dataset](../guides/write-a-connector.md#two-sources-for-one-dataset).

## Step 9: Tidy up

The connector is practice code. To remove it:

1. Delete `apps/ingestion/src/connectors/sources/institution/practice-intake/`
   and the two files under `apps/ingestion/test/institution/`.
2. Delete the lines the scaffolder added above the `// connector:new entries`
   markers in `apps/ingestion/src/connectors/sources/institution/index.ts` and
   `packages/shared/src/ingestion/institution-catalog.ts`, and the import it
   added at the top of `index.ts`.
3. Remove the two `CONNECTOR_API_PRACTICE_INTAKE_*` lines from `.env`.

The rows it loaded stay. "Start over" on the Enrolment page removes the rows
from uploads and API runs alike; upload `04-enrollment-metrics.xlsx` again
afterwards if you use it.

## Your exercise: Class Offerings

The mock API also serves class sections, and that is the one to try next. It
adds two things this tutorial did not need:

- `/terms/<year>/<semester>/sections` is paged: use `api.paginate` with
  `next_cursor`.
- `/terms/<year>/<semester>/enrolments` returns one record per student per
  section. Do not pass student records on: count them per section inside
  `toRows`, and decide what to do with sections of fewer than 5 students
  (Class Offerings does not refuse them).

Scaffold it with `pnpm connector:new --name practice-classes --dataset class-offerings`.
The routes are listed in `apps/ingestion/src/scripts/workshop-mock-api/README.md`.

## Next step

- [Load an import dataset from an HTTP API](../guides/write-a-connector.md#load-an-import-dataset-from-an-http-api)
  for every rule: limits, retries, personal data, two sources.
- [Importing from spreadsheets](../data-import.md) for what each dataset holds.
- Connect your own system: scaffold a connector for the dataset your API
  fills, point `CONNECTOR_<SLUG>_BASE_URL` at it, and work on a practice
  installation until the run is clean.
