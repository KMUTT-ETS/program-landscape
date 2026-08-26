'use client';

import * as React from 'react';
import { ZoomIn, ZoomOut, RotateCcw, Maximize2, Minimize2 } from 'lucide-react';
import { cn } from '../lib/cn';
import { useChartPalette } from './chart-theme';

// BCG-style bubble matrix — X axis + Y axis, bubble size = a metric,
// bubble colour = +/- a metric (diverging scale).
//
// Rendered as inline SVG for:
//   - crisp export to PDF (the prompt-02c council pack expects SVG)
//   - colour-token driven (reads palette via useChartPalette so the
//     theme switch updates the fill on dark mode without remount)
//
// Interactivity:
//   - Wheel scroll over plot area → zoom around cursor.
//   - Drag plot area → pan (any zoom level).
//   - Toolbar: zoom-in / zoom-out / reset / maximize.
//   - Maximize → browser-area fullscreen (fixed-positioned overlay
//     filling the viewport); ESC exits. Distinct from the
//     element.requestFullscreen() API which goes full monitor.
//
// Bubble positions are recomputed manually per render so bubble
// radii do NOT scale with zoom — keeps the dot density readable
// when zoomed in. Position transform is identity at zoom=1 / pan=0.
//
// Accessibility: each bubble has a visible text label + aria-label with
// the metric read-back. Hover = tooltip overlay with Thai description.

export interface Bubble {
  id: string;
  label: string;
  x: number;            // 0-100
  y: number;            // 0-100
  size: number;         // arbitrary; normalised internally
  color: number;        // arbitrary; negative → negative-tone, positive → positive-tone
  dataCompletenessPct?: number;
}

export interface BubbleMatrixProps {
  bubbles: Bubble[];
  axisXLabel: string;
  axisYLabel: string;
  xMinLabel?: string;
  xMaxLabel?: string;
  yMinLabel?: string;
  yMaxLabel?: string;
  width?: number;
  height?: number;
  onBubbleClick?: (b: Bubble) => void;
  className?: string;
  // Optional named labels for the 4 quadrants. When supplied, renders a
  // small caption in each corner (e.g. STARS top-right, DOGS bottom-left)
  // — useful for BCG-style portfolio views where the quadrant name is
  // more meaningful than the axis values alone. Omit to hide.
  quadrantLabels?: {
    topRight?: { label: string; tone?: 'positive' | 'negative' | 'neutral' };
    topLeft?: { label: string; tone?: 'positive' | 'negative' | 'neutral' };
    bottomRight?: { label: string; tone?: 'positive' | 'negative' | 'neutral' };
    bottomLeft?: { label: string; tone?: 'positive' | 'negative' | 'neutral' };
  };
}

const ZOOM_MIN = 1;
const ZOOM_MAX = 8;
const ZOOM_STEP = 1.4; // multiplicative step for the toolbar buttons

