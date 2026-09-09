# Google Scholar on-demand research fetch — design

**Date:** 2026-09-08
**Status:** approved for planning. **The binding sections, and every cost figure
below, were SUPERSEDED on 2026-09-09** by
`2026-09-09-scholar-name-resolution-design.md`. Superseded passages are marked
in place rather than deleted, so the reasoning that produced them stays legible.
**Surfaces:** `/profile` (self-service) · `/admin/scholar` (per-person + multi-select) · provenance drawers on every research roll-up

## Why this exists

The platform's research data comes from the internal `kku-publications` mirror (Scopus + PubMed). That mirror is curator-grade and fast, but it indexes only what Scopus and PubMed index. Google Scholar carries preprints, theses, book chapters, Thai-language venues and conference papers the mirror never sees — which for some KKU researchers is most of their output.

This adds a **user-triggered** Scholar fetch via ScrapingBee, so a person can bring their own full publication record into the platform.

## A decision this reverses, deliberately

CLAUDE.md records Google Scholar as excluded, twice:

> *"Google Scholar deliberately excluded (no official API + ToS)"* — profile-page work, 2026-05-09
> *"Google Scholar explicitly NOT used. No official API; unofficial scrapers … are either ToS-violating + IP-blocked, or paid wrappers"* — kku-research v1, 2026-04-28

ScrapingBee removes the IP-blocking half of that objection. **It does not remove the terms-of-service half** — this is still scraping Google Scholar, through an intermediary. The operator has accepted that with a paid plan; it is recorded here so nobody later assumes the earlier reasoning was simply wrong or forgotten. If KKU legal or the DPO revisits it, this is the paragraph to bring.

## Scope decisions (operator-approved, 2026-09-08)

| Question | Decision |
|---|---|
| How far does Scholar data reach? | **Everywhere, including aggregates** — health score, faculty roll-ups, `/staff/research` |
| What about library papers Scholar misses? | **Scholar wins, library fills gaps.** Nothing a user already had can disappear |
| Quota | **Rolling 30 days**, self-service; admin fetches on a separate counter |
| Who binds a Scholar profile to a person? | ~~The user supplies their own profile URL~~ — **superseded 2026-09-09.** The profile is resolved automatically from the person's English full name; a pasted URL survives only as a manual override. See `2026-09-09-scholar-name-resolution-design.md` |

### The consequence of "including aggregates", stated plainly

Only users who have pulled will have Scholar data. A faculty or university research figure therefore **mixes two sources depending on who happened to click a button**, and moves when someone clicks it. Two obligations follow, and neither is optional:

1. Every Council-facing research roll-up must state source composition in its provenance drawer — *"N of M staff on Scholar data"*. This is already required by council-readiness rule 1; here it is load-bearing.
2. `docs/methodologies/health-score.md` gains a note that the research dimension is mixed-source and why. Scholar citation counts run **higher** than Scopus (preprints, theses, non-indexed venues), so staff who fetch will appear stronger than colleagues who have not. That is a comparability question for governance, not a bug to fix in code.

## Architecture — Scholar papers become ResearchOutput rows

`ResearchOutput` is what `health-score.ts`, `benchmarking.ts`, `program-research-expertise.ts` and `program-deep-dive.ts` all read. It already carries a `source` discriminator and several external-id columns, with `facultyMemberId` nullable and per-external-id unique pairs.

Writing Scholar papers there means **the four aggregate modules need no changes at all**. The rejected alternative — a separate `ScholarPublication` table merged at read time — would have required editing all four and keeping four merge implementations in step, which is a shape this codebase has been bitten by repeatedly.

### Schema — four additive changes, no destructive migration

`FacultyMember` (mirrors the existing `scopusAuthorId` pattern):
```prisma
scholarProfileId   String?   @unique @map("scholar_profile_id")
scholarProfileUrl  String?   @map("scholar_profile_url")
scholarBoundAt     DateTime? @map("scholar_bound_at")
scholarBoundById   String?   @map("scholar_bound_by_id")
```

