# KMUTT end-to-end verification of the adopter setup (2026-11-03/04)

Working note (excluded from the docs site). Counts only: no KMUTT values, names or
personal data. Programme under test: B.Eng. Mechanical Engineering, code `2514001`.

## What was run

Two clean installs on separate databases on one dev machine, driven through the
browser with Playwright wherever the tutorial says to use the UI:

- **Run 1** (`program_landscape_e2e_test`): the first pass. It found most of the
  defects below, which were fixed on the branch and re-verified in place.
- **Run 2** (`program_landscape_e2e2_test`): a second clean install that followed
  the final tutorial (`docs/tutorials/getting-started.md`, then
  `program-deep-dive.md`) step by step after the fixes.

Each run had its own database, Redis, buckets, cache prefix and ports. Neither
touched the developer's own database. The KMUTT workbooks were uploaded as
exported. A few needed rows removed or splitting: older exports named programmes
the programmes sheet does not list, and one file was over 5,000 rows. For the
eight datasets KMUTT has no file for, the uploads used obviously fictional
synthetic workbooks: course evaluations, digital competency (two), external
grants (two), employer feedback, staff salary by funding, population projections.

## Results

| Step | Run 1 | Run 2 |
|---|---|---|
| `pnpm setup` steps + `pnpm adopter:fresh-check` | passed | passed |
| `/` and `/signin` redirect to `/setup`; "Create administrator" signs in | signed-in failed (F1), fixed | signed in |
| Organisation profile saved | yes | yes |
| Uploads (24 workbooks, incl. 3-part publications) | all after F3/F6 fixes | all, first time |
| Connectors | tcas 40,958 rows (36 programmes matched), un-wpp 78, kmitl-skill-mapping 39,419, openalex-works SKIPPED (no key, clear message) | same counts |
| Market skill names into the taxonomy (`skills:normalise --source=linkedin --auto-promote`) | 5,852 names, ~1 h 45 m (shared key), ~USD 1.45 | 5,852 names, 53 min; 200 failed on transient errors, re-run picked up most |
| Pipeline for one programme (from the Pipeline tab) | ~USD 0.80 (incl. reruns) | 18 min, USD 0.39; phase 6 failed on schema (F22, fixed), phaseOV hit the embedding quota (F25, fixed) |
| Setup checklist | 47 of 48 ready | 47 of 48 ready |
| Deep-dive sections | all render, no page errors | all render, no page errors |

Remaining checklist gap on run 1: registration yield, because the admission
campaigns export has no Reported column. The checklist names the column. Not
applicable by design: two net-contribution-per-programme drivers (revenue-only
finance) and JobThai (commercial feed not loaded).

## Defects found and fixed (F1–F21)

- F1 setup auto sign-in (CSRF) — server-side sign-in in the setup action.
- F2 hardcoded KKU counts on `/admin/data-setup`.
- F3 optional columns were required in uploads.
- F6 the shrink guard refused the last small part of a split upsert upload.
- F8 the checklist overlap check counted the legacy course relation.
- F9 imported campaign rows did not feed the TCAS funnel drivers.
- F10 min-score percentile: own TCAS subject key over-captured; name-signature fallback.
- F11 roll-up views never refreshed for an adopter; now refreshed after uploads.
- F12/F13 empty skill taxonomy on a fresh install; phase 2 now builds it for a programme with no skills and promotes earlier proposals.
- F14 digest sign-off defaulted to a KKU email address; now the first administrator.
- F15 TCAS funnel drivers fall back to public TCAS round-3 figures when campaigns have no seats (`health-score.v5.6`).
- F16 empty drivers now carry a human reason in the checklist.
- F17 JobThai not applicable when never loaded.
- F18 demand match skipped until market skill names join the taxonomy — documented step, checklist says so.
- F19 the narrative quoted a 0.0 % fill and missing min score for a year without published admits.
- F20 the narrative listed a by-design absence (revenue-only finance) as a data gap.
- F21 the narrative ran before the risk analysis; phase 8 now runs first.
- F22 AI readiness failed on a model overshooting a length cap; parser now clamps, drops bad optional items, retries once.
- F23 (data) the PDF teaching-staff roster matched 0 staff: KMUTT's staff file carries placeholder names. The note no longer tells the operator to load staff; imported programme staff are used.
- F24 checklist shows why AI readiness is empty after a failed phase.
- F25 phaseOV failed outright on the embedding quota; it now scores on shared course codes and reports DEGRADED.
- Final review: registration yield null when Reported is not stated; a sheet without an optional column no longer erases stored values on re-upload; taxonomy builds serialised with an advisory lock.

Documented rather than changed: F4 (a workbook naming unknown codes is refused
whole), F5 (5,000-row limit per upload), the free-tier Google embedding limit
(~1,000 course texts a day; the overlap step resumes), the course Category
column (blank reads as Unknown).

## Run 3 (`program_landscape_e2e3_test`, 2026-11-04 → 11-07)

A third clean install, made after the KMUTT files were sorted into `used/`
(uploaded), `used/prepared/` (rows filtered, publications split, course
Category filled by code prefix) and `mock/` (generated stand-ins for the
datasets KMUTT has no file for). Nothing from the earlier runs was reused.

- Setup, organisation profile, all 30 uploads (first try), connectors and the
  market-skill step: same results as run 2 (5,852 names; 60 min, then a rerun
  of under a minute with 0 failures).
- `curriculum:check` found the PLO, roster and appendix headings; the PDF
  attached from the Files tab.
- First pipeline run: phases 3, 5, 6, 7 and RE failed on OpenRouter HTTP 402
  (account out of credits — environment, not code). After a top-up, a rerun
  from the Pipeline tab passed every phase: 23.4 min, USD 0.07 (phase 1 reused
  the first run's extraction). phaseOV DEGRADED on the embedding quota, 53
  pairs scored on shared course codes, as documented.
- Setup checklist: first 46 of 48. The extra gap was demographic resilience:
  the mock population sheet carried only national `TH` rows, and the driver
  reads only the organisation's region (documented in `data-import.md`). After
  adding `Central` rows and uploading the sheet again: **47 of 48**, the same
  single gap as before (registration yield, no Reported column).
- Deep-Dive: every section rendered, no page errors. Content notes: no trend
  signals (fresh install); curriculum revision found no major-elective course,
  because the prefix-based Category fill produces none.
- Docs fix: the programme Pipeline tab button is "Run full pipeline", not
  "Run pipeline" (both tutorials corrected).

## Open

- KKU invariance of the v5.6 changes is argued from code and tests, not measured:
  there is no KKU dataset on this branch.
- Overlap content layer: only ~960 of 4,841 courses embedded on run 1 (free-tier
  daily limit). The overlap index used shared course codes.
- Trend signals: a fresh install has none, so the narrative's trend channel is
  empty until an adopter adds signals.
