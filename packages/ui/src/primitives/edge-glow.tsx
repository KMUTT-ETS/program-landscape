'use client';

import * as React from 'react';
import { cn } from '../lib/cn';

// ─────────────────────────────────────────────────────────────────────────
// EdgeGlow — razor-sharp animated gradient edge.
//
// Wraps any block-level child with a conic-gradient ring that rotates
// continuously, painted only as a thin border (1-2px) by mask-composite.
// Used to draw attention to hero CTAs, primary KPIs, the "currently
// running" job indicator, etc.
//
// CSS lives in packages/design/src/css/tokens.css under .kku-edge-glow.
// Animation respects prefers-reduced-motion.
//
// Example:
//   <EdgeGlow>
//     <Card padding="lg" tone="glossy">…</Card>
//   </EdgeGlow>
//
//   <EdgeGlow thickness="2px" speed="3s">
//     <Button variant="primary">Run</Button>
//   </EdgeGlow>
// ─────────────────────────────────────────────────────────────────────────

export interface EdgeGlowProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Edge thickness; default 1.5px. */
  thickness?: string;
  /** Rotation period; default `var(--motion-glow)` (4500ms). */
  speed?: string;
  /** Override the 3 gradient stops (CSS color values). */
  colors?: [string, string, string];
  /** Match the child's border-radius. Defaults to `var(--radius-xl)`. */
  radius?: string;
  /** Render as inline-flex instead of block. Useful when wrapping a Button. */
  inline?: boolean;
  children: React.ReactNode;
}

export const EdgeGlow = React.forwardRef<HTMLDivElement, EdgeGlowProps>(
  function EdgeGlow(
    { className, thickness, speed, colors, radius, inline, style, children, ...props },
    ref,
  ) {
    const inlineStyle: React.CSSProperties & Record<`--${string}`, string | undefined> = {
      ...style,
      '--edge-thickness': thickness,
      '--edge-speed': speed,
      '--edge-c1': colors?.[0],
      '--edge-c2': colors?.[1],
      '--edge-c3': colors?.[2],
      borderRadius: radius ?? 'var(--radius-xl)',
    };
    return (
      <div
        ref={ref}
        className={cn('kku-edge-glow', inline ? 'inline-flex' : 'block', className)}
        style={inlineStyle}
        {...props}
      >
        {children}
      </div>
    );
  },
);
