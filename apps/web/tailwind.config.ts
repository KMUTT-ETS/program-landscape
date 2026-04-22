import type { Config } from 'tailwindcss';

// Minimal scaffold — full token system and plugin land in prompt 02b.
// We expose the CSS-variable-backed colours as Tailwind utilities so
// component code never hardcodes hex.
const config: Config = {
  darkMode: 'class',
  content: [
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx}',
    '../../packages/ui/src/**/*.{ts,tsx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['var(--font-body)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'ui-monospace', 'monospace'],
      },
      colors: {
        surface: {
          DEFAULT: 'hsl(var(--color-surface))',
          raised: 'hsl(var(--color-surface-raised))',
          muted: 'hsl(var(--color-surface-muted))',
        },
        border: {
          DEFAULT: 'hsl(var(--color-border))',
          strong: 'hsl(var(--color-border-strong))',
        },
        fg: {
          DEFAULT: 'hsl(var(--color-fg))',
          muted: 'hsl(var(--color-fg-muted))',
          subtle: 'hsl(var(--color-fg-subtle))',
        },
        brand: {
          DEFAULT: 'hsl(var(--color-brand))',
          fg: 'hsl(var(--color-brand-fg))',
        },
        accent: {
          DEFAULT: 'hsl(var(--color-accent))',
          fg: 'hsl(var(--color-accent-fg))',
        },
        healthy: 'hsl(var(--color-healthy))',
        caution: 'hsl(var(--color-caution))',
        'at-risk': 'hsl(var(--color-at-risk))',
        info: 'hsl(var(--color-info))',
      },
      borderRadius: {
        sm: 'var(--radius-sm)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
      },
    },
  },
  plugins: [],
};

export default config;
