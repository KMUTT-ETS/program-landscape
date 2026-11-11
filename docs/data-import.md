# Importing your institution's data from spreadsheets

> **ภาษาไทย:** มีฉบับภาษาไทยของหน้านี้ที่ [ฉบับภาษาไทย](./th/data-import.md)

Program Landscape normally reads an institution's data through connectors —
code that talks directly to a registrar, HR or finance database. If you do not
have that access, or your data already lives in spreadsheets, you can upload it
instead. No code changes are needed.

This page is for the person doing the uploading.

If your system exposes an HTTP/JSON API, a connector can fill the same datasets instead of an upload. See [Load an import dataset from an HTTP API](./guides/write-a-connector.md#load-an-import-dataset-from-an-http-api).

## What you can import today

| Dataset | What it is | Needed before |
|---|---|---|
| **Faculties** | The faculties, colleges and institutes that own programmes | Everything |
| **Departments** | Departments within a faculty. Optional | Programmes |
| **Programmes** | The curricula you offer | Every metric |
| **Enrolment** | Applications through to graduation, per programme per year | Programmes |
| **Finance** | Tuition and other revenue, per programme per year | Programmes |
| **Graduate Outcomes** | Employment survey results per graduating cohort | Programmes |
| **Employer Feedback** | Employer satisfaction per programme and survey year; shown in the Deep-Dive's Outcomes section | Programmes |
| **Population Projections** | Projected population per region, year and age group; overrides the built-in UN series | — |
| **Career Skill Demand** | Share of postings naming each skill, per career; the fallback for the KMITL API | — (skills from the programme pipeline) |
| **University Rankings** | QS / THE ranks per university; the peer-selection universe (template pre-filled with a starter list) | — |
| **Student Cohorts** | How many of each entry cohort are still enrolled | Programmes |
| **Digital Competency — Cohorts** | Students tested, scored and passing, per programme and entry year | Programmes |
| **Digital Competency — Modules** | Mean score on each of the 13 modules, per programme and entry year | Programmes |
| **Alumni Cohorts** | What became of each entry cohort | Programmes |
| **Staff** | Your teaching-staff roster | Publications, Programme Teaching Staff, External Grant Team |
| **Compensation** | Aggregate salary by faculty, department and rank | Faculties |
| **Staff Salary by Funding** | Monthly salary by faculty, rank and funding source | Faculties, Staff, Programme Teaching Staff (for the Deep-Dive card) |
| **Budgets** | Budget by division and fund category | Faculties |
| **Publications** | Research outputs, one row per paper per author | Staff |
| **Admission Campaigns** | The recruitment funnel, per campaign | Programmes |
| **Class Offerings** | Every class section taught in one term | Faculties |
| **Programme Teaching Staff** | Which staff teach which programmes | Programmes, Staff |
| **External Grants** | Externally funded projects with whole-project budgets | Faculties |
| **External Grant Team** | Which staff member is on which grant | External Grants, Staff |
| **Programme course lists** | The course list of each programme | Programmes |
| **Course Evaluations** | Overall student rating of each course, per term | Programme course lists |

Load them top to bottom. The first three are the backbone everything else
refers to by code; **Staff** must come before **Publications**, **Programme
Teaching Staff** and **External Grant Team**, which name people by their
employee code. Beyond that, a sheet only needs the sheets named in its row
above: it refers to their codes, and a file naming a code that does not exist
yet is refused.

**Faculties columns.** Faculty Code, Name (Thai) and Name (English) are
required. Kind is optional (default ACADEMIC). **Teaching Mode** is optional
and sets the student-to-staff ratio the faculty's Capability score is judged
against: *Clinical* (patient-supervised, strictest), *Lab-based*
(laboratory-intensive science and engineering), *Studio* (individual
instruction in design or art), *Professional* (cohort-based professional
programmes), or *Humanities* (lecture-heavy humanities, social science and
education, most lenient). Leave it blank and a new faculty is scored as
Professional; on a re-upload a blank keeps the value already stored.

**Thai institutions: spell faculty names the way TCAS does.** The TCAS
connector links national admission figures (mytcas.com) to a programme only
when the faculty's Thai name matches the TCAS spelling letter for letter — for
example `คณะวิศวกรรมศาสตร์`, with no campus or university suffix. A name such
as `คณะวิศวกรรมศาสตร์ (วิทยาเขตหลัก)` links nothing, and every programme
page's Admissions section stays empty.

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
note under `docs/superpowers/specs/` — per-instructor
teaching evaluations (the Course Evaluations sheet is course-level only) and
per-section instructor rosters, the last of these because it keys on
personal email addresses. Note that per-section instructors are a different
thing from **Programme Teaching Staff** above: one says who stood in front of
a particular class, the other says who the programme's teaching team is, and
only the second is importable.

**No exports yet?** A generator can write a mock set for your own university from the public TCAS files and your curriculum PDFs. See [No exports? Generate a mock set for your university](workshop/03-university-data.md#no-exports-generate-a-mock-set-for-your-university).

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

## Programme course lists — the fallback when the PDF cannot be read

The programme pipeline builds each programme's course list from its curriculum
PDF (phase 2b). Its parser expects one code shape, so a PDF with codes such as
`MEE 221`, a scan, or an unusual layout can come back with no list at all — and
programme overlap, curriculum revision and the Deep-Dive course sections then
stay empty. This sheet is the fallback: you supply the list.

Columns: **Programme Code** and **Course Code** (required), **Course Name
(Thai)**, **Course Name (English)**, **Credits** (0 to 99) and **Category**.
Category takes the English label, the Thai label or the stored token
(case-insensitive): General education / หมวดวิชาศึกษาทั่วไป, Core / วิชาแกน,
Major required / วิชาเฉพาะบังคับ, Major elective / วิชาเฉพาะเลือก, Free elective /
หมวดวิชาเลือกเสรี, Thesis / project / วิทยานิพนธ์/โครงงาน, Unknown / ไม่ระบุ.
Blank is stored as Unknown, never guessed.

**Mark general-education courses as General education.** Programme overlap
treats Unknown as a major course. Its code-prefix fallback only recognises the
prefixes GE, LI and 00, which are KKU's, so your general-education courses are
counted as major courses (and inflate overlap between programmes) unless the
Category says otherwise.

How it behaves:

- **Uploading a programme replaces its whole course list**, including rows the
  PDF extractor wrote. Programmes the file does not name are untouched. Two
  rows whose codes normalise to the same value (case, spaces) are refused,
  naming both rows.
- **The upload takes precedence over the PDF.** Once a programme has an
  imported list, phase 2b skips it (`course list supplied by spreadsheet import
  — not re-extracting`) and the materialise script skips it even with
  `--force`. Nothing re-extracts over your list.
- **Start over is the only way back to the PDF.** Starting the dataset over
  removes every imported list and hands all those programmes back to phase 2b.
  There is no per-programme release. Two workarounds: to refresh one
  programme's list (for example after a new curriculum revision — imported
  rows keep the revision they were loaded under) just upload that programme
  again; to hand one programme back to the PDF, download the stored files,
  start over, and re-upload the rest.
- **The shrink guard compares only against rows an earlier import wrote** for
  those programmes, so the first upload is never refused for replacing an
  over-collected extractor list.
- **A pipeline run racing an upload.** If a pipeline run happens to be writing
  extracted courses for a programme at the exact moment its upload commits, the
  upload can be overwritten; re-upload that programme in that case (the window
  is a single database statement).
- Imported rows are stamped `xlsx-import.v1`, the upload's ingestion run and the
  programme's active revision.

Things to know about what reads the list:

- The Deep-Dive course card lists only courses that also appear in Class
  Offerings with graded sections on the same course code, so upload Class
  Offerings with matching codes for the card to fill.
- Curriculum revision reads course descriptions from the AI digest, not from
  this table, and Unknown-category rows are never promotion candidates. Its
  prose code check (`PROSE_COURSE_CODE_RE`, five or six digits) misses 3-digit
  codes; only a diagnostic counter is affected.
- There is deliberately **no description column**: curriculum revision would
  ignore it, and overlap preparation overwrites a description whenever an
  approved digest lists the same code.

## Course Evaluations — the Student Satisfaction measure

One row per course section per term: the **mean of a 1–5 scale** that students
gave the course overall, and how many answered. It feeds the Student
Satisfaction measure in each programme's Outcomes score. There is no
per-instructor or per-question row, and nothing in the sheet identifies a
teacher.

Columns: **Course Code**, **Academic Year**, **Semester** (1, 2 or 3) and
**Average Rating** (1 to 5, required), **Respondents** (required), **Section**
(blank for a single-section course), **Faculty Code**, **Course Name (Thai)** and
**Course Name (English)**.

- **Load the programme course lists first.** The measure joins the course code
  to the programmes' course lists. A course on no programme's list counts for
  nothing, however many rows you upload. Spaces and letter case in the code are
  ignored.
- **Academic Year is the Common Era year** (2025). It is stored as the Buddhist
  era (2568), so the admin data view shows the year plus 543. A Buddhist-era year
  typed here is refused.
- **Average Rating is not a percentage.** 4.25 is right; 85 or 0.85 is refused.
  The measure weights each row by its Respondents and counts semesters 1 and 2
  only, so a summer row is stored but does not move the score.
- **At least five respondents per row.** A row below that is refused, and the
  message does not repeat the rating.
- **Faculty Code is optional, but fill it in.** The faculty satisfaction view
  groups by it, so a row without one is missing from that view.
- Uploading the same course, term and section again updates that row.
- **Rows are course-level.** Each is stored as one OVERALL row for the section,
  with no per-question breakdown. Imported rows count in the Student
  Satisfaction measure but are excluded from AUNQA theme evidence and from the
  teaching-talent view, which need per-question detail.

## External grants — projects and team

Two sheets feed the Staff grants dashboard and the **grant award** on a
programme's Financial score (up to +10 points, never a penalty). Load the
projects first, then the team.

**External Grants**: one row per project. Columns: **Project Code** (yours,
unique in the file, required), **Title (Thai)** (required), **Title (English)**,
**Type** (Research, Academic service, Consulting or Other), **Fiscal Year**
(required), **Budget (THB)**, **Funder** and **Lead Faculty Code** (required,
from the Faculties sheet).

**External Grant Team**: one row per person per project. Columns: **Project
Code** (must exist in the External Grants sheet), **Employee Code** (must be a
staff member from the Staff sheet; a code that matches nobody is refused,
naming the row) and **Role** (Lead or Co-investigator).

- **Fiscal Year is the Common Era year.** The Thai fiscal year starts on 1
  October of the previous calendar year, so fiscal year 2025 began on 1 October
  2024. It is stored as the Buddhist era (plus 543); a Buddhist-era year is
  refused.
- **The award reads the last three complete fiscal years**, counting each
  project once with its whole budget, for any project that has an active
  teaching member of the programme on it. Budget is never split between people.
  A project with no Budget counts for nothing.
- **Staff are named by employee code only.** There are no name columns, and
  nothing about a grant identifies a person beyond the code you already gave in
  the Staff sheet.
- **A programme only benefits through its staff.** The programme's teaching
  staff come from the Programme Teaching Staff sheet, so a grant on a person
  who is not linked to any programme there reaches no Deep-Dive.
- **Re-uploading updates.** Projects are matched on Project Code and team rows
  on the pair of codes. Nothing is removed by an upload; use start over for
  that. Start over for either sheet never touches projects a connector wrote.
- **Imported grants coexist with the KKU connector.** Neither replaces the other's rows: the connector's daily refresh leaves imported projects alone, and an upload never touches the connector's.

## Digital competency — cohorts and modules

Two sheets feed the Digital competency section of a programme's Deep-Dive and
the Student DQ dashboard. Load both: the score comes from the modules sheet,
and it is withheld until the cohorts sheet shows at least six scored students.

**Digital Competency — Cohorts**: one row per programme per entry year.
Columns, all required: **Programme Code**, **Entry Year**, **Students Tested**
(at least five, or the file is refused), **Students With Scores** (cannot
exceed Students Tested) and **Students Passing All Modules** (cannot exceed
Students With Scores). The pass rate shown is passing divided by with-scores.

**Digital Competency — Modules**: one row per programme per entry year per
module. Columns, all required: **Programme Code**, **Entry Year**, **Module**
(1 to 13), **Students Taking** (at least five), **Mean Score (0–100)** and
**Students In Scope** (cannot be fewer than Students Taking). The overall mean
is the taker-weighted mean of modules 1 to 12; module 13 (practical) is stored
and drawn on the radar but is left out of that mean. The guide sheet lists the
module names.

- **The 13 modules are the framework's own.** An institution that runs a
  different test has to map it onto these axes, or the radar is sparse.
- **Entry Year is the Common Era year**, stored as the Buddhist era (plus 543)
  as the other cohort sheets are. A Buddhist-era year is refused.
- **A mean outside 0–100 is refused**, naming the scale.
- **Bachelor programmes only.** Digital competency is an undergraduate measure;
  a row for another level is stored but no score reads it.
- **Each sheet replaces what it uploaded before, per programme.** A programme
  that appears in a file has its earlier rows from that same sheet replaced;
  programmes the file does not mention are untouched, and so is anything
  another source wrote. Upload the full set of cohorts for a programme in one
  file.
- Below six scored students a programme shows the count and no score, rather
  than a figure that describes individuals.
- **A module row below five takers is refused.** Merge small groups (for example
  across entry years) or leave the row out; the module then shows no score.
- **The DQ dashboard's coverage panel is blank for imports.** It needs the
  per-student export that only the DQ connector reads, so it describes nothing
  you upload.
- **Workshop modules cannot be imported.** Only the theory modules (1 to 13) are
  accepted; a workshop module number is refused.

## Employer feedback

One sheet feeds the **Top employers** list in the Deep-Dive's graduate outcomes
section. One row per programme per survey year per employer. Columns:
**Programme Code**, **Survey Year**, **Employer** (optional), **Satisfaction
(0–1)** and **Respondents**, all but Employer required.

- **Leave Employer blank** for one figure covering all employers together; it
  is stored and shown as "All employers". Organisation names only — never a
  person's name.
- **Satisfaction is a proportion between 0 and 1** — write 87 % as 0.87. A
  value above 1 is refused, because 87 would render as 8700 %.
- **Respondents must be at least five**, or the file is refused.
- **Survey Year is the Common Era year**; a Buddhist-era year is refused.
- **Replaces per programme.** A programme that appears in the file has its
  earlier rows from this sheet replaced; programmes the file does not mention
  are untouched.
- **Where it appears.** Employer feedback is shown in the **Outcomes** section
  of the programme's Deep-Dive, which lists the top employers even when there
  is no graduate-outcome survey for the programme yet.
- A blank Employer and a typed "All employers" are the same row, so a file
  stating both for one programme and year is refused as a duplicate.

## Population projections

One sheet gives the cohort sizes behind the demographic-ceiling views, the
scenario planner and the demographic health driver. Without it the system
uses the UN World Population Prospects pull (`un-wpp`, national figures for
the connector's country) and, on a KKU installation, the NESDC starter
series. Upload this sheet to use your national statistics office's edition or
to supply **regional** figures. Columns: **Region**, **Year**, **Age Group**,
**Population** and **Source Name**, all required.

- **Region.** Write `TH` for the national total. A regional row only drives
  the demographic health score when it names the region selected in your
  organisation profile, which is one of `Northeast`, `Central`, `North` or
  `South` (case does not matter; Central includes Bangkok, the East and the
  West). Rows for any other region are stored but never used. The national
  figure is never substituted, so an unmatched region leaves that driver empty
  rather than scoring it on the wrong population.
- **Year** is the Common Era calendar year, 2000 to 2100; a Buddhist-era year
  is refused.
- **Age Group** is `15-17`, `18-22` or `23-29`; anything else is refused, so
  add single ages together first.
- **Population** is persons, not thousands, and above zero.
- **Source Name** is free text such as "NESDC 2023 edition". It is stored as
  `xlsx:<name>` and shown wherever the projection is cited. Keep it identical
  between uploads: the file merges on region, year, age group and source
  name, so a refreshed file updates the edition and a new name adds a second
  one.
- **Which edition wins.** Every reader prefers an uploaded sheet, then the UN
  series, then NESDC, and only counts a source that has a national row for
  the current year (and the region, where the reader needs one). Include the
  current year, or the sheet is passed over.
- **Start over** removes only the rows this sheet wrote.

## Career skill demand

This sheet is the fallback for the KMITL Skill Mapping API, which an adopting
university usually cannot call: its credentials are issued by KMITL directly
on request, not self-service. It writes the same tables, so the
labour-market alignment score, the strategic-sector score and the
programme-career mapping read it unchanged. Columns: **Career Group**, **Career**,
**Skill**, **Scope** (`Thailand` or `Global`), **Data Source** (`Job postings`
or `Profiles`) and **Share of Postings (%)** (all required), and **Career
Sub-group** (optional, stored as `General` when blank).

- **Share of Postings (%)** is a percentage from 0 to 100 (write 12.5 for 12.5 %),
  the same unit the KMITL API returns. A skill counts as demanded at 5 or
  more; a value above 100 is refused.
- **Career Group.** Only `IT`, `Engineer`, `Health Science`, `Smart Farmer`,
  `New S Curve` and `Food` count as strategic sectors in the strategic-sector
  score. Any other name is allowed and scores as non-strategic.
- **Skill** is matched, ignoring case, against English then Thai names in your
  skill taxonomy. A name that matches nothing is stored without a link, does
  not score, and is counted in the message after the upload. **Upload after
  the programme pipeline has built your skills**, and upload again later to
  resolve more names.
- Imported careers get negative ids so they never collide with KMITL's, and
  keep them on re-upload. Connector runs never touch them.
- The file merges on Career Group, Career Sub-group, Career, Skill, Scope and
  Data Source. **Start over** removes only the rows this sheet wrote.

## University rankings

One sheet lists the universities the Deep-Dive's AI peer selection chooses
comparison institutions from. The template downloads **pre-filled with a
starter list** (QS and THE 2025 positions for about 60 world, Asian,
Southeast Asian and Thai universities): edit it rather than starting blank.
Columns: **University**, **Country**, **Region**, **Ranking Year** (required),
**QS World Rank**, **THE World Rank**, **QS Asia Rank**, **THE Asia Rank** and
**Website** (optional).

- **University** must be the English name. Your own institution's row is
  excluded from peer picks only when it equals the English name in your
  organisation profile exactly; otherwise the institution can be offered as
  its own peer.
- **Region** is one of `World`, `Asia`, `Southeast Asia` or `Thailand`: the tier
  the selector files the university under. Anything else is refused.
- **Ranking Year** is the Common Era year of the edition. The selector reads
  only the latest year in the table, so a list for a new year replaces the old
  one in effect.
- **Ranks** are whole numbers of 1 or more; blank means unranked. A blank
  rank on a re-upload clears the stored rank.
- **Where the figures come from.** QS and THE publish their tables publicly
  but no data feed; copy the positions you need. For Thai research ranks,
  SCImago Institutions Rankings (scimagoir.com, country filter `?country=THA`)
  is a free source.
- The file merges on University and Ranking Year. **Start over** removes only
  the rows this sheet wrote, and refuses while programmes hold peer selections
  that cite them.

## Staff salary by funding

One sheet feeds the Deep-Dive's **Teaching-staff salary cost** card, which splits
a programme's salary cost by who pays it. One row per faculty, rank, funding
source and fiscal year. Columns: **Faculty Code**, **Rank** (LECTURER,
ASST_PROF, ASSOC_PROF or PROF, as on the Compensation sheet), **Funding Source**
(free text such as "Government budget" or "University revenue"), **Fiscal
Year**, **Headcount**, and **Mean**, **Min** and **Max Monthly Salary (THB)**.

- **Salaries are monthly**, unlike the Compensation sheet. Any figure above
  500,000 is refused as probably annual.
- **Min must not exceed Mean, and Mean must not exceed Max.**
- **Headcount must be at least five.** The refusal names the row and never
  quotes the salaries.
- **Fiscal Year is the Common Era year**; it is stored in the Buddhist era
  (2024 becomes 2567), which is how the admin data view will show it.
- **Rank** is one of LECTURER (lecturer), ASST_PROF (assistant professor),
  ASSOC_PROF (associate professor) or PROF (professor).
- **Funding Source is shown as written**, so keep one spelling per source.
  Extra spaces are ignored when comparing rows.
- The card needs your staff, their programme assignments and enrolment as well;
  it uses the latest year in this sheet and each staff member's rank.
- **Merges**: a row for the same year, faculty, rank and source is updated.
  If the HR connector is also running, it never removes rows from this sheet;
  but if it writes the same year, faculty, rank and funding source, its next run's
  figures replace yours.

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

Some year columns are stored converted to the Buddhist era, because that is
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

**Required columns must be present; unknown columns are refused.** You may
leave out an optional column. You may not leave out a required one, and you may
not add a column the dataset does not describe. This is deliberate: a stray
column of personal data would otherwise be accepted silently.

**Every code must already exist.** A row that names a programme, faculty,
department or employee code that is not in an earlier upload refuses the
whole file, and the message lists each row: "... is not a known programmes code.
Upload that dataset first, or correct the value." Add the missing rows to the
earlier sheet, or delete the rows that name them. Older exports often name
retired programmes, so expect this once.

**One upload holds at most 10000 rows.** A larger file is refused with "This file
has 12000 rows; the limit is 10000. Split it into smaller files." Split big files
(publications are the usual case) into parts and upload each one.

**No personal identifiers.** A cell containing a national ID number fails the
file. The message names the row and column, and never repeats the value.

**Small groups are refused** where a dataset carries headcounts, so no
individual's figures can be worked out from an average.

**A much smaller file is questioned, where it could remove rows.** Datasets
that replace a term or a programme's list (class offerings, programme course
lists) refuse a file with fewer than half the rows currently stored for that
term or programme, as a probable partial export — with a button to upload it
anyway if you know it is right. Every other dataset only adds or updates rows,
so a short file can never lose anything and is accepted; you can split a large
file into parts without confirming the last small one.

## Things worth knowing about spreadsheets

- **Roll-up views refresh by themselves** after uploads of programmes,
  enrolment, finance or outcomes. On an installation upgraded from before this
  change, run `pnpm outcomes:refresh-derived` once.
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

A few things to understand before using it:

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

### Starting over on everything

When you have been testing uploads and want an empty installation again, use
**Start over: all data** at the foot of the *Institution data* section on
**Admin → Data setup**. You type your organization's short name to confirm. It
is shown only to administrators who may clear datasets.

- **Deleted:** every row loaded from a spreadsheet, in every dataset, and
  everything built on those rows: curriculum PDFs attached to an uploaded
  programme and the courses and learning outcomes extracted from them, AI
  analysis, risk assessments, demand matches, overlap findings, peer
  selections, and the mappings that tie TCAS or registry data to a programme.
- **Also deleted:** the upload history and the stored workbooks. Every
  dataset page goes back to "no uploads yet". Keep your own copies.
- **Kept:** the organization profile, users and roles, system settings, and
  data fetched by the public connectors (TCAS, population projections, skill
  demand, publications).
- **All or nothing.** The database part runs as one transaction. If anything
  stops it — most often a programme or department you created by hand under
  an uploaded faculty — nothing is deleted, and the message says so.
- **Not undoable**, unlike the per-dataset start over: the files are gone too.

## If an upload does not appear

Imported rows carry a record of which upload created them, and the application
hides data whose origin it cannot verify. If an upload succeeds but nothing
shows, the usual cause is a missing data source row. Run
`pnpm data-sources:sync --apply`, which creates one per dataset without
touching anything else, and upload again. (`pnpm setup` and every production
deploy already run it, so this mostly happens on a database that predates a
new dataset.)

## For developers

- Declarations: `packages/db/src/import/datasets/`. Adding a dataset is adding
  one declaration — template, validation, guide sheet and provenance all derive
  from it.
- Validation: `packages/db/src/import/validate.ts` (pure).
- Parser and template writer: `apps/api/src/import/`.
- Design: `docs/superpowers/specs/2026-10-17-institute-xlsx-import-design.md`.
