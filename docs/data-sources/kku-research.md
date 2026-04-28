# KKU Research Outputs

**Slug:** `kku-research` · **Phase:** A · **Kind:** Two-source: OpenAlex (free) + Scopus (Elsevier API, KKU institutional license) · **Cadence:** quarterly · **Status:** 🚧 wiring in progress (prompt 14, session opened 2026-04-28)

---

## What it is

Publication output of KKU faculty members — journal articles, reviews, book chapters, conference papers, datasets, etc. Powers the Deep-Dive's research section, the Benchmarking module's research-output comparison vs peer institutions, and the Capability dimension of the health-score methodology.

Source strategy:
- **Primary: OpenAlex** (`https://api.openalex.org`) — free, no API key required, official open-data project, comprehensive coverage of 35,748 KKU works (CE 1948–2026, ~2,300/year recent). Polite pool (10 req/s) via the `mailto=` query param.
- **Enrichment: Scopus** (`https://api.elsevier.com/content/search/scopus`) — KKU has institutional API license. Adds Elsevier's curated metadata (author IDs, citation counts as of weekly refresh, normalized affiliations). Roughly 60-80% overlap with OpenAlex; we use it to fill in fields OpenAlex doesn't carry as cleanly (author IDs primarily).
- **Google Scholar — explicitly NOT used.** No official API. Unofficial scrapers (`scholarly`, `serpapi`) are either ToS-violating + IP-blocked, or paid third-party wrappers ($50+/mo). OpenAlex covers ~95% of what Google Scholar shows, with the remaining 5% being preprints + low-quality grey literature we don't need for Council-level analysis.

## Access

| | OpenAlex | Scopus |
|---|---|---|
| URL | `https://api.openalex.org` | `https://api.elsevier.com/content` |
| Auth | none required (`mailto=` for polite pool) | `X-ELS-APIKey` header (always) + `X-ELS-Insttoken` header (when off-campus) |
| Credentials env | `OPENALEX_MAILTO` (optional, recommended) | `KKU_SCOPUS_API_KEY` (required), `KKU_SCOPUS_INST_TOKEN` (recommended) |
| Rate limit | 10 req/s polite pool / 1 req/s anonymous | typically 20,000 req/week per institutional plan |
| Concurrency we'll use | 1 (sequential paginated) | 1 |
| Request timeout | 30s | 30s |
| Data residency | global CDN | global CDN (Elsevier) |

### Discovery findings (live, 2026-04-28)

**OpenAlex (no key required):**
- KKU institution ID: **`I179193067`** (verified via search "Khon Kaen University", country_code = TH)
- ROR: `https://ror.org/03cq4gr50`
- Total works on file: **35,748**
- Recent annual output: 2025 = 2,588 / 2024 = 2,331 / 2023 = 2,121 / 2022 = 2,366 / 2021 = 1,984 / 2020 = 1,701
- By type: 76% journal articles, 2% preprints, 2% reviews, 1.6% book chapters, 0.4% datasets, plus small tails
- Author records on each work include ORCID where the author has registered one — gold for matching to FacultyMember (once we populate ORCID column)

**Scopus (key not yet supplied — discovery deferred):**
- The discovery script's `scopus-discover` and `scopus-sample` subcommands skip cleanly with a clear "key missing" message when `KKU_SCOPUS_API_KEY` is unset. Re-run after key arrives.

## Data shape (real source)

**OpenAlex `Work` object** (relevant subset):
```jsonc
{
  "id": "https://openalex.org/W4231015464",
  "doi": "https://doi.org/10.1016/j.clnu.2018.08.002",
  "title": "GLIM criteria for the diagnosis of malnutrition – A consensus report …",
  "publication_year": 2018,
  "type": "article",
  "cited_by_count": 2689,
  "primary_location": {
    "source": { "display_name": "Clinical Nutrition", "type": "journal" }
  },
  "authorships": [
    {
      "author": {
        "id": "https://openalex.org/A5012345678",
        "display_name": "Sirinun Sriraj",
        "orcid": "https://orcid.org/0000-0001-2345-6789"
      },
      "institutions": [
        { "id": "https://openalex.org/I179193067", "display_name": "Khon Kaen University" }
      ]
    },
    // … more authors, possibly hundreds for big multi-institution papers
  ]
}
```

