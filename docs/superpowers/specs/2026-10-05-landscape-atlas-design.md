# Landscape atlas — Executive Landscape redesign

**Date:** 2026-10-05 · **Status:** design approved in brainstorming, awaiting spec review
**Methodology version:** `landscape-atlas.v1` (new) · **Page:** `/dashboards/executive-landscape`
**Mockups:** `.superpowers/brainstorm/1374634-1791174411/content/{angles,layout,atlas-v1}.html` (not committed)

## 1. Purpose

The platform now holds many per-programme analyses (health, lifecycle, risk, gap map,
grants, overlap, AI readiness, DQ, sectors), but the Executive Landscape still shows
the 2026-05 set: hero KPIs, a strategic matrix whose axes are stand-ins (health
attractiveness × health outcomes), lifecycle, modernity, health by faculty, level mix
and alerts. Council and top management need the whole portfolio seen from the angles
an education-industry board reads: shape, strategic position, market, capability,
future readiness.

This redesign turns the page into a **chaptered atlas**: one scroll, five chapters in
board-question order, each opening with a one-line answer, then its visuals. Seven new
visuals are added; existing panels move into the chapter they answer.

## 2. Decisions taken in brainstorming

| # | Decision |
|---|---|
| D1 | Target page is the **Executive Landscape**. The Cockpit stays the scope-aware working tool and is not changed. |
| D2 | **Chaptered atlas** (one scroll + sticky chapter rail), not tabs and not a single "lens" slot. |
| D3 | Seven new visuals: portfolio treemap, growth–share matrix, health × risk action map, demand vs supply diagonal, research & grant engine, future-fit scorecard, national-strategy coverage. |
| D4 | Rejected for v1: level × faculty sunburst, retirement cliff, lifecycle S-curve, cross-subsidy waterfall, scale vs viability, demographic ceiling, recruitment pull by faculty, faculty overlap chord, curriculum freshness, verdict flow, faculty slope chart. |
| D5 | Future-fit is a **sorted scorecard** (faculties × measures, radar on hover), not 24 small radars. |
| D6 | Split lines reuse existing methodology thresholds: **1.0 applications per seat**, **0 % enrolment change**, **health 65** (the "healthy" band), **KKU risk matrix score 10** (start of HIGH). |
| D7 | Chapter answers are **deterministic sentences** computed from the data, not AI. No AI call is added. |

## 3. Page structure

Top of page, unchanged in content:
- **Hero KPIs** (existing `HeroStat` row).
- **Needs attention**: the two existing `AlertColumn` cards.

Then a sticky **chapter rail** (existing `SectionRail` from `apps/web/src/components/evidence`,
scroll-spy) and five chapters. Each chapter opens with a kicker ("Chapter 2 · Position"),
its board question as the heading, and an answer line: one big number plus one sentence.

| Chapter | Board question | New visuals | Existing panels moved in |
|---|---|---|---|
| 1 Shape | What do we have, and where is it concentrated? | Portfolio treemap | Health by faculty, Level mix |
| 2 Position (bachelor) | Which programmes do we grow, keep, fix or exit? | Growth–share matrix, Health × risk action map | Lifecycle verdict, Curriculum modernity, surging/crashing stat strip |
| 3 Market | Are we producing graduates where the jobs are? | Demand vs supply diagonal | — |
| 4 Capability | Which faculties earn and publish beyond teaching? | Research & grant engine | — |
| 5 Future | Is the portfolio ready for AI and Thailand's strategic industries? | Future-fit scorecard, National-strategy coverage | — |

The `PulseStrip` stays directly under the hero row. `StrategicMatrixHero` is removed
from this page (replaced by the growth–share matrix); the component and the Cockpit's
`/cockpit/matrix` are untouched.

## 4. The seven visuals

Every new visual is wrapped in `ChartFrame` (`packages/ui/src/viz/chart.tsx`):
provenance drawer, freshness badge, "show data" table. Colours come from design tokens;
axis labels are English, data labels (programme and faculty names) Thai with English
where space allows. **No value is ever drawn as 0 because it is missing**: a programme
or faculty that a chart cannot place is listed beneath it with the reason.

### 4.1 Portfolio treemap (Shape)
- **Hierarchy:** faculty → programme (department is skipped; `departmentId` is often null).
- **Area:** students enrolled now (`currentlyEnrolledStudents`).
- **Colour:** overall health score in the existing bands: < 40 danger, 40–65 needs
  attention, ≥ 65 healthy. No health score → neutral grey with hatching.
