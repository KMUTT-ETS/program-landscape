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
  // Stylised Thailand silhouette tiled by the six NESDC regions.
  // Coordinates are hand-tuned (not from a TopoJSON) so the shapes
  // approximate the country's actual outline: a wide North, the
  // Isaan plateau bulging east along the Mekong, the long peninsular
  // tail going south. Each region renders as its own polygon so the
  // colour split is the silhouette itself — no outline needed.
  const REGIONS = [
    {
      name: 'North',
      color: COLORS.primary,
      // Chiang Mai / Chiang Rai / Lampang — wide top
      d: 'M 38 18 L 56 10 L 76 11 L 86 19 L 88 32 L 80 38 L 60 36 L 46 32 L 38 26 Z',
    },
    {
      name: 'Northeast',
      color: COLORS.amber,
      // Isaan plateau — bulges east, follows the Mekong curve
      d: 'M 80 24 L 102 22 L 116 32 L 119 46 L 113 60 L 96 62 L 84 56 L 78 44 L 78 32 Z',
    },
    {
      name: 'West',
      color: COLORS.blue,
      // Tenasserim border strip with Myanmar
      d: 'M 36 30 L 48 34 L 52 56 L 48 72 L 40 76 L 32 66 L 30 48 Z',
    },
    {
      name: 'Central',
      color: COLORS.green,
      // Chao Phraya valley + Bangkok
      d: 'M 50 38 L 78 40 L 84 52 L 80 66 L 68 72 L 56 68 L 50 56 Z',
    },
    {
      name: 'East',
      color: COLORS.warm,
      // Eastern seaboard — Chonburi, Rayong, Trat
      d: 'M 84 56 L 102 60 L 108 70 L 100 76 L 86 76 L 80 68 Z',
    },
    {
      name: 'South',
      color: COLORS.accent,
      // Peninsular tail — Phuket / Surat Thani / Songkhla
      d: 'M 58 76 L 72 76 L 76 88 L 70 102 L 64 116 L 58 116 L 53 102 L 53 88 Z',
    },
  ];

  return (
    <Frame>
      <g transform="translate(8, -4)">
        {/* Subtle drop shadow for the country */}
        <g transform="translate(2, 2)">
          {REGIONS.map((r) => (
            <path key={r.name} d={r.d} fill="#000" opacity="0.06" />
          ))}
        </g>
        {REGIONS.map((r) => (
          <path key={r.name} d={r.d} fill={r.color} opacity="0.9" />
        ))}
        {/* Hairline outline for cohesion */}
        {REGIONS.map((r) => (
          <path
            key={`stroke-${r.name}`}
            d={r.d}
            fill="none"
            stroke={COLORS.bg}
            strokeWidth="0.7"
            opacity="0.7"
          />
        ))}
      </g>

      {/* Two-column legend on the right */}
      <g transform="translate(148, 22)" fontSize="8" fill={COLORS.ink}>
        {[
          { label: 'North', color: COLORS.primary, x: 0, y: 0 },
          { label: 'Northeast', color: COLORS.amber, x: 0, y: 16 },
          { label: 'West', color: COLORS.blue, x: 0, y: 32 },
          { label: 'Central', color: COLORS.green, x: 46, y: 0 },
          { label: 'East', color: COLORS.warm, x: 46, y: 16 },
          { label: 'South', color: COLORS.accent, x: 46, y: 32 },
        ].map((item) => (
          <g key={item.label} transform={`translate(${item.x}, ${item.y})`}>
            <rect x="-2" y="-5" width="6" height="6" rx="1" fill={item.color} />
            <text x="8" y="0">
              {item.label}
            </text>
          </g>
        ))}
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

// Dashboard 8 — Class offerings: seat grid coloured by fill rate,
// suggests the heatmap headline + a stack of stylised class slots.
export function ClassOfferingsThumb() {
  // 6×4 grid of "seats" with varied fill levels — visually previews
  // the seat-fulfilment heatmap on the dashboard.
  const cells: Array<{ x: number; y: number; rate: number }> = [];
  const rates = [
    0.0, 0.1, 0.4, 0.7, 1.0, 0.9,
    0.0, 0.3, 0.6, 0.8, 1.0, 1.0,
    0.2, 0.5, 0.7, 0.9, 0.6, 0.4,
    0.0, 0.0, 0.3, 0.5, 0.7, 0.8,
  ];
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 6; c++) {
      cells.push({ x: 16 + c * 18, y: 18 + r * 18, rate: rates[r * 6 + c] ?? 0 });
    }
  }
  const colour = (rate: number): string => {
    if (rate <= 0) return '#e7e5e1';
    if (rate < 0.25) return '#fde7ad';
    if (rate < 0.5) return '#facd6a';
    if (rate < 0.75) return COLORS.amber;
    if (rate < 1) return COLORS.warm;
    return COLORS.accent;
  };
  return (
    <Frame>
      {cells.map((c, i) => (
        <rect
          key={i}
          x={c.x}
          y={c.y}
          width={14}
          height={14}
          rx={2}
          fill={colour(c.rate)}
          opacity={0.92}
        />
      ))}
      {/* Side panel — fill-rate gauge */}
      <g transform="translate(140, 16)">
        <rect width={86} height={88} fill={COLORS.bg} stroke={COLORS.muted} strokeWidth="0.5" opacity="0.4" rx="3" />
        <text x={43} y={18} textAnchor="middle" fontSize="9" fill={COLORS.ink} opacity="0.65">
          seat fill
        </text>
        <text x={43} y={46} textAnchor="middle" fontSize="22" fontWeight="700" fill={COLORS.primary}>
          53%
        </text>
        <g transform="translate(8, 60)">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <rect
              key={i}
              x={(i - 1) * 12}
              y={(6 - i) * 2}
              width={10}
              height={i * 4}
              fill={i >= 5 ? COLORS.accent : i >= 3 ? COLORS.amber : COLORS.warm}
              opacity={0.85}
              rx={1}
            />
          ))}
        </g>
      </g>
    </Frame>
  );
}

// Dashboard 7 — Recruitment funnel: stylised funnel narrowing from
// applicants down to reported-in.
export function RecruitmentThumb() {
  return (
    <Frame>
      {/* Funnel trapezoids — 4 stages narrowing left to right */}
      {[
        { x: 18, w: 60, h: 80, y: 20, c: COLORS.primary },
        { x: 84, w: 50, h: 64, y: 28, c: COLORS.warm },
        { x: 140, w: 38, h: 48, y: 36, c: COLORS.green },
        { x: 184, w: 26, h: 32, y: 44, c: COLORS.accent },
      ].map((s, i) => (
        <rect
          key={i}
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          fill={s.c}
          opacity="0.85"
          rx="2"
        />
      ))}
      {/* Tiny labels on top */}
      <text x={48} y={14} textAnchor="middle" fontSize="8" fill={COLORS.ink} opacity="0.7">
        applicants
      </text>
      <text x={109} y={14} textAnchor="middle" fontSize="8" fill={COLORS.ink} opacity="0.7">
        passed
      </text>
      <text x={159} y={14} textAnchor="middle" fontSize="8" fill={COLORS.ink} opacity="0.7">
        confirm
      </text>
      <text x={197} y={14} textAnchor="middle" fontSize="8" fill={COLORS.ink} opacity="0.7">
        reg
      </text>
      {/* Drop indicator at the bottom */}
      <text x={120} y={112} textAnchor="middle" fontSize="9" fontWeight="600" fill={COLORS.ink} opacity="0.55">
        TCAS round 1–4 funnel
      </text>
    </Frame>
  );
}
