# Cost Allocation Methodology (v0 — proposal, NOT implemented)

> **Status:** Draft / proposal. **Not yet implemented.** No metric in the running
> system carries `cost-allocation.v0`. Flipped to `v1` only when KKU-Finance +
> KKU-HR real connectors land (prompt 14) and the Finance stakeholder has
> counter-signed the approach.
>
> This doc exists so the team has something concrete to critique before a
> single row of allocated cost is shown to Council. The financial-sustainability
> pillar of the health score (dimension #2) currently uses raw program revenue
> and a single blended cost figure; v1 replaces that with a full activity-based
> allocation.

## Why this is load-bearing

Three of the eight strategic questions depend on per-program cost being
**defensible**:

- Q2: which programs are financially unsustainable at current trajectory?
- Q4: which programs duplicate each other and could be consolidated?
- Q7: what is the demographic ceiling on each program given the declining cohort?

A program closure or merger recommendation from this system will, eventually,
be argued in front of the Council. When a dean asks "why does my program
look unprofitable?", the answer "because `health-score.v1` averaged revenue
minus a flat share of KKU's overhead" is insufficient. The allocation has to
survive faculty scrutiny.

## The five cost pools

Activity-based costing. Every baht of KKU's operational cost lands in exactly
one pool; each pool has a driver that maps it to programs.

| Pool | Driver | Source data (real) | Source data (v0 proxy) |
|---|---|---|---|
| **Direct teaching** | Faculty-hours × loaded hourly rate × course enrolment | KKU-HR salary + course load; KKU-Registry enrolment | KKU-HR MOCKED; load from curriculum credit hours |
| **Facility** | Room-hours × room m² × facility cost-per-m² | KKU-Registry room booking + Facilities m² register | Credit-hours proxy, flat ฿/m² |
| **Research support** | Research grants attributed to faculty teaching program | KKU-Research output; grant-to-faculty mapping | Flat per-faculty share |
| **Administrative overhead** | Student headcount × admin cost-per-student | KKU-Finance budget categories | Flat 15% of direct teaching |
| **Student services** | Student headcount × service cost-per-student | KKU-Finance student-services line | Flat 8% of direct teaching |

v1 will use the real sources. v0 (this doc) is the proxy methodology we
run on seed data to validate the pipeline — **v0 outputs must not reach
Council views**. Label them with `ConfidenceBadge level='indicative-only'`
and a `ProvenanceButton` caveat that reads "proxy allocation — real
finance data pending prompt 14".

## Formula (v1 target)

For program *p* in fiscal year *y*:

```
directTeaching(p, y) =
  Σ over courses c in program p:
      Σ over faculty f teaching c:
          hours(f, c, y) × loadedHourlyRate(f, y) × enrolmentShare(p, c, y)
```

Where:

- `hours(f, c, y)` — scheduled teaching hours from KKU-Registry.
- `loadedHourlyRate(f, y)` — (annual salary + benefits + retirement
  contribution) / annual contact hours. Computed per faculty per year.
- `enrolmentShare(p, c, y)` — fraction of students in course *c* enrolled
  via program *p* (a service course taught across multiple programs splits
  proportionally).

```
facilityCost(p, y) =
  Σ over courses c in program p:
      roomHours(c, y) × roomM2(c) × facilityCostPerM2(y)
```

Where `facilityCostPerM2(y)` = (total facility OPEX — utilities +
maintenance + depreciation) / total registrable m². Computed
university-wide per year.

```
researchSupport(p, y) =
  Σ over faculty f teaching program p:
      researchOverheadShare(f, y) × teachingLoadFraction(f, p, y)
```

`teachingLoadFraction(f, p, y)` — the fraction of faculty *f*'s teaching
hours that went to program *p* in year *y*.

```
adminOverhead(p, y) = studentCount(p, y) × adminCostPerStudent(y)
studentServices(p, y) = studentCount(p, y) × serviceCostPerStudent(y)
```

Admin cost per student and service cost per student are whole-KKU figures
divided by whole-KKU headcount — they don't vary by program.

## Total + margin

```
totalCost(p, y) = directTeaching + facility + researchSupport
                + adminOverhead + studentServices
totalRevenue(p, y) = tuition(p, y) × enrolment(p, y) + governmentSubsidy(p, y)
margin(p, y) = totalRevenue(p, y) − totalCost(p, y)
marginPct(p, y) = margin(p, y) / totalRevenue(p, y)
```

`totalRevenue` uses:

- **Tuition** — per-program tuition schedule from KKU-Registry (already
  real). Includes MHESI-regulated rate tiers where applicable.
- **Government subsidy** — per-student block grant attributed by
  enrolment. KKU-Finance data; v0 uses MHESI published formula.

## Null handling

Same rule as every other methodology in the system: **missing inputs are
excluded, never substituted with 0 or a default average**.

- If `loadedHourlyRate(f, y)` is null for any faculty member contributing
  to a course, that course's `directTeaching` is null for year *y*, and
  the program's `totalCost` is null (not a partial sum).
- If `roomHours` is missing, facility pool is null for that course.
- A program with any null pool gets `totalCost = null` and
  `marginPct = null`. The Cockpit Heatmap shows `—`, not a fabricated
  percentage.
- `dataCompletenessPct` per program = (fraction of cost pools
  successfully computed). Shown in the provenance drawer; programs with
  < 80% completeness are flagged as "cost allocation incomplete" in
  analyst views.

This is the rule that will make finance pushback survivable. A faculty
that sees "null" is being honest with them; a faculty that sees a
fabricated number they didn't recognise will dispute the whole system.

## Known limitations (documented before they become complaints)

- **Shared faculty appointments.** A professor with 50% Engineering / 50%
  Science split needs salary split before loaded-rate computation. KKU-HR
  exposes primary department only; dual appointments are manually flagged.
  v1 respects the flag; unflagged dual-appointed faculty get 100% to their
  primary department — an acknowledged error bar of ±2% on departments
  with heavy cross-teaching.
- **Research vs teaching time.** Loaded hourly rate assumes "annual
  teaching hours" is the denominator, but research-intensive faculty
  teach less. v1 uses the HR-recorded teaching load; research-only
  faculty are excluded from the `directTeaching` pool entirely.
- **Clinical / field programs.** Medicine, Nursing, Agriculture — teaching
  happens in non-registrable space (hospitals, farm plots). Facility
  pool is systematically underreported here. v1 adds a clinical-facility
  exception that bills a flat per-student rate from the teaching-hospital
  contract; this is Phase B work, not v1 day-1.
- **Capital vs OPEX.** v1 allocates OPEX only. Capital (buildings,
  equipment purchases) is depreciated into facility OPEX on a 20-year
  straight-line. Shorter-life equipment (IT gear, 5 years) goes through
  the IT service line.
- **Inflation.** All figures are nominal (reported baht, not real). Analyst
  views that compare across years include a real-terms toggle using
  NESDC CPI — separate feature.
- **Fiscal vs academic year.** KKU Finance reports fiscal year (Oct–Sep);
  enrolment is academic year (Jun–May). v1 maps academic *y* to fiscal
  *y* by calendar overlap; a program that runs Jun–May spans two fiscal
  years. The mismatch is ≤3 months — documented, not corrected.

## Confidence semantics

`ConfidenceBadge` level reads from `dataCompletenessPct`:

| Completeness | Level | Surface treatment |
|---|---|---|
| ≥ 95% | `high` | Normal display |
| 80–94% | `medium` | Shown with "partial cost data" tooltip |
| 50–79% | `low` | Greyed, warning icon |
| < 50% | `insufficient` | `—` placeholder, "cost data incomplete" badge |

No `high` allocations exist in v0. v1 starts at `medium` for most
programs; `high` arrives once KKU-HR, KKU-Registry room-booking, and
KKU-Finance are all real AND reconciled for the target fiscal year.

## Pilot plan

Before flipping `v0 → v1` university-wide:

1. **5-program pilot** — chosen to span cost shape:
   - Computer Engineering (technical, lab-heavy)
   - Accounting (large lecture, low facility cost)
   - Nursing (clinical, facility-heavy)
   - History (small cohort, research-heavy faculty)
   - MBA (evening, different tuition tier)

2. **Finance-Office reconciliation** — pilot programs' allocated totals
   compared against Finance's current top-down allocation. Divergence > 10%
   triggers investigation (driver misspecification, missing cost pool,
   data quality issue).

3. **Dean review** — each of the 5 faculty owners reviews the v1 number
   for their program. Open dispute channel is an `Annotation` with
   `kind='cost-dispute'`; reviewer + finance-office discuss; v1 is
   adjusted or the dispute is recorded as a known error bar.

4. **Council methodology sign-off** — Finance Committee reviews the
   5-program reconciliation; Council approves the methodology as the
   authoritative cost basis before it enters the health score.

5. **Full roll-out** — 297 programs, with the confidence-completeness
   banding above. First roll-out delivers v1 for the most recent
   fiscal year; historical years follow as data is cleaned.

Timeline: **2–3 months** from the day KKU-HR + KKU-Finance connectors are
live. The allocation math itself is ~2 weeks of work; reconciliation and
stakeholder sign-off dominate.

## Operational dependencies (what has to land first)

| Dependency | Owner | Status |
|---|---|---|
| KKU-HR connector (real) | IT + HR director | Mocked (prompt 14) |
| KKU-Finance connector (real) | IT + CFO | Mocked (prompt 14) |
| KKU-Registry room-booking feed | IT | Partial — enrolment real, room allocations mocked |
| Facilities m² register | Facilities Office | Out of scope today, PDF-ingested from asset register |
| Research-grant → faculty attribution table | Research Office | Out of scope today |
| Dual-appointment flag on User | HR | Planned schema addition (prompt 14 migration) |
| Council sign-off on methodology | Finance Committee | Pending — this doc is the conversation starter |

## Version history

| Version | Date | Author | Summary |
|---|---|---|---|
| v0 (draft) | 2026-04-24 | Landscape team | Initial proposal. Five cost pools, pilot plan, dependency list. **Not used in any live view.** |

## Open questions for the Finance review

1. **Dual appointments** — acceptable error bar of ±2% on cross-teaching
   departments, or is this enough to require a full per-term
   teaching-load survey?
2. **Research overhead attribution** — by faculty head count, by
   teaching-load fraction (current proposal), or by grant value? Each
   tells a different story for research-heavy departments.
3. **Service courses** — when an English course is taught to 12
   programs, does cost split by enrolment share (proposal) or by
   program's tuition-rate (richer programs subsidise poorer)?
4. **Student-services pool** — flat per-student (proposal) or
   program-weighted (Nursing uses more clinical-placement support, Arts
   uses more counselling services)?
5. **Governance** — who approves a v1 → v2 bump? Finance Committee
   alone or full Council?

These are not Landscape team decisions. They are finance-and-governance
decisions that the tool surfaces but does not settle.
