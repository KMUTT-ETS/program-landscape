// Icon size scale. Separate from `spacing` on purpose.
//
// `spacing` (see spacing.ts) is a curated half-scale — its `1` is 2px, not
// Tailwind's 4px. Tailwind derives `width`, `height` and `size` from
// `spacing`, so every icon written in the Tailwind idiom (`h-4 w-4`) came
// out at half its intended size, and `h-3.5 w-3.5` emitted no CSS at all
// (falling back to the lucide SVG's intrinsic 24x24).
//
// These five steps are the sizes icon authors actually meant, expressed
// directly rather than derived from a scale that doesn't fit them. They
// are exposed through `theme.extend.size` in tailwind-preset.ts as
// one-class utilities: `size-icon-xs` … `size-icon-xl`.
//
// Use these on icon components (lucide tags), NOT on layout boxes — a
// `<div>` sized `h-4 w-4` is a dot or a swatch and belongs on the spacing
// scale.

export const iconSize = {
  xs: '0.75rem', // 12px
  sm: '0.875rem', // 14px
  md: '1rem', // 16px
  lg: '1.25rem', // 20px
  xl: '1.5rem', // 24px
} as const;

export type IconSize = keyof typeof iconSize;
