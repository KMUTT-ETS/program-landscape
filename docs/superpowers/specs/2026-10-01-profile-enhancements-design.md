# /profile enhancements — design

**Date:** 2026-10-01 · **Status:** approved in brainstorming, awaiting spec review
**Test account:** denpong@kku.ac.th (staff record `cmonqt19901it2feejnr8ymwe`)

Four changes to `/profile` (and the public `/p/[slug]`, which renders the same view):

1. Fix publications showing "(co-authors could not be fetched)".
2. Make the per-publication pill row readable, with type and citations clearly distinct.
3. Remove the Top venues panel.
4. Replace the "My teaching evaluations" link card with an embedded evaluation panel:
   KPI tiles and a radar with one axis per evaluation category.

## 1. Co-authors for Google Scholar papers

### Finding

denpong's list (`research.basis = google-scholar`) is 22 Scholar rows + 5 OpenAlex rows.
**17 of the 22 Scholar rows have no authors; every OpenAlex row has them.** Scholar rows carry
no DOI, Scopus id or PMID, so the author enrichment (kkuscholar DOI bridge → OpenAlex/Scopus by
DOI) has nothing to key on, and the remaining title+surname metadata search rarely matches Thai
titles and older conference papers. Meanwhile Scholar's own profile list page — which the sync
already fetches — prints an author line on every row (`<div class="gs_gray">AUTHORS</div>`,
documented in `packages/shared/src/scholar/parse.ts`), and the parser discards it.

### Design (user chose: keep the list-page line AND fetch full lists)

- **List-page author line.** `parse.ts` captures the author line per row. Scholar shortens long
  lists with a trailing `...` / `…`; such a row is marked `complete: false`.
- **Full list from the detail page.** For shortened rows only, the sync fetches the paper's
  Scholar detail page (`citations?view_op=view_citation&citation_for_view=<profile>:<paper>`),
  which carries the complete author list, and stores it `complete: true`.
- **Once per paper.** A row whose stored list is already complete is never fetched again.
- **Per-sync cap: 20 detail pages (300 credits at 15 each).** Remaining shortened papers are
  left for the next sync; the run records how many are pending.
- **Credits** of detail fetches are added to the run's `creditsUsed`, so `/admin/scholar` and the
  quota ledger show real spend; existing quota / bind caps apply unchanged.
- **Failure isolation.** A failed or unparseable detail page never fails the sync; that paper
  keeps its shortened list and is retried next sync.
- **Storage.** One additive nullable JSON column on `research_outputs`, `scholar_authors`:
  `{ names: string[], complete: boolean, fetchedAt: string }`. Written only for
  `source = 'google-scholar'` rows. The no-delete invariant of the Scholar merge is unchanged
  (updates only add/raise; the CI `scholar-no-delete` job must stay green).
- **Profile builder** (`packages/db/src/staff-profile/profile.ts`): for a Scholar row with
  `scholar_authors`, `authors` are built from those names (parsed into `AuthorName` —
  Scholar renders "D Soodphakdee" style: initials + family name) and `authorsAreComplete` =
  `complete`. Rows without it fall through to the existing enrichment.
- **Displayed status (per paper, under the pill row):**
  - complete → nothing;
  - shortened → "list shortened by Google Scholar — full list on next sync";
  - no author information from any source → "co-authors unavailable"
    (replaces "(co-authors could not be fetched)").

### Backfill and fixtures

- Re-parse the one archived list page on dev (`scholar_fetch_archives`, denpong's 2026-09-09
  fetch) to populate author lines for the existing 22 rows — free, no scraping.
- The detail-page parser is built against a real captured page committed as a fixture under
  `packages/shared/test/fixtures/scholar/`. Capturing it is one live fetch (15 credits).
- Production has no Scholar rows (Scholar fetch never deployed): nothing to repair there.

## 2. Publication pill row

Under each APA citation, one metadata row, 12 px text, 12 px gaps, `·` separators, 8 px above:

| Element | Style | Rule |
|---|---|---|
| Year | plain | always first |
| Type | outlined chip with icon, readable label: Journal article, Conference paper, Book, Patent | **hidden for `source = 'google-scholar'`** — Scholar states no type; the stored `JOURNAL` is a placeholder |
| Citations | NOT a chip: quote icon + "Cited by N", accent colour | hidden at 0 |
| Source | small grey text: Google Scholar, Scopus, PubMed, OpenAlex, … | from `PublicationEntry.source` (`kku-publications:scopus` → Scopus, `live:<x>` → its name) |
| Identifiers | small labelled links: Scopus ↗, PubMed ↗ | right side, wrap on narrow screens. DOI stays in the APA citation line (APA requires it and it is already linked there), so no identifier is shown twice |
| Author status | quiet note on its own line | only when relevant (see §1) |

