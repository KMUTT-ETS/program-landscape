'use client';

// Consolidated 2026-05-07 — was previously two separate views (the
// staff_master_records-based /research and the FacultyMember-based
// /publications). Now driven from the kku-publications mirror exclusively
// (ResearchOutput rows attributed to active FacultyMember). Productivity-
// by-rank breakdown ported over from the old /research view, scoped to
// kku-hr-sourced rows so rank=LECTURER placeholders on kkupub_-backfilled
// rows don't skew the averages.

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { Card } from '@kku/ui';
import { MultiSelectField } from '../multi-select';
import { DrillDownPivot, type DrillRow } from '../drill-down-pivot';
import type {
  FilterOptions,
  ResearchAuthor,
  ResearchByRankRow,
  ResearchResponse,
} from '../types';

interface Props {
  data: ResearchResponse;
  options: FilterOptions;
  initialFilters: {
    facultyName: string[];
    sources: string[];
    yearFrom?: number;
  };
}

const SOURCE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'kku-publications:scopus', label: 'Scopus' },
  { value: 'kku-publications:pubmed', label: 'PubMed' },
];

const TYPE_LABELS: Record<string, string> = {
  JOURNAL: 'Journal article',
  CONFERENCE: 'Conference paper',
  BOOK: 'Book chapter',
  PATENT: 'Patent',
};

const SOURCE_LABELS: Record<string, string> = {
  'kku-publications:scopus': 'Scopus',
  'kku-publications:pubmed': 'PubMed',
  openalex: 'OpenAlex (legacy)',
};

