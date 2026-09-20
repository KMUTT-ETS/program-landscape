# Gap map — `gap-map.v2`

| Version | Date | Change |
|---|---|---|
| `gap-map.v1` | 2026-09-19 | First version. Replaces `gap-analysis.v1` (skill-level demand − supply) and `gap-lenses.v1` (seven lenses + a composite gap index) on `/gap-analysis`. |
| `gap-map.v2` | 2026-09-20 | Thai government recruitment announcements from job-108.com join JobThai as a second demand source, behind a selectable **demand basis** (`private` / `public` / `all`, default `all`). See §14. **Bumped because v1.9.7 had by this point reached production and its figures had been published** — the repo's rule that a version identifies the formula a *published* figure was computed under now applies, and the demand denominator a figure is computed against has changed. **A `gap-map.v1` demand share and a `gap-map.v2` demand share are not comparable, even for the same field, because the denominator differs.** |

**On the version constant.** `GAP_MAP_VERSION` was deliberately **not** bumped
while `gap-map.v1` was being built, although the supply rule and the
rising-skills pick both changed during construction (2026-09-16 and
2026-09-19). The repo's rule is that a version identifies the formula a
*published* figure was computed under; at that point the map had never
shipped, no figure had reached a reader under the earlier behaviour, and
nothing persisted a stamped row — the map is a read-time computation cached
for five minutes. So `gap-map.v1` was still being *defined*, not revised.

**That condition no longer holds.** v1.9.7 was tagged, built and — per
CLAUDE.md's "Recent decisions" log — has since reached production; its
`gap-map.v1` figures are published numbers a Council reader may already have
seen or cited. Adding job-108 changes which postings sum into `fieldMentions`
(§3) under the default basis, which moves the demand share, the ratio and the
verdict for fields that carry government demand. That is exactly the "first
change to any rule on this page after v1.9.7 ships" the v1 entry above warned
would bump the constant — so `GAP_MAP_VERSION` is now `gap-map.v2`. See §14
for what changed and why `all` (the blend) is the default rather than an
opt-in.

---

## 1. Summary — what it answers

Strategic questions 3 and 5: starting from **demand**, which parts of the
labour market does KKU's portfolio fail to serve, over-serve, or serve with
the wrong programmes.

The unit is a **field of study** — what an employer says a graduate should
hold — because JobThai adverts state it directly and with counts, which no
other source we have does. 40.7 % of JobThai postings name at least one field.
Since `gap-map.v2` (§14), a second, public-sector source — Thai government
recruitment announcements from job-108.com — states fields of study the same
way, and the two are blended behind a selectable **demand basis**.

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
| **Ratio** | KKU share ÷ demand share. **Displayed** rounded to two decimals; the verdict is decided on the **unrounded** value, so a raw 0.4999 reads `0.50` beside the word *under-served* |
| **Grads / yr** | §5 |
| **Pipeline** | current enrolment summed from `student_cohort_distributions` (`realDataWhere()`-gated). The arrow compares **annualised intake** — Σ over scored programmes of *that programme's* enrolment ÷ *its own* length of study — against graduates/yr: ↑ above 1.25 ×, ↓ below 0.75 ×, → between, and absent when either side is missing. A field's summed pipeline divided by one nominal length overstated every six-year programme by half, which is how Pharmacy and Veterinary Medicine came to read *rising* against a steady intake (`annualisedIntake`, commit `6c2f979`) |
| **Verdict** | §4 |
| **Postings** | the raw distinct-advert count for the field — what the *too-few-postings* floor reads and what the table displays |

Each programme inside a row carries the basis of its own figure:
`supplySource`, `supplyCohorts` (how many entry cohorts the alumni mean was
taken over), `supplyYear` (which academic year an enrolment-proxy figure came
from) and `durationYears`. The row carries `postgraduateProgrammes` — see
below, and §4's *white space*.

**Eligible** adverts are those whose minimum education level admits a
bachelor's graduate: `eligiblePostingLevels('BACHELOR')` = `VOCATIONAL_CERT`,
`HIGHER_VOCATIONAL_CERT`, `BACHELOR`. `UNSPECIFIED` is never eligible
(14,283 adverts). Of 47,631 JobThai adverts, 33,307 are bachelor-eligible —
20,482 stating a bachelor's minimum, 7,212 a higher vocational certificate
and 5,613 a vocational certificate. Re-measured 2026-09-19.

