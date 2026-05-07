'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { BubbleMatrix } from '@kku/ui';

// Thin client wrapper around the cockpit's BubbleMatrix viz, pinned to
// the home-page hero. Receives a CockpitMatrix payload (already
// computed for university scope) and routes clicks to the program
// deep-dive. No data transformation — render-only.

interface CockpitMatrixPayload {
  methodologyVersion: string;
  axisX: { label: string; minLabel: string; maxLabel: string };
  axisY: { label: string; minLabel: string; maxLabel: string };
  sizeLabel: string;
  colorLabel: string;
  bubbles: Array<{
    id: string;
    label: string;
    level: string;
    x: number;
    y: number;
    size: number;
    color: number;
    dataCompletenessPct: number;
  }>;
}

interface Props {
  matrix: CockpitMatrixPayload;
}

export function StrategicMatrixHero({ matrix }: Props) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-2">
      <BubbleMatrix
        bubbles={matrix.bubbles}
        axisXLabel={matrix.axisX.label}
        axisYLabel={matrix.axisY.label}
        xMinLabel={matrix.axisX.minLabel}
        xMaxLabel={matrix.axisX.maxLabel}
        yMinLabel={matrix.axisY.minLabel}
        yMaxLabel={matrix.axisY.maxLabel}
        height={520}
        onBubbleClick={(b) => router.push(`/programs/${b.id}`)}
      />
      <div className="px-2 text-[11px] text-text-tertiary opacity-70">
        {matrix.bubbles.length} programs · size = {matrix.sizeLabel.toLowerCase()} · colour = {matrix.colorLabel.toLowerCase()} · click any dot to open the program&apos;s deep-dive
      </div>
    </div>
  );
}
