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
import { startRouteProgress } from '@/components/route-progress';
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
    yearTo?: number;
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
  // Year-range slider state. Initialise from the resolved window the API
  // returned (reflects any active filter), clamped to the stable bounds.
  const [yearRange, setYearRange] = React.useState<[number, number]>([
    data.yearFrom,
    data.yearTo,
  ]);

  const apply = (next: {
    facultyName?: string[];
    sources?: string[];
    yearFrom?: number;
    yearTo?: number;
  }) => {
    const params = new URLSearchParams();
    (next.facultyName ?? faculty).forEach((v) => params.append('facultyName', v));
    (next.sources ?? sources).forEach((v) => params.append('sources', v));
    const yf = next.yearFrom ?? yearRange[0];
    const yt = next.yearTo ?? yearRange[1];
    // Only put year params on the URL when the range is narrower than the
    // full [min, max] window — keeps default URLs clean.
    if (yf > data.yearMin) params.set('yearFrom', String(yf));
    if (yt < data.yearMax) params.set('yearTo', String(yt));
    startRouteProgress();
    router.push(`/staff/research${params.toString() ? `?${params}` : ''}`);
  };

  // Contributor pivot: Faculty → Author, leading with Tier 1 (top 10%) +
  // Q1 counts so the table answers "who drives KKU's high-tier output".
  // Faculty rows use
  // the distinct-paper per-faculty quartile counts (from byFaculty);
  // author rows sum the per-author counts. (Author-level counts are
  // per-author paper rows, so a co-authored paper is counted for each of
  // its KKU authors — the right read for "this person's Q1 output".)
  const contributorRows = React.useMemo(() => {
    const facMap = new Map<string, ResearchAuthor[]>();
    for (const a of data.perAuthor) {
      const fname = a.facultyName ?? '(unmapped)';
      const list = facMap.get(fname) ?? [];
      list.push(a);
      facMap.set(fname, list);
    }
    const facQuartile = new Map(data.byFaculty.map((f) => [f.facultyName, f]));
    const rows: DrillRow[] = [...facMap.entries()].map(([fname, authors]) => {
      const fac = facQuartile.get(fname);
      const totalCites = authors.reduce((a, b) => a + b.citations, 0);
      const maxH = authors.reduce((a, b) => Math.max(a, b.hIndex), 0);
      // Faculty name — Thai (the API now derives facultyName Thai-first);
      // facultyNameTh is the explicit Thai field, fname the group key.
      const labelTh = authors[0]?.facultyNameTh ?? fname;
      return {
        label: labelTh,
        metrics: {
          // Faculty-level = distinct papers (from byFaculty); falls back
          // to the per-author sum only if the faculty isn't in byFaculty.
          papers: fac?.papers ?? authors.reduce((a, b) => a + b.papers, 0),
          q1: fac?.q1Papers ?? authors.reduce((a, b) => a + b.q1Papers, 0),
          q2: fac?.q2Papers ?? authors.reduce((a, b) => a + b.q2Papers, 0),
          top10: fac?.top10Papers ?? authors.reduce((a, b) => a + b.top10Papers, 0),
          citations: fac?.citations ?? totalCites,
          hIndex: maxH,
        },
        children: authors
          .sort((a, b) => b.top10Papers - a.top10Papers || b.q1Papers - a.q1Papers || b.papers - a.papers)
          .map((a) => ({
            label: authorDisplay(a),
            metrics: {
              papers: a.papers,
              q1: a.q1Papers,
              q2: a.q2Papers,
              top10: a.top10Papers,
              citations: a.citations,
              hIndex: a.hIndex,
            },
          })),
      };
    });
    // Sort faculties by Tier 1 output (the strategic lens), then Q1, then
    // total papers.
    return rows.sort(
      (a, b) =>
        (b.metrics.top10 ?? 0) - (a.metrics.top10 ?? 0) ||
        (b.metrics.q1 ?? 0) - (a.metrics.q1 ?? 0) ||
        (b.metrics.papers ?? 0) - (a.metrics.papers ?? 0),
    );
  }, [data.perAuthor, data.byFaculty]);

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
          <YearRangeSlider
            min={data.yearMin}
            max={data.yearMax}
            from={yearRange[0]}
            to={yearRange[1]}
            onChange={setYearRange}
            onCommit={(r) => apply({ yearFrom: r[0], yearTo: r[1] })}
          />
          {(faculty.length > 0 ||
            sources.length > 0 ||
            yearRange[0] > data.yearMin ||
            yearRange[1] < data.yearMax) && (
            <button
              className="rounded border border-border-subtle bg-surface-1 px-3 py-1 text-xs text-text-secondary hover:bg-surface-2"
              onClick={() => {
                setFaculty([]);
                setSources([]);
                setYearRange([data.yearMin, data.yearMax]);
                startRouteProgress();
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

      {/* ── HERO: Journal quartile (Scopus CiteScore) ──────────────────
          The strategic driver for QS / THE rankings, so it leads the
          page: headline tier KPIs, the rated-paper quartile mix, and the
          by-year tier distribution (scatter + line). */}
      <Card>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-base font-semibold">Journal quartile · Scopus CiteScore</h2>
            <p className="mt-0.5 text-xs text-text-tertiary">
              KKU&apos;s strategic quality signal for QS &amp; THE rankings. Best quartile
              across the journal&apos;s subject areas per paper-year (Tier 1 = top 10%, a
              subset of Q1 = top 25%). Distinct papers; shares are against rated papers.
            </p>
          </div>
          <span className="text-xs text-text-tertiary">
            {data.byQuartile.rated.toLocaleString('en-US')} rated ·{' '}
            {data.byQuartile.unrated.toLocaleString('en-US')} unrated (PubMed / no CiteScore)
          </span>
        </div>
        <div className="mt-4 flex flex-col gap-5 lg:flex-row">
          {/* Donut — quartile share (25% on desktop). */}
          <div className="lg:w-1/4 lg:shrink-0 lg:border-r lg:border-border-subtle lg:pr-5">
            <QuartileMix byQuartile={data.byQuartile} />
          </div>
          {/* By-year tier distribution (75%). */}
          <div className="min-w-0 flex-1">
            {data.quartileByYear.length > 1 ? (
              <>
                <h3 className="text-sm font-semibold">Publications by year &amp; tier</h3>
                <p className="mt-0.5 text-xs text-text-tertiary">
                  Distinct rated papers per year, split by quartile. The Tier 1 line (top
                  10%) is a subset of Q1. Toggle a series in the legend; hover for exact values.
                </p>
                <QuartileByYearChart data={data.quartileByYear} />
              </>
            ) : (
              <p className="text-xs text-text-tertiary">
                Not enough years of rated data to chart a by-year tier distribution.
              </p>
            )}
          </div>
        </div>
      </Card>

      {/* Contributors — Faculty → Author, ranked by Tier 1 / Q1 output.
          Who drives KKU's high-tier publication record. */}
      <Card>
        <h3 className="text-sm font-semibold">Contributors — faculty &amp; individual</h3>
        <p className="mt-1 text-xs text-text-tertiary">
          Drill from faculty into its authors. Columns lead with Tier 1 (top 10%) and Q1
          paper counts — the QS/THE-relevant output per contributor. Click a column header
          to sort; click a faculty row to expand.
        </p>
        <div className="mt-3">
          <DrillDownPivot
            rowHeaderLabel="Faculty / Author"
            maxDepth={2}
            rows={contributorRows}
            columns={[
              { key: 'papers', label: 'Papers', format: 'int' },
              { key: 'top10', label: 'Tier 1', format: 'int' },
              { key: 'q1', label: 'Q1', format: 'int' },
              { key: 'q2', label: 'Q2', format: 'int' },
              { key: 'citations', label: 'Citations', format: 'int' },
              { key: 'hIndex', label: 'h-index', format: 'int' },
            ]}
          />
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

// Quartile mix — headline Tier 1 + Q1 KPIs and a call-out donut over
// rated papers. Colours are design tokens (lint-safe), semantically
// ramped: Q1 positive, Q2 info, Q3 warning, Q4 danger.
// Dual-thumb year range slider — replaces the old From-year + Exact-year
// inputs. Two overlaid native range inputs; the highlighted track segment
// sits between them. Thumb styling lives in globals.css (`.range-dual`)
// so it can theme via design-token CSS vars. `onChange` updates the live
// label/track during the drag; `onCommit` (release) pushes the URL.
function YearRangeSlider({
  min,
  max,
  from,
  to,
  onChange,
  onCommit,
}: {
  min: number;
  max: number;
  from: number;
  to: number;
  onChange: (range: [number, number]) => void;
  onCommit: (range: [number, number]) => void;
}) {
  const span = Math.max(1, max - min);
  const pctFrom = ((from - min) / span) * 100;
  const pctTo = ((to - min) / span) * 100;
  const commit = () => onCommit([from, to]);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-3">
        <label className="text-[0.65rem] font-medium uppercase tracking-wide text-text-tertiary">
          Year range
        </label>
        <span className="font-tabular text-xs tabular-nums text-text-secondary">
          {from === to ? from : `${from}–${to}`}
        </span>
      </div>
      <div className="range-dual relative h-5 w-56">
        {/* full track */}
        <div className="pointer-events-none absolute top-1/2 h-1 w-full -translate-y-1/2 rounded-full bg-surface-3" />
        {/* selected segment */}
        <div
          className="pointer-events-none absolute top-1/2 h-1 -translate-y-1/2 rounded-full bg-accent-default"
          style={{ left: `${pctFrom}%`, right: `${100 - pctTo}%` }}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={from}
          aria-label="From year"
          onChange={(e) => onChange([Math.min(Number(e.target.value), to), to])}
          onMouseUp={commit}
          onTouchEnd={commit}
          onKeyUp={commit}
        />
        <input
          type="range"
          min={min}
          max={max}
          step={1}
          value={to}
          aria-label="To year"
          onChange={(e) => onChange([from, Math.max(Number(e.target.value), from)])}
          onMouseUp={commit}
          onTouchEnd={commit}
          onKeyUp={commit}
        />
      </div>
      <div className="flex justify-between font-tabular text-[0.6rem] tabular-nums text-text-tertiary">
        <span>{min}</span>
        <span>{max}</span>
      </div>
    </div>
  );
}

function QuartileMix({
  byQuartile,
}: {
  byQuartile: ResearchResponse['byQuartile'];
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
    <div className="mt-3 flex flex-col items-center gap-4">
      {/* Headline tier KPIs — Tier 1 (top 10%) leads, then Q1. */}
      <div className="flex w-full justify-around gap-4">
        <div className="text-center">
          <div className="font-tabular text-3xl font-semibold text-accent-default">
            {byQuartile.top10Share !== null ? `${Math.round(byQuartile.top10Share * 100)}%` : '—'}
          </div>
          <div className="text-[0.7rem] uppercase tracking-wide text-text-tertiary">Tier 1 share</div>
          <div className="text-[0.7rem] text-text-tertiary">
            {byQuartile.top10.toLocaleString('en-US')} of {rated.toLocaleString('en-US')} rated
          </div>
        </div>
        <div className="text-center">
          <div className="font-tabular text-3xl font-semibold text-positive">
            {byQuartile.q1Share !== null ? `${Math.round(byQuartile.q1Share * 100)}%` : '—'}
          </div>
          <div className="text-[0.7rem] uppercase tracking-wide text-text-tertiary">Q1 share</div>
          <div className="text-[0.7rem] text-text-tertiary">
            {byQuartile.q1.toLocaleString('en-US')} papers (incl. Tier 1)
          </div>
        </div>
      </div>

      {/* Donut — quartile share of rated papers */}
      <QuartileDonut byQuartile={byQuartile} />

    </div>
  );
}

// Quartile-share donut (rated papers). Segments Q1→Q4 via stroke-
// dasharray; centre shows the rated total. Each segment gets an external
// call-out (leader line + "Q1 41%") so the proportions are readable at a
// glance. Colours are the same design-token CSS vars as the line chart.
function QuartileDonut({ byQuartile }: { byQuartile: ResearchResponse['byQuartile'] }) {
  const rated = byQuartile.rated;
  const cx = 120;
  const cy = 80;
  const R = 46;
  const SW = 16;
  const C = 2 * Math.PI * R;
  // Tier 1 (top 10%) is a subset of Q1 — split it out as its own leading
  // band (accent), then the rest of Q1 (positive), Q2, Q3, Q4. Together
  // they still sum to `rated`.
  const segs = [
    { key: 'tier1' as const, label: 'Tier 1', n: byQuartile.top10, stroke: 'oklch(var(--color-accent-default))' },
    { key: 'q1' as const, label: 'Q1', n: Math.max(0, byQuartile.q1 - byQuartile.top10), stroke: 'oklch(var(--color-data-positive))' },
    { key: 'q2' as const, label: 'Q2', n: byQuartile.q2, stroke: 'oklch(var(--color-info-default))' },
    { key: 'q3' as const, label: 'Q3', n: byQuartile.q3, stroke: 'oklch(var(--color-warning-default))' },
    { key: 'q4' as const, label: 'Q4', n: byQuartile.q4, stroke: 'oklch(var(--color-danger-default))' },
  ];
  // Pre-compute each non-empty segment's fraction + cumulative start so
  // arcs and call-outs share one accumulator.
  const prepared: Array<{ key: string; label: string; n: number; stroke: string; f: number; start: number }> = [];
  let acc = 0;
  for (const s of segs) {
    if (rated === 0 || s.n === 0) continue;
    const f = s.n / rated;
    prepared.push({ ...s, f, start: acc });
    acc += f;
  }
  // Polar point with 12-o'clock = 0 (matches the -90° arc rotation).
  const polar = (r: number, frac: number) => {
    const a = (-90 + 360 * frac) * (Math.PI / 180);
    return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
  };
  return (
    <svg viewBox="0 0 240 160" className="w-[95%]" role="img" aria-label="Quartile share donut">
      {/* track */}
      <circle cx={cx} cy={cy} r={R} fill="none" stroke="oklch(var(--color-surface-3))" strokeWidth={SW} />
      {/* arcs */}
      {prepared.map((s) => (
        <circle
          key={s.key}
          cx={cx}
          cy={cy}
          r={R}
          fill="none"
          stroke={s.stroke}
          strokeWidth={SW}
          strokeDasharray={`${s.f * C} ${(1 - s.f) * C}`}
          strokeDashoffset={-s.start * C}
          transform={`rotate(-90 ${cx} ${cy})`}
        >
          <title>{`${s.label}: ${s.n.toLocaleString('en-US')} (${(s.f * 100).toFixed(1)}%)`}</title>
        </circle>
      ))}
      {/* call-outs — leader line + tier label, count and share % */}
      {prepared.map((s) => {
        const mid = s.start + s.f / 2;
        const onArc = polar(R + SW / 2, mid);
        const elbow = polar(R + 16, mid);
        const right = elbow.x >= cx;
        const labelX = right ? elbow.x + 3 : elbow.x - 3;
        const anchor = right ? 'start' : 'end';
        return (
          <g key={`co-${s.key}`}>
            <line x1={onArc.x} y1={onArc.y} x2={elbow.x} y2={elbow.y} stroke={s.stroke} strokeWidth={1.25} />
            <text x={labelX} y={elbow.y - 2} textAnchor={anchor} className="fill-text-primary text-[10px] font-semibold">
              {`${s.label} · ${(s.f * 100).toFixed(0)}%`}
            </text>
            <text x={labelX} y={elbow.y + 8} textAnchor={anchor} className="fill-text-tertiary text-[9px] tabular-nums">
              {`${s.n.toLocaleString('en-US')} papers`}
            </text>
          </g>
        );
      })}
      <text x={cx} y={cy - 1} textAnchor="middle" className="fill-text-primary text-[15px] font-semibold tabular-nums">
        {rated.toLocaleString('en-US')}
      </text>
      <text x={cx} y={cy + 12} textAnchor="middle" className="fill-text-tertiary text-[8px] uppercase tracking-wide">
        rated
      </text>
    </svg>
  );
}

// Publications-by-year, by tier — a scatter+line chart. One line per
// quartile (Q1→Q4) plus a Tier 1 (top 10%) line, markers on every
// year. Inline SVG; series colours are design-token CSS vars (the lint
// rule allows oklch(var(--…)) wrappers, only literal hex/rgb is banned).
// Series definitions. `count` series read off the left axis (paper
// counts); `share` series read off the right axis (% of that year's
// rated papers). All toggleable; the right % axis only renders when a
// share series is visible.
interface QSeries {
  key: string;
  label: string;
  stroke: string;
  dashed: boolean;
  axis: 'left' | 'right';
  value: (p: ResearchResponse['quartileByYear'][number]) => number;
}
const Q_SERIES: QSeries[] = [
  { key: 'top10', label: 'Tier 1', stroke: 'oklch(var(--color-accent-default))', dashed: false, axis: 'left', value: (p) => p.top10 },
  { key: 'q1', label: 'Q1', stroke: 'oklch(var(--color-data-positive))', dashed: false, axis: 'left', value: (p) => p.q1 },
  { key: 'q2', label: 'Q2', stroke: 'oklch(var(--color-info-default))', dashed: false, axis: 'left', value: (p) => p.q2 },
  { key: 'q3', label: 'Q3', stroke: 'oklch(var(--color-warning-default))', dashed: false, axis: 'left', value: (p) => p.q3 },
  { key: 'q4', label: 'Q4', stroke: 'oklch(var(--color-danger-default))', dashed: false, axis: 'left', value: (p) => p.q4 },
  { key: 'top10share', label: 'Tier 1 %', stroke: 'oklch(var(--color-accent-default))', dashed: true, axis: 'right', value: (p) => (p.rated > 0 ? (p.top10 / p.rated) * 100 : 0) },
  { key: 'q1share', label: 'Q1 %', stroke: 'oklch(var(--color-data-positive))', dashed: true, axis: 'right', value: (p) => (p.rated > 0 ? (p.q1 / p.rated) * 100 : 0) },
];

function QuartileByYearChart({ data }: { data: ResearchResponse['quartileByYear'] }) {
  const pts = data;
  // Share series default OFF to keep the first read clean; counts on.
  const [hidden, setHidden] = React.useState<Set<string>>(
    () => new Set(['q1share', 'top10share']),
  );
  const [hoverIdx, setHoverIdx] = React.useState<number | null>(null);

  const W = 760;
  const H = 300;
  const PAD = { top: 16, right: 44, bottom: 28, left: 40 };
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const n = pts.length;
  const xAt = (i: number) => (n === 1 ? PAD.left + innerW / 2 : PAD.left + (i / (n - 1)) * innerW);

  const visible = Q_SERIES.filter((s) => !hidden.has(s.key));
  const leftVisible = visible.some((s) => s.axis === 'left');
  const rightVisible = visible.some((s) => s.axis === 'right');
  const leftMax = Math.max(
    1,
    ...pts.flatMap((p) => Q_SERIES.filter((s) => s.axis === 'left' && !hidden.has(s.key)).map((s) => s.value(p))),
  );
  const yLeft = (v: number) => PAD.top + innerH - (v / leftMax) * innerH;
  const yRight = (v: number) => PAD.top + innerH - (v / 100) * innerH; // right axis 0-100%
  const yFor = (s: QSeries, v: number) => (s.axis === 'right' ? yRight(v) : yLeft(v));

  const ticks = 4;
  const leftTicks = Array.from({ length: ticks + 1 }, (_, i) => Math.round((leftMax / ticks) * i));
  const rightTicks = [0, 25, 50, 75, 100];
  const labelEvery = n > 12 ? Math.ceil(n / 12) : 1;

  const toggle = (key: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="mt-3">
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          style={{ maxHeight: '340px' }}
          role="img"
          aria-label="Publications by year and quartile tier"
          onMouseLeave={() => setHoverIdx(null)}
          onMouseMove={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            const svgX = ((e.clientX - rect.left) / rect.width) * W;
            const i = Math.round(((svgX - PAD.left) / innerW) * (n - 1));
            setHoverIdx(Math.max(0, Math.min(n - 1, i)));
          }}
        >
          {/* Left axis gridlines + labels (counts) */}
          {leftVisible &&
            leftTicks.map((v) => (
              <g key={`l${v}`}>
                <line x1={PAD.left} y1={yLeft(v)} x2={W - PAD.right} y2={yLeft(v)} className="stroke-border-subtle" strokeWidth={1} />
                <text x={PAD.left - 6} y={yLeft(v) + 3} textAnchor="end" className="fill-text-tertiary text-[10px] tabular-nums">{v}</text>
              </g>
            ))}
          {/* Right axis labels (%) — only when a share series is shown */}
          {rightVisible &&
            rightTicks.map((v) => (
              <text key={`r${v}`} x={W - PAD.right + 6} y={yRight(v) + 3} textAnchor="start" className="fill-text-tertiary text-[10px] tabular-nums">
                {v}%
              </text>
            ))}
          {/* X labels */}
          {pts.map((p, i) =>
            i % labelEvery === 0 ? (
              <text key={p.year} x={xAt(i)} y={H - 8} textAnchor="middle" className="fill-text-tertiary text-[10px] tabular-nums">
                {`'${String(p.year).slice(-2)}`}
              </text>
            ) : null,
          )}
          {/* Hover guide */}
          {hoverIdx !== null && (
            <line x1={xAt(hoverIdx)} y1={PAD.top} x2={xAt(hoverIdx)} y2={PAD.top + innerH} className="stroke-border-strong" strokeWidth={1} strokeDasharray="3 3" />
          )}
          {/* Series */}
          {visible.map((s) => {
            const path = pts
              .map((p, i) => `${i === 0 ? 'M' : 'L'} ${xAt(i).toFixed(1)} ${yFor(s, s.value(p)).toFixed(1)}`)
              .join(' ');
            return (
              <g key={s.key}>
                <path d={path} fill="none" stroke={s.stroke} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} />
                {pts.map((p, i) => (
                  <circle key={p.year} cx={xAt(i)} cy={yFor(s, s.value(p))} r={hoverIdx === i ? 3.5 : 2} fill={s.stroke} />
                ))}
              </g>
            );
          })}
        </svg>
        {/* Hover tooltip */}
        {hoverIdx !== null && pts[hoverIdx] && (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-md border border-border-subtle bg-surface-1 p-2 text-xs shadow-md"
            style={{ left: `${(xAt(hoverIdx) / W) * 100}%`, transform: 'translateX(-50%)' }}
          >
            <div className="mb-1 font-semibold tabular-nums">{pts[hoverIdx]!.year}</div>
            {visible.map((s) => {
              const v = s.value(pts[hoverIdx]!);
              return (
                <div key={s.key} className="flex items-center gap-1.5 whitespace-nowrap">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: s.stroke }} />
                  <span className="text-text-secondary">{s.label}</span>
                  <span className="ml-auto pl-2 font-tabular font-semibold">
                    {s.axis === 'right' ? `${v.toFixed(0)}%` : v.toLocaleString('en-US')}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {/* Clickable legend — toggle series on/off */}
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1.5 text-xs">
        {Q_SERIES.map((s) => {
          const off = hidden.has(s.key);
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => toggle(s.key)}
              className={`inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 hover:bg-surface-2 ${off ? 'opacity-40' : ''}`}
              title={off ? `Show ${s.label}` : `Hide ${s.label}`}
            >
              <svg width={18} height={8} aria-hidden>
                <line x1={0} y1={4} x2={18} y2={4} stroke={s.stroke} strokeWidth={2.5} strokeDasharray={s.dashed ? '4 3' : undefined} />
              </svg>
              <span className="text-text-secondary">{s.label}</span>
              {s.axis === 'right' && <span className="text-[0.6rem] text-text-tertiary">(%)</span>}
            </button>
          );
        })}
      </div>
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
