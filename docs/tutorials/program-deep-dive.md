# Tutorial: get Program Deep-Dive working

> **ภาษาไทย:** มีฉบับภาษาไทยของหน้านี้ที่ [ฉบับภาษาไทย](../th/tutorials/program-deep-dive.md)

**Outcome.** `/programs/<id>` shows real content, not empty states, for a
programme of your university. The "Setup checklist" tab for that programme is
green.

**Starting point.** A running app with the first administrator signed in. If you
do not have one, do [Getting started](./getting-started.md) first. Every command
below runs from the repository root.

**Time and cost.** About half a day with your files ready. AI spend is about USD 0.80 per programme, so run one programme first and the rest later.

## The order of work

Follow the steps in this order. A later step names codes from an earlier one, and
an upload that names a code the system does not know yet is refused.

## Step 1: Set the organisation profile

1. Open `/admin/organization`. The "Identity" tab is open.
2. Fill in the fields.
   - "Thai name": it must match the institution column of the TCAS sheets
     character for character. The TCAS connector finds your programmes by this name.
   - "English name", "Thai short name", "English short name".
   - "Region (Thai)" and "Region (English)": use one of Northeast, Central,
     North or South in English. This gives you the regional population
     comparison. A university in Bangkok uses Central.
   - "OpenAlex institution ID": the id of your university on openalex.org,
     for example a value that starts with `I`.
   - "Contact email" is optional. Set "Public app URL", "Minimum bachelor intake"
     and "Minimum postgraduate intake" if you know them.
3. Click "Create organisation". The next time you come back the button reads
   "Save changes".

You should see the page reload with your names in the header.

## Step 2: Upload the organisation and the programmes

Every dataset has its own page under `/admin/data-setup`. Open
`/admin/data-setup`, click a dataset, and on its page `/admin/data-setup/raw/<slug>`
use the same three controls each time.

1. Click "Download template". Open it in a spreadsheet program and fill it in.
2. Click "Upload filled template" and choose your file.
3. Look at the "Uploads" history. Your file is listed there.

If a file is refused, nothing is stored. The message names the rows and columns.
Fix the file and upload it again. "Start over" on the same page clears a dataset.

Upload in this order.

1. **Faculties.** Fill in "Teaching Mode" for each faculty.
2. **Departments.**
3. **Programmes.**
4. **Staff** (slug `faculty-members`).
5. **Programme Teaching Staff** (slug `program-faculty`).
6. **Enrolment** (`enrollment-metrics`), **Finance** (`financial-metrics`) and
   **Graduate Outcomes** (`graduate-outcomes`).
7. **Student Cohorts** (`student-cohorts`), **Alumni Cohorts**
   (`alumni-cohorts`) and **Admission Campaigns** (`admission-campaigns`).
8. **Publications** (`research-outputs`).
9. **Programme course lists** (`programme-courses`). Fill the **Category** column
   with one of the template's values (General education, Core, Major required,
   Major elective, Free elective, Thesis / project). A blank reads as Unknown: the
   overlap check counts it as a major course, and curriculum revision gives no
   promotion advice for it.
10. **University Rankings** (`ranked-universities`). The template already holds a
    starter list. Upload it as it is, or edit it first.

You should see each upload appear in its "Uploads" history with the number of
rows stored.

When you have these files, upload them as well:

- **Course Evaluations**, **Digital Competency** (cohorts and modules),
  **External Grants** and **External Grant Team**, **Employer Feedback** and
  **Staff Salary by Funding**.
