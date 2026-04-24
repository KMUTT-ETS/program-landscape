# <SOURCE NAME>

**Slug:** `<slug>` · **Phase:** A / B / C · **Kind:** API / PDF / SCRAPE / MIXED · **Cadence:** `<cron or prose>` · **Status:** 🚧 mocked / 🔄 wiring / ✅ real

---

## What it is

1–2 sentences describing the source. Who owns it, what it publishes, why we need it.

## Access

| | |
|---|---|
| URL / endpoint | |
| Auth | API key / OAuth / basic / SSO token / scraping (cookie) |
| Credentials env vars | e.g. `KKU_REGISTRY_API_KEY`, `KKU_REGISTRY_BASE_URL` |
| Rate limits | |
| Concurrency we'll use | e.g. 1 req / 2 s |
| Request timeout | |
| Data residency | Thailand-internal / third-country (PDPA implication) |

## Data shape (real source)

Describe the payload the source returns. For an API, paste a sample JSON record (trimmed). For a PDF, describe the document template + section structure.

```json
{
  "example": "..."
}
```

Notable gotchas (nullable fields, pagination quirks, language mix, historical coverage):

-

## Mapping to our schema

| Source field | Our target | Table(s) | Notes |
|---|---|---|---|
| `<source_field>` | `<NormalizedRecord.targetField>` | `<Prisma model>` | |

Flag any mappings that require a schema change — do them as a separate PR, not silently denormalise.

## Backfill plan

- **Horizon**: how far back to fetch.
- **Chunking**: how to break the backfill into batches (by year, region, etc.).
- **Sanity check**: what to compare against to confirm the backfill is correct.

## Monitoring after go-live

Specific failure modes to alert on:

- Source-specific — e.g. upstream quota exhausted, schema drift, authentication expiry.
- Generic — per-source freshness (> 2x cadence stale), error rate > 10%, validation failures.

## Contact

| Role | Person | Contact |
|---|---|---|
| Owning division | | |
| Technical contact | | |
| Escalation | | |

Record the conversation log when the project kicks off (date of first meeting, outcomes, commitments).

## PDPA posture

- Personal data categories collected: *none* / list.
- Legal basis (PDPA §24): .
- Retention: .
- Cross-border transfer: *no* / describe.

Link back to [`../pdpa.md`](../pdpa.md) when the answer changes what's documented there.

## Known issues

A running log as the integration lands + matures. Date each entry.

- `YYYY-MM-DD` — …

## Session log

- `YYYY-MM-DD` — kickoff: read the mock, agreed on mapping.
- `YYYY-MM-DD` — real connector landed; flipped `CONNECTOR_<SLUG>_MODE=real` in staging.
- `YYYY-MM-DD` — backfilled last 24 months.
- `YYYY-MM-DD` — promoted to prod.
