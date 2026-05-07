'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { BubbleMatrix } from '@kku/ui';

// Lifecycle × Revenue strategic matrix — home page hero, replacing the
// older HeroQuadrant. Same data dimensions but rendered with the simpler
// BubbleMatrix viz (the one used by the cockpit's Strategic Matrix view)
// so the picture is easier to read at a glance:
//
//   X axis = 3-yr enrolment delta (left: declining, right: growing)
//   Y axis = net contribution     (bottom: loss-making, top: profitable)
//   bubble size  = current enrolment
//   bubble color = net contribution sign (green positive / red negative)
//   quadrant captions = BCG portfolio names (Stars / Cows / Questions / Dogs)
//
// Each bubble click navigates to the program's deep-dive.

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

// Signed-log compresses the long-tail of net-contribution numbers so a
// few outliers don't squash everyone else into the centre line.
function signedLog(v: number): number {
  return Math.sign(v) * Math.log1p(Math.abs(v));
}

export function LifecycleBcgMatrix({ points, excludedCount, caveat }: Props) {
  const router = useRouter();

  // Normalise X (-100% … +100%) to 0..100 with linear mapping.
  // Deltas beyond ±100% are clamped to the chart edge (bubble pushed
  // against the wall). Signed-log isn't needed on the X axis — most
  // 3-yr deltas fall in -50..+200% range anyway.
  const X_LIMIT = 100;
  const xToBubble = (deltaPct: number): number => {
    const clamped = Math.max(-X_LIMIT, Math.min(X_LIMIT, deltaPct));
    return 50 + (clamped / X_LIMIT) * 50;
  };

  // Y uses signed-log so a Faculty-of-Medicine program with ฿100M
  // contribution doesn't crowd everyone else into a thin band.
  const yMaxAbsLog = Math.max(
    Math.log1p(1_000_000),
    ...points.map((p) => signedLog(Math.abs(p.netContributionThb))),
  );
  const yToBubble = (nc: number): number => {
    const ratio = signedLog(nc) / yMaxAbsLog; // -1..+1
    return 50 + ratio * 50;
  };

  const counts = {
    star: points.filter((p) => p.quadrant === 'star').length,
    cashCow: points.filter((p) => p.quadrant === 'cash-cow').length,
    question: points.filter((p) => p.quadrant === 'question').length,
    dog: points.filter((p) => p.quadrant === 'dog' || p.quadrant === 'dead').length,
  };

  const bubbles = points.map((p) => ({
    id: p.programId,
    label: `${p.code} · ${p.name}`,
    x: xToBubble(p.enrollmentDeltaPct),
    y: yToBubble(p.netContributionThb),
    size: Math.max(1, p.enrolledLatest),
    // BubbleMatrix's `color` is signed: positive→green, negative→red.
    // Use NC-sign directly; "dead" programs get a slight push to negative
    // so the eye-grouping reads "loss-making" rather than "neutral".
    color: p.quadrant === 'dead' ? -1 : p.netContributionThb,
  }));

  return (
    <div className="flex flex-col gap-2">
      <BubbleMatrix
        bubbles={bubbles}
        axisXLabel="3-year enrolment change"
        axisYLabel="Net contribution (THB · log scale)"
        xMinLabel="Declining"
        xMaxLabel="Growing"
        yMinLabel="Loss-making"
        yMaxLabel="Profitable"
        height={520}
        onBubbleClick={(b) => router.push(`/programs/${b.id}`)}
        quadrantLabels={{
          topRight: { label: `★ STARS · ${counts.star}`, tone: 'positive' },
          topLeft: { label: `🐄 CASH COWS · ${counts.cashCow}`, tone: 'neutral' },
          bottomRight: { label: `? QUESTIONS · ${counts.question}`, tone: 'neutral' },
          bottomLeft: { label: `× DOGS · ${counts.dog}`, tone: 'negative' },
        }}
      />
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-2 text-[11px] text-text-tertiary">
        <span className="opacity-70">
          dot size = current enrolment · click any dot to open the program&apos;s deep-dive
        </span>
        <span className="opacity-70">
          {points.length} of {points.length + excludedCount} programs · {excludedCount} excluded (no 3-yr trend)
        </span>
      </div>
      {caveat && <p className="px-2 text-[11px] text-warning">⚠ {caveat}</p>}
    </div>
  );
}
