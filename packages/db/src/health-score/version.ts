// Methodology version stamped on every HealthScoreRow.
//
// UPSTREAM_HEALTH_SCORE_VERSION is the upstream (KKU) formula version.
// An adopting institution does NOT edit it: it sets INSTITUTION_REVISION in
// ./tuning.ts, and HEALTH_SCORE_VERSION becomes '<upstream>+<revision>'.

import { INSTITUTION_REVISION } from './tuning';

// Health scores for the Portfolio Overview Cockpit + Deep-Dive radar.
// Five dimensions + overall composite. Scores 0-100 where 100 is healthy.
//
// Methodology: see docs/methodologies/health-score.md. Edit that first
// when changing the formula, then bump UPSTREAM_HEALTH_SCORE_VERSION here
// (upstream) or INSTITUTION_REVISION in ./tuning.ts (an adopting
// institution), then change the logic.
//
// Null handling rule: missing metrics are EXCLUDED from the average
// (not substituted with 0 or 50). dataCompletenessPct on every score
// tells the reader how much data actually went into it.

// v3.0 (2026-05-02) — full redesign. Five dimensions, all backed by
// real data after the 2026-04-27 → 2026-05-02 connector flips:
//
//   * attractiveness  — TCAS-anchored: competition vs peers, fill rate,
//                       enrollment trend
//   * financial       — net contribution per student, revenue coverage,
//                       tuition trend
//   * capability      — senior-rank share, publications per faculty,
//                       retirement horizon (was placeholder in v2)
//   * outcomes        — TCAS percentile + alumni outcomes (kku-alumni
//                       still pending; TCAS percentile lights it up)
//   * relevance       — labour-market alignment, demand-match filled,
//                       demographic resilience, strategic sector
//                       alignment (was placeholder in v2)
//
// v2 / v2.1 driver `labor_market_alignment_kmitl` (LinkedIn via MHESI,
// 4-quadrant fallback) is preserved under `relevance`. v1 / v2 / v2.1
// rows retained for audit; new rows stamp v3.0.
// v3.5 (2026-05-12) adds the `revenue_scale` driver to the financial
// dimension: level-aware absolute revenue scaled 0-100 against the
// per-level target. Captures "is this program revenue-substantial for
// its level" — complements the existing per-student / coverage / trend
// drivers (which are all ratios). Lifecycle.v1.4 uses the same
// signal as a first-class lifecycle driver + flagship-floor gate.
//
// v3.6 (2026-05-12) adds the `pedagogical_fit` driver to the relevance
// dimension, sourced from ProgramPedagogyAssessment.overallScore (the
// new `program-pedagogy.v1` extractor). Captures "does this program
// teach in ways the discipline actually demands" — medical programs
// without PBL drop, engineering without project-based+internship
// drops, humanities without seminar/practicum drops. Null-safe when
// the pedagogy assessment hasn't run yet.
// v3.7 (2026-05-19) — outcomes dimension gains `student_satisfaction`
// driver, sourced from POWERBI.EVALUATE_INSTRUCTOR via the new
// `kku-evaluations` connector (`evaluation_response_summaries`).
// Aggregates the program's courses' weighted-mean rating across
// main terms (semester 1+2) all observed years, normalised
// 3.5→0..5.0→100 on the 1-5 likert scale (anchored linear, captures
// the ceiling-biased distribution from kku-evaluations.v1 §"Score
// scale"). Null when the program teaches no courses surveyed in
// window (rare — most active programs have hundreds of cells).
// v3.9 (2026-08-16) — financial dimension scores on the last COMPLETE
// academic year, never the one still being billed. `FinancialMetric.
// fiscalYear` holds an academic year (Jun–May) whose tuition is billed
// across TWO fiscal-year cycles — the in-progress year therefore only
// ever has semester 1 billed (median ~44-47% of the prior year), no
// matter how healthy the program is. The old 30%-ratio-only guard let
// most of those through. Head selection (`net_contribution_per_student`,
// `revenue_coverage_program_direct`, `revenue_scale`) now goes through
// `pickFinancialYear()`; `tuition_trend_slope` excludes the in-progress
// year from its series before the (retained, secondary) ratio guard
// runs. See `packages/db/src/financial-year.ts` and
// `docs/methodologies/health-score.md` §v3.9 for the full reasoning and
// the measured before/after impact. Enrolment-based drivers
// (`enrollment_trend_slope`, `kku_intake_policy`) are unaffected —
// recruitment for an academic year finishes at its START, a different
// calendar question from tuition completeness.
//
// v4.0 (2026-08-25) — the Outcomes dimension gains
// `dq_digital_competency`, the respondent-weighted mean over DQ theory
// modules 1-12, banded on KKU's pass mark (≤50 → 0, 70 → 50, ≥90 →
// 100). Bachelor programmes with ≥5 scored students only; every other
// programme gets null, which the dimension excludes from its mean — so
// the 199 non-bachelor programmes are untouched. Module 13 is out
// because its uptake runs 48.7%-96.7% by faculty and including it would
// score programmes on how far the rollout reached them. See
// `dqCompetencyDriver` below, `packages/db/src/student-dq.ts` for the
// band and the eligibility gates, and
// `docs/methodologies/health-score.md` §v4.0 for the reasoning and the
// measured drift across all 301 programmes.
//
// v5.0 (2026-09-12) — SCOPE DRIVER PARITY. The faculty/department/
// university scorers had drifted 2-4 drivers behind the program scorers
// since v3.0: relevance hardcoded two drivers to null and never
// implemented a third, financial ran on two drivers the program scorer
// does not have and none of the four it does, attractiveness kept only
// its three aggregate TCAS ratios, outcomes dropped job relevance,
// further study and the TCAS percentile. Measured 2026-09-12, every one
// of 24 faculties scored BELOW its program mean — 11.6 pts on average,
// 28.5 at worst — with relevance alone at -56.4. Capability, the only
// dimension already at parity, was also the only one that agreed (+0.4).
//
// Drivers whose calibration is per-program (absolute THB/yr slopes,
// per-level revenue targets, intake floors, peer-subject percentiles)
// now roll up as the mean of their program values; drivers whose scale
// is scope-invariant stay ratio-of-sums, which weights by program size.
// dataCompletenessPct now counts drivers a scorer never built, so the
// three dimensions that reported 100% while missing half their inputs
// report honestly. Composites above program scope MOVE. See
// `docs/methodologies/health-score.md` and
// `docs/superpowers/plans/2026-09-12-health-score-scope-driver-parity.md`.
// JOBTHAI_MIN_LINK_SCORE moved to jobthai-bridge.ts in v5.2 so the health
// driver and the Deep-Dive Skills coverage section apply one rule.

