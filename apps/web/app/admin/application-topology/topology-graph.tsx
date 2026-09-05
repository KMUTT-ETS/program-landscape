'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowUpRight,
  Box,
  ExternalLink,
  Maximize,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RotateCcw,
  Square,
  X,
} from 'lucide-react';
import {
  FILTER_ANCHORS,
  FILTER_OPTIONS,
  TOPOLOGY,
  type NodeLane,
  type ScopeFilter,
  type Topology,
  type TopologyEdge,
  type TopologyNode,
} from './topology-data';

// ──────────────────────────────────────────────────────────────────────────
// Layout constants
//
// 4-column layered DAG. We render with fixed pixel coordinates inside a
// horizontally-scrollable container — this is an admin diagnostic surface
// (operators only), so a fixed canvas reads cleaner than a responsive
// reflow and survives the page filter changes without jumping.
// ──────────────────────────────────────────────────────────────────────────

const NODE_W = 230;
const NODE_H = 56;
const ROW_GAP = 14;
const ROW_SPAN = NODE_H + ROW_GAP; // 70 — vertical stride between nodes in a lane
const LANE_GAP = 70;
const LANE_W = NODE_W + LANE_GAP; // 300 — horizontal stride between lanes
const PAD_X = 36;
const PAD_Y = 24;
// Lane headers render INSIDE the SVG (so they pan + zoom with content
// instead of desynchronising from a top HTML strip). HEADER_H reserves
// the vertical room for the 2-line header band above the first node row.
const HEADER_H = 56;

// 3D mode — true X-Y-Z isometric. Base plane (L1, L2, L3, L5) lies on
// the X-Y plane at Z=0; the L4 AI lane is elevated to Z=AI_Z. Every
// node is positioned in 3D, then orthographically projected to 2D.
//
// Boxes themselves DON'T rotate — they stay screen-aligned (which is
// Y-axis billboarding for free, since SVG rects are always face-on
// regardless of the scene rotation around them). The scene's 3D-ness
// is conveyed by the base-plane grid, the AI drop pillars, and the
// edges curving across Z to reach the elevated AI tier.
//
// Default rotation is the classic cabinet-isometric (30°, -30°) so the
// 3D layout is immediately legible.
const AI_Z = 240;
const DEFAULT_ROT_3D = { x: 30, y: -30 }; // degrees — classic isometric

const LANE_ORDER: NodeLane[] = ['external', 'connector', 'table', 'ai', 'dashboard'];

const LANE_LABELS: Record<NodeLane, { eyebrow: string; caption: string }> = {
  external: {
    eyebrow: 'L1 · External systems',
    caption: 'Sources outside KKU Program Landscape',
  },
  connector: {
    eyebrow: 'L2 · Connectors + scripts',
    caption: 'Cron-driven ingestion + operator-run scripts',
  },
  table: {
    eyebrow: 'L3 · Postgres tables',
    caption: 'Landing tables + derived cubes',
  },
  ai: {
    eyebrow: 'L4 · AI tasks',
    caption: 'LLM-powered extraction, narrative + insights',
  },
  dashboard: {
    eyebrow: 'L5 · Dashboards',
    caption: 'Every consuming module + sub-dashboard',
  },
};

// Left-edge accent stripe colour per lane. Pulled through tokens rather
// than hex — matches the rest of the design system. AI lane uses the
// success-default green (the only family not already taken by another
// lane), so the L4 column is visually distinct at a glance.
const LANE_STRIPE: Record<NodeLane, string> = {
  external: 'oklch(var(--color-warning-default) / 0.85)',
  connector: 'oklch(var(--color-accent-default) / 0.85)',
  table: 'oklch(var(--color-info-default) / 0.85)',
  ai: 'oklch(var(--color-success-default) / 0.85)',
  dashboard: 'oklch(var(--color-brand-cardinal) / 0.85)',
};

// ──────────────────────────────────────────────────────────────────────────
// Public props
// ──────────────────────────────────────────────────────────────────────────

export interface ConnectorLive {
  /**
   * DataSource.mocked — the canonical "is this a real data feed?" boolean.
   * Drives the LIVE/MOCK pill. Independent from `status` (which carries
   * operational state — active / paused / error / disabled / mocked).
   * v1.1.3 footgun: when a connector flips to real, both `mocked=false`
   * AND `status='active'` should be set atomically — see kku-hr +
   * kku-research lessons-learned in CLAUDE.md.
   */
  mocked: boolean;
  /** DataSource.status — 'active' | 'paused' | 'error' | 'disabled' | 'mocked'. */
  status: string;
  /** ISO timestamp of the last completed IngestionRun. */
  lastSyncedAt: string | null;
  /** Total IngestionRun rows (for context — operator can drill into /admin/data-sources). */
  runsTotal: number;
}

/** Map of `DataSource.slug → live status`, surfaced from page.tsx. */
export type LiveStatusMap = Record<string, ConnectorLive | undefined>;

export interface TopologyGraphProps {
  liveStatus: LiveStatusMap;
}

// ──────────────────────────────────────────────────────────────────────────
// Component
// ──────────────────────────────────────────────────────────────────────────

