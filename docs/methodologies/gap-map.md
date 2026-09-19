# Gap map — `gap-map.v1`

| Version | Date | Change |
|---|---|---|
| `gap-map.v1` | 2026-09-19 | First version. Replaces `gap-analysis.v1` (skill-level demand − supply) and `gap-lenses.v1` (seven lenses + a composite gap index) on `/gap-analysis`. |

**On the version constant.** `GAP_MAP_VERSION` was deliberately **not** bumped
while this methodology was being built, although the supply rule and the
rising-skills pick both changed during construction (2026-09-16 and
2026-09-19). The repo's rule is that a version identifies the formula a
*published* figure was computed under. The map has never shipped, no figure
has reached a reader under the earlier behaviour, and nothing persists a
stamped row — the map is a read-time computation cached for five minutes. So
`gap-map.v1` is still being *defined*, not revised. **The first change to any
rule on this page after v1.9.7 ships does bump it.**

---

## 1. Summary — what it answers

Strategic questions 3 and 5: starting from **demand**, which parts of the
labour market does KKU's portfolio fail to serve, over-serve, or serve with
the wrong programmes.

The unit is a **field of study** — what an employer says a graduate should
hold — because JobThai adverts state it directly and with counts, which no
other source we have does. 40.7 % of JobThai postings name at least one field.

Consumed by: `/gap-analysis` (the whole page), the AI Analyst's `query_gaps`
tool, Decision Workspace snapshots, and the `gap-brief.v1` Council brief.

Code: `packages/db/src/gap-map.ts` (the query), `packages/db/src/gap-map-rules.ts`
(the pure rules), `packages/db/src/gap-map-signals.ts` ("what's coming").

---

## 2. The row

One row per canonical field in `job_field_taxonomy` whose `reviewStatus` is
`APPROVED` or `PROPOSED`. `REJECTED` rows are invisible everywhere.

| Column | Definition |
|---|---|
| **Demand share** | eligible adverts naming any of the field's synonyms ÷ **field-mentions** (§3) |
| **KKU share** | graduates/yr of the field's *scored* programmes ÷ **field-graduates** (§3) |
| **Ratio** | KKU share ÷ demand share, rounded to two decimals |
| **Grads / yr** | §5 |
| **Pipeline** | current enrolment summed from `student_cohort_distributions` (`realDataWhere()`-gated). Arrow ↑ when pipeline ÷ 4 > 1.25 × grads/yr, ↓ when < 0.75 ×, → otherwise, and absent when either side is missing |
| **Verdict** | §4 |
| **Postings** | the raw distinct-advert count for the field — what the *too-few-postings* floor reads and what the table displays |

**Eligible** adverts are those whose minimum education level admits a
bachelor's graduate: `eligiblePostingLevels('BACHELOR')` = `VOCATIONAL_CERT`,
`HIGHER_VOCATIONAL_CERT`, `BACHELOR`. `UNSPECIFIED` is never eligible
(14,283 adverts on 2026-09-15). Of 47,631 JobThai adverts, 33,307 are
bachelor-eligible.

**Postgraduate programmes are listed inside a row with their graduates but
are never scored.** Only **41 of 47,631** adverts state a postgraduate
minimum, so any verdict on a master's or doctoral programme would have been
built from undergraduate adverts. This is the same honest-signal gate
`health-score.v5.2` applies to the `jobthai_demand_alignment` driver.

---

## 3. Why shares, and how each side is normalised

### Shares, not a difference

`gap-analysis.v1` compared a sum of posting-weight *percentages* (2,469 at
university scope) with *graduates per year* (157,356) and called the
difference a gap. The two quantities have no common unit, so nearly
everything read as oversupply. Shares put both sides on the same scale.

Shares also absorb JobThai's national, Bangkok-weighted volume: 37 % of
adverts are Bangkok and 3.3 % are the 20 Northeast provinces (Khon Kaen: 304).
A field's *share* of adverts is comparable across fields even though the
absolute count is not a KKU-region figure. That is exactly why the province
breakdown is shown inside every row — so the reader can see how national a
given field's demand is before acting on it.

### The denominators

Both sides are normalised by **the sum over fields of their own numerators**,
not by a count of distinct postings or distinct programmes:

