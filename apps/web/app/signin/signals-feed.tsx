'use client';

import * as React from 'react';

// Glassmorphic stack of news / signal headlines for the right pane.
// Server-rendered with FeedItem props from page.tsx; this component
// owns presentation only — staggered entrance, relative timestamps,
// optional click-through.

export interface FeedItem {
  id: string;
  source: string;
  title: string;
  summary: string | null;
  publishedAtIso: string;
  url: string | null;
}

const SOURCE_LABEL: Record<string, string> = {
  // TrendSignal types (fallback path)
  POLICY: 'Policy',
  RESEARCH: 'Research',
  MARKET: 'Market',
  TECH: 'Technology',
  NEWS: 'News',
  // News categories (primary path)
  THAILAND: 'Thailand',
  EDUCATION: 'Education',
  TECHNOLOGY: 'Technology',
};

export function SignalsFeed({ items }: { items: FeedItem[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-white/25 bg-white/12 backdrop-blur-md px-4 py-3 text-[13px] text-white/85">
        No headlines available right now — check back later.
      </div>
    );
  }
  return (
    <ol className="flex flex-col gap-3">
      {items.map((s, i) => {
        const inner = (
          <>
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/85">
                {SOURCE_LABEL[s.source] ?? s.source}
              </span>
              <span className="text-[10px] text-white/65 font-mono tabular-nums">
                {formatRelativeDate(s.publishedAtIso)}
              </span>
            </div>
            <h3 className="text-[14px] font-medium leading-snug text-white line-clamp-3">
              {s.title}
            </h3>
            {s.summary && (
              <p className="mt-1 text-[12px] text-white/75 leading-relaxed line-clamp-2">
                {s.summary}
              </p>
            )}
          </>
        );
        // Resting state intentionally opacity-1 — the entrance animation
        // applies opacity:0→1 via `from`/`to` keyframes with fill-mode:
        // both, which respects prefers-reduced-motion gracefully (the
        // element starts at opacity 1 if animations are disabled). An
        // earlier version had `opacity-0` as the static class with the
        // animation flipping it to 1 via `forwards`; that left users
        // with reduced-motion or delay-quirk browsers staring at
        // permanently invisible cards.
        const baseClass =
          'block rounded-xl border border-white/30 bg-white/15 backdrop-blur-md px-4 py-3 shadow-[0_4px_24px_-8px_rgba(0,0,0,0.20)] transition-colors';
        return (
          <li
            key={s.id}
            style={{ animation: `signalIn 600ms ease-out ${i * 100}ms both` }}
          >
            {s.url ? (
              <a
                href={s.url}
                target="_blank"
                rel="noopener noreferrer"
                className={`${baseClass} hover:bg-white/20 hover:border-white/35`}
              >
                {inner}
              </a>
            ) : (
              <div className={baseClass}>{inner}</div>
            )}
          </li>
        );
      })}
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
  const diffMin = Math.floor(diffMs / 60_000);
  const diffH = Math.floor(diffMs / (1000 * 60 * 60));
  const diffD = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (diffMin < 1) return 'just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffH < 24) return `${diffH}h ago`;
  if (diffD < 7) return `${diffD}d ago`;
  if (diffD < 30) return `${Math.floor(diffD / 7)}w ago`;
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
