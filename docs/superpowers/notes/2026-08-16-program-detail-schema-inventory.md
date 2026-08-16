# `program-detail` PDF schema inventory — pre-refactor discovery

Read-only discovery pass over `packages/pdf-templates/src/templates/program-detail/schema.ts`
(500 lines) and its sole producer, `apps/api/src/programs/program-detail-data.ts` (1,074 lines).
No code was changed. Purpose: build the worklist for converting the schema from
pre-formatted-string tables to numbers-with-render-time-formatting, ahead of the chart-led
rebuild.

## Summary

A raw grep of top-level `field: z.string()` / `z.number()` declarations in `schema.ts` finds
**206 string-typed declarations and 13 number-typed declarations** (this is the source of the
"204 vs 13" figure in the task brief — small variance because the naive line-anchored grep
in Step 1 misses fields declared inline inside `z.object({ ... })` on the same line as their
array wrapper, e.g. `outcomes.salaryTrajectory[].year/.salary` and
`peers.aiReview.strengths[].claim` / `.weaknesses[].claim`; a `total z.string(` occurrence
count of 206 catches those).

This document classifies at **field-path granularity**, per the brief's own example
(`healthScore.subScores[].value`, not bare `value`). Because one shared sub-schema —
`KvRowSchema` (`{ metric, value, notes }`) — is reused verbatim across six different sections
(executive snapshot, AI-readiness sub-scores, cohort summary, outcomes summary, faculty KPIs,
financials KPIs) with a **different concrete meaning at each use site**, unrolling those six
reuses into distinct field paths is what pulls the total up to **232 field paths**. That
unrolling is itself a finding, not just bookkeeping — see "Structural finding" below.

**Bucket counts (232 total):**

| Bucket | Count |
|---|---|
| NUMERIC | 92 |
| DISPLAY | 108 |
| AMBIGUOUS | 32 |
| **Total** | **232** |

NUMERIC clears the ~80-field sanity floor from the task brief with room to spare, which is
consistent with the refactor's premise: this schema is overwhelmingly pre-formatted numbers
wearing string types. If the 32 AMBIGUOUS fields are folded into their stated leaning (most
lean NUMERIC — mainly Buddhist-era years embedded in compound labels), the split moves to
roughly **113 NUMERIC / 119 DISPLAY** — still a real refactor, not a rounding error.

