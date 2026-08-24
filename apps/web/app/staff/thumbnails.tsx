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

// Dashboard — Teaching evaluations: instructor avatar at the centre of a
// 5-bar question-rating spider, with a downward gradient + star icon to
// signal "per-person rating from students".
export function TeachingEvaluationsThumb() {
  // Same heat palette as the satisfaction dashboard (narrow [3.0, 5.0]).
  const heat = ['#dc6c4b', '#d99a4f', '#cdb958', '#b9c46a', '#94c282', '#7bb98e', '#6bb091'];
  // Three instructor "cards" stacked horizontally — each shows a small
  // avatar circle + a row of 5 question-rating cells.
  const instructors = [
    { name: 'A', cells: [5, 6, 5, 6, 4] },
    { name: 'B', cells: [4, 5, 6, 5, 5] },
    { name: 'C', cells: [3, 4, 5, 4, 5] },
  ];
  return (
    <Frame>
      <text x={120} y={14} textAnchor="middle" fontSize="9" fontWeight="600" fill={PALETTE.ink} opacity={0.7}>
        Per-instructor ratings
      </text>
      {instructors.map((ins, idx) => (
        <g key={ins.name} transform={`translate(${24 + idx * 68}, 28)`}>
          {/* Instructor card background */}
          <rect width={58} height={80} rx={5} fill="white" stroke={PALETTE.ink} strokeWidth={1.1} opacity={0.95} />
          {/* Avatar — circular silhouette */}
          <g transform="translate(29, 22)">
            <circle r={9} fill={PALETTE.accent} opacity={0.85} />
            <circle cy={-2} r={3.5} fill="white" opacity={0.7} />
            <path d="M -5 6 C -5 2, 5 2, 5 6 Z" fill="white" opacity={0.6} />
          </g>
          {/* Tiny star */}
          <g transform="translate(48, 12)">
            <polygon
              points="0,-3 0.9,-1 3,-1 1.2,0.5 2,2.8 0,1.4 -2,2.8 -1.2,0.5 -3,-1 -0.9,-1"
              fill={PALETTE.warm}
              opacity={0.9}
            />
          </g>
          {/* Per-question cells */}
          {ins.cells.map((v, i) => (
            <rect
              key={i}
              x={6 + i * 9.4}
              y={48}
              width={8}
              height={11}
              rx={1.5}
              fill={heat[v]}
              opacity={0.9}
            />
          ))}
          {/* Aggregate rating */}
          <text
            x={29}
            y={72}
            textAnchor="middle"
            fontSize="9"
            fontWeight="700"
            fill={PALETTE.ink}
          >
            {(ins.cells.reduce((s, x) => s + x, 0) / ins.cells.length / 6 * 5 + 0.5).toFixed(1)}
          </text>
        </g>
      ))}
      <text x={120} y={114} textAnchor="middle" fontSize="9" fontWeight="600" fill={PALETTE.ink} opacity={0.55}>
        Teaching evaluations
      </text>
    </Frame>
  );
}

export function TeachingTalentThumb() {
  // Three years of bars per person; the middle person clears the line in
  // all three, so they carry the star.
  const people = [
    { x: 24, bars: [30, 22, 34], star: false },
    { x: 92, bars: [40, 44, 42], star: true },
    { x: 160, bars: [20, 34, 16], star: false },
  ];
  return (
    <Frame>
      <text x={120} y={14} textAnchor="middle" fontSize="9" fontWeight="600" fill={PALETTE.ink} opacity={0.7}>
        Three years above the bar
      </text>
      {/* Threshold line */}
      <line x1={12} y1={70} x2={228} y2={70} stroke={PALETTE.ink} strokeWidth={0.8} strokeDasharray="3 2" opacity={0.5} />
      {people.map((p) => (
        <g key={p.x}>
          {p.bars.map((h, i) => (
            <rect
              key={i}
              x={p.x + i * 16}
              y={100 - h}
              width={12}
              height={h}
              rx={2}
              fill={p.star ? PALETTE.accent : PALETTE.ink}
              opacity={p.star ? 0.85 : 0.3}
            />
          ))}
          {p.star && (
            <polygon
              points="0,-4 1.2,-1.3 4,-1.3 1.7,0.6 2.6,3.6 0,1.8 -2.6,3.6 -1.7,0.6 -4,-1.3 -1.2,-1.3"
              transform={`translate(${p.x + 22}, 40)`}
              fill={PALETTE.warm}
              opacity={0.95}
            />
          )}
        </g>
      ))}
    </Frame>
  );
}
