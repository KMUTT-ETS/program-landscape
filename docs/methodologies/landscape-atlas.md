# Landscape atlas — `landscape-atlas.v1`

| Version | Date | Change |
|---|---|---|
| `landscape-atlas.v1` | 2026-10-05 | First version: five chapters, seven visuals on the Executive Landscape. |

**Where:** `/dashboards/executive-landscape`. **Code:** `packages/db/src/landscape-atlas/`
(builders are pure; `read.ts` is the only I/O). **API:** `GET /api/v1/landscape/{shape,position,capability,future}`;
Market reuses `GET /api/v1/gap/map`. **Spec:** `docs/superpowers/specs/2026-10-05-landscape-atlas-design.md`.

The atlas composes existing measures; it introduces no new score. Its own rules are the
axis definitions, the split lines, the "listed, not plotted" rule and the answer lines below.

## Rules that apply everywhere

- **Missing is never 0.** A programme or faculty a chart cannot place is listed beneath it with the reason.
- **Answer lines are computed by fixed rules**, never by AI. Each chapter shows a figure followed by a sentence that continues it (for example "39%" + "of active students are in the 5 largest of 24 faculties; …").
- **Scope** is clamped server-side (`clampScopeForUser`); a programme-level user sees their programme.
- **Freshness** on each chapter is the time it was computed; results are cached 5 minutes per chapter and scope.
- **Bubble sizes are capped** (maximum radius 16 px on the Position charts, 22 px on Market and Capability). This is a display choice so bubbles stay legible; it does not change any value.

## Chapter 1 · Shape — portfolio treemap
- Faculty → programme. **Area** = currently active students, `SUM(student_cohort_distributions.student_count)` (rows passing `realDataWhere()`).
- **Colour** = overall health score bands: < 40 danger, 40–65 needs attention, ≥ 65 healthy; hatched = no score.
- **Not drawn:** no active-student data; zero active students.
- **Answer:** share of active students in the 5 largest faculties; programmes with fewer than 15 active students. With 5 or fewer faculties the figure is the total active students instead.

## Chapter 2 · Position (bachelor programmes)
**Growth–share matrix.**
- X = TCAS round-3 applications ÷ round-3 seats in the latest entry year with data (log). **Split 1.0.** Only round 3 is used: linked TCAS rows hold round 3 only, which is part of admissions, not all of it. In 2568 round 3 is split into 3.1 and 3.2 rows carrying the same figures, so each `tcas_course_code` is counted once per entry year (MAX over the rows), then course codes are summed.
- Y = 3-year enrolment change, % (latest year vs three years earlier, `enrollment_metrics`), axis clamped to −100…+200 % (table keeps the raw value). **Split 0 %** (0 counts as not growing).
- Size = active students; colour = net contribution ÷ active students.
- Quadrants: Star (≥ 1.0, growing), Cash cow (≥ 1.0, not growing), Question (< 1.0, growing), Dog (< 1.0, not growing).
- Not plotted: no TCAS rows; quota 0; zero applications; no enrolment three years earlier.

**Health × risk action map.**
- X = overall health score, **split 65** (the "healthy" band). The axis ends at 100 and starts at min(55, lowest plotted health − 5, rounded down to a multiple of 5), floored at 0, so it is not always 0–100.
- Y = KKU 5×5 risk matrix score 1–25, **split 10** (start of HIGH).
- Act now (< 65, ≥ 10), Watch (≥ 65, ≥ 10), Fix quietly (< 65, < 10), Protect (≥ 65, < 10). Colour = KKU risk level.
- Not plotted: risk NEEDS_DATA; no health score.

**Answer:** programmes in Act now, followed by the number of Dogs.

## Chapter 3 · Market — demand vs supply diagonal
- One dot per field of study from `gap-map.v2` (bachelor universe, default thresholds, demand basis selectable).
- X = KKU graduate share, Y = job-advert share, **same log domain on both axes**, so the diagonal is demand = supply.
- White-space fields (no KKU programme) and fields whose KKU programmes have no graduates (supply share 0) sit on the left edge. Not plotted: supply-unknown, too-few-postings, zero adverts.
- **Answer:** the figure is under-served plus white-space fields ("fields need attention: …"), followed by the over-served count.

