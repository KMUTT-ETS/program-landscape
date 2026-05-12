'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Badge,
  BubbleMatrix,
  Button,
  Card,
  DataTable,
  EdgeGlow,
  Heatmap,
  Input,
  RightPanel,
  Segmented,
  SegmentedList,
  SegmentedTrigger,
  Stat,
  StatStrip,
  type ColumnDef,
  type HeatmapRow,
} from '@kku/ui';
import {
  AlertTriangle,
  BookOpen,
  ChevronRight,
  CircleDot,
  ExternalLink,
  FileText,
  Filter,
  GraduationCap,
  Home,
  Info,
  Save,
  Sparkles,
  Wallet,
} from 'lucide-react';
import type { SessionUser } from '@kku/shared';
import Link from 'next/link';
import type { RecruitmentDashboardPayload } from '../education/recruitment/client';
import {
  deleteSavedViewAction,
  generateBriefAction,
  exportCouncilPackAction,
  saveViewAction,
  touchSavedViewAction,
} from '@/lib/actions/cockpit';
import type {
  CockpitHeatmap,
  CockpitKpis,
  CockpitMatrix,
  CockpitRollup,
  RollupNode,
  SavedView,
  ScopeBreadcrumbCrumb,
} from './types';

// Cockpit page client. Three view modes + a left rail + top KPI strip
// + brief + export actions. Stays client-only because the segmented
// control + filters + drill-in need interactivity; the server page
// hydrates this with already-fetched data so the first paint is the
// real chart, not a skeleton.

type ViewMode = 'heatmap' | 'matrix' | 'rollup' | 'recruitment';

interface Props {
  user: SessionUser;
  scope: string;
  scopeId: string;
  initialView: ViewMode;
  kpis: CockpitKpis | null;
  heatmap: CockpitHeatmap | null;
  matrix: CockpitMatrix | null;
  rollup: CockpitRollup | null;
  recruitment: RecruitmentDashboardPayload | null;
  savedViews: SavedView[];
  breadcrumb: ScopeBreadcrumbCrumb[];
}

