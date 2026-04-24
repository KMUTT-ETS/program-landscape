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
  CircleDot,
  FileText,
  Filter,
  GraduationCap,
  Save,
  Sparkles,
  TrendingDown,
  Wallet,
} from 'lucide-react';
import type { SessionUser } from '@kku/shared';
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
} from './types';

// Cockpit page client. Three view modes + a left rail + top KPI strip
// + brief + export actions. Stays client-only because the segmented
// control + filters + drill-in need interactivity; the server page
// hydrates this with already-fetched data so the first paint is the
// real chart, not a skeleton.

type ViewMode = 'heatmap' | 'matrix' | 'rollup';

interface Props {
  user: SessionUser;
  scope: string;
  scopeId: string;
  initialView: ViewMode;
  kpis: CockpitKpis | null;
  heatmap: CockpitHeatmap | null;
  matrix: CockpitMatrix | null;
  rollup: CockpitRollup | null;
  savedViews: SavedView[];
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
                className="w-full rounded-md border border-border-default bg-surface-1 px-2 py-1.5 text-sm"
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
                className="w-full rounded-md border border-border-default bg-surface-1 px-2 py-1.5 text-sm"
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
                const res = await saveViewAction({
                  name,
                  viewMode: view,
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
        <KpiStrip kpis={props.kpis} />

        <div className="flex flex-wrap items-center justify-between gap-2">
          <Segmented value={view} onValueChange={(v) => changeView(v as ViewMode)}>
            <SegmentedList>
              <SegmentedTrigger value="heatmap">Health heatmap</SegmentedTrigger>
              <SegmentedTrigger value="matrix">Strategic matrix</SegmentedTrigger>
              <SegmentedTrigger value="rollup">Rollup tree</SegmentedTrigger>
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
          </div>
        </div>

        {view === 'heatmap' && props.heatmap && (
          <Card accent="cockpit" padding="md">
            <Heatmap
              rows={toHeatmapRows(props.heatmap)}
              columnLabels={['Demand', 'Financial', 'Quality', 'Relevance', 'Capability']}
              onRowClick={(r) => {
                const nextScope =
                  props.scope === 'university'
                    ? 'faculty'
                    : props.scope === 'faculty'
                      ? 'department'
                      : 'program';
                onRowDrill(nextScope, r.id);
              }}
            />
            <p className="mt-3 text-xs text-text-tertiary">
              Cells: 0–100. &lt;40 danger · 40–65 needs attention · &gt;65 healthy. Hover a cell to see underlying drivers. Methodology {props.heatmap.methodologyVersion} — see /methodologies/health-score.md
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
                const nextScope =
                  props.scope === 'university'
                    ? 'faculty'
                    : props.scope === 'faculty'
                      ? 'department'
                      : 'program';
                onRowDrill(nextScope, node.scopeId);
              }}
            />
          </Card>
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
  const fmt = (n: number | null) => (n === null ? '—' : n.toLocaleString('en-US'));
  return (
    <StatStrip columns={6}>
      <Stat
        moduleKey="cockpit"
        icon={<BookOpen />}
        label="Active programs"
        value={fmt(kpis.programCount)}
      />
      <Stat
        moduleKey="cockpit"
        icon={<GraduationCap />}
        label="Enrolled"
        value={fmt(kpis.enrolledTotal)}
      />
      <Stat
        moduleKey="cockpit"
        icon={<Wallet />}
        label="Net contrib. THB"
        value={fmt(kpis.netContributionTotal)}
        deltaTone={
          kpis.netContributionTotal !== null && kpis.netContributionTotal < 0
            ? 'negative'
            : undefined
        }
      />
      <Stat
        moduleKey="cockpit"
        icon={<AlertTriangle />}
        label="Danger zone"
        value={fmt(kpis.dangerZoneCount)}
        hint={kpis.dangerZoneCount > 0 ? 'health < 40' : 'none'}
        deltaTone={kpis.dangerZoneCount > 0 ? 'negative' : 'neutral'}
      />
      <Stat
        moduleKey="cockpit"
        icon={<TrendingDown />}
        label="Quality concern"
        value={fmt(kpis.qualityConcernCount)}
        hint="aging faculty"
        deltaTone={kpis.qualityConcernCount > 0 ? 'negative' : 'neutral'}
      />
      <Stat
        moduleKey="cockpit"
        icon={<CircleDot />}
        label="Avg curriculum age"
        value={
          kpis.averageCurriculumAgeYears === null
            ? '—'
            : `${kpis.averageCurriculumAgeYears.toFixed(1)}y`
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
    parentId: r.parentScopeId,
    cells: [
      toCell(r.dimensions.demand),
      toCell(r.dimensions.financial),
      toCell(r.dimensions.quality),
      toCell(r.dimensions.relevance),
      toCell(r.dimensions.capability),
    ],
    overall: toCell(r.overall),
  }));
}

function toCell(s: CockpitHeatmap['rows'][number]['dimensions']['demand']) {
  return {
    score: s.score,
    dataCompletenessPct: s.dataCompletenessPct,
    drivers: s.drivers.map((d) => ({ label: d.label, value: d.value })),
  };
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
    { accessorKey: 'scopeLabel', header: 'Unit' },
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
