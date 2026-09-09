# Scholar name resolution — design delta

**Supersedes** the binding sections of `2026-09-08-google-scholar-on-demand-design.md`.
Everything else in that spec stands.

## Why this exists

The original spec concluded there is **no way to find a Scholar profile from a
name**, and made binding a manual step: the user pastes their own profile URL.
That conclusion was wrong, and it is wrong in four places — the spec, the plan,
`CLAUDE.md` and `handoff.md`.

The error was one of scope, not of method. `view_op=search_authors` **is** walled;
that finding stands and was re-verified. But author search is not the only way to
reach a profile, and the *article* search endpoint was never actually tested —
the probe that would have tested it timed out before it ran, and the conclusion
was written from the endpoint that had been tested.

## What actually works

Verified against our own ScrapingBee account on 2026-09-09.

**Both flags are required. Neither alone works:**

| Request | Result |
|---|---|
| `stealth_proxy` alone | HTTP 400 — ScrapingBee mandates `custom_google` for google.com |
| `custom_google` alone | **HTTP 500 on any `/scholar?q=` search** |
| `custom_google` + `stealth_proxy` | **HTTP 200** |

The 500 is the trap. Its body carries a generic *"please try again"*, but the
`reason` field says **"Server responded with 403"** and `help` carries Google's
block page. Google 403s ScrapingBee's plain `custom_google` pool **for searches
only**. ScrapingBee does not bill these, so the symptom is a healthy-looking
zero-credit account plus every staff member recording "cannot reach Scholar".

**`/citations?user=` profile pages work with `custom_google` alone.** Only
searches are blocked. This matters for us — see Cost.

### Parameters the proxy accepts

Only `q`, `hl`, `as_vis`. **`num=`, `as_ylo=`, `as_yhi=` are silently rejected**
(HTTP 500). The publication-year window must therefore be filtered client-side
after parsing, never pushed into the query.

### `country_code` must NOT be set

Measured on the same query: `country_code=th` succeeds **2/4**; omitting it
succeeds **7/7**. Pinning the exit country shrinks the stealth pool to whatever
Thai IPs are available and Google 403s them at roughly a coin flip. Result
locale is already pinned by `hl=en`. **Do not re-add without re-measuring.**

### `as_vis=1` suppresses the profile cluster

The "User profiles for X" block — the cleanest carrier of a profile id — is
hidden when `as_vis=1` is set. This is why the fallback probe re-queries
**without** it. Same parser, different question; it can succeed where the
combined search found nothing.

## Cost, and why it changes the estimator

| Call | Flags | Credits (our account) |
|---|---|---|
| Name search | `custom_google` + `stealth_proxy` | **75** |
| Profile page | `custom_google` only | **15** |

The reference implementation measured 50 for the stealth search on its own
account; ours bills 75. **Use 75, and read the real `Spb-Cost` per call into the
ledger as we already do.**

That reference sends both flags on every request to keep one code path. **We
should branch**, because at 75-vs-15 the profile path is the common one: a bound
user's routine sync is profile pages only. Sending stealth on those would cost
60 extra credits per page for nothing.

**This reverses a fix made on 2026-09-08.** The admin console currently prices an
unbound target at **0** credits, because `runScholarFetch` refuses at the binding
gate before fetching. Under this design an unbound target costs `75 + 15 × pages`.
A 100-person bulk of unbound staff moves from free to roughly 10,000 credits. The
estimator, the confirmation dialog and its tests all have to move with it.

## The new flow

One **"Sync Google Scholar"** button. No paste step in the normal path.

```
sync
 ├─ bound already?  → fetch the profile's publications          (15 × pages)
 └─ not bound       → search by English full name               (75)
                       ├─ resolve a profile id → RECORD IT, then fetch  (+15 × pages)
                       └─ no profile id → REFUSE (needs-binding), record nothing
```

**Correction, 2026-09-09.** An earlier draft of this line read *"no profile id →
use the article results, bind nothing"*, carried over from the reference without
checking what it would mean here. **We do not write `ResearchOutput` rows from
search hits.** Three reasons, the first fatal:

- `ScholarSearchHit` carries no `scholarPaperId`, so `planScholarMerge` has
  nothing to key on and **every re-sync would duplicate the same papers** — in a
  table whose defining invariant is that it is additive-only and never deletes.