export function CockpitClient(props: Props) {
  const router = useRouter();
  const [view, setView] = React.useState<ViewMode>(props.initialView);
  const [briefOpen, setBriefOpen] = React.useState(false);
  const [brief, setBrief] = React.useState<string | null>(null);
  const [briefBusy, setBriefBusy] = React.useState(false);
  const [exportBusy, setExportBusy] = React.useState(false);
  const [levelFilter, setLevelFilter] = React.useState<string>('');
  const [statusFilter, setStatusFilter] = React.useState<string>('');
  const [search, setSearch] = React.useState('');

  const changeView = (v: ViewMode) => {
    setView(v);
    const u = new URLSearchParams(window.location.search);
    u.set('view', v);
    window.history.replaceState(null, '', `?${u.toString()}`);
  };

  const onRowDrill = (scope: string, scopeId: string | null) => {
    // Short-circuit program scope to skip the /cockpit?scope=program
    // bounce — the page-level handler would redirect there anyway, but
    // doing it client-side is one network round-trip faster.
    if (scope === 'program' && scopeId) {
      router.push(`/programs/${scopeId}`);
      return;
    }
    const u = new URLSearchParams(window.location.search);
    u.set('scope', scope);
    if (scopeId) u.set('scopeId', scopeId);
    router.push(`/cockpit?${u.toString()}`);
  };

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[240px_minmax(0,1fr)]">
      <aside className="flex flex-col gap-3">
        <Card padding="sm">
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold">
            <Filter className="h-4 w-4 text-text-tertiary" aria-hidden />
            Filters
          </div>
          <div className="flex flex-col gap-2 text-sm">
            <div>
              <label className="mb-1 block text-xs text-text-tertiary">Level</label>
              <select
                value={levelFilter}
                onChange={(e) => setLevelFilter(e.target.value)}
                className="w-full kku-select"
              >
                <option value="">All</option>
                <option value="BACHELOR">Bachelor</option>
                <option value="MASTER">Master</option>
                <option value="DOCTORAL">Doctoral</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-tertiary">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="w-full kku-select"
              >
                <option value="">All</option>
                <option value="ACTIVE">Active</option>
                <option value="PAUSED">Paused</option>
                <option value="SUNSET">Sunset</option>
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs text-text-tertiary">Search</label>
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Program / dept (TH/EN)"
              />
            </div>
          </div>
        </Card>

        <Card padding="sm">
          <div className="mb-2 flex items-center justify-between text-sm font-semibold">
            <span className="flex items-center gap-2">
              <Save className="h-4 w-4 text-text-tertiary" aria-hidden />
              Saved views
            </span>
            <Button
              size="xs"
              variant="ghost"
              onClick={async () => {
                const name = window.prompt('Name this view');
                if (!name) return;
                // Saved views capture analytical layouts only — the
                // Recruitment tab is a passthrough panel, not a layout.
                const savableView: 'heatmap' | 'matrix' | 'rollup' =
                  view === 'recruitment' ? 'heatmap' : view;
                const res = await saveViewAction({
                  name,
                  viewMode: savableView,
                  scope: props.scope,
                  scopeId: props.scopeId || null,
                  filters: { levelFilter, statusFilter, search },
                });
                if (res.ok) {
                  toast.success('View saved');
                  router.refresh();
                } else {
                  toast.error(res.message);
                }
              }}
            >
              Save
            </Button>
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {props.savedViews.length === 0 ? (
              <li className="text-text-tertiary">Nothing saved yet</li>
            ) : (
              props.savedViews.slice(0, 8).map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2">
                  <button
                    className="flex-1 truncate text-left hover:text-accent"
                    onClick={async () => {
                      await touchSavedViewAction(v.id);
                      const u = new URLSearchParams();
                      u.set('scope', v.scope);
                      if (v.scopeId) u.set('scopeId', v.scopeId);
                      u.set('view', v.viewMode);
                      router.push(`/cockpit?${u.toString()}`);
                    }}
                  >
                    {v.name}
                    <span className="ml-1 text-xs text-text-tertiary">· {v.viewMode}</span>
                  </button>
                  <button
                    className="text-xs text-text-tertiary hover:text-danger"
                    aria-label="Delete saved view"
                    onClick={async () => {
                      const r = await deleteSavedViewAction(v.id);
                      if (r.ok) {
                        toast.success('Deleted');
                        router.refresh();
                      } else toast.error(r.message);
                    }}
                  >
                    ✕
                  </button>
                </li>
              ))
            )}
          </ul>
        </Card>
      </aside>

      <div className="flex flex-col gap-4">
        <ScopeBreadcrumb crumbs={props.breadcrumb} />
        <KpiStrip kpis={props.kpis} />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented value={view} onValueChange={(v) => changeView(v as ViewMode)}>
            <SegmentedList>
              <SegmentedTrigger value="heatmap">Health heatmap</SegmentedTrigger>
              <SegmentedTrigger value="matrix">Strategic matrix</SegmentedTrigger>
              <SegmentedTrigger value="rollup">Rollup tree</SegmentedTrigger>
              <SegmentedTrigger value="recruitment">Recruitment</SegmentedTrigger>
            </SegmentedList>
          </Segmented>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBriefOpen(true)}
            >
              <Sparkles className="h-4 w-4" aria-hidden />
              Generate Council brief
            </Button>
            <EdgeGlow inline>
              <Button
                variant="primary"
                size="sm"
                disabled={exportBusy}
                onClick={async () => {
                  setExportBusy(true);
                  const r = await exportCouncilPackAction({
                    scope: props.scope,
                    scopeId: props.scopeId || null,
                  });
                  setExportBusy(false);
                  if (r.ok) {
                    toast.success('Council Pack ready');
                    window.open(r.pdfUrl, '_blank');
                  } else toast.error(r.message);
                }}
              >
                <FileText className="h-4 w-4" aria-hidden />
                {exportBusy ? 'Generating…' : 'Export Council Pack PDF'}
              </Button>
            </EdgeGlow>
          </div>
        </div>

        {props.scope === 'faculty' && (view === 'heatmap' || view === 'rollup') && (
          <Card padding="sm">
            <div className="flex items-start gap-2 text-xs text-text-secondary">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
              <span>
                Each row below is a program in this faculty. Click it to open the program&apos;s full deep-dive
                (health, faculty roster, recruitment funnel, demand match, AI peer review). Use the breadcrumb above to step back to the university view.
              </span>
            </div>
          </Card>
        )}
        {props.scope === 'department' && (view === 'heatmap' || view === 'rollup') && (
          <Card padding="sm">
            <div className="flex items-start gap-2 text-xs text-text-secondary">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
              <span>
                Department-scope view (reached via direct link or saved view). The cockpit now drills
                university → faculty → program directly; the department middle level is no longer auto-navigated.
                Each row below is a program in this department; clicking opens its deep-dive.
              </span>
            </div>
          </Card>
        )}
        {view === 'heatmap' && props.heatmap && (
          <Card accent="cockpit" padding="md">
            <Heatmap
              rows={toHeatmapRows(props.heatmap)}
              columnLabels={['Attractiveness', 'Financial', 'Capability', 'Outcomes', 'Relevance']}
              onRowClick={(r) => {
                // Two-level drill: university → faculty → program.
                // Department auto-nav was removed 2026-05-07 (still
                // accessible by direct URL for back-compat with saved
                // views and deep links).
                const nextScope =
                  props.scope === 'university' ? 'faculty' : 'program';
                onRowDrill(nextScope, r.id);
              }}
            />
            <p className="mt-3 text-xs text-text-tertiary">
              Cells: 0–100. &lt;40 danger · 40–65 needs attention · &gt;65 healthy. Hover a cell to see underlying drivers. Methodology {props.heatmap.methodologyVersion} — see /methodologies/health-score.md
            </p>
            {/* Preview-methodology caveat (gap #5 closure): the Financial
              * column is driven by cost-allocation.v0, which is a placeholder
              * until Finance Committee signs off on v1.0. */}
            <p className="mt-1 text-xs text-text-tertiary">
              <Badge tone="warning" size="sm" className="mr-1.5 align-middle">
                PREVIEW
              </Badge>
              <span className="align-middle">
                Financial column uses cost-allocation.v0 (placeholder). Read directional, not absolute.
              </span>
            </p>
          </Card>
        )}

        {view === 'matrix' && props.matrix && (
          <Card accent="cockpit">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-text-secondary">
                  BCG-style Strategic Matrix
                </h3>
                <p className="mt-0.5 text-xs text-text-tertiary">
                  Size = annual revenue · Colour = net contribution (green positive, red negative) · Dashed =
                  low data completeness
                </p>
              </div>
              <Badge tone="neutral">{props.matrix.bubbles.length} programs</Badge>
            </div>
            <BubbleMatrix
              bubbles={props.matrix.bubbles}
              axisXLabel={props.matrix.axisX.label}
              axisYLabel={props.matrix.axisY.label}
              xMinLabel={props.matrix.axisX.minLabel}
              xMaxLabel={props.matrix.axisX.maxLabel}
              yMinLabel={props.matrix.axisY.minLabel}
              yMaxLabel={props.matrix.axisY.maxLabel}
              onBubbleClick={(b) => router.push(`/programs/${b.id}`)}
            />
          </Card>
        )}

        {view === 'rollup' && props.rollup && (
          <Card accent="cockpit" padding="none">
            <RollupTable
              rollup={props.rollup}
              onRowClick={(node) => {
                // Two-level drill: university → faculty → program.
                const nextScope =
                  props.scope === 'university' ? 'faculty' : 'program';
                onRowDrill(nextScope, node.scopeId);
              }}
            />
          </Card>
        )}

        {view === 'recruitment' && (
          <RecruitmentPanel data={props.recruitment} />
        )}
      </div>

      <RightPanel
        open={briefOpen}
        onOpenChange={(open) => {
          if (!open) {
            setBriefOpen(false);
            setBrief(null);
          }
        }}
        title="Council brief"
        widthClass="w-[min(640px,95vw)]"
      >
        <div className="flex flex-col gap-3">
          <p className="text-sm text-text-secondary">
            Generates a Thai-primary narrative from the current scope's KPIs + heatmap. Audit-logged as an
            AiInference. Below-threshold confidence will show clearly.
          </p>
          {brief ? (
            <Card>
              <pre className="whitespace-pre-wrap text-sm" lang="th">
                {brief}
              </pre>
            </Card>
          ) : (
            <Button
              disabled={briefBusy}
              onClick={async () => {
                setBriefBusy(true);
                const r = await generateBriefAction({
                  scope: props.scope,
                  scopeId: props.scopeId || null,
                  style: 'executive-summary',
                });
                setBriefBusy(false);
                if (r.ok) setBrief(r.text);
                else toast.error(r.message);
              }}
            >
              {briefBusy ? 'Generating…' : 'Generate now'}
            </Button>
          )}
        </div>
      </RightPanel>
    </div>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// KPI strip
