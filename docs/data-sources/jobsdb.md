# JobsDB / SEEK

> ⛔ **SUPERSEDED 2026-05-01.** Replaced by [kmitl-skill-mapping](./kmitl-skill-mapping.md) — KMITL exposes aggregated LinkedIn + job-postings + grad data via free API, eliminating the JobsDB paid-access blocker. Catalog entry retained so historical IngestionRun rows don't orphan; full removal after kmitl-skill-mapping clears the 30-day green-history gate (per `docs/readiness-checklist.md` gate 11).

**Slug:** `jobsdb` · **Phase:** B · **Kind:** API · **Cadence:** every 6h · **Status:** 🚧 mocked (deprecated)

---

## What it is

ASEAN labor-market job postings — complements JobThai with regional coverage.

Requires paid access agreement.

## Access

| | |
|---|---|
| URL / endpoint | _tbd_ — fill in during the integration session |
| Auth | _tbd_ |
| Credentials env vars | _tbd_ |
| Rate limits | _tbd_ |
| Concurrency we'll use | _tbd_ |
| Request timeout | _tbd_ |
| Data residency | _tbd_ |

## Data shape (real source)

_tbd_ — paste a sample record / describe the PDF structure during the integration session.

## Mapping to our schema

| Source field | Our target | Table(s) | Notes |
|---|---|---|---|
| _tbd_ | _tbd_ | _tbd_ | |

## Backfill plan

- **Horizon:** _tbd_
- **Chunking:** _tbd_
- **Sanity check:** _tbd_

## Monitoring after go-live

- Source-specific failure modes: _tbd_
- Freshness alert: > 2× cadence stale
- Validation error rate: > 10% fails the ingestion run

## Contact

| Role | Person | Contact |
|---|---|---|
| Owning division | _tbd_ | _tbd_ |
| Technical contact | _tbd_ | _tbd_ |
| Escalation | _tbd_ | _tbd_ |

## PDPA posture

- Personal data categories collected: _tbd_
- Legal basis (PDPA §24): _tbd_
- Retention: _tbd_
- Cross-border transfer: _tbd_

## Known issues

_(log dated entries as they come up)_

## Session log

_(log dated entries as the integration progresses)_