- **Zero enrolled:** takes no area; counted in a note ("N programmes with no enrolled
  students are not drawn").
- **Interaction:** click a faculty to zoom in (breadcrumb back); click a programme to open
  `/programs/[id]`.
- **Answer line:** share of enrolled students in the top 5 faculties; count of
  programmes with fewer than 15 enrolled students.

### 4.2 Growth–share matrix (Position, bachelor)
- **X:** TCAS applications per seat for the latest entry year with data, all rounds
  summed (`SUM(applicants) / SUM(quota)` from `tcas_admission_stats` rows linked to the
  programme). Log scale. Split at **1.0**. Axis label says "applications", because one
  student can apply in several rounds.
- **Y:** 3-year enrolment change, the same `enrollmentDeltaPct` that
  `dashboard-overview.ts` computes. Split at **0 %**.
- **Size:** students enrolled now. **Colour:** net contribution per student (diverging,
  negative = danger tone).
- **Quadrants:** Star (≥ 1.0, growing), Cash cow (≥ 1.0, not growing), Question (< 1.0,
  growing), Dog (< 1.0, not growing).
- **Not plotted, listed:** bachelor programmes with no linked TCAS rows (dev: 23 of 102),
  quota 0, or no enrolment history.
- **Answer line:** count per quadrant, led by Dogs.

### 4.3 Health × risk action map (Position, bachelor)
- **X:** overall health score, split at **65**.
- **Y:** KKU risk matrix score 1–25 (`listPortfolioRisk`), split at **10**.
- **Quadrants:** Act now (< 65, ≥ 10), Watch (≥ 65, ≥ 10), Fix quietly (< 65, < 10),
  Protect (≥ 65, < 10).
- **Size:** students. **Colour:** KKU risk level (LOW / MODERATE / HIGH / VERY_HIGH).
- **Not plotted, listed:** risk `NEEDS_DATA`, or no health score.
- **Answer line:** count in Act now.

### 4.4 Demand vs supply diagonal (Market)
- **Unit:** field of study, from `computeGapMap` (`gap-map.v2`, bachelor universe), at the
  gap map's default thresholds; the drawer shows them.
- **X:** KKU share of graduates; **Y:** share of job adverts; both log scale.
- **Diagonal:** demand share = supply share. **Colour:** the gap-map verdict, unchanged.
  **Size:** adverts.
- **White space** (no KKU supply) sits on a rail at the left edge, not at log(0).
- **Not plotted, listed:** `supply-unknown`, `too-few-postings`.
- **Basis switch:** all / private / public, the gap map's existing `basis` parameter,
  URL-shareable (`?basis=`).
- **Answer line:** counts of under-served, white-space and over-served fields.

### 4.5 Research & grant engine (Capability, by faculty)
- **X:** publications per active teaching staff member per year, last 3 complete
  calendar years, `research_outputs` rows passing `realDataWhere()` (as the health score).
- **Y:** external grant baht per active teaching staff member per year over the last 3
  complete Thai fiscal years, using the grant award's window and attribution rule (a
  project counts for every faculty with a member on it; budgets never split).
- **Size:** active teaching staff. **Reference lines:** KKU medians (dashed).
- **Caveat in drawer:** about 30 % of co-investigator ids match no HR record, so grant
  figures are a lower bound; a faculty's figure is "project totals touched", so faculty
  totals sum to more than KKU's.
- **Answer line:** number of faculties above ฿1 M grant per staff per year.

### 4.6 Future-fit scorecard (Future, by faculty)
- **Rows:** faculties, sorted by the mean of the available columns.
- **Columns (0–100, shaded):** AI readiness (programme mean); digital intelligence
  (`dqCompetencyByScope`, bachelor); relevance (health-score dimension); automation
  resilience = 100 − `skill_automation_index` (bachelor KRI).
- **Blank cell** = no data, never 0; the row mean uses only present columns and shows
  how many it used.
- **Hover:** that faculty's radar (`RadarChartSmall`).
- **Answer line:** the lowest-ranked faculties with at least 3 of 4 columns.

### 4.7 National-strategy coverage (Future)
- **Grid:** faculties × the 8 `sectors` rows (BCG + S-curve).
- **Cell:** number of the faculty's canonical active programmes with at least one
  `program_skills` row whose skill maps to the sector (`skill_sectors`).
- **Empty cell:** "not mapped", never "no capacity". A sector with no mapped programme
  at all (dev: Green economy) is flagged in the header.
- **Answer line:** sectors fed by fewer than 15 programmes.

## 5. Architecture

