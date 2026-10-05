'use client';

import * as React from 'react';
import type { Route } from 'next';
import { useRouter } from 'next/navigation';
import { BubbleMatrix, type Bubble, type BubbleMatrixProps } from '@kku/ui';
import type { AtlasPoint, PlotFrame } from '@kku/db';

export function AtlasBubble({
  points,
  frame,
  axisXLabel,
  axisYLabel,
  quadrantLabels,
  width = 560,
  height = 400,
  maxRadius,
}: {
  points: AtlasPoint[];
  frame: PlotFrame;
  axisXLabel: string;
  axisYLabel: string;
  quadrantLabels?: BubbleMatrixProps['quadrantLabels'];
  width?: number;
  height?: number;
  maxRadius?: number;
}) {
  const router = useRouter();
  // BubbleMatrix draws at a fixed pixel width inside an overflow-hidden box,
  // so a width wider than the column clips the right of the plot. Fit it to
  // the container once mounted; `width` is only the SSR / first-paint value.
  const boxRef = React.useRef<HTMLDivElement>(null);
  const [fitWidth, setFitWidth] = React.useState<number | null>(null);
  React.useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setFitWidth(Math.max(320, Math.floor(el.clientWidth)));
    measure();
    const obs = new ResizeObserver(measure);
    obs.observe(el);
    return () => obs.disconnect();
  }, []);
  const hrefById = new Map(points.map((p) => [p.id, p.href]));
  const bubbles: Bubble[] = points.map((p) => ({ id: p.id, label: p.label, x: p.x, y: p.y, size: p.size, color: 0, tone: p.tone }));
  return (
    <div ref={boxRef} className="w-full min-w-0">
      <div className="overflow-x-auto">
      <BubbleMatrix
        bubbles={bubbles}
        axisXLabel={axisXLabel}
        axisYLabel={axisYLabel}
        split={frame.split}
        diagonal={frame.diagonal}
        xTicks={frame.xTicks}
        yTicks={frame.yTicks}
        quadrantLabels={quadrantLabels}
        width={fitWidth ?? width}
        height={height}
        maxRadius={maxRadius}
        onBubbleClick={(b) => {
          const href = hrefById.get(b.id);
          if (href) router.push(href as Route);
        }}
      />
      </div>
    </div>
  );
}
