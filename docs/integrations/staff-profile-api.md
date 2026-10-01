# Staff Profile API — integration guide

For teams building a KKU system that needs a staff member's profile from
Program Landscape as JSON. Version string: `staff-profile.v1`.

## 1. What it returns

`POST /api/v1/external/staff-profile` returns the data behind a staff member's
`/profile` page. `person` is always present; the other six sections are
returned only if your client was granted them.

- **`person`** — always. Staff record id, active flag, academic title, name (Thai and English), `displayName` (title plus name, ready to print), email, and identifiers (ORCID, Scopus author id, OpenAlex author id, Google Scholar profile id). `email` is non-null only for a client allowed to look up by email.
- **`affiliation`** — faculty and department (Thai and English) and the programmes the person is attached to, with their role (`COORDINATOR`, `CORE`, `SUPPORT`).
- **`education`** — degrees: qualification, level, major, institute, country, year (Buddhist Era).
- **`teaching`** — courses taught and students taught over the last five academic years: totals, per-year figures and every course in the window.
- **`research`** — papers, citations, h-index, years active, peak year, top venues.
- **`publications`** — the full paper list, newest first, each with an APA 7 string.
- **`teachingEvaluation`** — **opt-in.** Student course-evaluation ratings: overall, latest vs previous academic year, a score per question category, and a rating per course. This is performance data about the person, so no client receives it unless an admin grants it explicitly, and the grant needs a recorded basis (§9). Clients created before this section existed do not hold it.

## 2. Getting a key

Ask a Program Landscape system admin. Tell them:

- which system is calling and who owns it (a contact for that owner);
- which **sections** you need (grants are per client and minimal by default);
- which **lookup types** you will use (citizen id, email, or both);
- the IP range your server calls from. Per-client IP allowlists are available once enabled by the platform team; until then they are not enforced, so do not rely on them.

You receive one key, shown **once** at creation. Store it in your server's secret store, never in a browser or a repository. Keys can be rotated without downtime: the admin issues a second key, you switch over, the old one is revoked. A key may carry an expiry date.

## 3. Request

```bash
curl -sS --max-time 60 -X POST https://program-landscape.kku.ac.th/api/v1/external/staff-profile \
  -H 'Authorization: Bearer kpl_live_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX' \
  -H 'Content-Type: application/json' \
  --max-time 60 \
  -d '{ "email": "someone@kku.ac.th" }'
```

- **POST only.** A citizen id in a query string would be written to every proxy and access log on the way; a body is not.
- The body holds **exactly one** of:
  - `citizenId` — 13 digits with a valid Thai check digit. Dashes and spaces are accepted and stripped (`1-2345-67890-12-3` works).
  - `email` — trimmed and lower-cased before matching.
- Sending both, neither, or any other field is a 400.
- A staff member with neither a citizen-id hash nor a KKU email on record cannot be reached through this API; that is a data gap on our side.
- Inactive staff return 404 unless your client was granted `includeInactive`, in which case they are returned with `person.isActive: false`.

## 4. Response

Standard envelope `{ data, meta, error }`. A section is present only if granted.

