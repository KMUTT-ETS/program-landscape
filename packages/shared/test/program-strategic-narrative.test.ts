import { describe, expect, it } from 'vitest';
import {
  buildProgramStrategicNarrativeMessages,
  countMissingNarrativeChannels,
  narrativeConfidenceCeiling,
  PROGRAM_STRATEGIC_NARRATIVE_VERSION,
  type ProgramStrategicNarrativeInput,
} from '../src/ai/prompts/program-strategic-narrative';
import { FIXTURE_INPUT } from './fixtures/strategic-narrative-input';

describe('program-strategic-narrative v2 builder', () => {
  const messages = buildProgramStrategicNarrativeMessages(FIXTURE_INPUT);
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const user = messages.find((m) => m.role === 'user')?.content ?? '';

  it('is version 2', () => {
    expect(PROGRAM_STRATEGIC_NARRATIVE_VERSION).toBe('program-strategic-narrative.v3');
  });

  it('demands English output explicitly', () => {
    expect(system).toMatch(/English/);
  });

  it('carries the confidence rubric and the tell ban', () => {
    expect(system).toContain('CONFIDENCE RUBRIC');
    expect(system).toMatch(/BANNED PHRASES/i);
  });

  it('feeds the new channels into the user snapshot', () => {
    expect(user).toContain('GRADUATE OUTCOMES');
    expect(user).toContain('LABOUR-MARKET DEMAND');
    expect(user).toContain('TREND SIGNALS');
    expect(user).toContain('RISK');
    expect(user).toContain('COHORT');
  });

  it('renders a missing channel as explicitly unavailable, not silently absent', () => {
    const noOutcomes = { ...FIXTURE_INPUT, outcomes: null };
    const u = buildProgramStrategicNarrativeMessages(noOutcomes)
      .find((m) => m.role === 'user')!.content;
    expect(u).toContain('GRADUATE OUTCOMES: data not available');
  });

  it('renders EVERY nullable channel — including the 8 v1-era ones — as explicitly unavailable when null, never silently dropped', () => {
    const allNull = {
      ...FIXTURE_INPUT,
      lifecycle: null,
      health: null,
      aiReadiness: null,
      tcas: null,
      financial: null,
      demand: null,
      demographic: null,
      peerReview: null,
      outcomes: null,
      demandMatch: null,
      trendSignals: [],
      risk: null,
      cohorts: null,
    };
    const u = buildProgramStrategicNarrativeMessages(allNull).find((m) => m.role === 'user')!
      .content;
    for (const header of [
      'LIFECYCLE',
      'HEALTH SCORE',
      'AI READINESS',
      'TCAS3 ADMISSIONS',
      'FINANCIAL',
      'DEMAND FUNNEL',
      'DEMOGRAPHIC OUTLOOK',
      'AI PEER REVIEW',
      'GRADUATE OUTCOMES',
      'LABOUR-MARKET DEMAND',
      'TREND SIGNALS',
      'RISK',
      'COHORT',
    ]) {
      expect(u, `${header} should render "data not available" when null`).toContain(
        `${header}: data not available`,
      );
    }
  });

  it('keeps the hard structural rules from v1', () => {
    for (const marker of [
      'No greetings, no closings',
      '## Executive summary',
      '## Recommended actions',
      '250-400 words',
    ]) {
      expect(system).toContain(marker);
    }
  });
});

describe('countMissingNarrativeChannels', () => {
  it('counts 0 missing on the full fixture', () => {
    expect(countMissingNarrativeChannels(FIXTURE_INPUT)).toBe(0);
  });

  it('counts all 13 channels missing when everything is nulled/empty', () => {
    const allMissing: ProgramStrategicNarrativeInput = {
      ...FIXTURE_INPUT,
      lifecycle: null,
      health: null,
      aiReadiness: null,
      tcas: null,
      financial: null,
      demand: null,
      demographic: null,
      peerReview: null,
      outcomes: null,
      demandMatch: null,
      trendSignals: [],
      risk: null,
      cohorts: null,
    };
    expect(countMissingNarrativeChannels(allMissing)).toBe(13);
  });

  it('counts trendSignals as missing only when the array is empty', () => {
    const withOneMissing: ProgramStrategicNarrativeInput = {
      ...FIXTURE_INPUT,
      trendSignals: [],
    };
    expect(countMissingNarrativeChannels(withOneMissing)).toBe(1);
  });
});

describe('narrativeConfidenceCeiling', () => {
  it('bands the ceiling per the rubric edges', () => {
    expect(narrativeConfidenceCeiling(0)).toBe(1.0);
    expect(narrativeConfidenceCeiling(1)).toBe(0.89);
    expect(narrativeConfidenceCeiling(3)).toBe(0.69);
    expect(narrativeConfidenceCeiling(5)).toBe(0.55);
    expect(narrativeConfidenceCeiling(6)).toBe(0.49);
    expect(narrativeConfidenceCeiling(13)).toBe(0.49);
  });

  it('bands the 2-3 and 4-5 midpoints too', () => {
    expect(narrativeConfidenceCeiling(2)).toBe(0.69);
    expect(narrativeConfidenceCeiling(4)).toBe(0.55);
  });
});