### 5.1 Calculations — `packages/db/src/landscape-atlas/`
One file per chapter: `shape.ts`, `position.ts`, `market.ts`, `capability.ts`,
`future.ts`, plus `types.ts` and `index.ts`. Each file has:
- a **reader** (`async`, Prisma / `$queryRaw` with Zod-validated rows) that reuses
  existing helpers: `currentlyEnrolledStudents`, `getProgramScoreIndex`,
  `listPortfolioRisk`, `computeGapMap`, the fiscal-year window and attribution from
  `grant-award.ts`, `dqCompetencyByScope`, `program_skills` ⨝ `skill_sectors`;
- **pure shaping functions** (no I/O): split lines, quadrant assignment, "listed, not
  plotted" partition, faculty aggregation, answer-line sentence.

**AI readiness needs a batch reader.** `programAiReadiness(programId)` is
per-programme; add `aiReadinessByProgram(programIds)` that reads the stored results in
one query, so the scorecard does not fan out 300 calls.

`LANDSCAPE_ATLAS_VERSION = 'landscape-atlas.v1'` lives in `types.ts`.

### 5.2 API — `apps/api/src/landscape/`
`LandscapeController` + `LandscapeService`:
`GET /landscape/{shape,position,market,capability,future}`, each accepting `scope` and
`scopeId`, clamped with `clampScopeForUser` (`apps/api/src/common/scope-guards.ts`), the
same fan-out the Cockpit uses for multi-grant users. `market` also accepts `basis`.
Responses use the standard envelope with `@Provenance` (sources, freshness,
`methodologyVersion`), cached 5 minutes via `CacheService` keyed on chapter + scope +
parameters. Read-only, so no `@AuditLog`; no AI, so no `@AiCall`.

### 5.3 Page — `apps/web/app/dashboards/executive-landscape/`
- `page.tsx` stays a server component; it renders hero, alerts and rail first, then one
  `<Suspense>` per chapter with a skeleton, so a slow chapter (Market) never blocks the
  others.
- New `chapters/` folder: `shape.tsx`, `position.tsx`, `market.tsx`, `capability.tsx`,
  `future.tsx`, plus `chapter-header.tsx` (kicker, question, answer line). Each chapter
  fetches its own endpoint.
- The page's inline role-scope logic is replaced by the API's clamp.

### 5.4 Visual components — `packages/ui/src/viz/`
- **Extend `BubbleMatrix`** with: log axes, reference lines (vertical, horizontal,
  diagonal), quadrant corner labels, an edge rail for points that cannot sit on a log
  axis. Serves 4.2, 4.3, 4.4, 4.5. Existing callers keep today's behaviour by default.
- **New `PortfolioTreemap`** on Recharts' `Treemap` (already a dependency).
- **New `ScoreGrid`** (rows × columns of shaded cells with blank-cell support, optional
  row hover slot), used by 4.6 and 4.7; reuses the `Heatmap` cell colour logic.
- No new charting library.

## 6. Failure and data-gap handling
- A chapter whose endpoint fails renders a quiet "This chapter could not load — try
  again" card; the rest of the page renders.
- Every chart lists what it could not place, with the reason; nothing missing is drawn
  as 0.
- Each answer line has a neutral fallback ("Not enough data to summarise this chapter")
  when its number cannot be computed.
- Scope with no programmes (e.g. an empty grant) shows an empty state per chapter.

## 7. Methodology documentation
New `docs/methodologies/landscape-atlas.md`: every axis definition, split line and its
source threshold, the "listed, not plotted" rules, the answer-line formulas, and the
caveats (applications vs applicants; bachelor-only Position; grant undercount; sector
mapping depends on extracted skills). Linked from each `ChartFrame` provenance drawer.
Add a row to `docs/methodologies/README.md` and a `/changelog` entry at release time.

## 8. Testing
- **Unit (`packages/db`):** quadrant assignment exactly at each split line (1.0, 0 %,
  65, 10); null / listed-not-plotted partition; faculty aggregation of grants and
  publications; scorecard mean over present columns only; answer-line text including
  fallbacks.
- **API:** scope clamp (a faculty user cannot read another faculty; multi-grant union).
- **Components:** null cells render grey; log axes with zero values route to the edge
  rail; no raw ids (cuid shape) in rendered text; `BubbleMatrix` default behaviour
  unchanged for existing callers.
- **Visual check:** headless-Chromium screenshots of the finished page on dev, light and
  dark.

## 9. Out of scope (v1)
- True national market share from the 111-institution TCAS data (needs a field match
  across institutions).
- Fixing the Cockpit's stand-in matrix axes.
- Movement views (verdict flow, slope charts) and the other angles rejected in D4.
- PDF / Council Pack export of the atlas.