export function TopologyGraph({ liveStatus }: TopologyGraphProps) {
  const [filter, setFilter] = useState<ScopeFilter>('all');
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 });
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  // View mode toggle — 2D flattens AI into the column lineup, 3D lifts
  // the AI lane out as a floating layer above the base plane.
  const [viewMode, setViewMode] = useState<'2d' | '3d'>('2d');
  // 3D rotation (degrees). x = vertical tilt, y = horizontal spin.
  const [rotation, setRotation] = useState({ x: 0, y: 0 });
  const [isRotating, setIsRotating] = useState(false);
  const rotateStart = useRef<{
    cx: number;
    cy: number;
    rx: number;
    ry: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const panStart = useRef<{
    cx: number;
    cy: number;
    tx: number;
    ty: number;
  } | null>(null);
  // Tracks whether the current pointer interaction moved enough to count
  // as a drag (and therefore should NOT trigger a node-click on release).
  const wasDragging = useRef(false);

  const visible = useMemo(() => filterTopology(TOPOLOGY, filter), [filter]);
  const baseLayout = useMemo(() => layoutTopology(visible), [visible]);

  // Project nodes for 3D mode using real rotation around the canvas
  // centre. AI lane sits at z=AI_Z, every other lane at z=0. Rotation
  // (rotation.x = vertical tilt, rotation.y = horizontal spin) tilts
  // the whole scene; AI's elevation appears as the perspective rotates.
  //
  // `depthById` is used to z-order nodes (painter algorithm — farther
  // drawn first so closer overlap them) and to feed the AI lift shadow.
  const { layout, depthById } = useMemo(() => {
    if (viewMode === '2d') {
      return { layout: baseLayout, depthById: {} as Record<string, number> };
    }
    const centre = {
      x: baseLayout.canvasW / 2,
      y: baseLayout.canvasH / 2,
    };
    const posById: Record<string, NodePos> = {};
    const depths: Record<string, number> = {};
    for (const node of visible.nodes) {
      const p = baseLayout.posById[node.id];
      if (!p) continue;
      // Anchor at node CENTRE for rotation — keeps the node body
      // centred on its post-rotation position rather than skewing
      // its top-left corner around.
      const cx = p.x + NODE_W / 2;
      const cy = p.y + NODE_H / 2;
      const z = node.lane === 'ai' ? AI_Z : 0;
      const projected = project3D({ x: cx, y: cy, z }, rotation, centre);
      posById[node.id] = {
        x: projected.x - NODE_W / 2,
        y: projected.y - NODE_H / 2,
      };
      depths[node.id] = projected.depth;
    }
    return { layout: { ...baseLayout, posById }, depthById: depths };
  }, [baseLayout, visible, viewMode, rotation]);

  // Focus = hover wins over selection (hover is transient feedback;
  // selection is what pins the tooltip).
  const focusId = hoveredId ?? selectedId;
  const focusSet = useMemo(
    () => (focusId ? collectConnected(visible, focusId) : null),
    [focusId, visible],
  );

  const selectedNode = selectedId
    ? visible.nodes.find((n) => n.id === selectedId) ?? null
    : null;

  // ──────────────────────────────────────────────────────────────────────
  // Pan / zoom / fullscreen
  // ──────────────────────────────────────────────────────────────────────

  // Compute a transform that fits the canvas WIDTH-WISE to the viewport.
  // Vertical: SVG height tracks the scaled content height (canvasH * scale)
  // so the canvas grows downward — browser page scrolls if it exceeds the
  // viewport. When content is shorter than the container's min-height,
  // `flex items-center` centers it vertically (vertical-align middle).
  //
  // Used on mount, filter change, and fullscreen toggle so first-paint
  // always uses the full available width.
  const computeFitTransform = useCallback((): {
    x: number;
    y: number;
    scale: number;
  } | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const padding = 16;
    const innerW = Math.max(200, rect.width - padding * 2);
    // Width-fit only — cap at 1.4 so on very wide screens we don't
    // upscale beyond comfortable read-size, and floor at 0.15 for safety.
    const scale = Math.max(0.15, Math.min(innerW / layout.canvasW, 1.4));
    // Centre horizontally; vertical positioning is handled by CSS flex
    // centering on the container (no translateY needed).
    const x = (rect.width - layout.canvasW * scale) / 2;
    return { x, y: 0, scale };
  }, [layout]);

  // Fit on filter change (the filtered subgraph might be much smaller).
  useEffect(() => {
    const fit = computeFitTransform();
    if (fit) setTransform(fit);
  }, [filter, computeFitTransform]);

  // Fit on fullscreen transition (the viewport size changed).
  useEffect(() => {
    const t = setTimeout(() => {
      const fit = computeFitTransform();
      if (fit) setTransform(fit);
    }, 80);
    return () => clearTimeout(t);
  }, [isFullscreen, computeFitTransform]);

  // Sync isFullscreen with the browser's fullscreen state (in case the
  // user presses Esc).
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const zoomBy = useCallback((factor: number, cx?: number) => {
    setTransform((prev) => {
      const newScale = Math.max(0.15, Math.min(3, prev.scale * factor));
      const scaleRatio = newScale / prev.scale;
      let pcx = cx;
      if (pcx == null) {
        const canvas = canvasRef.current;
        if (!canvas) return prev;
        const rect = canvas.getBoundingClientRect();
        pcx = rect.width / 2;
      }
      // Vertical: y stays 0 — the SVG height tracks scaled content
      // height, so vertical translate has no useful effect (would just
      // hide content). Page scroll handles vertical navigation.
      return {
        x: pcx - (pcx - prev.x) * scaleRatio,
        y: 0,
        scale: newScale,
      };
    });
  }, []);

  const zoomIn = useCallback(() => zoomBy(1.25), [zoomBy]);
  const zoomOut = useCallback(() => zoomBy(0.8), [zoomBy]);
  const fitToScreen = useCallback(() => {
    const fit = computeFitTransform();
    if (fit) setTransform(fit);
  }, [computeFitTransform]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  }, []);

  // Toggle 2D ↔ 3D. Entering 3D snaps to the default isometric
  // rotation so the AI lift is immediately visible (without rotation
  // the AI Z projects to 0 and looks like 2D). Leaving 3D zeroes
  // rotation since it's meaningless in flat mode.
  const handleViewModeChange = useCallback((mode: '2d' | '3d') => {
    setViewMode(mode);
    setRotation(mode === '3d' ? DEFAULT_ROT_3D : { x: 0, y: 0 });
  }, []);

  // "Reset view" — snap rotation back to default (3D) or zero (2D).
  const resetRotation = useCallback(() => {
    setRotation(viewMode === '3d' ? DEFAULT_ROT_3D : { x: 0, y: 0 });
  }, [viewMode]);

  // Wheel listener — attached via addEventListener with passive:false so
  // we can preventDefault (React's onWheel is passive since v17).
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const handleWheel = (e: WheelEvent) => {
      // Only intercept wheel for ZOOM (ctrlKey = trackpad pinch). Plain
      // wheel scrolls the page vertically — that's how the user
      // navigates content taller than the viewport. Without this gate,
      // every wheel tick over the canvas would zoom and prevent scroll.
      if (!e.ctrlKey) return;
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const delta = -e.deltaY * 0.02;
      const factor = Math.exp(delta);
      zoomBy(factor, cx);
    };
    canvas.addEventListener('wheel', handleWheel, { passive: false });
    return () => canvas.removeEventListener('wheel', handleWheel);
  }, [zoomBy]);

  // Document-level pan handlers — so drag continues even if the cursor
  // leaves the canvas, and mouseup anywhere ends the drag cleanly.
  useEffect(() => {
    if (!isPanning) return;
    const handleMove = (e: MouseEvent) => {
      const start = panStart.current;
      if (!start) return;
      const dx = e.clientX - start.cx;
      const dy = e.clientY - start.cy;
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        wasDragging.current = true;
      }
      setTransform((prev) => ({
        ...prev,
        x: start.tx + dx,
        y: start.ty + dy,
      }));
    };
    const handleUp = () => {
      panStart.current = null;
      setIsPanning(false);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [isPanning]);

  // Document-level rotate handlers — Shift+drag in 3D mode spins the
  // scene. ~0.4° per pixel feels natural for trackpads + mice; clamp
  // X-tilt to ±85° so we never flip past horizon (the projection
  // doesn't model back-face culling, so extreme angles look weird).
  useEffect(() => {
    if (!isRotating) return;
    const clamp = (v: number, lo: number, hi: number) =>
      Math.max(lo, Math.min(hi, v));
    const handleMove = (e: MouseEvent) => {
      const start = rotateStart.current;
      if (!start) return;
      const dx = e.clientX - start.cx;
      const dy = e.clientY - start.cy;
      // Mark as drag so node-click is suppressed on release.
      if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
        wasDragging.current = true;
      }
      setRotation({
        x: clamp(start.rx - dy * 0.4, -85, 85),
        y: start.ry + dx * 0.4,
      });
    };
    const handleUp = () => {
      rotateStart.current = null;
      setIsRotating(false);
    };
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [isRotating]);

  const onMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return; // primary button only
      // In 3D mode, Shift+drag = rotate; plain drag = pan. In 2D mode
      // we ignore Shift (rotate is meaningless without depth).
      if (viewMode === '3d' && e.shiftKey) {
        rotateStart.current = {
          cx: e.clientX,
          cy: e.clientY,
          rx: rotation.x,
          ry: rotation.y,
        };
        setIsRotating(true);
        return;
      }
      panStart.current = {
        cx: e.clientX,
        cy: e.clientY,
        tx: transform.x,
        ty: transform.y,
      };
      wasDragging.current = false;
      setIsPanning(true);
    },
    [viewMode, rotation.x, rotation.y, transform.x, transform.y],
  );

  const handleNodeClick = useCallback((id: string) => {
    // Suppress click if the pointer moved more than the drag threshold
    // between mousedown and mouseup — that interaction was a pan, not a
    // node selection.
    if (wasDragging.current) {
      wasDragging.current = false;
      return;
    }
    setSelectedId((prev) => (prev === id ? null : id));
  }, []);

  // ──────────────────────────────────────────────────────────────────────
  // Tooltip positioning (computed from the selected node + transform)
  // ──────────────────────────────────────────────────────────────────────

  const tooltipPlacement = useMemo(() => {
    if (!selectedNode) return null;
    const pos = layout.posById[selectedNode.id];
    if (!pos) return null;
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    // Node corners in canvas screen space (after the SVG transform).
    const nodeLeftX = pos.x * transform.scale + transform.x;
    const nodeRightX = (pos.x + NODE_W) * transform.scale + transform.x;
    const nodeCenterY = (pos.y + NODE_H / 2) * transform.scale + transform.y;
    const tooltipW = 340;
    const gap = 14;
    // Prefer the right side of the node; flip to left if it would clip.
    const fitsRight = nodeRightX + gap + tooltipW < rect.width - 8;
    const side: 'right' | 'left' = fitsRight ? 'right' : 'left';
    const x = side === 'right' ? nodeRightX + gap : nodeLeftX - gap - tooltipW;
    return { x, y: nodeCenterY, side };
  }, [selectedNode, transform, layout.posById]);

  return (
    <div
      ref={containerRef}
      className={[
        'flex flex-col gap-3',
        // Browser-fullscreen takes over the viewport via the Fullscreen
        // API — the element itself doesn't need fixed-positioning, but
        // we want it to fill the available height when in that mode.
        isFullscreen ? 'h-screen bg-surface-1 p-4' : '',
      ].join(' ')}
    >
      {/* Toolbar — filter chips on the left, legend + zoom + fullscreen
          on the right. Wraps cleanly when the viewport is narrow. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ScopeChips value={filter} onChange={setFilter} />
        <div className="flex flex-wrap items-center gap-3">
          <Legend />
          <ViewModeToggle
            value={viewMode}
            onChange={handleViewModeChange}
            onResetRotation={resetRotation}
          />
          <ZoomControls
            scale={transform.scale}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onFit={fitToScreen}
            onFullscreen={toggleFullscreen}
            isFullscreen={isFullscreen}
          />
        </div>
      </div>

      {/* Pan/zoom canvas — SVG width = container width, SVG height tracks
          scaled content height (canvasH × scale). Container grows beyond
          its min-height when content is taller than viewport → browser
          page scrolls naturally. When content is shorter, `flex items-
          center` vertically centres it. overflow-hidden still clips
          HORIZONTALLY when content is wider than the viewport (zoomed
          in); horizontal pan via drag shifts the visible region. */}
      <div
        ref={canvasRef}
        className={[
          'relative flex items-center justify-center overflow-hidden rounded-lg border border-border-default bg-surface-1 select-none',
          isRotating
            ? 'cursor-move'
            : isPanning
              ? 'cursor-grabbing'
              : 'cursor-grab',
          isFullscreen ? 'flex-1' : '',
        ].join(' ')}
        style={
          isFullscreen
            ? undefined
            : {
                // Default to a near-full viewport height so the first-
                // paint canvas isn't tiny. ~220px of vertical chrome
                // (admin shell topbar + admin back-nav + page header +
                // toolbar) sits above the canvas — adjust if that
                // changes. The container expands beyond this min when
                // SVG content height exceeds it.
                minHeight: 'calc(100vh - 220px)',
              }
        }
        onMouseDown={onMouseDown}
      >
        <svg
          width="100%"
          // Explicit height = scaled content height. When < container
          // min-height, flex centering gives the vertical-align-middle
          // effect. When > viewport, the container grows to match and
          // page scrolling kicks in.
          height={Math.max(120, layout.canvasH * transform.scale)}
          role="img"
          aria-label="KKU Program Landscape application data topology"
        >
          <defs>
            <marker
              id="topo-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path
                d="M 0 0 L 10 5 L 0 10 z"
                style={{ fill: 'oklch(var(--color-text-tertiary) / 0.6)' }}
              />
            </marker>
            <marker
              id="topo-arrow-focus"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path
                d="M 0 0 L 10 5 L 0 10 z"
                style={{ fill: 'oklch(var(--color-accent-default) / 0.95)' }}
              />
            </marker>
            {/* 3D lift — drop shadow under AI lane nodes. Used only when
                viewMode === '3d'; controlled by the filter attribute on
                each AI node's group. */}
            <filter
              id="topo-ai-lift"
              x="-20%"
              y="-30%"
              width="140%"
              height="160%"
            >
              <feDropShadow
                dx="3"
                dy="7"
                stdDeviation="5"
                floodColor="oklch(var(--color-text-primary))"
                floodOpacity="0.24"
              />
            </filter>
          </defs>

          {/* Transform group — pan + zoom apply uniformly to everything
              inside (3D scaffolding, lane headers, edges, nodes). */}
          <g
            transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}
          >
            {/* 3D base-plane grid — anchors the eye to the Z=0 reference
                plane. Only rendered in 3D mode. */}
            {viewMode === '3d' && (
              <BasePlaneGrid
                canvasW={baseLayout.canvasW}
                canvasH={baseLayout.canvasH}
                rotation={rotation}
              />
            )}

            {/* AI drop pillars — dashed line from each AI node down to its
                projected base-plane position. Makes the Z-direction
                elevation of AI tasks visually explicit. */}
            {viewMode === '3d' && (
              <AiDropPillars
                visible={visible}
                baseLayout={baseLayout}
                rotation={rotation}
              />
            )}

            {/* Lane headers — inside the transform group so they pan + zoom
                with the canvas content (no desync with HTML headers above). */}
            <g>
              {LANE_ORDER.map((lane, i) => {
                const x = PAD_X + i * LANE_W + 6;
                return (
                  <g key={lane} transform={`translate(${x}, 20)`}>
                    <text
                      x={0}
                      y={0}
                      fontSize="9.5"
                      fontWeight="700"
                      letterSpacing="1.6"
                      style={{ fill: 'oklch(var(--color-text-tertiary))' }}
                    >
                      {LANE_LABELS[lane].eyebrow.toUpperCase()}
                    </text>
                    <text
                      x={0}
                      y={16}
                      fontSize="10.5"
                      style={{ fill: 'oklch(var(--color-text-tertiary) / 0.78)' }}
                    >
                      {LANE_LABELS[lane].caption}
                    </text>
                  </g>
                );
              })}
            </g>

            {/* Edges — drawn first so they sit behind nodes */}
            <g>
              {visible.edges.map((edge, i) => {
                const a = layout.posById[edge.from];
                const b = layout.posById[edge.to];
                if (!a || !b) return null;

                const focused = focusSet?.edges.has(edgeKey(edge)) ?? false;
                const dimmed = focusSet != null && !focused;

                // Forward edges (source-left-of-target): exit the RIGHT
                // side of the source, enter the LEFT side of the target.
                // Backward edges (source-right-of-target, e.g. an AI
                // task writing back to a table in an earlier lane):
                // mirror the attachment points so the curve flows
                // cleanly leftward.
                const backward = a.x > b.x;
                const x1 = backward ? a.x : a.x + NODE_W;
                const y1 = a.y + NODE_H / 2;
                const x2 = backward ? b.x + NODE_W : b.x;
                const y2 = b.y + NODE_H / 2;
                const dx = x2 - x1;
                const cp1x = x1 + dx * 0.45;
                const cp2x = x2 - dx * 0.45;

                return (
                  <path
                    key={`e-${i}`}
                    d={`M ${x1} ${y1} C ${cp1x} ${y1}, ${cp2x} ${y2}, ${x2} ${y2}`}
                    fill="none"
                    style={{
                      stroke: focused
                        ? 'oklch(var(--color-accent-default) / 0.9)'
                        : backward
                          ? 'oklch(var(--color-info-default) / 0.28)'
                          : 'oklch(var(--color-text-tertiary) / 0.32)',
                      strokeWidth: focused ? 1.8 : 1,
                      // Backward edges (AI → Table write-back) get a
                      // dashed stroke so they read as "this node writes
                      // to a table other things consume" vs forward
                      // solid "this node reads from there".
                      strokeDasharray: backward && !focused ? '4 3' : undefined,
                      opacity: dimmed ? 0.18 : 1,
                      transition:
                        'opacity 120ms, stroke 120ms, stroke-width 120ms',
                    }}
                    markerEnd={
                      focused ? 'url(#topo-arrow-focus)' : 'url(#topo-arrow)'
                    }
                    pointerEvents="none"
                  />
                );
              })}
            </g>

            {/* Nodes — AI nodes get the lift filter in 3D mode so they
                read as floating above the base plane. The filter is
                applied at the per-node `<g>` wrapper level rather than
                inside NodeGroup, keeping NodeGroup mode-agnostic.
                In 3D mode nodes are also z-sorted (painter algorithm)
                so closer-to-camera nodes draw last and overlap farther
                ones correctly when rotation puts them in front. */}
            <g>
              {(viewMode === '3d'
                ? [...visible.nodes].sort(
                    (a, b) => (depthById[a.id] ?? 0) - (depthById[b.id] ?? 0),
                  )
                : visible.nodes
              ).map((node) => {
                const pos = layout.posById[node.id];
                if (!pos) return null;
                const focused = focusSet?.nodes.has(node.id) ?? false;
                const dimmed = focusSet != null && !focused;
                const isSelected = selectedId === node.id;
                const lifted = viewMode === '3d' && node.lane === 'ai';

                return (
                  <g
                    key={node.id}
                    filter={lifted ? 'url(#topo-ai-lift)' : undefined}
                  >
                    <NodeGroup
                      node={node}
                      x={pos.x}
                      y={pos.y}
                      focused={focused}
                      dimmed={dimmed}
                      selected={isSelected}
                      live={
                        node.details?.sourceSlug
                          ? liveStatus[node.details.sourceSlug]
                          : undefined
                      }
                      onHover={(id) => setHoveredId(id)}
                      onClick={handleNodeClick}
                    />
                  </g>
                );
              })}
            </g>
          </g>
        </svg>

        {/* Tooltip — anchored to the selected node, repositions on every
            transform change. Sits OUTSIDE the SVG so its HTML can use
            full Tailwind / scrolling without SVG quirks. */}
        {selectedNode && tooltipPlacement && (
          <NodeTooltip
            node={selectedNode}
            live={
              selectedNode.details?.sourceSlug
                ? liveStatus[selectedNode.details.sourceSlug]
                : undefined
            }
            placement={tooltipPlacement}
            onClose={() => setSelectedId(null)}
          />
        )}

        {/* Pan/zoom hint — bottom right, dimmable. Tail varies by view
            mode so 3D users discover the rotate gesture. */}
        <div className="pointer-events-none absolute bottom-2 right-3 rounded bg-surface-1/85 px-2 py-1 text-[10px] text-text-tertiary backdrop-blur-sm">
          Drag to pan · ⌘/Ctrl-scroll to zoom · scroll to page
          {viewMode === '3d' && <> · ⇧+drag to rotate</>}
        </div>
      </div>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Filter chip strip
