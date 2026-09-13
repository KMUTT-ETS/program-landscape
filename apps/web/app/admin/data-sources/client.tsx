'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  Badge,
  Button,
  Card,
  DataTable,
  FreshnessBadge,
  Input,
  RightPanel,
  type ColumnDef,
} from '@kku/ui';
import {
  bulkStatusAction,
  patchCadenceAction,
  runNowAction,
} from '@/lib/actions/data-sources';
import type { DataSourceRow } from './page';
import { DataSourceMark, isMarkedSource } from '@/components/data-source-mark';

// Client-side chrome for the /admin/data-sources page. Three
// interaction surfaces:
//   1. Search + per-row "Run now" in the main table
//   2. Bulk-select + pause/resume in the toolbar
//   3. Per-row detail drawer showing recent runs + cadence editor
//
// Keeping everything here as one client component is fine for the
// admin page — it's not on the hot-path. When the module pages come in,
// most of this will live in shared @kku/ui primitives.

interface RunRow {
  id: string;
  trigger: string;
  status: string;
  recordsFetched: number;
  recordsLoaded: number;
  recordsFailed: number;
  createdAt: string;
  completedAt: string | null;
  durationMs: number | null;
  errorCode: string | null;
  errorMessage: string | null;
}

// Sort priority by status: ACTIVE float to the top so operators see
// what's actually firing first, then PAUSED, MOCKED, ERROR, and
// DISABLED tail. Within the same status, name-alphabetical.
const STATUS_RANK: Record<string, number> = {
  active: 0,
  paused: 1,
  mocked: 2,
  error: 3,
  disabled: 4,
};

