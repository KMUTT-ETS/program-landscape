# OpenAlex publications

**Slug:** `openalex-works` · **Phase:** C · **Kind:** API · **Cadence:** quarterly once a schedule is enabled (off by default) · **Status:** ✅ real

---

## What it is

OpenAlex is an open catalogue of scholarly works. The connector pulls every work whose authorships list your university, so a new installation gets a publication record without a spreadsheet. It feeds the same `research_outputs` table as the Publications spreadsheet, so the research-expertise, health-score and Deep-Dive readers use it unchanged.

## Access

| | |
|---|---|
| URL / endpoint | `https://api.openalex.org/works?filter=authorships.institutions.id:<id>,publication_year:><year-1>&per-page=200&cursor=*` |
| Auth | Free API key, `OPENALEX_API_KEY` (create at https://openalex.org/settings/api). Cursor paging past the first page needs it; without one the budget is tiny, so the run is skipped instead |
| Institution id | The **OpenAlex institution ID** field on `/admin/organization` (e.g. KMUTT is `I60837268`). Find yours at openalex.org by searching the university; confirm via its ROR id |
| Other env vars | `OPENALEX_YEAR_FROM` (earliest publication year, default 2015) |
| Rate limits | polite delay of 120 ms between pages; one retry after a 429 |
| Concurrency we'll use | 1 |
| Data residency | public data. Author names and ORCIDs are public by the act of publishing |

With the institution id or the key missing, the run is recorded as **SKIPPED** with the reason; nothing is fetched or written.

## Mapping to our schema

One `research_outputs` row per (work, matched author), `source = 'openalex'`, stamped with the run id.

| Source field | Our column | Notes |
|---|---|---|
| `id` (`W…`) | `openalexId` | |
| `doi` | `doi` | bare and lower-case (DOIs are case-insensitive) |
| `title` | `title` | |
| `primary_location.source.display_name` | `venue` | |
| `publication_year` | `year` | works without a year are skipped |
| `type` | `type` | `conference-paper`/`proceedings-article` → CONFERENCE; `book`, `book-chapter`, `reference-entry`, `monograph` → BOOK; everything else → JOURNAL |
| `cited_by_count` | `citations` | |
| author display name | `kkuAuthorName` | the column's historical name |

## Author matching

Exact only, in order: ORCID, OpenAlex author id, English name (lower-cased, trimmed), Thai name. A name shared by more than one staff member is left **unmatched** rather than guessed. Unmatched institution authors still produce a row with no staff member, for triage (first 50 listed in the run metadata).

A name match writes the author's ORCID and OpenAlex id back to the staff row so later runs match on the id. It only fills a column that is empty and only when no other staff member already holds that id (both columns are unique).

## Coexistence with the Publications spreadsheet

Before creating a row, the connector looks for a row for the same staff member and the same DOI from any source. If one exists it sets its `openalexId` (when empty) and raises its citation count (never lowers it), and leaves its provenance alone, so start-over of the spreadsheet still removes exactly what the spreadsheet wrote. Otherwise it upserts on (`openalexId`, staff member).

## Known limits

- Coverage depends on OpenAlex's affiliation data; a work with no institution on the authorship is not found.
- Name matching misses transliteration variants; fill ORCIDs in the Staff sheet to improve it.

## Session log

| Date | Event |
|---|---|
| 2026-11-04 | Revived from the retired kku-research v1 pull with the institution id and key as configuration. |
