// ─────────────────────────────────────────────────────────────────────────────
// Methodology bundle — closes evaluation-pipeline.md §13 gap #4.
//
// A Council Pack frequently cites 5+ sub-methodology versions in a single
// document (health-score.v3.6, lifecycle.v1.4, risk-scoring.v1.10, peer-
// review.v2, program-strategic-narrative.v1, ...). PDF footers embed one
// stamp per page — readers can't tell which section uses which version.
//
// This module exposes a **release-bundle constant** that ties all current
// sub-versions together with two identifiers:
//
//   - `tag`         a human-readable calendar identity bumped manually
//                   on each release (`landscape-YYYY-MM.vN`). Operators
//                   bump this when assembling a Council brief release.
//   - `fingerprint` a stable 8-char SHA-256 of the manifest. Bumps
//                   automatically whenever ANY sub-version changes — so
//                   if someone bumps health-score.v3.4 → v3.5 and
//                   forgets to retag, the fingerprint catches it.
//
// Council Pack PDFs render `<tag>+<fingerprint>` on the cover + footer +
// list the full manifest in an appendix. Analysts can trace any number
// in a brief back to a specific (sub-version × ingestion-run × data
// source) triple via the provenance drawer.
//
// Drift safety: there's a unit test at packages/db/test/methodology-
// bundle.test.ts that asserts every entry in the manifest equals its
// imported constant. CI catches the case where someone updates a
// version constant but doesn't reflect it here.
// ─────────────────────────────────────────────────────────────────────────────

import { createHash } from 'node:crypto';

// ── Imports from @kku/db ────────────────────────────────────────────────
import { HEALTH_SCORE_VERSION, COST_ALLOCATION_VERSION } from './health-score';
import { RISK_SCORING_VERSION } from './risk-scoring';
import { BENCHMARKING_VERSION } from './benchmarking';
import { BENCHMARKING_OVERVIEW_VERSION } from './benchmarking-overview';
import { GAP_ANALYSIS_VERSION } from './gap-analysis';
import { GAP_MAP_VERSION } from './gap-map-rules';
import { DASHBOARD_OVERVIEW_VERSION } from './dashboard-overview';
import { DECISION_WORKSPACE_VERSION } from './decisions';
import { DATA_QUALITY_VERSION } from './data-quality';
import { JOBTHAI_BRIDGE_VERSION } from './jobthai-bridge';

// ── Imports from @kku/shared (engines + prompts) ────────────────────────
import {
  FORECASTING_VERSION,
  SCENARIO_ENGINE_VERSION,
  // AI prompt versions — only the Council-affecting ones.
  // Intermediate-extraction prompts (course-skill-extraction, skill-name-
  // normaliser, job-posting-skill-extraction, policy-doc-analysis) are
  // excluded — they feed downstream methodologies that ARE listed; the
  // upstream versions are already accountable via the downstream stamps.
  PROGRAM_DIGEST_VERSION,
  PROGRAM_PEER_REVIEW_VERSION,
  PROGRAM_PEER_SELECTION_VERSION,
  PROGRAM_AI_READINESS_VERSION,
  PROGRAM_STRATEGIC_NARRATIVE_VERSION,
  PROGRAM_SKILLS_DETAILED_VERSION,
  PROGRAM_FACULTY_VERSION,
  PROGRAM_PEDAGOGY_VERSION,
  RISK_ASSESSMENT_VERSION,
  DEMAND_MATCH_VERSION,
  GRADUATE_EMPLOYMENT_SURVEY_VERSION,
  CAREER_KMITL_MAPPING_VERSION,
  SCENARIO_INSIGHTS_VERSION,
  BENCHMARKING_INSIGHTS_VERSION,
  GAP_BRIEF_VERSION,
  JOB_FIELD_TAXONOMY_VERSION,
  PROGRAM_JOB_FIELD_VERSION,
  IMD_RANKINGS_EXTRACT_VERSION,
  ANALYST_SYSTEM_PROMPT_VERSION,
  ANALYST_SAFETY_VERSION,
  ANALYST_TOOLS_VERSION,
  EXPERTISE_NARRATIVE_VERSION,
} from '@kku/shared';

