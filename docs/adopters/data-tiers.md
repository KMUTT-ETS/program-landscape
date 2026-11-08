# Data integration: the four tiers of adoption effort

> **ภาษาไทย:** [ฉบับภาษาไทย](../th/adopters/data-tiers.md)

**Outcome.** You can sort every data source into one of four tiers and estimate the effort each tier costs your institution.

This is the page that determines your project plan. The source catalog lives at `packages/shared/src/ingestion/catalog.ts` — **39 entries, 5 of them deprecated**. Connector implementations live under `apps/ingestion/src/connectors/sources/`, and the mock↔real routing table is `apps/ingestion/src/connectors/registry.ts`.

The tiers below sort every source by how much work it is *for you*, not by how important it is.

## Tier 1 — Works nearly as-is: the MHESI UniCon DS family

Every Thai university submits the UniCon DS datasets to MHESI in the **same schema**. That means the SQL projections, the column semantics, the Buddhist-era date handling, and the PII treatment in these four connectors transfer directly.

| Slug | Source in KKU's deployment | Rows in KKU snapshot |
|---|---|---|
| `unicon-ds1001` | `mysql://…/reg_unicon.view_ds1001` | 35,406 (AY 2568 sem 2) |
| `unicon-ds2001` | `mysql://…/UNICON_STAFF_KKU.DS2001` | 11,325 |
| `unicon-ds2003` | `mysql://…/UNICON_STAFF_KKU.DS2003` | 18,060 |
| `unicon-ds2004` | `mysql://…/reg_unicon.ds2004_<YYSEM>` | one row per (staff × programme × teach type) |

**What you change:** the connection details, via `UNICON_DS1001_DB_*` / `UNICON_DS2001_DB_*` / `UNICON_DS2003_DB_*` / `UNICON_DS2004_DB_*` env prefixes, consumed through `configFromEnv()` in `apps/ingestion/src/lib/mysql-client.ts`. Note that in KKU's deployment DS1001 deliberately reuses the DS2004 credentials because they are the same MySQL endpoint — check whether that holds at your institution.

**What you will probably still have to touch:**

- **DS2004's table-name convention.** KKU's snapshot tables are named `ds2004_<YYSEM>` using BE last-two-digits plus semester (`682` = AY 2568 semester 2). The connector resolves `MAX(suffix)` at runtime. If your registrar names them differently, that resolution logic changes.
- **Organisational-code resolution.** `unicon-ds2001` maps DS2001's 5-digit `DEPARTMENT_ID` to your `Faculty.id` by joining through `staff_program_assignment.fac_id` (see `buildDeptCodeToFacultyMap()` in that file). This works because DS2004 has already populated that bridge with MHESI faculty codes. If your DS2004 load has not run, DS2001 will load with `facultyId = null` — the connector reports the unresolved-code count in its metadata rather than failing.
- **`CURR_ID` → programme resolution.** DS1001 and DS2004 resolve MHESI curriculum IDs against `Program.mhesiCode` (with a `ProgramMhesiAlias` fallback). You must seed your programmes with their MHESI codes for this to work — see [Curriculum documents and the AI digest pipeline](../guides/curriculum-pdfs-and-ai-digest.md).
- **PII posture.** Each connector's SQL projection is the trust boundary and is documented in the file header — which columns are dropped at projection, which are hashed (`CITIZEN_ID` → `citizenIdHash` via `hashCitizenId()`), which are downcast to year precision. These were DPO-approved at KKU. **Your DPO must approve them independently.** Do not treat KKU's approval as transferable.

**Honest effort estimate:** one to three days per connector if your DS tables are where you expect and you have read access. Most of that time is credentials and network access, not code.

> **Caveat worth knowing:** there is no `docs/data-sources/unicon-*.md` spec file for these four. The per-source spec directory covers the older sources; the UniCon connectors document themselves in their file headers instead. Read the code.

