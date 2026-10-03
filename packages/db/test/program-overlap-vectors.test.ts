import { describe, expect, it } from 'vitest';
import { l2normalise, parseVectorText, toVectorLiteral } from '../src/program-overlap/vectors';

describe('vector helpers', () => {
  it('normalises to unit length', () => {
    const v = l2normalise([3, 4]);
    expect(v[0]).toBeCloseTo(0.6, 10);
    expect(v[1]).toBeCloseTo(0.8, 10);
  });
  it('leaves a zero vector as zeros', () => {
    expect(l2normalise([0, 0])).toEqual([0, 0]);
  });
  it('round-trips the pgvector text form', () => {
    expect(toVectorLiteral([0.5, -1])).toBe('[0.5,-1]');
    expect(parseVectorText('[0.5,-1]')).toEqual([0.5, -1]);
  });
  it('rejects a malformed vector', () => {
    expect(() => parseVectorText('nope')).toThrow();
  });
});