**Placeholder audit:** 33 distinct `'—'`-emitting call sites found in the builder (42 raw
occurrences of the `'—'` literal, several of which are the shared `fmt*` helper functions used
at multiple call sites), plus a separate `'no data'` sentinel used only inside
`aiReadiness.subScores[].value` (4 call sites), plus at least two real formatting bugs found
along the way that the refactor must not silently reproduce (see "Correctness bugs found in
passing" below). All are catalogued in the "Placeholder-emitting fields" section.

### Structural finding: `KvRowSchema` is not one field, it's six unrelated tables wearing the same costume

`KvRowSchema.value` is `z.string()` and is reused for: an overall health score (NUMERIC), a
lifecycle verdict label (DISPLAY), an AI-readiness score (NUMERIC), a currency figure
(NUMERIC), and — in `faculty.kpis[].value` — a **single row that concatenates three numbers
into one compound string** (`"8/24 (33%)"` for senior-rank share). A single
`z.string() → z.number()` flip cannot fix this: the six use sites need six independently-typed
shapes (or a discriminated union), not one shared row schema. This is the single biggest reason
"flip every `z.string()` to `z.number()`" is not a mechanical operation here — see the
AMBIGUOUS section for the specific compound-value fields that need splitting, not just retyping.

---

## Full field inventory

Grouped by report section, in schema declaration order. `current type` is the schema's
declared Zod type; `bucket` is NUMERIC / DISPLAY / AMBIGUOUS.

### Cover

| field path | current type | bucket | notes |
|---|---|---|---|
| `programCode` | `z.string()` | DISPLAY | identifier (`KKU-SEQ-NNNN`); never plotted, leading structure matters |
| `nameTh` | `z.string()` | DISPLAY | |
| `nameEn` | `z.string()` | DISPLAY | |
| `level` | `z.string()` | DISPLAY | categorical label via `LEVEL_LABEL` map (Bachelor/Master/Doctoral/Higher Grad Diploma) |
| `status` | `z.string()` | DISPLAY | categorical program status |
| `facultyTh` | `z.string()` | DISPLAY | |
| `facultyEn` | `z.string()` | DISPLAY | |
| `departmentTh` | `z.string().default('')` | DISPLAY | `''` when program has no department |
| `departmentEn` | `z.string().default('')` | DISPLAY | |
| `yearEstablished` | `z.string().default('')` | AMBIGUOUS | Gregorian year, currently `String(year)` or `''`. Leans **NUMERIC** — could anchor a program-age axis; `''` sentinel must become `null`, never `0` |
| `dateLabel` | `z.string()` | DISPLAY | ISO date string via `fmtDate` (health freshness date, or generation time as fallback) |
| `generatedAtLabel` | `z.string()` | DISPLAY | already a long-format rendered date-time string, not ISO — genuinely display-only |
| `methodologyVersion` | `z.string()` | DISPLAY | overview methodology version tag |

### Health score

| field path | current type | bucket | notes |
|---|---|---|---|
| `healthMethodologyVersion` | `z.string().default('')` | DISPLAY | |
| `healthDimensions[].dimension` | `z.string()` | DISPLAY | one of 5: Attractiveness/Financial/Capability/Outcomes/Relevance |
| `healthDimensions[].score` | `z.string()` | NUMERIC | 0–100; `'—'` placeholder when `cell.score === null` |
| `healthDimensions[].dataCompleteness` | `z.string()` | NUMERIC | percentage |
| `healthDimensions[].topDriver` | `z.string()` | AMBIGUOUS | **compound**: `"TCAS fill rate (72)"` or `'—'`. Recommend splitting into `topDriverLabel` (DISPLAY) + `topDriverValue` (NUMERIC, nullable) |
| `healthDrivers[].dimension` | `z.string()` | DISPLAY | |
| `healthDrivers[].driver` | `z.string()` | DISPLAY | via `fmtDriverLabel` / `DRIVER_LABELS` map |
| `healthDrivers[].value` | `z.string()` | NUMERIC | `'—'` placeholder when `d.value === null` |

### Lifecycle

| field path | current type | bucket | notes |
|---|---|---|---|
| `lifecycle.verdict` | `z.string()` | DISPLAY | verdict label |
| `lifecycle.trajectoryScore` | `z.string()` | NUMERIC | 0–100 |
| `lifecycle.methodologyVersion` | `z.string()` | DISPLAY | |
| `lifecycle.generatedAt` | `z.string()` | DISPLAY | ISO date via `fmtDate` |
| `lifecycle.narrative` | `z.string().default('')` | DISPLAY | free-text narrative |
| `lifecycle.drivers[].direction` | `z.enum(['lifting','drag'])` | AMBIGUOUS | derived from `sign(contribution)`. Leans **DISPLAY** (kept as a convenience discriminator for icon/color), but flag as redundant once `contribution` is a real signed number — template can derive it |
| `lifecycle.drivers[].label` | `z.string()` | DISPLAY | via `fmtDriverPhrase` |
| `lifecycle.drivers[].contribution` | `z.string()` | NUMERIC | signed float, currently pre-formatted with an explicit `+` prefix (`"+3.2"` / `"-1.5"`) |

### Strategic narrative

| field path | current type | bucket | notes |
|---|---|---|---|
| `strategicNarrative.contentMarkdown` | `z.string()` | DISPLAY | long-form Thai-primary narrative markdown |
| `strategicNarrative.methodVersion` | `z.string()` | DISPLAY | |
| `strategicNarrative.confidencePct` | `z.string()` | NUMERIC | 0–100%, currently `"N%"` |
| `strategicNarrative.generatedAt` | `z.string()` | DISPLAY | ISO date |

### AI readiness

| field path | current type | bucket | notes |
|---|---|---|---|
| `aiReadiness.overallScore` | `z.string()` | NUMERIC | 0–100 |
| `aiReadiness.verdict` | `z.string()` | DISPLAY | e.g. "Strong AI readiness" |
| `aiReadiness.summary` | `z.string().default('')` | DISPLAY | free text |
| `aiReadiness.methodologyVersion` | `z.string()` | DISPLAY | |
| `aiReadiness.subScores[].metric` | `z.string()` (via `KvRowSchema`) | DISPLAY | 4 fixed rows: Curriculum integration / Skill resilience / AI research presence / Pedagogical readiness |
| `aiReadiness.subScores[].value` | `z.string()` (via `KvRowSchema`) | NUMERIC | **dangerous placeholder is the literal string `'no data'`, not `'—'`** — a distinct sentinel pattern the audit below must also cover |
| `aiReadiness.subScores[].notes` | `z.string().default('')` (via `KvRowSchema`) | AMBIGUOUS | mostly static descriptive text (DISPLAY); the "AI research presence" row embeds a raw fraction `"X/Y publications (3y)"` — the two numbers (`aiPublicationsLast3Years`, `totalPublicationsLast3Years`) already exist upstream and should be their own numeric fields instead of baked into prose |
| `aiReadiness.skillBreakdown[].category` | `z.string()` | DISPLAY | AI-native / AI-augmented / Neutral / AI-displaceable |
| `aiReadiness.skillBreakdown[].count` | `z.string()` | NUMERIC | |
| `aiReadiness.skillBreakdown[].share` | `z.string()` | NUMERIC | percentage |
| `aiReadiness.gaps[].topic` | `z.string()` | DISPLAY | |
| `aiReadiness.gaps[].severity` | `z.string()` | DISPLAY | categorical (HIGH/MEDIUM/LOW-ish) |
| `aiReadiness.gaps[].observation` | `z.string()` | DISPLAY | narrative |
| `aiReadiness.gaps[].peerReference` | `z.string().default('')` | DISPLAY | free text |
| `aiReadiness.recommendations[].priority` | `z.string()` | DISPLAY | categorical |
| `aiReadiness.recommendations[].title` | `z.string()` | DISPLAY | |
| `aiReadiness.recommendations[].detail` | `z.string()` | DISPLAY | narrative |
| `aiReadiness.recommendations[].effortHorizon` | `z.string()` | AMBIGUOUS | bucketed label ("< 12 months" / "12–24 months" / "24–36 months") derived from a 3-value enum (`short`/`medium`/`long`), not a raw number. Leans **DISPLAY** — converting to NUMERIC would require inventing an arbitrary midpoint value; better to pass the raw enum through and let the template define any numeric mapping it needs |

### Demand funnel

| field path | current type | bucket | notes |
|---|---|---|---|
| `demandFunnel.anchorEntryYearLabel` | `z.string()` | AMBIGUOUS | **compound**: `"BE 2564 (CE 2021)"` or `'—'`. Leans **NUMERIC** — split into `anchorEntryYearBE` + `anchorEntryYearCE` (both already exist upstream by those names) |
| `demandFunnel.cohortStatus` | `z.string()` | AMBIGUOUS | binary label (`'lifecycle complete'` / `'in-progress cohort'`) derived from a boolean (`cohortCompleted`). Leans **DISPLAY** as a label, but recommend also carrying the raw boolean so the template can badge it without string matching |
| `demandFunnel.programDurationYears` | `z.string()` | NUMERIC | `'—'` placeholder when null |
| `demandFunnel.methodologyVersion` | `z.string()` | DISPLAY | |
| `demandFunnel.stages[].stage` | `z.string()` | DISPLAY | funnel stage label |
| `demandFunnel.stages[].value` | `z.string()` | NUMERIC | **funnel-chart core input** — this is exactly what a chart-led funnel needs as a number, high priority |
| `demandFunnel.conversions[].from` | `z.string()` | DISPLAY | stage key |
| `demandFunnel.conversions[].to` | `z.string()` | DISPLAY | stage key |
| `demandFunnel.conversions[].rate` | `z.string()` | NUMERIC | `'—'` placeholder when null |
| `demandFunnel.alumniBreakdown[].bucket` | `z.string()` | DISPLAY | |
| `demandFunnel.alumniBreakdown[].count` | `z.string()` | NUMERIC | |
| `demandFunnel.alumniBreakdown[].share` | `z.string()` | NUMERIC | percentage |
| `demandFunnel.cohortTrend[].cohortBE` | `z.string()` | AMBIGUOUS | Buddhist-era year, `String(entryYearBE)`. Leans **NUMERIC** — this is the task brief's own worked example (year on a trend-chart x-axis) |
| `demandFunnel.cohortTrend[].admitted` | `z.string()` | NUMERIC | |
| `demandFunnel.cohortTrend[].enrolled` | `z.string()` | NUMERIC | |
| `demandFunnel.cohortTrend[].graduated` | `z.string()` | NUMERIC | |
| `demandFunnel.cohortTrend[].dropped` | `z.string()` | NUMERIC | |
| `demandFunnel.cohortTrend[].completed` | `z.string()` | AMBIGUOUS | `'complete'` / `'in progress'`, derived from per-row boolean `cohortCompleted`. Leans **DISPLAY**, same recommendation as `cohortStatus` above |

### Recruitment (TCAS rounds 1–4)

| field path | current type | bucket | notes |
|---|---|---|---|
| `recruitment.methodologyVersion` | `z.string()` | DISPLAY | |
| `recruitment.inProgressNote` | `z.string().default('')` | DISPLAY | free-text sentence, embeds a BE year but stays a sentence |
| `recruitment.byYear[].yearBE` | `z.string()` | AMBIGUOUS | `"BE 2567"`. Leans **NUMERIC** (axis year), same pattern as `cohortTrend.cohortBE` |
| `recruitment.byYear[].status` | `z.string()` | AMBIGUOUS | `'complete'`/`'in progress'`, derived from boolean `isComplete`. Leans **DISPLAY** |
| `recruitment.byYear[].planPerYear` | `z.string()` | NUMERIC | `'—'` placeholder when null |
| `recruitment.byYear[].seats` | `z.string()` | NUMERIC | |
| `recruitment.byYear[].overAllocation` | `z.string()` | AMBIGUOUS | currently `''` when `overAllocationFactor <= 1.05` (including when null!), else `"1.23×"`. Leans **NUMERIC** — this bakes a display threshold (">1.05 → show") into the data layer; recommend always emitting the raw ratio (nullable only for true missing data) and letting the template decide the highlight threshold. See correctness note below — `''` currently conflates "not meaningfully over 1.0" with "no data at all" |
| `recruitment.byYear[].applicants` | `z.string()` | NUMERIC | |
| `recruitment.byYear[].competition` | `z.string()` | NUMERIC | ratio; `'—'` placeholder when null |
| `recruitment.byYear[].passed` | `z.string()` | NUMERIC | |
| `recruitment.byYear[].confirmCh` | `z.string()` | NUMERIC | |
| `recruitment.byYear[].reported` | `z.string()` | NUMERIC | |
| `recruitment.byYear[].vsPlan` | `z.string()` | NUMERIC | percentage; `'—'` placeholder when `planPerYear` is null or 0 |
| `recruitment.latestRoundsYear` | `z.string().default('')` | AMBIGUOUS | `"BE 2567"` or `''`. Leans **NUMERIC** |
| `recruitment.latestRounds[].round` | `z.string()` | AMBIGUOUS | upstream `round` is a genuine **string** (`packages/db/src/program-recruitment.ts:20`) — TCAS round codes include sub-rounds like `"3.1"`/`"3.2"`, not just `"1".."4"`. Leans **DISPLAY** (categorical round code, not a clean integer) — do not naively cast to number |
| `recruitment.latestRounds[].seats` | `z.string()` | NUMERIC | `'—'` when null |
| `recruitment.latestRounds[].applicants` | `z.string()` | NUMERIC | `'—'` when null |
| `recruitment.latestRounds[].passed` | `z.string()` | NUMERIC | `'—'` when null |
| `recruitment.latestRounds[].confirmCh` | `z.string()` | NUMERIC | `'—'` when null |
| `recruitment.latestRounds[].reported` | `z.string()` | NUMERIC | `'—'` when null |

### TCAS (raw stats + peer comparison)

| field path | current type | bucket | notes |
|---|---|---|---|
| `tcas.history[].yearRound` | `z.string()` | AMBIGUOUS | **compound**: `"BE 2567 R2"`. Leans **NUMERIC** — split into `yearBE` + `round` (round stays DISPLAY per the note above, sub-rounds exist) |
| `tcas.history[].quota` | `z.string()` | NUMERIC | |
| `tcas.history[].applicants` | `z.string()` | NUMERIC | |
| `tcas.history[].competition` | `z.string()` | NUMERIC | ratio |
| `tcas.history[].fillRate` | `z.string()` | NUMERIC | percentage |
| `tcas.history[].minScore` | `z.string()` | NUMERIC | `'—'` when null |
| `tcas.history[].maxScore` | `z.string()` | NUMERIC | `'—'` when null |
| `tcas.peers[].match` | `z.string()` | DISPLAY | `matchTier` categorical label |
| `tcas.peers[].institution` | `z.string()` | DISPLAY | |
| `tcas.peers[].programme` | `z.string()` | DISPLAY | |
| `tcas.peers[].quota` | `z.string()` | NUMERIC | |
| `tcas.peers[].applicants` | `z.string()` | NUMERIC | |
| `tcas.peers[].competition` | `z.string()` | NUMERIC | ratio |
| `tcas.peers[].minScore` | `z.string()` | NUMERIC | `'—'` when null |
| `tcas.peerMatchKey` | `z.string().default('')` | DISPLAY | identifier/key, not plotted |

### Cohort distribution

| field path | current type | bucket | notes |
|---|---|---|---|
| `cohortDistribution.totalActive` | `z.string()` | NUMERIC | |
| `cohortDistribution.currentAcademicYearBE` | `z.string()` | AMBIGUOUS | plain `String(currentAcademicYearBE)`. Leans **NUMERIC** |
| `cohortDistribution.programDurationYears` | `z.string()` | NUMERIC | `'—'` when null |
| `cohortDistribution.summary[].metric` | `z.string()` (via `KvRowSchema`) | DISPLAY | 3 fixed rows: Incoming/On-track/Delayed |
| `cohortDistribution.summary[].value` | `z.string()` (via `KvRowSchema`) | NUMERIC | count |
| `cohortDistribution.summary[].notes` | `z.string().default('')` (via `KvRowSchema`) | AMBIGUOUS | compound text embedding a share percentage, e.g. `"12.3% · Year 0 (admitted before June 1)"`. Leans **DISPLAY** as a caption, but the embedded share is directly needed for a stacked-composition chart and should also exist as its own numeric field |
| `cohortDistribution.rows[].cohort` | `z.string()` | AMBIGUOUS | **compound**: `"BE 2567 (CE 2024)"`. Leans **NUMERIC** — same BE/CE split as `demandFunnel.anchorEntryYearLabel` |
| `cohortDistribution.rows[].yearInProgram` | `z.string()` | AMBIGUOUS | `"Year 0"` / `"Year N"` from raw int `yearInProgramme`. Leans **NUMERIC** — pass the raw int, let the template add the "Year " prefix |
| `cohortDistribution.rows[].status` | `z.string()` | DISPLAY | categorical: Incoming/On track/Delayed |
| `cohortDistribution.rows[].students` | `z.string()` | NUMERIC | |
| `cohortDistribution.rows[].share` | `z.string()` | NUMERIC | percentage |

### Demographic outlook

| field path | current type | bucket | notes |
|---|---|---|---|
| `demographic.catchment` | `z.string()` | DISPLAY | 'Northeast Thailand' / 'Thailand' |
| `demographic.ageCohort` | `z.string()` | DISPLAY | upstream is a fixed 2-value literal union (`'18-22' \| '23-29'`, `packages/db/src/program-deep-dive.ts:2365`) — a genuine categorical bucket, not a raw number |
| `demographic.source` | `z.string()` | DISPLAY | data source name |
| `demographic.baselineYearOneIntake` | `z.string()` | NUMERIC | `'—'` when null |
| `demographic.fifteenYearContraction` | `z.string()` | NUMERIC | percentage. **No null guard** in the builder (`` `−${demographic.fifteenYearContraction.toFixed(1)}%` ``, line 702) unlike every sibling field in this section — if the upstream value is ever null this throws rather than degrading to `'—'`. Worth confirming the source guarantees non-null before/while converting |
| `demographic.riskLevel` | `z.string()` | DISPLAY | uppercased categorical (LOW/MODERATE/HIGH/CRITICAL) |
| `demographic.projections[].year` | `z.string()` | AMBIGUOUS | `"2026 (today)"` on first row, `"2031"` after. Leans **NUMERIC** — split into `year` (NUMERIC) + `isCurrentYear` (boolean) |
| `demographic.projections[].cohortPopulation` | `z.string()` | NUMERIC | pre-divided by 1,000,000 and rounded to 2dp before stringifying (`"2.35M"`); recommend keeping the raw population count and letting the template format the "M" suffix |
| `demographic.projections[].decline` | `z.string()` | NUMERIC | **see correctness bug below** — the current formula collapses any non-positive decline (including real population *growth*) to the literal string `"0.0%"`, discarding the sign and magnitude |
| `demographic.projections[].shareNeeded` | `z.string()` | NUMERIC | `'—'` when null; fraction pre-multiplied ×100 to 3dp |

### Outcomes

| field path | current type | bucket | notes |
|---|---|---|---|
| `outcomes.surveyYear` | `z.string()` | AMBIGUOUS | plain `String(graduationYear)`. Leans **NUMERIC** |
| `outcomes.methodologyVersion` | `z.string()` | DISPLAY | |
| `outcomes.freshnessDate` | `z.string()` | DISPLAY | ISO date |
| `outcomes.sampleSize` | `z.string()` | NUMERIC | |
| `outcomes.summary[].metric` | `z.string()` (via `KvRowSchema`) | DISPLAY | 4 fixed rows |
| `outcomes.summary[].value` | `z.string()` (via `KvRowSchema`) | NUMERIC | all 4 concrete rows here are rate/salary/pct numbers |
| `outcomes.summary[].notes` | `z.string().default('')` (via `KvRowSchema`) | DISPLAY | static captions, no embedded numbers in this section |
| `outcomes.salaryTrajectory[].year` | `z.string()` | AMBIGUOUS | Leans **NUMERIC** — this is the textbook case: a salary-trend line chart needs `year` as a numeric x-axis |
| `outcomes.salaryTrajectory[].salary` | `z.string()` | NUMERIC | chart y-axis value, currently comma-formatted |
| `outcomes.topEmployers[].employer` | `z.string()` | DISPLAY | |
| `outcomes.topEmployers[].year` | `z.string()` | AMBIGUOUS | Leans **NUMERIC** |
| `outcomes.topEmployers[].satisfaction` | `z.string()` | NUMERIC | percentage |

### Skills

| field path | current type | bucket | notes |
|---|---|---|---|
| `skills.matchScore` | `z.string()` | NUMERIC | |
| `skills.demandSource` | `z.string()` | DISPLAY | source label (e.g. `kmitl-skill-mapping`) |
| `skills.demandTier` | `z.string()` | DISPLAY | categorical |
| `skills.careerFilterCount` | `z.string()` | NUMERIC | |
| `skills.totalTaught` | `z.string()` | NUMERIC | |
| `skills.ploCount` | `z.string()` | NUMERIC | |
| `skills.major[].skill` | `z.string()` | DISPLAY | skill name |
| `skills.major[].plo` | `z.string()` | AMBIGUOUS | **boolean mis-encoded as a string** — `'Yes'` or `''`. Neither NUMERIC nor prose DISPLAY; recommend `z.boolean()`, not a string of either kind |
| `skills.major[].compulsoryWeight` | `z.string()` | NUMERIC | 0–1 fraction to 2dp; `'—'` when null |
| `skills.major[].electiveWeight` | `z.string()` | NUMERIC | `'—'` when null |
| `skills.major[].evidence` | `z.string().default('')` | DISPLAY | verbatim quote excerpt, truncated with `…` |
| `skills.minor[].skill` | `z.string()` | DISPLAY | |
| `skills.minor[].electiveWeight` | `z.string()` | NUMERIC | `'—'` when null |
| `skills.demanded[].skill` | `z.string()` | DISPLAY | |
| `skills.demanded[].peakDemand` | `z.string()` | NUMERIC | percentage |
| `skills.demanded[].careerCount` | `z.string()` | NUMERIC | |
| `skills.demanded[].match` | `z.string()` | AMBIGUOUS | tri-state (`'taught'` / `'gap'` / `'—'`) formatted from `curriculumMatched: boolean \| null`. Recommend passing the raw `boolean \| null` through — **do not simplify to plain `boolean`**, the `'—'`/null state ("unknown match") is semantically distinct from `false` ("confirmed gap") and collapsing them would be exactly the "zero-looks-like-missing" failure mode this refactor exists to avoid, just on a boolean instead of a number |
| `skills.gaps[].skill` | `z.string()` | DISPLAY | |
| `skills.gaps[].peakDemand` | `z.string()` | NUMERIC | |
| `skills.gaps[].careerCount` | `z.string()` | NUMERIC | |

### Faculty

| field path | current type | bucket | notes |
|---|---|---|---|
| `faculty.rosterScope` | `z.string()` | DISPLAY | categorical (program/department/faculty roster) |
| `faculty.visibility` | `z.string()` | DISPLAY | role-gating status label |
| `faculty.kpis[].metric` | `z.string()` (via `KvRowSchema`) | DISPLAY | 5 fixed rows |
| `faculty.kpis[].value` | `z.string()` (via `KvRowSchema`) | AMBIGUOUS | 4 of 5 concrete rows are plain numbers (headcount/publications/age/pct). The 5th ("Senior share") is `"8/24 (33%)"` — three numbers compounded into one string. Leans **NUMERIC** with the senior-share row split into explicit `seniorCount` / `totalActive` / `seniorSharePct` fields rather than reusing the generic row |
| `faculty.kpis[].notes` | `z.string().default('')` (via `KvRowSchema`) | DISPLAY | mostly static text; one row carries a genuinely-narrative qualitative note ("healthy senior centre of gravity") derived from a threshold — fine as prose |
| `faculty.rankDistribution[].rank` | `z.string()` | DISPLAY | rank label |
| `faculty.rankDistribution[].count` | `z.string()` | NUMERIC | |
| `faculty.rankDistribution[].share` | `z.string()` | NUMERIC | percentage |
| `faculty.roster[].rank` | `z.string()` | DISPLAY | |
| `faculty.roster[].name` | `z.string()` | DISPLAY | `'—'` sentinel when both `nameEn`/`nameTh` are empty — should become `null`, not an em-dash string, even though the field stays DISPLAY |
| `faculty.roster[].specialization` | `z.string().default('')` | DISPLAY | free text |
| `faculty.roster[].retires` | `z.string().default('')` | DISPLAY | ISO date, `''` when no retirement date |

### Financials

| field path | current type | bucket | notes |
|---|---|---|---|
| `financials.methodologyVersion` | `z.string()` | DISPLAY | |
| `financials.headlineFiscalYear` | `z.string()` | AMBIGUOUS | Leans **NUMERIC**; `'—'` when null |
| `financials.partialCurrentYearNote` | `z.string().default('')` | DISPLAY | |
| `financials.kpis[].metric` | `z.string()` (via `KvRowSchema`) | DISPLAY | label; row 0's label embeds `financials.latestFiscalYear ?? '—'` inline — a placeholder baked into a heading string, flagged in the placeholder audit below even though the field itself is a label, not a value |
| `financials.kpis[].value` | `z.string()` (via `KvRowSchema`) | NUMERIC | **see correctness bug below** — "Government investment / student" row uses a truthy check (`financials.costPerStudent ? ... : '—'`) instead of a null check, so a legitimately-zero `costPerStudent` renders identically to missing data |
| `financials.kpis[].notes` | `z.string().default('')` (via `KvRowSchema`) | DISPLAY | static descriptive text |
| `financials.waterfall[].step` | `z.string()` | DISPLAY | waterfall step label |
| `financials.waterfall[].kind` | `z.string()` | DISPLAY | categorical (`'negative'`/`'positive'`/etc.) — drives sign/color |
| `financials.waterfall[].value` | `z.string()` | NUMERIC | **waterfall-chart core input** — currently pre-signed with a literal `−` prefix baked into the string; recommend a raw signed number and let `kind` drive the display sign/color, same as `demandFunnel.stages[].value` |
| `financials.sensitivity` | `z.string().default('')` | AMBIGUOUS | full narrative sentence embedding two numbers ("...net contribution becomes X THB (revenue Y THB)"). Leans **DISPLAY** as a sentence, but the two numbers (`tuitionPlus5Pct.netContribution`, `tuitionPlus5Pct.tuitionRevenue`) already exist upstream and should be separate numeric fields if this ever becomes a chart (tornado/sensitivity) rather than a sentence |
| `financials.trend[].year` | `z.string()` | AMBIGUOUS | Leans **NUMERIC** — trend-chart x-axis |
| `financials.trend[].tuition` | `z.string()` | NUMERIC | `'—'` when null |
| `financials.trend[].subsidy` | `z.string()` | NUMERIC | `'—'` when null |
| `financials.trend[].net` | `z.string()` | NUMERIC | `'—'` when null |

### Peers

| field path | current type | bucket | notes |
|---|---|---|---|
| `peers.subjectSignature` | `z.string().default('')` | DISPLAY | |
| `peers.rankingYear` | `z.string().default('')` | AMBIGUOUS | Leans **NUMERIC** |
| `peers.tiers[].tier` | `z.string()` | DISPLAY | tier label ("World tier" etc.) |
| `peers.tiers[].entries[].rank` | `z.string()` | NUMERIC | rank-in-tier position |
| `peers.tiers[].entries[].institution` | `z.string()` | DISPLAY | |
| `peers.tiers[].entries[].country` | `z.string()` | DISPLAY | |
| `peers.tiers[].entries[].qsWorld` | `z.string()` | NUMERIC | `'—'` when null |
| `peers.tiers[].entries[].programme` | `z.string()` | DISPLAY | |
| `peers.aiReview.confidencePct` | `z.string()` | NUMERIC | percentage |
| `peers.aiReview.strengths[].claim` | `z.string()` | DISPLAY | narrative claim |
| `peers.aiReview.weaknesses[].claim` | `z.string()` | DISPLAY | narrative claim |
| `peers.aiReview.contentModernity.verdict` | `z.string()` | DISPLAY | categorical, underscore-replaced |
| `peers.aiReview.contentModernity.narrative` | `z.string()` | DISPLAY | free text |
| `peers.aiReview.summary` | `z.string().default('')` | DISPLAY | free text |
| `peers.curatedPeers[].institution` | `z.string()` | DISPLAY | |
| `peers.curatedPeers[].country` | `z.string()` | DISPLAY | |
| `peers.curatedPeers[].programName` | `z.string()` | DISPLAY | |
| `peers.curatedPeers[].ranking` | `z.string()` | NUMERIC | `'—'` when null |

### Trends

| field path | current type | bucket | notes |
|---|---|---|---|
| `trends[].title` | `z.string()` | DISPLAY | |
| `trends[].type` | `z.string()` | DISPLAY | signal-kind label via `SIGNAL_KIND_LABEL` |
| `trends[].targeted` | `z.string()` | AMBIGUOUS | binary label ('Targets this program'/'Sector-wide') derived from boolean `isTargetedAtProgram`. Leans **DISPLAY**, recommend also carrying the raw boolean |
| `trends[].impact` | `z.string()` | AMBIGUOUS | **compound**: `"72 (High)"` — `impactScore*100` plus a bucketed word. Leans **NUMERIC** — split into `impactScorePct` (NUMERIC) + `impactBucket` (DISPLAY) |
| `trends[].recommendation` | `z.string()` | DISPLAY | computed label (Take action/Monitor/Ignore for now) |
| `trends[].detected` | `z.string()` | DISPLAY | ISO date |
| `trends[].rationale` | `z.string().default('')` | DISPLAY | narrative |
| `trends[].summary` | `z.string().default('')` | DISPLAY | narrative, bilingual EN/TH fallback |

### Decisions

| field path | current type | bucket | notes |
|---|---|---|---|
| `decisions[].decisionType` | `z.string()` | DISPLAY | categorical, underscore-replaced |
| `decisions[].status` | `z.string()` | DISPLAY | categorical |
| `decisions[].decidedBy` | `z.string()` | DISPLAY | name/role |
| `decisions[].createdAt` | `z.string()` | DISPLAY | ISO date |
| `decisions[].effectiveDate` | `z.string().default('')` | DISPLAY | ISO date, `''` when absent |
| `decisions[].rationale` | `z.string().default('')` | DISPLAY | narrative, bilingual fallback |

### Courses (already the correct pattern — reference example)

This block was added in v1.2.9 and is the one part of the schema already built the way the
rest of the schema should look: raw `z.number()` / `z.number().nullable()`, no pre-formatting.
It is included for completeness and as a positive reference, not because it needs conversion.

| field path | current type | bucket | notes |
|---|---|---|---|
| `courses.methodVersion` | `z.string()` | DISPLAY | |
| `courses.total` | `z.number()` | NUMERIC | already correct |
| `courses.extractedCount` | `z.number()` | NUMERIC | already correct |
| `courses.rows[].courseCode` | `z.string()` | DISPLAY | identifier |
| `courses.rows[].courseNameTh` | `z.string().default('')` | DISPLAY | |
| `courses.rows[].courseNameEn` | `z.string().default('')` | DISPLAY | |
| `courses.rows[].credits` | `z.number().nullable()` | NUMERIC | already correct — good nullable pattern to copy elsewhere |
| `courses.rows[].classCount` | `z.number()` | NUMERIC | already correct |
| `courses.rows[].gradedCount` | `z.number()` | NUMERIC | already correct |
| `courses.rows[].classGpa` | `z.number()` | NUMERIC | already correct type, but **not `.nullable()`** unlike its sibling `credits` — worth confirming a course with `gradedCount === 0` can't legitimately need a null GPA here (0 GPA vs no-data-yet is exactly the ambiguity this whole refactor is trying to eliminate) |
| `courses.rows[].byYear{}.classCount` | `z.number()` | NUMERIC | already correct |
| `courses.rows[].byYear{}.gradedCount` | `z.number()` | NUMERIC | already correct |
| `courses.rows[].byYear{}.averageClassGpa` | `z.number().nullable()` | NUMERIC | already correct |
| `courses.yearsObserved` | `z.array(z.number())` | NUMERIC | already correct |
| `courses.windowYearsBE.start` | `z.number().nullable()` | NUMERIC | already correct |
| `courses.windowYearsBE.end` | `z.number().nullable()` | NUMERIC | already correct |
| `courses.semestersApplied` | `z.array(z.number())` | NUMERIC | already correct |

---

## Placeholder-emitting fields — the dangerous ones

Every field below currently emits `'—'` (or the `'no data'` variant, or a blank-string
variant that behaves the same way) from `apps/api/src/programs/program-detail-data.ts` when
the underlying value is missing. **Every one of these must become `null` in the numeric
refactor, never `0`.** A `0` asserts a measured value of zero; this document exists because
that distinction decides whether a program looks like it's failing when the truth is "we
don't have the data yet."

Grouped by the shared helper or literal that produces the sentinel:

**Via `fmtNum` / `fmtPct` / `fmtRatePct` / `fmtDate` (return `'—'` on `null`/`undefined`/`NaN`)**
— used pervasively; every call site listed as NUMERIC above that is also annotated
`'—' when null` in the table is one of these. Converting the four `fmt*` helpers themselves
is the mechanical fix for most of the list; the risk is entirely in the ~20 call sites that
DON'T go through a shared helper (listed below) because each one is a bespoke ternary that has
to be individually checked for a `!== null` vs truthy mistake.

**Bespoke inline `=== null ? '—' : ...` / `!== null ? ... : '—'` ternaries (correctly guard
against `null`, safe pattern, just needs the string cast dropped):**
- `healthDimensions[].score`, `healthDimensions[].topDriver`, `healthDrivers[].value`
- `demandFunnel.anchorEntryYearLabel`, `demandFunnel.programDurationYears`, `demandFunnel.conversions[].rate`
- `recruitment.byYear[].planPerYear`, `.competition`, `.vsPlan`; `recruitment.latestRounds[].seats/applicants/passed/confirmCh/reported`
- `tcas.history[].minScore/maxScore`; `tcas.peers[].minScore`
- `cohortDistribution.programDurationYears`
- `demographic.baselineYearOneIntake`, `demographic.projections[].shareNeeded`
- `skills.major[].compulsoryWeight/electiveWeight`, `skills.minor[].electiveWeight`
- `financials.headlineFiscalYear`, `financials.trend[].tuition/subsidy/net`
- `peers.tiers[].entries[].qsWorld`, `peers.curatedPeers[].ranking`

**Bespoke *truthy*-check ternaries — these are the ones that need extra care, because a
truthy check treats a legitimate `0` the same as `null`:**
- `financials.kpis[].value` for "Government investment / student"
  (`financials.costPerStudent ? ... : '—'`, line 934). **If `costPerStudent` is ever
  legitimately `0`, today's PDF already shows `'—'` instead of `0` — the numeric refactor must
  fix this to `!== null` while converting, not just carry the bug forward as `null` vs `0`
  looking the same on the string side.**

**`'no data'` sentinel (distinct string from `'—'`, same hazard, different literal) — all
four rows of `aiReadiness.subScores[].value`** (Curriculum integration / Skill resilience / AI
research presence / Pedagogical readiness), each independently checking
`=== null ? 'no data' : ...toFixed(0)`.

**Other missing-data encodings that are NOT the `'—'` glyph but carry the same risk and must
also become `null`, not empty/zero:**
- `cover.departmentTh` / `cover.departmentEn` / `cover.yearEstablished` → `''` when absent
- `lifecycle.narrative`, `aiReadiness.summary`, `aiReadiness.gaps[].peerReference`,
  `financials.partialCurrentYearNote`, `tcas.peerMatchKey`, `skills.major[].plo`,
  `skills.major[].evidence` (partial), `faculty.roster[].specialization/retires`,
  `peers.subjectSignature`, `peers.rankingYear`, `decisions[].effectiveDate` → `''` defaults;
  these stay DISPLAY strings so `''` vs `null` is lower-stakes, but should still prefer
  `null` for consistency once the schema is touched anyway
- `recruitment.byYear[].overAllocation` → `''` for **both** "factor ≤ 1.05" and "factor is
  null" — these are two different real-world situations (measured-but-unremarkable vs
  unmeasured) currently indistinguishable in the output. Flagged above as needing a genuine
  nullable NUMERIC field, not just a placeholder swap