## Tier 2 — Shared national and external sources: same for everyone

These read from sources that are identical regardless of which university you are. They need credentials or an institutional subscription, but not a rewrite.

| Slug | What it is | Your work |
|---|---|---|
| `tcas` | National TCAS admissions data | Configure; the shape is national |
| `kmitl-skill-mapping` | Aggregated skill-demand intelligence via KMITL's institutional-partner API | Request your own client ID + secret key from KMITL |
| `mhesi-cisa` | MHESI CISA | Configure |
| `thailand-demographics` | Thailand youth-cohort projections | Seeded via `pnpm demographics:seed`; national data |
| `world-bank` | World Bank indicators | Public API, works out of the box |
| `mhesi-policy`, `nesdc-reports`, `nxpo-reports`, `boi-sectoral`, `eeco-reports` | Thai policy and sectoral PDF report feeds | Public; already have real connectors |
| `wef-future-of-jobs`, `oecd-reports`, `adb-gms` | International report feeds | Public; already have real connectors |
| `the-rankings`, `qs-rankings`, `scimago`, `imd-rankings` | Ranking datasets | Subscription-gated; your library may already hold them |
| `nso-labor-force`, `tpqi` | National statistics, Thai qualification framework | Configure |

**Two attribution rules that are not negotiable.** KMITL's data is LinkedIn data subscribed by MHESI; KMITL only hosts the API. Never present it to a user as "KMITL data". And the KMITL feed's Thailand × job-postings quadrant is a **thin sample** (161 postings in the observed snapshot against ~950k global LinkedIn profiles) — any Council-facing surface using it must carry a sample-size caveat in its provenance drawer.

**Honest effort estimate:** hours each, mostly waiting on credentials. The `kmitl-skill-mapping` connector is the highest-value one here because it is what lights up the demand side of the Gap Analyzer and the labour-market driver of the health score.

## Tier 3 — Must be rewritten per institution

These read from KKU's own operational systems. The *shape* of what they produce is reusable; the *source* is not.

| Slug | KKU's source | What it feeds |
|---|---|---|
| `kku-registry` | Oracle registrar data warehouse | Enrolment metrics, cohort distributions, student demographics |
| `kku-hr` | MS SQL Server (HCM + `epm_report`) | Faculty members, ranks, compensation aggregates |
| `kku-hr-processed` | Processed HR mirror | Derived staff attributes |
| `kku-finance` | Oracle (tuition) + MS SQL (budget), read in one run | Tuition revenue, faculty budgets |
| `kku-evaluations` | KKU course-evaluation system | Teaching-quality driver of the health score |
| `kku-dq` | KKU digital-competency assessment API | Digital-competency evidence |
| `kku-research` | Internal `kkuscholar` Postgres research mirror (Scopus + PubMed) | Research outputs per faculty member |
| `kku-alumni` | Not yet implemented at KKU either | Graduate outcomes, province-level supply |
| `kku-admission-campaigns`, `kku-tcas-funnel` | KKU admissions systems | Admission funnel |
| `digital-transcript` | KKU digital transcript | Course-level records |

### Worked example — `kku-dq`, a Tier 3 source whose payload you must not store

`kku-dq` is worth reading before you write your own connector, because it is the cleanest example
in the repo of a source that is useful in aggregate and radioactive per row.

KKU's Digital Intelligence assessment API returns **every student in one response** — about 24,800
records, 13.7 MB, in roughly 3.4 s. No pagination to manage; results only move as students sit the
test, so it runs weekly. The payload carries student first names, surnames and ids.

**None of that reaches the database, the logs, or disk.** Students are resolved to a programme *in
memory*, and the connector writes only two aggregate cubes: one per (faculty × programme × cohort),
one adding a module dimension. This is the same aggregate-at-source posture as `kku-registry` and
`kku-hr`, and it is the posture to copy — it is far easier to defend to a DPO than a per-row table
with an access-control story attached.

