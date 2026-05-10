// Inline-SVG thumbnails for the welcome home's 3×3 quick-action grid.
// Each thumbnail is a tiny illustration of what the destination is —
// scaled to ~120×72 viewBox, theme-aware via oklch CSS vars, no
// dependency on a chart library or external assets.
//
// Visual language: chart-palette accents on a soft surface-2 backdrop,
// stroke 1.5, rounded-rect corners, minimal detail. Designed to be
// recognisable at a glance from 12 ft away (Council projector test).

import * as React from 'react';

type Props = { className?: string };

// 5:3 viewBox matches the tile's outer aspect (aspect-[5/3]) so the
// thumbnail fills the upper 75% slot edge-to-edge with no crop.
// `meet` keeps the design intact (contain), and the matching aspects
// mean it visually fills.
const SVG_BASE_PROPS = {
  viewBox: '0 0 120 72',
  width: '100%',
  height: '100%',
  preserveAspectRatio: 'xMidYMid meet',
  role: 'presentation' as const,
  'aria-hidden': true,
  style: { display: 'block' },
};

// Soft backdrop rect so each thumbnail visually separates from the
// surrounding tile background. Same in every thumbnail.
function Backdrop() {
  return (
    <rect
      x="0"
      y="0"
      width="120"
      height="72"
      rx="6"
      fill="oklch(var(--color-surface-2) / 0.5)"
    />
  );
}

// 1. Portfolio Cockpit — BCG-style 2x2 quadrant with 4 dots
export function ThumbCockpit({ className }: Props) {
  return (
    <svg {...SVG_BASE_PROPS} className={className}>
      <Backdrop />
      <line x1="60" y1="14" x2="60" y2="58" stroke="oklch(var(--color-text-tertiary))" strokeWidth="0.8" />
      <line x1="20" y1="36" x2="100" y2="36" stroke="oklch(var(--color-text-tertiary))" strokeWidth="0.8" />
      <circle cx="40" cy="24" r="4" fill="oklch(var(--color-chart-1))" />
      <circle cx="84" cy="22" r="6" fill="oklch(var(--color-chart-2))" />
      <circle cx="44" cy="50" r="3" fill="oklch(var(--color-chart-3))" />
      <circle cx="78" cy="52" r="5" fill="oklch(var(--color-chart-4))" />
    </svg>
  );
}