- `faculty.roster[].name` → `'—'` fallback text (line 891, `m.nameEn || m.nameTh || '—'`) —
  DISPLAY field, but the sentinel should still become `null` rather than an em-dash string

## Correctness bugs found in passing (not in scope to fix here, but the refactor must not carry them forward silently)

1. **`demographic.projections[].decline` collapses growth into `"0.0%"`.**
   `p.cohortDeclinePct > 0 ? \`−${p.cohortDeclinePct.toFixed(1)}%\` : '0.0%'` (line 707) — any
   `cohortDeclinePct <= 0` (i.e. the cohort is flat *or growing*) renders as the identical
   literal `"0.0%"`. A real negative decline (population growth) and an exact zero are
   currently indistinguishable in the PDF. When this becomes a raw numeric `decline` field,
   the sign must be preserved (positive = growth, negative = decline, or vice versa —
   whichever convention the chart adopts, just not "any non-decline becomes exactly zero").

2. **`financials.kpis[].value` (Government investment / student) uses a truthy check, not a
   null check** — see placeholder section above. Converting the schema field to
   `z.number().nullable()` is the natural moment to fix `costPerStudent ? … : '—'` to
   `costPerStudent !== null ? … : null`.

3. **`demographic.fifteenYearContraction` has no null guard at all**, unlike every sibling
   field in the same section — if the upstream value is ever null, current code throws
   (`Cannot read properties of null / .toFixed`) rather than degrading gracefully. Not
   necessarily a live bug (upstream may guarantee non-null today) but worth a `?? null` guard
   while the field is being touched regardless.