```json
{
  "data": {
    "person": {
      "facultyMemberId": "cm…",
      "isActive": true,
      "title": { "th": "รองศาสตราจารย์", "en": "Associate Professor",
                 "abbrevTh": "รศ.", "abbrevEn": "Assoc. Prof." },
      "name": { "th": "…", "en": "…" },
      "displayName": { "th": "…", "en": "…" },
      "email": "someone@kku.ac.th",
      "identifiers": { "orcid": null, "scopusAuthorId": "…",
                       "openalexAuthorId": null, "scholarProfileId": null }
    },
    "affiliation": {
      "faculty":    { "th": "…", "en": "…" },
      "department": { "th": "…", "en": "…" },
      "programmes": [ { "code": "KKU-SEQ-0057", "nameTh": "…", "nameEn": "…",
                        "level": "BACHELOR", "role": "COORDINATOR" } ]
    },
    "education": [ { "qualification": "…", "level": "…", "major": "…",
                     "institute": "…", "countryCode": "US", "yearBE": 2548,
                     "source": "unicon-ds2003" } ],
    "teaching": {
      "available": true,
      "windowYearsBE": { "from": 2565, "to": 2569 },
      "totals": { "studentsTaught": 1840, "sections": 42, "distinctCourses": 9,
                  "activeSemesters": 10, "avgContactHrsPerWeek": 11.5 },
      "byYear":  [ { "yearBE": 2569, "sections": 8, "studentsTaught": 360,
                     "contactHrsPerWeek": 22 } ],
      "courses": [ { "code": "…", "nameTh": "…", "nameEn": "…", "sections": 10,
                     "studentsTaught": 420, "firstYearBE": 2565, "lastYearBE": 2569 } ]
    },
    "research": {
      "basis": "google-scholar",
      "totalPapers": 28, "totalCitations": 412, "hIndex": 11,
      "earliestYear": 1998, "latestYear": 2026, "yearsActive": 29,
      "peakYear": 2021, "peakYearCount": 5,
      "topVenues": [ { "venue": "…", "count": 4 } ]
    },
    "publications": [
      { "year": 2026, "title": "…", "venue": "…", "type": "article",
        "citations": 3, "source": "google-scholar",
        "doi": null, "scopusId": null, "pmid": null, "scholarPaperId": "…",
        "authors": [ { "family": "…", "given": "…", "initials": null } ],
        "authorsComplete": false, "apa": "…" }
    ],
    "teachingEvaluation": {
      "scale": { "min": 1, "max": 5 },
      "overall": 4.35, "totalAnswers": 1880, "courseCount": 1, "termCount": 4,
      "firstYearBE": 2566, "lastYearBE": 2568,
      "latestYearBE": 2568, "latestRating": 4.41,
      "previousYearBE": 2567, "previousRating": 4.30,
      "categories": [
        { "tag": "ethics", "labelEn": "Ethics", "labelTh": "คุณธรรมจริยธรรม",
          "questions": 2, "latest": 4.52, "allTime": 4.44 }
      ],
      "untaggedQuestions": 1,
      "courses": [
        { "code": "…", "nameTh": "…", "nameEn": "…", "rating": 4.35, "answers": 1880,
          "latestYearBE": 2568, "latestSemester": 2 }
      ]
    }
  },
  "meta": {
    "freshnessDate": "2026-09-29T02:10:00Z",
    "sources": [
      { "id": "kku-hr", "name": "KKU HR (staff record)" },
      { "id": "unicon-ds2003", "name": "UNICON DS2003 (education history)" },
      { "id": "kku-registry", "name": "KKU Registrar (class offerings)" },
      { "id": "kku-publications", "name": "KKU Publications mirror (Scopus, PubMed)" },
      { "id": "google-scholar", "name": "Google Scholar (on-demand import)" },
      { "id": "kku-evaluations", "name": "KKU student course evaluations" }
    ],
    "methodologyVersion": "staff-profile.v1",
    "caveats": [ "…" ],
    "integration": {
      "apiVersion": "staff-profile.v1",
      "generatedAt": "2026-09-30T07:50:00Z",
      "publicationsCache": "hit",
      "sectionsIncluded": ["person", "affiliation", "education", "teaching", "research", "publications", "teachingEvaluation"],
      "sectionsWithheld": []
    }
  },
  "error": null
}
```

### Field notes

| Field | Meaning |
|---|---|
| `person.name` / `person.displayName` | `name` is the bare name; `displayName` is the name as the profile page prints it. |
| `person.title.abbrev*` | Standard abbreviation of the academic rank (`รศ.`, `Assoc. Prof.`). |
| `education[].source` | `unicon-ds2003` (national staff database) or `fallback` (a value we derived because that record was missing). |
| `teaching.totals.studentsTaught` | A sum of enrolled seats, **not** distinct students: a student in two of the person's courses counts twice. Also stated in `meta.caveats`. |
| `teaching.courses` | Every course in the five-year window (the page shows only the top 10). |
| `research.basis` | `google-scholar` once any Google Scholar import exists for this person: the list is then Scholar papers plus library papers Scholar matched. `library` otherwise: Scopus and PubMed records held locally, plus a live Scopus read. Most staff are `library` today. |
| `research.hIndex`, `totalCitations` | Computed from the per-paper citation counts in `publications`; a paper with no indexed count contributes 0. Metrics are computed over the full list even if you are not granted `publications`. |
| `publications[].source` | Where that paper came from: `google-scholar`, `kku-publications:scopus`, `kku-publications:pubmed`, `openalex`, or `live:<scopus\|pubmed\|isi\|tci>` for a paper found only by the live read. |
| `publications[].authorsComplete` | `false` when the source gave a truncated author list. |
| **Sort order** | Publications: year descending, then citations descending, then title ascending. It is a total order, so two calls return the same sequence. |
| `teachingEvaluation` | **Opt-in** (see §1). `null` means your client holds the grant but the person has no student evaluations on record; a client without the grant gets no key at all and sees `teachingEvaluation` in `sectionsWithheld`. The `kku-evaluations` source and the two caveats below appear in `meta` only when the section is returned (including as `null`). |
| `teachingEvaluation.scale` | Always `{ "min": 1, "max": 5 }`; every rating is on that scale. |
| `teachingEvaluation.totalAnswers`, `courses[].answers` | Counts of **answers**, one per question answered — **not** students. A class of 30 answering a 20-question form gives 600. Also stated in `meta.caveats`. |
| `teachingEvaluation.termCount` | Terms (academic year + semester) with at least one answer. |
| `teachingEvaluation.latestRating` / `previousRating` | Answer-weighted mean over all terms of the latest / previous academic year with answers; `previous*` is `null` when only one year has data. |
| `teachingEvaluation.categories[]` | One per question category (`tag`), each the answer-weighted mean of its questions, all-time and for the latest year (`latest` is `null` if the category had no answers that year). Labels are given in English and Thai; an unknown tag is returned with the tag as its label. `untaggedQuestions` counts questions in no category; they count towards `overall` but not towards any category. |
| `teachingEvaluation.courses[]` | Every evaluated course, sorted by the term it was last evaluated (newest first), then course code. `rating` is the course's all-time answer-weighted mean. A course rating reflects the course as taught by this person, but students rate the whole course experience, and a course with few answers can swing on a handful of respondents — read it with `answers` beside it, and do not rank people by it. |
| `meta.freshnessDate` | When the publications list was last built. |
| `meta.integration.publicationsCache` | `hit` (fresh, under 24 h), `stale` (served immediately, refresh started) or `miss` (built during this call). |
| `meta.integration.sectionsIncluded` / `sectionsWithheld` | The sections returned, and the grantable sections your client does not hold. A withheld section is absent from `data`, not empty. `person` is never withheld. |