// Lifecycle verdict version is private to program-deep-dive.ts at the
// moment (not exported). Re-declared here against the methodology doc;
// the drift test below cross-checks it via a structural assertion in
// the deep-dive test file.
//
// v1.2 (2026-05-12 — gap #8) exposes the gate counterfactual: result
// now carries `ungatedVerdict` + `gatesApplied[]` alongside the gated
// `verdict`. No behavioural change to the gated verdict.
//
// v1.3 (2026-05-12) rebalances qualitative-vs-quantitative content
// signals: content_modernity halved (±20 → ±10), new first-class
// labour_market_alignment driver (±15), plus two new modifier gates
// (lowLabourMarketAlignmentStable/FrontierCap) mirroring the AI-
// readiness gate pattern.
//
// v1.4 (2026-05-12) bakes revenue-production potential into the
// verdict: new `revenue_scale` driver (±10, level-aware) + new
// `lowRevenuePotentialFrontierCap` gate (absolute 3M THB/yr flagship
// floor). FRONTIER reserved for revenue-substantial programs;
// boutique-excellence PhDs cap at RISING, reflecting the non-degree
// HRD shift squeezing post-grad cohorts.
const LIFECYCLE_VERSION = 'lifecycle.v1.4';

// ── The bundle ──────────────────────────────────────────────────────────

/**
 * Human-readable calendar tag. Bump manually on each release sprint.
 * Convention: `landscape-YYYY-MM.vN` where N starts at 1 and resets on
 * month change. Operators set this just before assembling a Council
 * brief; it gives readers a stable, citable identity for a methodology
 * snapshot ("which version is this Council Pack? `landscape-2026-05.v1`").
 *
 * The fingerprint (below) catches the case where you forget to bump
 * this on a sub-version update — CI fails until either the tag bumps
 * or the change is undone.
 */
export const BUNDLE_CALENDAR_TAG = 'landscape-2026-09.v5';

/**
 * The full sub-version manifest. Keys are stable, ordered alphabetically
 * for deterministic JSON-stringification (the fingerprint hashes this
 * shape).
 *
 * Categories:
 *   - aggregators:  cross-cut scoring + dashboard helpers
 *   - methodology:  individual methodology versions
 *   - ai-prompts:   AI prompt templates (only Council-affecting ones)
 */
export const METHODOLOGY_MANIFEST = {
  // Scoring + aggregation
  'analyst-safety':            ANALYST_SAFETY_VERSION,
  'analyst-system':            ANALYST_SYSTEM_PROMPT_VERSION,
  'analyst-tools':             ANALYST_TOOLS_VERSION,
  'benchmarking':              BENCHMARKING_VERSION,
  'benchmarking-insights':     BENCHMARKING_INSIGHTS_VERSION,
  'benchmarking-overview':     BENCHMARKING_OVERVIEW_VERSION,
  'career-kmitl-mapping':      CAREER_KMITL_MAPPING_VERSION,
  'cost-allocation':           COST_ALLOCATION_VERSION,
  'dashboard-overview':        DASHBOARD_OVERVIEW_VERSION,
  'data-quality':              DATA_QUALITY_VERSION,
  'decision-workspace':        DECISION_WORKSPACE_VERSION,
  'demand-match':              DEMAND_MATCH_VERSION,
  'expertise-narrative':       EXPERTISE_NARRATIVE_VERSION,
  'forecasting':               FORECASTING_VERSION,
  // The per-programme LinkedIn demand-gap helper. NOT the gap map — the
  // seven-lens analyzer it used to belong to was retired in v1.9.7.
  'gap-analysis':              GAP_ANALYSIS_VERSION,
  // Demand-first gap map: the verdict rule Council reads on /gap-analysis.
  'gap-brief':                 GAP_BRIEF_VERSION,
  'gap-map':                   GAP_MAP_VERSION,
  'graduate-employment-survey': GRADUATE_EMPLOYMENT_SURVEY_VERSION,
  'health-score':              HEALTH_SCORE_VERSION,
  'imd-rankings-extract':      IMD_RANKINGS_EXTRACT_VERSION,
  // The field-of-study taxonomy the map's rows come from — a prompt bump
  // re-clusters demand, so it moves Council figures.
  'job-field-taxonomy':        JOB_FIELD_TAXONOMY_VERSION,
  // Programme <-> JobThai occupation links: feed jobthai_demand_alignment and
  // the Deep-Dive JobThai demand view, so a link-rule change moves Council figures.
  'jobthai-bridge':            JOBTHAI_BRIDGE_VERSION,
  'lifecycle':                 LIFECYCLE_VERSION,
  'program-ai-readiness':      PROGRAM_AI_READINESS_VERSION,
  'program-digest':            PROGRAM_DIGEST_VERSION,
  'program-faculty':           PROGRAM_FACULTY_VERSION,
  // Which fields of study each programme supplies — the map's supply side.
  'program-job-field':         PROGRAM_JOB_FIELD_VERSION,
  'program-peer-review':       PROGRAM_PEER_REVIEW_VERSION,
  'program-pedagogy':          PROGRAM_PEDAGOGY_VERSION,
  'program-peer-selection':    PROGRAM_PEER_SELECTION_VERSION,
  'program-skills-detailed':   PROGRAM_SKILLS_DETAILED_VERSION,
  'program-strategic-narrative': PROGRAM_STRATEGIC_NARRATIVE_VERSION,
  'risk-assessment':           RISK_ASSESSMENT_VERSION,
  'risk-scoring':              RISK_SCORING_VERSION,
  'scenario-engine':           SCENARIO_ENGINE_VERSION,
  'scenario-insights':         SCENARIO_INSIGHTS_VERSION,
} as const;

