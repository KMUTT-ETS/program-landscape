# Tutorial: get Program Deep-Dive working

**Outcome.** `/programs/<id>` shows real content, not empty states, in every
section it can — first for one programme, then for the whole portfolio.

**Starting point.** A running local instance from
[Fresh checkout setup](../guides/fresh-checkout-setup) (stack up, signed in as an
admin). Every command below runs from the repo root.

**Time and cost.** About an hour for the one-programme path. AI spend is roughly
**USD 0.80 per programme** across all phases (the per-phase figures come from
`PROGRAM_PHASE_META` in `packages/shared/src/pipeline/program-phases.ts` and are
approximations). A full run over 297 programmes is therefore in the low hundreds
of dollars — run one programme first.

## How Deep-Dive gets its data

Deep-Dive computes nothing on its own. Each section reads tables that something
else fills. If a section is empty, one of those is missing, and the page's empty
state usually names it.

| Section on the page | Needs | Filled by |
|---|---|---|
| Executive snapshot — verdict, narrative, AI readiness | most of the rows below, plus the narrative and readiness assessments | pipeline phases 6 and 7 |
| Admissions — TCAS funnel and round-3 detail | TCAS admission statistics linked to the programme | `tcas` connector |
| Students — cohorts, lifecycle | cohort and alumni-status rows | pipeline phase 4 (`kku-registry`) |
| Students — demographic outlook | youth-cohort projections | `pnpm demographics:seed` |
| Outcomes | graduate outcome surveys | survey upload or `kku-alumni` |
| Curriculum & Faculty — skills, courses | the programme's curriculum PDF, digested and approved | pipeline phases 1, 2, 2b |
| Curriculum & Faculty — faculty | the staff roster | phase 1 plus `kku-hr` |
| Curriculum & Faculty — research expertise, revision | staff publications | `kku-research`, pipeline phases RE and CR |
| Overlap | same-level pair scores | `programs:overlap-prep`, pipeline phase OV |
| Financials | tuition and cost rows | pipeline phase 4 (`kku-finance`) — preview-quality |
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

For KKU, the master sheet seeds all 297 programmes:

```bash
pnpm programs:seed-from-sheet --dry-run   # report only
pnpm programs:seed-from-sheet             # smart-merge upsert
```

The default mode never overwrites digest-derived fields. Do not use `--wipe`
unless a schema change forces a clean recreate: it deletes every programme and
cascades to their digests.

For another institution, create programmes at `/admin/programs/from-pdf` or load
them with your own seed; the sheet URL in the script is KKU's.

## Step 3 — Attach each programme's curriculum PDF

Open `/admin/programs?view=pipeline`. The **missing-pdf** bucket lists
programmes with no curriculum document. Attach the PDF per programme at
`/admin/programs/<id>?tab=files`.

There is deliberately no bulk filename matcher: the fuzzy one was retired on
2026-07-29 after it mislinked about 30 programmes. `pnpm pdf:bulk-load` is for
policy and report PDFs by URL, not for linking programmes.

## Step 4 — Load the data feeds

Open `/admin/data-setup` ("Feed the system"). It shows, per category, how much is
loaded. Load what you can:

```bash
pnpm demographics:seed          # youth-cohort projections (no credentials)
pnpm connector:run tcas         # TCAS round-3 statistics (no credentials)
```

Run `tcas` again after Step 2: rows link to a programme only when its faculty and
programme `nameTh` match CUPT's spelling exactly, and unmatched rows are kept
with no programme.

The institutional connectors (`kku-registry`, `kku-hr`, `kku-finance`,
`kku-research`) need database credentials and are `real` at KKU only; elsewhere
they stay mocked and their sections stay empty. See the
[Source catalogue](../data-sources/README) and each source's spec. Check any run
at `/admin/data-sources/<slug>`.

## Step 5 — Run the pipeline on one programme

Pick a programme with a PDF attached and run it end to end:

```bash
pnpm programs:pipeline KKU-SEQ-0001
```

Useful variations:

```bash
pnpm programs:pipeline <code> --skip=phase4   # no Oracle/MSSQL access
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
