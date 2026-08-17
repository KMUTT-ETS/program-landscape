import { describe, expect, it } from 'vitest';
import { lintBannedTells } from '../src/ai/lint-tells';

describe('lintBannedTells', () => {
  it('catches "highly robust applicant interest"', () => {
    const violations = lintBannedTells(
      'The programme has seen highly robust applicant interest this cycle.',
    );
    expect(violations.some((v) => v.phrase === 'robust')).toBe(true);
  });

  it('catches "It is important to note" case-insensitively', () => {
    const violations = lintBannedTells(
      'It is important to note that enrollment declined 12% year over year.',
    );
    expect(violations.some((v) => v.phrase === 'it is important to note')).toBe(true);
  });

  it('is case-insensitive across all tells', () => {
    const violations = lintBannedTells('We should LEVERAGE this DELVE further into the data.');
    const phrases = violations.map((v) => v.phrase);
    expect(phrases).toContain('leverage');
    expect(phrases).toContain('delve');
  });

  // Word-family decision: the tell is the word family, not the exact
  // inflection — "robust" must also match "robustness".
  it('matches the word family — "robustness" flags the "robust" tell', () => {
    const violations = lintBannedTells('The curriculum shows real robustness against shocks.');
    expect(violations.some((v) => v.phrase === 'robust')).toBe(true);
  });

  it('flags bare metaphorical "landscape" while sparing "Program Landscape"', () => {
    const violations = lintBannedTells(
      'Program Landscape tracks this program. The competitive landscape has shifted toward AI-adjacent skills.',
    );
    const landscapeHits = violations.filter((v) => v.phrase === 'landscape');
    expect(landscapeHits).toHaveLength(1);
    expect(landscapeHits[0]!.excerpt).toContain('competitive landscape');
  });

  it('spares "Program Landscape" case-insensitively', () => {
    const violations = lintBannedTells('program landscape is the platform name.');
    expect(violations.some((v) => v.phrase === 'landscape')).toBe(false);
  });

  it('returns an empty array for clean text', () => {
    const violations = lintBannedTells(
      '## Executive summary\nThe program shows a stable trajectory with 82/100 health score.\n\n## Strategic position\n- Competition ratio is 3.2x, up from 2.1x last cycle.',
    );
    expect(violations).toEqual([]);
  });
});
