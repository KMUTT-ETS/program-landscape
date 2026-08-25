'use client';

import * as React from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { RefreshCw, CheckCircle2, AlertTriangle, Clock } from 'lucide-react';
import { Button, Card } from '@kku/ui';
import { runNowAction } from '@/lib/actions/data-sources';

// Manual refresh bar for the kku-dq data source — KKU's Digital
// Intelligence competency-test results, which power /education/student-dq.
//
// Click "Refresh now" → enqueues a manual run via POST /data-sources/:id/run
// (server action `runNowAction`), the same path the other connector-backed
// bars on this page use.
//
// This one is unusually quick: the whole export is a single ~14 MB
// response and a run completes in about five seconds, because the
// connector aggregates in memory and writes only two cube tables. It
// replaces both cubes wholesale, so a failed run leaves the previous
// snapshot intact rather than a half-rebuilt one.

export interface StudentDqDataSourceProps {
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
  if (cron === '0 3 * * 1') return 'weekly · Monday at 03:00';
  return cron;
}

/** Sub-minute runs would render as "0 min", which reads as "did not run". */
function describeDuration(ms: number | null): string {
  if (!ms) return '—';
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  return `${Math.round(ms / 60000)} min`;
}

export function StudentDqRefreshBar({ initial }: StudentDqDataSourceProps) {
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
          'Queued Student DQ refresh — takes about five seconds; reload the dashboard to see it.',
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
          Data source <code>kku-dq</code> is not registered yet. Run <code>pnpm db:seed</code> to
          seed the catalog row.
        </p>
      </Card>
    );
  }

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
          <RefreshCw className={`h-5 w-5 ${busy || inflight ? 'animate-spin' : ''}`} />
          <span>{busy || inflight ? 'Refreshing…' : 'Refresh now'}</span>
        </Button>
        <span className="text-xs text-text-tertiary">
          Re-pulls every student&apos;s DQ competency result from <code>dq.kku.ac.th</code>, matches
          each one to a current programme and rebuilds the two aggregate cubes — about five seconds.
          Run after a new testing round closes, or once LTIC confirms a batch of results has been
          published.
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 text-xs sm:grid-cols-2 md:grid-cols-4">
        <div className="flex items-center gap-2">
          <Clock className="h-4 w-4 text-text-tertiary" />
          <div>
            <div className="text-text-tertiary">Cadence</div>
            <div className="text-text-primary">{describeCron(initial.cadenceCron)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {lastStatus === 'SUCCEEDED' ? (
            <CheckCircle2 className="h-4 w-4 text-success" />
          ) : lastStatus === 'FAILED' ? (
            <AlertTriangle className="h-4 w-4 text-warning" />
          ) : (
            <Clock className="h-4 w-4 text-text-tertiary" />
          )}
          <div>
            <div className="text-text-tertiary">Last successful refresh</div>
            <div className="text-text-primary">{timeAgo(initial.lastSuccessAt)}</div>
          </div>
        </div>
        <div>
          <div className="text-text-tertiary">Last run cube rows</div>
          <div className="font-tabular text-text-primary">
            {initial.lastRunRecordsLoaded?.toLocaleString('en-US') ?? '—'}
          </div>
        </div>
        <div>
          <div className="text-text-tertiary">Last run duration</div>
          <div className="font-tabular text-text-primary">
            {describeDuration(initial.lastRunDurationMs)}
          </div>
        </div>
      </div>
    </Card>
  );
}