- "N authors" count is dropped (the names are in the citation line).
- **Bug fix in passing:** papers built only from the live library read currently carry their
  source as `type` (`mergeAndEnrichPublications` Pass 3 sets `type: sp.source`, e.g. "scopus").
  The type pill must never show a source name; such papers show type only if it is a real
  `ResearchOutputType` value.
- Labels go through the page's existing TH/EN dictionary `T`.

## 3. Top venues

Remove the Top venues block from `ResearchSummarySection` (`profile-view.tsx`). The external
staff-profile API keeps returning `research.topVenues` unchanged (it is part of
`staff-profile.v1`).

## 4. My teaching evaluation panel

Replaces the link card after the Teaching section; shown only on the user's own `/profile`
(`!publicMode && hasFacultyMemberRecord`), never on `/p/[slug]`.

### Data

- Server-side in `apps/web/app/profile/page.tsx`: `instructorPersonal(facultyMemberId)` from
  `@kku/db` — the same function `/staff/teaching` uses, so the two pages agree.
- denpong's data: 10 questions in 5 categories (active-learning 3, ethics 2, content-design 2,
  assessment 1, feedback 1) + 1 untagged; 1,880 answers; 10 terms (BE 2564 S1 – 2568 S2).
- **Category score** = respondent-weighted mean of the category's questions' `ratingAvg`,
  computed (a) all-time from `byQuestion[].ratingAvg/respondentCount` and (b) for the latest
  academic year from `byQuestion[].byYear[year]`. Pure function, own module, unit-tested.
- **Latest year** = the most recent `acadYearBE` with any data; **previous year** = the one
  before it with data.

### Layout

- Section title "My teaching evaluation" (TH: การประเมินการสอนของฉัน), Card like the other
  profile sections, with `<ProvenanceButton>` and `<FreshnessBadge>` (Council rules 1 and 3).
- **KPI tiles** (reuse the page's `StatTile` pattern):
  1. Overall rating — `x.xx / 5`;
  2. Latest academic year rating — `x.xx / 5`, with change vs the previous year
     ("▲ +0.16 vs AY 2567", tone by sign);
  3. Answers — labelled "Answers" with the hint "one per question answered, not students";
  4. Courses evaluated;
  5. Terms observed — count, with the BE year range.
- **Radar** (`RadarChartSmall` from `@kku/ui`, no new chart library): one axis per category
  present in the data (labels from the existing theme labels: Active learning, Ethics,
  Assessment, Feedback / Q&A, Content & design, English skills); series = latest academic year
  (solid) and all-time (dashed, `comparisons`); `domain = [3, 5]` with "Scale starts at 3, not 0"
  stated under the chart (the component's documented rule). A category with no answers in a
  series is `null` → rendered "n/d", never 0.
- **Companion table** beside the radar: Category · latest year · all-time, exact to 2 decimals.
- **Untagged questions** count toward the overall rating but have no axis; one-line note says so
  when any exist.
- Footer link: "Full breakdown by question and course →" `/staff/teaching`.
- Narrow screens: KPIs 2 columns; table below the radar.
- **Empty state:** "No student evaluations recorded yet", still linking to `/staff/teaching`.

## Testing

- Scholar list parser: author line from the existing real fixtures; `…`-terminated → shortened.
- Detail-page parser: against the newly captured real fixture.
- Sync runner: detail fetch only for shortened rows; never twice for a complete row; cap of 20
  per sync with pending count recorded; credits added to the run; a failed detail page leaves the
  row shortened and the run successful; no-delete invariant intact.
- Profile builder: Scholar rows use `scholar_authors`; the three author-status states.
- Evaluation aggregation: weighted category means (all-time and latest year), previous-year
  delta, null categories, untagged handling.
- Pills: render test — type hidden for Scholar rows, citations not rendered as a chip, a source
  name never rendered as a type.
- Every Tailwind class in changed files verified by compiling the stylesheet (the preset has no
  `-default` key for success/warning/danger and no bare `rounded`).
- Live on dev with denpong@kku.ac.th: archive re-parse (free), one real sync (≈15 credits per
  list page + 15 per shortened paper, ≤ cap), "co-authors could not be fetched" gone.
- Browser check by the user (no browser available to the agent).

## Out of scope

Changing `/staff/teaching`; deploying Scholar fetch to production; re-typing Scholar rows at
import (they stay stored as `JOURNAL`, only hidden in the pill row).
