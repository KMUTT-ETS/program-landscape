# Session 3: university data connection

> **ภาษาไทย:** มีฉบับภาษาไทยของหน้านี้ที่ [`03-university-data.th.md`](./03-university-data.th.md)

**Time.** One afternoon, about 3 hours.

## Goal

Load a university into the app, run the pipeline on one programme with your own
AI key, and see its Deep-Dive filled with content. Everyone does the sample
track. If you brought your own files, you then repeat it with them.

The steps are those of [Get Program Deep-Dive working](../tutorials/program-deep-dive.md).
This page tells you which values and files to use, and in what order, so the
slow steps run while you do something else.

## Start the long steps first

The pipeline takes about 20 to 25 minutes for one programme and costs about
USD 0.40 to 0.80 of AI credit. The UN population download is about 68 MB. Do
the short steps first, start both long ones, and work through the Setup
checklist while they run:

1. Organisation profile (5 minutes).
2. Upload the 13 sample files (about 20 minutes).
3. Attach the curriculum PDF, then **start the pipeline**.
4. **Start the `un-wpp` connector.**
5. While both run: read the Setup checklist and the mock API section below.

## Sample track

### Organisation profile

Open `/admin/organization` and fill in the "Identity" tab as
[Step 1](../tutorials/program-deep-dive.md#step-1-set-the-organisation-profile)
describes, with these values:

| Field | Value |
|---|---|
| Thai name | มหาวิทยาลัยสาธิตเวิร์กช็อป |
| English name | Workshop Demo University |
| Thai short name | มสว. |
| English short name | WDU |
| Region (Thai) | ภาคตะวันออกเฉียงเหนือ |
| Region (English) | Northeast |
| OpenAlex institution ID | Leave blank. The university is invented. |

Click "Create organisation". You should see the names in the header.

### Upload the sample files

The files are in `workshop/sample-data/` in the repository. Every person and
every number in them is invented. Upload them in the order of their numbers,
each on its dataset's page under `/admin/data-setup`, with the "Upload filled
template" control described in
[Step 2](../tutorials/program-deep-dive.md#step-2-upload-the-organisation-and-the-programmes).

| File | Dataset page |
|---|---|
| `01-faculties.xlsx` | Faculties |
| `02-departments.xlsx` | Departments |
| `03-programmes.xlsx` | Programmes |
| `04-faculty-members.xlsx` | Staff |
| `05-program-faculty.xlsx` | Programme Teaching Staff |
| `06-enrollment-metrics.xlsx` | Enrolment |
| `07-financial-metrics.xlsx` | Finance |
| `08-graduate-outcomes.xlsx` | Graduate Outcomes |
| `09-student-cohorts.xlsx` | Student Cohorts |
| `10-alumni-cohorts.xlsx` | Alumni Cohorts |
| `11-admission-campaigns.xlsx` | Admission Campaigns |
| `12-research-outputs.xlsx` | Publications |
| `13-programme-courses.xlsx` | Programme course lists |

Then upload **University Rankings** as it comes: open its page, download the
template, and upload it unchanged.

You should see each upload in its "Uploads" history with its row count. Open
one file in a spreadsheet program to see what a filled template looks like:
you will fill the same templates with your own data later.

An upload counts as real data, the same as a connector run. The Setup
checklist's rule "sample rows never turn an item green" is about the built-in
mock connectors, not about these files.

### Public connectors

Open `/admin/data-sources`, click `un-wpp`, and click "Run now". It needs no
key. It loads the UN population projections behind the Demographic outlook
section.

Skip the others on the sample track:

- `tcas` matches programmes by the university's Thai name, and an invented
  university is in no TCAS table.
- `openalex-works` needs a real OpenAlex institution ID.
- `kmitl-skill-mapping` needs KMITL credentials. If the facilitator gives you
  some, run it, then run the command in
  [Labour-market skills](../tutorials/program-deep-dive.md#labour-market-skills).
  It takes about an hour, so start it before the pipeline.

### Curriculum PDF and pipeline

1. Open `/admin/programs` and click the programme `WDU-CPE-BE`, Bachelor of
   Engineering in Computer Engineering.
2. On its "Files" tab (shown as "Files (0)" until a file is attached), choose the role `CURRENT_CURRICULUM` and upload
   `workshop/sample-data/curriculum/workshop-demo-curriculum.pdf`.
3. On its "Pipeline history" tab, click "Run full pipeline". Or, from a terminal:

```bash
pnpm programs:pipeline WDU-CPE-BE
```

You should see the phases finish one by one. The course-list phase reports
that the programme's course list comes from the upload: that is expected, the
uploaded list always wins over the PDF. The rest of the pipeline reads the PDF
for the programme description, learning outcomes and course descriptions.

### Setup checklist

Open the programme's "Setup checklist" tab, as in
[Step 6](../tutorials/program-deep-dive.md#step-6-get-the-setup-checklist-green).
Each red item names what is missing.

Some items stay red or "not applicable" on the sample track, and that is
correct:

- Items that need **TCAS** figures: the invented university has none.
- **Labour-market** items (demand match, labour-market alignment), unless you
  ran `kmitl-skill-mapping` and the skills command.
- **JobThai** shows "not applicable": it is a commercial feed.
- **Research by OpenAlex**: the publications come from the upload instead.

Everything else should be green once the pipeline has finished.

## Real-data track

If you brought your own files, do the same steps with them:

1. Correct the organisation profile with your university's names. The Thai
   name must match the TCAS tables character for character.
2. Upload your files in the same order. When a file is refused, the message
   names the rows and columns. The rules are in
   [Importing from spreadsheets](../data-import.md).
3. Run `tcas` and, with a free key, `openalex-works`.
4. Attach the curriculum PDF of your programme, check it first with
   `pnpm curriculum:check "<file.pdf>"`, and run the pipeline.

Your data and the sample university live side by side in the same database.
To remove the sample later, use "Start over" on each sample dataset's page,
in reverse order of upload.

### No exports? Generate a mock set for your university

If you have no exports to hand, a generator can write upload-ready mock
spreadsheets for a small, varied slice of your own university. Faculty and
programme names and round-3 admission figures come from the public TCAS files
(downloaded from mytcas.com on first run and cached). Staff are numbered
tokens such as "Lecturer 001". Every other figure is invented and labelled
mock. The programmes you brought curriculum PDFs for are always included, and
their course codes are read from the PDF. It is for practice only: never show
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
      "level": "BACHELOR"
    },
    {
      "name": "วิศวกรรมเครื่องกล",
      "pdf": "pdfs/mechanical-engineering-master.pdf",
      "level": "MASTER",
      "faculty": "คณะวิศวกรรมศาสตร์",
      "tcas_code": "10140107300507A",
      "name_en": "Master of Engineering Programme in Mechanical Engineering",
      "courses": "courses/mechanical-master.csv"
    }
  ]
}
```

| Key | Meaning |
|---|---|
| `university` | Your university's Thai name, exactly as the TCAS tables spell it. |
| `region` | The English region, exactly as you will type it on the organisation profile (for example `Central`, `Northeast`). |
| `programmes[].name` | The programme name as written in the PDF. A small spelling difference is fine. |
| `programmes[].pdf` | Path to the curriculum PDF. Relative paths resolve against the JSON file's folder. Optional. |
| `programmes[].level` | `BACHELOR` (default), `MASTER`, `DOCTORAL` or `HIGHER_GRAD_DIPLOMA`. |
| `programmes[].faculty` | The faculty's Thai name. Required unless the level is `BACHELOR`. |
| `programmes[].tcas_code` | Optional. A TCAS course code. Use it when the name cannot be matched automatically. It always wins. |
| `programmes[].courses` | Optional. A course-list spreadsheet or CSV to use instead of the PDF's courses. |
| `programmes[].name_en` | Optional. The English name used as-is in the mock files. |

Run the generator once with internet access so the TCAS files are cached.

**Generate.**

```bash
pnpm workshop:mock my-university.json
```

Options: `--size small|medium` (default `small`), `--seed N` (same input and
seed give identical files), `--out DIR` (default `./workshop-mock-out`) and
`--offline` (use the cached TCAS files only).

You should see lines saying which TCAS programme each of your programmes was
matched to. Check that each one is the programme you meant. If a match is
wrong, or the script stops and lists candidates, set `tcas_code` for that
programme and run again.

**Check.**

```bash
pnpm workshop:check-mock workshop-mock-out my-university.json
```

You should see every bachelor programme matched and no errors. This proves the
files pass the app's importer and that the `tcas` connector will match the
programmes.

**Load it.**

1. Open `/admin/organization`, "Identity" tab. Type the Thai name and the
   Region (English) exactly as `README.txt` in the output folder gives them.
2. Upload the numbered files in order at `/admin/data-setup`, each on its
   dataset's page with "Upload filled template".
3. Then upload **University Rankings**: download its pre-filled template and
   upload it unchanged.
4. When all uploads are done, open `/admin/data-sources` and run `tcas` and
   `un-wpp`. `openalex-works` will not match, because the mock staff are
   tokens, not real people. `kmitl-skill-mapping` is optional.
5. Attach each PDF on the programme's "Files" tab with the role
   `CURRENT_CURRICULUM` and run the pipeline.
6. Open the programme's "Setup checklist" tab. You should see green items
   except JobThai ("not applicable") and the labour-market items, unless you
   ran `kmitl-skill-mapping` and its skills command.

**Remove it.** Use "Start over" on each dataset page, in the reverse of the
upload order, then delete the output folder.

## The mock API server

Tomorrow, sessions 4 and 5 connect the app to a mock API server that plays
the part of one of your university's systems, and you will write the code that
reads it with an AI assistant. Its instructions arrive with those sessions.

## You are done when

- The 13 sample files show in their "Uploads" histories.
- The pipeline for `WDU-CPE-BE` has finished.
- The Setup checklist is green except for the items listed above.
- `/programs/<id>` for `WDU-CPE-BE` shows content in its Executive snapshot,
  Admissions, Students, Outcomes, Curriculum & Faculty and Financials
  sections.
