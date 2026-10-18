# Importing your institution's data from spreadsheets

Program Landscape normally reads an institution's data through connectors —
code that talks directly to a registrar, HR or finance database. If you do not
have that access, or your data already lives in spreadsheets, you can upload it
instead. No code changes are needed.

This page is for the person doing the uploading.

## What you can import today

| Dataset | What it is | Needed before |
|---|---|---|
| **Faculties** | The faculties, colleges and institutes that own programmes | Everything |
| **Departments** | Departments within a faculty. Optional | Programmes |
| **Programmes** | The curricula you offer | Every metric |
| **Enrolment** | Applications through to graduation, per programme per year | — |
| **Finance** | Tuition and other revenue, per programme per year | — |
| **Graduate Outcomes** | Employment survey results per graduating cohort | — |

Load them top to bottom: the first three are the backbone every metric refers
to by code, and the last three can be uploaded in any order once those exist.

Two things are deliberately absent. **Cost figures** are not uploadable: a
programme's cost is an allocation your institution has to be able to defend, so
it is produced by the cost-allocation methodology from staff and budget data,
and an upload never touches it. **Student demographics** are not uploadable
either — nothing in the application reads them today, so a template for them
would ask you for work no screen would show.

Further datasets — staff, compensation, cohorts, class offerings — follow in
later releases. See the design document under `docs/superpowers/specs/` for the
full inventory.

## Years, money and rates

Three conventions, each of which has a wrong answer that looks right:

- **Every year is Common Era.** Write 2025, not 2568. A Buddhist-era year is
  543 years in the future, which passes any "is this a plausible number" test —
  so the file is refused outright rather than filed under a year nothing asks
  for.
- **The finance year is an academic year, not a budget year.** An academic year
  straddles two fiscal years, so a figure copied from a fiscal-year budget
  report describes a different period than the column asks for.
- **Rates are proportions between 0 and 1.** Write 87 % as `0.87`. A rate of
  `87` is refused; left unchecked it would render as 8700 % employment.

Salaries are **monthly**, in baht. Commas are fine.

## Where to go

`/admin/data-setup` lists every dataset. Open one and you get a page with the
import panel at the top and, below it, whatever is currently stored.

You need an administrator account. Clearing a dataset needs the
`imports:destroy` permission, which administrators have by default.

## How it works

1. **Download the template.** It is generated for your installation, so its
   columns always match what the system will accept. For the metric datasets it
   also arrives **pre-filled** with a row per active programme per year, values
   blank — so you fill in figures rather than re-typing programme codes.
2. **Fill in the data sheet.** Every workbook has two sheets: the data, and a
   **Guide** that explains each column, with an example and the allowed values.
   The Guide sheet is ignored on upload — you can write in it freely.
3. **Upload it.** The file is checked while you wait. If anything is wrong you
   get a list of rows and columns to fix, and **nothing is stored**.

Load them in order: Faculties, then Departments, then Programmes, then the
metrics. Each refers to the one before it by code.

## Uploading again later

Upload the same dataset as often as you like. Rows are matched on their code:

- A code already in the system is **updated**.
- A code that is new is **added**.
- Anything not mentioned in your file is **left alone**.

So a file covering only the three programmes that changed this term does exactly
that, and touches nothing else.

The same goes for **columns**, in the metric datasets: a blank cell leaves
whatever is stored alone rather than setting it to zero. If you have
application counts but not graduation counts, leave the graduation columns
empty and they keep whatever another source supplied.

Re-uploading a byte-for-byte identical file does nothing and says so.

## Rules the upload enforces

**The columns must match exactly.** Not just the ones the system needs — extra
columns are refused too. This is deliberate: a misspelled header would otherwise
be read as an empty column, and a stray column of personal data would be
accepted silently.

**No personal identifiers.** A cell containing a national ID number fails the
file. The message names the row and column, and never repeats the value.

**Small groups are refused** where a dataset carries headcounts, so no
individual's figures can be worked out from an average.

**A much smaller file is questioned.** If your upload has fewer than half the
rows currently stored, it is refused as a probable partial export — with a
button to upload it anyway if you know it is right.

## Things worth knowing about spreadsheets

- **Codes that start with a zero.** Format the cell as text first, or Excel
  turns `007` into `7` before the system ever sees it.
- **Blank rows are ignored**, so trailing empty rows are harmless.
- **Dates** should be written `YYYY-MM-DD`, or as real date cells.
- **Row numbers in error messages are the row numbers you see in Excel**, so
  you can go straight to the line.

## Starting over

Each dataset has a **Start over** control at the foot of its page. It deletes
the rows that were imported and leaves anything that came from a connector or
the original setup alone. You must type the dataset's name to confirm.

Two things to understand before using it:

- **Your uploaded files are kept.** Start over, then upload them again, and you
  are back where you were. This is the only way back, so do not delete the
  workbooks from your own machine either.
- **It refuses while other data depends on it.** You cannot clear Faculties
  while Departments or Programmes exist, nor Programmes while enrolment,
  finance or outcome figures exist — clearing them would take everything
  hanging off them with it, including rows a connector wrote and no upload ever
  touched. The message names what would be destroyed. Clear from the bottom up.
- **It only deletes what your uploads created.** A row that an upload merely
  corrected still belongs to whoever created it, and survives.

## If an upload does not appear

Imported rows carry a record of which upload created them, and the application
hides data whose origin it cannot verify. If an upload succeeds but nothing
shows, the usual cause is a missing data source row — run `pnpm db:seed`, which
creates one per dataset, and upload again.

## For developers

- Declarations: `packages/db/src/import/datasets/`. Adding a dataset is adding
  one declaration — template, validation, guide sheet and provenance all derive
  from it.
- Validation: `packages/db/src/import/validate.ts` (pure).
- Parser and template writer: `apps/api/src/import/`.
- Design: `docs/superpowers/specs/2026-10-17-institute-xlsx-import-design.md`.
