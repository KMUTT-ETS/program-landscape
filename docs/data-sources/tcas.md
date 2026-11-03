# ทปอ. TCAS

**Slug:** `tcas` · **Phase:** B · **Kind:** MIXED · **Cadence:** annual · **Status:** real (round-3 max/min statistics)

---

## What it is

Central university admission system — TGAT/TPAT score distributions per program.

Mix of PDF + Excel. Annual release per admission cycle.

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


## Files, years and matching (adopters)

- **File list.** Each run reads `https://www.mytcas.com/stat` (fetched with a browser user-agent, because the page refuses bot agents), keeps the `.xlsx` links under `assets.mytcas.com` that are round-3 max/min files, derives the Buddhist-era year from the path (`/69/`) or `TCAS69`, and merges them with a built-in list (TCAS62 to TCAS69). If the page cannot be read the built-in list is used. The run metadata records `fileListSource` as `discovered` or `built-in`. Adding a year needs no code edit when the page lists it; otherwise append it to `BUILT_IN_TCAS_FILES` in `apps/ingestion/src/connectors/sources/tcas/files.ts`.
- **Round 3.1 / 3.2 (2568).** The two files are stored as separate rounds. Their figures can repeat, so count each course code once per year in any roll-up.
- **Own-programme matching.** A row is attached to one of your programmes only when its institution (สถาบัน) equals the organisation Thai name in `/admin/organization` exactly, spelled as TCAS spells it. Campus (วิทยาเขต) is not distinguished. Unmatched rows are counted in `ownUnmatched` with samples in `unmatchedSamples`.
