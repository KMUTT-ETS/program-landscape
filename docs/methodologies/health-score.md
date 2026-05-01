# Health score methodology

**Version:** `health-score.v2`
**Reviewed:** 2026-05-01
**Owner:** KKU Data Office

> **v2 changes (2026-05-01):** Demand dimension extended with a fourth driver
> `labor_market_alignment_kmitl`. The first three drivers (admission yield,
> retention year 2, on-time graduation) are unchanged — they remain internal-
> KKU proxies for demand. The new driver pulls real external labour-market
> signal from KMITL Skill Mapping (`KmitlCareerSkillDemand`, scope=THAILAND,
> source=JOB_POSTINGS, percentage ≥ 5%). Computation: per-program, the share
> of ProgramSkill rows whose skill_id is in the KMITL demanded set, ×100.
> Faculty/department aggregates average across child programs. Returns null
> (data gap) when KMITL has no rows, NOT zero.
>
> Per `docs/readiness-checklist.md` gate 11, KMITL data is preview-quality
> until **2026-05-31** (30-day green-history countdown started 2026-05-01).
> Until then, Council-facing Cockpit views should surface "preview" framing
> on the demand dimension.
>
> Old `health-score.v1` rows are retained for audit; new computations stamp
> `v2`. The connector behind the new driver is `kmitl-skill-mapping`, which
> replaces the original prompt-14 plan to ingest JobThai + JobsDB.

Every program has five health dimensions plus an overall composite. Scores
run 0–100 where 100 is healthiest. Below 40 is "danger zone"; 40–65 is
"needs attention"; above 65 is "healthy".

**This score informs, it does not decide.** Council decisions on program
closure/merger/launch require two-reviewer approval regardless of the
computed score (see `docs/ai-governance.md` §human-in-the-loop).

## The five dimensions

| Dimension | What it measures | Primary signals |
|---|---|---|
| **Demand** | Is there real demand for the program's outputs? | Applications per seat, admission yield, labour-market demand for primary skill cluster (from JobThai/JobsDB), demographic ceiling |
| **Financial** | Does it cover its costs? | Net contribution per graduate, cost/revenue ratio, trend over 3 years |
| **Quality** | Is curriculum + teaching strong? | Graduate employment rate, average salary, employer satisfaction, accreditation status |
| **Relevance** | Does what's taught match what matters? | Skill coverage vs demand, policy alignment (MHESI / NESDC mentions), research output alignment |
| **Capability** | Can the faculty actually deliver this? | Faculty-member-to-student ratio, faculty seniority distribution, retirement horizon, active research |

Each dimension score is computed from 3–5 underlying metrics, weighted
equally within the dimension. The overall composite is an equal-weighted
average of the five. Why equal weighting:

- Equal weights are the least-arguable default. Council members can
  read an unweighted score and form their own mental bias without the
  tool having already applied one.
- Any weighted formulation encodes a value judgement that should be
  visible. When (if) we move to weighted composites, the weights MUST
  appear in the chart tooltip, not just in this doc.

## Data completeness

Every score carries a `dataCompletenessPct` field — the fraction of
underlying metrics that had non-null values in the current scope. A
score computed from 2 of 5 underlying metrics has `completeness=40`.

**Display rules (non-negotiable):**
- Completeness < 50%: score is rendered in `text-tertiary` + flagged
  "low data" in tooltip. Never displayed without a data-completeness
  indicator.
- Completeness 0%: no score; cell shows "—" with "no data" tooltip.
- Council brief MUST mention completeness explicitly for any score it cites.

## Null handling

Null metric values are **excluded from the average**, not substituted
with 0 or 50. Rationale:

- Substituting 0 would punish programs for missing data — "we don't
  know your employment rate" would become "employment rate 0".
- Substituting 50 would pretend we have neutral information when we
  have none.
- Excluding + flagging completeness lets the reader see the real signal
  and make their own judgement about how much to trust it.

## Scope aggregation

- **Program scope:** score is computed directly from that program's
  metric rows.
- **Department scope:** weighted average across the department's
  programs, weighted by enrolled headcount (a 500-student program
  moves the score more than a 12-student program).
- **Faculty scope:** weighted across departments, same headcount weight.
- **University scope:** weighted across faculties.

The weighted-by-enrolment rule is the same as `queryMetricByScope`'s
`outcome`-family rollups — see `packages/db/src/scope.ts`.

## Version bumping

When the formula changes (weights, dimensions, null-handling, completeness
thresholds):

1. Bump the version constant (`HEALTH_SCORE_VERSION` in
   `packages/db/src/health-score.ts`).
2. Update this doc's "Version:" and "Reviewed:" lines.
3. Never edit an existing version's logic in place — historical scores
   on past Council Packs must remain reproducible.

Historical scores are not backfilled. The version that computed a
score at the time it was displayed stays stamped on it.

## Known limitations of v1

- **Demand signal is synthetic today.** Real JobThai/JobsDB feeds are
  mocked (prompt 03). Demand scoring uses `job_postings` rows as
  available, falling back to enrolled-per-applications-ratio only.
  Flip to real when connectors are wired (prompt 14).
- **Capability signal is coarse.** Faculty-member-to-student ratio is
  the strongest signal; retirement-horizon + active-research terms
  need per-faculty-member detail we'll get from the real KKU-HR
  connector.
- **No longitudinal comparison.** v1 scores are point-in-time.
  Trend-over-time comes with the scenario planner in prompt 09 where
  users actually want it.
- **Cross-scope consistency not asserted.** A faculty's composite
  score is NOT mathematically guaranteed to equal the weighted average
  of its departments' composites (they're each computed independently
  from the MV rollups at that level). For this v1 the divergence is
  typically small; a future version may enforce bottom-up consistency
  explicitly.

## Sanity checks the scoring service enforces at compute time

- Every score output clamped to [0, 100].
- `dataCompletenessPct` ∈ [0, 100].
- If every underlying metric is null, returns `null` — never 0.
- `methodologyVersion` stamped on every returned row.
