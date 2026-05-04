// Hand-stylised SVG illustrations for the Education hub tiles. They
// stand in for AI-generated thumbnails — composable inline SVGs render
// crisply at any DPI, ship zero bytes of binary, and stay in sync with
// the design tokens. Swap to real bitmaps once we wire up an image
// generation pipeline (Stable Diffusion / DALL-E / Imagen).
//
// Each thumbnail is a 240×120 viewBox so the layout stays predictable.

import * as React from 'react';

const COLORS = {
  bg: '#F4EFE2',
  ink: '#1F2937',
  muted: '#9CA3AF',
  primary: '#664073',
  accent: '#A6192E',
  warm: '#E8A87C',
  green: '#7CB48F',
  blue: '#6B89C7',
  amber: '#E5B051',
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 240 120"
      className="block h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-hidden
    >
      <rect width="240" height="120" fill={COLORS.bg} />
      {children}
    </svg>
  );
}

// Dashboard 1 — Student info: stylised group of figures + stat bars.
export function StudentInfoThumb() {
  return (
    <Frame>
      {/* People silhouettes */}
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i} transform={`translate(${24 + i * 18}, 50)`}>
          <circle cx="0" cy="-8" r="7" fill={i === 2 ? COLORS.accent : COLORS.primary} />
          <path
            d={`M -10 22 C -10 8, 10 8, 10 22 Z`}
            fill={i === 2 ? COLORS.accent : COLORS.primary}
            opacity={i === 2 ? 1 : 0.85}
          />
        </g>
      ))}
      {/* Stat bars on the right */}
      <g transform="translate(140, 24)">
        <rect width="80" height="6" fill={COLORS.muted} opacity="0.35" rx="2" />
        <rect width="64" height="6" fill={COLORS.primary} rx="2" />
        <g transform="translate(0, 14)">
          <rect width="80" height="6" fill={COLORS.muted} opacity="0.35" rx="2" />
          <rect width="48" height="6" fill={COLORS.primary} opacity="0.7" rx="2" />
        </g>
        <g transform="translate(0, 28)">
          <rect width="80" height="6" fill={COLORS.muted} opacity="0.35" rx="2" />
          <rect width="36" height="6" fill={COLORS.warm} rx="2" />
        </g>
        <g transform="translate(0, 42)">
          <rect width="80" height="6" fill={COLORS.muted} opacity="0.35" rx="2" />
          <rect width="24" height="6" fill={COLORS.green} rx="2" />
        </g>
      </g>
    </Frame>
  );
}

// Dashboard 2 — Location: Thailand silhouette + pins.
export function LocationThumb() {
  return (
    <Frame>
      {/* Highly stylised Thailand outline (a sloping vertical with a head + tail) */}
      <path
        d="M 105 18 L 115 28 L 118 42 L 124 56 L 122 70 L 116 84 L 112 96 L 108 102 L 104 96 L 100 86 L 98 74 L 96 60 L 100 46 L 100 32 Z"
        fill={COLORS.green}
        opacity="0.4"
        stroke={COLORS.green}
        strokeWidth="1.5"
      />
      {/* Region pins */}
      {[
        { x: 108, y: 30, color: COLORS.accent }, // North
        { x: 116, y: 50, color: COLORS.primary }, // NE
        { x: 108, y: 64, color: COLORS.amber }, // Central
        { x: 102, y: 90, color: COLORS.blue }, // South
      ].map((p, i) => (
        <g key={i}>
          <circle cx={p.x} cy={p.y} r="4" fill={p.color} />
          <circle cx={p.x} cy={p.y} r="8" fill={p.color} opacity="0.25" />
        </g>
      ))}
      {/* Region labels right side */}
      <g transform="translate(150, 28)" fontSize="8" fill={COLORS.ink}>
        <text y="0">North</text>
        <circle cx="-8" cy="-3" r="3" fill={COLORS.accent} />
        <text y="14">Northeast</text>
        <circle cx="-8" cy="11" r="3" fill={COLORS.primary} />
        <text y="28">Central</text>
        <circle cx="-8" cy="25" r="3" fill={COLORS.amber} />
        <text y="42">South</text>
        <circle cx="-8" cy="39" r="3" fill={COLORS.blue} />
      </g>
    </Frame>
  );
}

// Dashboard 3 — Active pivot: stylised pivot grid.
export function ActivePivotThumb() {
  return (
    <Frame>
      {/* Header row */}
      <g transform="translate(24, 24)">
        <rect width="68" height="14" fill={COLORS.primary} opacity="0.85" rx="2" />
        <rect x="72" width="20" height="14" fill={COLORS.primary} opacity="0.55" rx="2" />
        <rect x="96" width="20" height="14" fill={COLORS.primary} opacity="0.55" rx="2" />
        <rect x="120" width="20" height="14" fill={COLORS.primary} opacity="0.55" rx="2" />
        <rect x="144" width="20" height="14" fill={COLORS.primary} opacity="0.55" rx="2" />
        <rect x="168" width="20" height="14" fill={COLORS.primary} opacity="0.55" rx="2" />
      </g>
      {/* Faculty rows */}
      {[0, 1, 2, 3, 4].map((row) => (
        <g key={row} transform={`translate(24, ${42 + row * 14})`}>
          <rect
            width="68"
            height="11"
            fill={COLORS.muted}
            opacity={row === 1 ? 0.3 : 0.18}
            rx="2"
          />
          {[0, 1, 2, 3, 4].map((col) => {
            const intensity = (col + row + 1) * 0.12 + 0.15;
            return (
              <rect
                key={col}
                x={72 + col * 24}
                width="20"
                height="11"
                fill={COLORS.primary}
                opacity={intensity}
                rx="2"
              />
            );
          })}
        </g>
      ))}
    </Frame>
  );
}