## Fields I could not confidently classify — argue both ways

Most of the 32 AMBIGUOUS rows are one of two repeating patterns and I've stated a leaning
against each individually in the table above (Buddhist-era-year-in-a-compound-label → leans
NUMERIC; boolean-derived-status-label → leans DISPLAY). The ones below are the genuinely
harder judgment calls where the leaning is less clear-cut and a human should weigh in
specifically:

1. **`skills.demanded[].match`** (`'taught'` / `'gap'` / `'—'`, from `boolean | null`
   upstream). Argument for keeping as a formatted DISPLAY string: the template currently
   renders it as a text cell in a table and the three states map naturally to three words.
   Argument for `boolean | null` passthrough: if the chart-led rebuild wants to show this as a
   colored dot/icon matrix (skill × demanded, taught/gap/unknown), a raw tri-state is strictly
   more useful and the three-way `true/false/null` semantics is exactly what a Council-facing
   "we don't know yet" indicator needs, distinct from "confirmed not taught." I lean toward
   passthrough but flag this as the one place in the schema where collapsing a tri-state to a
   binary would be a genuine information-loss regression, so whoever does the conversion should
   deliberately choose the target shape rather than defaulting to the nearest string/number
   flip.

2. **`faculty.kpis[].value`** for the "Senior share" row (`"8/24 (33%)"`). Argument for
   leaving the whole `KvRowSchema` reuse alone and just widening `value` to
   `z.union([z.number(), z.string()]).nullable()`: minimizes the blast radius of the refactor,
   since 4 of 5 rows in this array are cleanly numeric today. Argument for splitting this one
   row out of the generic KPI list entirely into named fields
   (`faculty.seniorCount`/`faculty.totalActive`/`faculty.seniorSharePct`, with
   `totalActive` already existing as its own top-level KPI row): the compound string is the
   single clearest example in the whole schema of a chart-blocking value, and a generic `KvRow`
   union type doesn't actually solve the chart problem, it just moves the parsing burden into
   the template. I lean toward the split, but this is a genuine judgment call about how much of
   the `KvRowSchema` polymorphism to unwind in one pass versus deferring to a later cleanup.

