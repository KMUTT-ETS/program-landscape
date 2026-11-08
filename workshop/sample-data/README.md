# Workshop sample data

The files of **Workshop Demo University** (มหาวิทยาลัยสาธิตเวิร์กช็อป), an
invented university used by the workshop's sample track
(`docs/workshop/03-university-data.md`).

**Every person and every number here is made up.** Staff are tokens such as
`Lecturer 001`; no file holds a name, an ID number or a birth date of a real
person. There is no AI output and no public-connector data: you compute those
yourself with the real pipeline and your own AI key.

## What is in it

- Two faculties, three departments and three bachelor programmes.
- `WDU-CPE-BE`, Bachelor of Engineering in Computer Engineering, is the
  workshop programme: it has a course list and the curriculum PDF under
  `curriculum/`.
- Academic years 2021 to 2025, written in the Common Era.

## Upload order

Upload the files in the order of their numbers, each on its dataset page under
`/admin/data-setup`. The numbers follow the order of the dataset tiles on that
page, top to bottom. A file that names a code from a later file is refused.

| File | Dataset |
|---|---|
| `01-faculties.xlsx` | Faculties |
| `02-departments.xlsx` | Departments |
| `03-programmes.xlsx` | Programmes |
| `04-enrollment-metrics.xlsx` | Enrolment |
| `05-financial-metrics.xlsx` | Finance |
| `06-graduate-outcomes.xlsx` | Graduate Outcomes |
| `07-faculty-members.xlsx` | Staff |
| `08-program-faculty.xlsx` | Programme Teaching Staff |
| `09-student-cohorts.xlsx` | Student Cohorts |
| `10-alumni-cohorts.xlsx` | Alumni Cohorts |
| `11-admission-campaigns.xlsx` | Admission Campaigns |
| `12-research-outputs.xlsx` | Publications |
| `13-programme-courses.xlsx` | Programme course lists |

## The curriculum PDF

`curriculum/workshop-demo-curriculum.pdf` is an invented curriculum document
for `WDU-CPE-BE`. Its course list is the same as `13-programme-courses.xlsx`.
The pipeline reads the PDF for the programme's description, learning outcomes
and course descriptions. It takes the course list from the uploaded file,
which always wins over the PDF.

## Regenerating

The files are generated from the import declarations, so they always carry
the columns the importer expects:

```bash
pnpm workshop:sample-data
pnpm workshop:sample-pdf
```

The second command needs Gotenberg running (`pnpm db:up`).

`apps/api/test/workshop-sample-data.test.ts` fails if a committed file no
longer matches the generator, or if the importer would refuse any file.