//
// v5.1 (2026-09-13) — the Relevance dimension gains
// `jobthai_demand_alignment`: the share of a programme's taught skills that
// its linked JobThai occupations demand. The direct analogue of
// `labour_market_alignment`, which reads the LinkedIn-via-MHESI feed, so the
// two are comparable and can visibly disagree.
//
// Source caveats, which travel with every figure derived from it: 37.0% of the
// 47,631 postings are Bangkok and 3.3% the 20 Northeast provinces (Khon Kaen
// 304), so this is a national signal rather than a regional one; there is no
// salary, employer or posting date in the source.
//
// NULL, NEVER 0, where the data cannot speak — and for postgraduate programmes
// that is the normal case rather than an edge case. Only 41 of 47,631 postings
// state a postgraduate qualification as their minimum, so the bridge leaves
// almost every master's and doctoral programme without an eligible link. 82% of
// doctoral programmes DO match a field of study, but on bachelor-level adverts;
// scoring a PhD from undergraduate vacancies would have looked entirely healthy
// and been wrong.
//
// Thresholds are measured, not assumed: JOBTHAI_MIN_POSTINGS_FOR_SIGNAL = 20
// (the observed 25th percentile), MIN_SKILL_OVERLAP_SHARE = 0.5,
// MAX_PROGRAMMES_PER_FIELD = 15. See packages/db/src/jobthai-bridge.ts.
//
// v5.2 (2026-09-13) — two corrections to the JobThai signal and one weighting.
//
//   1. The programme links were wrong (jobthai-bridge.v2). The skill-overlap
//      path intersected taught skills with every skill ONE posting named, and
//      transferable skills carried it: Doctor of Medicine linked to Sales/AE on
//      Communication, Critical thinking, Teamwork and Professional ethics.
//      Overlap-only links carried 120,251 of 132,902 postings. The
//      field-of-study score also changed from matched-fields/distinct-fields
//      (Mechanical Eng -> mechanical engineer 0.04) to a posting share (0.57).
//   2. The driver was circular. A skill-overlap link exists exactly when the
//      programme's taught skills are demanded, so every overlap-linked
//      programme scored >= 50 by construction; 37 of the 64 scored under v5.1
//      took at least 80% of their postings from such links. The driver now
//      reads only field-of-study and corroborated links, counts a skill as
//      demanded at a 5% posting share, leaves out skills most occupations
//      demand, and takes taught / relevant from the AI curriculum check
//      (program_demand_matches rows tagged 'jobthai') — the same instrument as
//      demand_match_filled. Exact skill-ID overlap read 0 for 29 of 41
//      programmes: curricula say "Legal Drafting", postings "Litigation".
//   3. Labour-market demand is weighted DOMESTIC 75 : GLOBAL 25. JobThai is the
//      domestic signal, LinkedIn-via-MHESI the global one (Council direction,
//      2026-09-13). The pair keeps its weight of two drivers in the Relevance
//      mean and only the split inside it changes; when one source is null the
//      other counts as a single driver. See LABOUR_MARKET_DEMAND_WEIGHTS.
//
// v5.3 (2026-10-02) — capability gains external_grant_engagement: the share
//   of a programme's active teaching staff on at least one externally funded
//   project (research_service_project_members) in the last 3 complete Thai
//   fiscal years, 60% -> 100. Null, never 0, until the kku-research-services
//   sync has 30 days of green history. Built by grantEngagementDriver at
//   both program and scope (that module was removed in v5.4).
//
// v5.4 (2026-10-03) — external grants move from Capability to an AWARD on
//   Financial. The external_grant_engagement driver and its 30-day gate are
//   removed (Capability is back to four drivers at 25 %). Financial gains up
//   to +10 points AFTER its drivers are averaged: grant baht per active
//   teaching staff member per year, last 3 complete Thai FY, log curve
//   ฿0.1 M → 0 to ฿3 M → +10 (packages/db/src/grant-award.ts). Never lowers
//   a score, never touches completeness, null base earns nothing.
//
// v5.5 (2026-11-03) — the demographic-resilience driver reads the
//   institution's region from the organisation profile (regionEn, matched
//   against the regions the projection carries; no match or no profile ->
//   the driver is null, never the national series) instead of a hard-coded
//   'Northeast'. The student:staff-ratio band comes from the faculty's
//   Teaching Mode (Faculty.sfrBand; default Professional) instead of a
//   hard-coded faculty-code map; KKU's bands were backfilled by migration,
//   so its scores are unchanged.
//
// v5.6 (2026-11-03) — when the latest complete admission-campaign year has no
//   planned seats (an adopter's sheet often has applicants and passed counts
//   but no seats), tcas_competition_ratio, tcas_fill_rate and
//   tcas_competition_vs_peers fall back to the programme's public TCAS
//   round-3 figures for that year (ratio = applicants / quota, fill =
//   admitted / quota; each tcas_course_code counted once, then summed). The
//   basis is recorded as `basis: 'public-tcas-round3'` in the driver raw.
//   tcas_registration_yield has no public equivalent and stays null. The
//   fallback also fires for a programme with no campaign rows at all (latest
//   complete year that has public round-3 rows). tcas_registration_yield is
//   null, reason 'reported-not-stated', when Confirmed is stated but no row
//   states Reported (absent is not 0). The tcas_min_score_percentile driver
//   retries with the signature of the programme's own Thai name when its
//   TCAS subject key finds fewer than 3 peers. KKU's campaign data carries
//   seats and Reported, so the funnel drivers are unchanged for it; the
//   percentile fallback can move KKU programmes that previously read null
//   and was not measured on KKU data (none is available on this branch).

