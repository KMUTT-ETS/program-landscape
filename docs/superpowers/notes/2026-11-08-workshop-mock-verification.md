# Workshop mock generator: clean-install verification (2026-11-07/08)

Working note (excluded from the docs site). Counts only: no KMUTT staff, student
or financial values. Generator: `pnpm workshop:mock` (TypeScript), spec
`docs/superpowers/specs/2026-11-07-workshop-mock-data-design.md`.

## What was run

A fourth isolated install on the dev machine (`program_landscape_e2e4_test`, its
own Redis on 6383, buckets `*-e2e4`, ports 3400/4400), driven through the
browser with Playwright wherever the tutorial uses the UI. The developer
database and the earlier `e2e3` install were not touched.

Input: KMUTT, region `Central`, one programme, "วิศวกรรมเครื่องกล", faculty
คณะวิศวกรรมศาสตร์, with the real KMUTT Mechanical Engineering curriculum PDF
(the file used in the 2026-11-03 KMUTT runs). TCAS: all nine round-3 files
(BE 2562–2569), passed with `--tcas-file`.

## Results

| Step | Result |
|---|---|
| Setup steps + `pnpm adopter:fresh-check` | passed |
| Claim administrator, organisation profile | done through the UI |
| `pnpm workshop:mock` | first attempt refused, nothing written (defect G1); after the fix: 20 files + README.txt; anchor resolved to TCAS course code `10140107300702A`; 166 course codes read from the PDF |
| `pnpm workshop:check-mock` | OK: every file passes the importer; 8 of 8 bachelor programmes match the `tcas` connector's rules |
| 20 uploads + University Rankings pre-filled template | all accepted first try |
| `tcas`, `un-wpp` | SUCCEEDED (tcas 40,958 rows) |
| `curriculum:check`, attach PDF | headings found; attached (Files tab) |
| Pipeline (Run full pipeline) | 12 phases, USD 1.30 (phase 1 alone USD 1.26 on a 166-course PDF), about 9 min; phase 1 DEGRADED (PDF roster 0 of 27 matched: expected, mock staff are tokens; the uploaded programme staff are used); phase 5 failed once on an AI schema error and passed on rerun; phaseOV hit the free Google embedding quota, retried and scored |
| `pnpm skills:normalise --source=linkedin --auto-promote` | 13 s for the 18 mock career-skill names (the KMITL feed takes about an hour) |
| Setup checklist | 43 → 45 (normalise + reruns) → **46 of 48** (after fix G2) |
| Deep-Dive | every section rendered, no page errors; only empty note: staff payroll (needs the Staff Salary by Funding sheet, which the generator does not produce) |
| Start over | Career Skill Demand (24 rows) and Population Projections (96 rows) cleared; Programmes correctly refused, naming the dependent data |

## Defects found and fixed

- **G1 (generator)** the real PDF writes two codes with and without a space
  (`MEE 364` / `MEE364`). The generator deduplicated by exact text; the importer
  compares by `normaliseCourseCode`. The generator's own validation caught it and
  wrote nothing. Fixed in `36200a71` (dedupe by the importer's function).
- **G2 (app)** demand-match rows took their provenance only from a
  `kmitl-skill-mapping` run. An install whose skill demand comes from the
  `career-skill-demand` spreadsheet has no such run, so every row was stored with
  a null run id, `realDataWhere()` hid them, and `demand_match_filled` could never
  be filled. Fixed in `938433d7` (latest run of either source; same fix in
  `backfill-demand-match-provenance.ts`).
- Test kit only: the pipeline script's confirm click also matched the "Run
  pipeline" button and started a second run; it was stopped within two minutes
  and the script now clicks only inside a dialog.

## The two remaining gaps: a `tcas` connector defect (NOT fixed)

`tcas_min_score_percentile` and `tcas_competition_vs_peers` stay missing because
the public 2569 data has no admitted counts or minimum scores in the database.
The connector reads columns by fixed Thai header names taken from the 2568 round
3.2 file; the real files use different headers almost every year. Stored rows on
this install:

| Year | Rows | With admitted | With min score | With faculty name |
|---|---|---|---|---|
| 2562 | 4,084 | 0 | 0 | 4,084 |
| 2563 | 3,170 | 0 | 0 | 3,170 |
| 2564 | 3,751 | 0 | 0 | 3,751 |
| 2565 | (none) | | | |
| 2566 | 3,799 | 0 | 0 | 0 |
| 2567 | 3,817 | 0 | 0 | 3,817 |
| 2568 r3.1 | 3,966 | 0 | 0 | 3,966 |
| 2568 r3.2 | 3,965 | 3,561 | 3,964 | 3,941 |
| 2569 | 4,048 | 0 | 0 | 4,048 |

2565 uses English headers (no row has a course code, so none is stored); 2566
calls the columns `คณะ/สำนักวิชา` and `ชื่อหลักสูตร`; 2569 has plain `ผ่าน` and
`คะแนนต่ำสุด`. The generator's own reader handles every layout with an alias list
(`apps/ingestion/src/scripts/workshop-mock/tcas.ts`); the connector needs the
same. This very likely affects production KKU figures as well (fill rate falls
back to public data only when campaigns state no seats, but the minimum-score
percentile and peer comparison read public rows directly). Fix separately.

## Notes for the workshop

- Tell attendees to run `pnpm skills:normalise --source=linkedin --auto-promote`
  after uploading the mock set (seconds for 24 names), before the pipeline;
  otherwise labour-market alignment and demand match stay empty.
- Phase 1 cost USD 1.26 on a 166-course curriculum, above the USD 0.40–0.80
  quoted in the docs, which was measured on a 126-course PDF.