Three design decisions in that connector generalise:

- **Store `scoreSum` + `takenCount`, never a stored mean.** That is what makes a faculty or
  university figure a true weighted mean rather than a mean of means. If you store means you cannot
  recover the weighting later.
- **Do not drop what you cannot resolve.** Students who resolve to no programme land under a null
  `programId` that the dashboard renders as "Program not identified". Coverage is cohort-shaped —
  recent intakes resolve well, older ones poorly, because the resolution table is a current
  enrolment snapshot while the export is cumulative. Hiding those rows would have silently shrunk
  every faculty total.
- **`ingestion_run_id` is `onDelete: Restrict`, not nullable.** A cube row that outlives its run is
  unprovenanced, and `realDataWhere()` would silently drop it — see Trap 2. The constraint makes
  that unrepresentable rather than merely discouraged.

**How to approach a Tier 3 rewrite:**

1. Read the KKU connector's file header first. Every one of them documents the discovery process — which tables were probed, which columns turned out to be 100% NULL, which join keys are load-bearing, which collation mismatch bit them. Even where the source differs, the *questions* transfer.
2. Read the matching `docs/data-sources/<slug>.md` spec. These describe endpoint, rate limit, PDPA posture, and known issues.
3. Follow `prompts/14-integration-session-template.md` — see [Write a connector](../guides/write-a-connector.md).
4. **Aggregate at source.** The KKU connectors push `GROUP BY` and small-cell suppression (`HAVING COUNT(*) >= 5`) into the SQL so per-person data never crosses the wire. Preserve this. It is the single design decision that makes the PDPA story defensible.

**Honest effort estimate:** one to three weeks per connector, dominated by getting read access to systems whose owners have no reason to give it to you. Start the access conversations before you start the code. `kku-registry` and `kku-hr` are the two with the highest downstream leverage.

**Before you write a Tier 3 connector, check whether a spreadsheet covers it.** Registrar, HR and finance figures each have an import dataset that writes the same tables: enrolment, student and alumni cohorts, admission campaigns, class offerings, staff, compensation, budgets, finance and publications (full list in [Importing from spreadsheets](../data-import.md#what-you-can-import-today)). A term's export, uploaded each term, lights up the cockpit and deep-dive in days rather than weeks. Write the connector when the manual export becomes the bottleneck. Uploads and connector runs can feed the same table. When both write the same row, it stays attributed to the connector, and the connector's next run overwrites the uploaded figures, so don't run both for the same years.

## Tier 4 — Content, not code

Nothing to write; things to supply.

| What | Where it goes |
|---|---|
| Your faculties and departments | Spreadsheet upload at `/admin/data-setup` (*Faculties*, *Departments*). Thai institutions: spell faculty names the way TCAS does, or admission figures will not link |
| Your programme list | Spreadsheet upload (*Programmes*), plus `/admin/programs` for ongoing edits. See [Curriculum documents and the AI digest pipeline](../guides/curriculum-pdfs-and-ai-digest.md) |
| Your programme curriculum PDFs | `pnpm pdf:bulk-load`, or the UI at `/admin/programs/[id]?tab=files` |
| Course lists the PDF pipeline cannot read | Spreadsheet upload (*Programme course lists*). Takes precedence over PDF extraction for the programmes it names |
| Your logos and colours | See [Rebrand the platform](../guides/rebrand.md) |
| TH Sarabun New font files | `infra/gotenberg/fonts/` — committed; their own licence (SIPA) |
| Your skill taxonomy | Built from your own data with `pnpm skills:normalise`. A fresh installation has none. See [Building your skill taxonomy](../guides/curriculum-pdfs-and-ai-digest.md#building-your-skill-taxonomy). Do not use `pnpm db:seed:kku` for it: that loads KKU's data and 500 synthetic placeholder skills |

## Next step

Continue with [Ingestion framework](../data-sources.md).
