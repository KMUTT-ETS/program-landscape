# /profile page — architecture

> Per-user academic-resume page at `/profile`. Aggregates User →
> FacultyMember → ProgramFaculty → ResearchOutput plus DS2003 education
> + kkuscholar / Scopus publications + AI expertise narrative + avatar
> upload. Profile-page-only paths use Scopus directly; bulk modules
> (cockpit, gap, benchmarking) keep using the kkuscholar mirror.

---

## Sections

| Section | Source | Notes |
|---|---|---|
| Hero (name + rank + faculty + ORCID + Scopus ID + OpenAlex ID + avatar + KKU logo) | User + FacultyMember | Rank-prefixed Thai name (`ผศ. ดร. เด่นพงษ์ สุดภักดี`); avatar uploadable via `react-easy-crop` modal. |
| Expertise narrative (AI) | `expertise-narrative.v2` prompt | Pure expertise extraction — no biography, no counts, no venues. Auto-fires on first load; cached in `user_expertise_narratives`. |
| Education | UNICON DS2003 (`StaffEducationHistory`) | Bridged via `FacultyMember.citizenIdHash`. Falls back to `FacultyMember.academicQualification` parser. |
| Research summary | derived from publications | Papers count, citations, **h-index**, years active, peak year, first-publication year, top venues. |
| Programs taught | `ProgramFaculty` | Grouped by role: COORDINATOR / CORE / SUPPORT. |
| Publications | Google Scholar once imported, otherwise Scopus (primary) + kkuscholar (fallback); plus local rows, cache, and external DOI / metadata fallback | APA-7 citations, full author lists with the owner's surname **bolded**, paginated 20/page. |

---

## Publications pipeline

```
getProfileData(userId)
  └── loadPublicationsWithCache(userId, compute) [user_publications_cache]
         │ decidePublicationsCacheAction() — @kku/db
         │ cache miss                 → run compute() → write cache
         │ fetched_at = epoch         → run compute() → write cache
         │   (the Scholar runner's invalidation sentinel: a sync's
         │    result must be on the VERY NEXT load, not the one after)
         │ cache hit (< 24h)          → serve
         │ cache hit (≥ 24h)          → serve + fire-and-forget refresh
         │
         └── computePublications(member, dedupedLocal, scholarIsPrimary):
              │ ONE implementation, shared with the home-page sparkline
              │ (getHomePublicationsSnapshot) — both write the same
              │ cache row, so two copies would race.
              │
              │ scholarIsPrimary = hasScholarImport(research_outputs)
              │   i.e. the Scholar runner has written ≥ 1 row here.
              │
              ├── TRUE  → the live library read is SKIPPED entirely.
              │           The list is built from research_outputs alone
              │           (Scholar rows AND library rows — precedence
              │           decides which source builds the page, it never
              │           removes a paper), then enriched by step 4.
              │           Skipping the live read is also what stops the
              │           double listing: a Scholar row carries no DOI,
              │           Scopus id or PMID, so the merge cannot tell it
              │           apart from the same paper arriving live.
              │
              └── FALSE → steps 1-3 below, as before.
              ┌───────────────────────────────────────────────────────┐
              │ 1. Resolve scopusAuthorId                              │
              │    a. FacultyMember.scopusAuthorId (cached)            │
              │    b. resolveScopusAuthorId(name + KKU affiliation)    │
              │       → Scopus author search /content/search/author   │
              │       → pick highest works-count candidate             │
              │       → fire-and-forget cache to FacultyMember        │
              │                                                        │
              │ 2. fetchPublicationsByScopusAuthor(scopusAuthorId)    │
              │    → /content/search/scopus?query=AU-ID(...)          │
              │      &field=author  (per-paper author lists inline)   │
              │    → paginated 25/page, hard cap 20 pages              │
              │                                                        │
              │ 3. Fallback: kkuscholar (only if Scopus = 0 papers)   │
              │    fetchKkuScholarPublicationsByPerson(...)           │
              │    → Scopus + PubMed + ISI + TCI from the mirror      │
              │                                                        │
              │ 4. mergeAndEnrichPublications(scholar + dedupedLocal) │
              │    → dedup by DOI > scopusDocId > pmid > openalexId   │
              │    → external DOI fallback for any paper still         │
              │      missing authors:                                  │
              │      (a) OpenAlex /works/doi:<doi>                    │
              │      (b) Scopus /content/abstract/doi/<doi>           │
              │    → metadata search fallback (title + surname        │
              │      verified):                                        │
              │      (a) OpenAlex /works?search=<title>&filter=        │
              │          raw_author_name.search:<surname>              │
              │      (b) Scopus /content/search/scopus?query=          │
              │          TITLE("...") AND AUTHLAST(...)                │
              │                                                        │
              │ 5. summariseResearch(publications)                    │
              │    → totals + h-index + venues + year span             │
              └───────────────────────────────────────────────────────┘
```

**Cold load**: ~5 s.
**Warm load** (cache hit): ~10 ms.

The cached payload is the final `PublicationEntry[]` (already enriched
with author lists), not the raw external responses, so warm reads need
zero outbound network traffic.

### Why Scopus-direct ONLY for the profile page

- The Scopus `AU-ID(<id>)` query returns up to 25 papers with full
  author lists in ~1.5 s — single-author lookup, surgical.