// ──────────────────────────────────────────────────────────────────────────

// Each tab carries a small colored dot indicating its semantic category.
// Five colours keep the strip scannable without becoming a rainbow:
//   gray  — All (neutral / no filter)
//   blue  — Data/operational hubs (Education, Staff)
//   red   — Executive + per-program views (Cockpit, Deep-Dive, Decisions)
//   amber — Risk
//   green — Analytical tools (Trends, Gap, Benchmarking, Scenarios)
//   orange — AI / conversational (Analyst)
const FILTER_CATEGORY_TOKEN: Record<ScopeFilter, string> = {
  all: '--color-text-tertiary',
  education: '--color-info-default',
  staff: '--color-info-default',
  cockpit: '--color-brand-cardinal',
  'deep-dive': '--color-brand-cardinal',
  // Per-program view, same family as Deep-Dive — both answer "what do we
  // know about THIS programme", from opposite ends (strategy vs evidence).
  'teaching-learning': '--color-brand-cardinal',
  risk: '--color-warning-default',
  trends: '--color-success-default',
  gap: '--color-success-default',
  benchmarking: '--color-success-default',
  scenarios: '--color-success-default',
  decisions: '--color-brand-cardinal',
  analyst: '--color-accent-default',
};

// ──────────────────────────────────────────────────────────────────────────
// Zoom + fullscreen controls — compact toolbar that sits to the right of
// the Legend. Stops mousedown propagation so clicking the buttons doesn't
// trigger the canvas's pan-start handler underneath.
// ──────────────────────────────────────────────────────────────────────────