**Postgraduate programmes are listed inside a row with their graduates but
are never scored.** Only **41 of 47,631** adverts state a postgraduate
minimum (39 master's, 2 doctoral), so any verdict on a master's or doctoral
programme would have been built from undergraduate adverts. This is the same
honest-signal gate `health-score.v5.2` applies to the
`jobthai_demand_alignment` driver.

It follows that **a white space means no *bachelor* programme, not no
programme.** A field whose only KKU presence is a master's or doctoral track
is a white space with `postgraduateProgrammes > 0`, and the row lists those
tracks with their graduates so "Programmes: —" cannot be read as "nothing
here". Two dev rows are in that state on 2026-09-19: **Psychology** (1
postgraduate track) and **Geography** (2).

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

**Since `gap-map.v2`, "field-mentions" is itself basis-dependent** — which
postings' numerators get summed depends on the selected demand basis (§14).
`privateFieldMentions` and `publicFieldMentions` are always computed as their
own separate sums regardless of the active basis, so a row can show its
private-only and public-only shares side by side without a second request.

---

## 4. Verdicts

Six, in the order the rule tests them (`verdictFor` in `gap-map-rules.ts`):

| Verdict | Condition | Meaning |
|---|---|---|
| **white space** | the field has **no scored programme** | employers ask; KKU produces no *bachelor* graduate. Postgraduate tracks may exist, are listed, and are never scored |
| **supply-unknown** | it has scored programmes but **none carries a graduate figure** | a **missing measurement**, never a shortfall |
| **too few postings** | fewer than `JOBTHAI_MIN_POSTINGS_FOR_SIGNAL` (**20**) adverts, or no demand share at all | the demand side is too thin to read |
| **under-served** | ratio < `under` | KKU's share of graduates is small against the market's share of adverts |
| **over-served** | ratio > `over` | the reverse |
| **served** | otherwise | |

Thresholds default to `under` **0.5** and `over` **2**. Both are URL
parameters (`?under=…&over=…`), validated as `0 < under < over`, and shown in
two places: above the table in the controls strip, and **in the provenance
drawer**, under *Methodology*, beside the version they belong to
(`meta.methodologyParameters`, assembled per request by `mapMeta` in
`gap.controller.ts` — `@Provenance` is static and cannot carry a value that
changes with the request). Both are needed: an analyst can tighten them for
one review without a code change, and without the drawer a shared link
carrying moved thresholds would look like the default to whoever opens it.

The comparison uses the **unrounded** ratio. The table shows two decimals, so
a field whose true ratio is 0.4999 displays `0.50` and is nonetheless
*under-served*. Read the verdict, not the arithmetic of the displayed number.

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
> reported graduates by roughly 60 %. `6c2f979`, later the same day, moved the
> cohort window from a single global anchor to a per-programme one and moved
> the totals again. The rule below is what ships; the faults are recorded
> because no earlier figure a reader remembers is comparable to it.

### As it now is

**Primary — registrar alumni cohorts** (`alumni_cohort_statuses`, `realDataWhere()`-gated):

1. The window is **per programme** and anchored on **graduation**. Its newest
   end is the newest cohort *that* programme could have finished —
   `currentAcademicYearBE − durationYears`, over `status_bucket = 'GRADUATED'`
   rows only — and it reaches `SUPPLY_WINDOW_COHORTS` = **6** cohorts back
   from there. A single global `MAX(entry_year_be)` anchor starved the long
   programmes: it sat at BE 2567 on dev, set by the shortest degrees, leaving
   every five- and six-year bachelor programme exactly **two** cohorts to
   average against a four-year programme's four. Measured on dev after
   `6c2f979`: the three six-year programmes average **6.00** cohorts, the one
   five-year programme 5.00, and the 66 four-year ones 5.27.
