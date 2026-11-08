import { describe, expect, it } from 'vitest';
import {
  buildProgramStrategicNarrativeMessages,
  countMissingNarrativeChannels,
  narrativeCostBasis,
  narrativeTcasFromHistory,
  type TcasHistoryRow,
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

describe('narrative TCAS facts (F19)', () => {
  const row = (o: Partial<TcasHistoryRow>): TcasHistoryRow => ({
    entryYearBE: 2569, round: '3', quota: 40, applicants: 335,
    admittedPass1: 0, admittedPass2: 0, minScorePass1: null, ...o,
  });

  it('gives a null fill rate and no min score when the latest year publishes neither', () => {
    const t = narrativeTcasFromHistory([row({})])!;
    expect(t.fillRate).toBeNull();
    expect(t.minScore).toBeNull();
    expect(t.competitionRatio).toBeCloseTo(8.375);
  });

  it('takes the min score from the latest year that publishes it, naming that year', () => {
    const t = narrativeTcasFromHistory([
      row({ entryYearBE: 2568, admittedPass1: 30, minScorePass1: 61.5 }),
      row({}),
    ])!;
    expect(t.latestYearBE).toBe(2569);
    expect(t.minScore).toBe(61.5);
    expect(t.minScoreYearBE).toBe(2568);
    expect(t.fillRate).toBeNull();
  });

  it('uses the largest admitted count across the latest year rows (3.1/3.2 repeat rows)', () => {
    const t = narrativeTcasFromHistory([
      row({ round: '3.1', admittedPass1: 0 }),
      row({ round: '3.2', admittedPass1: 30, minScorePass1: 70 }),
    ])!;
    expect(t.fillRate).toBeCloseTo(0.75);
    expect(t.minScoreYearBE).toBe(2569);
  });

  it('never renders a 0.0% fill rate or a 0 min score', () => {
    const t = narrativeTcasFromHistory([row({})])!;
    const u = buildProgramStrategicNarrativeMessages({ ...FIXTURE_INPUT, tcas: t })
      .find((m) => m.role === 'user')!.content;
    expect(u).toMatch(/Fill rate:\s+not published/);
    expect(u).not.toContain('0.0%');
    expect(u).toMatch(/Min admission:\s+not published/);
  });

  it('returns null with no rows', () => {
    expect(narrativeTcasFromHistory([])).toBeNull();
  });
});

describe('narrative financial cost basis (F20)', () => {
  it('says net contribution per student is not modelled by design on a revenue-only installation', () => {
    const u = buildProgramStrategicNarrativeMessages({
      ...FIXTURE_INPUT,
      financial: { ...FIXTURE_INPUT.financial!, netContributionPerStudent: null, costBasis: 'revenue-only' },
    }).find((m) => m.role === 'user')!.content;
    expect(u).toMatch(/Net contrib \/ student:\s+not modelled/);
    expect(u).not.toMatch(/Net contrib \/ student:\s+THB n\/d/);
  });
  it('keeps n/d when costs are allocated but the figure is missing', () => {
    const u = buildProgramStrategicNarrativeMessages({
      ...FIXTURE_INPUT,
      financial: { ...FIXTURE_INPUT.financial!, netContributionPerStudent: null, costBasis: 'allocated' },
    }).find((m) => m.role === 'user')!.content;
    expect(u).toMatch(/Net contrib \/ student:\s+THB n\/d/);
  });
  it('derives the cost basis from the direct cost and cost per student', () => {
    expect(narrativeCostBasis({ costPerStudent: null, directCost: 0 })).toBe('revenue-only');
    expect(narrativeCostBasis({ costPerStudent: null, directCost: 5 })).toBe('allocated');
    expect(narrativeCostBasis({ costPerStudent: 100, directCost: 0 })).toBe('allocated');
  });
});