// ──────────────────────────────────────────────────────────────────────────

function KpiStrip({ kpis }: { kpis: CockpitKpis | null }) {
  if (!kpis) {
    return (
      <Card padding="md" className="text-sm text-text-tertiary">
        KPI data unavailable at this scope.
      </Card>
    );
  }
  const fmtNum = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-US'));
  const fmtMoney = (n: number | null): string => {
    if (n === null) return '—';
    const abs = Math.abs(n);
    const sign = n < 0 ? '−' : '';
    if (abs >= 1_000_000_000) return `${sign}฿${(abs / 1_000_000_000).toFixed(2)}B`;
    if (abs >= 1_000_000) return `${sign}฿${(abs / 1_000_000).toFixed(1)}M`;
    if (abs >= 1_000) return `${sign}฿${(abs / 1_000).toFixed(0)}K`;
    return `${sign}฿${abs.toFixed(0)}`;
  };
  const denom = kpis.programsWithTrend > 0 ? kpis.programsWithTrend : kpis.programCount;
  const completenessLabel =
    kpis.dataCompletenessPct === null
      ? '—'
      : `${kpis.dataCompletenessPct.toFixed(0)}%`;
  const completenessHint =
    kpis.dataCompletenessPct === null
      ? ''
      : kpis.dataCompletenessPct >= 75
        ? 'high'
        : kpis.dataCompletenessPct >= 50
          ? 'partial'
          : 'thin — preview only';
  return (
    <StatStrip columns={6}>
      <Stat
        moduleKey="cockpit"
        icon={<BookOpen />}
        label="Active programs"
        value={fmtNum(kpis.programCount)}
        hint="status = ACTIVE"
      />
      <Stat
        moduleKey="cockpit"
        icon={<GraduationCap />}
        label="Currently enrolled"
        value={fmtNum(kpis.enrolledTotal)}
        hint="all active students"
      />
      <Stat
        moduleKey="cockpit"
        icon={<Wallet />}
        label="Net contribution"
        value={fmtMoney(kpis.netContributionTotal)}
        hint="FY 2024+ aggregate"
        deltaTone={
          kpis.netContributionTotal !== null && kpis.netContributionTotal < 0
            ? 'negative'
            : undefined
        }
      />
      <Stat
        moduleKey="cockpit"
        icon={<AlertTriangle />}
        label="At risk"
        value={`${kpis.atRiskCount} / ${denom}`}
        hint={kpis.atRiskCount > 0 ? 'zero enrol + ≤−50% 3yr' : 'none'}
        deltaTone={kpis.atRiskCount > 0 ? 'negative' : 'neutral'}
      />
      <Stat
        moduleKey="cockpit"
        icon={<Sparkles />}
        label="Surging"
        value={`${kpis.surgingCount} / ${denom}`}
        hint={kpis.surgingCount > 0 ? '≥+50% 3yr enrolment' : 'no high-growth'}
        deltaTone={kpis.surgingCount > 0 ? 'positive' : 'neutral'}
      />
      <Stat
        moduleKey="cockpit"
        icon={<CircleDot />}
        label="Data confidence"
        value={completenessLabel}
        hint={completenessHint}
        deltaTone={
          kpis.dataCompletenessPct !== null && kpis.dataCompletenessPct < 50
            ? 'negative'
            : undefined
        }
      />
    </StatStrip>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Heatmap shape mapping — Cockpit rows → UI Heatmap rows
// ──────────────────────────────────────────────────────────────────────────

function toHeatmapRows(hm: CockpitHeatmap): HeatmapRow[] {
  return hm.rows.map((r) => ({
    id: r.scopeId,
    label: r.scopeLabel,
    labelTh: r.scopeLabelTh,
    labelEn: r.scopeLabelEn,
    parentId: r.parentScopeId,
    cells: [
      toCell(r.dimensions.attractiveness),
      toCell(r.dimensions.financial),
      toCell(r.dimensions.capability),
      toCell(r.dimensions.outcomes),
      toCell(r.dimensions.relevance),
    ],
    overall: toCell(r.overall),
  }));
}

function toCell(s: CockpitHeatmap['rows'][number]['dimensions']['attractiveness']) {
  return {
    score: s.score,
    dataCompletenessPct: s.dataCompletenessPct,
    drivers: s.drivers.map((d) => ({ label: d.label, value: d.value })),
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Scope breadcrumb — KKU › Faculty › Department, click to navigate up.
// At university scope it renders just "KKU University" (no parent links).
// ──────────────────────────────────────────────────────────────────────────

function ScopeBreadcrumb({ crumbs }: { crumbs: ScopeBreadcrumbCrumb[] }) {
  const router = useRouter();
  const goTo = (c: ScopeBreadcrumbCrumb) => {
    const u = new URLSearchParams();
    u.set('scope', c.scope);
    if (c.scopeId) u.set('scopeId', c.scopeId);
    router.push(`/cockpit?${u.toString()}`);
  };
  return (
    <Card padding="sm">
      <nav
        aria-label="Cockpit scope breadcrumb"
        className="flex items-center gap-2 text-sm flex-wrap"
      >
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          const inner = (
            <span className="flex items-center gap-1.5">
              {i === 0 ? <Home className="h-3.5 w-3.5 shrink-0" aria-hidden /> : null}
              <span className="flex flex-col leading-tight">
                <span lang="th">{c.labelTh}</span>
                {c.labelEn && c.labelEn !== c.labelTh && (
                  <span className="text-[10px] text-text-tertiary">{c.labelEn}</span>
                )}
              </span>
            </span>
          );
          return (
            <React.Fragment key={`${c.scope}-${c.scopeId ?? 'root'}`}>
              {isLast ? (
                <span className="text-text-primary font-medium">{inner}</span>
              ) : (
                <button
                  type="button"
                  className="rounded px-1.5 py-0.5 text-text-secondary hover:bg-surface-2 hover:text-accent transition-colors"
                  onClick={() => goTo(c)}
                >
                  {inner}
                </button>
              )}
              {!isLast && <ChevronRight className="h-3.5 w-3.5 text-text-tertiary shrink-0" aria-hidden />}
            </React.Fragment>
          );
        })}
      </nav>
    </Card>
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Rollup table
// ──────────────────────────────────────────────────────────────────────────

function RollupTable({
  rollup,
  onRowClick,
}: {
  rollup: CockpitRollup;
  onRowClick: (node: RollupNode) => void;
}) {
  const columns: ColumnDef<RollupNode>[] = [
    {
      accessorKey: 'scopeLabelTh',
      header: 'Unit',
      cell: ({ row }) => {
        const th = row.original.scopeLabelTh?.trim();
        const en = row.original.scopeLabelEn?.trim();
        if (th && en) {
          return (
            <div className="flex flex-col leading-tight">
              <span className="font-medium" lang="th">{th}</span>
              <span className="text-[11px] text-text-tertiary">{en}</span>
            </div>
          );
        }
        return <span className="font-medium">{th || en || row.original.scopeLabel}</span>;
      },
    },
    {
      accessorKey: 'programCount',
      header: 'Programs',
      meta: { numeric: true },
      cell: ({ row }) => <span className="font-tabular">{row.original.programCount}</span>,
    },
    {
      accessorKey: 'enrolledTotal',
      header: 'Enrolled',
      meta: { numeric: true },
      cell: ({ row }) => (
        <span className="font-tabular">
          {row.original.enrolledTotal === null
            ? '—'
            : row.original.enrolledTotal.toLocaleString('en-US')}
        </span>
      ),
    },
    {
      accessorKey: 'netContributionTotal',
      header: 'Net contrib. (THB)',
      meta: { numeric: true },
      cell: ({ row }) => (
        <span
          className={
            'font-tabular ' +
            (row.original.netContributionTotal !== null && row.original.netContributionTotal < 0
              ? 'text-danger'
              : '')
          }
        >
          {row.original.netContributionTotal === null
            ? '—'
            : row.original.netContributionTotal.toLocaleString('en-US')}
        </span>
      ),
    },
    {
      id: 'overall',
      header: 'Overall health',
      meta: { numeric: true },
      cell: ({ row }) => {
        const s = row.original.overall.score;
        if (s === null) return <span className="text-text-tertiary">—</span>;
        const tone = s < 40 ? 'text-danger' : s < 65 ? 'text-warning' : 'text-success';
        return <span className={`font-tabular font-semibold ${tone}`}>{s.toFixed(0)}</span>;
      },
    },
  ];
  return (
    <DataTable
      columns={columns}
      data={rollup.nodes}
      variant="ghost"
      onRowClick={onRowClick}
      pageSize={100}
    />
  );
}

// ──────────────────────────────────────────────────────────────────────────
// Recruitment panel — TCAS round 1–4 funnel rollup at the current scope.
// Compact view; for the full drill-down + per-round detail link out to
// /education/recruitment.
// ──────────────────────────────────────────────────────────────────────────

function RecruitmentPanel({ data }: { data: RecruitmentDashboardPayload | null }) {
  if (!data || data.meta.selectedYear === null) {
    return (
      <Card accent="cockpit" padding="md">
        <p className="text-sm text-text-tertiary">
          No recruitment data at this scope. Try a faculty scope, or check{' '}
          <Link href="/education/recruitment" className="text-accent-default hover:underline">
            the full recruitment dashboard
          </Link>
          .
        </p>
      </Card>
    );
  }
  const k = data.kpis;
  const overAlloc = k.planPerYear > 0 ? k.seats / k.planPerYear : null;
  const yieldVsPlan = k.planPerYear > 0 ? k.regReported / k.planPerYear : null;
  const yieldClass =
    yieldVsPlan === null
      ? ''
      : yieldVsPlan >= 1
        ? 'text-positive'
        : yieldVsPlan >= 0.85
          ? 'text-warning'
          : 'text-danger';

  return (
    <div className="flex flex-col gap-4">
      {/* Header — selected year + drill-out link */}
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-[13px] font-semibold uppercase tracking-[0.04em] text-text-secondary">
            Recruitment funnel
          </h3>
          <p className="mt-0.5 text-xs text-text-tertiary">
            BE {data.meta.selectedYear}{' '}
            {data.meta.selectedYearIsComplete ? (
              <Badge tone="success">complete</Badge>
            ) : (
              <Badge tone="info">in progress</Badge>
            )}
            {data.meta.inProgressYear !== null &&
              data.meta.inProgressYear !== data.meta.selectedYear && (
                <span className="ml-2 text-text-tertiary">
                  · in-progress: BE {data.meta.inProgressYear}
                </span>
              )}
          </p>
        </div>
        <Link
          href={`/education/recruitment${
            data.meta.appliedFilters.facultyId
              ? `?facultyId=${encodeURIComponent(data.meta.appliedFilters.facultyId)}`
              : ''
          }`}
          className="inline-flex items-center gap-1 text-xs text-accent-default hover:underline"
        >
          View full dashboard <ExternalLink className="h-3 w-3" />
        </Link>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        <RecPanelTile
          label="Programs"
          value={k.programCount.toLocaleString()}
          sub={`${k.rounds} rounds total`}
        />
        <RecPanelTile
          label="Plan / yr"
          value={k.planPerYear.toLocaleString()}
          sub="annual seat target"
        />
        <RecPanelTile
          label="Allocated"
          value={k.seats.toLocaleString()}
          sub={overAlloc !== null ? `${overAlloc.toFixed(2)}× over-alloc` : 'across rounds'}
        />
        <RecPanelTile
          label="Applicants"
          value={k.applicants.toLocaleString()}
          sub={
            k.competitionRatio !== null
              ? `${k.competitionRatio.toFixed(1)}× competition`
              : undefined
          }
        />
        <RecPanelTile
          label="Reported in"
          value={k.regReported.toLocaleString()}
          sub={
            yieldVsPlan !== null ? `${(yieldVsPlan * 100).toFixed(0)} % of plan` : undefined
          }
          valueClass={yieldClass}
        />
        <RecPanelTile
          label="Reg yield"
          value={
            k.regYield !== null ? `${(k.regYield * 100).toFixed(0)} %` : '—'
          }
          sub="reg / send-CH"
        />
      </div>

      {/* Faculty rollup — top 8 by applicants */}
      {data.byFaculty.length > 0 && (
        <Card accent="cockpit" padding="none">
          <header className="border-b border-border-subtle px-4 py-2 text-xs uppercase tracking-wide text-text-tertiary">
            By faculty (top {Math.min(8, data.byFaculty.length)})
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-1 text-xs uppercase tracking-wide text-text-tertiary">
                <tr>
                  <th className="px-4 py-2 text-left">Faculty</th>
                  <th className="px-4 py-2 text-right">Plan</th>
                  <th className="px-4 py-2 text-right">Applicants</th>
                  <th className="px-4 py-2 text-right">Comp.</th>
                  <th className="px-4 py-2 text-right">Reported</th>
                  <th className="px-4 py-2 text-right">vs Plan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle">
                {data.byFaculty.slice(0, 8).map((f) => {
                  const ratio = f.totals.seats > 0 ? f.totals.applicants / f.totals.seats : 0;
                  const fillVsPlan =
                    f.totals.planPerYear > 0
                      ? f.totals.regReported / f.totals.planPerYear
                      : null;
                  const fillClass =
                    fillVsPlan === null
                      ? ''
                      : fillVsPlan >= 1
                        ? 'text-positive'
                        : fillVsPlan >= 0.85
                          ? 'text-warning'
                          : 'text-danger';
                  return (
                    <tr key={f.facultyId}>
                      <td className="px-4 py-2">
                        <div className="font-medium" lang="th">
                          {f.facultyNameTh}
                        </div>
                        <div className="text-xs text-text-tertiary">{f.facultyNameEn}</div>
                      </td>
                      <td className="px-4 py-2 text-right font-tabular">
                        {f.totals.planPerYear.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right font-tabular">
                        {f.totals.applicants.toLocaleString()}
                      </td>
                      <td className="px-4 py-2 text-right font-tabular">
                        {ratio.toFixed(1)}×
                      </td>
                      <td className="px-4 py-2 text-right font-tabular">
                        {f.totals.regReported.toLocaleString()}
                      </td>
                      <td className={`px-4 py-2 text-right font-tabular font-semibold ${fillClass}`}>
                        {fillVsPlan === null ? '—' : `${(fillVsPlan * 100).toFixed(0)}%`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function RecPanelTile({
  label,
  value,
  sub,
  valueClass = 'text-text-primary',
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border border-border-subtle bg-surface-1 p-4">
      <p className="text-[10px] uppercase tracking-wide text-text-tertiary">{label}</p>
      <p className={`font-tabular text-2xl font-semibold ${valueClass}`}>{value}</p>
      {sub && <p className="text-[11px] text-text-tertiary">{sub}</p>}
    </div>
  );
}