2. Length of study is the programme's own, and where none is recorded, the
   **nominal figure for its level** — bachelor 4, doctoral 3, master's 2,
   higher graduate diploma 2 (`NOMINAL_DURATION_YEARS`; 4 for a level outside
   that list). This is not academic: all **16 of 301** programmes with no
   recorded duration on dev are postgraduate (7 doctoral, 6 higher graduate
   diploma, 3 master's), so the flat four-year default this rule replaced was
   wrong for every one of them — it halved a two-year master's annualised
   intake and threw its cohort window two years out.
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
and dividing by five under-reports by a fifth on its own. This was fixed in
two steps: `356c2f0` moved the anchor onto graduated rows, and `6c2f979` made
the anchor **per programme**, which is what finally gave the long degrees as
many cohorts to average as the short ones.

**(b) The proxy read the newest academic year, which is unfinished.** AY 2026
reads 0 for 226 programmes, and a non-null 0 passes the "has a figure" test —
so 24 of 94 "measured" programmes contributed a zero that was never measured,
and `supply-unknown` never caught them. (AY 2025 and 2024 are all-zero too,
which is why excluding only the *current* year would still have handed 33
programmes a false zero: the rule takes the newest **non-zero** year instead.)

### Measured effect on dev

| | Before the fix | Now |
|---|---|---|
| `fieldGraduatesTotal` | 2,682 /yr | **6,958.6 /yr** |
| Programmes reading a false zero | 24 | **0** |
| Fields verdicted *under-served* | 18 | **9** |
| Fields verdicted *supply-unknown* | 1 | **4** |
| Electrical Engineering | 23 /yr, pipeline *rising* | **66.10 /yr, pipeline *flat*** |

*"Before the fix" was measured on 2026-09-19 against the rule `356c2f0`
replaced. The **"Now" column was re-measured on 2026-09-19 after `6c2f979`**,
which made the cohort window per programme: immediately after `356c2f0` and
before that change, the same total read 7,050/yr and 10 fields were
under-served. A figure that was true when it was written and is false now is
exactly what this column exists to catch.*

**Cross-check on the window length:** the alumni component reads **6,052.6/yr**
over the six-cohort window; recomputed by a separate query over five cohorts
it reads 6,035.9/yr — **0.3 % apart**, so the total is not an artefact of how
far back the window reaches. (Both figures are assignment-weighted; see
below.)

### The proxy's weight

**13 programmes rest on the enrolment-metric fallback** — a single year's raw
count standing in for a mean. Their figures were read from **AY 2012, AY 2019
and AY 2022** (eleven of the thirteen are 2022); the reach-back has no floor,
which is why the year travels with the figure in the row panel.

Two numbers, because they answer different questions and mixing them is how
the earlier version of this paragraph went wrong:

- counted **once each**, those 13 programmes produce **587.0 graduates/yr**;
- counted **as the supply denominator counts them** — once per field they are
  assigned to, the mirror of field-mentions — they produce **906.0/yr**,
  which is **13.0 % of the 6,958.6/yr total**.

The count is visible per programme in the row panel, is counted in
`reconciliation.supplyFromProxy` (13 of the `scoredWithSupply` 83), and is
stated in the provenance drawer with the counts of the response in front of
the reader. It is the largest single piece of softness in the supply side.

### OPEN DECISION — cohort completeness

**Still open. The per-programme window (`6c2f979`) moved *which* cohort sits
at the edge; it did not settle whether that cohort should be there at all.**

A cohort is admitted as soon as `entry_year + durationYears <=
currentAcademicYearBE` — for a four-year programme in AY 2569 that is the
BE 2565 entrants. Because late graduations are still accruing against the
newest admitted cohort, it reads thin: measured across the scored bachelor
programmes on 2026-09-19, the newest admitted cohort averages **68.4**
graduates per programme against **79.2** across the five cohorts behind it
(80.4, 79.8, 84.5, 75.1, 76.4) — about **14 % lower**. Averaged into a
six-cohort mean that drags each programme's figure down by roughly 2 %.
A stricter rule ("complete only at `duration + 1`") would exclude it and
raise every figure slightly.

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
| `anyFieldPostings` | **bachelor-eligible** adverts carrying the `*ANY*` (ทุกสาขา) sentinel — 2,405 on dev. Reported as its own line, assigned to nothing, in neither denominator. Not the same universe as §7's 2,566, which counts the sentinel over all 47,631 adverts |
| `otherKinds` / `otherMentions` | raw field strings on eligible adverts that **no non-rejected taxonomy row has absorbed as a synonym** (3,233 kinds / 5,759 mentions on dev). That is a *superset* of "below the floor": it also holds above-floor strings not yet clustered, and strings held only by a `REJECTED` row. Reported as their own line and counted in **neither denominator** — they are the residue the shares do not cover, not part of them |
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
JobThai batch refresh. **Since `612f744` (2026-09-20, part of the `gap-map.v2`
work, §14), the clustering step reads `job_postings.required_fields_raw`
strings from BOTH demand sources**, not JobThai alone — a raw string is a raw
string regardless of which board it came from, and the taxonomy is the
vocabulary the whole map is built on, not a JobThai-only artefact. The write
anchor moved with it: `latestDemandRunId` takes the most recent successful run
of *either* source (the old JobThai-only name is kept as a deprecated alias so
callers migrate on their own schedule) — stamping a taxonomy row built partly
from government text with a JobThai run id would be a false provenance claim.

### Clustering

Raw `job_postings.required_fields_raw` strings with **≥ 5 mentions**
(`JOB_FIELD_MENTION_FLOOR`; **517 of 3,854** distinct JobThai strings cleared
it, re-measured 2026-09-19 — the counts below predate the shared-vocabulary
change and have not been re-measured against the combined corpus) are
clustered by `job-field-taxonomy.v1` into canonical fields with Thai and
English names. Each field absorbs its raw strings as **synonyms**, and a raw
string belongs to at most one field — enforced in
`packages/db/src/job-fields.ts`, because Postgres cannot express it.

**On the 35-announcement job-108 sample measured so far**: 75 distinct
government field strings, of which **22 appear on no JobThai posting at
all** — the premise of the whole feature, that the state advertises for
disciplines the private board does not. **None of those 22 has cleared the
5-mention floor yet**; each appears once or twice on 35 announcements, so
none has entered the taxonomy. See §14 and §15 item 8 — the ~2,000-
announcement backfill is what gives these strings a chance to be counted at
all, not merely more evidence for fields already on the map.

*Both halves of that fraction exclude the `*ANY*` sentinel, which
`collectRawFieldStrings` drops before anything else happens. Counting it
gives 518 of 3,855; the **518 of 3,854** this page used to print was one of
each and belonged to neither universe.*

*The clustering step reads **all** JobThai adverts, while the map's
reconciliation line counts only the bachelor-eligible ones. That is why
`otherKinds` (3,233) is not 3,854 − 517: the two are counted over different
universes as well as by different rules.*

Strings **below the floor** are never assigned to a field, and they are in
**neither share denominator**. They are reported on the reconciliation line —
inside `otherKinds` / `otherMentions`, which is a superset of them (§6).
`*ANY*` (ทุกสาขา — "any field", **2,566** of all 47,631 adverts; **2,405** of
the bachelor-eligible ones the map scores) is reported as its own line and
assigned to nothing.

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

Every write stamps the latest SUCCEEDED JobThai `ingestionRunId` — all 71
taxonomy rows and all 328 assignments carry one on dev (2026-09-19). The map
itself does **not** gate these two tables: it selects on `reviewStatus`
alone. So the stamp hides nothing today; it is there so that any reader which
*does* gate finds these rows instead of silently dropping them — the trap
that has hidden three other row families in this repo.

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
   older capture's rows are never superseded. On dev the table holds **18,789
   rows, of which 16,795 carry a resolved skill** — the only ones this rule
   reads — across two captures (2026-07-20 and 2026-09-14). Reading across
   both let July's figure be quoted as today's: "Digital marketing" returned
   **600 %** when the current capture's figure for the same skill was
   **279.41 %**. A skill absent from the newest capture is stale and is not
   quoted at all.
2. **Mean across contexts, not max.** A skill appears once per KMITL context
   that demands it. Over the 1,788 skills in the newest capture (measured
   2026-09-19): **median 2** contexts — the middle pair is 2 and 3, so the
   interpolated median is 2.5 — p90 12, max 181. Taking the highest was
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
> ones. The coverage loss is now measured rather than guessed: a floor of
> **3** contexts would drop **894 of 1,788 skills — half the population**, not
> the third an earlier draft of this paragraph said (that third is the
> single-context share, which is what a floor of **2** would drop). Half the
> population is a large price for an attenuation the context count already
> discloses; the decision is still the methodology owner's.

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
skills are derived from how many occupations demand them. Re-measured on dev
2026-09-19 over the 37 distinct role tokens the nine live signals produce
(only 7 reach any field at all), the threshold sits in a clean gap:
*business* 11/71 (15 %), *analyst* 10/71 (14 %), *data* and *marketing* 9/71
(13 %) are dropped, against *digital* 6/71 (8 %), *supply* and *chain* 1/71
(1 %) kept. **The worst single signal now lands on 10 of 71 fields** —
counted over every field it matches, before the five-per-row cap.

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
- a finding that gives a **`supply-unknown`** row *some other* verdict →
  **dropped**, not corrected, because the prose was written as a shortfall and
  relabelling it would leave a finding whose text asserts a shortage its own
  label denies. That is the exact misreading the verdict exists to prevent.
  A finding that **correctly labels** a `supply-unknown` row `supply-unknown`
  is kept — the model is allowed to report a measurement gap, it is only
  forbidden to dress one up as a shortfall.

The brief reports how many findings were dropped and how many corrected.
Confidence, sources, reasoning and a disagreement button are shown; one
`AiInference` row per call.

---

## 11. Null handling and confidence semantics

- A missing graduate figure is **excluded from every sum and never read as
  0**. A field with no measured programme is `supply-unknown`, not a 0 ratio.
  (`gradsOf()` returns 0 *only* as a summand — `hasSupply()` is the predicate
  that decides whether anything is known.)
- A field below 20 adverts gets a **ratio, and the verdict
  `too-few-postings`** — one of the six, not an empty cell. What it withholds
  is a *reading of the gap*, never the numbers behind it.
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
| `job_postings` (source `jobthai`) | demand: fields, provinces, occupations, education level (private basis) | **yes** |
| `job_postings` (source `job-108`), `job108_announcements` | demand: fields, seats, salary, education level (public basis, §14) | **yes** |
| `job_field_taxonomy`, `program_job_fields` | the rows and the assignments — seeded from **both** demand sources since `612f744` | **no — the map selects on `reviewStatus` alone.** Every write does stamp a run and all rows carry one on dev, so nothing is hidden today either way (§7) |
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

These are the strings the API attaches to every map response; they are on
screen in the provenance drawer, not only here. The first six are static
(`MAP_CAVEATS`); the last carries the counts of the response the reader is
looking at, assembled per request by `mapMeta` (`gap.controller.ts`) — as do
the thresholds, which appear under *Methodology* rather than here (§4).

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
- Part of the KKU supply total rests on a **single-year enrolment figure
  standing in for a multi-cohort mean** (§5). The drawer states the live
  counts — 13 of the 83 scored programmes carrying a graduate figure on dev,
  **13.0 % of the supply total** once each is counted per field it is assigned
  to.

**Since `gap-map.v2`,** the active **demand basis** and its human-readable
label (§14) are assembled per request, alongside the thresholds, and shown
under *Methodology* in the drawer — not baked into the static six above,
because the basis is a URL parameter that changes per request rather than a
constant fact about the methodology.

---

## 14. Demand basis — job-108 joins JobThai (`gap-map.v2`)

### The two bases, and why `all` is the default

`gap-map.v1` had one demand source: JobThai private-sector adverts
(`PRIVATE_DEMAND_SOURCE = 'jobthai'`). `gap-map.v2` adds a second: Thai
government and state-enterprise recruitment announcements scraped from
job-108.com (`PUBLIC_DEMAND_SOURCE = 'job-108'`; see
`docs/data-sources/job-108.md`). A request-scoped `basis` parameter
(`private` / `public` / `all`, `@kku/shared/demand/sources`) selects which
source's postings form the demand denominator:

- **`private`** — JobThai only. This is what every `gap-map.v1` figure was.
- **`public`** — job-108 only, inside the counting window (below).
- **`all`** — both, blended. **This is the default.** Excluding the state
  biases the map against exactly the programmes a regional university exists
  to feed but that rarely advertise on a private job board — nursing,
  public health, teaching, agriculture. A field can be legitimately
  under-served by the private market alone and adequately served once the
  state's own demand for the same graduates is counted, or the reverse.

Every row carries `privateDemandShare` and `publicDemandShare` **regardless
of the active basis** — see §3 — so a viewer switching the `basis` URL
parameter sees the alternative reading without a second request, and a
shared link with a non-default basis is self-explaining rather than looking
like the default.

### Why each basis needs its own denominator

§3 established that a share is normalised by **the sum over fields of that
side's own numerators**, not by a count of distinct postings. That rule now
has to hold separately for three different numerator sets — private-only,
public-only, and the union — because they are different populations of
postings, not one population viewed three ways. `privateFieldMentions` and
`publicFieldMentions` are two independent sums, neither derivable from the
other or from the active basis's own `fieldMentions`; mixing them (e.g.
normalising a public-only share by the blended denominator) would silently
misstate which market a share describes. The supply side is unaffected — see
below — so only the demand denominator ever varies with `basis`.