`ResearchOutput`: `scholarPaperId String? @map("scholar_paper_id")`, indexed, plus `@@unique([scholarPaperId, facultyMemberId])` — same shape as `openalexId`, so one paper links once per matched author.

`ScholarFetchRun` — one row per attempt, and **the quota ledger**: `userId`, `facultyMemberId`, `triggeredById`, `trigger` (`SELF` / `ADMIN` / `ADMIN_BULK`), `status` (`SUCCEEDED` / `PARTIAL` / `FAILED` / `REFUSED`), `papersFound`, `papersInserted`, `citationsUpdated`, `creditsUsed`, `errorText`, timestamps. Keeping quota in a ledger rather than a field on `User` means history survives and an admin can always answer *"why can't this person fetch"* by looking.

`ScholarFetchArchive` — the raw ScrapingBee response per run: `fetchRunId`, `rawPayload`, `contentHash`, `parserVersion`. Retained 90 days, enforced by the existing PDPA retention sweep
(`scripts/pdpa/`) rather than an ad-hoc cron — adding a second retention
mechanism is how one of them stops running unnoticed. This is a **scraped** source with no contract; when a parse turns out to be wrong months later, this is what makes reprocessing possible instead of re-scraping, and it is the only way to answer "where did this number come from" for a Council figure derived from a page we scraped.

## Data flow

```
/profile → "Fetch from Google Scholar"
  ├─ quota check (server-side) ──────── refused → show the date they can retry
  ├─ no scholarProfileId?
  │    └─ SEARCH scholar.google.com/scholar?q=<English full name>   (75 credits)
  │       → resolve a profile id → store scholarProfileId + scholarBoundById
  │       → resolved nothing → REFUSE (needs-binding); paste-URL override remains
  ├─ FETCH  paginate the bound profile's publication list, all pages
  ├─ archive raw payload
  ├─ DIFF-MERGE into ResearchOutput        (never a wipe — see below)
  └─ invalidate UserPublicationsCache for that user
```

**Corrected 2026-09-09.** The unbound branch above originally read *"ASK the user
to paste their Scholar profile URL"*. It is now a name search. See
`2026-09-09-scholar-name-resolution-design.md` for the four-case resolution, the
byline-link fifth case, and the consequence that an unbound target is no longer
free.

### The merge, precisely

For each parsed Scholar paper, against existing rows for that `facultyMemberId`:

| Match | Action |
|---|---|
| DOI equal (when Scholar supplies one) | update `citations` only; set `scholarPaperId`; library metadata untouched |
| else normalised title **and** year equal | same |
| no match | insert with `source='google-scholar'` |

Title normalisation: lowercase, strip punctuation and diacritics, collapse whitespace. **Year must agree** — title alone is too weak a key, and this codebase has already paid for a fuzzy matcher once: the retired filename matcher mislinked ~30 programmes and had to be unpicked by a content audit.

**Library rows are never deleted and never overwritten beyond the citation refresh.** This is what makes failover structural rather than a rule someone has to remember. It is also yesterday's phase2b lesson applied directly: that materialiser did an unconditional delete-and-replace, and on a failed LLM call it destroyed 56 courses and reported success. There must be no code path here that deletes.

### Who can use this at all

`ResearchOutput.facultyMemberId` is the join every aggregate reads, so a user
with **no linked `FacultyMember` row has nowhere for Scholar papers to attach**.
The profile page resolves that link through HR `employeeId`, and it is absent
for non-staff accounts and for staff HR has not yet mirrored.

Behaviour: the button is **shown but disabled**, with the reason — "your staff
record is not linked yet, contact an administrator" — rather than hidden. A
hidden button produces a support ticket asking why the feature is missing; a
disabled one with a reason does not. No `ScholarFetchRun` row is written, and
no quota is consumed.