- The rows were matched by a free-text name query with no profile confirmation.
  That is the namesake mis-attribution this feature exists to prevent.
- A full search page marks them a sample, so any count derived from them is a
  floor feeding a Council roll-up.

So `use-articles` means "no profile could be resolved" and takes the refusal
path — with the hit count named in `errorText`, so it is visible that the search
*did* reach Google and the failure was resolution rather than reach.

The pasted-URL path stays, demoted to a **manual override** for when the search
resolves the wrong person. It is no longer the only way in.

### Resolution, four cases

Taken from the reference implementation, which has run in production.

Search `scholar.google.com/scholar?q=<nameEn>&hl=en&as_vis=1`, then parse **both**
the profile cluster and the article results from the one response.

| Case | Action |
|---|---|
| **(a)** No profile card | Use article results as-is; record no id. If the page came back **full** (10 rows), re-probe **without** `as_vis` before settling — a full page means Scholar truncated, so the count is a floor, not a count. |
| **(b)** One card, displayed name **matches** the query | The queried name is the primary form. Record the id, then fetch the profile's own publications. |
| **(c)** One card, displayed name does **not** match | The card matched via **Other names** — the queried name is an alias. **Drop the article results** (they may be namesakes) and fetch the profile. Reference example: `Phet Imtongkhum` → Scholar `Phet Aimtongkham`. |
| **(d)** Several cards | Prefer a card whose displayed name matches. Otherwise fetch each profile (**cap 3**) and match primary **and** Other names. First match wins. |

### A fifth case the reference does not use: byline links

`parseSearchHits` in the reference extracts `authorLinks` — the per-author
`/citations?user=` anchors inside each result's `div.gs_a` byline — and then
**never uses them**. They are dead data there.

For our names they may be the *primary* signal. Measured 2026-09-09 on a real
KKU professor (`Prinya Chindaprasirt`): the search returned **no profile
cluster at all**, but a byline anchor carried `wmV9HqoAAAAJ`, which resolves to
`Chindaprasirt, P — Professor, Department of Civil Engineering, Faculty of
Engineering`, 40 publication rows. The right person, from the byline alone.

So before falling back to the 75-credit probe, case (a) should check the byline
links for one whose anchor text matches the query name. Byline text is
abbreviated (`P Chindaprasirt`), which is exactly what the initial-tolerant
matcher is for.

**This is an extension beyond the reference, resting on one measured case.**
Verify it against the fixtures captured in Task 3 before relying on it — and
keep the probe as the fallback when no byline link matches. A byline link whose
anchor text does *not* match the query is a co-author, not the subject; using it
would be the mis-attribution error this whole design exists to avoid.

### Ruling: how much an "Other name" is allowed to count

Scholar's "Other names" is a free-text field the profile owner controls, and it
is frequently a mononym or initials-only (`P.C.`). Cases (c) and (d) treat it
differently, and the distinction is who did the matching.

**Case (c) — trust Google.** A single card came back for this query, so *Google*
decided the query matches that profile, and it did so with an index we cannot
see. Our own check is only "does the displayed name match?"; when it does not,
that is the signal the match came via an Other name. Use the profile. We are
trusting Google's matching here, not performing our own.

**Case (d) — our matching decides, so hold it to the same bar.** Several cards
means Google gave us candidates, not an answer. A **primary-name** match wins
outright. An **Other-name** match counts only if it clears the same two-token
floor the matcher applies everywhere else — a mononym or initials-only Other
name is too weak to attach a person's publications to a staff record, and it is
the field most easily wrong or stale. If nothing clears the floor, **resolve to
no binding** rather than guessing: a visible non-result the user can fix by
pasting a URL beats an invisible wrong binding that silently feeds Council
figures.

This makes Other-name matching deliberately weaker than the reference's. That is
the intended direction of the trade.

### The counting trap

The search page is capped at **~10 rows**. Deriving a publication count from it
under-reports badly — an author with 60 works reads as 10. This was a real
production bug in the reference project. Two consequences:

- Every branch that has a profile card goes to the **profile** for the real list.
- Anything still derived from the search page is flagged as a **sample**, and
  truncation is judged on the **raw** row count, before any year filter — a full
  page that filters down to three rows is still truncated.

