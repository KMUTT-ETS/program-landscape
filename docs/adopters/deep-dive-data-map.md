---
aside: false
---

# Deep-Dive data map

Which data a programme needs before its Deep-Dive page (`/programs/<id>`) fills in,
and which data drives each of the five health scores. Written for the people who
run the systems that hold this data, not for curriculum specialists.

Read it as an ETL pipeline. Each score is a set of small calculations, called
**drivers**, over tables you load. Nothing on the Deep-Dive page is typed in by
hand.

## Inputs and scores

The table counts how many drivers in each score read an input. The last column
counts Deep-Dive sections (charts and tables) that use the input but are not part
of a score. Select a row, or a chip in a card, to highlight every driver that
depends on that input: it answers "if this upload is missing, what goes blank?".

<DeepDiveDataMap />

The driver list and each driver's inputs are checked against the code
(`DIMENSION_DRIVERS` in `packages/db/src/health-score/drivers.ts` and `CHECKLIST_SOURCES`
in `packages/db/src/program-setup-checklist.ts`) by
`packages/db/test/deep-dive-data-map-doc.test.ts`. The plain-language text lives
in `apps/docs-site/.vitepress/theme/deep-dive-data-map/data.ts`. Formulas in full,
with their history, are in the [health score methodology](../methodologies/health-score.md).

## Rules when data is missing

- **Missing is null, never zero.** A driver with no data is left out of its
  score's average. "We do not know the employment rate" never becomes
  "employment rate 0".
- **Completeness is shown with every score.** It is the share of the score's
  drivers that had data. Under 50 % the score is greyed and flagged "low data". At
  0 % no score is shown.
- **Equal weights.** Drivers count equally inside a score, and the five scores
  count equally in the overall score. The one exception is the pair of
  job-market drivers in Relevance, which share their two slots 75:25 between Thai
  job ads (JobThai) and global data (LinkedIn via KMITL).
- **Only traceable rows count.** A row must come from a named upload or connector
  run. Sample or seed rows never fill a score.
- **Some drivers do not apply.** TCAS admission and digital competency drivers
  cover bachelor programmes only. JobThai is a commercial feed; without it that
  driver reads "not applicable", which is not a failure.
- **Check it per programme.** The Setup checklist at
  `/admin/programs/<id>?tab=checklist` shows every driver and section as green,
  empty or not applicable, and names the dataset or step to load when one is empty.
  [Get Program Deep-Dive working](../tutorials/program-deep-dive.md) gives the order
  of work, and [Importing from spreadsheets](../data-import.md) gives the rules each
  upload must pass.

## Education terms used here

| Term | Meaning |
|---|---|
| Programme (curriculum) | One degree a student enrols in, such as B.Eng. Mechanical Engineering. The Deep-Dive is one page per programme. |
| TCAS | Thailand's national university admission system. Its public files give applicants, seats and minimum scores for every programme in the country. |
| Admission campaign or round | One recruitment window. A programme can recruit in several rounds a year, and seats are added up across rows. |
| Cohort | All students who entered in the same year, followed until they graduate or leave. |
| Academic rank | Lecturer, Assistant Professor, Associate Professor, Professor. "Senior" means the last two. |
| Graduate outcomes survey | The yearly survey of new graduates: employed or not, job in field or not, salary, further study. |
| Digital competency (DQ) | A university-wide digital-skills test taken by bachelor students. |
| Teaching Mode | How a faculty teaches (clinical, lab-based, studio, professional, humanities). It sets what a normal student-to-staff ratio is. |
| National priority sectors | Thailand's target industries (bio-circular-green economy and the S-curve industries such as digital, medical and automotive). |
