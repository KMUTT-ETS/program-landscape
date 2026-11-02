# Tutorial: get Program Deep-Dive working

**Outcome.** `/programs/<id>` shows real content, not empty states, in every
section it can — first for one programme, then for the whole portfolio.

**Starting point.** A running local instance from
[Fresh checkout setup](../guides/fresh-checkout-setup.md) (stack up, signed in as an
admin). Every command below runs from the repo root.

**Time and cost.** About an hour for the one-programme path, plus however long
your data-source access takes. AI spend is roughly **USD 0.80 per programme**
across all phases (the per-phase figures come from `PROGRAM_PHASE_META` in
`packages/shared/src/pipeline/program-phases.ts` and are approximations), so run
one programme before a full run.

**Before you start, set your institution's identity** at `/admin/organization`
(names, short names, region). Admissions data is matched on the Thai institution
name, and the form shows how many TCAS rows it matches.

## How Deep-Dive gets its data

Deep-Dive computes nothing on its own. Each section reads tables that something
else fills. If a section is empty, one of those is missing, and the page's empty
state usually names it.

| Section on the page | Needs | Filled by |
|---|---|---|
| Executive snapshot — verdict, narrative, AI readiness | most of the rows below, plus the narrative and readiness assessments | [pipeline](#step-5--run-the-pipeline-on-one-programme) phases 6 and 7 |
| Admissions — TCAS funnel and round-3 detail | TCAS admission statistics linked to the programme | [TCAS](#tcas-admissions) |
| Students — cohorts, lifecycle | cohort and alumni-status rows | pipeline phase 4 — see [Registrar](#registrar-enrolment-cohorts-alumni-status) |
| Students — demographic outlook | youth-cohort projections, and the programme's latest intake | [Thailand demographics](#thailand-demographics) and [Registrar](#registrar-enrolment-cohorts-alumni-status) |
| Outcomes | graduate outcome records | no connector exists yet — see [Graduate outcomes](#graduate-outcomes) |
| Curriculum & Faculty — skills, courses | the programme's curriculum PDF, digested and approved | pipeline phases 1, 2, 2b |
| Curriculum & Faculty — skills, demand side | labour-market skill demand | [Labour-market skills](#labour-market-skills) |
| Curriculum & Faculty — faculty | a staff roster, matched to the staff named in the curriculum PDF | [Staff roster](#staff-roster-hr) |
| Curriculum & Faculty — research expertise, revision | staff publications | [Research outputs](#research-outputs), pipeline phases RE and CR |
| Overlap | same-level pair scores | pipeline phase OV |
| Financials | tuition and cost rows | pipeline phase 4 — see [Finance](#finance-tuition-and-budget); preview-quality |
| Benchmarking | AI-selected peers and review | pipeline phase 5 |

The full table-by-table map is in
[Evaluation pipeline §7.1](../evaluation-pipeline.md#71-by-table--who-reads-it).

## Step 1 — Configure an AI provider

Without a key the AI phases produce placeholders only. In your root environment
file set:

```bash
AI_PROVIDER=google
GOOGLE_AI_API_KEY=<your key>
```

Restart `pnpm dev` after changing it. Leave `AI_PROVIDER=stub` if you only want
to look at the deterministic sections. Usage policy and logging for AI calls are in
[AI governance](../ai-governance.md).

## Step 2 — Create the programme rows

Submit each curriculum document at `/admin/programs/from-pdf` and choose **A new
programme**. It creates the programme record from the details extracted from the
file and attaches the file in one step. Programmes created this way already have
their PDF, so you can skip Step 3 for them.

If you already hold a list of programmes (a spreadsheet or a registry export),
load them with your own seed instead and attach the files in Step 3. The
repository's `pnpm programs:seed-from-sheet` is the reference deployment's seed
for its own master sheet: it reads a fixed sheet URL and is not a general importer.

How a curriculum PDF becomes programme data is described in
[PDF ingestion](../pdf-ingestion.md) and in the
[Adopter guide](../adopters/README.md#10-programme-documents-and-the-ai-digest-pipeline).

## Step 3 — Attach a curriculum PDF to existing programmes

Open `/admin/programs?view=pipeline`. The **missing-pdf** bucket lists
programmes with no curriculum document. Attach the PDF per programme at
`/admin/programs/<id>?tab=files`.

There is deliberately no bulk filename matcher: the reference deployment retired
its fuzzy one after it mislinked about 30 programmes, and it should not be
rebuilt. `pnpm pdf:bulk-load` is for policy and report PDFs by URL, not for
linking programmes.

## Step 4 — Configure the data sources

Open `/admin/data-setup` ("Feed the system"). It shows, per category, how much is
loaded. This step walks through the sources Deep-Dive reads, easiest first. For
each one: what it feeds, what to configure, and how to know it worked.

How hard each source is for you depends on its tier in the
[Adopter guide](../adopters/README.md#8-data-integration--the-four-tiers-of-adoption-effort):
public and national sources work as they are, while the sources that read an
institution's own systems — registrar, HR, finance, research — must be written
against yours. Until a source is wired, the sections it feeds stay empty. That is
the intended behaviour, and there is no mock-data fallback. The four
institution-specific sources need a connector adapted to your systems first — see
[Institution-specific sources](#institution-specific-sources-adapt-the-connector-first).

Verify any source the same way: open `/admin/data-sources/<slug>` and look for a
**SUCCEEDED** run with a non-zero record count, and read the run's metadata. A
run can succeed with zero records, and a mocked run succeeds while writing
nothing.

### TCAS admissions

- **Feeds:** the Admissions section (funnel and round-3 score detail) and the
  attractiveness drivers of the [health score](../methodologies/health-score.md).
- **Tier:** national, same for every Thai institution; no credentials.
- **Configure:** nothing beyond `/admin/organization`. The Thai institution name
  must match the national TCAS data exactly; the form shows the match count.
- **Run:**

  ```bash
  pnpm connector:run tcas
  ```

- **Then:** run it again after your programmes exist. Rows link to a programme
  only when its faculty and programme `nameTh` match the national spelling
  exactly; unmatched rows are kept with no programme and listed in the run
  metadata.
- **Not applicable** outside Thailand.
- **More:** [Fresh checkout setup — loading the first public data
  sources](../guides/fresh-checkout-setup.md#loading-the-first-public-data-sources),
  [TCAS source spec](../data-sources/tcas.md).

### Thailand demographics

- **Feeds:** the demographic outlook, and the demographic-resilience part of the
  health score.
- **Tier:** national; nothing to configure.
- **Run:** a seed script, not a connector — the figures are in the script and
  nothing is downloaded:

  ```bash
  pnpm demographics:seed
  ```

- **Verify:** the Demographic outlook section appears on a programme. It also
  needs the programme's latest intake, which comes from the
  [registrar](#registrar-enrolment-cohorts-alumni-status) enrolment figures, so it
  can stay empty until that source is loaded.
- **Not applicable** outside Thailand.

### Labour-market skills

- **Feeds:** the demand side of the Skills section, the relevance drivers of the
  health score, and pipeline phase 3 (careers and demand match).
- **Tier:** shared external source; you need your own credentials.
- **Configure:** request a client ID and secret key from the provider, then set
  the three `KMITL_SKILL_MAPPING_*` keys (`BASE_URL`, `CLIENT_ID`, `SECRET_KEY`)
  and `CONNECTOR_KMITL_SKILL_MAPPING_MODE=real` in your root environment file.
  Wrap any value containing `#` in single quotes: an unquoted `#` truncates the
  value silently.
- **Check the credentials, then load:**

  ```bash
  pnpm kmitl:capture ping
  pnpm connector:run kmitl-skill-mapping
  ```

- **Two rules for how you present it.** The data is LinkedIn data subscribed by
  MHESI and only hosted by KMITL — never label it "KMITL data". And the
  Thailand × job-postings slice is a thin sample, so any figure built on it needs
  a sample-size caveat.
- **Expect** most of the provider's skill names not to match your skill taxonomy
  on the first run; the unmatched names are listed in the run metadata for review.
- **More:** [labour-market source spec](../data-sources/kmitl-skill-mapping.md),
  [Adopter guide, Tier 2](../adopters/README.md#tier-2--shared-national-and-external-sources-same-for-everyone).

### Institution-specific sources: adapt the connector first

The next four sources — registrar, staff roster, research, finance — read your
own systems. **The repository ships no ready-made connector for them.** What it
ships is the reference deployment's connectors (`kku-registry`, `kku-hr`,
`kku-research`, `kku-finance`), which contain that institution's SQL, table names
and code mappings. You must adapt the connector for each source before running it.

**Nothing in this tutorial seeds mock data.** In the default `mocked` mode a
connector is a stub that writes nothing to the database — its run metadata says
`mocked — no DB writes`. The danger is that such a run still shows
**SUCCEEDED** with a non-zero record count. If you run a source's connector before
adapting it, you get a green run and an empty section. Open the run at
`/admin/data-sources/<slug>` and read its metadata: a real run of a reference
connector says `connectorMode: real`, a mocked one says `mocked — no DB writes`.
The `data_sources` flag cannot tell you, because the catalogue already marks the
reference sources as real.

For each source, work through these steps in order:

1. **Prepare.** Fill in the source's spec, put credentials in your secret store,
   and capture a sample payload as a test fixture. The per-source session
   playbook and its pre-session checklist are in the
   [connector session template](../../prompts/14-integration-session-template.md).
2. **Adapt the connector.** Edit
   `apps/ingestion/src/connectors/sources/<slug>/connector.ts` (and its
   `transforms.ts`) for your system: the SQL projection, the mapping from your
   system's identifiers to your programmes and staff, and the status codes.
   Keep the three safeguards the reference connectors share: aggregate at the
   source so per-person rows never leave the database, refuse to load when the
   source returns zero rows (a snapshot replace would otherwise wipe the table),
   and stamp every row with the run id (see
   [the `realDataWhere` trap](../adopters/README.md#trap-2-realdatawhere--empty-sections-with-rows-in-the-database)).
3. **Register and switch it on.** Pair your real class with the mock in
   `apps/ingestion/src/connectors/registry.ts`, set `CONNECTOR_<SLUG>_MODE=real`
   (slug uppercased, non-alphanumerics to `_`) and restart the ingestion worker.
   Setting the flag without registering a real class falls back to the mock
   with a warning.
4. **Keep the two flags in step.** The `data_sources` row has independent
   `status` and `mocked` columns; both must be updated. Run
   `pnpm data-sources:audit` after every flip.
5. **Run and prove it.** `pnpm connector:run <slug>` runs the same code as the
   worker. The playbook's exit criterion is at least three successful runs with
   zero failures, and a recorded row-count fingerprint.

Plan on one to three weeks per source, most of it spent getting read access. The
full contract (`healthCheck`, `fetch`, `transform`, `load`) and the reasoning
are in [the connector contract](../adopters/README.md#9-the-connector-contract-and-how-to-write-one).
The adopter guide also lists the UniCon DS feeds as the nearly-portable starting
point for Thai universities
([Tier 1](../adopters/README.md#tier-1--works-nearly-as-is-the-mhesi-unicon-ds-family));
they load their own tables, so check which sections you need actually read them
before relying on them.

The commands under each source below are the **reference deployment's**, shown so
you can see the shape of the work. They run only after the steps above.

### Registrar: enrolment, cohorts, alumni status

- **Feeds:** the connector loads enrolment and demographic counts per programme
  and entry year, which the Demographic outlook, the per-student financial
  figures and the health score read. The Students section's cohort and alumni
  charts come from pipeline phase 4, a separate set of scripts.
- **Tier:** reads your own system, so it must be written against it. The
  reference deployment's connector (`kku-registry`) reads an Oracle warehouse and
  is the template to copy, including its rule to aggregate at the source so
  per-student rows never leave the database.
- **Reference configuration:** the five `KKU_REGISTRY_DB_*` keys and
  `CONNECTOR_KKU_REGISTRY_MODE=real`. The registrar's text names have no stable
  programme code, so they are bridged to programmes through an explicit mapping
  table. Your connector will need an equivalent bridge:

  ```bash
  pnpm registry:seed-mappings
  pnpm connector:run kku-registry
  ```

- **Watch for:** with an empty mapping table the run still reports success but
  loads zero records, and every row lands in the run's `unmappedSamples` list.
  That list is your worklist.
- **Phase 4 is not portable.** The pipeline's cohort, alumni and financial
  linking scripts (`programs:link-cohorts`, `programs:link-alumni`,
  `programs:link-financials`) query the reference deployment's registrar and HR
  views directly. At another institution, run the pipeline with
  `--skip=phase4` and fill those tables from spreadsheets instead — the
  *Student Cohorts*, *Alumni Cohorts* and *Finance* datasets in
  [the data import guide](../data-import.md) write the same tables. The
  Deep-Dive's empty cohort and funnel sections link admins straight to those
  imports.
- **Step by step:** [Adapt the registrar connector](./adapt-the-registrar-connector.md)
  walks through this source from schema discovery to a verified run.
- **More:** [registrar source spec](../data-sources/kku-registry.md),
  [Adopter guide, Tier 3](../adopters/README.md#tier-3--must-be-rewritten-per-institution),
  [the connector contract](../adopters/README.md#9-the-connector-contract-and-how-to-write-one).

### Staff roster (HR)

- **Feeds:** the Faculty part of Curriculum & Faculty, the capability drivers of
  the health score, and the matching of publications to people.
- **Why it matters:** pipeline phase 1 reads the staff named in the curriculum
  PDF; the roster is what those names are matched against.
- **Tier:** reads your own system; written per institution. The reference
  connector (`kku-hr`) shows the pattern: hash identifiers at the boundary,
  suppress small groups server-side, and read only the columns you need.
- **Reference configuration:** the `KKU_HR_DB_*` keys,
  `CONNECTOR_KKU_HR_MODE=real`, then:

  ```bash
  pnpm hr:seed-mappings
  pnpm connector:run kku-hr
  ```

- **Your data-protection officer must approve the projection independently.**
  Another institution's approval does not transfer — see
  [PDPA and governance](../pdpa.md).
- **More:** [HR source spec](../data-sources/kku-hr.md).

### Research outputs

- **Feeds:** research expertise and curriculum revision (phases RE and CR), the
  publications driver of the health score, and the AI-readiness research signal.
- **Order matters:** load the staff roster first. Publications are matched to
  roster members by name, and unmatched authors are kept with no person attached.
- **Tier:** depends on where your publications live. The reference connector
  (`kku-research`) reads an internal publications mirror, so adapt it as above;
  the earlier public-API approach (OpenAlex and Scopus) is documented in its spec
  and is the usual starting point if you have no internal mirror.
- **Reference run:** `pnpm connector:run kku-research`, after adapting.
- **More:** [research source spec](../data-sources/kku-research.md).

### Finance: tuition and budget

- **Feeds:** the Financials section and the financial drivers of the health score.
- **Tier:** reads your own systems; written per institution. The reference
  connector (`kku-finance`) reads tuition and budget in one run
  (`pnpm connector:run kku-finance`, after adapting).
- **Treat the output as preview-quality.** Cost allocation is unfinished even in
  the reference deployment and is marked as preview until its governance
  sign-off. See [Cost allocation](../methodologies/cost-allocation.md).
- **More:** [finance source spec](../data-sources/kku-finance.md).

### Graduate outcomes

The Outcomes section reads graduate-outcome records. No connector fills them yet,
even in the reference deployment (the alumni source is a stub), so this section is
expected to be empty until your institution supplies the data. Do not read an
empty Outcomes section as a failed setup.

### What you can skip

You do not need every source to get a useful Deep-Dive. With only the curriculum
PDFs, the AI provider and the two national feeds (TCAS, demographics), these
sections work: Executive snapshot (partly), Admissions, Demographic outlook,
Skills, Courses, Overlap and Benchmarking. Add the registrar, staff roster,
research and finance sources to fill Students, Faculty, research expertise and
Financials.

## Step 5 — Run the pipeline on one programme

Pick a programme with a PDF attached and run it end to end. `<code>` is the
programme's code as shown in `/admin/programs`; its sequence number or database id
also work:

```bash
pnpm programs:pipeline <code>
```

Useful variations:

```bash
pnpm programs:pipeline <code> --skip=phase4   # registrar/finance links not wired
pnpm programs:pipeline <code> --only=phase5   # peers only
```

The phases, in execution order, are 1 and 2b (in parallel), 2, 3, 4, 6, 5, RE, CR,
7, OV, 8. Phase 6 runs before 5 because the readiness score feeds the peer
review. Phase 7 (narrative) is the last of the narrative chain and depends on the
phases before it; it is also the "done" marker the status command uses.

If phase 2b cannot read the course list from your PDF (it reports "Could not
locate the รายวิชา section"), upload the list instead with the **Programme course lists**
dataset at `/admin/data-setup`. An uploaded list is never overwritten by
the pipeline; see [Data import](../data-import.md#programme-course-lists--the-fallback-when-the-pdf-cannot-be-read).

`--only` and `--skip` silently drop ids they do not recognise, so a typo runs
nothing. Valid ids are `phase1`, `phase2`, `phase2b`, `phase3`, `phase4`,
`phase5`, `phase6`, `phaseRE`, `phaseCR`, `phase7`, `phaseOV`, `phase8`.

Phase OV prepares its own inputs (PLOs, course descriptions, embeddings) before
it scores, so a single-programme run needs no separate prep step. It compares the
programme against same-level siblings, so the Overlap section stays hidden until
at least one sibling reaches the display threshold.

The scoring each phase feeds is described in the
[Evaluation pipeline](../evaluation-pipeline.md).

## Step 6 — Check the result

Open `/programs`, pick the programme, and walk the section rail. Compare each
section with the table at the top. An empty section is expected when its source
is missing — that is the intended behaviour, not a failure. If you see numbers you
cannot trace, investigate rather than trust them.

## Step 7 — Scale to the portfolio

Once one programme looks right, use the launcher on `/admin/data-setup`
("Full program documents"):

- **Full run** — every phase on every canonical programme, or only the
  not-yet-narrated ones with **Resume**.
- **Partial run** — tick only the phases you want. The picker has no dependency
  engine, so respect the order above; phase CR skips without research expertise.

Or from the CLI:

```bash
pnpm programs:pipeline --all --limit=5   # smoke-test cap
pnpm programs:pipeline --all
pnpm programs:pipeline-status --watch    # progress, rate, ETA
```

With more than one programme selected, phase OV runs once after the loop rather
than once per programme. To run the overlap step on its own, or to preview what
it will do, prepare the data and then run the comparison. The prep script is a
dry run unless given `--apply`:

```bash
pnpm programs:overlap-prep               # counts only, no model calls
pnpm programs:overlap-prep --apply
pnpm programs:overlap --apply
```

The method is in [Programme overlap](../methodologies/program-overlap.md).

## When a section is empty but the rows exist

Almost always the provenance filter. Rows count only when they carry an
`ingestion_run_id` whose data source has `mocked = false`; a legacy row with a
NULL run id, or a source whose `mocked` flag was never cleared, silently
disappears from the page. Check both. The triage SQL is in the
[project contract](../../CLAUDE.md) (search for `realDataWhere`),
and the trap is explained in the
[Adopter guide](../adopters/README.md#trap-2-realdatawhere--empty-sections-with-rows-in-the-database).

## Where to go next

- [Evaluation pipeline](../evaluation-pipeline.md) — how the scorers interlock.
- [Health score](../methodologies/health-score.md) and
  [Programme health & lifecycle](../methodologies/program-health-and-lifecycle.md).
- [Source catalogue](../data-sources/README.md) — every source and its status.
- [PDF ingestion](../pdf-ingestion.md) — what happens to an attached curriculum PDF.