- **field-mentions** = Σ_f (eligible adverts naming field *f*). An advert
  naming *k* fields counts *k* times, because it is genuine demand for each
  of them.
- **field-graduates** = Σ_f (graduates/yr of *f*'s scored programmes). A
  programme assigned to two fields counts in both, for the same reason.

This matters and it was got wrong first. Measured on dev: **4,654 of 17,077**
field-naming eligible adverts name more than one field. With a
distinct-posting denominator the demand shares summed to **1.40**, not 1 —
every share was silently deflated, and by a different amount per field. With
field-mentions, each share set sums to 1 and the ratio carries no bias from
multi-assignment.

The cost of the rule is that the same advert and the same programme can be
counted more than once across the table. The reconciliation line under the
table states how many (§6).

---

## 4. Verdicts

Six, in the order the rule tests them (`verdictFor` in `gap-map-rules.ts`):

| Verdict | Condition | Meaning |
|---|---|---|
| **white space** | the field has **no scored programme** | employers ask; KKU produces nobody |
| **supply-unknown** | it has scored programmes but **none carries a graduate figure** | a **missing measurement**, never a shortfall |
| **too few postings** | fewer than `JOBTHAI_MIN_POSTINGS_FOR_SIGNAL` (**20**) adverts, or no demand share at all | the demand side is too thin to read |
| **under-served** | ratio < `under` | KKU's share of graduates is small against the market's share of adverts |
| **over-served** | ratio > `over` | the reverse |
| **served** | otherwise | |

Thresholds default to `under` **0.5** and `over` **2**. Both are URL
parameters (`?under=…&over=…`), validated as `0 < under < over`, and echoed in
the provenance drawer — an analyst can tighten them for one review without a
code change, and the link they share carries the thresholds they used.

**`supply-unknown` is the verdict this methodology adds to the five the
design foresaw, and it is load-bearing.** It fires on the *count of scored
programmes carrying a figure*, not on their sum. Reading a field with
programmes-but-no-numbers as a 0 ratio would have called it under-served —
presenting a registrar data gap to Council as a production shortfall. It is
the same null-handling rule `health-score` uses: a missing metric is excluded,
never substituted with 0. A *partial* gap (2 of 3 programmes measured) still
gets a normal verdict; the row states `programmesWithSupply` so the reader
can see the basis.

---

## 5. The supply rule — graduates per year

> **This rule was rewritten on 2026-09-19 (commit `356c2f0`) because the
> version the plan specified had been copied verbatim out of the
> `computeSkillGap` it was replacing, and was wrong there too.** It under-
> reported graduates by roughly 60 %. The rule below is what ships; the fault
> is recorded because any earlier figure a reader remembers is not comparable.

### As it now is

**Primary — registrar alumni cohorts** (`alumni_cohort_statuses`, `realDataWhere()`-gated):

1. The five-cohort window is anchored on **graduation**: `max_be` is taken
   over `status_bucket = 'GRADUATED'` rows only, and the window is
   `[max_be − 5, max_be]`.
2. A cohort is counted **only once it could have graduated**:
   `entry_year_be + durationYears <= currentAcademicYearBE`, with
   `durationYears` from the programme (4 where null — 16 of 301 programmes).
3. The divisor is **the number of cohorts actually averaged**, not a
   hard-coded 5.

**Fallback — `enrollment_metrics.graduated_on_time`**, taking the newest
academic year with a **non-zero** value, also `realDataWhere()`-gated.

Each programme reports which of the two it used (`supplySource`:
`alumni` | `enrolment-proxy` | `null`).

### The two faults, and what they cost

**(a) The window was anchored on enrolment.** `max_be` was taken over *all*
status buckets, including currently-ACTIVE entrants, so a "five cohort"
window spanned six *entry* cohorts of which only two had substantially
graduated — and was then divided by a hard-coded 5.0. Counting four cohorts
and dividing by five under-reports by a fifth on its own.

**(b) The proxy read the newest academic year, which is unfinished.** AY 2026
reads 0 for 226 programmes, and a non-null 0 passes the "has a figure" test —
so 24 of 94 "measured" programmes contributed a zero that was never measured,
and `supply-unknown` never caught them. (AY 2025 and 2024 are all-zero too,
which is why excluding only the *current* year would still have handed 33
programmes a false zero: the rule takes the newest **non-zero** year instead.)

### Measured effect on dev, 2026-09-19

| | Before | After |
|---|---|---|
| `fieldGraduatesTotal` | 2,682 /yr | **7,050 /yr** |
| Programmes reading a false zero | 24 | **0** |
| Fields verdicted *under-served* | 18 | **10** |
| Fields verdicted *supply-unknown* | 1 | **4** |
| Electrical Engineering | 23 /yr, pipeline *rising* | **63.25 /yr, pipeline *flat*** |

**Independent check:** the alumni component reads 6,095/yr against 5,953 when
recomputed by hand over five complete cohorts — **2.4 % apart**.

### The proxy's weight

**14 programmes — 955 graduates/yr, 13.5 % of the total — rest on the
enrolment-metric fallback**, i.e. a single year's raw count standing in for a
mean, drawn from AY 2022–2024. This is visible per programme in the row panel
and counted in `reconciliation.supplyFromProxy`. It is the largest single
piece of softness in the supply side.

### OPEN DECISION — cohort completeness

A cohort is admitted as soon as `entry_year + durationYears <= current
academic year`. On dev the newest admitted cohort (BE 2565) reads **29**
graduates against ~40 for its neighbours, because late graduations are still
accruing against it — so the mean is dragged down a few per cent. A stricter
rule ("complete only at `duration + 1`") would exclude it and raise every
figure slightly.

**This was not changed unilaterally. The methodology owner decides, and the
decision belongs in this section.** Until then, read every graduates-per-year
figure as a mild *under*-statement.

---

## 6. Reconciliation

The line under the table exists so a reader can check the shares add up
rather than take them on trust. It carries:

| Field | Meaning |
|---|---|
| `eligiblePostings` | bachelor-eligible adverts in scope of the map |
| `fieldPostings` | **distinct** eligible adverts naming at least one canonical field |
| `fieldMentions` | Σ_f postings_f — the demand denominator (≥ `fieldPostings`) |
| `multiFieldPostings` | adverts naming ≥ 2 canonical fields (4,654 of 17,077 on dev) |
| `anyFieldPostings` | adverts carrying the `*ANY*` (ทุกสาขา) sentinel — reported as its own line, assigned to nothing |
| `otherKinds` / `otherMentions` | raw strings below the taxonomy floor: counted in the "other" bucket, never assigned |
| `postgraduatePostings` | adverts stating a postgraduate minimum (41) |
| `demandShareSum` / `supplyShareSum` | both must be 1 by construction; printed as the check |
| `fieldGraduatesTotal` | the supply denominator, Σ_f grads_f |
| `multiFieldProgrammes` | scored programmes assigned to more than one field |
| `scoredProgrammes` / `scoredWithSupply` / `supplyFromProxy` | coverage of the supply side: how many programmes are scored, how many carry a figure at all, and how many of those came from the proxy |

The last triple is the honest coverage statement for the whole table. It is
the first thing to read before quoting any KKU share.

---

## 7. The taxonomy

Two additive tables, built by `pnpm jobthai:fields` and at the end of every
JobThai batch refresh.

### Clustering

Raw `job_postings.required_fields_raw` strings with **≥ 5 mentions**
(`JOB_FIELD_MENTION_FLOOR`; **518 of 3,854** distinct strings cleared it on
2026-09-15) are clustered by `job-field-taxonomy.v1` into canonical fields
with Thai and English names. Each field absorbs its raw strings as
**synonyms**, and a raw string belongs to at most one field — enforced in
`packages/db/src/job-fields.ts`, because Postgres cannot express it.

Strings **below the floor** are the **other** bucket: counted in the
denominators of the reconciliation line, never assigned to a field.
`*ANY*` (ทุกสาขา — "any field", 2,566 adverts) is reported as its own line
and assigned to nothing.

Batches are 200 strings; new fields from one batch become **anchors** for the
next, which is what stops a discipline being created twice across batches.

### Programme assignment

Three sources, applied in this order, recorded per assignment:

1. `rule` — the name-match rule the JobThai bridge already uses
   (`matchFieldToProgramme`). A synonym matching more than
   `MAX_PROGRAMMES_PER_FIELD` (**15**) programmes is generic vocabulary and
   creates no assignment.
2. `ai` — `program-job-field.v1`, **≤ 3 fields per programme**, only for the
   programmes the rule did not place. An empty list is a valid answer.
3. `manual` — by hand at `/admin/job-fields`.

### Review states

`PROPOSED` → shown on the map at once, **labelled unreviewed**, and counted in
the provenance drawer. `APPROVED` → reviewed. `REJECTED` → invisible
everywhere, and never re-created: the build step never renames, downgrades or
strips synonyms from an `APPROVED` or `REJECTED` row.

Every write stamps the latest SUCCEEDED JobThai `ingestionRunId`, so the rows
pass `realDataWhere()` (the trap that has silently hidden three other row
families in this repo).

### Known limitations of the taxonomy step

- **Abstained strings are re-sent on every batch refresh, forever.**
  `planTaxonomyBatches` skips a string only once it is some field's synonym.
  A string the model puts in `unassigned` never becomes one, so all ~127 of
  them are re-clustered after every JobThai upload (≈ $0.17 of model calls per
  refresh). Bounded and upload-triggered, not continuous. **Fixing it needs a
  persisted "declined raw string" ledger — not yet built.**
- **`JobFieldTaxonomy.nameEn` carries no unique constraint** (only `slug`
  does), and AI-proposed rows are deduped by slug alone, so two fields with
  the same English name are a normal pre-merge state. The Council brief
  handles this by **dropping** a finding whose field name is ambiguous (§9),
  but any other consumer keying off `nameEn` inherits the ambiguity.
  **OPEN:** whether `renameJobField` should refuse a duplicate English name or
  only warn. A blanket table constraint is wrong — `PROPOSED` duplicates must
  stay tolerable until an admin merges them.
- **A model outage does not fail the batch.** The connector logs
  `fields: FAILED — <reason> (run pnpm jobthai:fields --apply to retry)` and
  the JobThai run still succeeds. Batches already committed in the failed run
  stay committed; a retry continues from where it stopped rather than
  duplicating.

---

## 8. Scope

Faculty and department scope restrict **supply** to that unit's programmes
and add a **KKU-total column** to every row, so a faculty view cannot show a
false white space — a field the Faculty of Engineering does not serve but the
university does is visibly that, not a portfolio gap.

Programme scope has no gap map: a single programme is a Deep-Dive.
`/gap-analysis?scope=program` is refused by the API rather than silently
widened, and a `PROGRAM_USER`'s clamp lands there.

---

## 9. "What's coming" inside a row

Two independent paths. Neither invents a career→field mapping.

### (a) Rising skills — LinkedIn data via MHESI

The field's occupations → `jobthai_occupation_skills` at ≥ **5 %** posting
share, generic skills removed → intersected with `kmitl_skill_growths` →
**top three by growth**, each labelled "LinkedIn data via MHESI".

Two rules that are defensibility, not convenience:

1. **Newest capture only.** `kmitl_skill_growths` *accumulates* captures: its
   unique key is `(contextLevel, contextId, skillNameRaw, dataScope)` with no
   `snapshotAt`, and the raw skill-name string drifts between runs, so an
   older capture's rows are never superseded. Dev held 16,795 rows across two
   captures (2026-07-20 and 2026-09-14); reading across both let July's figure
   be quoted as today's — "Digital marketing" returned **600 %** when the
   current capture's figure for the same skill was **279.41 %**. A skill absent
   from the newest capture is stale and is not quoted at all.
2. **Mean across contexts, not max.** A skill appears once per KMITL context
   that demands it (median 3, p90 12, max 181 on dev). Taking the highest was
   cherry-picking the single most flattering career bucket. Each figure
   carries **the number of contexts it was averaged over** so the reader can
   judge it.

> **DATA FINDING, and it is a source problem, not a code problem.** *The
> newest KMITL capture carries **no Thailand rows at all**.* Of rows with a
> resolved skill: 2026-07-20 = 895 Thailand + 5,644 global; **2026-09-14 = 0
> Thailand + 10,256 global**. Before the newest-capture rule the map reached
> back into July and labelled **55 of 71** fields "Thailand data" — every one
> of those Thai figures two months old and presented as current. After it,
> the label is honest: **0 of 71 Thailand**, everything a global fallback.
> **This exposure is not confined to the gap map** — anything reading
> `kmitl_skill_growths` for a Thailand figure has it, including the health
> score's labour-market driver. Raise with whoever owns the
> `kmitl-skill-mapping` connector: did the September pull lose the THAILAND
> scope, or did the upstream API stop returning it?

> **OPEN DECISION — a minimum-context floor.** On dev, **598 of 1,788 skills
> (33 %) in the newest capture appear in exactly one context**, so their
> "mean" is a raw unattenuated observation (max **782 %**) competing on
> magnitude against figures averaged over up to 181 contexts (max 200 %). We
> **show** the context count beside each figure but do **not** exclude thin
> ones. A floor of 3 contexts (the observed median is 2.5) would drop a third
> of the skill population — **measure the coverage loss before adopting it.**

### (b) Trends Radar signals

A signal reaches a row when its `affectedProgramIds` include one of the
field's assigned programmes, **or** when one of its `newInitiatives` names one
of the field's occupations. Up to five per field.

The occupation side is **deliberately never tokenised** — a whole normalised
occupation label must appear in the role text. A live check on 2026-09-16
showed why: JobThai's catch-all bucket `หัวหน้า/ผู้จัดการ/ผู้บริหาร`
(head / manager / executive) split on `/` into the generic word
`ผู้บริหาร`, and one signal matched **46 of 71** fields through it.

That was necessary but not sufficient: common English business words still
reached through the same composite labels ("Digital Marketing Data Analyst"
matched Biology, Mathematics and Agricultural Science through the label
`งาน data scientist/data engineer/data analyst`). A role-side word is
therefore dropped when it appears in more than **10 %** of the taxonomy's
fields — **derived from the data, not hand-listed**, the same way generic
skills are derived from how many occupations demand them. Measured on dev
the threshold sits in a clean gap: *business* 15 %, *analyst* 14 %,
*marketing* and *data* 13 % (dropped) against *digital* 8 %, *supply* and
*chain* 1 % (kept). **The worst single signal now lands on 15 of 71 fields.**

**Forecasting is deferred** until JobThai batches form a time series — there
is currently one delivery, and no posting date within it.

---

## 10. Council brief — `gap-brief.v1`

One model call over **the rows currently on screen** (up to
`GAP_BRIEF_MAX_ROWS` = 60, with the verdict filter, faculty filter and
thresholds passed in): **≤ 5 findings**, each citing one row's own numbers,
plus a "what the data cannot tell" list. Rule 3 of the prompt forbids
programme-level recommendations — the map is a portfolio instrument.

**Every finding is checked against the row it names before it is returned.**
The model may only echo a verdict a row already carries, but nothing stops it
attaching the right verdict to the wrong row, so:

- a finding naming **no row in this view** → dropped;
- a finding whose field name matches **more than one row** (the `nameEn`
  ambiguity of §7) → **dropped**, not pinned to whichever matched first;
- a finding whose verdict **disagrees with its row** → **corrected** to the
  row's verdict, and logged;
- a finding resolving to a **`supply-unknown`** row → dropped, because a
  narrative about a shortfall built on a missing registrar figure is the exact
  misreading that verdict exists to prevent.

The brief reports how many findings were dropped and how many corrected.
Confidence, sources, reasoning and a disagreement button are shown; one
`AiInference` row per call.

---

## 11. Null handling and confidence semantics

- A missing graduate figure is **excluded from every sum and never read as
  0**. A field with no measured programme is `supply-unknown`, not a 0 ratio.
  (`gradsOf()` returns 0 *only* as a summand — `hasSupply()` is the predicate
  that decides whether anything is known.)
- A field below 20 adverts gets a **ratio but no verdict**.
- A pipeline arrow is absent, not flat, when either side is missing.
- A rising-skill figure absent from the newest KMITL capture is **not shown**
  rather than shown from an older one.
- The `ConfidenceBadge` on the Council brief is the **model's** self-reported
  confidence in its findings. It says nothing about the data coverage — that
  is the reconciliation triple (§6) and the "unreviewed fields" count.

---

## 12. Data sources

| Table | Role | Gated by `realDataWhere()` |
|---|---|---|
| `job_postings` (source `jobthai`) | demand: fields, provinces, occupations, education level | **yes** |
| `job_field_taxonomy`, `program_job_fields` | the rows and the assignments | **yes** (every write stamps a run) |
| `alumni_cohort_statuses` | graduates per year (primary) | **yes** |
| `enrollment_metrics` | graduates per year (fallback proxy) | **yes** |
| `student_cohort_distributions` | pipeline | **yes** |
| `program_jobthai_links` | which programmes a row's occupations already link to | **yes** |
| `jobthai_occupation_skills` | skills behind a field's occupations | **no — the table has no `ingestion_run_id` column at all** |
| `kmitl_skill_growths` | rising-skill growth (LinkedIn via MHESI) | **yes** |
| `trend_signals` | what's coming (signals and initiatives) | no |
| programme health index (`getProgramScoreIndex`) | the health figure beside each programme in a row | via the health score |

The map **writes nothing**. It is a read-time computation, cached 5 minutes.

---

## 13. Caveats that travel with every figure

These are the strings the API attaches to `@Provenance`; they are on screen,
not only here.

- JobThai adverts are **national and Bangkok-weighted** (37 % Bangkok, 3.3 %
  Isan); they carry **no salary and no posting date**.
- Only adverts admitting a bachelor's graduate are counted; **postgraduate
  programmes are listed but not scored** (41 of 47,631 adverts).
- A programme assigned to two fields **counts in both** fields' supply; the
  reconciliation line states how many.
- A field whose programmes carry no graduate figure is **`supply-unknown` — a
  missing measurement, never a shortfall**.
- **Proposed fields are shown before review**; the drawer states how many are
  unreviewed.
- The map is cached for 5 minutes and **purged when a taxonomy row is
  approved**. A map computed *concurrently* with an approval may serve
  pre-approval rows until that TTL expires — this is a bounded staleness, not
  a guarantee of freshness. **Ingestion has no `CacheService`, so a taxonomy
  rebuild from the connector does not purge `gap:map:*` at all; the map waits
  out the TTL.**
- 13.5 % of the KKU supply total rests on a single-year enrolment proxy (§5).

---

## 14. Open decisions, collected

Every item here is genuinely undecided. None is a bug.

1. **Cohort completeness** (§5) — admit a cohort at `duration` or at
   `duration + 1`? Today's rule mildly under-states graduates.
2. **Minimum-context floor on rising skills** (§9a) — show thin figures with
   their context count, as today, or exclude them?
3. **Duplicate `nameEn` on rename** (§7) — refuse, or warn?
4. **`kmitl_skill_growths` keeps superseded snapshots** (§9a) — the durable
   fix is either a unique key including `snapshotAt` plus a retention sweep,
   or a connector that deletes the prior snapshot on a successful run. Owner:
   whoever owns `kmitl-skill-mapping`. The gap map reads the newest capture
   only and is safe; **other readers of that table are not**.
5. **The missing THAILAND scope in the newest KMITL capture** (§9a) — a source
   question to put to the connector's owner before any Thai growth figure is
   quoted again anywhere in the platform.
6. **A declined-raw-string ledger** (§7) — until it exists, ~127 abstained
   strings are re-sent to the model on every refresh.

---

## 15. What changed from `gap-analysis.v1` / `gap-lenses.v1`

**Removed:** skill-level demand − supply; the composite gap index and its six
re-projected health dimensions; the sector, occupation and regional gap lenses
(built on empty or 2026-04 regex tables); forecast accuracy; the placeholder
`regionalDemand = 100`; the three `gap-insights` AI modes; the
`/gap-analysis/opportunities` and `/gap-analysis/risks` sub-pages.

**Kept:** the per-programme LinkedIn demand-gap helper
(`computeProgramDemandGaps`, still the AI Analyst's evidence) and the
digital-competency lens, moved to `/education/digital-competency`.

**Redirects:** `/gap-analysis/opportunities` → the map filtered to white
space; `/gap-analysis/risks` → `/risks` (the risk register owns programme
risk, and two screens computing it differently is how they came to disagree);
`/gap-analysis/digital-competency` → `/education/digital-competency`.

> **Numbers on `/gap-analysis` after v1.9.7 are not comparable to any earlier
> figure on that page.** The units changed (shares, not a difference), the
> unit of analysis changed (field of study, not skill), and the supply figure
> was corrected upward by roughly 2.6× (§5). A reader comparing against a
> remembered Composite Gap Index is comparing two unrelated quantities.
