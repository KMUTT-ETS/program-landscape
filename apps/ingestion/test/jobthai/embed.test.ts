import { describe, expect, it } from 'vitest';

import { acceptSemanticMatches, JOBTHAI_EMBED_MATCH_FLOOR } from '../../src/jobthai/embed';

describe('acceptSemanticMatches', () => {
  it('rejects a candidate below the floor', () => {
    const out = acceptSemanticMatches({
      existing: [],
      candidates: [{ postingId: 'p1', skillId: 's1', cosine: JOBTHAI_EMBED_MATCH_FLOOR - 0.01 }],
    });
    expect(out).toEqual([]);
  });

  it('accepts at exactly the floor and marks it EMBEDDING_MATCHED', () => {
    const out = acceptSemanticMatches({
      existing: [],
      candidates: [{ postingId: 'p1', skillId: 's1', cosine: JOBTHAI_EMBED_MATCH_FLOOR }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.extractedBy).toBe('EMBEDDING_MATCHED');
  });

  it('never downgrades a deterministic match for the same posting and skill', () => {
    const out = acceptSemanticMatches({
      existing: [{ postingId: 'p1', skillId: 's1', extractedBy: 'ALIAS_MATCHED' }],
      candidates: [{ postingId: 'p1', skillId: 's1', cosine: 0.99 }],
    });
    // The cheap exact signal outranks the fuzzy one; a provenance drawer must
    // not report a dictionary hit as a vector guess.
    expect(out).toEqual([]);
  });

  it('still accepts a different skill for a posting that already has one match', () => {
    const out = acceptSemanticMatches({
      existing: [{ postingId: 'p1', skillId: 's1', extractedBy: 'ALIAS_MATCHED' }],
      candidates: [{ postingId: 'p1', skillId: 's2', cosine: 0.95 }],
    });
    expect(out).toHaveLength(1);
    expect(out[0]!.skillId).toBe('s2');
  });

  it('honours an explicitly supplied floor, so the threshold can be re-measured', () => {
    const cands = [{ postingId: 'p1', skillId: 's1', cosine: 0.7 }];
    expect(acceptSemanticMatches({ existing: [], candidates: cands })).toEqual([]);
    expect(acceptSemanticMatches({ existing: [], candidates: cands, floor: 0.65 })).toHaveLength(1);
  });

  it('keeps the floor a named constant in a sane range', () => {
    // Guards against a future edit hardcoding a literal somewhere and leaving
    // this stale after the validation run measures the real value.
    expect(JOBTHAI_EMBED_MATCH_FLOOR).toBeGreaterThan(0);
    expect(JOBTHAI_EMBED_MATCH_FLOOR).toBeLessThanOrEqual(1);
  });
});