### The supply side does not move

Nothing about `basis` touches graduates, cohorts, pipeline or the verdict
rule itself. `fieldGraduatesTotal`, `scoredProgrammes`, `scoredWithSupply`
and `supplyFromProxy` (§6) are computed once, from the registrar and
alumni data, and are identical whichever basis a request selects.
`verdictFor` (`gap-map-rules.ts`, §4) takes a `demandShare` and a
`supplyShare` as plain numbers — it has no knowledge of which source or
sources fed the demand share it was handed, and nothing in it changed for
`gap-map.v2`. The basis parameter changes one input to an unchanged
function, not the function.

### The unit decision: postings, never seats

A job-108 position states how many seats it offers (`positionCount` —
"จำนวน 3 ตำแหน่ง"). That figure is captured and displayed (`publicSeats` in
the reconciliation block, §6) but **never weighted into a share**. JobThai
carries no headcount column at all, so weighting public seats against
private adverts of unknown size would inflate the public side's share by a
factor nobody can state or defend. The unit on both sides of the basis is
the **posting** (one row per position-type for job-108, one row per advert
for JobThai) — consistent with how the private side has always been counted,
and the only choice that keeps a blended share meaningful.

### The counting window, and why it applies to public rows only

job-108 postings carry a real `postedDate` (from the announcement's own
stated `publishedDate`, or the fetch date when the page states none — see
`docs/data-sources/job-108.md`). JobThai postings do not: all 47,631 carry
`postedDateEstimated = true` and a batch-receipt date, so there is no real
date to window against. Windowing the private side would either silently
drop the entire private universe (if a window were enforced against a
fabricated date) or do nothing (if it were not) — neither is a real control,
so **the window applies to public rows only**. `publicWindowMonths`
(`DEFAULT_PUBLIC_WINDOW_MONTHS = 12`) bounds how far back a job-108 posting
counts; `sourceGate` (`gap-map.ts`) is the single predicate every demand
query shares, so the three bases cannot disagree about which rows they
count.

