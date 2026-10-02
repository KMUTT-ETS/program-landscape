# External grant engagement — a Program Health Score driver (Spec 2 of 2)

**Date:** 2026-10-02 · **Status:** approved in brainstorming, awaiting spec review
**Builds on:** Spec 1, `docs/superpowers/specs/2026-10-02-research-service-grants-design.md`
(connector `kku-research-services`, shipped in v2.0.0).
**Methodology change:** `health-score.v5.2 → health-score.v5.3`.

## 1. Purpose

Spec 1 shows research and academic-service grants on the dashboard, the profile and the API, but
leaves every health score unchanged. This spec adds one driver to the **capability** dimension, so
that a programme whose teaching team is externally funded scores higher than one whose team is not.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **Breadth, not volume.** The driver measures the share of a programme's active teaching staff who are on at least one externally funded project. It does not count projects or baht. One prolific investigator or a stream of small service contracts can't carry a programme, and budgets are whole-project figures that the source never splits. |
| D2 | **Target: 60 % → 100.** `score = clamp(share / 0.60 × 100)`, a fixed linear target in the same style as `senior_rank_share` (50 % → 100). |
| D3 | **Gated on 30 days of green history** (readiness gate 11), enforced in code. The driver is null until the source qualifies on that server, then switches on by itself. No second release and no manual flag. |
| D4 | **`pmu_okr = 'ซ้ำPMU'` is ignored.** Confirmed 2026-10-02 to be an external parameter, not a duplicate marker. `acro` is unused. |

## 3. Measured basis (dev, 2026-10-02, window FY 2567–2569)

285 programmes have active teaching staff. 260 of them have at least one funded staff member.

| Share of a programme's staff on ≥1 project | p25 | median | p75 |
|---|---|---|---|
| | 22 % | 36 % | 56 % |

Under D2 a median programme scores about 60, and the top quarter scores about 93–100.

For comparison, the volume alternatives that were rejected:

| Volume alternative (rejected) | median | p75 | p90 |
|---|---|---|---|
| projects per staff member | 0.73 | 1.33 | 2.42 |
| research only | 0.38 | 0.78 | 1.35 |
| academic service only | 0.20 | 0.50 | 1.10 |

## 4. Definition

- **Label:** `external_grant_engagement`, a fifth driver in `DIMENSION_DRIVERS.capability` (`packages/db/src/health-score.ts`).
  - Drivers stay equal-weighted inside a dimension, so each capability driver now carries 20 % instead of 25 %.
  - The overall score is still the equal mean of the non-null dimensions.
- **Staff:** the programme's `ProgramFaculty` rows whose `facultyMember.isActive`. This is the same set the other capability drivers use.
- **Funded:** a staff member is funded when some `research_service_project_members` row carries their `facultyMemberId` (role LEAD or CO_INVESTIGATOR) on a project whose `fiscalYearBe` is in the window.
  - Every row read passes `realDataWhere()`.
  - It applies to both research and academic-service projects, of any project type and any workflow status.
- **Window:** the **last three complete Thai fiscal years**.
  - The fiscal year runs from 1 October to 30 September.
  - FY (BE) for a date = its calendar year + 543, + 1 if the month is October or later.
  - The window is `[currentFy − 3, currentFy − 1]`. On 2026-10-02 the current FY is 2570, so the window is 2567–2569.
  - Dates are taken in Bangkok time.
- **Value:** `share = fundedStaff / staff`; `value = clamp((share / 0.6) × 100)`.
- **`raw` field:** `{ fundedStaff, staff, share, windowFyBe: [from, to], target: 0.6, gate }`.
- **Faculty and university scope:** the same formula over the distinct active staff across the scope's programmes, mirroring how `scoreCapabilityScope` counts publications. A person who teaches in two programmes counts once.

## 5. No-data rules and the gate

The existing rule holds: **missing data is null, never 0**. A null driver is left out of the dimension mean and lowers `dataCompletenessPct`.