- Bulk modules (cockpit, gap-analyzer, benchmarking) iterate over
  thousands of KKU researchers. Doing that against Scopus would burn
  through the institutional 20k-req/week limit in days. They continue
  to read from kkuscholar, which is on KKU's internal network and
  refreshed nightly by the kku-research connector.
- The split is enforced by file location:
  - Profile-page-only:
    `apps/web/src/lib/scopus-publications.ts`,
    `apps/web/src/lib/external-publications.ts`
  - Bulk-only:
    `apps/ingestion/src/connectors/sources/kku-research/`,
    `@kku/db/research-*` query helpers

---

## Persistence

Three new tables (all per-user, cascade on User delete):

| Table | Purpose | Key |
|---|---|---|
| `user_expertise_narratives` | AI expertise blurbs (TH + EN + keyword arrays) | `(user_id, method_version)` |
| `user_publications_cache` | Cached enriched publication list | `user_id` (unique) |
| `users.avatar_storage_key` + `users.avatar_updated_at` | MinIO key for the uploaded photo + last-update timestamp for cache-busting | per-User |

All four migrations:
- `20260510120000_user_employee_id` — `User.employeeId` HR cleartext
- `20260510140000_user_expertise_narrative`
- `20260510160000_user_avatar`
- `20260510180000_user_publications_cache`

---

## Avatar upload

- **POST `/api/profile/avatar`** — multipart/form-data, JPEG/PNG/WebP, ≤ 4 MB. Authenticated. Writes to MinIO `avatars/<userId>.jpg`, persists `User.avatarStorageKey` + bumps `avatarUpdatedAt`.
- **GET `/api/profile/avatar/[userId]`** — streams the bytes. 24 h browser cache, `?v=<timestamp>` cache-bust on update. No auth on GET (avatars are non-sensitive directory-grade content).
- **`react-easy-crop`** modal: square 1:1, 1×–4× zoom, drag-to-pan, output 512×512 JPEG quality 0.92.
- Same image surfaces in three places:
  - Profile-page hero (216×216)
  - Top-bar dropdown trigger (48×48)
  - Sidebar footer chip — Note: chip dropped 2026-05-09; sidebar footer is now credits-only.

MinIO bucket `avatars` is auto-created on first upload (via
HEAD-then-create idempotent bootstrap).

---

## AI expertise narrative

- **Prompt**: `expertise-narrative.v2` (`packages/shared/src/ai/prompts/expertise-narrative.ts`)
- **Inputs**: `education[]` strings + `publicationTitles[]` (top 30 by citation × year).
- **Output**: `narrativeTh` + `narrativeEn` + `expertiseKeywordsTh[]` + `expertiseKeywordsEn[]` (parallel order) + confidence.
- **Hard rules**: no biography, no counts, no citation totals, no venue names, no program names. Pure expertise extraction.
- **Auto-fires** on first profile-page load when no cached narrative exists. Subsequent loads serve from cache; users can hit "Regenerate" to refresh.
- **Persistence**: `user_expertise_narratives` keyed on `(userId, methodVersion)` so a prompt-template upgrade transparently writes a new row alongside the old one.

---

## KKU branding

- **Logos**: `apps/web/public/brand/kku-logo-light.png` (black) + `apps/web/public/brand/kku-logo-dark.png` (white). Source: Cabinet-mandated KKU official logo set.
- **Theme switching**: pure CSS via Tailwind's `dark:` modifier (resolves against `data-theme="dark"` on `<html>`). Both variants always render; CSS hides the wrong one.
- **Three placements**:
  - LeftNav brand mark (replaces the coral-K monogram)
  - Profile-page hero, top-right corner
  - Browser favicon (`apps/web/app/icon.png` — 256×256 transparent square with the logo padded inside; rebuild via `pnpm tsx scripts/build-favicon.ts`)

---

## Files added / changed

```
apps/web/
  app/
    api/
      profile-narrative/route.ts            (POST: AI narrative)
      profile/avatar/[userId]/route.ts      (GET: stream bytes)
      profile/avatar/route.ts               (POST: upload)
    icon.png                                 (favicon, square padded)
    profile/
      avatar-uploader.tsx                   (react-easy-crop modal)
      page.tsx                              (server component)
      profile-view.tsx                      (client component)
  public/
    brand/
      kku-logo-dark.png
      kku-logo-light.png
  src/
    lib/
      avatar-storage.ts                     (MinIO put/get/delete)
      display-name.ts                       (rank-prefixed name + avatar URL)
      external-publications.ts              (OpenAlex / Scopus DOI + metadata)
      kku-publications.ts                   (kkuscholar fetcher; profile-only)
      profile-data.ts                       (orchestrator + cache layer)
      profile-narrative.ts                  (AI call wrapper)
      profile-types.ts                      (client-safe types + APA formatter)
      scopus-publications.ts                (Scopus AU-ID search; profile-only)

packages/
  db/prisma/
    migrations/
      20260510120000_user_employee_id/
      20260510140000_user_expertise_narrative/
      20260510160000_user_avatar/
      20260510180000_user_publications_cache/
    schema.prisma                           (+ User.employeeId, User.avatar*,
                                              UserExpertiseNarrative,
                                              UserPublicationsCache)
  shared/src/ai/prompts/
    expertise-narrative.ts                  (v2 prompt template)
```
