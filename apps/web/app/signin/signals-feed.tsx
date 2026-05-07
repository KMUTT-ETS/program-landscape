'use client';

import * as React from 'react';

// Glassmorphic stack of signal headlines for the right pane of the
// sign-in page. Live data — pulled from TrendSignal at server-render
// time. This component just owns presentation: staggered entrance
// fades (CSS), relative timestamps, type-tag pills.

interface Signal {
  id: string;
  type: string;
  title: string;
  summary: string;
  detectedDateIso: string;
}

const TYPE_LABEL: Record<string, string> = {
  POLICY: 'Policy',
  RESEARCH: 'Research',
  MARKET: 'Market',
  TECH: 'Technology',
  NEWS: 'News',
};

const FALLBACK: Signal[] = [
  // Evergreen fallback when the DB query returns nothing — keeps the
  // pane visually intact during seed-empty environments.
  {
    id: 'fallback-1',
    type: 'POLICY',
    title: 'MHESI publishes 2026 framework on AI competencies for Thai HE',
    summary: 'Ministry of Higher Education sets baseline AI literacy targets across 297 KKU programs; effective academic year 2569.',
    detectedDateIso: new Date().toISOString(),
  },
  {
    id: 'fallback-2',
    type: 'TECH',
    title: 'Thai labour market: AI-related job posts up 38% YoY',
    summary: 'KMITL skill-mapping shows steepest growth in agentic AI tooling, prompt engineering, and AI safety roles.',
    detectedDateIso: new Date(Date.now() - 86400_000).toISOString(),
  },
  {
    id: 'fallback-3',
    type: 'RESEARCH',
    title: 'Population shift: Thailand 18–22 cohort projected to fall 1.8% per year',
    summary: 'NESDC long-range projection signals demographic squeeze on undergraduate intake; demographic-resilience driver in lifecycle scoring.',
    detectedDateIso: new Date(Date.now() - 2 * 86400_000).toISOString(),
  },
];

export function SignalsFeed({ signals }: { signals: Signal[] }) {
  const items = signals.length > 0 ? signals : FALLBACK;
  return (
    <ol className="flex flex-col gap-3 max-w-md">
      {items.map((s, i) => (
        <li
          key={s.id}
          className="rounded-xl border border-white/25 bg-white/12 backdrop-blur-md px-4 py-3 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.20)] opacity-0"
          style={{
            animation: `signalIn 600ms ease-out ${i * 100}ms forwards`,
          }}
        >
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/85">
              {TYPE_LABEL[s.type] ?? s.type}
            </span>
            <span className="text-[10px] text-white/65 font-mono tabular-nums">
              {formatRelativeDate(s.detectedDateIso)}
            </span>
          </div>
          <h3 className="text-[14px] font-medium leading-snug text-white">
            {s.title}
          </h3>
          {s.summary && (
            <p className="mt-1 text-[12px] text-white/75 leading-relaxed line-clamp-2">
              {s.summary}
            </p>
          )}
        </li>
      ))}
      <style>{`
        @keyframes signalIn {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ol>
  );
}

function formatRelativeDate(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  const diffD = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffH < 1) return 'just now';
  if (diffH < 24) return `${diffH}h ago`;
  if (diffD < 7) return `${diffD}d ago`;
  if (diffD < 30) return `${Math.floor(diffD / 7)}w ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