**Scopus search-result `entry` object** (relevant subset):
```jsonc
{
  "dc:identifier": "SCOPUS_ID:85123456789",
  "prism:doi": "10.1016/j.clnu.2018.08.002",
  "dc:title": "GLIM criteria for the diagnosis of malnutrition …",
  "prism:coverDate": "2018-12-01",
  "prism:publicationName": "Clinical Nutrition",
  "prism:aggregationType": "Journal",
  "citedby-count": "2689",
  "dc:creator": "Sirinun Sriraj",
  "author": [{ "authid": "57192345678", "authname": "Sriraj S.", … }]
}
```

## Mapping to our schema

### `FacultyMember` (existing — schema additions in this session)

Three new optional columns to enable robust author resolution:

| Column | Why | Source |
|---|---|---|
| `orcid` | gold-standard cross-system author identifier | OpenAlex `authorships[].author.orcid`; populated lazily as papers land |
| `openalexAuthorId` | OpenAlex author ID (e.g., `A5012345678`) — survives renames | OpenAlex `authorships[].author.id` |
| `scopusAuthorId` | Scopus AU-ID (e.g., `57192345678`) | Scopus `author[].authid` (when key available) |

All three are indexed for the matching path. Populated via the `kku-research` connector's first successful match, then re-used on subsequent runs.

### `ResearchOutput` (existing — schema additions in this session)

| Existing column | Notes |
|---|---|
| `facultyMemberId` | **made nullable** in this session. KKU-affiliated papers whose author can't be resolved to a FacultyMember row still land (with `null`) so we don't lose them — analyst can revisit. |
| `year`, `title`, `venue`, `citations`, `doi` | populated from OpenAlex / Scopus directly |
| `type` | mapped from `OpenAlex.type` → our `ResearchOutputType` enum (`article|review|book-chapter` → JOURNAL; `conference-paper` → CONFERENCE; `book` → BOOK; everything else → JOURNAL with note in metadata) |
| `scopusId` | populated when Scopus enrichment is on |

| New column | Notes |
|---|---|
| `openalexId` | unique, format `W<digits>` |
| `source` | `openalex` or `scopus` (the connector that wrote the row) |
| `kkuAuthorName` | the raw author display name as it appeared in the source — for analyst reconciliation when `facultyMemberId` is null |

Unique constraint on `openalexId` so the same paper is stored once regardless of how many KKU authors it has — multiple authors are connected via a join table OR by re-using the same row across faculty members. v1 picks the simplest: store one row per (paper × matched KKU author), with the unique constraint on `(openalexId, facultyMemberId)`. Unmatched papers (facultyMemberId NULL) get one row each.

## Aggregation contract

### Q1 — OpenAlex KKU works (free)

Paginated request:
```
GET https://api.openalex.org/works
  ?filter=authorships.institutions.id:I179193067,publication_year:>=2015
  &per_page=100
  &cursor=*
  &mailto=denpong@kku.ac.th
```

`cursor=*` enables OpenAlex's cursor-based pagination — recommended over `page=` for large result sets. Each next page passes the `meta.next_cursor` from the previous response. Stops when `meta.next_cursor` is null or empty.

Window: 2015 onwards by default (10 years); configurable via `KKU_RESEARCH_YEAR_FROM` env. Older papers are kept in OpenAlex but rarely needed for Council-level analysis (most cited papers in our sample are from 2014-2018).

### Q2 — Scopus enrichment (when API key present)

Same pattern:
```
GET https://api.elsevier.com/content/search/scopus
  ?query=AFFIL("Khon Kaen University") AND PUBYEAR > 2014
  &count=25
  &start=<offset>
  &sort=date
Headers:
  X-ELS-APIKey: <KKU_SCOPUS_API_KEY>
  X-ELS-Insttoken: <KKU_SCOPUS_INST_TOKEN>
  Accept: application/json
```

