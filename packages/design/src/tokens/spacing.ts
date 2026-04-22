// Curated 8pt-adjacent scale. Omissions are deliberate — Stripe-Retool
// pattern: very few, well-chosen steps, so modules can't pick 13px
// randomly. The density tokens tune row-heights via separate CSS
// variables — these are just spacing primitives.

export const spacing = {
  0: '0',
  1: '0.125rem', // 2px
  2: '0.25rem',  // 4px
  3: '0.375rem', // 6px
  4: '0.5rem',   // 8px
  5: '0.625rem', // 10px
  6: '0.75rem',  // 12px
  7: '0.875rem', // 14px
  8: '1rem',     // 16px
  10: '1.25rem', // 20px
  12: '1.5rem',  // 24px
  14: '1.75rem', // 28px
  16: '2rem',    // 32px
  20: '2.5rem',  // 40px
  24: '3rem',    // 48px
  32: '4rem',    // 64px
  40: '5rem',    // 80px
  48: '6rem',    // 96px
} as const;