export function ResearchClient({ data, options, initialFilters }: Props) {
  const router = useRouter();
  const [faculty, setFaculty] = React.useState<string[]>(initialFilters.facultyName);
  const [sources, setSources] = React.useState<string[]>(initialFilters.sources);
  const [yearFrom, setYearFrom] = React.useState<number | undefined>(initialFilters.yearFrom);

  const apply = (next: Partial<typeof initialFilters>) => {
    const params = new URLSearchParams();
    (next.facultyName ?? faculty).forEach((v) => params.append('facultyName', v));
    (next.sources ?? sources).forEach((v) => params.append('sources', v));
    const yf = next.yearFrom ?? yearFrom;
    if (yf) params.set('yearFrom', String(yf));
    router.push(`/staff/research${params.toString() ? `?${params}` : ''}`);
  };

  // Drill rows: Faculty → Author
  const facultyAuthor = React.useMemo(() => {
    const facMap = new Map<string, ResearchAuthor[]>();
    for (const a of data.perAuthor) {
      const fname = a.facultyName ?? '(unmapped)';
      const list = facMap.get(fname) ?? [];
      list.push(a);
      facMap.set(fname, list);
    }
    const rows: DrillRow[] = [...facMap.entries()].map(([fname, authors]) => {
      const totalPapers = authors.reduce((a, b) => a + b.papers, 0);
      const totalCites = authors.reduce((a, b) => a + b.citations, 0);
      const maxH = authors.reduce((a, b) => Math.max(a, b.hIndex), 0);
      return {
        label: fname,
        metrics: {
          authors: authors.length,
          papers: totalPapers,
          citations: totalCites,
          hIndex: maxH,
        },
        children: authors
          .sort((a, b) => b.papers - a.papers)
          .map((a) => ({
            label: authorDisplay(a),
            metrics: {
              authors: 1,
              papers: a.papers,
              citations: a.citations,
              hIndex: a.hIndex,
            },
          })),
      };
    });
    return rows.sort((a, b) => (b.metrics.papers ?? 0) - (a.metrics.papers ?? 0));
  }, [data.perAuthor]);

  // Heatmap viewport — last 10 years for legibility
  const yearAxis = React.useMemo(() => {
    const all = new Set<number>();
    for (const f of data.heatmap) for (const y of f.years) all.add(y.year);
    const sorted = [...all].sort((a, b) => b - a).slice(0, 10).reverse();
    return sorted;
  }, [data.heatmap]);

  // Per-cell max for heatmap intensity
  const heatmapMax = React.useMemo(() => {
    let m = 1;
    for (const r of data.heatmap)
      for (const y of r.years) if (yearAxis.includes(y.year) && y.papers > m) m = y.papers;
    return m;
  }, [data.heatmap, yearAxis]);

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
              apply({ facultyName: vs });
            }}
          />
          <MultiSelectField
            label="Source"
            options={SOURCE_OPTIONS}
            selected={sources}
            onChange={(vs) => {
              setSources(vs);
              apply({ sources: vs });
            }}
          />
          <div className="flex flex-col gap-0.5">
            <label className="text-[0.65rem] font-medium uppercase tracking-wide text-text-tertiary whitespace-nowrap">
              From year
            </label>
            <input
              type="number"
              min={1900}
              max={2100}
              className="w-28 rounded border border-border-subtle bg-surface-1 px-2 py-1.5 text-sm font-tabular tabular-nums"
              defaultValue={yearFrom ?? data.yearFrom}
              onBlur={(e) => {
                const v = e.target.value ? Number(e.target.value) : undefined;
                if (v !== yearFrom) {
                  setYearFrom(v);
                  apply({ yearFrom: v });
                }
              }}
            />
          </div>
          {(faculty.length > 0 || sources.length > 0 || yearFrom) && (
            <button
              className="rounded border border-border-subtle bg-surface-1 px-3 py-1 text-xs text-text-secondary hover:bg-surface-2"
              onClick={() => {
                setFaculty([]);
                setSources([]);
                setYearFrom(undefined);
                router.push('/staff/research');
              }}
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto text-xs text-text-tertiary">
            Active staff only · window {data.yearFrom}–{data.yearTo} · {data.totalStaff.toLocaleString('en-US')} staff (
            {data.publishingStaff.toLocaleString('en-US')} publishing)
          </span>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
        <Kpi label="Papers" value={data.totalPapers.toLocaleString('en-US')} sub={`${pct(data.publishingStaff, data.totalStaff)} of active staff publishing`} />
        <Kpi label="Citations (Scopus)" value={data.totalCitations.toLocaleString('en-US')} sub="PubMed citations not in mirror" />
        <Kpi label="Active staff" value={data.totalStaff.toLocaleString('en-US')} sub={`${data.publishingStaff.toLocaleString('en-US')} have published`} />
        <Kpi
          label="Avg papers per publishing author"
          value={data.publishingStaff > 0 ? (data.totalPapers / data.publishingStaff).toFixed(1) : '—'}
          sub={`window ${data.yearFrom}–${data.yearTo}`}
        />
      </div>

      {/* Year trend + Source/Type breakdowns */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="text-sm font-semibold">Papers per year</h3>
          <p className="mt-1 text-xs text-text-tertiary">
            Window {data.yearFrom}–{data.yearTo}. {data.byYear.length} years observed.
          </p>
          <YearTrend data={data.byYear} />
        </Card>

        <div className="flex flex-col gap-3">
          <Card>
            <h3 className="text-sm font-semibold">Sources</h3>
            <BreakdownBars
              data={Object.entries(data.bySource)
                .map(([k, v]) => ({ label: SOURCE_LABELS[k] ?? k, count: v }))
                .sort((a, b) => b.count - a.count)}
              total={data.totalPapers}
            />
          </Card>
          <Card>
            <h3 className="text-sm font-semibold">Output types</h3>
            <BreakdownBars
              data={Object.entries(data.byType)
                .map(([k, v]) => ({ label: TYPE_LABELS[k] ?? k, count: v }))
                .sort((a, b) => b.count - a.count)}
              total={data.totalPapers}
            />
          </Card>
        </div>
      </div>

      {/* Productivity by academic rank — kku-hr-sourced staff only */}
      <Card>
        <h3 className="text-sm font-semibold">Productivity by academic rank</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Average papers and citations per person, by rank — plus the highest h-index in each tier. h-index = an author has h papers each cited at least h times.
          <span className="ml-1">
            Restricted to kku-hr-sourced staff ({data.byRank.reduce((s, r) => s + r.staffCount, 0).toLocaleString('en-US')} of {data.totalStaff.toLocaleString('en-US')}); kkupub_-backfilled rows are excluded because the publications mirror doesn't carry rank.
          </span>
        </p>
        <RankProductivityChart rows={data.byRank} />
      </Card>

      {/* Faculty × Year heatmap */}
      <Card>
        <h3 className="text-sm font-semibold">Faculty output by year</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Cell = papers in that (faculty × year) for active employees. Last 10 years shown. Click a faculty row to filter the page.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-sm border-separate" style={{ borderSpacing: 0 }}>
            <thead>
              <tr>
                <th className="px-3 py-2.5 text-left text-[0.7rem] uppercase tracking-wide text-text-tertiary font-medium border-b border-border-subtle min-w-[18rem]">
                  Faculty
                </th>
                {yearAxis.map((y) => (
                  <th
                    key={y}
                    className="px-2 py-2.5 text-center text-[0.7rem] uppercase tracking-wide text-text-tertiary font-medium border-b border-border-subtle min-w-[3.5rem]"
                  >
                    {y}
                  </th>
                ))}
                <th className="px-3 py-2.5 text-right text-[0.7rem] uppercase tracking-wide text-text-tertiary font-medium border-b border-border-subtle min-w-[5rem]">
                  Total
                </th>
              </tr>
            </thead>
            <tbody>
              {data.heatmap.slice(0, 20).map((r) => {
                const total = r.years.reduce((s, y) => s + y.papers, 0);
                const yearMap = new Map(r.years.map((y) => [y.year, y.papers]));
                return (
                  <tr
                    key={r.facultyName}
                    className="cursor-pointer hover:bg-surface-2 transition-colors"
                    onClick={() => {
                      setFaculty([r.facultyName]);
                      apply({ facultyName: [r.facultyName] });
                    }}
                  >
                    <td
                      className="px-3 py-2.5 truncate border-b border-border-subtle"
                      style={{ maxWidth: '20rem' }}
                      title={r.facultyName}
                    >
                      {r.facultyName}
                    </td>
                    {yearAxis.map((y) => {
                      const n = yearMap.get(y) ?? 0;
                      const intensity = n > 0 ? Math.max(0.12, n / heatmapMax) : 0;
                      return (
                        <td
                          key={y}
                          className="px-2 py-2.5 text-center font-tabular tabular-nums border-b border-border-subtle"
                          style={{ background: n > 0 ? `rgba(14, 165, 233, ${intensity})` : 'transparent' }}
                        >
                          {n > 0 ? n.toLocaleString('en-US') : <span className="text-text-tertiary">·</span>}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5 text-right font-tabular font-semibold border-b border-border-subtle">
                      {total.toLocaleString('en-US')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Top 30 authors */}
      <Card>
        <h3 className="text-sm font-semibold">Top 30 authors by paper count</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Active employees only. h-index computed across the {data.yearFrom}–{data.yearTo} window only.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[0.65rem] uppercase tracking-wide text-text-tertiary">
                <th className="px-2 py-1 text-left font-medium">#</th>
                <th className="px-2 py-1 text-left font-medium">Author</th>
                <th className="px-2 py-1 text-left font-medium">Faculty</th>
                <th className="px-2 py-1 text-right font-medium">Papers</th>
                <th className="px-2 py-1 text-right font-medium">Citations</th>
                <th className="px-2 py-1 text-right font-medium">h-index</th>
                <th className="px-2 py-1 text-left font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {data.topAuthors.map((a, i) => (
                <tr key={a.fmId} className="border-t border-border-subtle">
                  <td className="px-2 py-1 text-text-tertiary">{i + 1}</td>
                  <td className="px-2 py-1">{authorDisplay(a)}</td>
                  <td className="px-2 py-1 text-text-secondary">{a.facultyName ?? '—'}</td>
                  <td className="px-2 py-1 text-right font-tabular font-semibold">{a.papers.toLocaleString('en-US')}</td>
                  <td className="px-2 py-1 text-right font-tabular">{a.citations.toLocaleString('en-US')}</td>
                  <td className="px-2 py-1 text-right font-tabular">{a.hIndex}</td>
                  <td className="px-2 py-1 text-text-tertiary">
                    {a.employeeSource === 'kku-hr' ? 'HR' : a.employeeSource === 'kku-publications' ? 'Publications' : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Top 15 venues */}
      <Card>
        <h3 className="text-sm font-semibold">Top venues</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Top 15 journals / conferences by KKU paper count. Bar length is proportional to the leader.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-1.5 text-xs">
          {data.topVenues.map((v) => {
            const max = data.topVenues[0]?.papers ?? 1;
            const w = (v.papers / max) * 100;
            return (
              <div
                key={v.venue}
                className="grid grid-cols-[minmax(0,22rem)_1fr_4rem] gap-3 items-center"
              >
                <span className="truncate text-text-secondary" title={v.venue}>{v.venue}</span>
                <div className="h-2.5 rounded-sm" style={{ background: 'rgba(120,120,120,0.18)' }}>
                  <div className="h-full rounded-sm" style={{ width: `${w}%`, background: '#0ea5e9' }} />
                </div>
                <span className="text-right font-tabular font-semibold">{v.papers.toLocaleString('en-US')}</span>
              </div>
            );
          })}
        </div>
      </Card>

      {/* Drill-down: Faculty → Author */}
      <Card>
        <h3 className="text-sm font-semibold">Faculty → Author drill-down</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Click a faculty row to expand to its authors. Click any column header to sort.
        </p>
        <div className="mt-3">
          <DrillDownPivot
            rowHeaderLabel="Faculty / Author"
            maxDepth={2}
            rows={facultyAuthor}
            columns={[
              { key: 'authors', label: 'Authors', format: 'int' },
              { key: 'papers', label: 'Papers', format: 'int' },
              { key: 'citations', label: 'Citations', format: 'int' },
              { key: 'hIndex', label: 'h-index', format: 'int' },
            ]}
          />
        </div>
      </Card>

      {/* Provenance / caveats */}
      <Card>
        <div className="text-xs text-text-secondary space-y-1">
          <div>
            <strong className="text-text-primary">Source:</strong> internal kku-publications mirror at 10.130.2.151 (<code>kku-research</code> connector v2). Curator-grade KKU author resolution via <code>{'<source>_authors.person_id'}</code> → <code>people.id</code> → <code>faculty_id</code>.
          </div>
          <div>
            <strong className="text-text-primary">Staff coverage:</strong> {data.employeeSourceMix.kkuHr.toLocaleString('en-US')} from kku-hr (employed staff with citizen-id-hash) + {data.employeeSourceMix.kkuPublications.toLocaleString('en-US')} backfilled from kku-publications.people (employee_code prefix <code>kkupub_</code>).
          </div>
          {data.caveats.map((c, i) => (
            <div key={i}>
              <strong className="text-text-primary">Caveat:</strong> {c}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function authorDisplay(a: ResearchAuthor): string {
  return a.nameEn?.trim() || a.nameTh?.trim() || '(unnamed)';
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

function BreakdownBars({ data, total }: { data: Array<{ label: string; count: number }>; total: number }) {
  if (data.length === 0) return <div className="mt-2 text-xs text-text-tertiary">No data.</div>;
  return (
    <div className="mt-2 grid grid-cols-1 gap-1.5 text-xs">
      {data.map((d) => {
        const w = (d.count / total) * 100;
        return (
          <div key={d.label} className="grid grid-cols-[10rem_1fr_4rem_3rem] gap-2 items-center">
            <span className="truncate text-text-secondary" title={d.label}>{d.label}</span>
            <div className="h-2.5 rounded-sm" style={{ background: 'rgba(120,120,120,0.18)' }}>
              <div className="h-full rounded-sm" style={{ width: `${w}%`, background: '#0ea5e9' }} />
            </div>
            <span className="text-right font-tabular font-semibold">{d.count.toLocaleString('en-US')}</span>
            <span className="text-right text-text-tertiary">{w.toFixed(1)}%</span>
          </div>
        );
      })}
    </div>
  );
}

// Two-bar-per-rank productivity chart. Avg papers/staff (top bar) +
// avg citations/staff (bottom bar) per rank tier, plus people / avg-pubs
// / best-h text columns. Ported from the legacy /research view.
function RankProductivityChart({ rows }: { rows: ResearchByRankRow[] }) {
  const visibleRows = rows.filter((r) => r.staffCount > 0);
  if (visibleRows.length === 0) {
    return <div className="mt-3 text-xs text-text-tertiary">No data.</div>;
  }
  const maxAvgPapers = Math.max(...visibleRows.map((r) => r.avgPapersPerStaff), 1);
  const maxAvgCites = Math.max(...visibleRows.map((r) => r.avgCitesPerStaff), 1);
  return (
    <div className="mt-3 grid grid-cols-1 gap-2 text-xs">
      <div className="grid grid-cols-[12rem_1fr_5rem_5rem_5rem] gap-x-3 text-[0.65rem] uppercase tracking-wide text-text-tertiary">
        <span>Rank</span>
        <span>Avg papers / avg citations per person</span>
        <span className="text-right">People</span>
        <span className="text-right">Avg papers</span>
        <span className="text-right">Best h</span>
      </div>
      {visibleRows.map((r) => {
        const pubsPct = (r.avgPapersPerStaff / maxAvgPapers) * 100;
        const citesPct = (r.avgCitesPerStaff / maxAvgCites) * 100;
        return (
          <div
            key={r.rank}
            className="grid grid-cols-[12rem_1fr_5rem_5rem_5rem] gap-x-3 items-center"
          >
            <span className="truncate" title={r.rankLabel}>{r.rankLabel}</span>
            <div className="flex flex-col gap-0.5">
              <div className="h-2.5 rounded-sm" style={{ background: 'rgba(120,120,120,0.18)' }}>
                <div className="h-full" style={{ width: `${pubsPct}%`, background: '#0ea5e9' }} title={`${r.avgPapersPerStaff.toFixed(1)} papers/staff`} />
              </div>
              <div className="h-2.5 rounded-sm" style={{ background: 'rgba(120,120,120,0.18)' }}>
                <div className="h-full" style={{ width: `${citesPct}%`, background: '#8b5cf6' }} title={`${r.avgCitesPerStaff.toFixed(1)} citations/staff`} />
              </div>
            </div>
            <span className="text-right font-tabular">{r.staffCount.toLocaleString('en-US')}</span>
            <span className="text-right font-tabular font-semibold">{r.avgPapersPerStaff.toFixed(1)}</span>
            <span className="text-right font-tabular">{r.maxHIndex}</span>
          </div>
        );
      })}
      <div className="mt-1 flex gap-3 text-[0.65rem] text-text-tertiary">
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: '#0ea5e9' }} /> Average papers per person</span>
        <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-3 rounded-sm" style={{ background: '#8b5cf6' }} /> Average citations per person</span>
      </div>
    </div>
  );
}

// Lightweight inline-SVG year-trend chart. Y-axis = paper count, X-axis = year.
function YearTrend({ data }: { data: Array<{ year: number; papers: number }> }) {
  if (data.length === 0) return <div className="mt-2 text-xs text-text-tertiary">No data.</div>;
  const w = 600;
  const h = 160;
  const pad = { left: 35, right: 8, top: 12, bottom: 24 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;
  const xs = data.map((d) => d.year);
  const ys = data.map((d) => d.papers);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...ys, 1);
  const x = (year: number): number =>
    pad.left + ((year - minX) / Math.max(1, maxX - minX)) * innerW;
  const y = (papers: number): number => pad.top + innerH - (papers / maxY) * innerH;
  const points = data.map((d) => `${x(d.year)},${y(d.papers)}`).join(' ');
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxY * f));
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 w-full h-auto" role="img" aria-label="Papers per year">
      {yTicks.map((t) => (
        <g key={t}>
          <line
            x1={pad.left}
            y1={y(t)}
            x2={w - pad.right}
            y2={y(t)}
            stroke="rgba(120,120,120,0.2)"
            strokeDasharray={t === 0 ? '0' : '2,2'}
          />
          <text x={pad.left - 4} y={y(t) + 3} fontSize="9" fill="rgb(120,120,120)" textAnchor="end">
            {t.toLocaleString('en-US')}
          </text>
        </g>
      ))}
      <polyline points={points} fill="none" stroke="#0ea5e9" strokeWidth="2" />
      {data.map((d) => (
        <g key={d.year}>
          <circle cx={x(d.year)} cy={y(d.papers)} r="2.5" fill="#0ea5e9" />
          <title>{`${d.year}: ${d.papers}`}</title>
        </g>
      ))}
      {data.map((d, i) => (
        <text
          key={d.year}
          x={x(d.year)}
          y={h - 8}
          fontSize="9"
          fill="rgb(120,120,120)"
          textAnchor="middle"
          style={{ display: i % Math.max(1, Math.floor(data.length / 8)) === 0 ? undefined : 'none' }}
        >
          {String(d.year).slice(2)}
        </text>
      ))}
    </svg>
  );
}