## 5. Errors

Failures use the same envelope with `data: null` and an `error` object
(`code`, `message`, optional `details`).

| HTTP | `error.code` | `details.reason` | When |
|---|---|---|---|
| 200 | — | — | Found |
| 400 | `VALIDATION_FAILED` | Zod issues | Not exactly one identifier; malformed or checksum-failing citizen id; malformed email; a body that is not valid JSON (message `Malformed JSON body`) |
| 401 | `UNAUTHORIZED` | — | Missing, unknown, revoked or expired key, or a disabled client. The response is **identical** for all of them, by design. |
| 403 | `FORBIDDEN` | `lookup_not_permitted` | Your client is not granted this lookup type |
| 403 | `FORBIDDEN` | `ip_not_allowed` | Caller address is outside your client's allowlist (only when allowlists are enabled) |
| 404 | `NOT_FOUND` | — | No match, or the person is inactive and your client is not granted inactive staff. Identical whichever identifier you used. |
| 429 | `RATE_LIMITED` | — | Per-client limit exceeded. `Retry-After` header gives seconds. |
| 500 | `INTERNAL` | — | Unexpected — including a granted section that could not be loaded (a granted `teachingEvaluation` is never silently dropped). The body carries no request id and never the identifier: quote the `x-request-id` **response header** when reporting (every response carries it). |
| 502 | `UPSTREAM_UNAVAILABLE` | — | Possible when a dependency behind the API is unreachable. Retry with backoff. |

A live publication source failing does **not** produce an error: you receive a
response built from locally held rows.

## 6. Performance

- The **first call for a person** can take up to about **45 seconds**: their publications are built live from Scopus, PubMed and the library mirror. Later calls for the same person within 24 hours are served from cache in milliseconds.
- Set a client timeout of **at least 60 seconds** (the gateway allows 90).
- Cold builds are capped platform-wide (4 at once by default); further first calls queue behind them. Concurrent calls for the **same** person share one build.
- **Do not loop over every staff member.** Each cold call spends the university's Scopus quota (20,000 requests a week, shared by the whole institution). Fetch on demand, cache on your side, and refresh no more than daily.

## 7. Limits

- **Per client:** a fixed window per minute, default 60 requests, set by the admin (1 to 600). Over the limit you get 429 with `Retry-After`. The limit is enforced even if the platform's counter store is briefly unavailable.
- **Per address (backstop):** the gateway allows 5 requests per second per source address with a burst of 20, separately from interactive users.
- Retry 429 and 502 with backoff; do not retry 400, 401, 403 or 404 unchanged.

## 8. Versioning

The version is `staff-profile.v1` (`meta.methodologyVersion` and
`meta.integration.apiVersion`). Adding a field keeps v1, so **ignore fields
you do not recognise**. Renaming or removing a field is a new version, served
alongside v1 until callers have migrated.

## 9. Privacy

- **Logged per call:** your client, the staff record matched (null on a miss), lookup type, HTTP status, sections returned, latency, caller IP and request id.
- **Never logged:** the citizen id, its hash, or the email you sent. Not in the call log, the application logs or error messages.
- Rejected `429` and `403 ip_not_allowed` calls are logged at most once per client per minute. A `403 lookup_not_permitted` is logged on every call (your rate limit bounds it).
- Call-log rows are deleted after **365 days**.
- The API discloses personal data about named staff. The **legal basis for your system receiving it is your own**, and must be recorded with the platform team before a key is issued. Grant and use only the sections you need, and do not pass the data on beyond that purpose.
- **`teachingEvaluation` is performance data** about the person (student ratings overall, by category and by course). It is disclosed only to a client explicitly granted that section, and the grant needs its own recorded basis — a basis for receiving staff directory data does not cover it.
