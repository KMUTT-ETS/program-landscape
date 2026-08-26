'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { RefreshCw, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { Button, Card } from '@kku/ui';
import { runNowAction } from '@/lib/actions/data-sources';

// Manual refresh bar for the kku-evaluations data source — the student-
// satisfaction survey ingestion. Mounted on /admin/dashboard-data-fetch
// alongside the Education + Staff cube bars.
//
// Click "Refresh now" → enqueues a manual run via POST /data-sources/:id/run
// (server action `runNowAction`). The job is ~110 minutes wall-clock —
// the button stays disabled while a run is in flight (status='RUNNING'),
// and the page refreshes its data when revalidatePath fires.

export interface SatisfactionDataSourceProps {
  initial: {
    id: string;
    slug: string;
    cadenceCron: string | null;
    scheduleEnabled: boolean;
    status: string;
    lastSuccessAt: string | null; // ISO
    lastRunStatus: string | null;
    lastRunCompletedAt: string | null; // ISO
    lastRunRecordsLoaded: number | null;
    lastRunRecordsFailed: number | null;
    lastRunDurationMs: number | null;
  } | null;
}

function timeAgo(iso: string | null): string {
  if (!iso) return 'never';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return 'never';
  const ms = Date.now() - d.getTime();
  const min = Math.round(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h ago`;
  const days = Math.round(h / 24);
  return `${days} d ago`;
}

function describeCron(cron: string | null): string {
  if (!cron) return 'no schedule set';
  // Recognise our specific patterns first; fall through to a humanised
  // representation otherwise.
  if (cron === '0 21 1,15 * *') return 'bi-weekly · 1st + 15th at 21:00';
  if (cron === '0 3 * * 0') return 'weekly · Sunday at 03:00';
  return cron;
}

export function SatisfactionRefreshBar({ initial }: SatisfactionDataSourceProps) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const inflight = initial?.lastRunStatus === 'RUNNING';

  const refresh = async (): Promise<void> => {
    if (!initial) return;
    setBusy(true);
    try {
      const res = await runNowAction(initial.id);
      if (res.ok) {
        toast.success(
          'Queued student-evaluation refresh — runs ~110 minutes; page will update on the next visit.',
        );
        router.refresh();
      } else {
        toast.error(res.message);
      }
    } finally {
      setBusy(false);
    }
  };

  if (!initial) {
    return (
      <Card className="p-3">
        <p className="text-sm text-text-tertiary">
          Data source <code>kku-evaluations</code> is not registered yet. Run{' '}
          <code>pnpm db:seed</code> to seed the catalog row.
        </p>
      </Card>
    );
  }

  const lastSuccess = initial.lastSuccessAt;
  const lastStatus = initial.lastRunStatus;

  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => void refresh()}
          disabled={busy || inflight}
          variant="outline"
          size="sm"
          className="gap-2"
        >
          <RefreshCw className={`size-icon-lg ${busy || inflight ? 'animate-spin' : ''}`} />
          <span>{busy || inflight ? 'Refreshing…' : 'Refresh now'}</span>
        </Button>
        <span className="text-xs text-text-tertiary">
          Pulls a fresh snapshot from <code>POWERBI.EVALUATE_INSTRUCTOR</code> — full
          load is ~110 minutes for ~986K aggregated cells. Force this when a Council
          meeting needs the latest semester before the next bi-weekly slot.
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 md:grid-cols-4">
        <div className="flex items-center gap-2">
          <Clock className="size-icon-md text-text-tertiary" />
          <div>
            <div className="text-text-tertiary">Cadence</div>
            <div className="text-text-primary">{describeCron(initial.cadenceCron)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lastStatus === 'SUCCEEDED' ? (
            <CheckCircle2 className="size-icon-md text-success-default" />
          ) : lastStatus === 'FAILED' ? (
            <AlertTriangle className="size-icon-md text-warning-default" />
          ) : (
            <Clock className="size-icon-md text-text-tertiary" />
          )}
          <div>
            <div className="text-text-tertiary">Last successful refresh</div>
            <div className="text-text-primary">{timeAgo(lastSuccess)}</div>
          </div>
        </div>
        <div>
          <div className="text-text-tertiary">Last run records loaded</div>
          <div className="font-tabular text-text-primary">
            {initial.lastRunRecordsLoaded?.toLocaleString('en-US') ?? '—'}
          </div>
        </div>
        <div>
          <div className="text-text-tertiary">Last run duration</div>
          <div className="font-tabular text-text-primary">
            {initial.lastRunDurationMs
              ? `${Math.round(initial.lastRunDurationMs / 60000)} min`
              : '—'}
          </div>
        </div>
      </div>
    </Card>
  );
}
