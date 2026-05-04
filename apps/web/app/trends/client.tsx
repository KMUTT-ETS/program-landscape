'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Badge,
  Card,
  Input,
  TrendsRadar,
  type TrendDot,
  type TrendSignalType,
} from '@kku/ui';
import type { TrendsFeedResponse } from './types';

const TYPE_OPTIONS: Array<{ value: '' | TrendSignalType; label: string }> = [
  { value: '', label: 'All types' },
  { value: 'POLICY', label: 'Policy' },
  { value: 'RESEARCH', label: 'Research' },
  { value: 'MARKET', label: 'Market' },
  { value: 'TECH', label: 'Tech' },
  { value: 'NEWS', label: 'News' },
];

const WINDOW_OPTIONS = [
  { value: '7', label: '7 days' },
  { value: '30', label: '30 days' },
  { value: '90', label: '90 days' },
  { value: '365', label: '12 months' },
];

export function TrendsClient({
  feed,
  initialFilters,
}: {
  feed: TrendsFeedResponse;
  initialFilters: {
    signalType: string;
    windowDays: string;
    minImpactScore: string;
    search: string;
  };
}) {
  const router = useRouter();
  const [filters, setFilters] = React.useState(initialFilters);
  const [highlighted, setHighlighted] = React.useState<string | null>(null);

  // `Date.now()` differs between SSR and hydration, which would change
  // every dot's radial position and trigger a hydration mismatch. Defer
  // the time-relative computation to after mount: the radar renders
  // empty during SSR, then populates on the client.
  const [nowMs, setNowMs] = React.useState<number | null>(null);
  React.useEffect(() => setNowMs(Date.now()), []);

  const applyFilters = (next: typeof filters) => {
    const qs = new URLSearchParams();
    if (next.signalType) qs.set('signalType', next.signalType);
    qs.set('windowDays', next.windowDays);
    if (next.minImpactScore !== '0') qs.set('minImpactScore', next.minImpactScore);
    if (next.search) qs.set('search', next.search);
    router.push(`/trends?${qs}`);
  };

  const dots: TrendDot[] = React.useMemo(() => {
    if (nowMs === null) return [];
    return feed.signals.map((s) => ({
      id: s.id,
      title: s.title,
      signalType: s.signalType as TrendSignalType,
      detectedAtMsAgo: nowMs - new Date(s.detectedDate).getTime(),
      impactScore: s.impactScore,
    }));
  }, [feed.signals, nowMs]);

  return (
    <div className="flex flex-col gap-4">
      {/* Filter + summary bar */}
      <Card padding="sm">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <select
            value={filters.signalType}
            onChange={(e) => {
              const next = { ...filters, signalType: e.target.value };
              setFilters(next);
              applyFilters(next);
            }}
            className="kku-select"
          >
            {TYPE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={filters.windowDays}
            onChange={(e) => {
              const next = { ...filters, windowDays: e.target.value };
              setFilters(next);
              applyFilters(next);
            }}
            className="kku-select"
          >
            {WINDOW_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-2">
            <span className="text-xs text-text-tertiary">Min impact</span>
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={filters.minImpactScore}
              onChange={(e) => setFilters({ ...filters, minImpactScore: e.target.value })}
              onMouseUp={() => applyFilters(filters)}
              className="w-24"
            />
            <span className="font-tabular text-xs">
              {Math.round(Number(filters.minImpactScore) * 100)}
            </span>
          </div>
          <Input
            className="max-w-xs"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') applyFilters(filters);
            }}
            placeholder="Search title / summary…"
          />
          <div className="ml-auto text-xs text-text-secondary">
            <strong className="font-tabular text-text-primary">{feed.total}</strong> signals in window
            · <strong className="font-tabular text-text-primary">{feed.highImpactCount}</strong> high impact
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_420px]">
        {/* Feed */}
        <div className="flex flex-col gap-2">
          {feed.signals.length === 0 ? (
            <Card>
              <p className="text-sm text-text-tertiary">
                No signals match these filters. Widen the time window or lower the impact threshold.
              </p>
            </Card>
          ) : (
            feed.signals.map((s) => (
              <Card
                key={s.id}
                onMouseEnter={() => setHighlighted(s.id)}
                onMouseLeave={() => setHighlighted((prev) => (prev === s.id ? null : prev))}
                className={
                  'transition-shadow ' +
                  (highlighted === s.id ? 'shadow-elevation-2' : '')
                }
              >
                <Link href={`/trends/${s.id}`} className="block">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <Badge tone={typeTone(s.signalType)}>{s.signalType}</Badge>
                        <span className="text-xs text-text-tertiary">
                          {new Date(s.detectedDate).toISOString().slice(0, 10)}
                        </span>
                      </div>
                      <h3 className="mt-1 text-sm font-semibold">{s.title}</h3>
                      <p className="mt-1 line-clamp-2 text-sm text-text-secondary" lang="th">
                        {s.summaryTh ?? s.summaryEn}
                      </p>
                      {s.affectedProgramIds.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1 text-xs text-text-tertiary">
                          Affects {s.affectedProgramIds.length} program{s.affectedProgramIds.length === 1 ? '' : 's'}
                        </div>
                      )}
                    </div>
                    <ImpactBadge score={s.impactScore} />
                  </div>
                </Link>
              </Card>
            ))
          )}
        </div>

        {/* Radar */}
        <Card>
          <h3 className="mb-2 text-sm font-semibold">Signal radar</h3>
          <TrendsRadar
            dots={dots}
            highlightedSignalId={highlighted}
            onDotClick={(d) => router.push(`/trends/${d.id}`)}
          />
        </Card>
      </div>
    </div>
  );
}

function ImpactBadge({ score }: { score: number }) {
  const tone: 'danger' | 'warning' | 'neutral' =
    score >= 0.7 ? 'danger' : score >= 0.4 ? 'warning' : 'neutral';
  return <Badge tone={tone}>impact {Math.round(score * 100)}</Badge>;
}

function typeTone(t: TrendSignalType): 'info' | 'success' | 'warning' | 'neutral' | 'accent' {
  switch (t) {
    case 'POLICY':
      return 'accent';
    case 'RESEARCH':
      return 'info';
    case 'MARKET':
      return 'warning';
    case 'TECH':
      return 'success';
    default:
      return 'neutral';
  }
}
