'use client';

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
}: {
  points: AtlasPoint[];
  frame: PlotFrame;
  axisXLabel: string;
  axisYLabel: string;
  quadrantLabels?: BubbleMatrixProps['quadrantLabels'];
  width?: number;
  height?: number;
}) {
  const router = useRouter();
  const hrefById = new Map(points.map((p) => [p.id, p.href]));
  const bubbles: Bubble[] = points.map((p) => ({ id: p.id, label: p.label, x: p.x, y: p.y, size: p.size, color: 0, tone: p.tone }));
  return (
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
        width={width}
        height={height}
        onBubbleClick={(b) => {
          const href = hrefById.get(b.id);
          if (href) router.push(href as Route);
        }}
      />
    </div>
  );
}