### Binding — the claim in this section was WRONG; corrected 2026-09-09

> Superseded by `2026-09-09-scholar-name-resolution-design.md`. This section is
> kept, corrected in place, because one half of it is still true and expensive to
> re-learn, and because the shape of the error is worth carrying forward.

**Still true — `view_op=search_authors` really is walled.** Google Scholar's
author-search endpoint deterministically redirects to a mandatory sign-in wall
through ScrapingBee — verified across default/premium/stealth proxies,
`render_js` both ways, two country codes, a `Referer` header and two different
names, and **re-verified independently on 2026-09-09 with `custom_google=true`
present**, so it is not an artefact of the missing parameter. The profile page
and the Scholar homepage fetch cleanly in the same session, so this is specific
to author search, not the account or the IP. The real wall response is committed
as a fixture
(`packages/shared/test/fixtures/scholar/author-search-blocked-signin-wall.html`).
**Keep that fixture and do not retest this endpoint** — someone will otherwise
spend credits rediscovering it.

**Wrong — the generalisation from that one endpoint to "no name-search path
exists".** There is one. The ordinary *article* search, `/scholar?q=<name>`,
returns a "User profiles for X" cluster and per-author `/citations?user=` byline
links, and either of those resolves a profile id from a name. Measured against
our own account on 2026-09-09, it needs **both `custom_google=true` and
`stealth_proxy=true`** — neither alone works (`stealth_proxy` alone → HTTP 400,
because ScrapingBee mandates `custom_google` for google.com; `custom_google`
alone → HTTP 500 on any search, whose body says "please try again" while its
`reason` field says "Server responded with 403"). `/citations?user=` profile
pages still work on `custom_google` alone, which is why the transport branches.

**How the error happened, because the shape of it generalises.** It was a
mistake of scope, not of method: a conclusion drawn from the one endpoint that
had been tested was written down as a property of the whole surface. The probe
that would have caught it — the article-search endpoint — **timed out before it
ran, and its non-result was recorded as though it were a negative finding.**
*A timed-out probe is not a negative result.* It is an untested case and must be
written down as one.

**Binding is therefore by name resolution**, with the pasted URL demoted to a
manual override for when the search resolves the wrong person. Validation of a
pasted URL is unchanged: accept `scholar.google.<tld>/citations?user=<id>` in any
query-param order, extract `<id>`, and reject anything else with a message
naming what a correct URL looks like.

`ScholarFetchRun.searchQuery` records the submitted URL on the override path and
the searched name on the resolution path, so a bad binding is diagnosable either
way.

The mis-attribution risk that made the URL-only path attractive has not gone
away — `kku-research` deliberately uses no fuzzy matching because common Thai
given names mis-attribute papers. The 2026-09-09 design answers it with an
exact-surname, initial-tolerant matcher and a standing rule that resolving
**nothing** beats resolving wrongly; read that spec before touching resolution.

### Type mapping

`ResearchOutputType` is `JOURNAL | CONFERENCE | PATENT | BOOK`. Scholar's types are looser and frequently absent. Unmapped or missing → `JOURNAL` (the dominant case), with the raw Scholar type preserved in the archive so a better mapping can be applied later without re-scraping.

## UI

Admin work lives in **one console** at `/admin/scholar` (gated `isAdminGrade`) rather than scattered across `/staff/*`: the bulk view needs a filterable list anyway, and a single-person fetch is that list with one row ticked.

| Surface | Who | Behaviour |
|---|---|---|
| `/profile` button | any user, own record | Shows last fetch, next eligible date, and which source is currently primary. Disabled with the date when inside 30 days. |
| ~~Candidate picker (modal)~~ | the user | **Superseded 2026-09-09.** There is no picker on the normal path: one "Sync Google Scholar" button resolves the profile from the English full name. A paste field survives behind a "wrong person?" override. |
| `/admin/scholar` row action | SYSTEM_ADMIN, SUPER_ADMIN | Fetch one person. Unbound → the run searches by name and records what it resolves (**not** free — see Spend guard); the admin can still paste a URL to override. |
| `/admin/scholar` multi-select | same | Filter by faculty/department, tick rows, **Fetch selected**. |

