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

More datasets — enrolment, finance, graduate outcomes, staff — follow in later
releases. See the design document under `docs/superpowers/specs/` for the full
inventory.

## Where to go

`/admin/data-setup` lists every dataset. Open one and you get a page with the
import panel at the top and, below it, whatever is currently stored.

You need an administrator account. Clearing a dataset needs the
`imports:destroy` permission, which administrators have by default.

## How it works

1. **Download the template.** It is generated for your installation, so its
   columns always match what the system will accept.
2. **Fill in the data sheet.** Every workbook has two sheets: the data, and a
   **Guide** that explains each column, with an example and the allowed values.
   The Guide sheet is ignored on upload — you can write in it freely.
3. **Upload it.** The file is checked while you wait. If anything is wrong you
   get a list of rows and columns to fix, and **nothing is stored**.

Load them in order: Faculties, then Departments, then Programmes. Each refers to
the one before it by code.

## Uploading again later

Upload the same dataset as often as you like. Rows are matched on their code:

- A code already in the system is **updated**.
- A code that is new is **added**.
- Anything not mentioned in your file is **left alone**.

So a file covering only the three programmes that changed this term does exactly
that, and touches nothing else.

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
  while Departments or Programmes exist — clearing them would take everything
  hanging off them with it. Clear from the bottom up.

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
