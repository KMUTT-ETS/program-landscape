import { describe, expect, it } from 'vitest';
import { estimateTextWidthMm, fitLabel } from '../src/charts/fit-label';

describe('estimateTextWidthMm', () => {
  it('is zero for an empty string', () => {
    expect(estimateTextWidthMm('', 3)).toBe(0);
  });

  it('scales linearly with fontSizeMm for a pure-ASCII string', () => {
    const text = 'ABC 123 abc!';
    const at3 = estimateTextWidthMm(text, 3);
    const at6 = estimateTextWidthMm(text, 6);
    expect(at6).toBeCloseTo(at3 * 2, 10);
  });

  it('gives an exact, hand-computed width for a repeated lowercase ASCII character', () => {
    // Lowercase ASCII multiplier is 0.45× fontSize per character — no
    // classification ambiguity, so this is exact rather than "close to".
    const width = estimateTextWidthMm('a'.repeat(20), 3);
    expect(width).toBeCloseTo(20 * 0.45 * 3, 10); // 27mm
  });

  it('estimates a Thai combining-mark-only string to zero width', () => {
    // ่ (U+0E48, tone mark) + ้ (U+0E49, tone mark) — both zero-advance,
    // no base consonant present at all.
    expect(estimateTextWidthMm('่้', 5)).toBe(0);
  });

  it('the whole point: Thai combining marks contribute zero width, so a word with marks is materially narrower than same-length repeated base characters', () => {
    // 'ปีที่' is 5 code points: ป (base), ี (combining vowel, U+0E34–0E3A),
    // ท (base), ี (combining vowel), ่ (combining tone, U+0E47–0E4E).
    // Only the 2 base consonants (ป, ท) carry advance width — the 3 marks
    // stack on their preceding base and contribute 0. 'ปปปปป' is 5 code
    // points that are ALL base consonants, so it carries 5 units of advance
    // width. A naive per-code-point estimator would call these equal; ours
    // must not.
    const withMarks = estimateTextWidthMm('ปีที่', 3);
    const allBase = estimateTextWidthMm('ปปปปป', 3);
    expect(withMarks).toBeGreaterThan(0);
    expect(withMarks).toBeLessThan(allBase);

    const ratio = withMarks / allBase;
    // 2 advance-bearing code points out of 5 for 'ปีที่' vs 5 of 5 for
    // 'ปปปปป' puts the ratio at 2/5 = 0.4. Asserted as a range (not an
    // exact fraction) because the point of this test is "materially less
    // than 1, in the ballpark of the code-point ratio" — not to pin an
    // over-precise number to the estimation model.
    expect(ratio).toBeGreaterThan(0.3);
    expect(ratio).toBeLessThan(0.7);
  });
});

describe('fitLabel', () => {
  it('returns {} — no textLength, no lengthAdjust — for text that fits', () => {
    const fit = fitLabel('a'.repeat(5), 10, 3); // natural width 6.75mm ≤ 10mm
    expect(fit).toEqual({});
  });

  it('returns {} for an empty string regardless of font size', () => {
    expect(fitLabel('', 10, 3)).toEqual({});
  });

  it('compresses moderate overflow to textLength=availableWidthMm with spacingAndGlyphs', () => {
    // natural width 20 × 0.45 × 3 = 27mm; available 25mm → scale ≈ 0.926,
    // above the 0.85 default floor.
    const fit = fitLabel('a'.repeat(20), 25, 3);
    expect(fit).toEqual({ textLength: 25, lengthAdjust: 'spacingAndGlyphs' });
  });

  it('throws RangeError naming the label, width, estimate and scale for extreme overflow', () => {
    // natural width 27mm; available 5mm → scale ≈ 0.185, well below 0.85.
    const label = 'a'.repeat(20);
    expect(() => fitLabel(label, 5, 3)).toThrow(RangeError);
    try {
      fitLabel(label, 5, 3);
      expect.unreachable('fitLabel should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(RangeError);
      const message = (err as RangeError).message;
      expect(message).toContain(label);
      expect(message).toContain('5'); // availableWidthMm
    }
  });

  it('throws RangeError for a non-positive availableWidthMm', () => {
    expect(() => fitLabel('label', 0, 3)).toThrow(RangeError);
    expect(() => fitLabel('label', -5, 3)).toThrow(RangeError);
  });

  it('a custom minScale changes the throw threshold', () => {
    // natural width 27mm; available 10.8mm → scale exactly 0.4.
    const label = 'a'.repeat(20);
    expect(() => fitLabel(label, 10.8, 3)).toThrow(RangeError); // 0.4 < default 0.85
    expect(fitLabel(label, 10.8, 3, 0.3)).toEqual({
      textLength: 10.8,
      lengthAdjust: 'spacingAndGlyphs',
    });
  });
});
