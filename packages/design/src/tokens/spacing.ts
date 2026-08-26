// Curated 8pt-adjacent scale. The large-step omissions are still
// deliberate — Stripe-Retool pattern: few, well-chosen steps, so modules
// can't pick 13px randomly. The density tokens tune row-heights via
// separate CSS variables — these are just spacing primitives.
//
// The half-steps 0.5 / 1.5 / 2.5 are NOT optional. This object REPLACES
// Tailwind's spacing scale wholesale (see tailwind-preset.ts), and that
// scale backs padding, margin, gap, width, height and inset. A missing
// key doesn't push authors toward a better step — it emits no CSS at
// all, so `py-0.5` silently meant zero vertical padding and `gap-1.5`
// silently meant no gap. ~1,000 utility uses across apps/web +
// packages/ui already assume these three exist. Interpolated within THIS
// scale's own logic (1 = 2px), not Tailwind's (1 = 4px).
//
// 3.5 IS DELIBERATELY ABSENT — do not "complete the set". 333 of its 338
// uses are `h-3.5 w-3.5` on lucide icons (~167 elements), which today
// fall back to the SVG's intrinsic 24x24 because the utility emits
// nothing. Defining 3.5 here would shrink all of them to 7x7 in one go
// (measured 2026-08-26 on /admin/programs + /programs/[id]). 7px is the
// value this scale's logic implies, and it is consistent with the h-3
// icons already rendering at 6px beside them — which is the real
// problem: icon sizing is half-size app-wide because this scale is half
// of Tailwind's. That needs its own measured pass (likely dedicated
// size-icon-* tokens) before 3.5 can land. The 5 non-icon uses of 3.5
// (px-3.5, gap-3.5, pr-3.5) stay broken until then.
//
// Adding any step means the utility starts emitting CSS everywhere it is
// already written — measure the render before extending this further.

export const spacing = {
  0: '0',
  0.5: '0.0625rem', // 1px
  1: '0.125rem', // 2px
  1.5: '0.1875rem', // 3px
  2: '0.25rem',  // 4px
  2.5: '0.3125rem', // 5px
  3: '0.375rem', // 6px
  // 3.5 intentionally omitted — see header comment.
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
