// Bounded label-fitting for categorical chart primitives (BarsH, BarsStacked,
// Funnel, DotRange, Matrix, Timeline). SVG <text> does not wrap, and this
// package renders through `renderToStaticMarkup` only — there is no text
// measurement available at render time, so we estimate.
//
// Decision record (see the prompt-5b plan): truncation-with-ellipsis is
// rejected — a shortened Thai program name with no hover to recover the
// full string can attribute a bar to the wrong program in a printed
// document, which is a correctness failure, not a cosmetic one.
// `<foreignObject>` wrapping is rejected as the default because line count
// can't be known without measurement either. What's left: squeeze the text
// horizontally via SVG's own `textLength` + `lengthAdjust="spacingAndGlyphs"`,
// bounded so it's never squashed past readability, and fail loudly when even
// that bound isn't enough — same posture as `seriesColour` and `BarsH`'s
// `plotWidth` guard in this package.

/** What a primitive should spread onto its <text> element. */
export interface LabelFit {
  /** Present only when compression is needed. In mm (SVG user units). */
  textLength?: number;
  /** Present only when textLength is. */
  lengthAdjust?: 'spacingAndGlyphs';
}

// Thai combining marks carry zero advance width — they stack above or below
// the preceding base consonant rather than occupying horizontal space of
// their own. A code-point count would badly overestimate width for any Thai
// text with vowels or tone marks (both are extremely common).
const THAI_MAI_HAN_AKAT = 0x0e31;
const THAI_VOWEL_MARK_START = 0x0e34; // ิ
const THAI_VOWEL_MARK_END = 0x0e3a; // ฺ
const THAI_TONE_MARK_START = 0x0e47; // ็
const THAI_TONE_MARK_END = 0x0e4e; // ๎

const THAI_BLOCK_START = 0x0e00;
const THAI_BLOCK_END = 0x0e7f;

const ASCII_MAX = 0x7f;
const ASCII_DIGIT_START = 0x30; // '0'
const ASCII_DIGIT_END = 0x39; // '9'
const ASCII_UPPER_START = 0x41; // 'A'
const ASCII_UPPER_END = 0x5a; // 'Z'

// Per-advance-bearing-character width, as a multiple of font size.
//
// These are rough approximations of TH Sarabun New's metrics for the
// purpose of deciding WHETHER and ROUGHLY HOW MUCH to compress a label —
// they were eyeballed against typical Thai/Latin proportions, not measured
// from the font file itself. Chromium (inside Gotenberg) does the actual
// glyph layout when `textLength` kicks in, so precision here only needs to
// be good enough to make the right compress-or-not decision.
const THAI_BASE_ADVANCE = 0.52;
const ASCII_DIGIT_OR_UPPER_ADVANCE = 0.55;
const ASCII_OTHER_ADVANCE = 0.45;
const OTHER_ADVANCE = 0.55;

function isZeroAdvanceThaiMark(codePoint: number): boolean {
  return (
    codePoint === THAI_MAI_HAN_AKAT ||
    (codePoint >= THAI_VOWEL_MARK_START && codePoint <= THAI_VOWEL_MARK_END) ||
    (codePoint >= THAI_TONE_MARK_START && codePoint <= THAI_TONE_MARK_END)
  );
}

function isThaiBase(codePoint: number): boolean {
  return codePoint >= THAI_BLOCK_START && codePoint <= THAI_BLOCK_END;
}

function isAsciiDigitOrUpper(codePoint: number): boolean {
  return (
    (codePoint >= ASCII_DIGIT_START && codePoint <= ASCII_DIGIT_END) ||
    (codePoint >= ASCII_UPPER_START && codePoint <= ASCII_UPPER_END)
  );
}

/** Advance width of a single code point, as a multiple of font size. */
function advanceMultiplier(codePoint: number): number {
  // Order matters: Thai combining marks live inside the Thai block, so the
  // zero-advance check must run before the general Thai-base check.
  if (isZeroAdvanceThaiMark(codePoint)) return 0;
  if (isThaiBase(codePoint)) return THAI_BASE_ADVANCE;
  if (isAsciiDigitOrUpper(codePoint)) return ASCII_DIGIT_OR_UPPER_ADVANCE;
  if (codePoint <= ASCII_MAX) return ASCII_OTHER_ADVANCE;
  return OTHER_ADVANCE;
}

/** Estimated rendered width of `text` at `fontSizeMm`, in mm. */
export function estimateTextWidthMm(text: string, fontSizeMm: number): number {
  let widthMm = 0;
  // Iterate by code point, not UTF-16 index, so the Thai ranges above
  // (all within the BMP, but compared as full code points for clarity)
  // line up correctly and no surrogate half is ever classified on its own.
  for (const ch of text) {
    const codePoint = ch.codePointAt(0);
    if (codePoint === undefined) continue; // unreachable for a real for..of char
    widthMm += advanceMultiplier(codePoint) * fontSizeMm;
  }
  return widthMm;
}

const DEFAULT_MIN_SCALE = 0.85;

/**
 * Decide how to fit `text` into `availableWidthMm`.
 *
 * - Fits already → `{}`; the caller renders plain, unadorned `<text>`.
 * - Overflows but a squeeze of at least `minScale` closes the gap →
 *   `{ textLength: availableWidthMm, lengthAdjust: 'spacingAndGlyphs' }`.
 * - Would need to compress below `minScale` → throws `RangeError`. Nothing
 *   is ever silently truncated or dropped; the caller must widen the column.
 */
export function fitLabel(
  text: string,
  availableWidthMm: number,
  fontSizeMm: number,
  minScale: number = DEFAULT_MIN_SCALE,
): LabelFit {
  if (!(availableWidthMm > 0)) {
    throw new RangeError(
      `fitLabel: availableWidthMm must be positive, received ${availableWidthMm}.`,
    );
  }
  if (text === '') return {};

  const naturalWidthMm = estimateTextWidthMm(text, fontSizeMm);
  if (naturalWidthMm <= availableWidthMm) return {};

  const requiredScale = availableWidthMm / naturalWidthMm;
  if (requiredScale < minScale) {
    throw new RangeError(
      `fitLabel: "${text}" needs to compress to ${(requiredScale * 100).toFixed(0)}% of its ` +
        `estimated natural width (~${naturalWidthMm.toFixed(1)}mm) to fit ${availableWidthMm}mm, ` +
        `below the minScale floor of ${(minScale * 100).toFixed(0)}%. Widen the column instead of ` +
        'compressing further — past this bound the label genuinely does not fit.',
    );
  }

  return { textLength: availableWidthMm, lengthAdjust: 'spacingAndGlyphs' };
}