export function BubbleMatrix({
  bubbles,
  axisXLabel,
  axisYLabel,
  xMinLabel,
  xMaxLabel,
  yMinLabel,
  yMaxLabel,
  width = 720,
  height = 480,
  onBubbleClick,
  className,
  quadrantLabels,
}: BubbleMatrixProps) {
  const palette = useChartPalette();
  const [hovered, setHovered] = React.useState<Bubble | null>(null);
  // Track cursor position relative to the container so we can render a
  // floating tooltip card near the cursor. Without this the only hover
  // affordance is the below-chart caption + browser-native <title> —
  // neither matches the Recharts-style tooltip Council members expect.
  const [hoverPos, setHoverPos] = React.useState<{ x: number; y: number } | null>(null);
  const [zoom, setZoom] = React.useState(1);
  const [pan, setPan] = React.useState({ x: 0, y: 0 });
  const [maxed, setMaxed] = React.useState(false);
  const [maxSize, setMaxSize] = React.useState<{ w: number; h: number } | null>(null);
  const svgRef = React.useRef<SVGSVGElement | null>(null);
  const containerRef = React.useRef<HTMLDivElement | null>(null);
  const dragRef = React.useRef<{
    startX: number;
    startY: number;
    startPanX: number;
    startPanY: number;
  } | null>(null);
  // Track whether a drag actually moved — used to suppress click-through
  // (we don't want a pan to also fire onBubbleClick on the bubble we
  // happened to mouse-up on).
  const dragMovedRef = React.useRef(false);

  // Clip-path id has to be unique per instance so two charts on the same
  // page don't share the same defs. Generate a stable random suffix.
  const clipId = React.useId();

  // Effective width/height for the SVG. In maximized mode we measure
  // window dimensions and subtract chrome (toolbar + caption + padding).
  const effectiveWidth = maxed && maxSize ? maxSize.w : width;
  const effectiveHeight = maxed && maxSize ? maxSize.h : height;

  // Layout constants. Recomputed per render with effective dimensions
  // so the chart adapts cleanly when maximize toggles.
  const M = { top: 24, right: 40, bottom: 48, left: 60 };
  const W = effectiveWidth - M.left - M.right;
  const H = effectiveHeight - M.top - M.bottom;

  // Normalise size: bubbles scale quadratic-area with size, cap at r=32.
  const maxBubbleSize = Math.max(1, ...bubbles.map((b) => Math.abs(b.size)));
  const radius = (b: Bubble) => {
    const t = maxBubbleSize === 0 ? 0 : Math.abs(b.size) / maxBubbleSize;
    return 6 + Math.sqrt(t) * 26;
  };

  // Bubble colour: diverging. Positive → data-positive (greenish),
  // negative → data-negative (red), zero → neutral.
  const colorFor = (b: Bubble) => {
    if (b.color > 0) return palette.positive;
    if (b.color < 0) return palette.negative;
    return palette.neutral;
  };

  // Quadrant guides at 50/50.
  const quadrantX = M.left + W / 2;
  const quadrantY = M.top + H / 2;

  // ── Pan + zoom maths ─────────────────────────────────────────────
  // We apply: screen = pan + base * zoom. Inverse: base = (screen - pan) / zoom.
  const reset = React.useCallback(() => {
    setZoom(1);
    setPan({ x: 0, y: 0 });
  }, []);

  const zoomAtPoint = React.useCallback(
    (mx: number, my: number, factor: number) => {
      setZoom((prevZoom) => {
        const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prevZoom * factor));
        if (newZoom === prevZoom) return prevZoom;
        const actualFactor = newZoom / prevZoom;
        setPan((prevPan) => ({
          x: mx - (mx - prevPan.x) * actualFactor,
          y: my - (my - prevPan.y) * actualFactor,
        }));
        return newZoom;
      });
    },
    [],
  );

  const onWheel = (e: React.WheelEvent<SVGRectElement>) => {
    e.preventDefault();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAtPoint(mx, my, factor);
  };

  const onMouseDown = (e: React.MouseEvent<SVGRectElement>) => {
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startPanX: pan.x,
      startPanY: pan.y,
    };
    dragMovedRef.current = false;
  };

  const onMouseMove = (e: React.MouseEvent<SVGRectElement>) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) dragMovedRef.current = true;
    setPan({
      x: dragRef.current.startPanX + dx,
      y: dragRef.current.startPanY + dy,
    });
  };

  const endDrag = () => {
    dragRef.current = null;
  };

  // ── Maximize (browser-area fullscreen) ───────────────────────────
  // Fixed-positioned overlay covering the viewport. ESC exits.
  React.useEffect(() => {
    if (!maxed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMaxed(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [maxed]);

  React.useEffect(() => {
    if (!maxed) {
      setMaxSize(null);
      return;
    }
    const update = () => {
      // Leave room for chrome: 96px horizontal padding (48 each side)
      // + 220px vertical (toolbar + axis labels + caption + breathing).
      setMaxSize({
        w: Math.max(640, window.innerWidth - 96),
        h: Math.max(420, window.innerHeight - 220),
      });
    };
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, [maxed]);

  // Bubble screen positions — manually computed so radius doesn't scale.
  const bubblePositions = bubbles.map((b) => {
    const baseX = M.left + (b.x / 100) * W;
    const baseY = M.top + H - (b.y / 100) * H;
    return {
      bubble: b,
      cx: pan.x + baseX * zoom + M.left * (1 - zoom),
      cy: pan.y + baseY * zoom + M.top * (1 - zoom),
      r: radius(b),
    };
  });
  // The `+ M.left * (1 - zoom)` (and same for y) shifts the zoom origin
  // from (0,0) to (M.left, M.top), so the plot's top-left corner stays
  // pinned when zoom changes from 1 with pan=0. Otherwise zooming would
  // shoot bubbles off into the bottom-right quadrant.

  return (
    <div
      ref={containerRef}
      className={cn(
        'relative',
        maxed ? 'fixed inset-0 z-50 flex flex-col bg-surface-0 p-6' : 'overflow-hidden',
        className,
      )}
    >
      {/* Toolbar — top-right of the plot area */}
      <div className="absolute right-2 top-2 z-10 flex gap-1">
        <ToolbarButton
          label="Zoom in"
          onClick={() => {
            const rect = svgRef.current?.getBoundingClientRect();
            if (!rect) return;
            zoomAtPoint(rect.width / 2, rect.height / 2, ZOOM_STEP);
          }}
          disabled={zoom >= ZOOM_MAX - 0.01}
        >
          <ZoomIn className="size-icon-sm" />
        </ToolbarButton>
        <ToolbarButton
          label="Zoom out"
          onClick={() => {
            const rect = svgRef.current?.getBoundingClientRect();
            if (!rect) return;
            zoomAtPoint(rect.width / 2, rect.height / 2, 1 / ZOOM_STEP);
          }}
          disabled={zoom <= ZOOM_MIN + 0.01}
        >
          <ZoomOut className="size-icon-sm" />
        </ToolbarButton>
        <ToolbarButton
          label="Reset view"
          onClick={reset}
          disabled={zoom === 1 && pan.x === 0 && pan.y === 0}
        >
          <RotateCcw className="size-icon-sm" />
        </ToolbarButton>
        <ToolbarButton
          label={maxed ? 'Exit fullscreen' : 'Fullscreen'}
          onClick={() => setMaxed((m) => !m)}
        >
          {maxed ? (
            <Minimize2 className="size-icon-sm" />
          ) : (
            <Maximize2 className="size-icon-sm" />
          )}
        </ToolbarButton>
      </div>

      <svg
        ref={svgRef}
        width={effectiveWidth}
        height={effectiveHeight}
        role="img"
        aria-label={`BCG-style strategic matrix: ${axisXLabel} on X, ${axisYLabel} on Y. ${bubbles.length} items.`}
        style={{ display: 'block' }}
        // Wheel handled at the SVG level so zoom works regardless of
        // whether the cursor is over a bubble or empty plot area. The
        // bubble layer (rendered last → on top in z-order) intercepts
        // hover/click for the floating tooltip; the pan-drag rect
        // underneath catches mousedown in the empty plot gaps. Moving
        // wheel here makes both paths coexist cleanly.
        onWheel={onWheel as unknown as React.WheelEventHandler<SVGSVGElement>}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={M.left} y={M.top} width={W} height={H} />
          </clipPath>
        </defs>

        {/* plot area background */}
        <rect x={M.left} y={M.top} width={W} height={H} fill="transparent" stroke={palette.grid} />

        {/* quadrant cross-hairs */}
        <line
          x1={quadrantX}
          x2={quadrantX}
          y1={M.top}
          y2={M.top + H}
          stroke={palette.grid}
          strokeDasharray="3 3"
        />
        <line
          x1={M.left}
          x2={M.left + W}
          y1={quadrantY}
          y2={quadrantY}
          stroke={palette.grid}
          strokeDasharray="3 3"
        />

        {/* Axis labels — outside the clipPath so they always show */}
        <text
          x={M.left + W / 2}
          y={effectiveHeight - 12}
          textAnchor="middle"
          fontSize={12}
          fill={palette.text}
        >
          {axisXLabel}
        </text>
        <text
          x={14}
          y={M.top + H / 2}
          fontSize={12}
          fill={palette.text}
          textAnchor="middle"
          transform={`rotate(-90, 14, ${M.top + H / 2})`}
        >
          {axisYLabel}
        </text>

        {xMinLabel && (
          <text x={M.left} y={effectiveHeight - 28} textAnchor="start" fontSize={10} fill={palette.axis}>
            {xMinLabel}
          </text>
        )}
        {xMaxLabel && (
          <text x={M.left + W} y={effectiveHeight - 28} textAnchor="end" fontSize={10} fill={palette.axis}>
            {xMaxLabel}
          </text>
        )}
        {yMinLabel && (
          <text
            x={32}
            y={M.top + H}
            textAnchor="start"
            fontSize={10}
            fill={palette.axis}
            transform={`rotate(-90, 32, ${M.top + H})`}
          >
            {yMinLabel}
          </text>
        )}
        {yMaxLabel && (
          <text
            x={32}
            y={M.top + 8}
            textAnchor="end"
            fontSize={10}
            fill={palette.axis}
            transform={`rotate(-90, 32, ${M.top + 8})`}
          >
            {yMaxLabel}
          </text>
        )}

        {/* Optional quadrant captions — outside clipPath */}
        {quadrantLabels && (
          <g pointerEvents="none">
            {(() => {
              const toneFill = (t?: 'positive' | 'negative' | 'neutral') =>
                t === 'positive' ? palette.positive
                : t === 'negative' ? palette.negative
                : palette.text;
              const corners: Array<{
                k: 'topRight' | 'topLeft' | 'bottomRight' | 'bottomLeft';
                x: number; y: number; anchor: 'start' | 'end';
              }> = [
                { k: 'topRight',    x: M.left + W - 8, y: M.top + 16,         anchor: 'end' },
                { k: 'topLeft',     x: M.left + 8,     y: M.top + 16,         anchor: 'start' },
                { k: 'bottomRight', x: M.left + W - 8, y: M.top + H - 8,      anchor: 'end' },
                { k: 'bottomLeft',  x: M.left + 8,     y: M.top + H - 8,      anchor: 'start' },
              ];
              return corners.map((c) => {
                const cfg = quadrantLabels[c.k];
                if (!cfg) return null;
                return (
                  <text
                    key={c.k}
                    x={c.x}
                    y={c.y}
                    textAnchor={c.anchor}
                    fontSize={11}
                    fontWeight={600}
                    fill={toneFill(cfg.tone)}
                    style={{ letterSpacing: '0.06em' }}
                    opacity={0.85}
                  >
                    {cfg.label}
                  </text>
                );
              });
            })()}
          </g>
        )}

        {/* Pan/drag interaction overlay — transparent rect under the
            bubbles. Catches drag-to-pan in the empty plot gaps.
            Wheel-to-zoom is on the parent <svg> so it fires regardless
            of whether the cursor is over a bubble. Render order: this
            rect first (under bubbles in z-order) so bubble hover/click
            isn't intercepted. */}
        <rect
          x={M.left}
          y={M.top}
          width={W}
          height={H}
          fill="transparent"
          style={{
            cursor: dragRef.current
              ? 'grabbing'
              : zoom > 1 || pan.x !== 0 || pan.y !== 0
                ? 'grab'
                : 'crosshair',
          }}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={endDrag}
          onMouseLeave={endDrag}
        />

        {/* Bubble layer — clipped to plot area so pan/zoom doesn't bleed
            over axis labels. Positions are pre-computed manually so the
            radius doesn't scale with zoom (cleaner data-viz feel).
            Rendered LAST so bubbles sit on top of the pan-drag rect
            and receive hover (floating tooltip) + click events. */}
        <g clipPath={`url(#${clipId})`}>
          {bubblePositions.map(({ bubble: b, cx, cy, r }) => {
            const lowData = (b.dataCompletenessPct ?? 100) < 50;
            return (
              <circle
                key={b.id}
                cx={cx}
                cy={cy}
                r={r}
                fill={colorFor(b)}
                fillOpacity={lowData ? 0.25 : 0.55}
                stroke={colorFor(b)}
                strokeOpacity={0.9}
                strokeWidth={lowData ? 1 : 1.5}
                strokeDasharray={lowData ? '2 2' : undefined}
                style={{ cursor: onBubbleClick ? 'pointer' : 'default' }}
                onMouseEnter={(e) => {
                  setHovered(b);
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (rect) setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                }}
                onMouseMove={(e) => {
                  const rect = containerRef.current?.getBoundingClientRect();
                  if (rect) setHoverPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                }}
                onMouseLeave={() => {
                  setHovered((prev) => (prev?.id === b.id ? null : prev));
                  setHoverPos(null);
                }}
                onClick={() => {
                  // Suppress clicks that came from a pan-drag.
                  if (dragMovedRef.current) return;
                  onBubbleClick?.(b);
                }}
              />
            );
          })}
        </g>
      </svg>

      {/* Floating tooltip — appears next to the cursor when a bubble is
          hovered. Mirrors the below-chart caption's content but matches the
          Recharts-style cursor-following affordance users expect. The
          below-chart caption stays for keyboard nav + a stable read-back
          when the cursor moves between bubbles. */}
      {hovered && hoverPos && (() => {
        const containerW = containerRef.current?.clientWidth ?? effectiveWidth;
        const containerH = containerRef.current?.clientHeight ?? effectiveHeight;
        // Tooltip is ~220px wide and ~96px tall. Flip sides near edges so
        // it never spills off the container or covers the bubble.
        const flipX = hoverPos.x > containerW - 240;
        const flipY = hoverPos.y > containerH - 110;
        return (
          <div
            className={cn(
              'pointer-events-none absolute z-20 max-w-[240px] rounded-md border border-border-subtle',
              'bg-surface-0/95 px-2.5 py-1.5 text-xs shadow-lg backdrop-blur-sm',
            )}
            style={{
              left: flipX ? hoverPos.x - 12 : hoverPos.x + 16,
              top: flipY ? hoverPos.y - 12 : hoverPos.y + 16,
              transform: `${flipX ? 'translateX(-100%) ' : ''}${flipY ? 'translateY(-100%)' : ''}`.trim(),
            }}
          >
            <div className="font-semibold text-text-primary">{hovered.label}</div>
            <div className="mt-1 grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5 text-text-secondary">
              <span className="text-text-tertiary">{axisXLabel}</span>
              <span className="tabular-nums">{Math.round(hovered.x)}</span>
              <span className="text-text-tertiary">{axisYLabel}</span>
              <span className="tabular-nums">{Math.round(hovered.y)}</span>
              <span className="text-text-tertiary">size</span>
              <span className="tabular-nums">{Math.round(hovered.size).toLocaleString('en-US')}</span>
              <span className="text-text-tertiary">contrib</span>
              <span className="tabular-nums">
                {hovered.color >= 0 ? '+' : ''}
                {Math.round(hovered.color).toLocaleString('en-US')}
              </span>
              {hovered.dataCompletenessPct !== undefined && hovered.dataCompletenessPct < 100 && (
                <>
                  <span className="text-text-tertiary">data</span>
                  <span className="tabular-nums">{Math.round(hovered.dataCompletenessPct)}%</span>
                </>
              )}
            </div>
          </div>
        );
      })()}

      {/* Hover details. Fixed position below the SVG keeps layout stable.
          In maximized mode the caption sits at the bottom of the overlay
          so it doesn't reflow above the chart. */}
      <div className={cn('mt-2 min-h-[2rem] text-sm text-text-secondary', maxed && 'mt-auto')}>
        {hovered ? (
          <span>
            <strong className="text-text-primary">{hovered.label}</strong>
            {' · '}
            {axisXLabel} {Math.round(hovered.x)}
            {' · '}
            {axisYLabel} {Math.round(hovered.y)}
            {' · '}
            size {Math.round(hovered.size).toLocaleString('en-US')}
            {' · '}
            contrib {hovered.color >= 0 ? '+' : ''}
            {Math.round(hovered.color).toLocaleString('en-US')}
            {hovered.dataCompletenessPct !== undefined && hovered.dataCompletenessPct < 100 && (
              <span className="text-text-tertiary">
                {' · '}data {Math.round(hovered.dataCompletenessPct)}%
              </span>
            )}
          </span>
        ) : (
          <span className="text-text-tertiary">
            Hover a bubble for details · scroll to zoom · drag to pan · ESC to exit fullscreen
          </span>
        )}
      </div>
    </div>
  );
}

// ── Helpers ────────────────────────────────────────────────────────────

function ToolbarButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'inline-flex h-7 w-7 items-center justify-center rounded border transition-colors',
        'border-border-subtle bg-surface-0/90 text-text-secondary backdrop-blur-sm',
        'hover:bg-surface-2 hover:text-text-primary',
        'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:bg-surface-0/90 disabled:hover:text-text-secondary',
      )}
    >
      {children}
    </button>
  );
}