- **Population Projections**.
- **Career Skill Demand**, but only after Step 5 has built the skills, and only
  if you have no KMITL key (see [Labour-market skills](#labour-market-skills)).

Rules that decide whether a file is accepted are in
[Importing from spreadsheets](../data-import.md). The three you will meet are:

- Optional columns may be left out of a sheet. Required columns may not, and a
  column the dataset does not know is refused.
- A row that names a programme, faculty, department or employee code that is not
  in an earlier upload refuses the whole file and lists each row. Add the
  missing rows to the earlier sheet, or delete those rows.
- One upload holds at most 5000 rows. Split a bigger file into parts.

## Step 3: Run the public connectors

Connectors are switched off on a fresh install. Run each one once by hand.

1. Open `/admin/data-sources` and click the source.
2. On `/admin/data-sources/<slug>`, click "Run now".
3. Wait for the run to show as succeeded in its history.

Run these.

| Source (slug) | What it needs | What you should see |
|---|---|---|
| `tcas` | Nothing. It reads the public TCAS files. Run it after Step 2, because it matches programmes by Thai faculty and programme name. | A count of matched programmes. |
| `un-wpp` | Nothing. It downloads about 68 MB of UN population figures. | A succeeded run with rows loaded. |
| `kmitl-skill-mapping` | `KMITL_SKILL_MAPPING_CLIENT_ID` and `KMITL_SKILL_MAPPING_SECRET_KEY` in `.env`. | Skill demand loaded. Skip it if you have no key. |
| `openalex-works` | `OPENALEX_API_KEY` in `.env` (a free key) and the OpenAlex institution ID from Step 1. | Research outputs loaded. |
| `job-108` | Nothing. Switch it on if you want government job announcements in the demand map. | Job announcements loaded. |

Without the OpenAlex key the run is recorded as skipped with the message
"OPENALEX_API_KEY is not set. Create a free key at
https://openalex.org/settings/api and add it to the environment." Add the key to
`.env`, restart `pnpm dev`, and run it again.

### Labour-market skills

Programmes are compared with the skills employers ask for. There are two ways
to load them.

1. Run `kmitl-skill-mapping` as above, if you have a key. Then run this once,
   before the pipeline.

```bash
pnpm skills:normalise --source=linkedin --auto-promote
```

   It adds the market's skill names to your taxonomy, so a programme's skills
   can match them. It handles the names in batches of 25. On one installation it
   processed about 5,850 names, which took about an hour and cost roughly
   USD 1.50. A few names may fail (a brief database or model error); run the
   same command again and it picks up only those. Without it the demand match is skipped, and the labour-market
   alignment and demand-match drivers stay empty. The setup checklist says so.
2. Or upload **Career Skill Demand** at `/admin/data-setup/raw/career-skill-demand`
   after Step 5 has built the skills.

## Step 4: Attach the curriculum PDF

1. Check the file first. The command prints counts only.

```bash
pnpm curriculum:check "<file.pdf>"
```

You should see how many courses and sections it found.

2. Open `/admin/programs/<id>?tab=files`.
3. Choose the role `CURRENT_CURRICULUM` and click "Choose PDF".

You should see the file listed with its role.

If the pipeline cannot read the course list from your PDF, upload the list
instead with **Programme course lists** (Step 2). An uploaded list is never
overwritten by the pipeline.

## Step 5: Run the pipeline

1. Open `/admin/programs/<id>?tab=pipeline`.
2. Click "Run full pipeline".
3. Wait. The phases show their status as they finish.

The pipeline uses the AI provider you set in `.env` (`AI_PROVIDER` is google,
anthropic or openrouter). It costs about USD 0.80 per programme.

You can also run it from the terminal.

```bash
pnpm programs:pipeline <code>
```

The command line is the safest way. If the worker restarts while a pipeline
runs (for example after a code change in watch mode), the run is cut off. Run it
again. Finished phases are cheap to repeat.

The pipeline approves the curriculum digests as the first administrator, so no
extra setup is needed. The USD 0.80 was measured on one bachelor programme with
a 126-course curriculum, with `AI_PROVIDER=openrouter` and without embeddings.
Longer curricula cost more. Check `/admin/ai-cost` after the first programme.

**Embeddings for the overlap section.** The overlap step always uses Google
(`AI_GOOGLE_EMBEDDING_MODEL`), so a Google key is needed even when `AI_PROVIDER`
is anthropic or openrouter. A free-tier key embedded about 1,000 course texts and
then reached its daily limit. The step waits, retries, gives up, and picks up
where it stopped on the next run. When it gives up, the overlap phase does not
fail. It still scores overlap on shared course codes, so the Deep-Dive overlap
section fills, and the phase is reported as DEGRADED with the note "embeddings
incomplete (provider quota)". A university with about 5,000 courses needs a
paid key, or must run the pipeline again on later days to add the content layer
(`pnpm programs:overlap-prep --apply` and `pnpm programs:overlap --apply` do the
same by hand). Until every course is embedded, the overlap index uses shared
course codes only.

On a fresh installation the pipeline also builds your skill taxonomy by itself.
After it reads the curriculum, phase 2 sees that the programme's skills match
nothing yet. It creates the skills from the names in that curriculum, then
applies the same stored result to the programme, with no new AI reading of the
PDF. The later phases in the same run then see the skills. A programme that
already has skills is left alone. This is on by default; set
`PIPELINE_BUILD_SKILL_TAXONOMY=0` to turn it off.

## Step 6: Get the Setup checklist green

1. On the same programme page, open the "Setup checklist" tab.
2. Read each item. A red item names the dataset or step that is missing.
3. Fix it, then reload the tab.

To see which data feeds which score before you start, use the
[Deep-Dive data map](../adopters/deep-dive-data-map.md).

Some items do not apply to a programme. Postgraduate programmes have no TCAS or
digital competency items. A programme with no same-level sibling that has a
course list has no overlap item. These are not red. An item filled by AI that
ran in a degraded mode counts as green and shows a "degraded" note with the
reason.

Admission funnel items: if the admission-campaigns sheet has no Planned Seats (or
the programme has no campaign rows at all), the competition ratio and fill rate are computed from the public TCAS round-3
figures, and the checklist says "Computed from public TCAS round-3 figures".
Registration yield needs the Confirmed and Reported columns of that sheet (it
stays empty, not 0, if Reported is blank), and
there is no public substitute. Fill Planned Seats, Confirmed and Reported if you
have them. Planned Seats is the seats of that one round or campaign row: do not
repeat the annual plan on every round row, because the rows are added together.

The JobThai driver shows "not applicable" on an installation without JobThai.
JobThai is a commercial feed, so this is not a failure.

Only real data turns an item green. Sample rows never do.

You should see every item green or not applicable.

## Step 7: Open the Deep-Dive

1. Open `/programs/<id>`. If you are an administrator, the header has a
   "Setup checklist" link back to the tab.
2. Scroll through the sections.

You should see real content in each section that has its data. A section that is
still empty says what it needs.

## Step 8: Scale to the whole portfolio

1. Check the one programme you finished against its source documents.
2. Run the pipeline for the rest from `/admin/programs`: tick the programmes and
   choose **Run pipeline · N program(s)**. Or run one programme at a time from its
   pipeline tab. Plan for about USD 0.80 for each programme.

## After uploading programmes, enrolment, finance or outcomes

The roll-up views refresh by themselves. No command is needed. On an
installation upgraded from before this change, run this once.

```bash
pnpm outcomes:refresh-derived
```

## If the skills do not appear

Check the programme's phase 2 line on the pipeline tab. If it says the names are
still unmatched, or the AI provider was not reachable, run the steps by hand.

```bash
pnpm skills:normalise --source=program_digest --auto-promote
pnpm programs:approve-pending --rematerialise --program-id=<id>
```

The first command builds the taxonomy from the curriculum's skill names. The
second applies the stored curriculum result again. It makes no AI call. Then run
the pipeline for the programme once more. The full description is in
[Building your skill taxonomy](../guides/curriculum-pdfs-and-ai-digest.md#building-your-skill-taxonomy).

## When a section is empty but the rows exist

Rows that came from an upload carry the upload that made them. The app hides
rows it cannot trace. If an upload succeeded and nothing shows, run
`pnpm data-sources:sync --apply` and upload again. See
[If an upload does not appear](../data-import.md#if-an-upload-does-not-appear).

## Where to go next

- [Importing from spreadsheets](../data-import.md) for every dataset and rule.
- [Workshop](../workshop/README.md) if you are running this for a group.
- [Adapt the registrar connector](./adapt-the-registrar-connector.md), advanced
  and optional, a KKU example of reading a student-records system directly.
- [Evaluation pipeline](../evaluation-pipeline.md) for how the scores are built.
