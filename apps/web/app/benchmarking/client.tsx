'use client';

import * as React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge, Card } from '@kku/ui';
import type {
  PeerSetDto,
  PortfolioComparisonResponse,
  SubjectLeadershipResponse,
} from './types';

type View = 'portfolio' | 'subjects';

const VIEW_OPTIONS: Array<{ value: View; label: string }> = [
  { value: 'portfolio', label: 'Portfolio comparison' },
  { value: 'subjects', label: 'Subject leadership' },
];

interface Filters {
  peerSetId: string;
  subjectArea: string;
  view: View;
}

export function BenchmarkingClient({
  peerSets,
  initialFilters,
  portfolio,
  subjects,
}: {
  peerSets: PeerSetDto[];
  initialFilters: Filters;
  portfolio: PortfolioComparisonResponse | null;
  subjects: SubjectLeadershipResponse | null;
}) {
  const router = useRouter();
  const [filters, setFilters] = React.useState(initialFilters);

  const apply = (next: Filters) => {
    const qs = new URLSearchParams();
    if (next.peerSetId) qs.set('peerSetId', next.peerSetId);
    if (next.subjectArea) qs.set('subjectArea', next.subjectArea);
    qs.set('view', next.view);
    router.push(`/benchmarking?${qs}`);
  };

  const update = <K extends keyof Filters>(key: K, value: Filters[K]) => {
    const next = { ...filters, [key]: value };
    setFilters(next);
    apply(next);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Filter + view bar */}
      <Card padding="sm">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Selector
            label="Peer set"
            value={filters.peerSetId}
            options={peerSets.map((p) => ({ value: p.id, label: `${p.name} · ${p.memberCount} peers` }))}
            onChange={(v) => update('peerSetId', v)}
          />
          <Selector
            label="Subject"
            value={filters.subjectArea}
            options={[
              { value: 'Computer Science', label: 'Computer Science' },
              { value: 'Engineering', label: 'Engineering' },
              { value: 'Medicine', label: 'Medicine' },
            ]}
            onChange={(v) => update('subjectArea', v)}
          />
          <div className="flex items-center gap-1 rounded-md border border-subtle bg-surface-1 p-0.5">
            {VIEW_OPTIONS.map((v) => (
              <button
                key={v.value}
                type="button"
                onClick={() => update('view', v.value)}
                className={
                  'rounded px-2.5 py-1 text-xs font-medium transition-colors ' +
                  (filters.view === v.value ? 'bg-surface-2 text-text-primary' : 'text-text-secondary hover:text-text-primary')
                }
              >
                {v.label}
              </button>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-text-tertiary">
            <Link href="/benchmarking/white-spaces" className="rounded-sm px-2 py-1 text-text-secondary hover:bg-surface-2">
              White spaces →
            </Link>
          </div>
        </div>
      </Card>

      {filters.view === 'portfolio' && <PortfolioPanel data={portfolio} />}
      {filters.view === 'subjects' && <SubjectsPanel data={subjects} subjectArea={filters.subjectArea} />}
    </div>
  );
}

function PortfolioPanel({ data }: { data: PortfolioComparisonResponse | null }) {
  if (!data) return <EmptyState title="Portfolio comparison unavailable" />;
  return (
    <div className="flex flex-col gap-4">
      {data.lowConfidenceReason ? (
        <Card padding="sm">
          <p className="text-xs leading-relaxed text-text-secondary">
            ⚠ <span className="font-medium">Comparable basis:</span> {data.lowConfidenceReason}
          </p>
        </Card>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        <Card padding="md">
          <h3 className="mb-3 text-sm font-semibold text-text-primary">
            KKU vs {data.peerSetName} — {data.peers.length} peer institutions
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-subtle text-left text-xs uppercase tracking-wide text-text-tertiary">
                  <th className="py-2 pr-3">Institution</th>
                  <th className="py-2 pr-3">Country</th>
                  <th className="py-2 pr-3 text-right">Programs</th>
                  <th className="py-2 pr-3 text-right">BACH</th>
                  <th className="py-2 pr-3 text-right">MAS</th>
                  <th className="py-2 pr-3 text-right">DOC</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-default bg-accent-subtle">
                  <td className="py-2 pr-3 font-semibold text-accent-default">KKU (us)</td>
                  <td className="py-2 pr-3">TH</td>
                  <td className="py-2 pr-3 text-right font-mono text-xs">{data.kku.programCount}</td>
                  <td className="py-2 pr-3 text-right font-mono text-xs">{data.kku.levelDistribution.BACHELOR ?? 0}</td>
                  <td className="py-2 pr-3 text-right font-mono text-xs">{data.kku.levelDistribution.MASTER ?? 0}</td>
                  <td className="py-2 pr-3 text-right font-mono text-xs">{data.kku.levelDistribution.DOCTORAL ?? 0}</td>
                </tr>
                {data.peers.map((p) => (
                  <tr key={p.institution} className="border-b border-subtle last:border-0">
                    <td className="py-2 pr-3">{p.institution}</td>
                    <td className="py-2 pr-3 text-xs text-text-tertiary">{p.country}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{p.programCount}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{p.levelDistribution.BACHELOR ?? 0}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{p.levelDistribution.MASTER ?? 0}</td>
                    <td className="py-2 pr-3 text-right font-mono text-xs">{p.levelDistribution.DOCTORAL ?? 0}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <aside className="flex flex-col gap-3">
          <Card padding="md">
            <h3 className="mb-2 text-sm font-semibold text-text-primary">What they have, we don't</h3>
            {data.whatTheyHave.length === 0 ? (
              <p className="text-xs text-text-tertiary">Nothing surfaced above the threshold.</p>
            ) : (
              <ul className="space-y-1.5">
                {data.whatTheyHave.slice(0, 10).map((w) => (
                  <li key={w.subjectArea} className="flex items-center justify-between text-sm">
                    <span className="text-text-primary">{w.subjectArea}</span>
                    <Badge tone="danger">{w.peerCount} peers</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card padding="md">
            <h3 className="mb-2 text-sm font-semibold text-text-primary">What we have, they don't</h3>
            {data.whatWeHave.length === 0 ? (
              <p className="text-xs text-text-tertiary">
                Every KKU subject has at least one peer counterpart.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {data.whatWeHave.slice(0, 10).map((w) => (
                  <li key={w.subjectArea} className="flex items-center justify-between text-sm">
                    <span className="text-text-primary">{w.subjectArea}</span>
                    <Badge tone="success">{w.kkuProgramCount} KKU</Badge>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

function SubjectsPanel({
  data,
  subjectArea,
}: {
  data: SubjectLeadershipResponse | null;
  subjectArea: string;
}) {
  if (!data) return <EmptyState title="Subject leadership unavailable" />;
  return (
    <div className="flex flex-col gap-4">
      {data.lowConfidenceReason ? (
        <Card padding="sm">
          <p className="text-xs leading-relaxed text-text-secondary">
            ⚠ {data.lowConfidenceReason}
          </p>
        </Card>
      ) : null}

      <Card padding="md">
        <div className="flex items-baseline justify-between">
          <h3 className="text-sm font-semibold text-text-primary">Subject leadership — {subjectArea}</h3>
          <span className="text-xs text-text-tertiary">
            KKU latest percentile: {data.kkuPercentileLatest != null ? `${data.kkuPercentileLatest.toFixed(0)}` : 'n/a'}
          </span>
        </div>
        <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
          {Object.entries(data.trendsBySource).map(([source, trends]) => (
            <div key={source}>
              <h4 className="mb-2 text-xs uppercase tracking-wide text-text-tertiary">{source}</h4>
              <ul className="space-y-1.5 text-sm">
                {trends
                  .slice()
                  .sort((a, b) => (a.years.at(-1)?.rank ?? 9999) - (b.years.at(-1)?.rank ?? 9999))
                  .map((t) => (
                    <li key={t.institution} className="flex items-center justify-between">
                      <span className={`font-medium ${t.institution === 'KKU' ? 'text-accent-default' : 'text-text-primary'}`}>
                        {t.institution === 'KKU' ? 'KKU (us)' : t.institution}
                      </span>
                      <span className="flex items-center gap-2 font-mono text-xs">
                        <span className="text-text-secondary">#{t.years.at(-1)?.rank ?? '—'}</span>
                        <TrendBadge trend={t.trend} />
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function TrendBadge({ trend }: { trend: 'rising' | 'falling' | 'stable' }) {
  const colour = trend === 'rising' ? 'text-success' : trend === 'falling' ? 'text-danger' : 'text-text-tertiary';
  const label = trend === 'rising' ? '▲' : trend === 'falling' ? '▼' : '—';
  return <span className={colour}>{label}</span>;
}

function Selector({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string }>;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-text-secondary">
      <span className="uppercase tracking-wide">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-md border border-default bg-surface-1 px-2 py-1.5 text-sm text-text-primary"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function EmptyState({ title }: { title: string }) {
  return (
    <Card padding="lg">
      <div className="flex flex-col items-center py-8 text-center">
        <div className="text-sm font-semibold text-text-primary">{title}</div>
      </div>
    </Card>
  );
}
