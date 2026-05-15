// Hand-stylised SVG thumbnails for the four Staff dashboard tiles.
// 240×120 viewBox = 2:1 — matches the Education hub aspect ratio.

const PALETTE = {
  bg: '#fef9f3',
  ink: '#3a2f29',
  accent: '#664073',
  pop: '#dc2626',
  cool: '#0ea5e9',
  warm: '#f59e0b',
  ok: '#16a34a',
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 240 120" className="h-full w-full" preserveAspectRatio="xMidYMid meet">
      <rect width="240" height="120" fill={PALETTE.bg} />
      {children}
    </svg>
  );
}

export function WorkforceThumb() {
  // Pyramid + bar trio (academic / support split mosaic)
  return (
    <Frame>
      {/* Faculty mosaic — three stacked bars of varying split */}
      <g transform="translate(20,20)">
        {[
          { label: 'a', total: 100, aca: 30 },
          { label: 'b', total: 80, aca: 60 },
          { label: 'c', total: 130, aca: 50 },
          { label: 'd', total: 60, aca: 40 },
          { label: 'e', total: 95, aca: 25 },
        ].map((b, i) => (
          <g key={i} transform={`translate(0,${i * 14})`}>
            <rect x={0} y={0} width={b.total} height={10} fill={PALETTE.cool} opacity={0.4} />
            <rect x={0} y={0} width={b.aca} height={10} fill={PALETTE.accent} />
          </g>
        ))}
      </g>
      {/* Headcount circle */}
      <g transform="translate(180,60)">
        <circle r={32} fill="none" stroke={PALETTE.ink} strokeWidth={2} />
        <text textAnchor="middle" y={-3} fontSize="14" fontWeight="700" fill={PALETTE.ink}>
          12.5k
        </text>
        <text textAnchor="middle" y={11} fontSize="7" fill={PALETTE.ink} opacity={0.6}>
          STAFF
        </text>
      </g>
    </Frame>
  );
}

export function FacultyByProgramThumb() {
  return (
    <Frame>
      {/* Drill-down tree: faculty → level → program rows */}
      <g transform="translate(20,18)">
        {[
          { x: 0, w: 140, color: PALETTE.accent, label: 'คณะวิศวกรรม' },
          { x: 12, w: 110, color: PALETTE.warm, label: 'ป.ตรี' },
          { x: 24, w: 80, color: PALETTE.cool, label: 'CSE' },
          { x: 24, w: 90, color: PALETTE.cool, label: 'EE' },
          { x: 12, w: 95, color: PALETTE.warm, label: 'ป.โท' },
          { x: 0, w: 130, color: PALETTE.accent, label: 'คณะวิทย' },
        ].map((b, i) => (
          <g key={i} transform={`translate(${b.x},${i * 13})`}>
            <rect width={b.w} height={9} rx={2} fill={b.color} opacity={0.85} />
          </g>
        ))}
      </g>
      {/* Threshold flag */}
      <g transform="translate(192,28)">
        <rect width={32} height={48} rx={4} fill={PALETTE.pop} opacity={0.15} />
        <text textAnchor="middle" x={16} y={20} fontSize="13" fontWeight="700" fill={PALETTE.pop}>
          ≥5
        </text>
        <text textAnchor="middle" x={16} y={36} fontSize="6" fill={PALETTE.ink} opacity={0.6}>
          MIN
        </text>
      </g>
    </Frame>
  );
}

export function ResearchThumb() {
  return (
    <Frame>
      {/* Citation peaks (h-index style) */}
      <g transform="translate(20,90)">
        {[8, 12, 18, 24, 32, 38, 42, 48, 50, 48, 38, 28, 18, 14, 10].map((h, i) => (
          <rect
            key={i}
            x={i * 11}
            y={-h}
            width={9}
            height={h}
            fill={i < 7 ? PALETTE.accent : PALETTE.cool}
            opacity={0.85}
          />
        ))}
        {/* h-index threshold line */}
        <line x1={0} x2={170} y1={-25} y2={-25} stroke={PALETTE.pop} strokeWidth={1.5} strokeDasharray="3,2" />
      </g>
      <text x={195} y={50} fontSize="11" fontWeight="700" fill={PALETTE.ink}>h=24</text>
      <text x={195} y={62} fontSize="6" fill={PALETTE.ink} opacity={0.6}>INDEX</text>
    </Frame>
  );
}

