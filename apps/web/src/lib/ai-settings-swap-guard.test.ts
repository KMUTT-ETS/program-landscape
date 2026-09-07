import { describe, it, expect } from 'vitest';
import { shouldAcceptSwapPreview, canApplySwapPreview } from './ai-settings-swap-guard';

describe('shouldAcceptSwapPreview', () => {
  it('accepts a response that matches the current selection', () => {
    expect(shouldAcceptSwapPreview({ fromModelId: 'X', toModelId: 'Y' }, 'X', 'Y')).toBe(true);
  });

  it('rejects a stale response after the operator changed From (the CRITICAL-1 scenario)', () => {
    // Operator picked From=X, clicked Preview, then changed From to W
    // before X's slow response landed.
    expect(shouldAcceptSwapPreview({ fromModelId: 'X', toModelId: 'Y' }, 'W', 'Y')).toBe(false);
  });

  it('rejects a stale response after the operator changed To', () => {
    expect(shouldAcceptSwapPreview({ fromModelId: 'X', toModelId: 'Y' }, 'X', 'Z')).toBe(false);
  });
});

describe('canApplySwapPreview', () => {
  const preview = { fromModelId: 'X', toModelId: 'Y', changeCount: 3 };

  it('allows apply when the preview matches current selection and nothing is pending', () => {
    expect(canApplySwapPreview(preview, 'X', 'Y', false)).toBe(true);
  });

  it('refuses when there is no preview yet', () => {
    expect(canApplySwapPreview(null, 'X', 'Y', false)).toBe(false);
  });

  it('refuses while a request is pending', () => {
    expect(canApplySwapPreview(preview, 'X', 'Y', true)).toBe(false);
  });

  it('refuses when the dropdown selection has moved on since the preview (stale plan)', () => {
    // Same scenario as shouldAcceptSwapPreview's stale case, but caught at
    // the Apply gate instead of at ingestion — the second layer of the
    // belt-and-braces fix.
    expect(canApplySwapPreview(preview, 'W', 'Y', false)).toBe(false);
    expect(canApplySwapPreview(preview, 'X', 'Z', false)).toBe(false);
  });

  it('refuses when every match was skipped (locked) — nothing would actually change', () => {
    expect(canApplySwapPreview({ fromModelId: 'X', toModelId: 'Y', changeCount: 0 }, 'X', 'Y', false)).toBe(
      false,
    );
  });
});
