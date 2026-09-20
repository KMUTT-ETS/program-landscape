# Government job announcements as a second demand source — design

**Date:** 2026-09-20
**Status:** approved, not implemented
**Slug:** `job-108` (new source)
**Methodology impact:** `gap-map.v1` if this lands before v1.9.7 deploys; `gap-map.v2` if after. See §12.

---

## Why this exists

`/gap-analysis` compares the market's share of adverts against KKU's share of
graduates, one row per field of study. Every advert behind it comes from
JobThai, which is a **private-sector** job board.

The Thai state is a major employer of exactly the graduates a regional
university produces — nursing, public health, teaching, agriculture,
engineering inside ministries, and the whole `รัฐศาสตร์` / `รัฐประศาสนศาสตร์`
family. None of that demand is visible today. A field KKU under-supplies
purely to the public sector cannot currently earn an `under-served` verdict,
which is the case the map exists to catch.

`job-108.com` publishes Thai government and state-enterprise recruitment
announcements. Each announcement states, per position, the number of seats,
the education level, and an explicit list of acceptable fields of study —
the same three signals the gap map is built from.

## Measured facts about the source

Measured 2026-09-20 against the live site.

| Fact | Value |
|---|---|
| `now.html` fetched without a proxy | HTTP 200, 113,806 bytes, 0.28 s |
| Detail pages fetched without a proxy | HTTP 200 (`id20256`, `id20285`) |
| User-agent gate | `curl/8.5.0` → 403 on every path; `Mozilla/*` and a custom identifying UA → 200 on every path |
| `sitemap.xml` | 2,008 URLs, **2,000** of them `id<n>.html` announcement pages |
| Sitemap `lastmod` range | 2024-12-18 → 2026-09-19 |
| Announcements per month (14 months to 2026-09) | 1,339 total, mean **95.6/month** ≈ 22/week |
| Seats per announcement | **6.57** (the site's own figure: 30 announcements, 197 positions) |
| Position-types per announcement | **Unmeasured.** 3 in the one announcement read in full. |

**The seat figure is not the row figure.** Seats are `อัตรา`; a single
announcement offering 89 seats of one position-type is one row under the unit
chosen in §2. Position-types per announcement is unknown until the backfill
runs, so the 12-month public pool is estimated at **2,000–4,000 rows**, or
roughly 10–20% of JobThai's 19,365 field-naming postings. **The first backfill
measures this exactly and this table must be updated with the real number.**

Whether a government position states a field of study is likewise unmeasured.
Announcements are legally obliged to publish qualifications, so coverage is
expected to exceed JobThai's 40.7%, but that is an expectation and not a
finding.

### What a detail page actually contains

From `id20256.html`, verbatim, one of three positions in that announcement:

> 1.1 ตำแหน่ง ผู้จัดการโครงการ… จำนวน 1 ตำแหน่ง อัตราค่าจ้างเดือนละ 40,000.- บาท
> คุณสมบัติเฉพาะสำหรับตำแหน่ง … (2) วุฒิการศึกษา ปริญญาตรี ขึ้นไป … ในสาขาวิชา
> รัฐศาสตร์ รัฐประศาสนศาสตร์ บริหารธุรกิจ การบริหารจัดการ เศรษฐศาสตร์
> เกษตรศาสตร์ สิ่งแวดล้อม การเปลี่ยนแปลงสภาพภูมิอากาศ หรือสาขาอื่นที่เกี่ยวข้อง

This is HTML prose, not a PDF, and it carries title, seats, salary, education
level and an eight-item field list for one of three positions.

## 1. Transport: no scraping proxy

**Decision: plain `fetch` with an honest identifying user-agent. No ScrapingBee.**

The site returns 200 to any user-agent that is not literally `curl/*`. A UA of
the form `KKU-ProgramLandscape/1.0 (+https://program-landscape.kku.ac.th;
denpong@kku.ac.th)` was tested against `now.html`, `fast.html`, `sitemap.xml`
and a detail page: 200 on all four. Transport cost is therefore zero, against
75 credits per page through the Scholar transport.

### robots.txt, stated plainly

```
User-agent: GPTBot        Disallow: /
User-agent: ChatGPT-User  Disallow: /
User-agent: CCBot         Disallow: /
User-agent: ClaudeBot     Disallow: /
User-agent: *             Disallow: /go.php
                          Disallow: /url.php
```

Four AI crawlers are disallowed site-wide by name. The wildcard rule permits
everything except two redirect scripts. An institutional crawler that
identifies itself honestly as KKU and stays off `/go.php` and `/url.php` is
inside what the file grants; a client presenting itself as one of the four
named agents is not.

Routing through a scraping proxy would conceal the requester's identity rather
than resolve the question, and would be the wrong answer even though it is the
more expensive one. The crawler identifies itself, publishes a contact address
in the UA string, and rate-limits to **one request per 2 seconds**.

**Operator action, not a code dependency:** send a courtesy notice to the site
owner describing the weekly pull, its volume and its purpose. The connector
works without it; the relationship is better with it.

### Politeness and refetch avoidance

Discovery is `sitemap.xml`, not `now.html`. The sitemap is the complete dated
surface (2,000 entries with `lastmod`); `now.html` is a 30-item slice of it.
An announcement whose `lastmod` is not newer than the `fetchedAt` we already
hold is never refetched, so the steady-state weekly run touches roughly 22
pages plus the sitemap.

## 2. Unit of demand: one row per position-type

**Decision: one `JobPosting` row per position-type. Seats are stored, shown,
and never weighted into a share.**

JobThai carries no headcount column — its seven columns are Job Title, Job
Category, Job Subcategory, Business, Province, Job Description (Raw),
Qualification (Raw). One row is one advert and the seats behind it are
unknown and underivable.

So the two sources cannot be made commensurable by headcount without
inventing JobThai's, which is fabrication. Both available choices distort
something:

- Counting **position-types** discards a real difference between an 89-seat
  and a 1-seat announcement. The discarded quantity is measured, stored in
  `position_count`, and displayed as evidence.
- Counting **seats** compares seats against adverts of unknown size, which
  over-weights the public side by an unknowable factor. This is structurally
  the same error `gap-analysis.v1` made when it compared summed posting-weight
  percentages against graduate counts — the error the v1.9.7 rebuild removed.

The disclosed distortion is preferred to the unmeasurable one. If JobThai ever
supplies a headcount column, `position_count` is already on both sides and the
decision can be revisited without refetching anything.

## 3. Window: backfill everything, count 12 months

**Decision: scrape and store all 2,000 sitemap announcements once; the public
share counts a rolling window, `publicWindowMonths`, default 12.**

JobThai's window is **undocumented and underivable**: the 2026-09 drop has no
date column, every posting carries the batch receipt date, and
`postedDateEstimated = true` on all 47,631 rows. No option achieves genuine
window-comparability. The choice is which asymmetry to pick and state.

Storage is free and refetching is not, so the full 21-month archive is
captured once and the window is applied at read time as a **stated
methodology parameter**, visible in the provenance drawer beside the two
thresholds. The 12 months is an assumption about JobThai that cannot be
verified, which is precisely why it must be a visible dial rather than a
constant buried in a query.

Government rows carry real `postedDate` values from `เผยแพร่เมื่อ`, so
`postedDateEstimated` is **false** on the public side — a genuine improvement
over the private side, and one the drawer should say out loud.

## 4. Extraction: AI, plus a calibration sample on JobThai

**Decision: one AI call per announcement, prompt `job108-announcement.v1`,
Zod-validated, recorded through `@AiCall`. Plus a one-off calibration run
measuring the private side's regex against the same extractor.**

JobThai's field extractor is deterministic regex tuned to JobThai's corpus.
Its own comment states the tuning:

> Thai discipline names in this corpus do not contain spaces … take the first
> whitespace-delimited token.

Government text separates disciplines **with spaces**. Run against the
`id20256` qualification quoted above, that rule captures `รัฐศาสตร์` and
silently discards the other seven fields. The parser is therefore not
reusable, and adapting it would mean tuning regex against a corpus with far
more layout variance than a seven-column export — numbered position lists,
embedded tables, scanned-PDF-to-HTML — where the failure mode is silent
under-capture of the one signal that carries all the value.

### Prompt contract

One call per announcement returns an array of positions. Per position:

| Field | Notes |
|---|---|
| `title` | Thai position title |
| `positionCount` | `จำนวน N ตำแหน่ง` / `อัตรา`; null when unstated |
| `salaryMin` / `salaryMax` | null when unstated |
| `minEducationLevel` | **Lowest** level stated, same floor rule as JobThai: `ปวช.–ปริญญาตรี` means a ปวช holder qualifies |
| `requiredFieldsRaw[]` | Raw Thai field strings; `*ANY*` sentinel for `ทุกสาขา`, identical to `JOBTHAI_ANY_FIELD` |
| `qualificationRaw` | Verbatim qualification text for that position |

The announcement-level fields — agency, publish date, application open and
close dates — are extracted once per page, not per position.

### Scrubbing runs before extraction

`scrubPostingText()` from `@kku/shared/jobthai` is applied to the page text
before the model sees it. Gender and age requirements are removed; email,
phone and social handles are redacted. These appear in government
announcements as they do in private ones, they are not skills, and surfacing
them on a Council surface would be the worst outcome this feature could have.
Scrubbing before extraction also guarantees a stripped phrase cannot end up
inside a captured field name.

### Calibration

A one-off script runs the same AI extractor over a stratified sample of ~300
JobThai `qualification_raw` texts and reports, against the regex: fields the
regex missed, fields it over-captured, and exact agreements. Cost is under $1.

This exists because the two-share design otherwise rests on an unquantified
claim. The result is written into `docs/methodologies/gap-map.md` and into the
provenance drawer's wording. **It may show the private share is itself
systematically under-captured, which would matter more than anything else in
this feature** — the private denominator feeds every existing verdict on the
page today.

## 5. Taxonomy: shared vocabulary, government may propose fields

**Decision: government strings enter the same `job_field_taxonomy`, may
propose new fields, and each synonym's contributing sources are derived at
read time.**

The map's rows *are* taxonomy fields. Two vocabularies would mean no shared
row to carry both a private and a public share, so the selectable-basis
comparison could not be built at all.

Letting government strings propose new fields is what gives public-only
disciplines — `รัฐประศาสนศาสตร์`, `การปกครอง` — a row for the first time.
Those are exactly where the state is the employer, and today they read as
white space whether or not KKU teaches them.

**Source attribution needs no schema change.** A synonym's contributing
sources are derivable: the set of `job_postings.source` values among rows
whose `required_fields_raw` contains it. `/admin/job-fields` computes this in
one query. It stays correct automatically as postings arrive, where a stored
array would drift.

### The coupling a reviewer must be able to see

Since `jobthai-bridge.v3`, an **APPROVED** field's non-rejected assignments
decide which programmes a posting asks for, and those links feed
`jobthai_demand_alignment` — a Council-facing health driver weighted 0.75
inside relevance.

Therefore a field approved on the strength of government text can move JobThai
programme links. `/admin/job-fields` must show, per field, which sources
contributed its synonyms, so a reviewer approving a government-originated
field knows what else moves. The existing guidance stands and applies with
more force: **approve narrow fields first.**

## 6. Architecture

```
sitemap.xml ──► discover new/changed ids
                      │
                      ▼
            fetch id<n>.html (2s spacing, honest UA)
                      │
                      ▼
            scrubPostingText()  ─── gender/age removed, contacts redacted
                      │
                      ▼
            job108-announcement.v1  (AI, Zod, @AiCall)
                      │
                      ▼
      Job108Announcement ──1:N──► JobPosting (source='job-108')
                      │
                      ▼
            pnpm jobthai:fields  ─── shared taxonomy build
                      │
                      ▼
               computeGapMap(demandBasis)
```

The connector follows the fetch-based pattern of `kku-research`, not the
file-drop pattern of `jobthai`. It is registered in
`apps/ingestion/src/connectors/registry.ts` with a **real implementation from
day one** — no mock, per the standing no-mock-data policy.

### Failure isolation

One announcement's extraction failure marks that `Job108Announcement` FAILED
with its error text and does not fail the run; the run reports counts and
succeeds with partial data, the same posture as `kku-research`'s two-source
fetch. A failure to fetch the sitemap **does** fail the run — without it there
is nothing to do.

## 7. Data model

Two additive migrations. No destructive change, no column removed.

**`20260920120000_job_posting_public_sector`**

| Column | Type | Why |
|---|---|---|
| `job_postings.position_count` | `Int?` | Seats. Stored, displayed, never weighted. |
| `job_postings.application_close_date` | `Date?` | Open-now evidence; lets the window be re-cut without refetching. |

**`20260920120100_job108_announcements`**

`Job108Announcement`: `id`, `announcementId` (unique, e.g. `id20256`), `url`,
`contentHash` (unique — refetching identical bytes is a no-op, the
`PdfDocument` and `JobThaiBatch` dedupe pattern), `title`, `agencyName`,
`publishedDate`, `applicationOpenDate`, `applicationCloseDate`, `fetchedAt`,
`status`, `parseError`, `ingestionRunId`, `postings JobPosting[]`.

### Fields deliberately left null on government rows

`jobCategory` and `jobSubcategory` stay **null**. The site has no equivalent
taxonomy and inventing a crosswalk onto JobThai's 240 (category, subcategory)
pairs would be fabricated precision.

The consequence is explicit: **government postings feed the field-of-study
layer only.** They create no `JobThaiOccupation` rows and therefore no
`ProgramJobThaiLink` rows, and they do not move `jobthai_demand_alignment`
directly. They move it only through the shared taxonomy, as §5 describes.

### Provenance

Every `JobPosting` and every `Job108Announcement` row carries
`ingestionRunId`. Omitting it is the failure that has left rows invisible to
`realDataWhere()` three times in this repository. A test asserts that a row
written by this connector passes `realDataWhere()`.

## 8. Gap map changes

### New parameters

| Parameter | Values | Default |
|---|---|---|
| `demandBasis` | `all` \| `private` \| `public` | **`all`** |
| `publicWindowMonths` | integer | `12` |

Both go into `CacheService.keyOf` alongside `scope`, `scopeId`, `under` and
`over` — otherwise two bases collide in the cache, which is the bug the
threshold work already fixed once. Both go into `mapMeta`'s
`methodologyParameters`, assembled per request and rendered in the provenance
drawer under *Methodology*.

### Why `all` is the default

Blending is the analytically right single number: excluding the state biases
the map against precisely the programmes a regional university exists to feed.

The cost of a changed denominator is normally continuity — every published
share moves at once. **That cost is zero right now.** v1.9.7 is built and not
deployed, so no Council reader has ever seen a published share on this page.
This is the only window in which the default can be set correctly for free.

### The supply side does not move

`supplyShare` is KKU's share of graduates and is basis-independent. The ratio
changes only through the denominator, so `verdictFor()` is **unchanged** — it
receives a different `demandShare` and nothing else. This keeps the change
surgical and keeps the six verdicts and their null-handling exactly as
audited.

### Each basis carries its own denominator

`fieldMentions` under `all` is the sum over both sources; under `private`,
JobThai only; under `public`, `job-108` within the window only. They cannot be
derived from one another: a posting naming *k* fields counts *k* times on
whichever side it sits, so the three denominators are three separate sums.

### Row shape

`GapMapRow` gains `privateDemandShare`, `publicDemandShare`, `privatePostings`,
`publicPostings`. The collapsed row shows the share for the active basis; the
expanded row shows both, so a reader can see *why* a verdict is what it is.

`reconciliation` gains `privateFieldMentions`, `publicFieldMentions`,
`publicAnnouncements`, `publicPositions`, `publicSeats`, `publicWindowFrom`.

### The posting floor stays at 20

`JOBTHAI_MIN_POSTINGS_FOR_SIGNAL` is unchanged and does not scale with the
basis. On the smaller public pool it is a stricter filter, and many fields will
read `too-few-postings` under `public`. That is the honest answer, not a
defect — a field with 6 government adverts behind it cannot support a verdict.

The constant becomes a misnomer once it gates two sources. **Recorded as naming
debt, not renamed here**, because `jobthai-bridge` shares it and a rename would
touch the bridge in a change that is otherwise additive.

### Expanded-row evidence

Government rows have no occupation layer and cannot join the existing
occupations block. They get their own block: agency, position title, seats,
closing date, and a link to the announcement page. This is stronger evidence
than the private side can offer, since it resolves to a named public document.

Per the standing rule that JobThai-derived surfaces carry
`<DataSourceMark source="jobthai">`, government surfaces carry a `job-108`
mark and a blended row carries both.

### Three new caveats, each with a number

1. The measured AI-vs-regex disagreement rate from §4's calibration, stating
   that the two shares are built by different extractors and by how much they
   differ on a common sample.
2. That seats are stored but never weighted, so an 89-seat announcement counts
   once — with `publicSeats` beside `publicPositions` so the reader can size
   what was set aside.
3. That government rows feed the field layer only and create no occupation or
   programme links.

### `job-fields.ts` de-hardcodes

Three `jp.source = 'jobthai'` predicates and the ingestion-run anchor at the
bottom of the file become source-aware, so government strings enter the same
clustering. This is the change that makes government demand visible on a row
at all.

## 9. Scheduling

**No new infrastructure.** A `DataSource` row with `cadenceCron` and
`scheduleEnabled: true` is registered as a BullMQ repeatable job by the
existing `IngestionScheduler`, exactly as the other sources are. Catalog entry
in `packages/shared/src/ingestion/catalog.ts`:

- `slug: 'job-108'`, `kind: 'SCRAPE'`, `inputFormat: 'HTML'`
- `scheduleEnabled: true`, `cadenceCron: '0 3 * * 1'` (Mondays 03:00)
- `ownerContact: 'KKU Data Office'`

`IngestionScheduler.registerSchedules()` reads cadence from the database at
boot and clears existing repeats first, so a cadence edited in the admin UI
takes effect on the next ingestion bounce — not immediately. That is existing
behaviour and is called out so nobody debugs it as a fault.

The taxonomy rebuild is **not** chained automatically into the weekly run.
`pnpm jobthai:fields` makes real model calls in its dry run as well as its
apply, and a weekly automatic re-clustering would re-send the ~127 abstained
raw strings every week against a ledger that does not yet exist. The weekly
connector loads postings; the taxonomy build stays operator-triggered, as it
is today.

## 10. Cost

| Item | Basis | Cost |
|---|---|---|
| Transport | Plain fetch | **$0** |
| Backfill extraction | 2,000 announcements × ~$0.0135 | **~$27 one-off** |
| Weekly extraction | ~22 announcements | **~$0.30/run** |
| Calibration sample | ~300 JobThai texts | **<$1 one-off** |

Per-call cost is derived from the live model's catalogue rate against a
measured token profile, **not** read off `ai_inferences` — `gemini-3.8-flash`
is absent from the hardcoded `PRICING` table and short-lived CLI runs record
$0.00 when the pricing store's out-of-band cache has not yet populated. That
defect is tracked separately; it means this feature's real spend will be
**under-reported** in `/admin/ai-cost` until it is fixed.

## 11. PDPA and data posture

Government recruitment announcements are public documents published by state
agencies. They contain no personal data about applicants.

The announcement text does contain agency contact details, and the scrubbing
pass in §4 redacts email, phone and social handles before extraction, so they
are never stored. Gender and age requirements are removed on the same pass and
never persisted, matching the JobThai posture exactly.

Agency names are stored — they are the publishing institution, not a person.

## 12. Version stamp and sequencing

`GAP_MAP_VERSION` identifies the formula a **published** figure was computed
under. The map has never shipped: v1.9.7 is built and undeployed, nothing
persists a stamped row, and the computation is read-time with a 5-minute
cache.

- **If this lands before v1.9.7 deploys**, `gap-map.v1` is still being
  *defined* and does not bump.
- **If this lands after**, it is the first post-release change to the demand
  rule and it bumps to **`gap-map.v2`**.

This is a consequence of the release schedule, not a choice to make later. The
implementer checks the deployment state and applies the rule.

## 13. Testing

| Area | Test |
|---|---|
| Fixtures | 2–3 real announcement pages saved as fixtures, covering: multi-position with distinct field lists; a high-seat single position; one with no field of study stated |
| Extraction | Prompt output validates against the Zod schema; `*ANY*` sentinel on `ทุกสาขา`; education floor takes the **lowest** stated level |
| Scrubbing | Gender, age, email, phone and handle never reach a stored field, and never reach a captured field name |
| Denominators | The three bases produce three different `fieldMentions`; none is derivable from another |
| Cache | The three bases and two window lengths produce distinct cache keys and do not collide |
| Verdicts | A field with public demand and no private demand earns a real verdict under `all` and `too-few-postings` under `private` |
| Provenance | A row written by the connector passes `realDataWhere()` |
| Bridge isolation | A government-only field with no JobThai synonyms produces **zero** `program_jobthai_links` changes |
| Bridge coupling | A field whose synonyms are shared with JobThai **does** change links, and the change is visible in `planJobThaiLinks`' dry-run diff |
| Rendering | No raw cuid reaches the screen — assert against the cuid **shape**, matching the guard added in `92cc9e4` |
| Politeness | An announcement whose `lastmod` is not newer than `fetchedAt` is not refetched |

## 14. Explicitly out of scope

- **The gap verdict still does not feed the health score.** Assessed and
  refused on 2026-09-19 with four independent disqualifying measurements
  (recursion through `getProgramScoreIndex`; unit mismatch, 19 of 26
  multi-field programmes carrying disagreeing verdicts; global normalisation
  making it non-per-programme for 86 of 99; and r = 0.043 against the existing
  score, sign backwards). Adding a second demand source changes none of the
  four.
- **Government does not enter the occupation layer.** No `JobThaiOccupation`
  rows, no crosswalk onto the 240 JobThai pairs.
- **Seats are not weighted** into any share.
- **The taxonomy build is not automated** into the weekly run.
- **No backfill of JobThai dates.** The private side stays undated; the
  asymmetry is stated, not papered over.

## 15. Open questions, carried

- **Position-types per announcement is unmeasured**, so the public pool size
  is an estimate until the first backfill. §"Measured facts" must be updated
  with the real number and the 10–20% estimate replaced.
- **Field-of-study coverage on the public side is unmeasured.** Expected to
  exceed JobThai's 40.7% because qualifications are legally required, but
  expected is not measured.
- **`publicWindowMonths = 12` is an assumption about JobThai's window**, which
  is itself unknowable from the data. It is a visible parameter precisely so
  it can be argued with.
- **The courtesy notice to the site owner** is an operator action with no code
  dependency. Worth doing before the backfill's 2,000 requests, not after.
