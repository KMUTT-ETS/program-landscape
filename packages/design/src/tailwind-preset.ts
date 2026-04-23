import type { Config } from 'tailwindcss';
import { colorTokens } from './tokens/colors';
import { fontFamily, fontSize } from './tokens/typography';
import { spacing } from './tokens/spacing';
import { radius } from './tokens/radius';
import { shadow } from './tokens/shadow';

// Wraps a CSS variable holding `L C H` (OKLCH triplet) with `oklch()`.
// Tailwind's alpha modifiers (`bg-surface-1/80`) need a `<alpha-value>`
// placeholder in the output — the CSS Color 4 `oklch()` function accepts
// a space-separated triplet followed by `/ alpha`. Our variables store
// the bare triplet (e.g. `97.8% 0.003 85`), so `oklch(var(--c) / <alpha>)`
// expands to a valid `oklch(L C H / alpha)` color string.
//
// NOTE: do NOT use `oklch(from var(--c) l c h / <alpha>)` — the relative-
// color `from` syntax requires a full color expression as its argument,
// not a bare L C H triplet. That variant renders as invalid in every
// browser and you get an unstyled black/white UI. Ask me how I know.
const oklch = (v: string) => `oklch(${v} / <alpha-value>)`;

function mapColor<T extends Record<string, string>>(m: T): Record<keyof T, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(m)) out[k] = oklch(v);
  return out as Record<keyof T, string>;
}

// Tailwind preset. Packages and apps extend their own content[] and add
// app-specific tweaks. The preset blocks the default palette — component
// code cannot accidentally reach for `bg-slate-500` etc.
const preset: Partial<Config> = {
  darkMode: ['class', '[data-theme="dark"]'],
  theme: {
    // Reset (not extend) colour scale so the default palette is unavailable.
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      inherit: 'inherit',
      black: '#000',
      white: '#fff',

      surface: {
        0: oklch(colorTokens.surface[0]),
        1: oklch(colorTokens.surface[1]),
        2: oklch(colorTokens.surface[2]),
        3: oklch(colorTokens.surface[3]),
        4: oklch(colorTokens.surface[4]),
      },
      border: mapColor(colorTokens.border),
      text: mapColor(colorTokens.text),
      accent: mapColor(colorTokens.accent),
      success: {
        DEFAULT: oklch(colorTokens.semantic.success),
        subtle: oklch(colorTokens.semantic.successSubtle),
      },
      warning: {
        DEFAULT: oklch(colorTokens.semantic.warning),
        subtle: oklch(colorTokens.semantic.warningSubtle),
      },
      danger: {
        DEFAULT: oklch(colorTokens.semantic.danger),
        subtle: oklch(colorTokens.semantic.dangerSubtle),
      },
      info: {
        DEFAULT: oklch(colorTokens.semantic.info),
        subtle: oklch(colorTokens.semantic.infoSubtle),
      },
      'data-positive': oklch(colorTokens.data.positive),
      'data-negative': oklch(colorTokens.data.negative),
      'data-neutral': oklch(colorTokens.data.neutral),
      chart: {
        1: oklch(colorTokens.chart[1]),
        2: oklch(colorTokens.chart[2]),
        3: oklch(colorTokens.chart[3]),
        4: oklch(colorTokens.chart[4]),
        5: oklch(colorTokens.chart[5]),
        6: oklch(colorTokens.chart[6]),
        7: oklch(colorTokens.chart[7]),
        8: oklch(colorTokens.chart[8]),
        9: oklch(colorTokens.chart[9]),
        10: oklch(colorTokens.chart[10]),
        11: oklch(colorTokens.chart[11]),
        12: oklch(colorTokens.chart[12]),
      },
    },
    borderColor: ({ theme }: { theme: (p: string) => unknown }) => ({
      DEFAULT: theme('colors.border.default') as string,
      ...(theme('colors.border') as Record<string, string>),
      transparent: 'transparent',
    }),
    borderRadius: radius,
    spacing,
    fontFamily: {
      sans: [fontFamily.sans, 'system-ui', 'sans-serif'],
      mono: [fontFamily.mono, 'ui-monospace', 'monospace'],
    },
    fontSize,
    boxShadow: shadow,
    extend: {
      transitionDuration: {
        fast: '100ms',
        base: '150ms',
        slow: '200ms',
      },
      transitionTimingFunction: {
        standard: 'cubic-bezier(0.2, 0, 0, 1)',
        decelerate: 'cubic-bezier(0, 0, 0, 1)',
        accelerate: 'cubic-bezier(0.3, 0, 1, 1)',
      },
      keyframes: {
        'slide-in-right': {
          from: { transform: 'translateX(100%)', opacity: '0' },
          to: { transform: 'translateX(0)', opacity: '1' },
        },
        'fade-in': {
          from: { opacity: '0' },
          to: { opacity: '1' },
        },
        shimmer: {
          '0%, 100%': { opacity: '0.55' },
          '50%': { opacity: '0.85' },
        },
      },
      animation: {
        'slide-in-right': 'slide-in-right 200ms cubic-bezier(0, 0, 0, 1)',
        'fade-in': 'fade-in 150ms ease-out',
        shimmer: 'shimmer 1.8s ease-in-out infinite',
      },
    },
  },
};

export default preset;