export function DataSourcesClient({
  rows,
  canConfigure,
}: {
  rows: DataSourceRow[];
  canConfigure: boolean;
}) {
  const router = useRouter();
  const [filter, setFilter] = React.useState('');
  const [selected, setSelected] = React.useState<Set<string>>(new Set());
  const [detail, setDetail] = React.useState<DataSourceRow | null>(null);
  const [detailRuns, setDetailRuns] = React.useState<RunRow[] | null>(null);

  const sortedRows = React.useMemo(() => {
    return [...rows].sort((a, b) => {
      const ra = STATUS_RANK[a.status.toLowerCase()] ?? 99;
      const rb = STATUS_RANK[b.status.toLowerCase()] ?? 99;
      if (ra !== rb) return ra - rb;
      return a.name.localeCompare(b.name);
    });
  }, [rows]);

  // Toggle-one row in/out of the bulk selection.
  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const allVisibleSelected =
    sortedRows.length > 0 && sortedRows.every((r) => selected.has(r.id));

  const columns: ColumnDef<DataSourceRow>[] = [
    {
      id: 'select',
      header: () => (
        <input
          type="checkbox"
          aria-label="Select all"
          checked={allVisibleSelected}
          onChange={(e) => {
            if (e.target.checked) setSelected(new Set(sortedRows.map((r) => r.id)));
            else setSelected(new Set());
          }}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          aria-label={`Select ${row.original.name}`}
          checked={selected.has(row.original.id)}
          onChange={() => toggle(row.original.id)}
          onClick={(e) => e.stopPropagation()}
        />
      ),
    },
    {
      accessorKey: 'name',
      header: 'Name',
      cell: ({ row }) => (
        <div className="flex flex-col">
          <span className="flex items-center gap-1.5 font-medium">
            {isMarkedSource(row.original.slug) && (
              <DataSourceMark source={row.original.slug} size={14} />
            )}
            {row.original.name}
          </span>
          <span className="font-mono text-xs text-text-tertiary">
            {row.original.slug}
          </span>
        </div>
      ),
    },
    {
      accessorKey: 'kind',
      header: 'Kind',
      cell: ({ row }) => (
        <Badge tone={kindTone(row.original.kind)}>{row.original.kind}</Badge>
      ),
    },
    {
      accessorKey: 'inputFormat',
      header: 'Format',
      cell: ({ row }) => (
        <span className="font-mono text-xs text-text-secondary">
          {row.original.inputFormat}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <Badge tone={statusTone(row.original.status)}>{row.original.status}</Badge>
      ),
    },
    {
      accessorKey: 'cadenceCron',
      header: 'Cadence',
      cell: ({ row }) => (
        <span className="font-mono text-xs text-text-secondary">
          {row.original.cadenceCron ?? 'manual'}
          {!row.original.scheduleEnabled && row.original.cadenceCron && (
            <span className="ml-1 text-text-tertiary">(paused)</span>
          )}
        </span>
      ),
    },
    {
      accessorKey: 'lastSyncedAt',
      header: 'Last sync',
      cell: ({ row }) =>
        row.original.lastSyncedAt ? (
          <FreshnessBadge freshnessDate={row.original.lastSyncedAt} />
        ) : (
          <span className="text-text-tertiary">never</span>
        ),
      meta: { numeric: false },
    },
    {
      id: 'runs',
      header: 'Runs',
      meta: { numeric: true },
      cell: ({ row }) => (
        <span className="font-tabular">{row.original._count.ingestionRuns}</span>
      ),
    },
    {
      id: 'actions',
      header: '',
      cell: ({ row }) => (
        <div className="flex items-center gap-2">
          <Button
            size="xs"
            variant="outline"
            onClick={(e) => {
              e.stopPropagation();
              void onRunNow(row.original.id, row.original.name);
            }}
          >
            Run now
          </Button>
        </div>
      ),
    },
  ];

  const onRunNow = async (id: string, name: string) => {
    const res = await runNowAction(id);
    if (res.ok) {
      toast.success(`Queued run for ${name}`);
      router.refresh();
    } else {
      toast.error(res.message);
    }
  };

  const onBulkStatus = async (status: 'active' | 'paused') => {
    if (selected.size === 0) return;
    const res = await bulkStatusAction([...selected], status);
    if (res.ok) {
      toast.success(`Updated ${res.updated} sources to ${status}`);
      setSelected(new Set());
      router.refresh();
    } else {
      toast.error(res.message);
    }
  };

  const onOpenDetail = async (row: DataSourceRow) => {
    setDetail(row);
    setDetailRuns(null);
    try {
      // The apiFetch wrapper is server-only; use the unwrapped envelope
      // via the Next.js proxy route. Simpler here: call the NestJS API
      // directly from the browser through /api/v1/... rewrites. But we
      // don't have a rewrite rule yet, so use a small client-side fetch
      // to a dedicated /api/admin-ingestion/runs route. For now, lean on
      // the fact that the rows already have _count — runs list is a
      // nice-to-have, deferred.
      const res = await fetch(`/api/admin-ingestion/${row.id}/runs`);
      if (res.ok) {
        const body = (await res.json()) as { data: RunRow[] };
        setDetailRuns(body.data ?? []);
      } else {
        setDetailRuns([]);
      }
    } catch {
      setDetailRuns([]);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <Input
          placeholder="Filter by name or slug"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-xs"
        />
        {canConfigure && selected.size > 0 && (
          <div className="flex items-center gap-2 text-sm text-text-secondary">
            <span>{selected.size} selected</span>
            <Button size="xs" variant="outline" onClick={() => void onBulkStatus('paused')}>
              Pause
            </Button>
            <Button size="xs" variant="outline" onClick={() => void onBulkStatus('active')}>
              Resume
            </Button>
          </div>
        )}
      </div>

      <Card padding="none">
        <DataTable
          columns={columns}
          data={sortedRows}
          globalFilter={filter}
          variant="ghost"
          pageSize={50}
          onRowClick={(r) => void onOpenDetail(r)}
        />
      </Card>

      <RightPanel
        open={!!detail}
        onOpenChange={(open) => {
          if (!open) {
            setDetail(null);
            setDetailRuns(null);
          }
        }}
        title={detail?.name ?? ''}
      >
        {detail && (
          <DetailContent
            row={detail}
            runs={detailRuns}
            canConfigure={canConfigure}
            onRefreshRuns={() => void onOpenDetail(detail)}
          />
        )}
      </RightPanel>
    </div>
  );
}

function DetailContent({
  row,
  runs,
  canConfigure,
  onRefreshRuns,
}: {
  row: DataSourceRow;
  runs: RunRow[] | null;
  canConfigure: boolean;
  onRefreshRuns: () => void;
}) {
  const router = useRouter();
  const [cadence, setCadence] = React.useState(row.cadenceCron ?? '');
  const [enabled, setEnabled] = React.useState(row.scheduleEnabled);
  const [saving, setSaving] = React.useState(false);

  const onSave = async () => {
    setSaving(true);
    const res = await patchCadenceAction(
      row.id,
      cadence.trim() ? cadence.trim() : null,
      enabled,
    );
    setSaving(false);
    if (res.ok) {
      toast.success('Cadence updated. Restart ingestion worker for schedule to take effect.');
      router.refresh();
    } else {
      toast.error(res.message);
    }
  };

  return (
    <div className="flex flex-col gap-5 p-1">
      <section className="text-sm">
        <a
          href={`/admin/data-sources/${encodeURIComponent(row.slug)}`}
          className="inline-flex items-center gap-1 rounded border border-border-default bg-surface-2 px-2 py-1 text-xs hover:bg-surface-3"
        >
          Open full stats →
        </a>
      </section>
      <section className="flex flex-col gap-1 text-sm">
        <div className="text-text-tertiary">Owner</div>
        <div>{row.ownerContact ?? '—'}</div>
      </section>
      {row.notes && (
        <section className="flex flex-col gap-1 text-sm">
          <div className="text-text-tertiary">Notes</div>
          <div className="whitespace-pre-wrap">{row.notes}</div>
        </section>
      )}

      <section className="flex flex-col gap-2 text-sm">
        <div className="text-text-tertiary">Cadence</div>
        <div className="flex items-center gap-2">
          <Input
            value={cadence}
            onChange={(e) => setCadence(e.target.value)}
            placeholder="0 3 * * * (cron — 5 fields)"
            className="max-w-xs font-mono"
            disabled={!canConfigure}
          />
          <label className="flex items-center gap-1 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={!canConfigure}
            />
            Enabled
          </label>
          {canConfigure && (
            <Button size="sm" onClick={() => void onSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          )}
        </div>
      </section>

      <section className="flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between">
          <div className="text-text-tertiary">Recent runs</div>
          <Button size="xs" variant="ghost" onClick={onRefreshRuns}>
            Refresh
          </Button>
        </div>
        {runs === null ? (
          <div className="text-text-tertiary">Loading…</div>
        ) : runs.length === 0 ? (
          <div className="text-text-tertiary">No runs recorded yet.</div>
        ) : (
          <div className="max-h-80 overflow-y-auto rounded border border-border-default">
            <table className="w-full text-xs">
              <thead className="bg-surface-2 text-text-secondary">
                <tr>
                  <th className="px-2 py-1 text-left">When</th>
                  <th className="px-2 py-1 text-left">Trigger</th>
                  <th className="px-2 py-1 text-left">Status</th>
                  <th className="px-2 py-1 text-right">Loaded</th>
                  <th className="px-2 py-1 text-right">Failed</th>
                  <th className="px-2 py-1 text-right">ms</th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id} className="border-t border-border-subtle">
                    <td className="px-2 py-1 text-text-secondary">
                      {new Date(r.createdAt).toLocaleString()}
                    </td>
                    <td className="px-2 py-1">{r.trigger}</td>
                    <td className="px-2 py-1">
                      <Badge tone={runStatusTone(r.status)}>{r.status}</Badge>
                    </td>
                    <td className="px-2 py-1 text-right font-tabular">{r.recordsLoaded}</td>
                    <td
                      className={`px-2 py-1 text-right font-tabular ${
                        r.recordsFailed > 0 ? 'text-danger' : ''
                      }`}
                    >
                      {r.recordsFailed}
                    </td>
                    <td className="px-2 py-1 text-right font-tabular">
                      {r.durationMs ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function kindTone(kind: string): 'neutral' | 'accent' | 'info' {
  if (kind === 'API') return 'info';
  if (kind === 'PDF') return 'accent';
  return 'neutral';
}

function statusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' {
  if (status === 'active') return 'success';
  if (status === 'paused') return 'warning';
  if (status === 'error') return 'danger';
  return 'neutral';
}

function runStatusTone(status: string): 'neutral' | 'success' | 'warning' | 'danger' | 'info' {
  if (status === 'SUCCEEDED') return 'success';
  if (status === 'FAILED') return 'danger';
  if (status === 'SKIPPED') return 'warning';
  if (status === 'RUNNING') return 'info';
  return 'neutral';
}