## Chapter 4 · Capability — research & grant engine (by faculty)
- Staff = distinct active `faculty_members` linked to the faculty's canonical programmes (as the health score's Capability).
- X = `research_outputs` (passing `realDataWhere()`) in the last 3 complete calendar years ÷ 3 ÷ staff.
- Y = `grantAward(staff).raw.bahtPerStaffPerYear` — last 3 complete Thai fiscal years; a project counts for every faculty with a member on it; budgets never split. Log axis with a ฿10k floor.
- Guides at the KKU medians. Not plotted: no active staff; grants source never synced.
- **Caveat:** about 30 % of co-investigator ids match no HR record, so grants are a lower bound.
- **Answer:** faculties at ฿1M or more per staff member a year.

## Chapter 5 · Future
**Future-fit scorecard** — three columns (automation resilience dropped, see below), drilled down Faculty → Level → Programme with a pinned total row:
- **Programme row:** AI readiness = its `programAiReadiness().overallScore` (null when it has no extracted skills); Relevance = its health relevance dimension; DQ = its own respondent-weighted score (theory modules up to `OVERALL_MEAN_MAX_MODULE_NO`), bachelor only and only with at least `DQ_MIN_CELL_STUDENTS` scored students, else null. The name links to `/programs/<id>`.
- **Level row** (Bachelor, Master, Doctoral, Higher grad diploma — only levels that have programmes, in that order): AI readiness and Relevance = means over its programmes' present values; DQ = the faculty rollup on the Bachelor row only (DQ is bachelor-only, so the faculty rollup is the bachelor rollup), null on other levels.
- **Faculty row:** AI readiness and Relevance = means over all the faculty's programmes (not a mean of level means); DQ = `dqCompetencyByScope(faculty).rawMean` (respondent-weighted, never a mean of programme scores). At a department or programme scope the faculty row reads that scope's DQ instead.
- **Total row** (pinned last, bold, not expandable): "University average", "Faculty average", "Department average" or "Programme average" by the chapter scope. AI readiness and Relevance = means over every programme in scope (not a mean of faculty means); DQ = `dqCompetencyByScope` at the chapter scope (`university` reads every bachelor programme).
- Every row's mean is over its present columns only, shown with "(n/3)". Faculties sort by mean (rows with no column last), levels in fixed order, programmes by mean then name. A missing value is "—", never 0.
- The note naming the three lowest faculties appears only when at least 4 faculties have at least 2 of the 3 measures.

**National-strategy coverage:** faculties × the 8 `sectors`; a cell counts the faculty's programmes with at least one
`program_skills` row whose skill maps to the sector (`skill_sectors`). Empty = "not mapped", not "no capacity".

**Answer:** the figure is the number of sectors fed by fewer than 15 programmes, as "N of 8" ("8 of 8" when none is thin, with the sentence saying all are fed by 15 or more); any sector with none mapped is named.

**Why there is no automation-resilience column (D8):** only 537 of 4,372 skills carry an automation-risk tag (22 HIGH),
so the share of high-risk skills has median 0 and max 0.14 across programmes; the column would read 86–100 for every
faculty. AI readiness already carries a skill-resilience sub-score that classifies every skill.

## Known limits
- Position covers bachelor programmes only (TCAS and the risk register are bachelor-only).
- Sector coverage depends on skills extracted from curriculum PDFs.
- The Cockpit's Strategic Matrix still uses stand-in axes; this atlas does not change it.
- Market is shown at university scope only: the gap map's demand shares are university-wide, so at a faculty or department scope it would compare that scope's graduate share with all-KKU demand and mislabel fields as white space or over-served. Narrower scopes link to the Gap Analyzer instead.
- Capability's dashed median guides and its above/below colours need at least 3 faculties in view; with fewer, no guides are drawn and every bubble is grey.
- Future's thin-sector rule applies at university scope only; at other scopes the chapter reports the sectors fed by the programmes in scope.
- A user with several grants sees the atlas chapters for one grant (the API's scope clamp narrows a multi-grant user to one, as on `/gap/map`), while the hero KPIs show the union of all grants.