function ZoomControls({
  scale,
  onZoomIn,
  onZoomOut,
  onFit,
  onFullscreen,
  isFullscreen,
}: {
  scale: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onFit: () => void;
  onFullscreen: () => void;
  isFullscreen: boolean;
}) {
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-md border border-border-default bg-surface-1 p-0.5"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <IconButton onClick={onZoomOut} ariaLabel="Zoom out">
        <Minus className="size-icon-sm" />
      </IconButton>
      <span className="min-w-[40px] px-1 text-center font-tabular text-[10.5px] text-text-tertiary">
        {Math.round(scale * 100)}%
      </span>
      <IconButton onClick={onZoomIn} ariaLabel="Zoom in">
        <Plus className="size-icon-sm" />
      </IconButton>
      <span className="mx-0.5 h-4 w-px bg-border-default" aria-hidden />
      <IconButton onClick={onFit} ariaLabel="Fit to view">
        <Maximize className="size-icon-sm" />
      </IconButton>
      <IconButton
        onClick={onFullscreen}
        ariaLabel={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
      >
        {isFullscreen ? (
          <Minimize2 className="size-icon-sm" />
        ) : (
          <Maximize2 className="size-icon-sm" />
        )}
      </IconButton>
    </div>
  );
}

function IconButton({
  onClick,
  ariaLabel,
  children,
}: {
  onClick: () => void;
  ariaLabel: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      className="rounded p-1 text-text-secondary transition-colors hover:bg-surface-2 hover:text-text-primary"
    >
      {children}
    </button>
  );
}