| Situation | Value | `raw.reason` |
|---|---|---|
| No active teaching staff | whole capability dimension is no-data (existing `noDataScore`) | — |
| No successful `kku-research-services` run on this server | null | `source-not-synced` |
| Source has not yet earned 30 days of green history | null | `awaiting-green-history` (+ `daysOfHistory`, `successfulDaysLast30`) |
| Latest successful run older than 72 h | null | `source-stale` (+ `lastSuccessAt`) |
| Gate open, staff present, nobody funded | **0** | — (a real zero: the view covers all external grants, so absence means no grant) |

**Green history** is computed from `ingestion_runs` joined to `data_sources.slug = 'kku-research-services'`, `status = 'SUCCEEDED'`. All three must hold:

1. the first successful run completed at least **30 days** ago;
2. at least **25 of the last 30** Bangkok calendar days have a successful run;
3. the latest successful run completed within **72 hours**.

When more than one condition fails, the reason reported is the first in this order: `source-not-synced`, `source-stale`, `awaiting-green-history`. The gate is a pure function of the run timestamps and `now`. The loader caches it per process for **5 minutes**, so scoring every programme costs one gate query, not 297.

**Disclosed undercount.** About 30 % of co-investigator IDs match no HR record (Spec 1). Those people can read as unfunded, so the share is a lower bound. This goes in the driver caveat and the methodology document.

## 6. Components

| Unit | Responsibility |
|---|---|
| `packages/db/src/grant-engagement.ts` (new) | Pure: `fiscalYearBe(date)`, `grantWindow(now)`, `engagementScore(funded, staff)`, `greenHistoryGate(successTimes, now)` → `{ open, reason, ... }`. Loader: `loadGrantGate(now?)`, cached 5 min; `fundedStaffIds(memberIds, window)`, one query. |
| `packages/db/src/health-score.ts` | Add the label to `DIMENSION_DRIVERS.capability`. Add the driver in `scoreCapabilityProgram` and `scoreCapabilityScope`. Bump `HEALTH_SCORE_VERSION` to `health-score.v5.3`. |
| Driver labels and marks (web) | Readable label EN "External grant engagement" / TH "การมีส่วนร่วมในทุนภายนอก" wherever driver labels are mapped. `DRIVER_SOURCE_MARK.external_grant_engagement = 'kku-research-services'`. Plain-text rendering of the three null reasons, e.g. "Waiting for 30 days of grant-sync history (12 so far)". |
| Docs | See §7. |

No raw SQL and no `Prisma.sql` fragments: plain Prisma queries only, because health scores are read inside Next.js server components.

## 7. Versioning and documentation

- `HEALTH_SCORE_VERSION`: `health-score.v5.2` → `health-score.v5.3`.
  - Stored snapshots keep their old stamp.
  - The methodology bundle fingerprint moves; update any test that pins it.
- `docs/methodologies/health-score.md`: driver row, formula, window, gate, null rules, the undercount caveat, a v5.3 revision note.
- In-app methodology paper (both languages): the capability driver list and a new revision row.
- `docs/evaluation-pipeline.md`: lifecycle verdict and risk see this change through the capability dimension.
- `docs/readiness-checklist.md`: gate 11 is enforced in code for `kku-research-services`.
- Changelog: at release time.

## 8. Testing

- **Pure tests (`packages/db/test/grant-engagement.test.ts`):**
  - fiscal year on 30 Sep vs 1 Oct, in Bangkok time near UTC midnight;
  - the window;
  - score at 0 %, 36 %, 60 %, 90 % and with zero staff;
  - every gate state: never synced; under 30 days; enough age but fewer than 25 of 30 days; stale over 72 h; open.
- **Scorer tests:**
  - mixed funded and unfunded staff;
  - inactive staff excluded;
  - a project outside the window ignored;
  - at scope level, a person in two programmes counted once;
  - gate closed → null with its reason, other capability drivers unaffected.
- **Existing suites:** update the driver-parity, methodology-bundle and health-score tests that enumerate drivers or pin the version.
- **Live check on dev:**
  - With the gate closed (dev has a single day of history), the cockpit and deep-dive show the awaiting-history reason, and capability scores do not move.
  - With a test-only `now` override in a throwaway script, the gate opens, and a few programmes' values line up with §3's distribution.

## 9. Out of scope

- A volume or budget driver.
- Separate research and service drivers.
- Discipline-banded targets.
- Using `acro`.
- Re-weighting dimensions.
- Backfilling stored snapshots under v5.3.