The window is **first a request-scoped URL parameter**
(`DemandBasisQuerySchema`), and only falls back to an **operator-configured
default** — `job108.defaultWindowMonths`, editable at
`/admin/external/ai-search` via `@kku/db/job108-settings` (Task 17) — when
the caller's query string omits it; the hardcoded
`DEFAULT_PUBLIC_WINDOW_MONTHS` is the last fallback of all, applied by
`DemandBasisSchema`'s own Zod default. A shared link that names a window
wins over whatever an operator has since configured, so a reader comparing
two links is comparing what each link actually asked for, not a value that
moved underneath them.

### Calibration: how far the government extractor disagrees with the private-sector regex

The Gap Analyzer now compares a share built by an AI prompt
(`job108-announcement.v1`) against a share built by a deterministic regex
(`extractFieldsOfStudy`, `packages/shared/src/jobthai/parse-row.ts`). Before
quoting either against the other, `pnpm job108:calibrate` measures how much
they disagree **on the same text** — it feeds JobThai `qualification_raw`
paragraphs (never a real government announcement) to the job-108 extractor
and compares its output against what the regex already recorded for the same
posting. Full run (`--sample=120`, 2026-09-20), read-only, output preserved
at the scratchpad path recorded in the implementation session:

| Measure | Count / share |
|---|---|
| Postings scored | 120 |
| Both found nothing | 44 |
| Agreed exactly (non-empty) | 33 |
| Model found more than the regex | 33 |
| Regex found more than the model | 5 |
| Mixed disagreement (both had unique fields) | 5 |
| Field names the regex missed entirely (model-only) | 69 |
| Field names the regex found that the model missed | 17 |
| Of the 69 model-only names, contain "และ" | 4 (**5.8 %**) |
| Postings where the model returned zero positions (fed a bare qualification paragraph, not an announcement page) | 13 of 120 |