3. **`demographic.ageCohort`** — classified DISPLAY above (confirmed as a fixed 2-value
   literal union `'18-22' | '23-29'` upstream, `packages/db/src/program-deep-dive.ts:2365`),
   but flagging the reasoning explicitly: it superficially looks like a numeric range that
   "should" be two numbers (`ageMin`/`ageMax`), and if a future chart wants an age-bracket axis
   that split would be more useful than the current label. I did not mark this AMBIGUOUS
   because the upstream type is genuinely a closed 2-value enum today, not a raw range — but
   if the demographic model ever grows more cohort buckets, revisit.

4. **The six `KvRowSchema` reuse sites as a whole** (`executiveSnapshot`,
   `aiReadiness.subScores`, `cohortDistribution.summary`, `outcomes.summary`, `faculty.kpis`,
   `financials.kpis`). I classified each concrete `.value` field per its dominant use (mostly
   NUMERIC), but the schema-level question — "should `KvRowSchema` itself be split into
   separate typed row-schemas per section, or kept generic with a union value type" — is a
   design decision for whoever does the conversion, not something this inventory can resolve
   on its own. I've flagged it as the "Structural finding" at the top of this document because
   it affects the shape of the fix more than any individual field does.

## Anything else that will make the conversion harder than the plan assumes