// 2D ↔ 3D view toggle. 3D mode rotates the scene around the canvas
// centre with the AI lane at Z=AI_Z above the base plane — Shift+drag
// spins it. "Reset" snaps back to the default isometric view.
function ViewModeToggle({
  value,
  onChange,
  onResetRotation,
}: {
  value: '2d' | '3d';
  onChange: (v: '2d' | '3d') => void;
  onResetRotation: () => void;
}) {
  const opts: Array<{
    key: '2d' | '3d';
    label: string;
    icon: React.ReactNode;
  }> = [
    { key: '2d', label: '2D', icon: <Square className="size-icon-sm" /> },
    { key: '3d', label: '3D', icon: <Box className="size-icon-sm" /> },
  ];
  return (
    <div
      className="inline-flex items-center gap-0.5 rounded-md border border-border-default bg-surface-1 p-0.5"
      onMouseDown={(e) => e.stopPropagation()}
    >
      {opts.map((o) => {
        const active = value === o.key;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            aria-label={`Switch to ${o.label} view`}
            title={
              o.key === '3d'
                ? '3D view — AI lane lifts above base plane; Shift+drag to rotate'
                : '2D view — flat layout'
            }
            className={[
              'inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] font-semibold transition-colors',
              active
                ? 'bg-accent-default/15 text-text-primary'
                : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary',
            ].join(' ')}
          >
            {o.icon}
            <span>{o.label}</span>
          </button>
        );
      })}
      {value === '3d' && (
        <>
          <span className="mx-0.5 h-4 w-px bg-border-default" aria-hidden />
          <IconButton onClick={onResetRotation} ariaLabel="Reset view angle">
            <RotateCcw className="size-icon-sm" />
          </IconButton>
        </>
      )}
    </div>
  );
}

