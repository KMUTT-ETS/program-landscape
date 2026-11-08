# Session 2: platform architecture and source code

> **ภาษาไทย:** มีฉบับภาษาไทยของหน้านี้ที่ [ฉบับภาษาไทย](../th/workshop/02-architecture-and-source.md)

**Time.** About 90 minutes.

**Outcome.** You know where things live in the repository, follow one Deep-Dive section from the
browser to the database, learn the rules every change follows, and finish with
the app running and you signed in as its administrator.

## The parts

Program Landscape is one repository holding several programs that run
together. All of it is TypeScript.

| Folder | What it is |
|---|---|
| `apps/web` | The website (Next.js). Pages such as `/programs/<id>`, the Deep-Dive. |
| `apps/api` | The API (NestJS) at `http://localhost:4000/api/v1`. Every page reads from it. |
| `apps/ingestion` | Background workers: connectors that pull data in, and the AI pipeline. |
| `apps/docs-site` | This documentation site. |
| `packages/db` | The database schema (Prisma) and the queries and calculations. |
| `packages/shared` | Code used by several apps: permissions, AI service, connector catalogue. |
| `packages/ui` | Shared screen components: charts, badges, tables. |
| `packages/design` | Colours, fonts and spacing for light and dark mode. |
| `packages/pdf-templates` | Templates of the PDF reports. |

Four services run in Docker: `postgres` (the database), `redis` (job queue and
cache), `minio` (file storage, for example uploaded PDFs) and `gotenberg` (turns
pages into PDF).

More detail: [Architecture](../architecture.md) and the
[Adopter guide](../adopters/README.md).

## Follow one Deep-Dive section end to end

The Finance section of the Deep-Dive is a short path through every layer.

1. **The page.** `apps/web/app/programs/[id]/page.tsx` asks the API for each
   section. For Finance it fetches `/programs/<id>/financials`, and
   `FinancialsSection` in `client.tsx` in the same folder draws it.
2. **The endpoint.** In `apps/api/src/programs/deep-dive.controller.ts`, the
   `@Get('financials')` method carries three markers:
   - `@Authorized('financials:read:all')`: only users with that permission may call it.
   - `@Provenance(...)`: the sources and method version shown in the chart's
     provenance drawer.
   - `assertProgramAccessible(...)`: the user's scope must include this programme.
3. **The query.** It calls `programFinancials` in
   `packages/db/src/program-deep-dive.ts`, which reads the `financial_metrics`
   table with `realDataWhere()`.

**Why `realDataWhere()` matters.** It keeps only rows that arrived through a
real data source: an upload or a connector run that is not a mock. A row
without that link is hidden. This is why a section can stay empty even when
rows exist, and why your own code must record which run loaded each row.

Ask your assistant to walk the same path with you:

```text
Trace the Finance section of the Program Deep-Dive from apps/web/app/programs/[id]/page.tsx
to the database. For each step name the file and function, and explain what
@Authorized, @Provenance and realDataWhere() each do there. Do not change any file.
```

Then try a second section on your own:

```text
Which API endpoint and which database function feed the "Outcomes"
section of the Program Deep-Dive? Show the file paths.
```

## The rules every change follows

The app is made for decisions about whether programmes open, merge or close,
so every number must be traceable. Any code you add in sessions 4 and 5
follows these rules:

1. **Every chart shows where its data came from.** A provenance button opens
   the sources, freshness, method and version.
2. **Every AI output shows its confidence and sources**, and lets the reader
   disagree.
3. **Every data point shows how fresh it is.**
4. **Every change to data is written to the audit log**, through `@AuditLog()`.
5. **Every AI call is logged**, through `@AiCall()`.
6. **Every calculation carries a method version**, documented in
   `docs/methodologies/`.

Also: TypeScript strict with no `any`, input checked with Zod, colours only
from design tokens. The full list is in the
[project contract](../../CLAUDE.md).

## Start the app and sign in

Start the app with `pnpm dev` and check it is healthy, as in
[Getting started](../tutorials/getting-started.md) steps 5 and 6. Then sign in
with the administrator you claimed during the
[rehearsal](./00-before-the-day.md#rehearse-once-with-the-sample-university).

If you skipped the rehearsal or reset your database, claim the administrator
now at `/setup` ([Getting started](../tutorials/getting-started.md) step 7), at
once: the first person to open the setup page becomes the administrator.

## You are done when

- `http://localhost:3000` shows the app, and you are signed in as administrator.
- `http://localhost:4000/api/v1/ready` reports every dependency healthy.
- You can name the three files on the Finance section's path.

## Next step

Continue with [Session 3: university data](./03-university-data.md).
