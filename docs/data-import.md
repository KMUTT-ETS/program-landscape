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
| **Student Cohorts** | How many of each entry cohort are still enrolled | — |
| **Alumni Cohorts** | What became of each entry cohort | — |
| **Admission Campaigns** | The recruitment funnel, per campaign | — |
| **Staff** | Your teaching-staff roster | Publications, Programme Teaching Staff |
| **Compensation** | Aggregate salary by faculty, department and rank | — |
| **Budgets** | Budget by division and fund category | — |
| **Publications** | Research outputs, one row per paper per author | — |
| **Class Offerings** | Every class section taught in one term | — |
| **Programme Teaching Staff** | Which staff teach which programmes | — |

Load them top to bottom. The first three are the backbone everything else
refers to by code; **Staff** must come before both **Publications** and
**Programme Teaching Staff**, which name people by their employee code.
Everything else can be uploaded in any order once the backbone exists.

**Do not skip Programme Teaching Staff.** It is a link table rather than a
set of figures, which makes it easy to leave for later, and three things you
have already uploaded stay silent until it exists. A publication attaches to
a *person*; a person reaches a *programme* only through this sheet. So
without it the programme pages show no teaching team, the staffing and
seniority figures are blank, your uploaded research record contributes
nothing to any programme, and the Capability part of each programme's health
score cannot be computed at all.

Two things are deliberately absent. **Cost figures** are not uploadable: a
programme's cost is an allocation your institution has to be able to defend, so
it is produced by the cost-allocation methodology from staff and budget data,
and an upload never touches it. **Student demographics** are not uploadable
either — nothing in the application reads them today, so a template for them
would ask you for work no screen would show.

A few more are deliberately out of scope and documented as such in the design
note under `docs/superpowers/specs/` — employer feedback, teaching evaluations
and per-section instructor rosters, the last of these because it keys on
personal email addresses. Note that per-section instructors are a different
thing from **Programme Teaching Staff** above: one says who stood in front of
a particular class, the other says who the programme's teaching team is, and
only the second is importable.

## Class Offerings replaces a term; everything else merges

This is the one dataset that behaves differently, and it is worth
understanding before the first upload.

Every other sheet **merges**: it updates the rows it mentions, adds the new
ones, and leaves everything else alone. Class Offerings **replaces the term
the file covers**. Upload the 2024 semester 1 file and every 2024 semester 1
section already stored is removed first, then the file's rows are inserted.

That is deliberate, because a timetable export states what exists rather than
what changed. A section cancelled since your last upload is simply absent from
the new file, and a merge would leave it in the system for ever.

Three things follow:

- **One file per term**, and every row in it from the same term. A file mixing
  two terms is refused, naming the rows that disagree.
- **The file must be complete for its term.** Uploading a partial export
  deletes the sections it leaves out.
- **Other terms are untouched.** Loading 2024 semester 2 does nothing to
  semester 1.

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

Salaries are **monthly**, in baht, on the Graduate Outcomes sheet and
**annual** on the Compensation sheet — each says which in its guide column.
Commas are fine.

Two year columns are stored converted to the Buddhist era, because that is
how the registrar data they sit beside is recorded: **Student Cohorts**,
**Alumni Cohorts**, **Admission Campaigns** and **Class Offerings**. You
always write the Common Era year; the admin data view shows it plus 543.

## Personal data

Only one sheet is about people: **Staff**. It asks for names, your own
employee code, and a rank.

It deliberately does **not** ask for a date of birth. The succession-risk
view reads the retirement date, which answers the same question and reveals
far less, so that is the column offered instead. There is no national-ID
column on any sheet, in any form — if your systems match people by one, keep
using it on your side and give us your employee code, which is not sensitive
on its own.

**Compensation refuses a row covering fewer than five people.** At that size
an average is close enough to an individual salary to identify someone. The
message names the row and never repeats the figures.

If any cell on any sheet looks like a national ID number, the file is refused
and the message says which row and column — without reproducing the value.

## Before you start: the first administrator

Everything on this page is behind `/admin`, and a newly installed system has
no administrator at all. Seeding is a Khon Kaen University convenience that
adopters do not run, and single sign-on hands every account the lowest role
there is, so neither produces one.

Open the system in a browser instead. A fresh installation sends you to
**`/setup`**, which asks for a name, an email address and a password, and
creates the first administrator from them. That account can then create
every other account, and this page's work can begin.

Two things to know about it:

- **The page is open to anyone who can reach the address, and the first
  person to use it becomes the administrator.** Nobody needs a password —
  they need to be first. Claim the installation as soon as it is running
  rather than leaving it up over a weekend while other paperwork is sorted.
- **It closes permanently the moment it is used**, and stays closed even if
  that administrator is later deleted. After that `/setup` just sends you to
  the sign-in page.

Sign in with that email and password. The password form is hidden once
single sign-on is configured; if you still need it after that, go to
`/signin?password=1`. Promote one single-sign-on account to administrator
before you rely on that, so the installation is not resting on a single
password.

## Where to go

`/admin/data-setup` lists every dataset under **Institution data**, grouped in
the order to load them, with how many rows each holds and when it was last
uploaded. Open one and you get a page with the
import panel at the top and, below it, whatever is currently stored.

You need an administrator account. Clearing a dataset needs the
`imports:destroy` permission, which administrators have by default.

## How it works

1. **Download the template.** It is generated for your installation, so its
   columns always match what the system will accept. The enrolment, finance
   and graduate-outcome templates arrive **empty** (headers only): add one row
   for each programme and year you hold figures for, and leave out the ones you
   don't. An enrolment row needs at least one figure; a row with only a
   programme code and a year is refused, because storing it would record
   zeros nobody counted.

   The student-cohort and alumni-cohort templates arrive **pre-filled** with a
   row per active programme per year, values blank, so you fill in figures
   rather than re-typing programme codes. Upload the file as it came: **a
   pre-filled row you leave blank is skipped**, so there is no need to delete
   the rest. A file in which every row is blank is refused rather than
   reported as a successful upload of nothing.
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
- **Commas group thousands, they are not decimal points.** `1,250,000` is
  fine. `1234,56` is refused rather than read as 123456 — if your locale uses
  a decimal comma, write `1234.56`.
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
- **A row a connector created survives**, even if one of your uploads
  corrected it. It still belongs to the connector.
- **A row with no recorded origin is adopted by the upload that corrects it**,
  and start over removes it. This is the only way such a row becomes visible
  at all — the application hides data whose origin it cannot verify — so an
  upload that touches one takes ownership of it. If you are correcting figures
  that were loaded before this system recorded where data came from, start
  over will remove the whole row, not just your correction.

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
