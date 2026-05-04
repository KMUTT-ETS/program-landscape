'use client';

import * as React from 'react';

interface PulseRow {
  programCode: string;
  programName: string;
  facultyCode: string;
  generatedAt: string; // ISO string
  contentLength: number;
  confidence: number;
}

interface Props {
  done: number;
  total: number;
  lastCompletedCode: string | null;
  lastCompletedAt: string | null;
  pulse: PulseRow[];
}

// Live pulse strip — appears only while the bulk run is mid-flight.
// Shows progress bar + the 5 most recent narratives in a marquee
// scroller. Refreshes via router.refresh() every 60s when mounted.
export function PulseStrip({ done, total, lastCompletedCode, lastCompletedAt, pulse }: Props) {
  const [mounted, setMounted] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    setMounted(true);
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  if (done >= total || total === 0) return null;

  const pct = (done / total) * 100;
  const lastAt = lastCompletedAt ? new Date(lastCompletedAt) : null;
  const ageStr = mounted && lastAt ? ageOf(now - lastAt.getTime()) : lastAt?.toISOString().slice(11, 19) ?? '—';

  return (
    <div className="relative overflow-hidden rounded-lg border border-accent-default/30 bg-accent-subtle/40 px-4 py-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-default opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-default" />
            </span>
            <span className="font-semibold text-accent">Strategic narrative pipeline running</span>
            <span className="text-text-tertiary">·</span>
            <span className="font-tabular text-text-secondary">
              {done} / {total} ({pct.toFixed(1)}%)
            </span>
            {lastCompletedCode && (
              <>
                <span className="text-text-tertiary">·</span>
                <span className="text-text-secondary">
                  Last: <span className="font-tabular">{lastCompletedCode}</span> {ageStr}
                </span>
              </>
            )}
          </div>
        </div>
        <div className="h-1 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full bg-accent-default transition-all duration-700 ease-out"
            style={{ width: `${pct}%` }}
          />
        </div>
        {pulse.length > 0 && (
          <div className="flex gap-2 overflow-hidden text-[10px] text-text-tertiary">
            {pulse.slice(0, 4).map((p) => (
              <span
                key={p.programCode}
                className="inline-flex items-center gap-1.5 rounded-full bg-surface-1 px-2 py-0.5"
              >
                <span className="font-tabular text-text-secondary">{p.programCode}</span>
                <span className="opacity-75">{p.programName.slice(0, 32)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ageOf(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.floor(ms / 1000))}s ago`;
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}
