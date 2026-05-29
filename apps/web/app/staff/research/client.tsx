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
import { Card, useSortableTable, SortableTh } from '@kku/ui';
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
    yearExact?: number;
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
  const [yearExact, setYearExact] = React.useState<number | undefined>(initialFilters.yearExact);

  const apply = (next: Partial<typeof initialFilters>) => {
    const params = new URLSearchParams();
    (next.facultyName ?? faculty).forEach((v) => params.append('facultyName', v));
    (next.sources ?? sources).forEach((v) => params.append('sources', v));
    // yearExact wins over yearFrom; whichever is set goes on the URL.
    // Treat an explicit `undefined` in `next` as "clear it" (don't fall
    // back to local state) so toggling between the two modes works.
    const yx = 'yearExact' in next ? next.yearExact : yearExact;
    const yf = 'yearFrom' in next ? next.yearFrom : yearFrom;
    if (yx) {
      params.set('yearExact', String(yx));
    } else if (yf) {
      params.set('yearFrom', String(yf));
    }
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

  // Top 30 authors — sortable headers.
  const { sorted: sortedTopAuthors, sort: topAuthorsSort } = useSortableTable(
    data.topAuthors ?? [],
    {
      author: (a) => authorDisplay(a),
      faculty: (a) => a.facultyName ?? '',
      papers: (a) => a.papers,
      citations: (a) => a.citations,
      hIndex: (a) => a.hIndex,
      status: (a) => (a.isActive ? 'Active' : 'Former'),
    },
  );

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
              {yearExact !== undefined && (
                <span className="ml-1 normal-case tracking-normal text-text-tertiary">
                  (disabled — exact year set)
                </span>
              )}
            </label>
            <input
              type="number"
              min={1900}
              max={2100}
              disabled={yearExact !== undefined}
              className="w-28 rounded border border-border-subtle bg-surface-1 px-2 py-1.5 text-sm font-tabular tabular-nums disabled:opacity-50"
              defaultValue={yearFrom ?? data.yearFrom}
              onBlur={(e) => {
                if (yearExact !== undefined) return; // ignore when exact-year is active
                const v = e.target.value ? Number(e.target.value) : undefined;
                if (v !== yearFrom) {
                  setYearFrom(v);
                  apply({ yearFrom: v });
                }
              }}
            />
          </div>
          <div className="flex flex-col gap-0.5">
            <label className="text-[0.65rem] font-medium uppercase tracking-wide text-text-tertiary whitespace-nowrap">
              Exact year
            </label>
            <input
              type="number"
              min={1900}
              max={2100}
              placeholder="e.g. 2024"
              className="w-28 rounded border border-border-subtle bg-surface-1 px-2 py-1.5 text-sm font-tabular tabular-nums"
              defaultValue={yearExact ?? ''}
              key={yearExact ?? 'empty'}
              onBlur={(e) => {
                const v = e.target.value ? Number(e.target.value) : undefined;
                if (v !== yearExact) {
                  setYearExact(v);
                  // Switching to/from exact-year mode; pass both keys
                  // so apply() knows to use the new value.
                  apply({ yearExact: v });
                }
              }}
            />
          </div>
          {(faculty.length > 0 || sources.length > 0 || yearFrom || yearExact) && (
            <button
              className="rounded border border-border-subtle bg-surface-1 px-3 py-1 text-xs text-text-secondary hover:bg-surface-2"
              onClick={() => {
                setFaculty([]);
                setSources([]);
                setYearFrom(undefined);
                setYearExact(undefined);
                router.push('/staff/research');
              }}
            >
              Clear filters
            </button>
          )}
          <span className="ml-auto text-xs text-text-tertiary">
            All staff (incl. retired) ·{' '}
            {data.yearExact !== null
              ? `year ${data.yearExact}`
              : `window ${data.yearFrom}–${data.yearTo}`}{' '}
            · {data.totalStaff.toLocaleString('en-US')} staff ({data.publishingStaff.toLocaleString('en-US')} publishing,{' '}
            {data.activeStaff.toLocaleString('en-US')} active)
          </span>
        </div>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Kpi label="Papers" value={data.totalPapers.toLocaleString('en-US')} sub={`${pct(data.publishingStaff, data.totalStaff)} of staff have published`} />
        <Kpi label="Citations (Scopus)" value={data.totalCitations.toLocaleString('en-US')} sub="PubMed citations not in mirror" />
        <Kpi label="All staff (incl. retired)" value={data.totalStaff.toLocaleString('en-US')} sub={`${data.publishingStaff.toLocaleString('en-US')} have published`} />
        <Kpi
          label="Avg papers per publishing author"
          value={data.publishingStaff > 0 ? (data.totalPapers / data.publishingStaff).toFixed(1) : '—'}
          sub={data.yearExact !== null ? `year ${data.yearExact}` : `window ${data.yearFrom}–${data.yearTo}`}
        />
        <Kpi
          label="Papers per active faculty"
          value={data.activeStaff > 0 ? (data.totalPapers / data.activeStaff).toFixed(2) : '—'}
          sub={`${data.activeStaff.toLocaleString('en-US')} active faculty (from /staff/workforce)`}
        />
      </div>

      {/* Journal quartile (Scopus CiteScore) */}
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-semibold">Journal quartile · Scopus CiteScore</h3>
          <span className="text-xs text-text-tertiary">
            {data.byQuartile.rated.toLocaleString('en-US')} rated ·{' '}
            {data.byQuartile.unrated.toLocaleString('en-US')} unrated (PubMed / no CiteScore)
          </span>
        </div>
        <p className="mt-1 text-xs text-text-tertiary">
          Best quartile across the journal&apos;s subject areas for each paper&apos;s year (Q1 = top 25%). Distinct papers; Q1 share is against rated papers only.
        </p>
        <QuartileMix byQuartile={data.byQuartile} byYear={data.quartileByYear} />
      </Card>

      {/* Year trend + Source/Type breakdowns */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h3 className="text-sm font-semibold">Papers per year, by source</h3>
          <p className="mt-1 text-xs text-text-tertiary">
            Window {data.yearFrom}–{data.yearTo}. {data.byYear.length} years observed. The Scopus line drops sharply after 2021 — that's a KKU Library curator backlog, not a publication-rate decline (see Caveats below).
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
          Cell = papers in that (faculty × year) — all staff including retired. Last 10 years shown. Click a faculty row to filter the page.
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
          All staff including retired/formerly-affiliated. h-index computed across the {data.yearFrom}–{data.yearTo} window only.
        </p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[0.65rem] uppercase tracking-wide text-text-tertiary">
                <th className="px-2 py-1 text-left font-medium">#</th>
                <SortableTh sortKey="author" sort={topAuthorsSort} className="px-2 py-1 text-left font-medium">Author</SortableTh>
                <SortableTh sortKey="faculty" sort={topAuthorsSort} className="px-2 py-1 text-left font-medium">Faculty</SortableTh>
                <SortableTh sortKey="papers" sort={topAuthorsSort} align="right" className="px-2 py-1 text-right font-medium">Papers</SortableTh>
                <SortableTh sortKey="citations" sort={topAuthorsSort} align="right" className="px-2 py-1 text-right font-medium">Citations</SortableTh>
                <SortableTh sortKey="hIndex" sort={topAuthorsSort} align="right" className="px-2 py-1 text-right font-medium">h-index</SortableTh>
                <SortableTh sortKey="status" sort={topAuthorsSort} className="px-2 py-1 text-left font-medium">Status</SortableTh>
              </tr>
            </thead>
            <tbody>
              {sortedTopAuthors.map((a, i) => (
                <tr key={a.fmId} className="border-t border-border-subtle">
                  <td className="px-2 py-1 text-text-tertiary">{i + 1}</td>
                  <td className="px-2 py-1">{authorDisplay(a)}</td>
                  <td className="px-2 py-1 text-text-secondary">{a.facultyName ?? '—'}</td>
                  <td className="px-2 py-1 text-right font-tabular font-semibold">{a.papers.toLocaleString('en-US')}</td>
                  <td className="px-2 py-1 text-right font-tabular">{a.citations.toLocaleString('en-US')}</td>
                  <td className="px-2 py-1 text-right font-tabular">{a.hIndex}</td>
                  <td className="px-2 py-1">
                    <span className={a.isActive ? 'text-success' : 'text-text-tertiary'}>
                      {a.isActive ? 'Active' : 'Former'}
                    </span>
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
        <div className="mt-3 flex flex-col gap-1.5 text-xs">
          {data.topVenues.map((v) => {
            const max = data.topVenues[0]?.papers ?? 1;
            const w = Math.max(2, (v.papers / max) * 100);
            return (
              <div
                key={v.venue}
                style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}
              >
                <span
                  className="text-text-secondary"
                  style={{
                    width: '20rem',
                    flexShrink: 0,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={v.venue}
                >
                  {v.venue}
                </span>
                <div
                  style={{
                    flex: '1 1 0%',
                    minWidth: 0,
                    height: '10px',
                    borderRadius: '2px',
                    background: 'rgba(120,120,120,0.18)',
                  }}
                >
                  <div
                    style={{
                      width: `${w}%`,
                      height: '100%',
                      borderRadius: '2px',
                      background: '#0ea5e9',
                    }}
                  />
                </div>
                <span
                  style={{
                    width: '4rem',
                    flexShrink: 0,
                    textAlign: 'right',
                    fontWeight: 600,
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {v.papers.toLocaleString('en-US')}
                </span>
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
            <strong className="text-text-primary">Staff coverage:</strong> {data.activeFormerSplit.active.toLocaleString('en-US')} active + {data.activeFormerSplit.former.toLocaleString('en-US')} former staff. Of publishing authors: {data.activeFormerSplit.activePublishing.toLocaleString('en-US')} active, {data.activeFormerSplit.formerPublishing.toLocaleString('en-US')} former. "Former" means not currently employed at KKU per HR records (or no paper in last 2 years for publication-only entries).
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

// Quartile mix — headline Q1 share + a single stacked bar over rated
// papers (Q1→Q4, green→red) + a per-year stacked-bar trend. Colours are
// design tokens (lint-safe), semantically ramped: Q1 positive, Q2 info,
// Q3 warning, Q4 danger.
const QUARTILE_SEGMENTS = [
  { key: 'q1' as const, label: 'Q1', cls: 'bg-positive' },
  { key: 'q2' as const, label: 'Q2', cls: 'bg-info' },
  { key: 'q3' as const, label: 'Q3', cls: 'bg-warning' },
  { key: 'q4' as const, label: 'Q4', cls: 'bg-danger' },
];

function QuartileMix({
  byQuartile,
  byYear,
}: {
  byQuartile: ResearchResponse['byQuartile'];
  byYear: ResearchResponse['quartileByYear'];
}) {
  const rated = byQuartile.rated;
  if (rated === 0) {
    return (
      <div className="mt-3 text-xs text-text-tertiary">
        No quartile-rated papers in this scope. Run the kku-research connector to populate Scopus CiteScore quartiles.
      </div>
    );
  }
  return (
    <div className="mt-3 flex flex-col gap-4">
      <div className="flex items-center gap-4">
        <div className="shrink-0">
          <div className="font-tabular text-3xl font-semibold text-positive">
            {byQuartile.q1Share !== null ? `${Math.round(byQuartile.q1Share * 100)}%` : '—'}
          </div>
          <div className="text-[0.7rem] uppercase tracking-wide text-text-tertiary">Q1 share</div>
        </div>
        <div className="flex-1">
          {/* Overall stacked bar (rated papers) */}
          <div className="flex h-3 w-full overflow-hidden rounded-sm">
            {QUARTILE_SEGMENTS.map((s) => {
              const n = byQuartile[s.key];
              const w = (n / rated) * 100;
              if (w === 0) return null;
              return (
                <div
                  key={s.key}
                  className={s.cls}
                  style={{ width: `${w}%` }}
                  title={`${s.label}: ${n.toLocaleString('en-US')} (${w.toFixed(1)}%)`}
                />
              );
            })}
          </div>
          {/* Legend */}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {QUARTILE_SEGMENTS.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5">
                <span className={`inline-block h-2.5 w-2.5 rounded-sm ${s.cls}`} />
                <span className="text-text-secondary">{s.label}</span>
                <span className="font-tabular font-semibold">{byQuartile[s.key].toLocaleString('en-US')}</span>
              </span>
            ))}
            <span className="inline-flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-sm bg-surface-3" />
              <span className="text-text-secondary">Unrated</span>
              <span className="font-tabular font-semibold">{byQuartile.unrated.toLocaleString('en-US')}</span>
            </span>
          </div>
        </div>
      </div>

      {/* Per-year quartile mix (rated papers only) — a small stacked-bar
          trend so the reader sees whether Q1 share is rising. */}
      {byYear.length > 1 && (
        <div>
          <div className="mb-1.5 text-[0.7rem] uppercase tracking-wide text-text-tertiary">
            Quartile mix by year (rated papers)
          </div>
          <div className="flex items-end gap-1">
            {byYear.map((y) => {
              const tot = y.q1 + y.q2 + y.q3 + y.q4;
              return (
                <div key={y.year} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="flex w-full flex-col-reverse overflow-hidden rounded-sm"
                    style={{ height: '3rem' }}
                    title={`${y.year}: Q1 ${y.q1} · Q2 ${y.q2} · Q3 ${y.q3} · Q4 ${y.q4}`}
                  >
                    {QUARTILE_SEGMENTS.map((s) => {
                      const n = y[s.key];
                      if (tot === 0 || n === 0) return null;
                      return <div key={s.key} className={s.cls} style={{ height: `${(n / tot) * 100}%` }} />;
                    })}
                  </div>
                  <span className="text-[0.6rem] text-text-tertiary tabular-nums">{`'${String(y.year).slice(-2)}`}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
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
// Two-line year trend — Scopus + PubMed plotted separately so the
// curator-resolution lag on Scopus 2022+ is visible by-source rather
// than mysteriously suppressing the composite count.
function YearTrend({
  data,
}: {
  data: Array<{ year: number; scopus: number; pubmed: number; total: number }>;
}) {
  if (data.length === 0) return <div className="mt-2 text-xs text-text-tertiary">No data.</div>;
  const w = 600;
  const h = 180;
  const pad = { left: 35, right: 8, top: 12, bottom: 36 };
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;
  const xs = data.map((d) => d.year);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const maxY = Math.max(...data.map((d) => Math.max(d.scopus, d.pubmed)), 1);
  const x = (year: number): number =>
    pad.left + ((year - minX) / Math.max(1, maxX - minX)) * innerW;
  const y = (papers: number): number => pad.top + innerH - (papers / maxY) * innerH;
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(maxY * f));
  const SCOPUS_COLOR = '#0ea5e9'; // sky-500
  const PUBMED_COLOR = '#8b5cf6'; // violet-500
  const scopusPoints = data.map((d) => `${x(d.year)},${y(d.scopus)}`).join(' ');
  const pubmedPoints = data.map((d) => `${x(d.year)},${y(d.pubmed)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="mt-3 w-full h-auto" role="img" aria-label="Papers per year, by source">
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

      {/* PubMed line (drawn first so Scopus sits on top) */}
      <polyline points={pubmedPoints} fill="none" stroke={PUBMED_COLOR} strokeWidth="2" />
      {data.map((d) => (
        <g key={`pm-${d.year}`}>
          <circle cx={x(d.year)} cy={y(d.pubmed)} r="2.5" fill={PUBMED_COLOR} />
          <title>{`${d.year} PubMed: ${d.pubmed.toLocaleString('en-US')}`}</title>
        </g>
      ))}

      {/* Scopus line */}
      <polyline points={scopusPoints} fill="none" stroke={SCOPUS_COLOR} strokeWidth="2" />
      {data.map((d) => (
        <g key={`sc-${d.year}`}>
          <circle cx={x(d.year)} cy={y(d.scopus)} r="2.5" fill={SCOPUS_COLOR} />
          <title>{`${d.year} Scopus: ${d.scopus.toLocaleString('en-US')}`}</title>
        </g>
      ))}

      {/* Year labels */}
      {data.map((d, i) => (
        <text
          key={d.year}
          x={x(d.year)}
          y={h - 22}
          fontSize="9"
          fill="rgb(120,120,120)"
          textAnchor="middle"
          style={{ display: i % Math.max(1, Math.floor(data.length / 8)) === 0 ? undefined : 'none' }}
        >
          {String(d.year).slice(2)}
        </text>
      ))}

      {/* Legend */}
      <g transform={`translate(${pad.left}, ${h - 8})`}>
        <rect x={0} y={-7} width={10} height={3} fill={SCOPUS_COLOR} />
        <text x={14} y={-3} fontSize="9" fill="rgb(120,120,120)">Scopus</text>
        <rect x={66} y={-7} width={10} height={3} fill={PUBMED_COLOR} />
        <text x={80} y={-3} fontSize="9" fill="rgb(120,120,120)">PubMed</text>
      </g>
    </svg>
  );
}