export function CompensationThumb() {
  return (
    <Frame>
      {/* Stacked funding-source bars */}
      <g transform="translate(20,30)">
        {[
          { y: 0, govt: 60, rev: 25, fifty: 5 },
          { y: 16, govt: 40, rev: 60, fifty: 0 },
          { y: 32, govt: 50, rev: 50, fifty: 10 },
          { y: 48, govt: 30, rev: 70, fifty: 5 },
        ].map((b, i) => {
          let x = 0;
          return (
            <g key={i} transform={`translate(0,${b.y})`}>
              <rect x={x} width={b.govt} height={11} fill={PALETTE.accent} />
              {(x += b.govt)}
              <rect x={x} width={b.rev} height={11} fill={PALETTE.cool} opacity={0.8} />
              {(x += b.rev)}
              <rect x={x} width={b.fifty} height={11} fill={PALETTE.warm} opacity={0.9} />
            </g>
          );
        })}
      </g>
      {/* Baht symbol */}
      <g transform="translate(193,60)">
        <circle r={22} fill="none" stroke={PALETTE.ink} strokeWidth={2} />
        <text textAnchor="middle" y={6} fontSize="22" fontWeight="700" fill={PALETTE.ink}>
          ฿
        </text>
      </g>
    </Frame>
  );
}

export function TeachingWorkloadThumb() {
  // Clipboard with stylised workload bars + a small clock-face accent —
  // signals "contact hours per teacher, per week".
  return (
    <Frame>
      {/* Clipboard background */}
      <g transform="translate(20, 14)">
        <rect width={120} height={92} rx={6} fill="white" stroke={PALETTE.ink} strokeWidth={1.4} opacity={0.95} />
        {/* Clipboard clip */}
        <rect x={42} y={-4} width={36} height={10} rx={2} fill={PALETTE.ink} opacity={0.8} />
        {/* Header line */}
        <rect x={12} y={14} width={70} height={5} rx={1.5} fill={PALETTE.ink} opacity={0.55} />
        {/* Workload bars — colour-coded by load band */}
        {[
          { y: 28, w: 90, c: PALETTE.warm, lbl: '8h' },   // under
          { y: 42, w: 60, c: PALETTE.warm, lbl: '5h' },   // under
          { y: 56, w: 70, c: PALETTE.ok, lbl: '11h' },    // normal
          { y: 70, w: 85, c: PALETTE.pop, lbl: '21h' },   // over
        ].map((b, i) => (
          <g key={i} transform={`translate(12, ${b.y})`}>
            <rect width={100} height={9} rx={2} fill={PALETTE.cool} opacity={0.18} />
            <rect width={b.w} height={9} rx={2} fill={b.c} opacity={0.9} />
            <text x={104} y={7.5} fontSize="6.5" fill={PALETTE.ink} opacity={0.7}>
              {b.lbl}
            </text>
          </g>
        ))}
      </g>
      {/* Clock face on the right */}
      <g transform="translate(190, 60)">
        <circle r={24} fill="white" stroke={PALETTE.ink} strokeWidth={1.6} />
        {[0, 90, 180, 270].map((deg) => (
          <line
            key={deg}
            x1={Math.cos(((deg - 90) * Math.PI) / 180) * 20}
            y1={Math.sin(((deg - 90) * Math.PI) / 180) * 20}
            x2={Math.cos(((deg - 90) * Math.PI) / 180) * 23}
            y2={Math.sin(((deg - 90) * Math.PI) / 180) * 23}
            stroke={PALETTE.ink}
            strokeWidth={1.4}
          />
        ))}
        {/* Hour + minute hand */}
        <line x1={0} y1={0} x2={0} y2={-10} stroke={PALETTE.accent} strokeWidth={2.4} strokeLinecap="round" />
        <line x1={0} y1={0} x2={14} y2={2} stroke={PALETTE.accent} strokeWidth={1.6} strokeLinecap="round" />
        <circle r={2} fill={PALETTE.accent} />
        <text x={0} y={36} textAnchor="middle" fontSize="6" fill={PALETTE.ink} opacity={0.65}>
          hrs / week
        </text>
      </g>
    </Frame>
  );
}
