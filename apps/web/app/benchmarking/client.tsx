'use client';

import * as React from 'react';
import Link from 'next/link';
import { Card, useChartPalette } from '@kku/ui';
import { FilterField, FilterRail, FilterSelect } from '@/components/filter-rail';
import {
  AlertTriangle,
  Globe,
  Sparkles,
  TrendingUp,
  Users,
} from 'lucide-react';
import type {
  BenchmarkingOverviewDto,
  ContentModernity,
  ProgramBenchmarkRow,
} from './types';

// ─────────────────────────────────────────────────────────────────────────────
// Benchmarking page — redesigned 2026-05-03 around real data only.
//
// Drops the legacy "PeerSet portfolio comparison" + "Subject leadership"
// panels because the original prompt-10 tables (PeerSet, PeerProgram,
// PeerRanking) are 0 rows.
//
// Backed by real data:
//   - 252 programs benchmarked (ProgramPeerSelection)
//   - 237 AI peer reviews (ProgramPeerReview)
//   - 57 ranked peer institutions (RankedUniversity, real QS/THE ranks)
// ─────────────────────────────────────────────────────────────────────────────

export function BenchmarkingClient({ overview }: { overview: BenchmarkingOverviewDto }) {
  const [facultyFilter, setFacultyFilter] = React.useState<string>('');
  const [modernityFilter, setModernityFilter] = React.useState<string>('');
  const palette = useChartPalette();

  const facultyOptions = React.useMemo(() => {
    const set = new Set(overview.programs.map((p) => p.facultyCode));
    return ['', ...[...set].sort()];
  }, [overview.programs]);

  const filteredPrograms = overview.programs.filter((p) => {
    if (facultyFilter && p.facultyCode !== facultyFilter) return false;
    if (modernityFilter && p.contentModernity !== modernityFilter) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <HeroStat
          tone="default"
          icon={<Users />}
          label="Programs benchmarked"
          value={`${overview.hero.programsBenchmarked} / ${overview.hero.totalActivePrograms}`}
          sub="≥1 AI-picked peer institution"
        />
        <HeroStat
          tone="default"
          icon={<Sparkles />}
          label="Full AI reviews"
          value={overview.hero.programsReviewed.toString()}
          sub="strengths · weaknesses · gaps"
        />
        <HeroStat
          tone="warning"
          icon={<AlertTriangle />}
          label="OLD_SCHOOL"
          value={overview.hero.modernityCounts.OLD_SCHOOL.toString()}
          sub="curriculum lags peers materially"
        />
        <HeroStat
          tone="positive"
          icon={<TrendingUp />}
          label="FRONTIER"
          value={overview.hero.modernityCounts.FRONTIER.toString()}
          sub="curriculum at international frontier"
        />
      </div>

      <Card padding="md">
        <header className="mb-3">
          <h3 className="text-sm font-semibold text-text-primary">Curriculum modernity verdict</h3>
          <p className="mt-0.5 text-xs text-text-tertiary">
            Where each KKU curriculum sits on the OLD_SCHOOL → FRONTIER spectrum, AI-judged against the
            actual content of named peer programs. Click a band to filter the program table below.
          </p>
        </header>
        <ModernityHistogram
          counts={overview.hero.modernityCounts}
          activeFilter={modernityFilter}
          onFilter={(v) => setModernityFilter(v === modernityFilter ? '' : v)}
        />
      </Card>

      <Card padding="md">
        <header className="mb-3">
          <h3 className="text-sm font-semibold text-text-primary">Most-cited peer institutions</h3>
          <p className="mt-0.5 text-xs text-text-tertiary">
            Which globally-ranked universities does the AI most often pick as KKU peers, by tier.
          </p>
        </header>
        <CitedPeers rows={overview.citedPeers} palette={palette} />
      </Card>

      <Card padding="md">
        <header className="mb-3">
          <h3 className="text-sm font-semibold text-text-primary">Recent peer reviews — frank excerpts</h3>
          <p className="mt-0.5 text-xs text-text-tertiary">
            Latest 8 program reviews. Top weakness + top content gap shown verbatim from the AI's review payload.
          </p>
        </header>
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {overview.recentReviews.map((r) => (
            <li key={r.programId}>
              <Link
                href={`/programs/${r.programId}`}
                className="group flex h-full flex-col gap-2 rounded-lg border border-border-subtle bg-surface-1 p-3 hover:border-accent-default/40 hover:bg-surface-2/60"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-text-primary group-hover:text-accent-default">
                      {r.programNameEn || r.programNameTh}
                    </p>
                    <p className="mt-0.5 text-[11px] text-text-tertiary font-tabular">
                      {r.programCode} · {r.facultyCode}
                    </p>
                  </div>
                  {r.contentModernity && <ModernityBadge verdict={r.contentModernity} />}
                </div>
                {r.topPeer && (
                  <p className="text-[11px] text-text-tertiary">
                    <Globe className="mr-1 inline h-3 w-3" aria-hidden />
                    Top peer: <span className="text-text-secondary">{r.topPeer.name}</span> ({r.topPeer.country}, {r.topPeer.tier})
                  </p>
                )}
                {r.topWeakness && (
                  <div className="rounded border-l-2 border-warning/50 bg-warning/5 px-2 py-1">
                    <p className="text-[10px] uppercase tracking-wide text-warning">Top weakness</p>
                    <p className="mt-0.5 line-clamp-3 text-xs text-text-secondary">{r.topWeakness}</p>
                  </div>
                )}
                {r.topContentGap && (
                  <p className="text-[11px] text-text-tertiary">
                    <span className="font-medium text-text-secondary">Content gap:</span> {r.topContentGap.topic}
                    <span className={'ml-1.5 rounded-sm px-1 py-0.5 text-[9px] uppercase ' + sevTone(r.topContentGap.severity)}>
                      {r.topContentGap.severity}
                    </span>
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex flex-col gap-3">
        <FilterRail cols={2}>
          <FilterField label="Faculty">
            <FilterSelect
              value={facultyFilter}
              onChange={(e) => setFacultyFilter(e.target.value)}
            >
              <option value="">All faculties</option>
              {facultyOptions.filter(Boolean).map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </FilterSelect>
          </FilterField>
          <FilterField label="Modernity">
            <FilterSelect
              value={modernityFilter}
              onChange={(e) => setModernityFilter(e.target.value)}
            >
              <option value="">Any modernity</option>
              <option value="OLD_SCHOOL">OLD_SCHOOL</option>
              <option value="IN_BETWEEN">IN_BETWEEN</option>
              <option value="FRONTIER">FRONTIER</option>
            </FilterSelect>
          </FilterField>
        </FilterRail>
        <Card padding="md">
          <header className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-text-primary">Program-level benchmark</h3>
              <p className="mt-0.5 text-xs text-text-tertiary">
                All {overview.programs.length} benchmarked programs. Sorted by modernity verdict (OLD_SCHOOL first).
                Click any program to drill in.
              </p>
            </div>
            <span className="text-xs text-text-tertiary">
              showing {filteredPrograms.length} / {overview.programs.length}
            </span>
          </header>
          <ProgramBenchmarkTable rows={filteredPrograms} />
        </Card>
      </div>

      <Card padding="sm" className="text-[11px] text-text-tertiary">
        <p>
          This page renders only what is backed by populated tables — AI peer selections + reviews driven
          by the per-program pipeline (<code className="font-mono">program-peer-selection.v1</code> +{' '}
          <code className="font-mono">program-peer-review.v1</code>). The legacy curated-peer-set panels
          are intentionally omitted because <code className="font-mono">PeerSet</code> /{' '}
          <code className="font-mono">PeerProgram</code> /{' '}
          <code className="font-mono">PeerRanking</code> tables are empty.
        </p>
        <p className="mt-1">
          Methodology: <span className="font-tabular text-text-secondary">{overview.methodologyVersion}</span>
          <span className="mx-2 opacity-60">·</span>
          <Link href="/benchmarking/white-spaces" className="text-accent-default underline">
            White-space opportunities →
          </Link>
        </p>
      </Card>
    </div>
  );
}

function HeroStat({
  tone,
  icon,
  label,
  value,
  sub,
}: {
  tone: 'default' | 'positive' | 'warning' | 'danger';
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
}) {
  const valueClass = {
    default: 'text-text-primary',
    positive: 'text-positive',
    warning: 'text-warning',
    danger: 'text-danger',
  }[tone];
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface-1 p-4">
      <div className="flex items-center justify-between">
        <p className="text-[10px] uppercase tracking-wide text-text-tertiary">{label}</p>
        <span className="text-text-tertiary">{icon}</span>
      </div>
      <p className={`font-tabular text-2xl font-semibold ${valueClass}`}>{value}</p>
      <p className="line-clamp-2 text-[11px] text-text-tertiary">{sub}</p>
    </div>
  );
}

function ModernityHistogram({
  counts,
  activeFilter,
  onFilter,
}: {
  counts: { OLD_SCHOOL: number; IN_BETWEEN: number; FRONTIER: number; UNKNOWN: number };
  activeFilter: string;
  onFilter: (v: string) => void;
}) {
  const total = counts.OLD_SCHOOL + counts.IN_BETWEEN + counts.FRONTIER + counts.UNKNOWN;
  const buckets = [
    { key: 'OLD_SCHOOL', label: 'Old school', count: counts.OLD_SCHOOL, tone: 'bg-warning/70', text: 'text-warning' },
    { key: 'IN_BETWEEN', label: 'In between', count: counts.IN_BETWEEN, tone: 'bg-accent-default/70', text: 'text-accent' },
    { key: 'FRONTIER', label: 'Frontier', count: counts.FRONTIER, tone: 'bg-positive/70', text: 'text-positive' },
  ];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex h-6 w-full overflow-hidden rounded-md">
        {buckets.map((b) => {
          const pct = total > 0 ? (b.count / total) * 100 : 0;
          if (pct === 0) return null;
          return (
            <button
              key={b.key}
              type="button"
              onClick={() => onFilter(b.key)}
              className={`${b.tone} ${activeFilter && activeFilter !== b.key ? 'opacity-50' : 'opacity-100'} hover:opacity-100`}
              style={{ width: `${pct}%` }}
              title={`${b.label}: ${b.count} programs (${pct.toFixed(0)}%)`}
            />
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
        {buckets.map((b) => (
          <button
            key={b.key}
            type="button"
            onClick={() => onFilter(b.key)}
            className={`flex items-center gap-2 rounded px-2 py-1 ${
              activeFilter === b.key ? 'bg-surface-2' : 'hover:bg-surface-2/40'
            }`}
          >
            <span className={`inline-block h-2.5 w-2.5 rounded-sm ${b.tone}`} />
            <span className="font-medium text-text-primary">{b.label}</span>
            <span className={`font-tabular ${b.text}`}>{b.count}</span>
            <span className="text-text-tertiary">({total > 0 ? ((b.count / total) * 100).toFixed(0) : 0}%)</span>
          </button>
        ))}
        {counts.UNKNOWN > 0 && (
          <span className="flex items-center gap-2 px-2 py-1 text-text-tertiary">
            <span className="inline-block h-2.5 w-2.5 rounded-sm bg-border-subtle" />
            no review yet · {counts.UNKNOWN}
          </span>
        )}
      </div>
    </div>
  );
}

function CitedPeers({ rows, palette }: { rows: BenchmarkingOverviewDto['citedPeers']; palette: ReturnType<typeof useChartPalette> }) {
  if (rows.length === 0) return <p className="text-sm text-text-tertiary">No peer selections yet.</p>;
  const max = Math.max(...rows.map((r) => r.selectionCount), 1);
  const tierColor = (tier: keyof BenchmarkingOverviewDto['citedPeers'][number]['byTier']) => {
    if (tier === 'WORLD') return palette.series[0] ?? palette.neutral;
    if (tier === 'ASIA') return palette.series[1] ?? palette.neutral;
    if (tier === 'SOUTHEAST_ASIA') return palette.series[2] ?? palette.neutral;
    return palette.series[3] ?? palette.neutral;
  };
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => {
        const widthPct = (r.selectionCount / max) * 100;
        const rankBadge = r.qsWorldRank
          ? `QS #${r.qsWorldRank}`
          : r.theWorldRank
            ? `THE #${r.theWorldRank}`
            : null;
        return (
          <li key={r.rankedUniversityId} className="flex flex-col gap-1">
            <div className="flex items-baseline justify-between gap-3">
              <div className="min-w-0 truncate">
                <span className="text-sm font-medium text-text-primary">{r.name}</span>
                <span className="ml-2 text-[11px] text-text-tertiary">{r.country}</span>
                {rankBadge && (
                  <span className="ml-2 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-tabular text-text-secondary">
                    {rankBadge}
                  </span>
                )}
              </div>
              <span className="shrink-0 font-tabular text-xs font-semibold text-text-primary">
                {r.selectionCount} picks
              </span>
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-surface-2" style={{ width: `${Math.max(6, widthPct)}%` }}>
              {(['WORLD', 'ASIA', 'SOUTHEAST_ASIA', 'THAILAND_PEER'] as const).map((tier) => {
                const v = r.byTier[tier];
                if (v === 0) return null;
                const segPct = (v / r.selectionCount) * 100;
                return (
                  <div
                    key={tier}
                    style={{ width: `${segPct}%`, backgroundColor: tierColor(tier), opacity: 0.85 }}
                    title={`${tier}: ${v}`}
                  />
                );
              })}
            </div>
            <div className="text-[10px] text-text-tertiary">
              {(['WORLD', 'ASIA', 'SOUTHEAST_ASIA', 'THAILAND_PEER'] as const)
                .filter((t) => r.byTier[t] > 0)
                .map((t) => `${t.replace('_', ' ').toLowerCase()} ${r.byTier[t]}`)
                .join(' · ')}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function ModernityBadge({ verdict }: { verdict: ContentModernity }) {
  const cls =
    verdict === 'FRONTIER'
      ? 'bg-positive/15 text-positive'
      : verdict === 'IN_BETWEEN'
        ? 'bg-accent-subtle text-accent'
        : 'bg-warning/15 text-warning';
  return (
    <span className={`shrink-0 rounded-sm px-1.5 py-0.5 text-[9px] uppercase tracking-wide ${cls}`}>
      {verdict.replace('_', ' ')}
    </span>
  );
}

function sevTone(s: 'major' | 'moderate' | 'minor'): string {
  if (s === 'major') return 'bg-warning/20 text-warning';
  if (s === 'moderate') return 'bg-accent-subtle text-accent';
  return 'bg-surface-2 text-text-tertiary';
}

function ProgramBenchmarkTable({ rows }: { rows: ProgramBenchmarkRow[] }) {
  if (rows.length === 0) {
    return <p className="text-sm text-text-tertiary">No programs match the current filters.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border-subtle text-left text-text-tertiary">
            <th className="py-2 pr-3 font-normal">Program</th>
            <th className="py-2 pr-3 font-normal">Faculty</th>
            <th className="py-2 pr-3 font-normal">Modernity</th>
            <th className="py-2 pr-3 text-right font-normal">Peers</th>
            <th className="py-2 pr-3 font-normal">Top peer</th>
            <th className="py-2 pr-3 font-normal">Top gap</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr
              key={r.programId}
              className="border-b border-border-subtle last:border-0 hover:bg-surface-2/40"
            >
              <td className="py-2 pr-3">
                <Link
                  href={`/programs/${r.programId}`}
                  className="font-medium text-text-primary hover:text-accent-default"
                >
                  {(r.programNameEn || r.programNameTh).slice(0, 50)}
                </Link>
                <div className="text-[10px] text-text-tertiary font-tabular">{r.programCode}</div>
              </td>
              <td className="py-2 pr-3 text-text-secondary">{r.facultyCode}</td>
              <td className="py-2 pr-3">
                {r.contentModernity ? (
                  <ModernityBadge verdict={r.contentModernity} />
                ) : (
                  <span className="text-[10px] text-text-tertiary">no review</span>
                )}
              </td>
              <td className="py-2 pr-3 text-right font-tabular">{r.peerCount}</td>
              <td className="py-2 pr-3 text-text-secondary">
                {r.topPeerName ? (
                  <>
                    {r.topPeerName.slice(0, 30)}
                    {r.topPeerCountry && (
                      <span className="ml-1 text-[10px] text-text-tertiary">{r.topPeerCountry}</span>
                    )}
                  </>
                ) : '—'}
              </td>
              <td className="py-2 pr-3 text-text-tertiary">{r.topGapTopic ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