**Bulk is asynchronous.** ScrapingBee takes seconds per profile plus pagination, so 50 people is minutes and 500 is far beyond any request timeout. The API enqueues onto the existing `ai-jobs` BullMQ queue (ingestion consumes it — the same pattern as PDF intake and the model-health notifier); the console polls run status. No new queue.

## Quota

One server-side function, consulted by every entry point. **Never a UI-only check.**

| Trigger | Rule |
|---|---|
| `SELF` | 1 per rolling 30 days per user, measured from `startedAt` of the previous non-FAILED run |
| `ADMIN` / `ADMIN_BULK` by SYSTEM_ADMIN | 1 per rolling 30 days **per target**, separate counter — an admin refresh never consumes someone's self-service turn |
| any trigger by SUPER_ADMIN | unlimited; bypasses both; still recorded with who ran it |

### Spend guard

ScrapingBee is metered per request and a careless "select all" across a faculty is real money. The bulk confirmation states **how many people and the estimated credit cost**, and `SCHOLAR_BULK_MAX_TARGETS` caps a single run. Nothing spends against the plan without a number in front of it first.

**The prices, corrected 2026-09-09 — this section was written before any of them were known, and the shipped console then priced an unbound target at 0.** Measured on our own account: a profile page costs **15** credits (`custom_google` only); a name search costs **75** (`custom_google` + `stealth_proxy`). An unbound target is therefore `75 + 15 × pages`, not free, and a 100-person bulk of unbound staff is roughly **10,000 credits**. The estimator, the confirmation dialog and their tests all move with that. The real `Spb-Cost` header stays authoritative per call; the constants exist only for the estimate.

## Failure behaviour

- A failed fetch **does not consume quota**. Burning someone's month on a ScrapingBee timeout is indefensible.
- A failed or empty parse **writes nothing**. Structural, not a rule: the merge is additive-only and there is no delete path.
- Partial pagination records `PARTIAL`, merges what it parsed (safe, because additive), and does not consume quota.
- Library data keeps serving throughout. Failover is the default state, not a recovery mode.
- A run producing zero matched papers reports **zero found**, never success — the phase2b lesson that a skip must not read green.
- **Added 2026-09-09.** A name search that reaches Google but resolves no attachable profile costs 75 credits and produces no data. It finalises as `REFUSED` / `needs-binding` with the real credits recorded, does **not** consume the 30-day fetch allowance — the user's next act is to paste a URL, and a quota hit would lock them out for a month for not being findable — and is metered instead against the bind-attempt cap, which is the meter for a spend-before-success identity assertion.

## Testing

Three pure units, each exercisable without network or database:

| Unit | Must prove |
|---|---|
| Quota decision | trigger × role × history → allow / refuse + reason; SUPER_ADMIN bypass; a FAILED run does not count |
| Merge planner | DOI precedence; title+year fallback; year mismatch does NOT match; **empty input writes nothing**; no-delete invariant |
| Parser | archived fixtures → normalised entries; missing type, missing year, missing DOI all handled |

The **no-delete invariant must be mutation-tested** — reintroducing a delete has to fail a test. It is the property most expensive to lose, and the one that failed silently in phase2b.

## Open questions, deliberately deferred

- **Unbinding.** Nothing here lets a user detach a wrongly-confirmed Scholar profile. Needed eventually; not in v1, and an admin can clear the field.
- **Re-parse from archive.** The archive makes reprocessing possible but no command exercises it yet.
- **Scholar-only authors.** A Scholar paper whose KKU co-authors are not in `FacultyMember` links only to the fetching user. Matches how `kku-research` already behaves; not widened here.
