# Session 3: university data connection

> **ภาษาไทย:** มีฉบับภาษาไทยของหน้านี้ที่ [ฉบับภาษาไทย](../th/workshop/03-university-data.md)

**Time.** One afternoon, about 3 hours.

**Outcome.** You load your own university into the app, from real exports, a mix
of real and generated files, or a mock set generated for it, run the pipeline
on one programme with your own AI key, and see its Deep-Dive filled with
content.

The steps are those of [Get Program Deep-Dive working](../tutorials/program-deep-dive.md).
This page tells you which files to use, and in what order, so the slow steps
run while you do something else.

## Start the long steps first

The pipeline takes about 20 to 25 minutes for one programme and costs about
USD 0.40 to 0.80 of AI credit for a curriculum of about 126 courses (more for a longer one). The UN population download is about 68 MB. Do
the short steps first, start both long ones, and work through the Setup
checklist while they run:

1. Organisation profile (5 minutes).
2. Upload your files (about 20 minutes).
3. Attach the curriculum PDF, then **start the pipeline**.
4. **Start the `un-wpp` connector.**
5. While both run: read the Setup checklist and the mock API section below.

## Get your files

Your data path from the [early notice](./early-notice.md#pick-your-data-path)
decides which files you upload:

- **A. Real.** The templates you filled from your own exports before the day.
  The columns of each are in [Importing from spreadsheets](../data-import.md).
- **B. Mixed.** Generate a mock set as below, then use your own file in place
  of the generated one for each dataset you have. Your files must use the same
  faculty, department, programme and staff codes as the files they sit next to.
- **C. Mock.** Generate a mock set as below and upload all of it.

Remove personal data before the files reach your laptop: no national ID
numbers, no birth dates, no addresses or phone numbers.

### No exports? Generate a mock set for your university

If you have no exports to hand, a generator can write upload-ready mock
spreadsheets for a small, varied slice of your own university. Faculty and
programme names and round-3 admission figures come from the public TCAS files
(downloaded from mytcas.com on first run and cached). Staff are numbered
tokens such as "Lecturer 001". Every other figure is invented and labelled
mock. The programmes you brought curriculum PDFs for are always included, and
their course codes are read from the PDF. List at least one programme with a
curriculum PDF: without one, the Program Deep-Dive cannot run in full. It is for practice only: never show
these figures as real results. There is nothing to install beyond Node and
pnpm.

**Before the day.** Write an input file, for example `my-university.json`:

```json
{
  "university": "มหาวิทยาลัยเทคโนโลยีพระจอมเกล้าธนบุรี",
  "region": "Central",
  "programmes": [
    {
      "name": "วิศวกรรมเครื่องกล",
      "pdf": "pdfs/mechanical-engineering.pdf",
      "level": "BACHELOR",
      "faculty": "คณะวิศวกรรมศาสตร์"
    },
    {
      "name": "วิศวกรรมเครื่องกล",
      "pdf": "pdfs/mechanical-engineering-master.pdf",
      "level": "MASTER",
      "faculty": "คณะวิศวกรรมศาสตร์",
      "name_en": "Master of Engineering Programme in Mechanical Engineering",
      "courses": "courses/mechanical-master.csv"
    }
  ]
}
```

| Key | Meaning |
|---|---|
| `university` | Your university's Thai name, exactly as the TCAS tables spell it. |
| `region` | One of `Northeast`, `Central`, `North` or `South`, the regions the organisation profile offers. Central covers Bangkok, the East and the West too. Any other value stops the run. |
| `programmes[].name` | The programme name as written in the PDF. A small spelling difference is fine. |
| `programmes[].pdf` | Path to the curriculum PDF. Relative paths resolve against the JSON file's folder. At least one programme needs a PDF, or the Program Deep-Dive cannot run in full; for the others it is optional. If given, the file must exist, or the run stops. |
| `programmes[].level` | `BACHELOR` (default), `MASTER`, `DOCTORAL` or `HIGHER_GRAD_DIPLOMA`. |
| `programmes[].faculty` | Required for every programme. The faculty's Thai name, spelled as the TCAS tables spell it (spaces are ignored). For a bachelor programme a faculty TCAS does not list, such as an English name, stops the run and lists the faculties it knows. It also settles a name that exists in two faculties: in the example, KMUTT teaches วิศวกรรมเครื่องกล in both the Faculty of Engineering and the Faculty of Industrial Education and Technology. A postgraduate programme in a faculty with no TCAS rows, such as a graduate school, keeps the name as typed. |
| `programmes[].tcas_code` | Optional, bachelor programmes only (postgraduate programmes have no TCAS rows). A TCAS course code. Use it when the name cannot be matched automatically. It always wins. |
| `programmes[].courses` | Optional. A CSV file (not a spreadsheet) to use instead of the PDF's courses. Its header row is `code,name_th,name_en,credits,category`. `category` is one of General education, Core, Major required, Major elective, Free elective, Thesis / project; leave it blank for unknown. |
| `programmes[].name_en` | Optional. The English name used as-is in the mock files. |

Run the generator once with internet access so the TCAS files are cached.

**Generate.**

```bash
pnpm workshop:mock my-university.json
```

Options: `--size small|medium` (default `small`), `--seed N` (same input and
seed give identical files), `--out DIR` (default `./workshop-mock-out`) and
`--offline` (use the cached TCAS files only), `--cache DIR` (where TCAS files are cached) and `--tcas-file PATH:YEAR:ROUND` (use a TCAS file you already have; it is copied into the cache, and a later `--offline` run reads exactly the files that run used).
TCAS files are cached in `<out>/.cache`. With no internet on the day, run once beforehand, then use `--offline`.

You should see `TCAS matches:` followed by one line per programme you listed, for
example `วิศวกรรมคอมพิวเตอร์ -> programme MOCK-P004: TCAS course code
10140107300507A, faculty '...', programme '...'`, then `note:` lines. Check that
each match is the programme you meant. If a match is wrong, or the script stops
and lists candidates, check that programme's `faculty` or set its `tcas_code`,
and run again.

Exit code 0 means the files were written. Exit code 2 means nothing was written:
read the message above it. Thai course names read from a PDF may lose the spaces
between Thai words, or be left blank when the PDF text is damaged; a `note:` line
counts the blanks.

**Check.**

```bash
pnpm workshop:check-mock workshop-mock-out my-university.json
```

You should see every bachelor programme matched and no errors. This proves the
files pass the app's importer and that the `tcas` connector will match the
programmes. Exit code 0 means every check passed, 1 means a check failed (the
lines above name it), 2 means a problem with the arguments or an unreadable file.

## Load your university

### Organisation profile

Open `/admin/organization` and fill in the "Identity" tab as
[Step 1](../tutorials/program-deep-dive.md#step-1-set-the-organisation-profile)
describes, with your university's names. The Thai name must match the TCAS
tables character for character, or the `tcas` connector matches nothing. With a
mock set, type the Thai name and pick the Region exactly as `README.txt` in the
output folder gives them. Leave the OpenAlex institution ID blank unless you
know your university's.

Click "Create organisation". You should see the names in the header.

### Upload the files

Upload one file per dataset, in the order of the dataset tiles on
`/admin/data-setup` from top to bottom. A mock set's files are numbered in that
order. Upload each on its dataset's page with the "Upload filled template"
control described in
[Step 2](../tutorials/program-deep-dive.md#step-2-upload-the-organisation-and-the-programmes).

Then upload **University Rankings** as it comes: open its page, download the
pre-filled template, and upload it unchanged.

You should see each upload in its "Uploads" history with its row count. When a
file is refused, the message names the rows and columns. The rules are in
[Importing from spreadsheets](../data-import.md).

An upload counts as real data, the same as a connector run. The Setup
checklist's rule "sample rows never turn an item green" is about the built-in
mock connectors, not about uploaded files, generated or not.

### Public connectors

When all uploads are done, open `/admin/data-sources` and run:

- `un-wpp`. It needs no key. It loads the UN population projections behind
  the Demographic outlook section.
- `tcas`. It matches your programmes by the university's Thai name.
- `openalex-works`, with a free key, on path A or B. It does not match mock
  staff, who are tokens, not real people.
- `kmitl-skill-mapping`, only if the facilitator gives you KMITL credentials.
  It takes about an hour, so start it before the pipeline, then run the
  command in
  [Labour-market skills](../tutorials/program-deep-dive.md#labour-market-skills).

If you uploaded a Career Skill Demand file (a mock set has one), link its skill
names to the skill taxonomy from the repository root. It takes about 13 seconds
for a mock set's names:

```bash
pnpm skills:normalise --source=linkedin --auto-promote
```

Without it, the Setup checklist items "Labour market alignment" and "Demand
match filled" stay missing and pipeline phase 3 skips the demand match.

### Curriculum PDF and pipeline

1. Check the PDF first:

```bash
pnpm curriculum:check "<file.pdf>"
```

2. Open `/admin/programs` and click your programme.
3. On its "Files" tab (shown as "Files (0)" until a file is attached), choose
   the role `CURRENT_CURRICULUM` and upload the PDF.
4. On its "Pipeline history" tab, click "Run full pipeline". Or, from a
   terminal, with the programme's code:

```bash
pnpm programs:pipeline <programme-code>
```

You should see the phases finish one by one. If you uploaded a course list for
the programme (a mock set has one), the course-list phase reports that the
list comes from the upload: that is expected, the uploaded list always wins
over the PDF. The rest of the pipeline reads the PDF for the programme
description, learning outcomes and course descriptions.

The pipeline cost grows with the number of courses in the curriculum: USD 1.30
was measured on a 166-course curriculum, against USD 0.40 to 0.80 on a 126-course one.

### Setup checklist

Open the programme's "Setup checklist" tab, as in
[Step 6](../tutorials/program-deep-dive.md#step-6-get-the-setup-checklist-green).
Each red item names what is missing.

Some items stay red or "not applicable", and that is correct:

- **JobThai** shows "not applicable": it is a commercial feed.
- **Labour-market** items (demand match, labour-market alignment), unless you
  uploaded a Career Skill Demand file and ran the skills command, or ran
  `kmitl-skill-mapping` and its command.
- **Research by OpenAlex** on a mock set: the publications come from the
  upload instead.

Everything else should be green once the pipeline has finished. Any other red
item names a file or a connector run that is still missing.

### Start over

To remove what you loaded, use "Start over" on each dataset's page, in the
reverse of the upload order. Delete a mock set's output folder too.

## The mock API server

Tomorrow, session 4 connects the app to a mock API server that plays the part
of one of your university's systems, and you will write the code that reads it
with an AI assistant. You can start the server now to see what it serves:

```bash
pnpm workshop:mock-api <mock output folder> [--port 4010] [--token <t>]
```

Use the folder `pnpm workshop:mock` wrote. The server prints its base URL
(`http://127.0.0.1:4010/api/v1`) and a bearer token (random unless you pass
`--token`), listens on 127.0.0.1 only and needs no database. Every request needs
`Authorization: Bearer <token>`.

It serves the terms, the class sections of a term, one enrolment record per
student per section, and per-programme intake. Years are Buddhist Era (2568).
Student references are synthetic. A plain `pnpm workshop:mock` folder has no
class offerings workbook, so the server invents one section per course per
semester from the programme course list: those seat counts are made up, and a
few sections have fewer than 5 enrolled. Class Offerings accepts those; they are there to make you think about small groups, not to trigger a refusal. The routes are listed in
`apps/ingestion/src/scripts/workshop-mock-api/README.md`.

## You are done when

- Each of your files shows in its dataset's "Uploads" history.
- The pipeline for your programme has finished.
- The Setup checklist is green except for the items listed above.
- `/programs/<id>` for your programme shows content in its Executive snapshot,
  Admissions, Students, Outcomes, Curriculum & Faculty and Financials
  sections.

## Next step

Sessions 4 and 5 are in preparation. Continue with [Session 6: testing and security](./06-testing-and-security.md).
