// 2026-05-02 — Sarabun primary. Loaded with both `thai` + `latin`
// subsets, so a single typeface handles both scripts. Inter retained
// as Latin fallback for screens where Sarabun's Latin glyphs feel
// awkward (this is rare with Sarabun, mostly cosmetic insurance).
export const fontFamily = {
  sans: 'var(--font-body-thai), var(--font-body-latin)',
  mono: 'var(--font-mono)',
} as const;

type TwFontSizeValue = [string, { lineHeight: string }];
export const fontSize: Record<string, TwFontSizeValue> = {
  xs: ['var(--font-size-xs)', { lineHeight: 'var(--line-height-base)' }],
  sm: ['var(--font-size-sm)', { lineHeight: 'var(--line-height-base)' }],
  base: ['var(--font-size-base)', { lineHeight: 'var(--line-height-base)' }],
  md: ['var(--font-size-md)', { lineHeight: 'var(--line-height-base)' }],
  lg: ['var(--font-size-lg)', { lineHeight: 'var(--line-height-base)' }],
  xl: ['var(--font-size-xl)', { lineHeight: 'var(--line-height-tight)' }],
  '2xl': ['var(--font-size-2xl)', { lineHeight: 'var(--line-height-tight)' }],
  '3xl': ['var(--font-size-3xl)', { lineHeight: 'var(--line-height-tight)' }],
  display: [
    'var(--font-size-display)',
    { lineHeight: 'var(--line-height-tight)' },
  ],
};

// Typographic roles. Components use these names, not raw font sizes, so
// a rename of "h2 = 2xl" ripples without finding every callsite.
export const typographyRoles = {
  display: 'font-sans text-display font-semibold tracking-tight',
  h1: 'font-sans text-3xl font-semibold tracking-tight',
  h2: 'font-sans text-2xl font-semibold',
  h3: 'font-sans text-xl font-medium',
  h4: 'font-sans text-lg font-medium',
  body: 'font-sans text-base',
  bodySmall: 'font-sans text-sm',
  caption: 'font-sans text-xs text-text-tertiary',
  code: 'font-mono text-sm',
} as const;