For each Scopus entry that has a DOI matching an existing ResearchOutput, update `scopusId` + `kkuAuthorName` (Scopus author display) + `citations` (Scopus's curated count). If no DOI match, insert as a new ResearchOutput with `source='scopus'`.

Scopus weekly quota (~20k requests at 25 results/page = 500k papers) covers KKU's ~30k papers comfortably. Burn rate per quarterly run: ~6%.

## Author resolution

Name-match algorithm in TS:
1. **ORCID exact match** (when present in source + on FacultyMember). Highest confidence; if a FacultyMember row has the ORCID, set `facultyMemberId` immediately.
2. **OpenAlex/Scopus author ID exact match**. After the first successful name-match, store the source author ID on FacultyMember; subsequent papers by the same author resolve directly without name-fuzz.
3. **Name match (English first)**. Compare `author.display_name` against `FacultyMember.nameEn` exactly (after trim + lowercase). If exact, set facultyMemberId. Tie-break by KKU-affiliation = true (we already filtered for that at the SQL level).
4. **Name match (Thai)**. Some KKU papers list Thai authors with Thai names; OpenAlex transliterates. Compare against `FacultyMember.nameTh` only as a last-resort fallback.
5. **No match → `facultyMemberId = null`**. Stored with `kkuAuthorName = author.display_name` for analyst triage. Tracked in `IngestionRun.metadata.unmatchedAuthorsCount`.

Don't use Levenshtein / fuzzy match for v1 — false positives on common Thai names (e.g., dozens of KKU faculty named "Somchai") would mis-attribute papers. Exact match + ORCID + author IDs are the only auto-resolutions; everything else queues for human review.

## Backfill plan

- **Horizon:** publication_year ≥ 2015 (10 years rolling). Older papers reachable via env override.
- **Chunking:** OpenAlex cursor-paginated at 100/page; full pull is ~250 pages × ~22k recent papers = ~22 minutes wall-clock at polite-pool throttle.
- **Sanity check:** total ResearchOutput rows after first full run should be in the 20k–35k range; per-year distribution should match OpenAlex's published yearly counts within 5%.

## Monitoring after go-live

- OpenAlex: 5xx errors → retry with exponential backoff. 429 errors → halt, wait 60s, resume.
- Scopus: 401 → API key expired or wrong inst token; halt + alert. 429 → weekly quota hit; halt + retry next run.
- Schema drift on either source → connector throws `NonRetryableError` (Zod-validated row schema).
- **Freshness alert:** > 100 days since last successful run (cadence is quarterly = 90 days).
- **Coverage drift:** if total ResearchOutput count changes by > 50% run-over-run, flag for review (might indicate filter regression or upstream incident).

## Contact

| Role | Person | Contact |
|---|---|---|
| OpenAlex (open data, no contract) | OpenAlex team | https://help.openalex.org/ |
| Scopus subscription | KKU Library / Elsevier representative | _tbd_ — KKU Library knows the contact |
| Internal owner (this project) | Denpong Soodphakdee | denpong@kku.ac.th |

## PDPA posture

**OpenAlex / Scopus:**
- Personal data carried: author display names, affiliations, ORCIDs (where authors registered them). All public — names appear on the published papers themselves; ORCIDs are author-self-asserted public identifiers.
- Personal data this connector reads: **author names + ORCIDs only**, for matching to FacultyMember rows. Author email + per-author career history fields available on OpenAlex/Scopus are NOT read.
- Legal basis (PDPA §24(1)): the data subject has made the data manifestly public by publishing it. §24(4) — necessary for legitimate interests of the controller (KKU governance / Council strategic decisions) also applies.
- Retention: as long as the publication is publicly retrievable; if a paper is retracted upstream we mirror that on the next sync.
- Cross-border transfer: data already public globally; no PDPA cross-border concern.

**DPO sign-off:** preview-quality only until 30-day green-history gate (start: first run); production readiness pending the standard 12-gate audit.

## Known issues

_(log dated entries as they come up)_

- **2026-04-28** — OpenAlex `total_works` shown by the institutions endpoint (35,748) and the works-search endpoint (29,784 with default filter) differ slightly because the latter excludes types like grants and proceedings-articles. Both numbers are plausible; the search-endpoint count is what we'll see at fetch time.
- **2026-04-28** — Scopus AU-IDs are unstable in rare cases — Elsevier merges duplicate authors over time, leaving stale IDs. We treat scopusAuthorId as a hint, not the source of truth; ORCID + name-match are the canonical pairs.

## Session log

- **2026-04-28 (Phase 2 — Claude)** — endpoint clarified by user: Scopus (KKU has institutional API key, available via KKU network) + Google Scholar (explicitly declined — no official API; OpenAlex covers the ground for free). Wrote `apps/ingestion/src/scripts/capture-research-sample.ts` with 4 subcommands (`openalex-discover`, `openalex-sample`, `scopus-discover`, `scopus-sample`). Discovery: KKU's OpenAlex institution ID = I179193067, total works = 35,748, recent yearly output ~2,300 papers/year. Scopus subcommands skip cleanly without API key. Q1/Q2 design locked. **(continuing — schema migration + connector + 3 green runs not yet committed)**