export type MethodologyManifest = typeof METHODOLOGY_MANIFEST;
export type MethodologyKey = keyof MethodologyManifest;

/**
 * 8-char SHA-256 prefix of the JSON-stringified manifest. Sort keys to
 * make the hash deterministic across JS engine implementations.
 */
function computeFingerprint(manifest: Record<string, string>): string {
  const sortedKeys = Object.keys(manifest).sort();
  const canonical = JSON.stringify(sortedKeys.map((k) => [k, manifest[k]]));
  return createHash('sha256').update(canonical).digest('hex').slice(0, 8);
}

export const BUNDLE_FINGERPRINT = computeFingerprint(METHODOLOGY_MANIFEST);

// ── Preview-quality methodologies (gap #5) ──────────────────────────────
//
// Methodologies whose outputs flow into Council-facing surfaces but
// have NOT yet been signed off by their respective governance body.
// Council Pack PDFs render a PREVIEW badge next to these entries in the
// methodology appendix so readers know to treat the derived numbers as
// indicative rather than authoritative.
//
// Lifecycle:
//   - Enter PREVIEW_METHODOLOGIES when the methodology is implemented
//     but pending sign-off (e.g., Finance Committee for cost-allocation).
//   - Remove when sign-off lands AND the version bumps to a non-draft
//     identity (v0 → v1.0).
//
// Currently:
//   - cost-allocation.v0 — pending Finance Committee approval. The
//     methodology drives FinancialMetric.{directCost,
//     allocatedFacultyCost, allocatedFacilityCost, allocatedOverhead},
//     which in turn power Health Score's net_contribution_per_student
//     + revenue_coverage_program_direct drivers and Risk Score's I2
//     stranded-structural-cost dimension.
export const PREVIEW_METHODOLOGIES: readonly MethodologyKey[] = [
  'cost-allocation',
] as const;

/**
 * The release bundle. Use this when stamping any Council-facing surface
 * (PDF, brief, export, snapshot) with the methodology version snapshot.
 *
 * Display convention: `tag+fingerprint` (e.g., `landscape-2026-05.v1+a3f7b291`)
 * — the tag is the citable identity, the fingerprint catches drift.
 */
export const LANDSCAPE_METHODOLOGY_BUNDLE = {
  tag: BUNDLE_CALENDAR_TAG,
  fingerprint: BUNDLE_FINGERPRINT,
  manifest: METHODOLOGY_MANIFEST,
  // Gap #5 — methodology slugs that are in preview / pending governance
  // sign-off. PDF appendix renders a PREVIEW badge for each.
  previewMethodologies: PREVIEW_METHODOLOGIES,
} as const;

export type LandscapeMethodologyBundle = typeof LANDSCAPE_METHODOLOGY_BUNDLE;


/**
 * Returns true if the given methodology slug is currently in preview
 * (pending governance sign-off).
 */
export function isPreviewMethodology(slug: string): boolean {
  return (PREVIEW_METHODOLOGIES as readonly string[]).includes(slug);
}

/**
 * The subset of bundle entries whose methodology is in preview. Useful
 * for surfaces that want to show "this brief depends on N preview-quality
 * methodologies".
 */
export function listPreviewBundleEntries(
  bundle: LandscapeMethodologyBundle = LANDSCAPE_METHODOLOGY_BUNDLE,
): Array<{ key: string; version: string }> {
  return listBundleEntries(bundle).filter((e) => isPreviewMethodology(e.key));
}

/**
 * Render the bundle as a single stamp suitable for footers + cover lines.
 *
 *   formatBundleStamp(LANDSCAPE_METHODOLOGY_BUNDLE)
 *     => "landscape-2026-05.v1+a3f7b291"
 */
export function formatBundleStamp(bundle: LandscapeMethodologyBundle = LANDSCAPE_METHODOLOGY_BUNDLE): string {
  return `${bundle.tag}+${bundle.fingerprint}`;
}

/**
 * Sorted list of `{ key, version }` entries — convenient for rendering
 * the methodology appendix in a PDF without re-sorting at the call site.
 */
export function listBundleEntries(
  bundle: LandscapeMethodologyBundle = LANDSCAPE_METHODOLOGY_BUNDLE,
): Array<{ key: string; version: string }> {
  return Object.entries(bundle.manifest)
    .map(([key, version]) => ({ key, version }))
    .sort((a, b) => a.key.localeCompare(b.key));
}