// Dashboard 4 — International: globe with arcs.
export function InternationalThumb() {
  return (
    <Frame>
      <circle cx="80" cy="60" r="36" fill={COLORS.blue} opacity="0.25" />
      <circle cx="80" cy="60" r="36" fill="none" stroke={COLORS.blue} strokeWidth="1.5" />
      {/* Latitude lines */}
      {[44, 60, 76].map((y, i) => (
        <ellipse
          key={i}
          cx="80"
          cy={y}
          rx="36"
          ry={Math.abs(60 - y) * 0.6 + 4}
          fill="none"
          stroke={COLORS.blue}
          strokeWidth="0.7"
          opacity="0.5"
        />
      ))}
      {/* Longitude line */}
      <ellipse cx="80" cy="60" rx="14" ry="36" fill="none" stroke={COLORS.blue} strokeWidth="0.7" opacity="0.5" />
      <line x1="80" y1="24" x2="80" y2="96" stroke={COLORS.blue} strokeWidth="0.7" opacity="0.5" />
      {/* Arc from globe to Thailand pin */}
      <path
        d="M 80 60 Q 130 28 170 50"
        fill="none"
        stroke={COLORS.accent}
        strokeWidth="1.6"
        strokeDasharray="3,3"
      />
      <circle cx="170" cy="50" r="4" fill={COLORS.accent} />
      {/* Country dots */}
      <circle cx="58" cy="48" r="2.5" fill={COLORS.accent} />
      <circle cx="98" cy="78" r="2.5" fill={COLORS.amber} />
      <circle cx="64" cy="78" r="2.5" fill={COLORS.green} />
      {/* Flags-ish ribbon at right */}
      <g transform="translate(146, 76)">
        <rect width="14" height="20" fill={COLORS.accent} />
        <rect x="16" width="14" height="20" fill={COLORS.amber} />
        <rect x="32" width="14" height="20" fill={COLORS.green} />
      </g>
    </Frame>
  );
}

// Dashboard 6 — Performance: GPA gauge + small distribution histogram.
export function PerformanceThumb() {
  return (
    <Frame>
      {/* Big "GPA" gauge on the left */}
      <g transform="translate(50, 60)">
        <circle r="32" fill="none" stroke="#dad4c2" strokeWidth="8" />
        <path
          d="M -28 8 A 32 32 0 0 1 24 -22"
          fill="none"
          stroke={COLORS.primary}
          strokeWidth="8"
          strokeLinecap="round"
        />
        <text
          y="2"
          textAnchor="middle"
          fontSize="13"
          fontWeight="700"
          fill={COLORS.ink}
        >
          3.42
        </text>
        <text
          y="14"
          textAnchor="middle"
          fontSize="7"
          fill="#666"
        >
          avg GPA
        </text>
      </g>
      {/* Score-distribution histogram on the right */}
      <line x1="106" y1="100" x2="220" y2="100" stroke={COLORS.muted} strokeWidth="1" />
      {[
        { x: 110, h: 14 },
        { x: 124, h: 22 },
        { x: 138, h: 38 },
        { x: 152, h: 56 },
        { x: 166, h: 64 },
        { x: 180, h: 50 },
        { x: 194, h: 30 },
        { x: 208, h: 16 },
      ].map((b, i) => (
        <rect
          key={i}
          x={b.x}
          y={100 - b.h}
          width="11"
          height={b.h}
          fill={i === 4 ? COLORS.accent : COLORS.primary}
          opacity={i === 4 ? 1 : 0.65}
        />
      ))}
      <text
        x="160"
        y="22"
        textAnchor="middle"
        fontSize="9"
        fontWeight="600"
        fill={COLORS.ink}
      >
        Score distribution
      </text>
    </Frame>
  );
}

// Dashboard 5 — Tuition: stacked bars trending up + coin glyph.
export function TuitionThumb() {
  return (
    <Frame>
      {/* Axis baseline */}
      <line x1="20" y1="100" x2="220" y2="100" stroke={COLORS.muted} strokeWidth="1" />
      {/* Bars */}
      {[
        { h: 28, x: 32 },
        { h: 38, x: 60 },
        { h: 48, x: 88 },
        { h: 58, x: 116 },
        { h: 70, x: 144 },
        { h: 80, x: 172 },
      ].map((b, i) => (
        <g key={i}>
          <rect
            x={b.x}
            y={100 - b.h}
            width="20"
            height={b.h * 0.6}
            fill={COLORS.green}
            opacity="0.85"
          />
          <rect
            x={b.x}
            y={100 - b.h * 0.4}
            width="20"
            height={b.h * 0.4}
            fill={COLORS.amber}
            opacity="0.85"
          />
        </g>
      ))}
      {/* Coin glyph */}
      <g transform="translate(202, 32)">
        <circle r="14" fill={COLORS.amber} stroke={COLORS.ink} strokeWidth="1" />
        <text
          y="4"
          textAnchor="middle"
          fontSize="14"
          fontWeight="700"
          fill={COLORS.ink}
        >
          ฿
        </text>
      </g>
    </Frame>
  );
}