function ScopeChips({
  value,
  onChange,
}: {
  value: ScopeFilter;
  onChange: (v: ScopeFilter) => void;
}) {
  // FILTER_OPTIONS lives in topology-data.ts so the tab list + the
  // anchor lookup table sit next to each other (single source of truth
  // for "what tabs exist + what each one filters to").
  //
  // Each chip is a fully standalone pill — its OWN bg tint + border +
  // text colour, all derived from its category token. Adjacent chips
  // never share a border or background, so the visual separation comes
  // from chrome (every chip is clearly an island) rather than from
  // negative space alone. Gap is larger than chip-height — that's the
  // "comfortably separate" sweet spot.
  return (
    <div className="flex flex-wrap gap-x-2.5 gap-y-2">
      {FILTER_OPTIONS.map((o) => {
        const active = value === o.key;
        const tokenVar = FILTER_CATEGORY_TOKEN[o.key];
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-semibold tracking-tight transition-all hover:translate-y-[-1px] hover:shadow-elevation-1"
            style={{
              // Inactive: very-subtle bg tint (5%) + medium border (28%)
              //           + dark text. The bg tint is what makes adjacent
              //           chips of different categories pop visually.
              // Active:   stronger bg (20%) + opaque-leaning border (75%)
              //           + the category colour as the text colour itself.
              //           Adds a subtle elevation shadow.
              backgroundColor: active
                ? `oklch(var(${tokenVar}) / 0.20)`
                : `oklch(var(${tokenVar}) / 0.05)`,
              border: `1.5px solid oklch(var(${tokenVar}) / ${active ? 0.75 : 0.28})`,
              color: active
                ? `oklch(var(${tokenVar}))`
                : 'oklch(var(--color-text-primary))',
              boxShadow: active
                ? `0 1px 3px oklch(var(${tokenVar}) / 0.18)`
                : undefined,
            }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                background: `oklch(var(${tokenVar}))`,
                opacity: active ? 1 : 0.7,
              }}
              aria-hidden
            />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[11px] text-text-tertiary">
      {LANE_ORDER.map((lane) => (
        <div key={lane} className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 rounded-sm"
            style={{ background: LANE_STRIPE[lane] }}
            aria-hidden
          />
          <span className="capitalize">{lane}</span>
        </div>
      ))}
      <span className="text-text-tertiary/60">·</span>
      <LegendChip label="LIVE" tone="success" /> real connector
      <LegendChip label="MOCK" tone="warning" /> stubbed
      <LegendChip label="GEMINI" tone="info" /> Google
      <LegendChip label="CLAUDE" tone="accent" /> Anthropic
      <span className="text-text-tertiary/60">·</span>
      <span>Hover to trace · click to pin</span>
    </div>
  );
}

function LegendChip({
  label,
  tone,
}: {
  label: string;
  tone: 'success' | 'warning' | 'info' | 'accent';
}) {
  // Token convention is `--color-<family>-default` (not plain `--color-<family>`).
  // Wrong names render as invalid CSS — chip shows up as a "block box".
  const v =
    tone === 'success'
      ? '--color-success-default'
      : tone === 'warning'
        ? '--color-warning-default'
        : tone === 'accent'
          ? '--color-accent-default'
          : '--color-info-default';
  return (
    <span
      className="ml-0.5 inline-flex items-center rounded px-1 py-px text-[9px] font-semibold tracking-wider"
      style={{
        background: `oklch(var(${v}) / 0.18)`,
        color: `oklch(var(${v}))`,
        border: `1px solid oklch(var(${v}) / 0.55)`,
      }}
    >
      {label}
    </span>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Node group (SVG)
// ──────────────────────────────────────────────────────────────────────────

function NodeGroup({
  node,
  x,
  y,
  focused,
  dimmed,
  selected,
  live,
  onHover,
  onClick,
}: {
  node: TopologyNode;
  x: number;
  y: number;
  focused: boolean;
  dimmed: boolean;
  selected: boolean;
  live?: ConnectorLive;
  onHover: (id: string | null) => void;
  onClick: (id: string) => void;
}) {
  const borderColor = selected
    ? 'oklch(var(--color-accent-default))'
    : focused
      ? 'oklch(var(--color-accent-default) / 0.8)'
      : 'oklch(var(--color-border-default))';
  const borderWidth = selected ? 1.8 : focused ? 1.4 : 1;
  const opacity = dimmed ? 0.32 : 1;

  return (
    <g
      transform={`translate(${x}, ${y})`}
      style={{
        cursor: 'pointer',
        opacity,
        transition: 'opacity 120ms',
      }}
      onMouseEnter={() => onHover(node.id)}
      onMouseLeave={() => onHover(null)}
      onClick={(e) => {
        e.stopPropagation();
        onClick(node.id);
      }}
    >
      {/* Drop-shadow band when selected — subtle glow rather than a hard
          ring so the diagram doesn't feel busy. */}
      {selected && (
        <rect
          x={-4}
          y={-4}
          width={NODE_W + 8}
          height={NODE_H + 8}
          rx={9}
          fill="none"
          style={{
            stroke: 'oklch(var(--color-accent-default) / 0.18)',
            strokeWidth: 6,
          }}
        />
      )}

      {/* Body */}
      <rect
        x={0}
        y={0}
        width={NODE_W}
        height={NODE_H}
        rx={6}
        style={{
          fill: focused
            ? 'oklch(var(--color-surface-2))'
            : 'oklch(var(--color-surface-1))',
          stroke: borderColor,
          strokeWidth: borderWidth,
          transition: 'fill 120ms, stroke 120ms',
        }}
      />

      {/* Left lane stripe */}
      <rect
        x={0}
        y={0}
        width={4}
        height={NODE_H}
        rx={2}
        style={{ fill: LANE_STRIPE[node.lane] }}
      />

      {/* Label */}
      <text
        x={14}
        y={22}
        style={{
          fontFamily: 'inherit',
          fontSize: 12.5,
          fontWeight: 500,
          fill: 'oklch(var(--color-text-primary))',
        }}
      >
        {truncate(node.label, 28)}
      </text>

      {/* Subtitle */}
      {node.subtitle && (
        <text
          x={14}
          y={40}
          style={{
            fontFamily: 'inherit',
            fontSize: 10.5,
            fill: 'oklch(var(--color-text-tertiary))',
          }}
        >
          {truncate(node.subtitle, 32)}
        </text>
      )}

      {/* Right-edge pill — LIVE/MOCK for connectors with a DataSource row,
          vendor pill (GEMINI / CLAUDE) for AI-task nodes, nothing for
          plain scripts + orchestrators. */}
      {live ? (
        <LiveStatusPill x={NODE_W - 10} y={NODE_H / 2} live={live} />
      ) : node.kind === 'ai-task' ? (
        <LlmVendorPill
          x={NODE_W - 10}
          y={NODE_H / 2}
          // Default to Gemini when llm is unset — every AI-task node now
          // runs on Google (AI_PROVIDER=google). Anthropic remains
          // implemented as a fallback provider but no node hard-pins it.
          llm={node.llm ?? 'gemini'}
        />
      ) : null}
    </g>
  );
}

// Single chip helper — used by LIVE / MOCK / AI. The design-token
// naming convention here is `--color-<family>-default` (NOT plain
// `--color-<family>`); using the wrong name silently renders the rect
// + text as the browser default ("block-box" symptom — found 2026-05-16).
function StatusPill({
  x,
  y,
  text,
  tokenVar,
  width,
}: {
  x: number;
  y: number;
  text: string;
  /** Token base name without alpha — e.g. '--color-success-default'. */
  tokenVar: string;
  width: number;
}) {
  const h = 16;
  return (
    <g transform={`translate(${x - width}, ${y - h / 2})`}>
      <rect
        x={0}
        y={0}
        width={width}
        height={h}
        rx={4}
        fill={`oklch(var(${tokenVar}) / 0.18)`}
        stroke={`oklch(var(${tokenVar}) / 0.55)`}
        strokeWidth={1}
      />
      <text
        x={width / 2}
        y={h / 2}
        textAnchor="middle"
        dominantBaseline="central"
        fontSize={9}
        fontWeight={700}
        letterSpacing="0.08em"
        // SVG paint via the `fill` attribute is more reliable than via
        // `style.fill` — Tailwind's preflight sets `fill: currentColor`
        // on SVG which can clobber inline `style.fill` in some browsers.
        fill={`oklch(var(${tokenVar}))`}
      >
        {text}
      </text>
    </g>
  );
}

function LiveStatusPill({
  x,
  y,
  live,
}: {
  x: number;
  y: number;
  live: ConnectorLive;
}) {
  // LIVE / MOCK is the `mocked` boolean. Operational ops state (paused
  // / error / disabled) belongs on /admin/data-sources, not in the
  // topology — different question.
  const real = !live.mocked;
  return (
    <StatusPill
      x={x}
      y={y}
      text={real ? 'LIVE' : 'MOCK'}
      tokenVar={real ? '--color-success-default' : '--color-warning-default'}
      width={38}
    />
  );
}

// LLM vendor pill — sits in the same slot as LiveStatusPill, names the
// provider the AI task calls (GEMINI / CLAUDE). The pill IS the
// indicator that this is an AI task — no separate generic "AI" badge
// needed since L2 position already groups it with connectors+scripts.
function LlmVendorPill({
  x,
  y,
  llm,
}: {
  x: number;
  y: number;
  llm: 'gemini' | 'claude';
}) {
  // Google Gemini → info-default (blue, close to Google's brand spectrum).
  // Anthropic Claude → accent-default (warm orange, close to Anthropic's
  // brand). Both tokens exist in the design system; same convention
  // already used elsewhere on the page (legend chips).
  return (
    <StatusPill
      x={x}
      y={y}
      text={llm === 'gemini' ? 'GEMINI' : 'CLAUDE'}
      tokenVar={
        llm === 'gemini' ? '--color-info-default' : '--color-accent-default'
      }
      width={48}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Detail panel (HTML, slides in to the right of the canvas)
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// Floating tooltip — replaces the old fixed side panel. Anchored to the
// selected node's right (or left when right would clip the viewport).
// Renders as an absolutely-positioned HTML element layered over the
// canvas; max-height + overflow-auto handles long content. A small
// caret on the side closest to the node visually ties it back.
// ──────────────────────────────────────────────────────────────────────────

function NodeTooltip({
  node,
  live,
  placement,
  onClose,
}: {
  node: TopologyNode;
  live?: ConnectorLive;
  placement: { x: number; y: number; side: 'left' | 'right' };
  onClose: () => void;
}) {
  return (
    <div
      className={[
        'absolute z-30 w-[340px] max-h-[80%] overflow-auto rounded-xl border border-border-strong bg-surface-1/97 p-4 shadow-elevation-4 backdrop-blur-sm',
        // Subtle entrance — short fade + slight scale so it doesn't pop
        // jarringly on click.
        'animate-in fade-in zoom-in-95 duration-150 ease-out',
      ].join(' ')}
      style={{
        left: placement.x,
        top: placement.y,
        // Center vertically on the node's mid-y.
        transform: 'translateY(-50%)',
      }}
      // Tooltip is interactive — stop mouseDown propagating so clicks
      // inside don't trigger pan on the canvas underneath.
      onMouseDown={(e) => e.stopPropagation()}
      role="dialog"
      aria-label={`Details for ${node.label}`}
    >
      {/* Caret — small diamond on the side facing the node, made from a
          rotated bordered square so it matches the panel's chrome. */}
      <div
        aria-hidden
        className="absolute h-3 w-3 rotate-45 border border-border-strong bg-surface-1"
        style={{
          top: '50%',
          marginTop: -6,
          [placement.side === 'right' ? 'left' : 'right']: -6,
          // Knock out the inner two borders so the caret reads as
          // continuous with the panel edge.
          [placement.side === 'right' ? 'borderRight' : 'borderLeft']: 'none',
          [placement.side === 'right' ? 'borderTop' : 'borderBottom']: 'none',
        }}
      />

      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-text-tertiary">
            {LANE_LABELS[node.lane].eyebrow}
          </div>
          <div className="mt-1 text-[15px] font-semibold text-text-primary">
            {node.label}
          </div>
          {node.subtitle && (
            <div className="mt-0.5 text-xs text-text-tertiary">{node.subtitle}</div>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close details"
          className="rounded p-1 text-text-tertiary hover:bg-surface-2 hover:text-text-primary"
        >
          <X className="size-icon-md" />
        </button>
      </div>

      {node.details?.description && (
        <p className="mt-3 text-[12.5px] leading-relaxed text-text-secondary">
          {node.details.description}
        </p>
      )}

      <dl className="mt-4 space-y-2 text-[12px]">
        {node.details?.target && (
          <KV k="Target" v={node.details.target} mono />
        )}
        {node.details?.cadence && <KV k="Cadence" v={node.details.cadence} />}
        {node.details?.prismaModel && (
          <KV k="Prisma model" v={node.details.prismaModel} mono />
        )}
        {node.details?.sourceSlug && (
          <KV k="DataSource slug" v={node.details.sourceSlug} mono />
        )}
      </dl>

      {live && (
        <div className="mt-4 rounded-md border border-border-subtle bg-surface-2/40 p-3">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
            Live status
          </div>
          {/* `mocked` answers "real feed or stub?". `status` answers
              "what's the operational state right now?". They drift in
              practice (see CLAUDE.md v1.1.3 lesson) so we surface both. */}
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[12px]">
            <span className="text-text-secondary">Real feed</span>
            <span
              className={[
                'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                !live.mocked
                  ? 'bg-success/10 text-success'
                  : 'bg-warning/10 text-warning',
              ].join(' ')}
            >
              {live.mocked ? 'mocked' : 'live'}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-[12px]">
            <span className="text-text-secondary">Ops status</span>
            <span
              className={[
                'rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide',
                live.status === 'active'
                  ? 'bg-success/10 text-success'
                  : live.status === 'paused' || live.status === 'disabled'
                    ? 'bg-surface-3 text-text-secondary'
                    : live.status === 'error'
                      ? 'bg-danger/10 text-danger'
                      : 'bg-warning/10 text-warning',
              ].join(' ')}
            >
              {live.status}
            </span>
          </div>
          {!live.mocked && live.status === 'mocked' && (
            <div className="mt-2 rounded border border-warning/40 bg-warning/5 px-2 py-1.5 text-[10.5px] leading-relaxed text-warning">
              Drift: feed is real but the status column never got flipped
              from the seed value. Set <code>status = &apos;active&apos;</code> to
              canonicalise.
            </div>
          )}
          <div className="mt-1.5 flex items-center justify-between gap-2 text-[12px]">
            <span className="text-text-secondary">Last sync</span>
            <span className="tabular-nums text-text-primary">
              {live.lastSyncedAt ? formatAgo(live.lastSyncedAt) : '—'}
            </span>
          </div>
          <div className="mt-1 flex items-center justify-between gap-2 text-[12px]">
            <span className="text-text-secondary">Total runs</span>
            <span className="tabular-nums text-text-primary">
              {live.runsTotal.toLocaleString()}
            </span>
          </div>
          <Link
            href={`/admin/data-sources?slug=${node.details?.sourceSlug ?? ''}`}
            className="mt-2 inline-flex items-center gap-1 text-[11px] text-accent-default hover:underline"
          >
            Open in Data sources <ArrowUpRight className="size-icon-xs" />
          </Link>
        </div>
      )}

      {node.details?.notes && node.details.notes.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
            Notes
          </div>
          <ul className="mt-1.5 list-disc space-y-1 pl-4 text-[12px] text-text-secondary">
            {node.details.notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </div>
      )}

      {node.details?.relatedTables && node.details.relatedTables.length > 0 && (
        <div className="mt-4">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-text-tertiary">
            Related tables
          </div>
          <ul className="mt-1.5 space-y-0.5 text-[12px] text-text-secondary">
            {node.details.relatedTables.map((t) => (
              <li key={t} className="font-mono text-[11.5px]">
                {t}
              </li>
            ))}
          </ul>
        </div>
      )}

      {node.href && (
        <Link
          href={node.href}
          target="_blank"
          rel="noreferrer"
          className="mt-4 inline-flex items-center gap-1.5 rounded-md border border-border-default px-3 py-1.5 text-[12px] text-text-primary hover:bg-surface-2"
        >
          Open dashboard <ExternalLink className="size-icon-sm" />
        </Link>
      )}
    </div>
  );
}

function KV({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-text-tertiary">{k}</dt>
      <dd
        className={[
          'text-right text-text-primary',
          mono ? 'font-mono text-[11.5px]' : '',
        ].join(' ')}
      >
        {v}
      </dd>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Layout + filter + graph helpers
// ──────────────────────────────────────────────────────────────────────────

function filterTopology(topo: Topology, filter: ScopeFilter): Topology {
  if (filter === 'all') return topo;

  // Walk upstream from each anchor dashboard for this filter.
  // FILTER_ANCHORS is defined in topology-data.ts — adding a new
  // module just means adding a new entry there.
  const anchors = FILTER_ANCHORS[filter];
  if (!anchors || anchors.length === 0) return topo;

  // Reverse adjacency: who feeds into each node.
  const inEdges = new Map<string, TopologyEdge[]>();
  for (const e of topo.edges) {
    if (!inEdges.has(e.to)) inEdges.set(e.to, []);
    inEdges.get(e.to)!.push(e);
  }

  // BFS upstream from every anchor — accumulate every node that
  // ultimately feeds at least one of them.
  const reachable = new Set<string>(anchors);
  const queue: string[] = [...anchors];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    for (const e of inEdges.get(cur) ?? []) {
      if (!reachable.has(e.from)) {
        reachable.add(e.from);
        queue.push(e.from);
      }
    }
  }

  return {
    nodes: topo.nodes.filter((n) => reachable.has(n.id)),
    edges: topo.edges.filter(
      (e) => reachable.has(e.from) && reachable.has(e.to),
    ),
  };
}

interface NodePos {
  x: number;
  y: number;
}
interface LayoutResult {
  posById: Record<string, NodePos>;
  canvasW: number;
  canvasH: number;
}

function layoutTopology(topo: Topology): LayoutResult {
  // Bucket nodes by lane in the order they appear in TOPOLOGY (stable —
  // matches the editorial ordering in topology-data.ts).
  const byLane: Record<NodeLane, TopologyNode[]> = {
    external: [],
    connector: [],
    table: [],
    ai: [],
    dashboard: [],
  };
  for (const n of topo.nodes) {
    byLane[n.lane].push(n);
  }

  const maxLaneLen = Math.max(
    byLane.external.length,
    byLane.connector.length,
    byLane.table.length,
    byLane.ai.length,
    byLane.dashboard.length,
  );
  // canvasH now includes HEADER_H so lane-header SVG text fits above
  // the first node row. Node Y positions shift down by HEADER_H.
  const canvasH = HEADER_H + PAD_Y * 2 + maxLaneLen * ROW_SPAN;
  const canvasW = PAD_X * 2 + LANE_ORDER.length * NODE_W + (LANE_ORDER.length - 1) * LANE_GAP;

  const posById: Record<string, NodePos> = {};
  LANE_ORDER.forEach((lane, laneIdx) => {
    const nodes = byLane[lane];
    const laneX = PAD_X + laneIdx * LANE_W;
    // Center each lane's stack vertically within the post-header region.
    const innerH = canvasH - HEADER_H - PAD_Y * 2;
    const laneTotalH = nodes.length * ROW_SPAN - ROW_GAP;
    const startY = HEADER_H + PAD_Y + Math.max(0, (innerH - laneTotalH) / 2);
    nodes.forEach((n, i) => {
      posById[n.id] = { x: laneX, y: startY + i * ROW_SPAN };
    });
  });

  return { posById, canvasW, canvasH };
}

interface ConnectedSet {
  nodes: Set<string>;
  edges: Set<string>;
}

function edgeKey(e: TopologyEdge): string {
  return `${e.from}→${e.to}`;
}

/**
 * Walk upstream + downstream from `root`. Returns the set of node IDs and
 * edge keys that participate in any path through the root — that's what
 * gets highlighted in the canvas.
 */
// ──────────────────────────────────────────────────────────────────────────
// 3D projection — orthographic. Rotate around canvas centre, then drop
// the projected Z (no perspective foreshortening; topology reads better
// without it).
//
// Returns { x, y, depth } where depth is the post-rotation z used for
// painter-algorithm z-ordering (smaller = farther from camera, drawn
// first; larger = closer, drawn later so it appears on top).
// ──────────────────────────────────────────────────────────────────────────
function project3D(
  pt: { x: number; y: number; z: number },
  rot: { x: number; y: number },
  centre: { x: number; y: number },
): { x: number; y: number; depth: number } {
  // Translate to origin-relative.
  const x0 = pt.x - centre.x;
  const y0 = pt.y - centre.y;
  const z0 = pt.z;

  // Rotate around Y (horizontal spin).
  const cosY = Math.cos((rot.y * Math.PI) / 180);
  const sinY = Math.sin((rot.y * Math.PI) / 180);
  const x1 = x0 * cosY + z0 * sinY;
  const z1 = -x0 * sinY + z0 * cosY;

  // Rotate around X (vertical tilt).
  const cosX = Math.cos((rot.x * Math.PI) / 180);
  const sinX = Math.sin((rot.x * Math.PI) / 180);
  const y2 = y0 * cosX - z1 * sinX;
  const z2 = y0 * sinX + z1 * cosX;

  return { x: x1 + centre.x, y: y2 + centre.y, depth: z2 };
}

// ──────────────────────────────────────────────────────────────────────────
// 3D scaffolding — base-plane grid + AI drop pillars. Both rendered
// inside the SVG transform group, BEFORE edges/nodes so they sit
// behind. Only mounted when viewMode === '3d'.
// ──────────────────────────────────────────────────────────────────────────

function BasePlaneGrid({
  canvasW,
  canvasH,
  rotation,
}: {
  canvasW: number;
  canvasH: number;
  rotation: { x: number; y: number };
}) {
  const centre = { x: canvasW / 2, y: canvasH / 2 };
  // Step sizes — sparse enough not to clutter, dense enough to read
  // as a grid. X step = one lane column; Y step = 5 row-spans.
  const xStep = LANE_W;
  const yStep = ROW_SPAN * 5;
  const xs: number[] = [];
  for (let x = 0; x <= canvasW; x += xStep) xs.push(x);
  if (xs[xs.length - 1] !== canvasW) xs.push(canvasW);
  const ys: number[] = [];
  for (let y = 0; y <= canvasH; y += yStep) ys.push(y);
  if (ys[ys.length - 1] !== canvasH) ys.push(canvasH);

  // Outer outline corners (drawn slightly more visible than internal
  // grid lines so the plane boundary reads as a "floor edge").
  const c0 = project3D({ x: 0, y: 0, z: 0 }, rotation, centre);
  const c1 = project3D({ x: canvasW, y: 0, z: 0 }, rotation, centre);
  const c2 = project3D({ x: canvasW, y: canvasH, z: 0 }, rotation, centre);
  const c3 = project3D({ x: 0, y: canvasH, z: 0 }, rotation, centre);

  return (
    <g pointerEvents="none">
      {/* Subtle plane wash so the base reads as a surface rather than
          a wireframe (gives the floor a sense of substance under the
          floating AI layer). */}
      <path
        d={`M ${c0.x} ${c0.y} L ${c1.x} ${c1.y} L ${c2.x} ${c2.y} L ${c3.x} ${c3.y} Z`}
        fill="oklch(var(--color-info-default) / 0.025)"
        stroke="none"
      />

      {/* Internal grid lines */}
      {xs.map((x) => {
        const a = project3D({ x, y: 0, z: 0 }, rotation, centre);
        const b = project3D({ x, y: canvasH, z: 0 }, rotation, centre);
        return (
          <line
            key={`gx-${x}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="oklch(var(--color-text-tertiary) / 0.16)"
            strokeWidth={0.7}
          />
        );
      })}
      {ys.map((y) => {
        const a = project3D({ x: 0, y, z: 0 }, rotation, centre);
        const b = project3D({ x: canvasW, y, z: 0 }, rotation, centre);
        return (
          <line
            key={`gy-${y}`}
            x1={a.x}
            y1={a.y}
            x2={b.x}
            y2={b.y}
            stroke="oklch(var(--color-text-tertiary) / 0.16)"
            strokeWidth={0.7}
          />
        );
      })}

      {/* Boundary outline — slightly stronger to define the plane edge */}
      <path
        d={`M ${c0.x} ${c0.y} L ${c1.x} ${c1.y} L ${c2.x} ${c2.y} L ${c3.x} ${c3.y} Z`}
        fill="none"
        stroke="oklch(var(--color-text-tertiary) / 0.32)"
        strokeWidth={1}
      />
    </g>
  );
}

function AiDropPillars({
  visible,
  baseLayout,
  rotation,
}: {
  visible: Topology;
  baseLayout: LayoutResult;
  rotation: { x: number; y: number };
}) {
  const centre = { x: baseLayout.canvasW / 2, y: baseLayout.canvasH / 2 };
  return (
    <g pointerEvents="none">
      {visible.nodes
        .filter((n) => n.lane === 'ai')
        .map((node) => {
          const p = baseLayout.posById[node.id];
          if (!p) return null;
          // Pillar runs from the node's centre at z=0 (its shadow on
          // the base plane) up to its actual elevated z=AI_Z position.
          const cx = p.x + NODE_W / 2;
          const cy = p.y + NODE_H / 2;
          const base = project3D({ x: cx, y: cy, z: 0 }, rotation, centre);
          const top = project3D({ x: cx, y: cy, z: AI_Z }, rotation, centre);
          return (
            <g key={node.id}>
              {/* Pillar line */}
              <line
                x1={base.x}
                y1={base.y}
                x2={top.x}
                y2={top.y}
                stroke="oklch(var(--color-info-default) / 0.38)"
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              {/* Foot dot on the base plane — anchors the pillar visually */}
              <circle
                cx={base.x}
                cy={base.y}
                r={2.5}
                fill="oklch(var(--color-info-default) / 0.55)"
              />
            </g>
          );
        })}
    </g>
  );
}

function collectConnected(topo: Topology, root: string): ConnectedSet {
  const forward = new Map<string, TopologyEdge[]>();
  const backward = new Map<string, TopologyEdge[]>();
  for (const e of topo.edges) {
    if (!forward.has(e.from)) forward.set(e.from, []);
    if (!backward.has(e.to)) backward.set(e.to, []);
    forward.get(e.from)!.push(e);
    backward.get(e.to)!.push(e);
  }

  const nodes = new Set<string>([root]);
  const edges = new Set<string>();

  // BFS forward
  const fq = [root];
  while (fq.length) {
    const cur = fq.shift()!;
    for (const e of forward.get(cur) ?? []) {
      edges.add(edgeKey(e));
      if (!nodes.has(e.to)) {
        nodes.add(e.to);
        fq.push(e.to);
      }
    }
  }
  // BFS backward
  const bq = [root];
  while (bq.length) {
    const cur = bq.shift()!;
    for (const e of backward.get(cur) ?? []) {
      edges.add(edgeKey(e));
      if (!nodes.has(e.from)) {
        nodes.add(e.from);
        bq.push(e.from);
      }
    }
  }

  return { nodes, edges };
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function formatAgo(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '—';
  const mins = Math.round((Date.now() - t) / 60_000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 48) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  return `${days}d ago`;
}