We already paginate profile publications with `cstart`, which the reference does
not (it takes one `pagesize=100` page and flags truncation). **Keep our
pagination**; it yields complete bibliographies.

### Name matching

The reference matcher is **better than ours in the case our own review flagged**,
and should replace `personNamesMatch` for Scholar-name comparison:

- Strip multi-character title patterns (`A/P`, `Asst. Prof.`, `Assoc. Prof.`,
  `Prof. Dr.`) **before** character-level normalisation. Otherwise punctuation
  splits `A/P` into `["a","p"]` and the matcher reads them as initials against
  the real given name.
- Drop noise tokens: `dr prof assoc asst associate assistant professor lecturer
  ms mr mrs miss sir madam phd msc bsc ma ba ap`.
- **Surnames (last token) must match exactly.**
- Each preceding Scholar token must equal the query token, or be a
  single-character prefix of it **in either direction**.

That last rule accepts `Geoffrey E Hinton` ↔ `Geoffrey Everest Hinton` — which
our current matcher **refuses**, and which our own code-quality review called out
as the most common real-world variant. It still refuses `Wei L Zhang` ↔
`Wei Q Zhang` (conflicting initials), which is the case that matters.

## Where a resolve-nothing search is metered

A search that reaches Google and finds no attachable profile costs 75 credits
and produces no data. It is finalised as **`REFUSED` / `needs-binding` with the
real credits recorded**, and it does **not** consume the 30-day fetch allowance.

Counting it against the fetch quota is the tempting answer and it is wrong: the
user's very next action is to paste their URL and sync, and a quota hit would
lock them out for 30 days for the crime of not being findable on Google. That
moves the harm the `FAILED` exemption exists to prevent rather than removing it.

It is metered instead as a **bind attempt** (`decideScholarBindQuota`), because
that is exactly what it is — a spend-before-success identity assertion, which is
the abuse shape that meter's own header already names. No migration: the
existing `ScholarBindAttempt` columns fit.

**One consequence to carry forward.** The bind cap was sized when an attempt
cost 15 credits, so five was 75/day/user. An auto-search attempt costs 75, so
the same cap is now **375/day/user**. The cap stays at 5 for now, but the admin
console must show **credits at risk, not an attempt count** — a count is the
wrong unit once attempts stopped costing the same.

## What this changes in our code

1. **`packages/shared/src/scholar/scrapingbee.ts`** — add `stealth_proxy`, branch
   on search-vs-profile so profile pages stay at 15 credits. Retries on 500 are
   free per ScrapingBee's docs; keep one auto-retry.
2. **New: name → profile-id resolution** — the search fetch, the profile-cluster
   parser (with the fallback selector for when Scholar inlines a single card),
   and the four-case decision as a **pure, testable function** over parsed input.
3. **`packages/db/src/scholar-fetch.ts`** — `SCHOLAR_NEEDS_BINDING` stops being a
   terminal refusal and becomes the search branch. A resolved id is recorded
   through the existing `bindScholarProfile` write so the audit trail is unchanged.
4. **Name matching** — replace with the title-stripping, initial-tolerant rule.
5. **Profile UI** — one "Sync Google Scholar" button; paste becomes an override.
6. **Admin console** — unbound is no longer free; re-price and fix the tests that
   currently assert 0.
7. **Docs** — correct the four places that assert no name-search path exists.

## Open questions for the implementer to raise, not guess

- ~~**`cheerio`.**~~ **Resolved 2026-09-09: approved, install it.** Parse the way
  the reference does rather than hand-rolling a second HTML parser. The
  constraint that remains is placement, not permission: `@kku/shared`'s barrel is
  reachable from Next client components and cheerio is a large server-only
  dependency, so keep it off any client-reachable path. `@kku/shared/scholar/parse`
  is client-safe today and must stay that way.
- **Auto-bind and the audit trail.** A machine-resolved binding is not a human
  assertion. It should still be recorded — including which name was searched and
  which card won — so a wrong binding is explicable after the fact.
- **Quota.** A failed search costs 75 credits and produces nothing. Decide
  whether that consumes the monthly allowance. The existing posture is that
  `FAILED` does not count and only `SUCCEEDED`/`PARTIAL` do; a search that
  resolves nothing is closer to `PARTIAL`, but it is also the case an attacker
  or a confused user can repeat.
