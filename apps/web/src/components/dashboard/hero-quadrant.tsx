'use client';

import * as React from 'react';
import Link from 'next/link';
import { useChartPalette } from '@kku/ui';

interface QuadrantPoint {
  programId: string;
  code: string;
  name: string;
  facultyCode: string;
  level: string;
  enrollmentDeltaPct: number;
  netContributionThb: number;
  enrolledLatest: number;
  quadrant: 'star' | 'cash-cow' | 'question' | 'dog' | 'dead';
}

interface Props {
  points: QuadrantPoint[];
  excludedCount: number;
  caveat?: string;
}

// Annotated lifecycle × revenue scatter. X = 3-yr enrolment delta %,
// Y = net contribution (THB). Each dot = one program. Top-2 outliers
// per quadrant get stacked side-rail labels (no inline collisions).
// All dots carry a native <title> tooltip for hover detail.

export function HeroQuadrant({ points, excludedCount, caveat }: Props) {
  const palette = useChartPalette();
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);

  // Fullscreen — track the live state via the document API so the
  // button label flips correctly when the user exits via Esc.
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  React.useEffect(() => {
    const onChange = () => setIsFullscreen(document.fullscreenElement === containerRef.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else if (containerRef.current?.requestFullscreen) {
      containerRef.current.requestFullscreen().catch(() => {});
    }
  };

  // Signed-log scale on BOTH axes. signedLog(x) = sign(x) * log1p(|x|).
  const signedLog = (v: number) => Math.sign(v) * Math.log1p(Math.abs(v));
  const inverseSignedLog = (v: number) => Math.sign(v) * (Math.exp(Math.abs(v)) - 1);

  // Default (full-portfolio) bounds in log-space, symmetric around 0.
  const xMaxRaw = Math.max(100, ...points.map((p) => Math.abs(p.enrollmentDeltaPct)));
  const yMaxRaw = Math.max(1_000_000, ...points.map((p) => Math.abs(p.netContributionThb)));
  const defaultXMax = signedLog(xMaxRaw);
  const defaultYMax = signedLog(yMaxRaw);

  // Viewport — log-space domain currently visible. Mutated by wheel
  // (zoom) and drag (pan). Reset returns to the default symmetric view.
  type Viewport = { xMin: number; xMax: number; yMin: number; yMax: number };
  const defaultViewport: Viewport = React.useMemo(
    () => ({ xMin: -defaultXMax, xMax: defaultXMax, yMin: -defaultYMax, yMax: defaultYMax }),
    [defaultXMax, defaultYMax],
  );
  const [view, setView] = React.useState<Viewport>(defaultViewport);
  const isZoomed =
    view.xMin !== defaultViewport.xMin
    || view.xMax !== defaultViewport.xMax
    || view.yMin !== defaultViewport.yMin
    || view.yMax !== defaultViewport.yMax;
  const resetView = React.useCallback(() => setView(defaultViewport), [defaultViewport]);

  // SVG canvas
  const W = 980;
  const H = 520;
  const PAD = { top: 56, right: 220, bottom: 64, left: 220 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  const xPx = (delta: number) =>
    PAD.left + ((signedLog(delta) - view.xMin) / (view.xMax - view.xMin)) * innerW;
  const yPx = (nc: number) =>
    PAD.top + (1 - (signedLog(nc) - view.yMin) / (view.yMax - view.yMin)) * innerH;

  // Inverse: convert (clientX, clientY) → log-space data coordinate.
  // Used by wheel + drag to keep the cursor's data position fixed.
  const pxToLogX = (px: number) =>
    view.xMin + ((px - PAD.left) / innerW) * (view.xMax - view.xMin);
  const pxToLogY = (px: number) =>
    view.yMin + (1 - (px - PAD.top) / innerH) * (view.yMax - view.yMin);

  // ── Pan + zoom interactions ──────────────────────────────────────
  const dragRef = React.useRef<{
    active: boolean;
    startClientX: number; startClientY: number;
    startView: Viewport;
  } | null>(null);

  const screenToSvg = React.useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const pt = svg.createSVGPoint();
    pt.x = clientX; pt.y = clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const local = pt.matrixTransform(ctm.inverse());
    return { x: local.x, y: local.y };
  }, []);

  const onWheel = React.useCallback(
    (e: React.WheelEvent<SVGSVGElement>) => {
      // Only zoom when cursor is inside the inner plot area.
      const { x: svgX, y: svgY } = screenToSvg(e.clientX, e.clientY);
      if (svgX < PAD.left || svgX > W - PAD.right || svgY < PAD.top || svgY > H - PAD.bottom) return;
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.2 : 1 / 1.2; // wheel up = zoom in
      const cursorLogX = pxToLogX(svgX);
      const cursorLogY = pxToLogY(svgY);
      setView((v) => {
        const newXMin = cursorLogX + (v.xMin - cursorLogX) * factor;
        const newXMax = cursorLogX + (v.xMax - cursorLogX) * factor;
        const newYMin = cursorLogY + (v.yMin - cursorLogY) * factor;
        const newYMax = cursorLogY + (v.yMax - cursorLogY) * factor;
        // Clamp: never zoom out beyond the default; never zoom in past 0.05 log-span.
        const minSpan = 0.05;
        if (newXMax - newXMin < minSpan || newYMax - newYMin < minSpan) return v;
        if (newXMax - newXMin > defaultViewport.xMax - defaultViewport.xMin) return defaultViewport;
        return { xMin: newXMin, xMax: newXMax, yMin: newYMin, yMax: newYMax };
      });
    },
    [screenToSvg, pxToLogX, pxToLogY, defaultViewport, PAD.left, PAD.right, PAD.top, PAD.bottom, H, W, innerW, innerH],
  );

  const onMouseDown = (e: React.MouseEvent<SVGSVGElement>) => {
    const { x: svgX, y: svgY } = screenToSvg(e.clientX, e.clientY);
    if (svgX < PAD.left || svgX > W - PAD.right || svgY < PAD.top || svgY > H - PAD.bottom) return;
    dragRef.current = {
      active: true,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startView: { ...view },
    };
  };
  const onMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const drag = dragRef.current;
    if (!drag?.active) return;
    const dx = (e.clientX - drag.startClientX) * (svgRef.current?.viewBox.baseVal.width ?? W) / (svgRef.current?.clientWidth ?? W);
    const dy = (e.clientY - drag.startClientY) * (svgRef.current?.viewBox.baseVal.height ?? H) / (svgRef.current?.clientHeight ?? H);
    const dataDx = (-dx / innerW) * (drag.startView.xMax - drag.startView.xMin);
    const dataDy = (dy / innerH) * (drag.startView.yMax - drag.startView.yMin);
    setView({
      xMin: drag.startView.xMin + dataDx,
      xMax: drag.startView.xMax + dataDx,
      yMin: drag.startView.yMin + dataDy,
      yMax: drag.startView.yMax + dataDy,
    });
  };
  const onMouseUp = () => { if (dragRef.current) dragRef.current.active = false; };

  void inverseSignedLog;

  const xZero = xPx(0);
  const yZero = yPx(0);

  // Bubble radius scaled by enrolledLatest; cap to keep readable.
  const enrolledMax = Math.max(1, ...points.map((p) => p.enrolledLatest));
  const radius = (e: number) => 3 + Math.sqrt(e / enrolledMax) * 14;

  const quadrantColor = (q: QuadrantPoint['quadrant']) => {
    switch (q) {
      case 'star':
        return palette.positive;
      case 'cash-cow':
        return palette.series[2] ?? palette.neutral;
      case 'question':
        return palette.series[3] ?? palette.neutral;
      case 'dog':
      case 'dead':
        return palette.negative;
    }
  };

  // Pick top-2 callouts per quadrant by extremeness (|deltaPct| + |nc|/1M).
  const calloutFor = (q: QuadrantPoint['quadrant']) =>
    points
      .filter((p) => p.quadrant === q)
      .sort((a, b) => {
        const da = Math.abs(a.enrollmentDeltaPct) + Math.abs(a.netContributionThb) / 1_000_000;
        const db = Math.abs(b.enrollmentDeltaPct) + Math.abs(b.netContributionThb) / 1_000_000;
        return db - da;
      })
      .slice(0, 2);

  // Group callouts by side rail (left = cash-cow + dog; right = star + question).
  // Within each rail, sort by Y (top → bottom) and stack with min spacing.
  const RAIL_LINE_HEIGHT = 32; // px between stacked labels
  const placeRail = (calls: QuadrantPoint[], railSide: 'left' | 'right') => {
    const sorted = [...calls].sort((a, b) => yPx(a.netContributionThb) - yPx(b.netContributionThb));
    const placed: Array<{ p: QuadrantPoint; labelY: number }> = [];
    for (const p of sorted) {
      const desiredY = yPx(p.netContributionThb);
      const lastY = placed.length > 0 ? placed[placed.length - 1].labelY : -Infinity;
      const labelY = Math.max(desiredY, lastY + RAIL_LINE_HEIGHT);
      placed.push({ p, labelY });
    }
    // Clamp to chart bounds
    const minY = PAD.top + 14;
    const maxY = H - PAD.bottom - 14;
    for (const item of placed) {
      item.labelY = Math.max(minY, Math.min(maxY, item.labelY));
    }
    void railSide;
    return placed;
  };

  const leftRail = placeRail([...calloutFor('cash-cow'), ...calloutFor('dog')], 'left');
  const rightRail = placeRail([...calloutFor('star'), ...calloutFor('question')], 'right');
  const calloutIds = new Set([...leftRail, ...rightRail].map((c) => c.p.programId));

  // Quadrant headers — sit OUTSIDE the data area on the chart frame.
  // Quadrant counts — derived from `points`. "Dead" is shown alongside
  // Dogs (declining + loss-making, with zero enrolment).
  const counts = {
    star: points.filter((p) => p.quadrant === 'star').length,
    cashCow: points.filter((p) => p.quadrant === 'cash-cow').length,
    question: points.filter((p) => p.quadrant === 'question').length,
    dog: points.filter((p) => p.quadrant === 'dog').length,
    dead: points.filter((p) => p.quadrant === 'dead').length,
  };
  const quadrantHeaders = [
    { side: 'tr', label: 'STARS', sub: 'growing + profitable', count: counts.star, x: W - PAD.right, y: PAD.top - 36, anchor: 'end' as const, tone: palette.positive },
    { side: 'tl', label: 'CASH COWS', sub: 'declining, still profitable', count: counts.cashCow, x: PAD.left, y: PAD.top - 36, anchor: 'start' as const, tone: palette.series[2] ?? palette.neutral },
    { side: 'br', label: 'QUESTIONS', sub: 'growing but loss-making', count: counts.question, x: W - PAD.right, y: H - PAD.bottom + 56, anchor: 'end' as const, tone: palette.series[3] ?? palette.neutral },
    { side: 'bl', label: 'DOGS', sub: `declining + loss-making${counts.dead > 0 ? ` (incl. ${counts.dead} dead)` : ''}`, count: counts.dog + counts.dead, x: PAD.left, y: H - PAD.bottom + 56, anchor: 'start' as const, tone: palette.negative },
  ];

  return (
    <div
      ref={containerRef}
      className={`relative flex flex-col gap-3 ${isFullscreen ? 'h-screen w-screen overflow-auto bg-surface-1 p-6' : ''}`}
    >
      {/* Top-right control cluster — Fullscreen + Reset zoom */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-1.5">
        {isZoomed && (
          <button
            type="button"
            onClick={resetView}
            className="rounded-md border border-border-default bg-surface-1 px-2.5 py-1 text-[11px] font-medium text-text-secondary shadow-sm hover:bg-surface-2 hover:text-text-primary"
          >
            Reset zoom
          </button>
        )}
        <button
          type="button"
          onClick={toggleFullscreen}
          className="rounded-md border border-border-default bg-surface-1 px-2.5 py-1 text-[11px] font-medium text-text-secondary shadow-sm hover:bg-surface-2 hover:text-text-primary"
          title={isFullscreen ? 'Exit fullscreen (Esc)' : 'Open in fullscreen'}
        >
          {isFullscreen ? '⤣ Exit fullscreen' : '⤢ Fullscreen'}
        </button>
      </div>
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className={`w-full select-none ${dragRef.current?.active ? 'cursor-grabbing' : 'cursor-grab'}`}
        role="img"
        aria-label="Lifecycle vs net contribution scatter, one dot per program. Scroll to zoom, drag to pan."
        onWheel={onWheel}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
        onMouseUp={onMouseUp}
        onMouseLeave={onMouseUp}
      >
        <defs>
          {/* Clip data layer (tints, dividers, dots) to the inner plot
              area so panning hides off-screen content cleanly. */}
          <clipPath id="quadrant-plot-area">
            <rect x={PAD.left} y={PAD.top} width={innerW} height={innerH} />
          </clipPath>
        </defs>

        <g clipPath="url(#quadrant-plot-area)">
          {/* Quadrant tints */}
          <rect x={xZero} y={PAD.top} width={W - PAD.right - xZero} height={yZero - PAD.top} fill={palette.positive} opacity={0.04} />
          <rect x={PAD.left} y={PAD.top} width={xZero - PAD.left} height={yZero - PAD.top} fill={palette.series[2] ?? palette.neutral} opacity={0.04} />
          <rect x={xZero} y={yZero} width={W - PAD.right - xZero} height={H - PAD.bottom - yZero} fill={palette.series[3] ?? palette.neutral} opacity={0.04} />
          <rect x={PAD.left} y={yZero} width={xZero - PAD.left} height={H - PAD.bottom - yZero} fill={palette.negative} opacity={0.04} />

          {/* Quadrant divider lines */}
          <line x1={xZero} y1={PAD.top} x2={xZero} y2={H - PAD.bottom} stroke={palette.grid} strokeDasharray="2 4" strokeWidth={0.8} />
          <line x1={PAD.left} y1={yZero} x2={W - PAD.right} y2={yZero} stroke={palette.grid} strokeDasharray="2 4" strokeWidth={0.8} />
        </g>

        {/* Frame border — outside clip so it stays crisp */}
        <rect
          x={PAD.left}
          y={PAD.top}
          width={innerW}
          height={innerH}
          fill="none"
          stroke={palette.grid}
          strokeWidth={0.6}
          pointerEvents="none"
        />

        {/* Quadrant headers — outside the data area, on the chart frame.
            Includes per-quadrant count from the live point set. */}
        {quadrantHeaders.map((q) => (
          <g key={q.side}>
            <text
              x={q.x}
              y={q.y}
              textAnchor={q.anchor}
              className="text-[11px] font-semibold"
              fill={q.tone}
              style={{ letterSpacing: '0.06em' }}
            >
              {q.label}
              <tspan dx={6} className="font-tabular text-[12px]" fontSize="12">
                {q.count}
              </tspan>
            </text>
            <text x={q.x} y={q.y + 14} textAnchor={q.anchor} className="text-[10px]" fill={palette.text} opacity={0.55}>
              {q.sub}
            </text>
          </g>
        ))}

        {/* X-axis ticks — log-spaced (±10, ±100, ±1000), filtered to current viewport */}
        {[-1000, -100, -10, 0, 10, 100, 1000].filter((v) => signedLog(v) >= view.xMin && signedLog(v) <= view.xMax).map((v) => (
          <g key={v}>
            <line x1={xPx(v)} y1={H - PAD.bottom} x2={xPx(v)} y2={H - PAD.bottom + 4} stroke={palette.axis} />
            <text x={xPx(v)} y={H - PAD.bottom + 18} textAnchor="middle" className="text-[10px] font-tabular" fill={palette.text} opacity={0.7}>
              {v > 0 ? `+${v}%` : v < 0 ? `${v}%` : '0'}
            </text>
          </g>
        ))}
        <text x={(PAD.left + W - PAD.right) / 2} y={H - PAD.bottom + 36} textAnchor="middle" className="text-[11px]" fill={palette.text} opacity={0.7}>
          3-year enrolment change · log scale →
        </text>

        {/* Y-axis ticks — log-spaced (±0.1M, ±1M, ±10M, ±100M) */}
        {[-100, -10, -1, -0.1, 0, 0.1, 1, 10, 100].map((millions) => {
          const v = millions * 1_000_000;
          if (signedLog(v) < view.yMin || signedLog(v) > view.yMax) return null;
          const label =
            millions === 0
              ? '0'
              : Math.abs(millions) >= 1
                ? millions > 0 ? `+฿${millions}M` : `−฿${Math.abs(millions)}M`
                : millions > 0 ? `+฿${millions * 1000}K` : `−฿${Math.abs(millions) * 1000}K`;
          return (
            <g key={millions}>
              <line x1={PAD.left - 4} y1={yPx(v)} x2={PAD.left} y2={yPx(v)} stroke={palette.axis} />
              <text x={PAD.left - 8} y={yPx(v) + 4} textAnchor="end" className="text-[10px] font-tabular" fill={palette.text} opacity={0.7}>
                {label}
              </text>
            </g>
          );
        })}
        <text
          x={PAD.left - 56}
          y={(PAD.top + H - PAD.bottom) / 2}
          textAnchor="middle"
          transform={`rotate(-90 ${PAD.left - 56} ${(PAD.top + H - PAD.bottom) / 2})`}
          className="text-[11px]"
          fill={palette.text}
          opacity={0.7}
        >
          ↑ Net contribution (THB · log scale)
        </text>

        {/* Dots — drawn before callout connectors so the lines sit on top.
            Wrapped in the same clip path so panning hides off-screen dots. */}
        <g clipPath="url(#quadrant-plot-area)">
        {points.map((p) => {
          const cx = xPx(p.enrollmentDeltaPct);
          const cy = yPx(p.netContributionThb);
          const r = radius(p.enrolledLatest);
          const fill = quadrantColor(p.quadrant);
          const isCallout = calloutIds.has(p.programId);
          const isDead = p.quadrant === 'dead';
          const tipDelta = `${p.enrollmentDeltaPct > 0 ? '+' : ''}${p.enrollmentDeltaPct.toFixed(0)}%`;
          const tipMoney = p.netContributionThb >= 0
            ? `+฿${(p.netContributionThb / 1_000_000).toFixed(2)}M`
            : `−฿${(Math.abs(p.netContributionThb) / 1_000_000).toFixed(2)}M`;
          return (
            <Link href={`/programs/${p.programId}`} key={p.programId}>
              <g className="cursor-pointer hover:opacity-90 transition-opacity">
                <title>
                  {`${p.code} · ${p.facultyCode} · ${p.level}\n${p.name}\nEnrolled: ${p.enrolledLatest} (${tipDelta} 3-yr) · ${tipMoney}`}
                </title>
                <circle
                  cx={cx}
                  cy={cy}
                  r={isDead ? r + 2 : r}
                  fill={fill}
                  fillOpacity={isCallout ? 0.85 : 0.5}
                  stroke={isCallout ? fill : 'none'}
                  strokeWidth={isCallout ? 1.5 : 0}
                />
                {isDead && (
                  <g stroke={palette.text} strokeWidth={1.2} opacity={0.85}>
                    <line x1={cx - 4} y1={cy - 4} x2={cx + 4} y2={cy + 4} />
                    <line x1={cx - 4} y1={cy + 4} x2={cx + 4} y2={cy - 4} />
                  </g>
                )}
              </g>
            </Link>
          );
        })}
        </g>

        {/* Side-rail callouts — stacked vertically with leader lines */}
        {[
          ...leftRail.map((c) => ({ ...c, side: 'left' as const })),
          ...rightRail.map((c) => ({ ...c, side: 'right' as const })),
        ].map(({ p, labelY, side }) => {
          const cx = xPx(p.enrollmentDeltaPct);
          const cy = yPx(p.netContributionThb);
          const railX = side === 'left' ? PAD.left - 12 : W - PAD.right + 12;
          const anchor = side === 'left' ? 'end' : 'start';
          const tone = quadrantColor(p.quadrant);
          const shortName = compactName(p.name);
          const tipDelta = `${p.enrollmentDeltaPct > 0 ? '+' : ''}${p.enrollmentDeltaPct.toFixed(0)}%`;
          return (
            <g key={`callout-${p.programId}`} className="pointer-events-none">
              {/* Leader: dot → rail elbow → label baseline */}
              <polyline
                points={`${cx},${cy} ${cx + (side === 'left' ? -8 : 8)},${cy} ${railX},${labelY - 4}`}
                fill="none"
                stroke={tone}
                strokeOpacity={0.55}
                strokeWidth={0.7}
              />
              {/* Bullet at the rail end */}
              <circle cx={railX} cy={labelY - 4} r={2} fill={tone} />
              {/* Two-line label: name + meta */}
              <text
                x={railX + (side === 'left' ? -6 : 6)}
                y={labelY - 4}
                textAnchor={anchor}
                className="text-[10.5px] font-medium"
                fill={palette.text}
                opacity={0.95}
              >
                {shortName}
              </text>
              <text
                x={railX + (side === 'left' ? -6 : 6)}
                y={labelY + 8}
                textAnchor={anchor}
                className="text-[9.5px] font-tabular"
                fill={palette.text}
                opacity={0.55}
              >
                {p.facultyCode} · {tipDelta} · {p.enrolledLatest} st
              </text>
            </g>
          );
        })}
      </svg>

      <div className="flex flex-col gap-1 px-2 text-[11px] text-text-tertiary">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <Legend swatch={palette.positive} label={`Stars (${points.filter((p) => p.quadrant === 'star').length})`} />
          <Legend swatch={palette.series[2] ?? palette.neutral} label={`Cash Cows (${points.filter((p) => p.quadrant === 'cash-cow').length})`} />
          <Legend swatch={palette.series[3] ?? palette.neutral} label={`Questions (${points.filter((p) => p.quadrant === 'question').length})`} />
          <Legend swatch={palette.negative} label={`Dogs (${points.filter((p) => p.quadrant === 'dog').length})`} />
          <Legend swatch={palette.negative} label={`Dead (${points.filter((p) => p.quadrant === 'dead').length})`} dot />
          <span className="opacity-70">· dot size = current enrolment · hover for detail · scroll to zoom, drag to pan</span>
        </div>
        <div className="flex justify-end opacity-70">
          {points.length} of {points.length + excludedCount} programs · {excludedCount} excluded (no 3-yr trend)
        </div>
      </div>
      {caveat && (
        <p className="px-2 text-[11px] text-warning">⚠ {caveat}</p>
      )}
    </div>
  );
}

function Legend({ swatch, label, dot }: { swatch: string; label: string; dot?: boolean }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-block h-2.5 w-2.5 rounded-full"
        style={{ backgroundColor: swatch, opacity: dot ? 1 : 0.6 }}
      />
      {label}
    </span>
  );
}

// Strip degree wrapper, normalise Thai/English, cap at 28 chars.
function compactName(name: string): string {
  const stripped = name
    .replace(/^(Bachelor|Master|Doctor|Higher Graduate Diploma)( of [^P]*)? Program in /i, '')
    .replace(/\s*\((International Program|นานาชาติ|หลักสูตรนานาชาติ)\)\s*/g, ' (intl)')
    .trim();
  return stripped.length > 28 ? `${stripped.slice(0, 27)}…` : stripped;
}