**The และ hypothesis was confirmed, but it is a minority cause of the
under-capture — not the dominant one.** The regex splits a discipline list on
"และ" ("and"); Thai discipline names routinely contain it as part of one
name, not as a separator (`การจัดการโลจิสติกส์และโซ่อุปทาน`, Logistics and
Supply Chain Management, is one field). Only 4 of the 69 model-only names
(5.8 %) actually contain "และ" — the rest of the gap is the model reading
more fields out of a list than the regex's simpler splitting rule finds at
all (worked examples: "เคมี, วิทยาศาสตร์เครื่องสำอาง" added beside what the
regex found; "เครื่องกล" added to "ไฟฟ้า, อิเล็กทรอนิกส์"). The 17
regex-only strings are mostly not disciplines — "เทียบเท่า" (equivalent),
"บุคลิกดี" (good personality), "รับฟังผู้อื่น" (listens to others), "ที่
ใกล้เคียง" (similar) — words the regex's cruder splitting happens to catch
that a language model correctly declines to treat as a field of study; at
corpus scale the catch-all "ใดก็ได้" ("whatever") sits on 192 postings this
way. **None of these 17 reaches `job_field_taxonomy`** regardless: the
clustering step and the 5-mention floor reject them on their own.

**This defect is evidenced here, not fixed here.** It lives in the *shipped*
private-sector extractor and predates `gap-map.v2`; fixing it would move
every existing JobThai-side demand share on a Council-facing page, which is
exactly the kind of change this methodology's version-bump rule exists to
flag deliberately rather than let slip in as a side effect of an unrelated
change. See §15 item 7.

