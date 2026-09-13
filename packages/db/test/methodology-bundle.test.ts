// Drift-detection test for the methodology bundle. Closes the half of
// evaluation-pipeline.md §13 gap #4 that catches "someone bumped a
// version constant but forgot to refresh the manifest".
//
// The test imports each *_VERSION constant directly from its source and
// asserts the bundle's manifest matches. If the test fails, the fix is
// to update the constant in `packages/db/src/methodology-bundle.ts` AND
// bump `BUNDLE_CALENDAR_TAG` if this is a release-shipping change.

import { describe, it, expect } from 'vitest';

import {
  LANDSCAPE_METHODOLOGY_BUNDLE,
  METHODOLOGY_MANIFEST,
  BUNDLE_FINGERPRINT,
  PREVIEW_METHODOLOGIES,
  formatBundleStamp,
  listBundleEntries,
  listPreviewBundleEntries,
  isPreviewMethodology,
} from '../src/methodology-bundle';

import { HEALTH_SCORE_VERSION, COST_ALLOCATION_VERSION } from '../src/health-score';
import { RISK_SCORING_VERSION } from '../src/risk-scoring';
import { BENCHMARKING_VERSION } from '../src/benchmarking';
import { BENCHMARKING_OVERVIEW_VERSION } from '../src/benchmarking-overview';
import { GAP_ANALYSIS_VERSION } from '../src/gap-analysis';
import { DASHBOARD_OVERVIEW_VERSION } from '../src/dashboard-overview';
import { DECISION_WORKSPACE_VERSION } from '../src/decisions';
import { DATA_QUALITY_VERSION } from '../src/data-quality';
import { JOBTHAI_BRIDGE_VERSION } from '../src/jobthai-bridge';

import {
  FORECASTING_VERSION,
  SCENARIO_ENGINE_VERSION,
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
  GAP_INSIGHTS_VERSION,
  IMD_RANKINGS_EXTRACT_VERSION,
  ANALYST_SYSTEM_PROMPT_VERSION,
  ANALYST_SAFETY_VERSION,
  ANALYST_TOOLS_VERSION,
  EXPERTISE_NARRATIVE_VERSION,
} from '@kku/shared';

