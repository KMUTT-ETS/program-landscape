import { describe, it, expect } from 'vitest';
import { planModelSwap } from '../src/admin/ai-settings-swap';

const rows = [
  { methodPrefix: 'a', effectiveModel: 'old', isPinned: true, lockedModel: null },
  { methodPrefix: 'b', effectiveModel: 'old', isPinned: false, lockedModel: null },
  { methodPrefix: 'c', effectiveModel: 'other', isPinned: true, lockedModel: null },
  { methodPrefix: 'd', effectiveModel: 'old', isPinned: true, lockedModel: 'old' },
];

describe('planModelSwap', () => {
  it('rewrites existing pins on the source model', () => {
    expect(planModelSwap(rows, 'old', 'new').rewrite.map((r) => r.methodPrefix)).toEqual(['a']);
  });
  it('reports methods inheriting the source model separately — these gain a NEW pin', () => {
    expect(planModelSwap(rows, 'old', 'new').create.map((r) => r.methodPrefix)).toEqual(['b']);
  });
  it('skips locked methods', () => {
    expect(planModelSwap(rows, 'old', 'new').skipped.map((r) => r.methodPrefix)).toEqual(['d']);
  });
  it('ignores methods on a different model', () => {
    const plan = planModelSwap(rows, 'old', 'new');
    expect([...plan.rewrite, ...plan.create].map((r) => r.methodPrefix)).not.toContain('c');
  });
  it('is a no-op when source and target are the same', () => {
    const plan = planModelSwap(rows, 'old', 'old');
    expect(plan.rewrite).toHaveLength(0);
    expect(plan.create).toHaveLength(0);
  });
  it('returns all-empty buckets when the source model matches nothing', () => {
    const plan = planModelSwap(rows, 'nonexistent-model', 'new');
    expect(plan.rewrite).toHaveLength(0);
    expect(plan.create).toHaveLength(0);
    expect(plan.skipped).toHaveLength(0);
  });
});
