'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@kku/ui';
import { MultiSelectField } from '../multi-select';
import { DrillDownPivot, type DrillRow } from '../drill-down-pivot';
import type { FilterOptions, ResearchAuthor, ResearchResponse } from '../types';

interface Props {
  data: ResearchResponse;
  options: FilterOptions;
  initialFilters: { facultyName: string[]; academicStandingId: string[] };
}

export function ResearchClient({ data, options, initialFilters }: Props) {
  const router = useRouter();
  const [faculty, setFaculty] = React.useState<string[]>(initialFilters.facultyName);
  const [rank, setRank] = React.useState<string[]>(initialFilters.academicStandingId);

  const apply = (next: { faculty?: string[]; rank?: string[] }) => {
    const params = new URLSearchParams();
    (next.faculty ?? faculty).forEach((v) => params.append('facultyName', v));
    (next.rank ?? rank).forEach((v) => params.append('academicStandingId', v));
    router.push(`/staff/research${params.toString() ? `?${params}` : ''}`);
  };

  // Build Faculty → Author drill-down
  const byFaculty = new Map<string, ResearchAuthor[]>();
  for (const a of data.perAuthor) {
    if (!a.facultyName) continue;
    const list = byFaculty.get(a.facultyName) ?? [];
    list.push(a);
    byFaculty.set(a.facultyName, list);
  }
  const drillRows: DrillRow[] = [...byFaculty.entries()]
    .map(([facName, authors]): DrillRow => {
      const totalPubs = authors.reduce((a, x) => a + x.publications, 0);
      const totalCites = authors.reduce((a, x) => a + x.citations, 0);
      const maxH = authors.reduce((a, x) => Math.max(a, x.hIndex), 0);
      return {
        label: facName,
        metrics: {
          authors: authors.length,
          publications: totalPubs,
          citations: totalCites,
          hIndex: maxH,
        },
        children: authors
          .sort((a, b) => b.publications - a.publications)
          .map((a) => ({
            label: `${a.nameTh ?? '—'} · ${a.rank}`,
            metrics: {
              authors: 1,
              publications: a.publications,
              citations: a.citations,
              hIndex: a.hIndex,
            },
          })),
      };
    })
    .sort((a, b) => (b.metrics.publications ?? 0) - (a.metrics.publications ?? 0));

  // Rank chart
  const rankRows = data.byRank.filter((r) => r.staffCount > 0);
  const maxAvgPubs = Math.max(...rankRows.map((r) => r.avgPubsPerStaff), 1);
  const maxAvgCites = Math.max(...rankRows.map((r) => r.avgCitesPerStaff), 1);

  return (
    <div className="flex flex-col gap-4">
      {/* Filter rail */}
      <Card>
        <div className="flex flex-wrap items-end gap-3">
          <MultiSelectField
            label="Faculty"
            options={options.faculties.map((f) => ({ value: f, label: f }))}
            selected={faculty}
            onChange={(vs) => {
              setFaculty(vs);
              apply({ faculty: vs });
            }}
          />
          <MultiSelectField
            label="Academic rank"
            options={options.academicStandings.map((s) => ({ value: s.id, label: s.label }))}
            selected={rank}
            onChange={(vs) => {
              setRank(vs);
              apply({ rank: vs });
            }}
            preserveOrder
          />
          {(faculty.length > 0 || rank.length > 0) && (
            <button
              className="rounded border border-border-subtle bg-surface-1 px-3 py-1 text-xs text-text-secondary hover:bg-surface-2"
              onClick={() => {
                setFaculty([]);
                setRank([]);
                router.push('/staff/research');
              }}
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto text-xs text-text-tertiary">
            {data.facultyTotal.toLocaleString('en-US')} academic staff · {data.authorsWithPubs.toLocaleString('en-US')} have published in this window
          </span>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Kpi label="Academic staff" value={data.facultyTotal.toLocaleString('en-US')} />
        <Kpi label="Have published" value={data.authorsWithPubs.toLocaleString('en-US')} sub={`${pct(data.authorsWithPubs, data.facultyTotal)} of academic staff`} />
        <Kpi label="Publications (5 yrs)" value={data.totalPubs.toLocaleString('en-US')} />
        <Kpi label="Citations" value={data.totalCitations.toLocaleString('en-US')} />
      </div>

      {/* Productivity by rank — bar chart */}
      <Card>
        <h3 className="text-sm font-semibold">Productivity by academic rank</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Average papers and citations per person, by rank — plus the highest h-index in each tier. h-index = an author has h papers each cited at least h times.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-1.5 text-xs">
          <div className="grid grid-cols-[12rem_1fr_5rem_5rem_5rem] gap-x-3 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
            <span>Rank</span>
            <span>Avg papers / avg citations per person</span>
            <span className="text-right">People</span>
            <span className="text-right">Avg papers</span>
            <span className="text-right">Best h</span>
          </div>
          {rankRows.map((r) => {
            const pubsPct = (r.avgPubsPerStaff / maxAvgPubs) * 100;
            const citesPct = (r.avgCitesPerStaff / maxAvgCites) * 100;
            return (
              <div
                key={r.rank}
                className="grid grid-cols-[12rem_1fr_5rem_5rem_5rem] gap-x-3 items-center"
              >
                <span className="truncate" title={r.rank}>{r.rank}</span>
                <div className="flex flex-col gap-0.5">
                  <div className="h-2.5 rounded-sm" style={{ background: 'rgba(120,120,120,0.18)' }}>
                    <div className="h-full" style={{ width: `${pubsPct}%`, background: '#0ea5e9' }} title={`${r.avgPubsPerStaff.toFixed(1)} pubs/staff`} />
                  </div>
                  <div className="h-2.5 rounded-sm" style={{ background: 'rgba(120,120,120,0.18)' }}>
                    <div className="h-full" style={{ width: `${citesPct}%`, background: '#8b5cf6' }} title={`${r.avgCitesPerStaff.toFixed(1)} citations/staff`} />
                  </div>
                </div>
                <span className="text-right font-tabular">{r.staffCount.toLocaleString('en-US')}</span>
                <span className="text-right font-tabular font-semibold">{r.avgPubsPerStaff.toFixed(1)}</span>
                <span className="text-right font-tabular">{r.maxHIndex}</span>
              </div>
            );
          })}
          <div className="mt-1 flex gap-3 text-[0.65rem] text-text-tertiary">
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: '#0ea5e9' }} /> Average papers per person</span>
            <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: '#8b5cf6' }} /> Average citations per person</span>
          </div>
        </div>
      </Card>

      {/* Drill-down producers */}
      <Card>
        <h3 className="text-sm font-semibold">Who's published</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Click a faculty row to see its authors. Click any column header to sort.
        </p>
        <div className="mt-3">
          <DrillDownPivot
            rowHeaderLabel="Faculty / author"
            maxDepth={2}
            rows={drillRows}
            columns={[
              { key: 'authors', label: 'Authors', format: 'int' },
              { key: 'publications', label: 'Papers', format: 'int' },
              { key: 'citations', label: 'Citations', format: 'int' },
              { key: 'hIndex', label: 'h-index', format: 'int' },
            ]}
          />
        </div>
      </Card>

      {/* ORCID coverage caveat */}
      <Card>
        <div className="text-xs text-text-tertiary">
          <strong className="text-text-primary">Coverage caveat:</strong>{' '}
          {data.orcidCoverage.withOrcid.toLocaleString('en-US')} of {data.orcidCoverage.total.toLocaleString('en-US')} academic staff
          ({pct(data.orcidCoverage.withOrcid, data.orcidCoverage.total)}) have a unique researcher ID linked. Authors without one may have papers we couldn't match to them automatically.
        </div>
      </Card>
    </div>
  );
}

function pct(part: number, total: number): string {
  if (!total) return '—';
  return ((part / total) * 100).toFixed(1) + '%';
}
function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Card>
      <div className="text-xs text-text-tertiary">{label}</div>
      <div className="mt-1 font-tabular text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-text-tertiary">{sub}</div>}
    </Card>
  );
}