describe('LANDSCAPE_METHODOLOGY_BUNDLE', () => {
  it('exposes a stable tag + fingerprint', () => {
    expect(LANDSCAPE_METHODOLOGY_BUNDLE.tag).toMatch(/^landscape-\d{4}-\d{2}\.v\d+$/);
    expect(LANDSCAPE_METHODOLOGY_BUNDLE.fingerprint).toMatch(/^[0-9a-f]{8}$/);
    expect(LANDSCAPE_METHODOLOGY_BUNDLE.fingerprint).toBe(BUNDLE_FINGERPRINT);
  });

  it('formatBundleStamp returns tag+fingerprint', () => {
    const stamp = formatBundleStamp();
    expect(stamp).toBe(`${LANDSCAPE_METHODOLOGY_BUNDLE.tag}+${LANDSCAPE_METHODOLOGY_BUNDLE.fingerprint}`);
  });

  it('listBundleEntries returns alphabetically-sorted entries', () => {
    const entries = listBundleEntries();
    expect(entries.length).toBe(Object.keys(METHODOLOGY_MANIFEST).length);
    for (let i = 1; i < entries.length; i++) {
      expect(entries[i]!.key.localeCompare(entries[i - 1]!.key)).toBeGreaterThanOrEqual(0);
    }
  });

  // ── Drift detection — every entry must match its imported constant ─
  it('manifest is current — drift catcher', () => {
    expect(METHODOLOGY_MANIFEST['health-score']).toBe(HEALTH_SCORE_VERSION);
    expect(METHODOLOGY_MANIFEST['jobthai-bridge']).toBe(JOBTHAI_BRIDGE_VERSION);
    expect(METHODOLOGY_MANIFEST['risk-scoring']).toBe(RISK_SCORING_VERSION);
    expect(METHODOLOGY_MANIFEST['benchmarking']).toBe(BENCHMARKING_VERSION);
    expect(METHODOLOGY_MANIFEST['benchmarking-overview']).toBe(BENCHMARKING_OVERVIEW_VERSION);
    expect(METHODOLOGY_MANIFEST['gap-analysis']).toBe(GAP_ANALYSIS_VERSION);
    expect(METHODOLOGY_MANIFEST['dashboard-overview']).toBe(DASHBOARD_OVERVIEW_VERSION);
    expect(METHODOLOGY_MANIFEST['decision-workspace']).toBe(DECISION_WORKSPACE_VERSION);
    expect(METHODOLOGY_MANIFEST['data-quality']).toBe(DATA_QUALITY_VERSION);
    expect(METHODOLOGY_MANIFEST['forecasting']).toBe(FORECASTING_VERSION);
    expect(METHODOLOGY_MANIFEST['scenario-engine']).toBe(SCENARIO_ENGINE_VERSION);
    expect(METHODOLOGY_MANIFEST['program-digest']).toBe(PROGRAM_DIGEST_VERSION);
    expect(METHODOLOGY_MANIFEST['program-peer-review']).toBe(PROGRAM_PEER_REVIEW_VERSION);
    expect(METHODOLOGY_MANIFEST['program-peer-selection']).toBe(PROGRAM_PEER_SELECTION_VERSION);
    expect(METHODOLOGY_MANIFEST['program-ai-readiness']).toBe(PROGRAM_AI_READINESS_VERSION);
    expect(METHODOLOGY_MANIFEST['program-strategic-narrative']).toBe(PROGRAM_STRATEGIC_NARRATIVE_VERSION);
    expect(METHODOLOGY_MANIFEST['program-skills-detailed']).toBe(PROGRAM_SKILLS_DETAILED_VERSION);
    expect(METHODOLOGY_MANIFEST['program-faculty']).toBe(PROGRAM_FACULTY_VERSION);
    expect(METHODOLOGY_MANIFEST['program-pedagogy']).toBe(PROGRAM_PEDAGOGY_VERSION);
    expect(METHODOLOGY_MANIFEST['risk-assessment']).toBe(RISK_ASSESSMENT_VERSION);
    expect(METHODOLOGY_MANIFEST['demand-match']).toBe(DEMAND_MATCH_VERSION);
    expect(METHODOLOGY_MANIFEST['graduate-employment-survey']).toBe(GRADUATE_EMPLOYMENT_SURVEY_VERSION);
    expect(METHODOLOGY_MANIFEST['career-kmitl-mapping']).toBe(CAREER_KMITL_MAPPING_VERSION);
    expect(METHODOLOGY_MANIFEST['scenario-insights']).toBe(SCENARIO_INSIGHTS_VERSION);
    expect(METHODOLOGY_MANIFEST['benchmarking-insights']).toBe(BENCHMARKING_INSIGHTS_VERSION);
    expect(METHODOLOGY_MANIFEST['gap-insights']).toBe(GAP_INSIGHTS_VERSION);
    expect(METHODOLOGY_MANIFEST['imd-rankings-extract']).toBe(IMD_RANKINGS_EXTRACT_VERSION);
    expect(METHODOLOGY_MANIFEST['analyst-system']).toBe(ANALYST_SYSTEM_PROMPT_VERSION);
    expect(METHODOLOGY_MANIFEST['analyst-safety']).toBe(ANALYST_SAFETY_VERSION);
    expect(METHODOLOGY_MANIFEST['analyst-tools']).toBe(ANALYST_TOOLS_VERSION);
    expect(METHODOLOGY_MANIFEST['expertise-narrative']).toBe(EXPERTISE_NARRATIVE_VERSION);
    // lifecycle is the one non-imported entry — kept inline in
    // methodology-bundle.ts because LIFECYCLE_VERSION is not exported
    // from program-deep-dive.ts. When that gets exported, replace this
    // with a proper import + assertion.
    expect(METHODOLOGY_MANIFEST['lifecycle']).toBe('lifecycle.v1.4');
  });

  it('every manifest value is a non-empty version string', () => {
    for (const [key, value] of Object.entries(METHODOLOGY_MANIFEST)) {
      expect(typeof value).toBe('string');
      expect(value.length, `${key} version should be non-empty`).toBeGreaterThan(0);
    }
  });

  // ── Preview methodologies (gap #5) ───────────────────────────────────
  it('cost-allocation is registered as preview', () => {
    expect(METHODOLOGY_MANIFEST['cost-allocation']).toBe(COST_ALLOCATION_VERSION);
    expect(isPreviewMethodology('cost-allocation')).toBe(true);
    expect(PREVIEW_METHODOLOGIES).toContain('cost-allocation');
  });

  it('preview methodologies appear in the bundle', () => {
    expect(LANDSCAPE_METHODOLOGY_BUNDLE.previewMethodologies).toContain('cost-allocation');
    const previewEntries = listPreviewBundleEntries();
    expect(previewEntries.find((e) => e.key === 'cost-allocation')).toBeTruthy();
  });

  it('every preview methodology has a manifest entry — no orphan preview tags', () => {
    for (const slug of PREVIEW_METHODOLOGIES) {
      expect(
        METHODOLOGY_MANIFEST[slug],
        `${slug} is in PREVIEW_METHODOLOGIES but missing from manifest`,
      ).toBeTruthy();
    }
  });

  it('non-preview methodologies are not flagged', () => {
    expect(isPreviewMethodology('health-score')).toBe(false);
    expect(isPreviewMethodology('lifecycle')).toBe(false);
    expect(isPreviewMethodology('risk-scoring')).toBe(false);
  });
});
