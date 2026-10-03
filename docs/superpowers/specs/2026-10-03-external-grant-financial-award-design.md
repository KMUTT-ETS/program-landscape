# External-grant award on the Financial dimension

**Date:** 2026-10-03 · **Status:** approved in brainstorming, awaiting spec review
**Supersedes:** `docs/superpowers/specs/2026-10-02-grant-engagement-driver-design.md` (the v5.3
capability driver and its 30-day gate).
**Builds on:** `docs/superpowers/specs/2026-10-02-research-service-grants-design.md` (connector
`kku-research-services`, shipped in v2.0.0).
**Methodology change:** `health-score.v5.3 → health-score.v5.4`.

## 1. Purpose

v5.3 added external grants as a fifth **capability** driver, averaged with the other four. That
design has two problems, raised by the product owner on 2026-10-03.

1. **It penalises.** A programme whose team has no grant scores a real 0 on the driver, and that 0
   drags Capability down. Grants do not measure the quality of teaching and learning, so their
   absence should not count against a programme.
2. **It is in the wrong dimension.** The value of external grants to a programme is financial.
   External money means the programme relies less on tuition fees and public funding.

v5.4 removes the capability driver and adds an **award** to the **Financial** dimension instead. The
award can only raise a score, never lower it.

v5.4 also drops the 30-day green-history gate. The source is the Research Office's own system of
record and keeps a cumulative history, so how long we have been syncing it says nothing about the
data's reliability.

## 2. Decisions

| # | Decision |
|---|---|
| D1 | **An award, not a driver.** It is added on top of the base Financial score after the drivers are averaged. No grant means +0. The award never touches `dataCompletenessPct`. |
| D2 | **Financial dimension only.** The overall score moves only through Financial, as one of five equal dimensions, so it rises by about award ÷ 5. A programme with a null base Financial score gets no award, and the award never creates a Financial score on its own. |
| D3 | **Measure: grant baht per active teaching staff member per year**, over the last 3 complete Thai fiscal years. Dividing by staff keeps a programme from winning only because it is large. |
| D4 | **Log curve, ฿0.1 M → ฿3 M, maximum +10 points.** The money is heavily skewed, so a programme's first million counts for much more than its fiftieth. |
| D5 | **No green-history gate.** The only check left is that the source has synced at least once on this server. This is an owner-approved exception to readiness gate 11, recorded in `docs/readiness-checklist.md`. |
| D6 | **The capability driver `external_grant_engagement` is removed.** Capability goes back to its four drivers at 25 % each. |

## 3. Measured basis (dev, 2026-10-03, window FY 2567–2569)

284 programmes have active teaching staff, and 260 of them have at least one project in the window.
253 have a Financial score. Of those 253, 23 have no project in the window, so their award is +0.

| Per programme | p25 | median | p75 | p90 |
|---|---|---|---|---|
| Grant ฿ per year | 3.9 M | 13.7 M | 36.7 M | 60.4 M |
| Grant ฿ per active teaching staff member per year | 0.36 M | 0.93 M | 1.94 M | 3.74 M |

The largest programme figure is ฿491 M a year.

**Award under D4**, over the 253 programmes with a Financial score:

| p25 | median | p75 | p90 | at the +10 cap |
|---|---|---|---|---|
| +2.0 | +6.2 | +8.3 | +10.0 | 26 (10 %) |