---

## 15. Open decisions, collected

Every item here is genuinely undecided. None is a bug.

1. **Cohort completeness** (§5) — admit a cohort at `duration` or at
   `duration + 1`? Today's rule mildly under-states graduates: on dev the
   newest admitted cohort averages 14 % fewer graduates than the five behind
   it, worth roughly 2 % of each programme's mean. Making the window
   per programme (`6c2f979`) changed which cohort sits at that edge and left
   the question open.
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
7. **The `และ` defect in the private-sector (JobThai) field-of-study
   extractor** (§14) — `extractFieldsOfStudy` splits on "และ", which
   truncates or fractures compound Thai discipline names
   (`การบัญชีและการควบคุมการเงิน` → only `การบัญชี` survives, the tail is
   dropped; `วิศวกรรมเครื่องกลและพลังงาน` → recorded as two separate halves
   that name no real discipline). Confirmed by measurement (§14 calibration:
   4 of 69 model-only names, 5.8 %, contain "และ") and by checking where
   government-only field names' halves live in `job_postings` for
   `source='jobthai'`. **Not fixed here** — fixing it would move every
   existing JobThai-side demand share on `/gap-analysis`, which needs its own
   deliberate change and version bump rather than riding in on this one.
8. **The 22 job-108-only field strings measured on 35 announcements are all
   below `JOB_FIELD_MENTION_FLOOR` (5)**, so none of them has yet entered
   `job_field_taxonomy` — public-only disciplines (e.g.
   `รัฐประศาสนศาสตร์/บริหารรัฐกิจ`, public administration) exist in the raw
   `job_postings` data today but cannot yet earn a row on the map. **The
   ~2,000-announcement archive backfill (`pnpm job108:backfill`, ≈ $15 at the
   measured $0.0077/announcement rate) is therefore a precondition for
   public-only fields to appear at all, not merely a refinement of figures
   already showing** — until it runs, every government-only discipline is
   invisible to the map regardless of how real the underlying demand is.
9. **Per-position government detail is not yet carried into `GapMapRow`.**
   `job108Announcement` / `jobPosting` rows carry seats, salary range,
   education-level floor and the agency name per position, but a `GapMapRow`
   today folds a field's public postings into the same aggregate shape as
   its private ones (§14's unit decision) — an occupation-level or
   agency-level breakdown of the public side, comparable to what
   `GapMapOccupation` already gives the private side, does not exist yet.

---

## 16. What changed from `gap-analysis.v1` / `gap-lenses.v1`

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