// 2. Executive Landscape — bar columns + trend line overlay
export function ThumbExecutive({ className }: Props) {
  return (
    <svg {...SVG_BASE_PROPS} className={className}>
      <Backdrop />
      <rect x="22" y="40" width="10" height="18" rx="1.5" fill="oklch(var(--color-chart-1))" />
      <rect x="38" y="32" width="10" height="26" rx="1.5" fill="oklch(var(--color-chart-2))" />
      <rect x="54" y="22" width="10" height="36" rx="1.5" fill="oklch(var(--color-chart-3))" />
      <rect x="70" y="28" width="10" height="30" rx="1.5" fill="oklch(var(--color-chart-4))" />
      <rect x="86" y="18" width="10" height="40" rx="1.5" fill="oklch(var(--color-chart-5))" />
      <polyline
        points="27,42 43,32 59,18 75,24 91,14"
        fill="none"
        stroke="oklch(var(--color-accent-default))"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// 3. Programs — stacked program-level bars (Bachelor/Master/PhD/Diploma)
export function ThumbPrograms({ className }: Props) {
  return (
    <svg {...SVG_BASE_PROPS} className={className}>
      <Backdrop />
      {[
        { x: 20, h: [22, 14, 10, 6] },
        { x: 36, h: [26, 16, 8, 5] },
        { x: 52, h: [20, 18, 12, 4] },
        { x: 68, h: [24, 12, 9, 7] },
        { x: 84, h: [28, 15, 11, 5] },
      ].map((col, i) => {
        let y = 60;
        return (
          <g key={i}>
            {col.h.map((seg, j) => {
              y -= seg;
              return (
                <rect
                  key={j}
                  x={col.x}
                  y={y}
                  width={12}
                  height={seg - 1}
                  fill={`oklch(var(--color-chart-${(j + 1) % 6}))`}
                  rx="1"
                />
              );
            })}
          </g>
        );
      })}
    </svg>
  );
}

// 4. AI Analyst — chat bubble with sparkle accent
export function ThumbAnalyst({ className }: Props) {
  return (
    <svg {...SVG_BASE_PROPS} className={className}>
      <Backdrop />
      <path
        d="M22 18 H82 a4 4 0 0 1 4 4 v22 a4 4 0 0 1 -4 4 H44 l-10 10 v-10 a4 4 0 0 1 -4 -4 V22 a4 4 0 0 1 4 -4 z"
        fill="oklch(var(--color-chart-2) / 0.25)"
        stroke="oklch(var(--color-chart-2))"
        strokeWidth="1.2"
      />
      <line x1="32" y1="28" x2="64" y2="28" stroke="oklch(var(--color-chart-2))" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="32" y1="34" x2="76" y2="34" stroke="oklch(var(--color-chart-2))" strokeWidth="1.4" strokeLinecap="round" />
      <line x1="32" y1="40" x2="56" y2="40" stroke="oklch(var(--color-chart-2))" strokeWidth="1.4" strokeLinecap="round" />
      {/* sparkle */}
      <path
        d="M96 24 L98 18 L100 24 L106 26 L100 28 L98 34 L96 28 L90 26 Z"
        fill="oklch(var(--color-accent-default))"
      />
    </svg>
  );
}

// 5. Trends Radar — concentric circles with dots
export function ThumbTrends({ className }: Props) {
  return (
    <svg {...SVG_BASE_PROPS} className={className}>
      <Backdrop />
      {[8, 14, 20, 26].map((r) => (
        <circle
          key={r}
          cx="60"
          cy="36"
          r={r}
          fill="none"
          stroke="oklch(var(--color-text-tertiary) / 0.5)"
          strokeWidth="0.7"
        />
      ))}
      <line x1="34" y1="36" x2="86" y2="36" stroke="oklch(var(--color-text-tertiary) / 0.4)" strokeWidth="0.5" />
      <line x1="60" y1="10" x2="60" y2="62" stroke="oklch(var(--color-text-tertiary) / 0.4)" strokeWidth="0.5" />
      <circle cx="76" cy="24" r="3.2" fill="oklch(var(--color-chart-1))" />
      <circle cx="44" cy="44" r="2.4" fill="oklch(var(--color-chart-3))" />
      <circle cx="68" cy="48" r="2.8" fill="oklch(var(--color-chart-5))" />
      <circle cx="50" cy="22" r="2.2" fill="oklch(var(--color-chart-2))" />
    </svg>
  );
}

// 6. Decisions — checklist with two completed items
export function ThumbDecisions({ className }: Props) {
  return (
    <svg {...SVG_BASE_PROPS} className={className}>
      <Backdrop />
      {[18, 32, 46].map((y, i) => (
        <g key={i}>
          <rect
            x="22"
            y={y}
            width="10"
            height="10"
            rx="2"
            fill={i < 2 ? 'oklch(var(--color-positive))' : 'none'}
            stroke="oklch(var(--color-text-tertiary))"
            strokeWidth="1"
          />
          {i < 2 && (
            <path
              d={`M${24} ${y + 5} L${27} ${y + 8} L${31} ${y + 3}`}
              fill="none"
              stroke="oklch(var(--color-text-on-accent))"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          <rect
            x="38"
            y={y + 3}
            width={i === 2 ? 50 : 60}
            height="4"
            rx="1"
            fill={
              i < 2 ? 'oklch(var(--color-text-secondary) / 0.6)' : 'oklch(var(--color-text-secondary) / 0.9)'
            }
          />
        </g>
      ))}
    </svg>
  );
}

// 7. My profile — avatar circle + name lines + small stat bar
export function ThumbProfile({ className }: Props) {
  return (
    <svg {...SVG_BASE_PROPS} className={className}>
      <Backdrop />
      <circle cx="32" cy="36" r="14" fill="oklch(var(--color-chart-3) / 0.3)" />
      <circle cx="32" cy="32" r="5" fill="oklch(var(--color-chart-3))" />
      <path d="M20 50 a12 12 0 0 1 24 0" fill="oklch(var(--color-chart-3))" />
      <rect x="56" y="22" width="44" height="4" rx="1" fill="oklch(var(--color-text-secondary))" />
      <rect x="56" y="32" width="36" height="3" rx="1" fill="oklch(var(--color-text-tertiary))" />
      {/* publication mini-bars */}
      <rect x="56" y="44" width="6" height="10" rx="0.8" fill="oklch(var(--color-chart-2))" />
      <rect x="64" y="40" width="6" height="14" rx="0.8" fill="oklch(var(--color-chart-2))" />
      <rect x="72" y="38" width="6" height="16" rx="0.8" fill="oklch(var(--color-chart-2))" />
      <rect x="80" y="42" width="6" height="12" rx="0.8" fill="oklch(var(--color-chart-2))" />
      <rect x="88" y="36" width="6" height="18" rx="0.8" fill="oklch(var(--color-chart-2))" />
    </svg>
  );
}

// 8. Methodology — open book with text lines
export function ThumbMethodology({ className }: Props) {
  return (
    <svg {...SVG_BASE_PROPS} className={className}>
      <Backdrop />
      <path
        d="M24 16 H56 a4 4 0 0 1 4 4 v36 a4 4 0 0 0 -4 -4 H24 z"
        fill="oklch(var(--color-surface-1))"
        stroke="oklch(var(--color-chart-4))"
        strokeWidth="1.2"
      />
      <path
        d="M96 16 H64 a4 4 0 0 0 -4 4 v36 a4 4 0 0 1 4 -4 H96 z"
        fill="oklch(var(--color-surface-1))"
        stroke="oklch(var(--color-chart-4))"
        strokeWidth="1.2"
      />
      {[24, 30, 36].map((y) => (
        <React.Fragment key={y}>
          <line x1="28" y1={y} x2="54" y2={y} stroke="oklch(var(--color-text-tertiary))" strokeWidth="1" strokeLinecap="round" />
          <line x1="66" y1={y} x2="92" y2={y} stroke="oklch(var(--color-text-tertiary))" strokeWidth="1" strokeLinecap="round" />
        </React.Fragment>
      ))}
      <line x1="28" y1="42" x2="48" y2="42" stroke="oklch(var(--color-text-tertiary))" strokeWidth="1" strokeLinecap="round" />
      <line x1="66" y1="42" x2="82" y2="42" stroke="oklch(var(--color-text-tertiary))" strokeWidth="1" strokeLinecap="round" />
    </svg>
  );
}

// 9. What's new — sparkle + bell with notification dot
export function ThumbWhatsNew({ className }: Props) {
  return (
    <svg {...SVG_BASE_PROPS} className={className}>
      <Backdrop />
      <path
        d="M48 22 a14 14 0 0 1 28 0 v18 l4 4 v2 H44 v-2 l4 -4 z"
        fill="oklch(var(--color-chart-6) / 0.25)"
        stroke="oklch(var(--color-chart-6))"
        strokeWidth="1.2"
      />
      <path
        d="M58 50 a4 4 0 0 0 8 0"
        fill="none"
        stroke="oklch(var(--color-chart-6))"
        strokeWidth="1.2"
      />
      {/* notification dot */}
      <circle cx="76" cy="22" r="5" fill="oklch(var(--color-danger))" />
      <text x="76" y="25" fontSize="7" fontWeight="700" textAnchor="middle" fill="oklch(var(--color-text-on-accent))" style={{ fontVariantNumeric: 'tabular-nums' }}>
        N
      </text>
    </svg>
  );
}