export const UPSTREAM_HEALTH_SCORE_VERSION = 'health-score.v5.6';

/** The version stamped on every score this installation computes. */
export const HEALTH_SCORE_VERSION: string =
  INSTITUTION_REVISION === null
    ? UPSTREAM_HEALTH_SCORE_VERSION
    : `${UPSTREAM_HEALTH_SCORE_VERSION}+${INSTITUTION_REVISION}`;

// ── Cost-allocation methodology (gap #5) ────────────────────────────
// The Financial dimension's `net_contribution_per_student` +
// `revenue_coverage_program_direct` drivers depend on
// `FinancialMetric.{directCost, allocatedFacultyCost, allocatedFacilityCost,
// allocatedOverhead}`. The methodology that computes those values
// (activity-based allocation across faculty/facility/overhead pools) is
// documented at docs/methodologies/cost-allocation.md and is **v0
// draft — pending Finance Committee approval**.
//
// Surface this prominently. The methodology-bundle (see
// packages/db/src/methodology-bundle.ts) marks `cost-allocation` as a
// preview methodology so Council-facing PDFs render a PREVIEW badge in
// the methodology appendix. When v1 lands, bump the constant + remove
// from PREVIEW_METHODOLOGIES.
export const COST_ALLOCATION_VERSION = 'cost-allocation.v0';