**Rejected alternatives:**
- **A linear curve, 0 → ฿2 M per staff = +10.** Median +4.1, but 48 programmes (19 %) reach the cap, so the top fifth is not separated.
- **Grant baht ÷ programme tuition.** Median 13×, p90 178×. The two figures are not comparable: the budget is a whole-project figure counted in every programme its team teaches in, while tuition is the programme's own. 31 programmes have no tuition row at all.
- **Share of staff funded (v5.3's measure).** Ignores money, which is the rationale.
- **A bonus on the overall score.** Considered and then declined by the owner in favour of D2.

## 4. Definition

### 4.1 Programme scope

- **Staff:** the programme's `ProgramFaculty` rows whose `facultyMember.isActive`, the same set the capability drivers use. `staff` = the number of distinct staff.
- **Projects:** distinct `ResearchServiceProject` rows that meet all three conditions:
  - at least one `ResearchServiceProjectMember` row (LEAD or CO_INVESTIGATOR) carries a staff member's `facultyMemberId`;
  - `fiscalYearBe` is in the window;
  - every row read passes `realDataWhere()`.
  - Both research and academic-service projects count, of any project type and any workflow status.
  - **A project counts once per programme**, however many of the programme's staff are on it.
- **Window:** the last three complete Thai fiscal years. `grantWindow(now)` (existing, Bangkok time, FY starts 1 October) gives `[currentFy − 3, currentFy − 1]`. On 2026-10-03 that is 2567–2569.
- **Money:** `bahtPerYear = Σ budgetThb / 3`. A project with a null `budgetThb` adds ฿0 but still counts in `projects`.
- **Measure:** `x = bahtPerYear / staff`.
- **Award points:**
  - `x ≤ 100,000` → `0`
  - otherwise `min(10, 10 × ln(x / 100,000) / ln(30))`
  - Reference values: ฿300k gives +3.2, ฿1 M gives +6.8, ฿3 M or more gives +10.
- **Financial score:** `min(100, baseFinancial + points)` when `baseFinancial` is not null. Otherwise the dimension stays null and the award is reported with `points: null`.

### 4.2 Faculty, department and university scope

- The scope uses the programme IDs from `collectProgramIdsForScope` (canonical, active), and `staff` = the distinct active teaching staff across those programmes.
- Projects are the distinct projects with at least one of those staff on them. **A project counts once per scope**, even when its members teach in several of the scope's programmes.
- The same formula applies, and the award is added to the scope's own Financial score on the same terms.
- The scope award is computed directly. It is **not** a mean of the programme awards, which mirrors how capability counts staff at scope level.

### 4.3 Source check

- The award needs **at least one SUCCEEDED `ingestion_runs` row** for `data_sources.slug = 'kku-research-services'`.
- Without one, the award is `{ points: null, raw: { reason: 'source-not-synced' } }` and the Financial score is the base score unchanged.
- The UI must say the data is not synced. It must not show "+0", so that an empty table never reads as "no programme has grants".
- The check is cached per process for 5 minutes against the real clock. This is the existing cache pattern, reduced to one condition.
- There is no age, cadence or staleness condition (D5).

### 4.4 Caveat

About 30 % of co-investigator IDs match no HR record, so some programmes' figures are understated.
The figure is a lower bound, and every rendering of the award carries this caveat. For an award, the
error can only withhold points, never take any away.

## 5. Data shape

`HealthScoreSchema` (`packages/db/src/health-score.ts`) gains one optional field:

```ts
award: z.object({
  label: z.literal('external_grant_award'),
  points: z.number().min(0).max(10).nullable(),
  baseScore: z.number().min(0).max(100).nullable(),
  raw: z.unknown(),
}).nullable().optional()
```

- Only the Financial dimension sets it. Every other dimension leaves it undefined.
- `raw` carries `{ bahtPerStaffPerYear, bahtPerYear, staff, projects, windowFyBe: [from, to], floorThb: 100000, capThb: 3000000, maxPoints: 10, caveat }`, or `{ reason }` with `points: null`. The reason is one of:
  - `'source-not-synced'`;
  - `'no-base-financial-score'`: base Financial is null, so the award is not computed and no grant query runs;
  - `'no-active-staff'`.
- Because the field is optional, stored decision snapshots and v5.3 rows still parse.
- The award is **not** listed in `DIMENSION_DRIVERS`. It is not an averaged driver, and the driver-parity guard is unchanged.

## 6. Components

| Unit | Change |
|---|---|
| `packages/db/src/grant-engagement.ts` → renamed `grant-award.ts` | Keep `fiscalYearBe` and `grantWindow`. Add `awardPoints(bahtPerStaffPerYear)` (pure). Add `loadGrantSourceSynced()` (cached 5 min). Add `grantAward(memberIds, now?)`, which runs one query for the distinct in-window projects of those members and returns the `award` object without `baseScore`. Remove `greenHistoryGate`, the gate types and `engagementScore`. |
| `packages/db/src/health-score.ts` | Remove the capability driver from `DIMENSION_DRIVERS.capability` and from both capability scorers. In `scoreFinancialProgram` and `scoreFinancialScope`, apply the award after `summariseDrivers`, through one helper `withAward(score, award)`. Bump `HEALTH_SCORE_VERSION` to `health-score.v5.4`. |
| Methodology bundle | `BUNDLE_CALENDAR_TAG` → `landscape-2026-10.v2`. |
| `apps/web/src/lib/grant-driver-note.ts` → `grant-award-note.ts` | A plain-text award line, the not-synced message and the caveat. Remove the three gate messages. |
| Deep-Dive (`apps/web/app/programs/[id]/client.tsx`) and print (`print/page.tsx`) | Below the Financial drivers, one line with the grants source mark: "External-grant award: +6.2 (฿1.0 M per teaching staff per year, FY 2567–2569) · base 61.4 → 67.6", then the caveat. A zero award reads "+0 (no external grant in the window)". Remove the `external_grant_engagement` label entries. |
| `apps/api/src/programs/program-detail-data.ts` | Remove the old label entry. Pass `award` through wherever the Financial dimension is serialised. |
| `apps/web/src/components/data-source-mark.tsx` | Map the mark to `external_grant_award` instead of the old driver label. |
| Cockpit | Heatmap Financial cells show the final score. The methodology/provenance text says Financial includes an external-grant award of up to +10. No new column. |
| Topology (`topology-data.ts`) | The grants edges now feed the Financial dimension in the Cockpit and the Deep-Dive. Fix the Cockpit node description, which still says "Health-score methodology v1". |

All database access uses plain Prisma queries, without `$queryRaw` and without nested `Prisma.sql`, because health scores are read inside Next.js server components.

## 7. Versioning and documentation

- `HEALTH_SCORE_VERSION` moves from `health-score.v5.3` to `health-score.v5.4`. Stored snapshots keep their old stamp.
- On prod, no published score changed under v5.3, because its driver read null behind the gate. Under v5.4, Capability completeness returns from 80 % to 100 %, and Financial scores rise by the award from the first page load after deploy, provided the source has synced.
- `docs/methodologies/health-score.md`: a v5.4 section with the formula, the rationale, the §3 distribution and the caveat. The v5.3 section is marked superseded.
- In-app methodology paper (`apps/web/app/docs/methodology/content-en.tsx`, `content-th.tsx`): a new revision row, the Capability driver list back to four, and an award subsection under Financial.
- `docs/evaluation-pipeline.md`: the award reaches the overall score, the BCG/KKU matrix, the lifecycle verdict and risk through the Financial dimension.
- `docs/readiness-checklist.md`, gate 11: replace the "enforced in code for `kku-research-services`" paragraph with a dated owner exception (2026-10-03, with the reason in §1).
- The v5.3 spec gets a "Superseded by" line at the top.
- CLAUDE.md status entry. The changelog entry is written at release time.

## 8. Testing

- **Pure tests (`packages/db/test/grant-award.test.ts`):**
  - `awardPoints` at ฿0, ฿100k, ฿300k, ฿1 M, ฿3 M and ฿50 M;
  - `fiscalYearBe` and `grantWindow` (existing cases carried over);
  - `withAward` with a null base (no award, score null), the cap at 100, and `dataCompletenessPct` unchanged.
- **Scorer and loader tests:**
  - a project with two of the programme's staff on it counts once;
  - at scope level, a project shared by two programmes counts once;
  - inactive staff are excluded from the count and from project matching;
  - a project outside the window is ignored;
  - a null budget adds ฿0 but counts as a project;
  - zero staff gives no award;
  - an unsynced source gives `points: null` and an unchanged Financial score;
  - Capability has four drivers and no grant driver.
- **Existing suites:** update the driver-parity, methodology-bundle, health-score version and web UI tests that reference the removed driver or pin the version. Remove the gate tests.
- **Live check on dev:**
  - re-measure the award distribution against §3;
  - confirm Capability completeness is 100 % for a programme with all four capability inputs;
  - open one Deep-Dive and check the award line renders.

## 9. Out of scope

- Splitting a project's budget among members or programmes.
- Raising the co-investigator match rate.
- Any change to the base Financial drivers.
- A release build, which happens only on request.
