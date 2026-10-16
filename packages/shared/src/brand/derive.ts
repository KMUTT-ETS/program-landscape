import { HEX_COLOR, clampToGamut, contrastRatio, formatOklch, hexToOklch, type Oklch } from './color';

// The admin picks a hue; the system picks the lightness. Each step below is
// the lightness (and chroma multiplier) of today's coral / cardinal tokens in
// packages/design/src/css/tokens.css, so a coral input reproduces them.
// Spec: docs/superpowers/specs/2026-10-15-white-label-organization-design.md §5.

export type BrandTokenName =
  | 'accent-default'
  | 'accent-hover'
  | 'accent-active'
  | 'accent-subtle'
  | 'accent-fg'
  | 'brand-cardinal'
  | 'brand-cardinal-hover'
  | 'brand-cardinal-subtle';

export const BRAND_TOKEN_NAMES: readonly BrandTokenName[] = [
  'accent-default',
  'accent-hover',
  'accent-active',
  'accent-subtle',
  'accent-fg',
  'brand-cardinal',
  'brand-cardinal-hover',
  'brand-cardinal-subtle',
];

export interface BrandTokens {
  light: Partial<Record<BrandTokenName, string>>;
  dark: Partial<Record<BrandTokenName, string>>;
}

export interface BrandCheck {
  name: string;
  mode: 'light' | 'dark';
  ratio: number;
  required: number;
  pass: boolean;
}

type Mode = 'light' | 'dark';
type Step = { l: number; cx: number };

const PRIMARY_STEPS: Record<Mode, Record<'accent-default' | 'accent-hover' | 'accent-active' | 'accent-subtle', Step>> = {
  light: {
    'accent-default': { l: 0.7, cx: 1 },
    'accent-hover': { l: 0.76, cx: 0.93 },
    'accent-active': { l: 0.62, cx: 1.1 },
    'accent-subtle': { l: 0.955, cx: 0.27 },
  },
  dark: {
    'accent-default': { l: 0.53, cx: 1.2 },
    'accent-hover': { l: 0.48, cx: 1.27 },
    'accent-active': { l: 0.43, cx: 1.3 },
    'accent-subtle': { l: 0.3, cx: 0.4 },
  },
};

const SECONDARY_STEPS: Record<Mode, Record<'brand-cardinal' | 'brand-cardinal-hover' | 'brand-cardinal-subtle', Step>> = {
  light: {
    'brand-cardinal': { l: 0.44, cx: 1 },
    'brand-cardinal-hover': { l: 0.485, cx: 1 },
    'brand-cardinal-subtle': { l: 0.95, cx: 0.11 },
  },
  dark: {
    'brand-cardinal': { l: 0.62, cx: 1.06 },
    'brand-cardinal-hover': { l: 0.665, cx: 1.06 },
    'brand-cardinal-subtle': { l: 0.25, cx: 0.3 },
  },
};

/** surface-0 per mode, from tokens.css. */
const SURFACE_0: Record<Mode, Oklch> = {
  light: { l: 0.99, c: 0.008, h: 70 },
  dark: { l: 0.115, c: 0.014, h: 50 },
};

const MIN_CHROMA = 0.04;
const MIN_TEXT_CONTRAST = 4.5;
const MODES: Mode[] = ['light', 'dark'];

// Not gamut-clamped: tokens.css itself holds out-of-sRGB chroma (e.g. dark accent 0.180) and the
// browser gamut-maps oklch() at paint time. Contrast maths clamps internally.
const step = (base: Oklch, s: Step): Oklch => ({ l: s.l, c: base.c * s.cx, h: base.h });

function parseInput(label: string, hex: string, errors: string[]): Oklch | null {
  if (!HEX_COLOR.test(hex)) {
    errors.push(`${label} colour must look like #rrggbb.`);
    return null;
  }
  const o = hexToOklch(hex);
  if (o.c < MIN_CHROMA) {
    errors.push(`${label} colour is too close to grey — pick a stronger shade.`);
    return null;
  }
  return o;
}

export function deriveBrandTokens(
  primaryHex: string | null,
  secondaryHex: string | null,
): { tokens: BrandTokens; checks: BrandCheck[]; ok: boolean; errors: string[] } {
  const tokens: BrandTokens = { light: {}, dark: {} };
  const checks: BrandCheck[] = [];
  const errors: string[] = [];

  const primary = primaryHex ? parseInput('Primary', primaryHex, errors) : null;
  const secondary = secondaryHex ? parseInput('Secondary', secondaryHex, errors) : null;

  if (primary) {
    for (const mode of MODES) {
      const steps = PRIMARY_STEPS[mode];
      const def = step(primary, steps['accent-default']);
      for (const [name, s] of Object.entries(steps) as [keyof typeof steps, Step][]) {
        tokens[mode][name] = formatOklch(step(primary, s));
      }
      const dark: Oklch = clampToGamut({ l: 0.22, c: Math.min(0.05, primary.c), h: primary.h });
      const light: Oklch = { l: 0.99, c: 0.005, h: primary.h };
      const fg = contrastRatio(dark, def) >= contrastRatio(light, def) ? dark : light;
      tokens[mode]['accent-fg'] = formatOklch(fg);
      const ratio = contrastRatio(fg, def);
      checks.push({ name: 'primary text on primary', mode, ratio, required: MIN_TEXT_CONTRAST, pass: ratio >= MIN_TEXT_CONTRAST });
    }
  }

  if (secondary) {
    for (const mode of MODES) {
      const steps = SECONDARY_STEPS[mode];
      for (const [name, s] of Object.entries(steps) as [keyof typeof steps, Step][]) {
        tokens[mode][name] = formatOklch(step(secondary, s));
      }
      const ratio = contrastRatio(step(secondary, steps['brand-cardinal']), SURFACE_0[mode]);
      checks.push({ name: 'secondary on page', mode, ratio, required: MIN_TEXT_CONTRAST, pass: ratio >= MIN_TEXT_CONTRAST });
    }
  }

  for (const c of checks) {
    if (!c.pass) errors.push(`${c.name} (${c.mode} mode) is ${c.ratio.toFixed(2)}:1; needs ${c.required}:1.`);
  }
  return { tokens, checks, ok: errors.length === 0, errors };
}
