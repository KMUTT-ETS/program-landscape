# Curriculum documents and the AI digest pipeline

> **ภาษาไทย:** [ฉบับภาษาไทย](../th/guides/curriculum-pdfs-and-ai-digest.md)

**Outcome.** You can load curriculum PDFs, run the AI digest pipeline, build a skill taxonomy and budget the cost.

This is how a stack of curriculum PDFs becomes structured, queryable programme data. It is one of the most valuable parts of the platform and it transfers to your institution almost unchanged.

## The flow

```
Curriculum PDF  →  MinIO + PdfDocument row (content-hash deduped)
                →  AI digest (program-digest.v1)
                →  AiExtraction row: AUTO_APPROVED when its confidence clears
                   AI_AUTO_APPROVE_THRESHOLD (code default 0), else PENDING_REVIEW
                   until a human approves it
                →  materialised onto Program + ProgramSkill rows
                   (ProgramSkill only for names that exactly match the taxonomy)
                →  unmatched skill names → PROPOSED_SKILL extractions
                →  pnpm skills:normalise --source=program_digest → new Skill rows
```

## Commands

| Command | Purpose |
|---|---|
| `pnpm pdf:bulk-load <manifest.jsonl>` | One-time historical backfill. Dry-run by default; `--commit` to actually upload |
| `pnpm programs:digest <code\|mhesi\|seq>` | Digest one programme |
| `pnpm programs:digest-bulk [--limit N] [--level X]` | Bulk, with auto-resume |
| `pnpm programs:approve-pending` | Approve + materialise every digest still `PENDING_REVIEW`. An auto-approved digest was applied when written and is not re-applied |
| `pnpm skills:normalise --source=<linkedin\|program_digest> --auto-promote` | Build the skill taxonomy; see [Building your skill taxonomy](#building-your-skill-taxonomy) |
| `pnpm programs:pipeline <code>` | The full per-programme pipeline (below) |
| `/admin/programs/from-pdf` | The operator-facing submit wizard — new programme *or* revision |
| `/admin/programs/[id]?tab=files` | Attach a PDF through the UI |

Attach PDFs through the UI or `pdf:bulk-load`. KKU previously had a fuzzy filename matcher for linking orphan PDFs to programmes; **it was retired after it mislinked roughly 30 programmes**, which a later content-based audit had to unpick. Do not rebuild it.

## The full pipeline

`pnpm programs:pipeline <code|seq|id>` (or `--all [--limit=N]`) composes what used to be nine hand-run scripts, in dependency order (the table lists them in execution order, so phase 7 comes last). Read the header of `apps/ingestion/src/scripts/programs-pipeline.ts` for the authoritative version; in summary:

| Phase | What | Notes |
|---|---|---|
| 1 | PDF AI extraction — digest, faculty, skills, pedagogy | Runs in parallel |
| 2 | Approve + materialise digest → `ProgramSkill` | DB only, fast |
| 2b | Focused course-code extraction | Runs in parallel with phase 1. Replaces the digest's truncated course list with the full 40–90. **Skips a programme whose course list was uploaded** via the Programme course lists import |
| 3 | Career mapping, demand matching | Sequential |
| 4 | Institutional data linkage — cohorts, alumni, financials | Parallel; hits your registrar/finance sources |
| 6 | AI readiness assessment | **Executes before phase 5** — both 5 and 7 consume its score |
| 5 | Peer selection + peer review | Sequential |
| RE | Research expertise | **Insert-only**, skip-if-exists; never auto-regenerated |
| CR | Curriculum revision | After RE (reads its output). **Insert-only**, like RE |
| OV | Programme overlap | After CR. When several programmes are processed it is deferred and run once as a batch |
| 8 | Risk analysis | Deterministic maths + narrative |
| 7 | Strategic narrative | **Executes last** — it consumes every prior phase, the risk assessment included |

`--skip=phase4` is the flag you want when your registrar connectors are not wired yet. `--only=phase5` runs one phase.

## Revisions — how a second มคอ.2 lands

The flow above is the *first* import of a curriculum. Once a programme exists, a new มคอ.2 must not
simply overwrite it: analyses that a council saw last month would change underneath them with no
record of why. The revision model exists for that, and it is the part of this pipeline most worth
copying wholesale.

A `ProgramRevision` is a staging container: a มคอ.2 attached to a programme, moving through

```
DRAFT → ANALYSING → IN_REVIEW → APPROVED
                              ↘ REJECTED
(an approved revision later displaced by another) → SUPERSEDED
```

`Program.activeRevisionId` points at the one that is live. Every analysis the pipeline produces —
strategic narrative, AI readiness, pedagogy, peer review, research expertise, skills, courses, the
curriculum-revision comparison — carries a `programRevisionId`, so a programme page renders one
internally consistent curriculum and a superseded revision's outputs stay intact and attributable
instead of being overwritten.

Three things to carry across if you implement this yourself:

- **Metadata is proposed, not applied.** Where a revision's digest disagrees with the programme's
  current column values, `metadataProposalJson` records both the proposed values and the ones they
  would replace, rather than writing through silently. Combined with the digest's skip-if-empty
  semantics, a re-digest can never blank a human-curated field.
- **`programRevisionId` is nullable, and NULL means the pre-feature baseline.** It agrees by
  construction with `Program.activeRevisionId` also being NULL. Do not backfill it with a synthetic
  revision — you would be inventing provenance for rows that predate the concept.
- **The operator decides new-vs-revision at submit time, before upload.** `/admin/programs/from-pdf`
  asks that first, then uploads, then — for a new programme — checks for duplicates by code, name
  and degree before committing. Putting the question first is what makes the duplicate check
  meaningful; asking it after extraction invites the operator to rationalise whatever the AI
  guessed.

The comparison itself (`ProgramCurriculumRevision`) is a separate, purely analytical row: an
AI-generated account of what the new curriculum changes, passed through an **anti-fabrication
validator** that strips claims the source text does not support. It stores its deterministic input
snapshot and the validator's drop counts alongside the payload, so a reader can audit the basis
without recomputing it. Expect it to read as terser and more hedged than a human summary — that is
the validator working, not the model underperforming.

## The prompt

`packages/shared/src/ai/prompts/program-digest.ts`, version `program-digest.v1`. A single call against the full PDF text producing a 15-field structured digest: programme metadata, course list with credits and learning outcomes, all skills the curriculum builds with weights and verbatim evidence quotes, a marketing-ready Thai recruitment summary, career paths, self-rated confidence, and caveats.

Materialisation (`packages/db/src/program-digest-materialize.ts`) uses **skip-if-empty semantics** — a re-digest never overwrites a human-curated value with a blank. Extracted skill names resolve against `Skill.nameEn` (lowercased exact) then `Skill.nameTh` (exact); **no fuzzy matching**. Unmatched names become `PROPOSED_SKILL` extractions. These do **not** become skills by being approved: `pnpm skills:normalise --source=program_digest --auto-promote` is the step that turns them into `Skill` rows, after which the digest has to be re-applied. That is how the taxonomy grows from your curriculum vocabulary; see [Building your skill taxonomy](#building-your-skill-taxonomy).

## What this cost KKU, so you can budget

228 of 297 programmes digested. Roughly **$0.04 per digest, ~$8.10 total** across six retry passes, on Gemini. The remaining 69 programmes had no PDF available — mostly medical specialty programmes and new additions. Expect a similar coverage shortfall and plan a document-acquisition workstream separately from the engineering.

## Building your skill taxonomy

**A fresh installation has no skills at all**: the `skills` table holds 0 rows. Until you build a taxonomy, every skill figure in the product reads 0, including all four cards of the Deep-Dive *Skills coverage* section, however many times you run the pipeline. That is because skill matching is exact. A skill the digest extracts reaches a programme (a `ProgramSkill` row) only when its name equals a taxonomy entry: `Skill.nameEn` compared lowercased, then `Skill.nameTh`. With an empty taxonomy nothing can match.

`pnpm setup` does not load a taxonomy, and `pnpm db:seed:kku` is not the answer. It loads KKU's faculties, departments and accounts along with about 60 real skills and 500 synthetic placeholders. The KMITL connector does not create skills either. It loads skill-demand rows, all with an empty `skill_id`, until a taxonomy exists to link them to.

What builds the taxonomy is `pnpm skills:normalise` (`apps/ingestion/src/scripts/normalise-skill-names.ts`). It sends raw skill names to the AI in batches of 25. The model either matches each name to an existing skill or proposes it as new. A proposal becomes a real `Skill` row only when you pass `--auto-promote` **and** its confidence is at least 0.9. Lower-confidence proposals stay in `skill_aliases` with status `NEW_PROPOSED`, waiting for review. Every decision is also written to `logs/normalise-skills-<timestamp>.jsonl`.

**On a fresh install the pipeline builds the taxonomy for you.** Phase 2 of `pnpm programs:pipeline` checks the programme's stored digest. It acts only on a programme that has no skills yet; a programme with skills is left alone. If the digest's skill names match nothing in the taxonomy, it promotes that programme's earlier proposals at confidence 0.9 or more (for example from a `skills:normalise` run without `--auto-promote`), runs the normaliser for that programme's own names with auto-promote, then re-applies the **same stored digest**. That is a database write, not a new AI digest, so phases 3, 6 and 7 later in the same run already see the skills. If every name already matches, it does nothing. Set `PIPELINE_BUILD_SKILL_TAXONOMY=0` to switch this off. `pnpm skills:normalise` stays as the manual tool, and is what you use for the LinkedIn source.

For the usual case, then, it is: digest the programmes, then run the pipeline.

To re-apply stored digests yourself, with no AI call, run `pnpm programs:approve-pending --rematerialise` (every approved digest) or add `--program-id=<id>` for one programme.

The manual route, in order:

| Step | Command | What it does |
|---|---|---|
| 1 | `pnpm connector:run kmitl-skill-mapping` | Loads labour-market skill demand (LinkedIn data via the KMITL connector). Needs credentials; see the [tutorial](../tutorials/program-deep-dive.md#labour-market-skills) |
| 2 | `pnpm skills:normalise --source=linkedin --auto-promote` | Builds the taxonomy from those skill names, then re-links the KMITL demand and growth rows to the new skills |
| 3 | `pnpm programs:pipeline <code> --only=phase1`, or `pnpm programs:digest <code>` | Digests the curriculum PDF. Names that match nothing become `PROPOSED_SKILL` extractions |
| 4 | `pnpm skills:normalise --source=program_digest --auto-promote` | Adds your curriculum's own vocabulary to the taxonomy |
| 5 | `pnpm programs:approve-pending --rematerialise` | Re-applies the stored digests so their skills now match. No AI call |
| 6 | `pnpm programs:pipeline <code> --only=phase3` | Career mapping and demand match. It must run **after** steps 2 and 5, or the *Demand match* card stays 0 |

- **Cost and time:** about USD 0.003 per batch of 25, so roughly USD 1 and 45 minutes for ~5,900 LinkedIn names. That was measured on an OpenRouter install; your model's price sets yours. The digest source is usually far smaller.
- **Re-running is safe.** Names already decided are skipped, so a second run only retries the ones that failed. The summary's `Failed:` line is the one to read. The script exits 0 even when batches failed, for example on an OpenRouter balance refusal ([see below](./configure-ai.md#running-on-openrouter)).
- **Without KMITL access, or outside Thailand,** skip steps 1, 2 and 6. Steps 3 to 5 still give you a taxonomy built entirely from your own curricula. The *Demand match* card then stays empty, because nothing supplies demand.
- **`PROPOSED_SKILL` approval does not create skills.** With `AI_AUTO_APPROVE_THRESHOLD` unset (its code default is 0), those extractions are auto-approved as soon as they are written. Approval only changes their review status; only step 4 turns them into `Skill` rows.

**Re-applying a digest costs no AI call.** `--rematerialise` writes the stored digest again. Re-running the AI digest (`pnpm programs:digest <code> --force`) is only needed when you want the curriculum re-read.

## Thai PDF output requires TH Sarabun New

All PDF *output* (Council Packs, briefs, decision records) renders through Gotenberg with TH Sarabun New embedded. The four `.ttf` files are committed at `infra/gotenberg/fonts/`, so `docker compose build gotenberg` works on a fresh clone. Do not rename or remove them: the build fails without them. Their source and licence are in `infra/gotenberg/README.md`.

Two things that will catch you:

- The Docker build **fails loudly** if the fonts are missing — a `COPY` abort plus a post-`fc-cache` check that counts registered Sarabun faces. This is deliberate; the alternative failure mode is silently rendering tofu boxes in an official document.
- Google Fonts' **"Sarabun" is a different typeface** (Cadson Demak's). It is not TH Sarabun New and does not satisfy the Thai Cabinet requirement for official documents. Do not substitute it.

Never generate PDFs in-process. No puppeteer, no react-pdf, no html-pdf — `@react-pdf/renderer` in particular mishandles Thai tone-mark shaping and is explicitly banned in this codebase. Everything routes through `PdfGenerationService` → Gotenberg. `docs/pdf-generation.md` has the full contract.

## Next step

Continue with [Configure the AI layer](./configure-ai.md).
