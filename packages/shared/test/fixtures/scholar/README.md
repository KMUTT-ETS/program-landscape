# Google Scholar fixtures

Real ScrapingBee captures. **Never hand-write one.** A parser tested against
imagined markup is worse than no parser — every selector in
`src/scholar/parse.ts` and `src/scholar/search-parse.ts` is justified against a
file in this directory, and a fabricated file would silently launder a guess
into a verified claim.

Regenerate with `packages/shared/scripts/capture-scholar-fixtures.ts`:

```
pnpm --filter @kku/shared exec tsx scripts/capture-scholar-fixtures.ts usage
pnpm --filter @kku/shared exec tsx scripts/capture-scholar-fixtures.ts search       "<name>" <file>
pnpm --filter @kku/shared exec tsx scripts/capture-scholar-fixtures.ts search-novis "<name>" <file>
pnpm --filter @kku/shared exec tsx scripts/capture-scholar-fixtures.ts profile      "<authorId>" <file>
```

**A search costs 75 credits and a profile page 15**, billed to a shared KKU
account with a monthly cap (`usage` prints the remaining allowance). Capture
once; test against the files forever after.

## Profile pages (`/citations?user=`)

| File | Contains |
|---|---|
| `profile-hinton.html` | `cstart=0&pagesize=100` — the 100 most-cited works, fully-populated rows |
| `profile-hinton-page2.html` | `cstart=700` — sparse/old entries: empty venue, empty year, empty citation count |
| `author-search-blocked-signin-wall.html` | The real response to `view_op=search_authors`: a sign-in wall, not results. That endpoint **is** walled — this is the evidence, keep it. |

## Search pages (`/scholar?q=`)

Captured 2026-09-09 through `fetchScrapingBeePage`, so each one also witnesses
that `custom_google` + `stealth_proxy` + **`render_js=false`** returns HTTP 200
on a search (75 credits, `Spb-Cost` header).

| File | Query | Contains |
|---|---|---|
| `search-as-vis-chindaprasirt.html` | `Prinya Chindaprasirt`, `as_vis=1` | **No profile cluster**, a **full page** (10 raw rows), and **9 byline `/citations?user=` anchors** — one of them the subject's own (`wmV9HqoAAAAJ`, `P Chindaprasirt`). The byline-resolution case: the right author id with no cluster to be had. |
| `search-novis-chindaprasirt.html` | same name, **no** `as_vis` | Still no cluster, and only **2 rows** — a short page. Same query, same day, a quarter of the results: Scholar serves a different article set per request, which is why a row count off a search page is never a total. |
| `search-novis-sripa.html` | `Banchob Sripa` | A **profile cluster with one card** (`1oFnFuEAAAAJ`, "Khon Kaen University"), plus 10 rows of results. The cluster header is an `h3`, not the `h4` the reference implementation looks for. |
| `search-novis-wanapat.html` | `Wanapat` (surname only) | A second **one-card cluster** (`ba5L6LwAAAAJ`, Metha Wanapat), affiliation containing a comma. |
| `search-novis-sawanyawisuth.html` | `Sawanyawisuth` (surname only) | **Plain-text bylines**: 4 results, **zero** `/citations?user=` anchors, no cluster. A real Scholar shape and not a failure — the parser must return zero ids without throwing. |
| `search-novis-thai-query.html` | `การพัฒนาหลักสูตร มหาวิทยาลัยขอนแก่น` | Thai-language results: 8 rows, no cluster, zero byline ids, and **one row Scholar gives no year for** — the only capture that exercises `year: null`. Kept because of that row; the query itself is not a shape the feature issues (we always search an English name). |

## Derived files (not captures)

| File | Built from | Why |
|---|---|---|
| `search-derived-multicard.html` | `search-novis-sripa.html` with the profile-card `<tr>` from `search-novis-wanapat.html` spliced into its cluster `<tbody>` | The multi-card cluster below could not be obtained, and case (d) of the four-case resolution (`src/scholar/resolve.ts`) would otherwise rest on parsing that has never seen its input. Nothing is hand-written: both card rows appear verbatim in their captures, and `test/scholar-resolve.test.ts` asserts that before using the file. The **arrangement** — two sibling `<tr>` rows in one table — is ours and is an assumption. Replace it with a capture the first time a real query produces a multi-card cluster. |

A derived file carries a `DERIVED FIXTURE — NOT A CAPTURE` comment as its first
bytes and must never be cited as evidence of what Scholar returns.

### Shapes we could NOT obtain

**A cluster with more than one card.** Ten live searches on 2026-09-09 — three
real KKU researchers, two bare surnames, a bare given name, two deliberately
common Western names (`John Smith`, `Michael I Jordan`) and a Thai-language
query — produced a cluster three times, each time with exactly one card. (The
third, `Michael I Jordan`, is not committed: another single card, no shape the
two KKU captures do not already carry.) The multi-card path in
`parseScholarProfileCluster` is therefore **designed-for, not proven**; it is
written so N cards yield N entries whatever the surrounding layout, and it is
marked UNVERIFIED in the source. Add a capture here the first time a real query
produces one.

**A page carrying a `[CITATION]`-only row.** Ten searches produced none: the
`gs_ctc` badge appears only as `[PDF]`, `[HTML]` or `[BOOK]` in every capture, and
`as_vis=1` hides citation-only entries by construction. So the one place where
`rawRowCount` and `hits.length` diverge is not witnessed by any fixture. The
test for it is a **minimal declared negative case** built from the real
`gs_ctc` structure in `search-novis-sripa.html` with the badge word changed —
labelled as such in `test/scholar-search-parse.test.ts`, and the only
hand-written markup anywhere in these tests. Replace it with a capture the
first time a real search produces one.
