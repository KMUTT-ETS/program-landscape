// Token scaffold only. The real values — light + dark variants with WCAG-AA
// verified contrast — are generated in prompt 02b. Do not hardcode colors in
// app code; always reference a token.

export const tokenScaffold = {
  typography: {
    body: 'var(--font-body)',
    mono: 'var(--font-mono)',
  },
} as const;
