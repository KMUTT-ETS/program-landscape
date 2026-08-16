import { describe, expect, it } from 'vitest';
import {
  buildProgramStrategicNarrativeMessages,
  PROGRAM_STRATEGIC_NARRATIVE_VERSION,
} from '../src/ai/prompts/program-strategic-narrative';
import { FIXTURE_INPUT } from './fixtures/strategic-narrative-input';

describe('program-strategic-narrative v2 builder', () => {
  const messages = buildProgramStrategicNarrativeMessages(FIXTURE_INPUT);
  const system = messages.find((m) => m.role === 'system')?.content ?? '';
  const user = messages.find((m) => m.role === 'user')?.content ?? '';

  it('is version 2', () => {
    expect(PROGRAM_STRATEGIC_NARRATIVE_VERSION).toBe('program-strategic-narrative.v2');
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
