# Tutorial: get Program Deep-Dive working

**Outcome.** `/programs/<id>` shows real content, not empty states, in every
section it can — first for one programme, then for the whole portfolio.

**Starting point.** A running local instance from
[Fresh checkout setup](../guides/fresh-checkout-setup) (stack up, signed in as an
admin). Every command below runs from the repo root.

**Time and cost.** About an hour for the one-programme path. AI spend is roughly
**USD 0.80 per programme** across all phases (the per-phase figures come from
`PROGRAM_PHASE_META` in `packages/shared/src/pipeline/program-phases.ts` and are
approximations). A full run costs about USD 0.80 times your number of
programmes — a few hundred programmes is in the low hundreds of dollars — so run
one programme first.

**Before you start, set your institution's identity** at `/admin/organization`
(names, short names, region). Admissions data is matched on the Thai institution
name, and the form shows how many TCAS rows it matches.

## How Deep-Dive gets its data

Deep-Dive computes nothing on its own. Each section reads tables that something
else fills. If a section is empty, one of those is missing, and the page's empty
state usually names it.

| Section on the page | Needs | Filled by |
|---|---|---|
| Executive snapshot — verdict, narrative, AI readiness | most of the rows below, plus the narrative and readiness assessments | pipeline phases 6 and 7 |
| Admissions — TCAS funnel and round-3 detail | TCAS admission statistics linked to the programme | `tcas` connector |
| Students — cohorts, lifecycle | cohort and alumni-status rows | pipeline phase 4 (your registrar connector) |
| Students — demographic outlook | youth-cohort projections | `pnpm demographics:seed` |
| Outcomes | graduate outcome surveys | survey upload, or an alumni connector |
| Curriculum & Faculty — skills, courses | the programme's curriculum PDF, digested and approved | pipeline phases 1, 2, 2b |
| Curriculum & Faculty — faculty | the staff roster | phase 1 plus your HR connector |
| Curriculum & Faculty — research expertise, revision | staff publications | your research connector, pipeline phases RE and CR |
| Overlap | same-level pair scores | `programs:overlap-prep`, pipeline phase OV |
| Financials | tuition and cost rows | pipeline phase 4 (your finance connector) — preview-quality |
| Benchmarking | AI-selected peers and review | pipeline phase 5 |

The full table-by-table map is in
[Evaluation pipeline §7.1](../evaluation-pipeline).

## Step 1 — Configure an AI provider

Without a key the AI phases produce placeholders only. In your root environment
file set:

```bash
AI_PROVIDER=google
GOOGLE_AI_API_KEY=<your key>
```

Restart `pnpm dev` after changing it. Leave `AI_PROVIDER=stub` if you only want
to look at the deterministic sections.

## Step 2 — Create the programme rows

Submit each curriculum document at `/admin/programs/from-pdf` and choose **A new
programme**. It creates the programme record from the details extracted from the
file and attaches the file in one step. Programmes created this way already have
their PDF, so you can skip Step 3 for them.

If you already hold a list of programmes (a spreadsheet or a registry export),
load them with your own seed instead and attach the files in Step 3. The
repository's `pnpm programs:seed-from-sheet` is the reference deployment's seed
for its own master sheet: it reads a fixed sheet URL and is not a general importer.

## Step 3 — Attach a curriculum PDF to existing programmes

Open `/admin/programs?view=pipeline`. The **missing-pdf** bucket lists
programmes with no curriculum document. Attach the PDF per programme at
`/admin/programs/<id>?tab=files`.

There is deliberately no bulk filename matcher: the reference deployment retired
its fuzzy one after it mislinked about 30 programmes, and it should not be
rebuilt. `pnpm pdf:bulk-load` is for policy and report PDFs by URL, not for
linking programmes.

## Step 4 — Load the data feeds

Open `/admin/data-setup` ("Feed the system"). It shows, per category, how much is
loaded. Two feeds need no credentials and are Thailand-wide, so they work for any
Thai institution:

```bash
pnpm demographics:seed          # Thailand youth-cohort projections
pnpm connector:run tcas         # TCAS round-3 admission statistics
```

Run `tcas` again after Step 2. Rows link to a programme only when its faculty and
programme `nameTh` match the spelling in the national TCAS data exactly; unmatched
rows are kept with no programme and are listed in the run metadata. Outside
Thailand these two feeds do not apply, and the Admissions and demographic
sections stay empty.

The institutional feeds — registrar (cohorts, alumni status), HR (staff roster),
finance (tuition and cost) and research (publications) — read your own systems,
so each needs a connector written against them and database credentials. Until a
connector is wired its sections stay empty, which is the intended behaviour.
Which sources exist, their status, and how to wire one are in the
[Source catalogue](../data-sources/README) and the
[Adopter guide](../adopters/README). Check any run at
`/admin/data-sources/<slug>`.

## Step 5 — Run the pipeline on one programme

Pick a programme with a PDF attached and run it end to end. `<code>` is the
programme's code as shown in `/admin/programs`; its sequence number or database id
also work:

```bash
pnpm programs:pipeline <code>
```

Useful variations:

```bash
pnpm programs:pipeline <code> --skip=phase4   # registrar/finance connectors not wired yet
pnpm programs:pipeline <code> --only=phase5   # peers only
```

The phases, in execution order, are 1 and 2b (in parallel), 2, 3, 4, 6, 5, RE, CR,
7, OV, 8. Phase 6 runs before 5 because the readiness score feeds the peer
review. Phase 7 (narrative) is the last of the narrative chain and depends on the
phases before it; it is also the "done" marker the status command uses.

`--only` and `--skip` silently drop ids they do not recognise, so a typo runs
nothing. Valid ids are `phase1`, `phase2`, `phase2b`, `phase3`, `phase4`,
`phase5`, `phase6`, `phaseRE`, `phaseCR`, `phase7`, `phaseOV`, `phase8`.

Phase OV prepares its own inputs (PLOs, course descriptions, embeddings) before
it scores, so a single-programme run needs no separate prep step. It compares the
programme against same-level siblings, so the Overlap section stays hidden until
at least one sibling reaches the display threshold.

## Step 6 — Check the result

Open `/programs`, pick the programme, and walk the section rail. Compare each
section with the table at the top. An empty section is expected when its source
is missing — that is the intended behaviour, not a failure. There is no mock-data
fallback; if you see numbers you cannot trace, investigate rather than trust them.

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

## When a section is empty but the rows exist

Almost always the provenance filter. Rows count only when they carry an
`ingestion_run_id` whose data source has `mocked = false`; a legacy row with a
NULL run id, or a source whose `mocked` flag was never cleared, silently
disappears from the page. Check both. The triage SQL is in the
[project contract](../_generated/project-contract) (search for `realDataWhere`).

## Where to go next

- [Evaluation pipeline](../evaluation-pipeline) — how the scorers interlock.
- [Health score](../methodologies/health-score) and
  [Programme health & lifecycle](../methodologies/program-health-and-lifecycle).
- [PDF ingestion](../pdf-ingestion) — what happens to an attached curriculum PDF.