- **The `'—'`/`'no data'` sentinels are not uniform.** Two different literal strings
  (`'—'` and `'no data'`) currently signal "missing," plus several bare-`''` defaults that mean
  the same thing on DISPLAY fields, plus at least one truthy-check bug that treats a real `0`
  the same as missing. A mechanical find-and-replace of `'—'` will miss the `'no data'` rows in
  `aiReadiness.subScores` and will not fix the `costPerStudent` truthy-check bug on its own.
- **Six sections reuse one polymorphic `KvRowSchema`** with genuinely different semantics per
  use site (see "Structural finding" above) — this is the part of the task most likely to be
  underestimated if approached as "just retype `value` to a number," because one of the six
  reuse sites (`faculty.kpis`) has a row that is not representable as a single number at all
  without restructuring.
- **At least seven fields are compound strings packing 2–3 numbers (or a number + a label)
  into one cell**: `healthDimensions[].topDriver`, `demandFunnel.anchorEntryYearLabel`,
  `cohortDistribution.rows[].cohort`, `tcas.history[].yearRound`, `financials.sensitivity`,
  `trends[].impact`, `faculty.kpis[].value` (senior-share row). Each of these needs a genuine
  schema-shape decision (split into N fields), not a type flip — they can't become a single
  `z.number()` without dropping information the current string encodes.
- **A handful of fields are booleans wearing string clothes**
  (`skills.major[].plo`: `'Yes'`/`''`) or booleans-formatted-as-a-label
  (`demandFunnel.cohortStatus`, `demandFunnel.cohortTrend[].completed`,
  `recruitment.byYear[].status`, `trends[].targeted`) — these aren't part of the "204 strings
  that are secretly numbers" story at all, and a reviewer scanning only for
  `z.string() → z.number()` conversions will walk right past them even though they're exactly
  as chart-blocking as the numeric ones (you can't bind a boolean-as-label string to a
  status-icon component without string matching either).
- **TCAS `round` is a genuine string, not a lightly-formatted number** — it's tempting to
  treat every year/round-shaped field the same way as the Buddhist-era-year pattern, but TCAS
  round codes include sub-rounds like `"3.1"`/`"3.2"` upstream, so `round` alone should stay
  DISPLAY even though the *year* half of the same compound field (`yearRound`) should become
  NUMERIC. This is a trap for anyone pattern-matching on "field name contains 'year' or
  'round'."

---

**Status:** DONE
**Commit:** see the corresponding `docs: inventory...` commit for the SHA.
